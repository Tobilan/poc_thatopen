import assert from "node:assert/strict";
import test from "node:test";
import {
  IFCGLOBALLYUNIQUEID,
  IFCOBJECTDEFINITION,
  IFCOWNERHISTORY,
  IFCPRODUCT,
  IFCPROJECT,
  IFCPROPERTYLISTVALUE,
  IFCPROPERTYSET,
  IFCPROPERTYSINGLEVALUE,
  IFCRELASSIGNSTOCONTROL,
  IFCRELASSIGNSTOPROCESS,
  IFCRELASSIGNSTOPRODUCT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELNESTS,
  IFCRELSEQUENCE,
  IFCROOT,
  IFCTASK,
  IFCTASKTIME,
  IFCTYPEPRODUCT,
  IFCWORKSCHEDULE,
} from "web-ifc";
import type { IfcLineObject } from "web-ifc";
import {
  addTaskSequence,
  addTaskToMission,
  createRobotMission,
  createRobotTask,
} from "../../src/domain/robot-tasks";
import {
  IfcMissionReplacementError,
  WebIfcMissionReplacer,
  WebIfcMissionWriter,
  type IfcMissionReplacementApiPort,
  type IfcMissionWriteManifest,
} from "../../src/ifc/model-export";
import {
  mapMissionToIfcRecords,
  type IfcRelAssignsToProcessRecord,
  type IfcRobotMissionRecordGraph,
} from "../../src/ifc/robot-tasks";

const modelId = 1;
const sourceModelId = "replacement-source";
const timestamp = "2026-01-01T00:00:00Z";
const unrelatedExpressId = 1;
const unrelatedType = 987650001;
const externalRelationType = 987650002;

/** IFC type names required by reader indexing and deletion ordering. */
const TYPE_NAMES = new Map<number, string>([
  [IFCPROPERTYLISTVALUE, "IFCPROPERTYLISTVALUE"],
  [IFCPROPERTYSET, "IFCPROPERTYSET"],
  [IFCPROPERTYSINGLEVALUE, "IFCPROPERTYSINGLEVALUE"],
  [IFCRELASSIGNSTOCONTROL, "IFCRELASSIGNSTOCONTROL"],
  [IFCRELASSIGNSTOPROCESS, "IFCRELASSIGNSTOPROCESS"],
  [IFCRELASSIGNSTOPRODUCT, "IFCRELASSIGNSTOPRODUCT"],
  [IFCRELDEFINESBYPROPERTIES, "IFCRELDEFINESBYPROPERTIES"],
  [IFCRELNESTS, "IFCRELNESTS"],
  [IFCRELSEQUENCE, "IFCRELSEQUENCE"],
  [IFCTASK, "IFCTASK"],
  [IFCTASKTIME, "IFCTASKTIME"],
  [IFCWORKSCHEDULE, "IFCWORKSCHEDULE"],
  [unrelatedType, "IFCBUILDINGELEMENTPROXY"],
  [externalRelationType, "IFCRELUNKNOWNEXTERNAL"],
]);

type FakeLine = IfcLineObject & Record<string, unknown>;

/** Small immutable vector matching the web-ifc query result shape. */
const vector = (entries: readonly number[]) => ({
  size: () => entries.length,
  get: (index: number) => entries[index],
});

/** Reads a web-ifc typed wrapper without changing primitive values. */
const wrappedValue = (entry: unknown): unknown =>
  entry && typeof entry === "object" && "value" in entry
    ? (entry as { value: unknown }).value
    : entry;

/**
 * In-memory web-ifc port used by the real reader, writer, and replacer.
 *
 * Fixture seeding is intentionally separate from mutation recording so every
 * negative test can prove the public replacement call performed zero writes.
 */
class FakeReplacementApi implements IfcMissionReplacementApiPort {
  readonly lines = new Map<number, FakeLine>();
  readonly deletedLines: number[] = [];
  readonly writtenLines: IfcLineObject[] = [];
  private readonly typeNames = new Map(TYPE_NAMES);
  private generatedGuid = 0;
  private maximumExpressId = 0;

  addFixtureLine(line: FakeLine, typeName?: string): void {
    this.lines.set(line.expressID, line);
    this.maximumExpressId = Math.max(this.maximumExpressId, line.expressID);
    if (typeName) this.typeNames.set(line.type, typeName);
  }

  removeFixtureLine(expressId: number): void {
    this.lines.delete(expressId);
  }

  fixtureLine(expressId: number): FakeLine {
    const line = this.lines.get(expressId);
    assert.ok(line, `Expected fixture line #${expressId}.`);
    return line;
  }

  nextFixtureExpressId(): number {
    return this.maximumExpressId + 1;
  }

  clearMutations(): void {
    this.deletedLines.length = 0;
    this.writtenLines.length = 0;
  }

  CreateIfcGuidToExpressIdMapping(): void {}

  GetExpressIdFromGuid(
    _modelID: number,
    guid: string,
  ): string | number | undefined {
    for (const [expressId, line] of this.lines) {
      if (wrappedValue(line.GlobalId) === guid) return expressId;
    }
    return undefined;
  }

  GetLineIDsWithType(_modelID: number, type: number, includeInherited = false) {
    const entries = [...this.lines.values()];
    if (type === IFCROOT && includeInherited) {
      return vector(
        entries
          .filter((line) => line.GlobalId !== undefined)
          .map((line) => line.expressID),
      );
    }
    if (
      includeInherited &&
      [IFCOBJECTDEFINITION, IFCPRODUCT, IFCTYPEPRODUCT].includes(type)
    ) {
      if (type === IFCOBJECTDEFINITION) {
        return vector(
          entries
            .filter(
              (line) => line.type === IFCTASK || line.type === unrelatedType,
            )
            .map((line) => line.expressID),
        );
      }
      return vector(
        type === IFCPRODUCT
          ? entries
              .filter((line) => line.type === unrelatedType)
              .map((line) => line.expressID)
          : [],
      );
    }
    if (type === IFCPROJECT || type === IFCOWNERHISTORY) return vector([]);
    return vector(
      entries
        .filter((line) => line.type === type)
        .map((line) => line.expressID),
    );
  }

  GetAllLines() {
    return vector([...this.lines.keys()].sort((left, right) => left - right));
  }

  GetLine(_modelID: number, expressID: number): unknown {
    return this.lines.get(expressID);
  }

  GetLineType(_modelID: number, expressID: number): number {
    return this.lines.get(expressID)?.type ?? 0;
  }

  GetNameFromTypeCode(type: number): string {
    return this.typeNames.get(type) ?? "IFCUNKNOWN";
  }

  GetMaxExpressID(): number {
    return this.maximumExpressId;
  }

  CreateIFCGloballyUniqueId(): unknown {
    this.generatedGuid += 1;
    return {
      type: IFCGLOBALLYUNIQUEID,
      value: `replacement-guid-${this.generatedGuid}`,
    };
  }

  CreateIfcType(_modelID: number, type: number, value: unknown): unknown {
    return { type, value };
  }

  WriteLine<Type extends IfcLineObject>(
    _modelID: number,
    lineObject: Type,
  ): void {
    this.writtenLines.push(lineObject);
    this.addFixtureLine(lineObject as FakeLine);
  }

  DeleteLine(_modelID: number, expressID: number): void {
    this.deletedLines.push(expressID);
    this.lines.delete(expressID);
  }
}

/** Creates a valid graph with deterministic mission, task, and sequence IDs. */
const missionGraph = (
  missionId: string,
  firstTaskId: string,
  secondTaskId = `${firstTaskId}-second`,
): IfcRobotMissionRecordGraph => {
  let mission = createRobotMission(
    { id: missionId, name: `Mission ${missionId}` },
    timestamp,
  );
  mission = addTaskToMission(
    mission,
    createRobotTask(
      {
        id: firstTaskId,
        name: `Task ${firstTaskId}`,
        actionType: "NAVIGATE_TO",
      },
      timestamp,
    ),
    timestamp,
  );
  mission = addTaskToMission(
    mission,
    createRobotTask(
      {
        id: secondTaskId,
        name: `Task ${secondTaskId}`,
        actionType: "NAVIGATE_TO",
      },
      timestamp,
    ),
    timestamp,
  );
  mission = addTaskSequence(
    mission,
    {
      id: `sequence-${missionId}`,
      predecessorTaskId: firstTaskId,
      successorTaskId: secondTaskId,
      sequenceType: "FINISH_START",
    },
    timestamp,
  );
  return mapMissionToIfcRecords(mission);
};

/** Adds a source line that must survive every annotation replacement. */
const addUnrelatedBuildingLine = (api: FakeReplacementApi): FakeLine => {
  const line = {
    expressID: unrelatedExpressId,
    type: unrelatedType,
    GlobalId: { value: "unrelated-building-guid" },
    Name: { value: "Unrelated building object" },
  } as unknown as FakeLine;
  api.addFixtureLine(line);
  return line;
};

/** Seeds a valid owned graph through the production writer used by export. */
const seedOwnedGraph = (
  api: FakeReplacementApi,
  graph = missionGraph("owned-mission", "owned-task-a", "owned-task-b"),
): { graph: IfcRobotMissionRecordGraph; manifest: IfcMissionWriteManifest } => {
  const manifest = new WebIfcMissionWriter().write(
    api,
    modelId,
    sourceModelId,
    graph,
    "IFC4",
  );
  api.clearMutations();
  return { graph, manifest };
};

/** Captures the replacer's structured error without parsing its message. */
const replacementError = (operation: () => unknown) => {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof IfcMissionReplacementError)) throw caught;
  return caught;
};

/** Proves one failed preflight left the fake source completely untouched. */
const assertNoMutations = (api: FakeReplacementApi): void => {
  assert.deepEqual(api.deletedLines, []);
  assert.deepEqual(api.writtenLines, []);
};

for (const duplicateCase of [
  {
    name: "duplicate current mission IDs",
    code: "IFC_CURRENT_MISSION_ID_DUPLICATE",
    graphs: [
      missionGraph("duplicate-mission", "task-one-a", "task-one-b"),
      missionGraph("duplicate-mission", "task-two-a", "task-two-b"),
    ],
  },
  {
    name: "duplicate current task IDs",
    code: "IFC_CURRENT_TASK_ID_DUPLICATE",
    graphs: [
      missionGraph("mission-one", "shared-task", "task-one-b"),
      missionGraph("mission-two", "shared-task", "task-two-b"),
    ],
  },
  {
    name: "duplicate deterministic record IDs",
    code: "IFC_CURRENT_RECORD_ID_DUPLICATE",
    graphs: (() => {
      const graph = missionGraph("record-duplicate", "record-task-a");
      return [{ ...graph, records: [...graph.records, graph.records[0]] }];
    })(),
  },
] as const) {
  test(`${duplicateCase.name} are rejected before IFC mutation`, () => {
    const api = new FakeReplacementApi();
    addUnrelatedBuildingLine(api);

    const error = replacementError(() =>
      new WebIfcMissionReplacer().replace(
        api,
        modelId,
        sourceModelId,
        duplicateCase.graphs,
        "IFC4",
      ),
    );

    assert.ok(error.issues.some((issue) => issue.code === duplicateCase.code));
    assertNoMutations(api);
  });
}

test("malformed recognized ownership reports ambiguous provenance atomically", () => {
  const api = new FakeReplacementApi();
  addUnrelatedBuildingLine(api);
  const { graph, manifest } = seedOwnedGraph(api);
  const nest = manifest.entries.find((entry) => entry.entity === "IfcRelNests");
  assert.ok(nest);
  api.removeFixtureLine(nest.expressId);

  const error = replacementError(() =>
    new WebIfcMissionReplacer().replace(
      api,
      modelId,
      sourceModelId,
      [graph],
      "IFC4",
    ),
  );

  assert.ok(
    error.issues.some(
      (issue) => issue.code === "IFC_IMPORTED_OWNERSHIP_AMBIGUOUS",
    ),
  );
  assertNoMutations(api);
});

test("duplicate preserved GlobalIds are rejected before mutation", () => {
  const api = new FakeReplacementApi();
  addUnrelatedBuildingLine(api);
  const { graph, manifest } = seedOwnedGraph(api);
  const rootEntries = manifest.entries.filter((entry) => entry.globalId);
  assert.ok(rootEntries.length >= 2);
  api.fixtureLine(rootEntries[1].expressId).GlobalId = api.fixtureLine(
    rootEntries[0].expressId,
  ).GlobalId;

  const error = replacementError(() =>
    new WebIfcMissionReplacer().replace(
      api,
      modelId,
      sourceModelId,
      [graph],
      "IFC4",
    ),
  );

  assert.ok(
    error.issues.some(
      (issue) => issue.code === "IFC_PROVENANCE_GLOBAL_ID_DUPLICATE",
    ),
  );
  assertNoMutations(api);
});

test("two imported records cannot claim the same deterministic identity", () => {
  const api = new FakeReplacementApi();
  addUnrelatedBuildingLine(api);
  const { graph, manifest } = seedOwnedGraph(api);
  const sequence = manifest.entries.find(
    (entry) => entry.entity === "IfcRelSequence",
  );
  assert.ok(sequence);
  const duplicateExpressId = api.nextFixtureExpressId();
  api.addFixtureLine({
    ...api.fixtureLine(sequence.expressId),
    expressID: duplicateExpressId,
    GlobalId: {
      type: IFCGLOBALLYUNIQUEID,
      value: "duplicate-sequence-guid",
    },
  } as FakeLine);

  const error = replacementError(() =>
    new WebIfcMissionReplacer().replace(
      api,
      modelId,
      sourceModelId,
      [graph],
      "IFC4",
    ),
  );

  assert.ok(
    error.issues.some(
      (issue) => issue.code === "IFC_PROVENANCE_IDENTITY_DUPLICATE",
    ),
  );
  assertNoMutations(api);
});

test("unknown external incoming reference blocks deletion with structured context", () => {
  const api = new FakeReplacementApi();
  addUnrelatedBuildingLine(api);
  const { graph, manifest } = seedOwnedGraph(api);
  const missionRoot = manifest.entries.find(
    (entry) => entry.recordId === graph.rootTask.id,
  );
  assert.ok(missionRoot);
  const referrerExpressId = api.nextFixtureExpressId();
  api.addFixtureLine(
    {
      expressID: referrerExpressId,
      type: externalRelationType,
      UnknownReference: { type: 5, value: missionRoot.expressId },
    } as unknown as FakeLine,
    "IFCRELUNKNOWNEXTERNAL",
  );

  const error = replacementError(() =>
    new WebIfcMissionReplacer().replace(
      api,
      modelId,
      sourceModelId,
      [graph],
      "IFC4",
    ),
  );
  const issue = error.issues.find(
    (candidate) => candidate.code === "IFC_OWNED_ENTITY_EXTERNALLY_REFERENCED",
  );

  assert.deepEqual(issue, {
    code: "IFC_OWNED_ENTITY_EXTERNALLY_REFERENCED",
    message: `External IFCRELUNKNOWNEXTERNAL #${referrerExpressId} references application-owned entity #${missionRoot.expressId}.`,
    expressId: missionRoot.expressId,
    referrerExpressId,
    entityType: "IFCRELUNKNOWNEXTERNAL",
  });
  assertNoMutations(api);
});

test("a desired external reference cannot target an owned entity being replaced", () => {
  const api = new FakeReplacementApi();
  addUnrelatedBuildingLine(api);
  const { graph, manifest } = seedOwnedGraph(api);
  const missionRoot = manifest.entries.find(
    (entry) => entry.recordId === graph.rootTask.id,
  );
  const executableTask = graph.records.find(
    (record) =>
      record.entity === "IfcTask" && record.role === "EXECUTABLE_TASK",
  );
  assert.ok(missionRoot?.globalId);
  assert.ok(executableTask);
  const relation: IfcRelAssignsToProcessRecord = {
    entity: "IfcRelAssignsToProcess",
    id: "relation/targets/references-owned-source-task",
    name: "NAVIGATES_TO",
    relatingProcess: { entity: "IfcTask", id: executableTask.id },
    relatedObjects: [
      { kind: "IfcObjectReference", globalId: missionRoot.globalId },
    ],
  };
  const desired = { ...graph, records: [...graph.records, relation] };

  const error = replacementError(() =>
    new WebIfcMissionReplacer().replace(
      api,
      modelId,
      sourceModelId,
      [desired],
      "IFC4",
    ),
  );

  assert.ok(
    error.issues.some(
      (issue) =>
        issue.code === "IFC_REPLACEMENT_EXTERNAL_REFERENCE_OWNED" &&
        issue.recordIdentity === relation.id &&
        issue.expressId === missionRoot.expressId,
    ),
  );
  assertNoMutations(api);
});

test("an explicit empty graph collection removes owned annotations only", () => {
  const api = new FakeReplacementApi();
  const unrelated = addUnrelatedBuildingLine(api);
  const { manifest } = seedOwnedGraph(api);
  const ownedExpressIds = manifest.entries
    .map((entry) => entry.expressId)
    .sort((left, right) => left - right);

  const result = new WebIfcMissionReplacer().replace(
    api,
    modelId,
    sourceModelId,
    [],
    "IFC4",
  );

  assert.equal(result.graph, undefined);
  assert.equal(result.writeManifest, undefined);
  assert.equal(result.imported.missions.length, 1);
  assert.deepEqual(
    [...result.removedExpressIds].sort((left, right) => left - right),
    ownedExpressIds,
  );
  assert.deepEqual(
    [...api.deletedLines].sort((left, right) => left - right),
    ownedExpressIds,
  );
  assert.deepEqual(api.writtenLines, []);
  assert.deepEqual([...api.lines.keys()], [unrelatedExpressId]);
  assert.equal(api.fixtureLine(unrelatedExpressId), unrelated);
  assert.equal(
    wrappedValue(api.fixtureLine(unrelatedExpressId).GlobalId),
    "unrelated-building-guid",
  );
});
