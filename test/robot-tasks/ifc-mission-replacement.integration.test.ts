import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { IFCROOT, type IfcLineObject } from "web-ifc";
import {
  compareRobotMissionsSemantically,
  RobotMissionService,
  type RobotMissionStorageSelection,
} from "../../src/application/robot-tasks";
import type {
  RobotActionType,
  RobotMission,
  RobotMissionSchedule,
  RobotTask,
  RobotTaskSequence,
} from "../../src/domain/robot-tasks";
import {
  IfcMissionImportService,
  type IfcMissionEntityProvenance,
  type IfcMissionImportApiPort,
  type IfcMissionImportResult,
} from "../../src/ifc/model-import";
import {
  IfcModelExportService,
  IfcSourceModelRegistry,
  WebIfcStructuralCodec,
  type IfcApiPort,
} from "../../src/ifc/model-export";
import { IfcMissionRoundtripCoordinator } from "../../src/ifc/model-roundtrip";
import { mapMissionToIfcRecords } from "../../src/ifc/robot-tasks";
import { InMemoryRobotMissionRepository } from "../../src/persistence/robot-tasks";

type SupportedSchema = "IFC4" | "IFC4X3" | "IFC4X3_ADD1" | "IFC4X3_ADD2";

const sourceModelId = "replacement-integration-model";
const timestamp = "2026-01-01T00:00:00Z";
const updatedTimestamp = "2026-01-02T00:00:00Z";
const targetGlobalId = "1JYq5jWRT1jBq_L0X1v2w3";
const projectGlobalId = "0JYq5jWRT1jBq_L0X1v2w3";
const unrelatedTaskGlobalId = "2JYq5jWRT1jBq_L0X1v2w3";
const unrelatedPropertySetGlobalId = "3JYq5jWRT1jBq_L0X1v2w3";
const unrelatedRelationGlobalId = "0KYq5jWRT1jBq_L0X1v2w3";

/** Uses web-ifc's CommonJS Node build and its locally installed WASM binary. */
// eslint-disable-next-line global-require
const { IfcAPI: NodeIfcAPI } = require("web-ifc") as typeof import("web-ifc");

const wasmPath = `${path.resolve("node_modules/web-ifc")}${path.sep}`;

/** Source fixture with one building object and an unrelated process/property graph. */
const sourceIfc = (schema: SupportedSchema): Uint8Array =>
  new TextEncoder().encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('replacement-source.ifc','2026-01-01T00:00:00',(),(),$,$,$);
FILE_SCHEMA(('${schema}'));
ENDSEC;
DATA;
#1=IFCPROJECT('${projectGlobalId}',$,'Project',$,$,$,$,$,$);
#2=IFCBUILDINGELEMENTPROXY('${targetGlobalId}',$,'Mission target',$,$,$,$,$,$);
#3=IFCTASK('${unrelatedTaskGlobalId}',$,'Unrelated task',$,'Construction','unrelated-task',$,$,$,.F.,$,$,.USERDEFINED.);
#4=IFCPROPERTYSINGLEVALUE('UnrelatedValue',$,IFCTEXT('keep'),$);
#5=IFCPROPERTYSET('${unrelatedPropertySetGlobalId}',$,'UnrelatedProperties',$,(#4));
#6=IFCRELDEFINESBYPROPERTIES('${unrelatedRelationGlobalId}',$,$,$,(#3),#5);
ENDSEC;
END-ISO-10303-21;`);

const codec = () =>
  new WebIfcStructuralCodec({
    wasmPath,
    wasmAbsolute: true,
    createApi: () => new NodeIfcAPI() as unknown as IfcApiPort,
  });

const importMissions = (bytes: Uint8Array) =>
  new IfcMissionImportService({
    wasmPath,
    wasmAbsolute: true,
    createApi: () => new NodeIfcAPI() as unknown as IfcMissionImportApiPort,
  }).import(bytes, sourceModelId);

const replace = (bytes: Uint8Array, missions: readonly RobotMission[]) =>
  codec().replaceMissionsAndValidate(
    bytes,
    sourceModelId,
    missions,
    missions.map(mapMissionToIfcRecords),
  );

/** Creates a valid task while keeping test scenarios compact and explicit. */
const robotTask = (input: {
  id: string;
  name: string;
  actionType: RobotActionType;
  overrides?: Partial<RobotTask>;
}): RobotTask => ({
  id: input.id,
  name: input.name,
  actionType: input.actionType,
  targetObjects: [{ globalId: targetGlobalId }],
  affectedObjects: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...input.overrides,
});

/** Creates one complete domain aggregate without coupling the fixture to UI state. */
const robotMission = (input: {
  id: string;
  name: string;
  tasks: RobotTask[];
  sequences?: RobotTaskSequence[];
  schedule?: RobotMissionSchedule;
  updatedAt?: string;
}): RobotMission => ({
  id: input.id,
  name: input.name,
  tasks: input.tasks,
  sequences: input.sequences ?? [],
  schedule: input.schedule,
  createdAt: timestamp,
  updatedAt: input.updatedAt ?? timestamp,
});

const initialMissions = (): RobotMission[] => {
  const retainedTask = robotTask({
    id: "task-retained",
    name: "Navigate before edit",
    actionType: "NAVIGATE_TO",
    overrides: {
      properties: {
        targetState: "BEFORE",
        requiredCapability: "navigation",
      },
      time: { scheduleStart: "2026-01-01T08:00", scheduleDuration: "PT1M" },
    },
  });
  const deletedTask = robotTask({
    id: "task-deleted",
    name: "Task removed by authoritative update",
    actionType: "PASS_THROUGH",
  });
  return [
    robotMission({
      id: "mission-retained",
      name: "Mission before edit",
      tasks: [retainedTask, deletedTask],
      sequences: [
        {
          id: "sequence-retained",
          predecessorTaskId: retainedTask.id,
          successorTaskId: deletedTask.id,
          sequenceType: "FINISH_START",
        },
      ],
      schedule: {
        id: "schedule-retained",
        name: "Retained schedule",
        scheduleDuration: "PT2M",
      },
    }),
    robotMission({
      id: "mission-deleted",
      name: "Mission removed by authoritative update",
      tasks: [
        robotTask({
          id: "task-in-deleted-mission",
          name: "Deleted mission task",
          actionType: "NAVIGATE_TO",
        }),
      ],
    }),
  ];
};

const editedMissions = (): RobotMission[] => {
  const addedTask = robotTask({
    id: "task-added",
    name: "New first task",
    actionType: "NAVIGATE_TO",
    overrides: { updatedAt: updatedTimestamp },
  });
  const retainedTask = robotTask({
    id: "task-retained",
    name: "Pass after edit",
    actionType: "PASS_THROUGH",
    overrides: {
      properties: {
        targetState: "AFTER",
        requiredCapability: "passage",
        preconditions: ["path clear"],
        postconditions: ["target passed"],
      },
      time: {
        scheduleStart: "2026-01-02T09:15",
        scheduleDuration: "PT2M",
        actualStart: "2026-01-02T09:16",
        completion: 0.5,
      },
      updatedAt: updatedTimestamp,
    },
  });
  return [
    robotMission({
      id: "mission-retained",
      name: "Mission after edit",
      tasks: [addedTask, retainedTask],
      sequences: [
        {
          id: "sequence-retained",
          predecessorTaskId: addedTask.id,
          successorTaskId: retainedTask.id,
          sequenceType: "START_START",
        },
      ],
      schedule: {
        id: "schedule-retained",
        name: "Retained schedule",
        scheduleDuration: "PT3M",
      },
      updatedAt: updatedTimestamp,
    }),
    robotMission({
      id: "mission-added",
      name: "New mission",
      tasks: [
        robotTask({
          id: "task-in-added-mission",
          name: "New mission task",
          actionType: "NAVIGATE_TO",
          overrides: { updatedAt: updatedTimestamp },
        }),
      ],
      updatedAt: updatedTimestamp,
    }),
  ];
};

const provenanceByIdentity = (
  imported: IfcMissionImportResult,
): Map<string, IfcMissionEntityProvenance> =>
  new Map(
    imported.provenance.entities
      .filter(
        (
          entry,
        ): entry is IfcMissionEntityProvenance & {
          recordIdentity: string;
        } => entry.recordIdentity !== undefined,
      )
      .map((entry) => [entry.recordIdentity, entry]),
  );

const requiredProvenance = (
  imported: IfcMissionImportResult,
  recordIdentity: string,
): IfcMissionEntityProvenance => {
  const entry = provenanceByIdentity(imported).get(recordIdentity);
  assert.ok(entry, `Missing provenance for ${recordIdentity}`);
  return entry;
};

const requiredGlobalId = (
  imported: IfcMissionImportResult,
  recordIdentity: string,
): string => {
  const globalId = requiredProvenance(imported, recordIdentity).globalId;
  assert.ok(globalId, `Missing GlobalId for ${recordIdentity}`);
  return globalId;
};

/** Stable per-type counts for only the graph recognized as application-owned. */
const ownedEntityCounts = (imported: IfcMissionImportResult) =>
  Object.fromEntries(
    [...imported.provenance.entities]
      .reduce((counts, entry) => {
        counts.set(entry.entityType, (counts.get(entry.entityType) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())
      .entries(),
  );

/** Reads every IfcRoot by GlobalId to prove unrelated roots survive replacement. */
const rootFacts = async (
  bytes: Uint8Array,
): Promise<Map<string, { entity: string; name?: string }>> => {
  const api = new NodeIfcAPI();
  api.SetWasmPath(wasmPath, true);
  await api.Init(undefined, true);
  const modelId = api.OpenModel(bytes);
  try {
    const result = new Map<string, { entity: string; name?: string }>();
    const roots = api.GetLineIDsWithType(modelId, IFCROOT, true);
    for (let index = 0; index < roots.size(); index += 1) {
      const expressId = roots.get(index);
      const line = api.GetLine(modelId, expressId, false) as Record<
        string,
        { value?: unknown } | undefined
      >;
      const globalId = String(line.GlobalId?.value ?? "");
      if (!globalId) continue;
      const nameValue = line.Name?.value;
      result.set(globalId, {
        entity: api
          .GetNameFromTypeCode(api.GetLineType(modelId, expressId))
          .toUpperCase(),
        name: typeof nameValue === "string" ? nameValue : undefined,
      });
    }
    return result;
  } finally {
    if (api.IsModelOpen(modelId)) api.CloseModel(modelId);
    api.Dispose();
  }
};

/**
 * Converts a current export into the exact pre-version shape via web-ifc lines.
 *
 * This deliberately exercises supported entity operations instead of altering
 * STEP text: the two new metadata properties are detached/deleted and the
 * sequence Name is cleared before saving the independently parseable fixture.
 */
const createLegacyAnnotation = async (
  bytes: Uint8Array,
  imported: IfcMissionImportResult,
  missionId: string,
  sequenceRecordIdentity: string,
): Promise<Uint8Array> => {
  const api = new NodeIfcAPI();
  api.SetWasmPath(wasmPath, true);
  await api.Init(undefined, true);
  const modelId = api.OpenModel(bytes);
  try {
    const version = requiredProvenance(
      imported,
      `property/RobotMission/${missionId}/AnnotationSchemaVersion`,
    );
    const scheduleMarker = requiredProvenance(
      imported,
      `property/RobotMission/${missionId}/HasExplicitSchedule`,
    );
    const propertySet = api.GetLine(
      modelId,
      requiredProvenance(imported, `property-set/RobotMission/${missionId}`)
        .expressId,
      false,
    ) as IfcLineObject & { HasProperties: Array<{ value: number }> };
    const removedPropertyIds = new Set([
      version.expressId,
      scheduleMarker.expressId,
    ]);
    propertySet.HasProperties = propertySet.HasProperties.filter(
      (reference) => !removedPropertyIds.has(reference.value),
    );
    api.WriteLine(modelId, propertySet);

    const sequence = api.GetLine(
      modelId,
      requiredProvenance(imported, sequenceRecordIdentity).expressId,
      false,
    ) as IfcLineObject & { Name: unknown };
    sequence.Name = null;
    api.WriteLine(modelId, sequence);
    api.DeleteLine(modelId, version.expressId);
    api.DeleteLine(modelId, scheduleMarker.expressId);
    return api.SaveModel(modelId);
  } finally {
    if (api.IsModelOpen(modelId)) api.CloseModel(modelId);
    api.Dispose();
  }
};

test("real IFC4 replacement applies edits, preserves identities, and removes obsolete owned records", async () => {
  const initial = initialMissions();
  const firstExport = await replace(sourceIfc("IFC4"), initial);
  const firstImport = await importMissions(firstExport.bytes);
  assert.equal(
    compareRobotMissionsSemantically(initial, firstImport.missions).equal,
    true,
    JSON.stringify(firstImport.issues),
  );
  assert.equal(
    firstImport.issues.some((entry) => entry.kind === "compatibility"),
    false,
  );

  const edited = editedMissions();
  const secondExport = await replace(firstExport.bytes, edited);
  const secondImport = await importMissions(secondExport.bytes);
  assert.equal(
    compareRobotMissionsSemantically(edited, secondImport.missions).equal,
    true,
    JSON.stringify(secondImport.issues),
  );

  const stableRootIdentities = [
    "mission-task/mission-retained",
    "task/task-retained",
    "property-set/RobotMission/mission-retained",
    "property-set/RobotAction/task-retained",
    "relation/RobotAction/task-retained",
    "relation/targets/task-retained",
    "relation/nests/mission-retained",
    "relation/sequence/sequence-retained",
    "work-schedule/schedule-retained",
    "relation/schedule/mission-retained",
  ];
  for (const identity of stableRootIdentities) {
    assert.equal(
      requiredGlobalId(secondImport, identity),
      requiredGlobalId(firstImport, identity),
      identity,
    );
    assert.notEqual(
      requiredProvenance(secondImport, identity).expressId,
      requiredProvenance(firstImport, identity).expressId,
      `${identity} should receive a fresh express ID`,
    );
  }

  const firstRootGuids = new Set(
    firstImport.provenance.entities
      .map((entry) => entry.globalId)
      .filter((entry): entry is string => entry !== undefined),
  );
  for (const newIdentity of [
    "task/task-added",
    "mission-task/mission-added",
    "task/task-in-added-mission",
  ]) {
    assert.equal(
      firstRootGuids.has(requiredGlobalId(secondImport, newIdentity)),
      false,
      `${newIdentity} must receive a new GlobalId`,
    );
  }

  const secondByIdentity = provenanceByIdentity(secondImport);
  assert.equal(secondByIdentity.has("task/task-deleted"), false);
  assert.equal(secondByIdentity.has("mission-task/mission-deleted"), false);
  assert.equal(
    secondImport.provenance.entities.some(
      (entry) => entry.missionId === "mission-deleted",
    ),
    false,
  );
  const obsoleteGlobalIds = firstImport.provenance.entities
    .filter(
      (entry) =>
        entry.missionId === "mission-deleted" ||
        entry.recordIdentity?.includes("task-deleted"),
    )
    .map((entry) => entry.globalId)
    .filter((entry): entry is string => entry !== undefined);
  const secondRootFacts = await rootFacts(secondExport.bytes);
  obsoleteGlobalIds.forEach((globalId) =>
    assert.equal(secondRootFacts.has(globalId), false, globalId),
  );

  assert.deepEqual(secondRootFacts.get(targetGlobalId), {
    entity: "IFCBUILDINGELEMENTPROXY",
    name: "Mission target",
  });
  assert.deepEqual(secondRootFacts.get(unrelatedTaskGlobalId), {
    entity: "IFCTASK",
    name: "Unrelated task",
  });
  assert.deepEqual(secondRootFacts.get(unrelatedPropertySetGlobalId), {
    entity: "IFCPROPERTYSET",
    name: "UnrelatedProperties",
  });
  assert.equal(secondRootFacts.has(unrelatedRelationGlobalId), true);
  assert.equal(secondRootFacts.has(projectGlobalId), true);

  const thirdExport = await replace(secondExport.bytes, edited);
  const thirdImport = await importMissions(thirdExport.bytes);
  assert.equal(
    compareRobotMissionsSemantically(edited, thirdImport.missions).equal,
    true,
    JSON.stringify(thirdImport.issues),
  );
  assert.deepEqual(
    ownedEntityCounts(thirdImport),
    ownedEntityCounts(secondImport),
  );
  const thirdByIdentity = provenanceByIdentity(thirdImport);
  for (const [identity, secondEntry] of secondByIdentity) {
    if (!secondEntry.globalId) continue;
    assert.equal(thirdByIdentity.get(identity)?.globalId, secondEntry.globalId);
  }
});

test("real UI orchestration survives two load-edit-export-reload cycles without identity drift", async () => {
  const initial = initialMissions();
  const annotated = await replace(sourceIfc("IFC4"), initial);
  const storageSelection: RobotMissionStorageSelection = {
    getMode: () => "none",
    selectMode: () => {},
    isAvailable: () => true,
  };

  const createRoundtrip = (bytes: Uint8Array) => {
    const repository = new InMemoryRobotMissionRepository();
    const sources = new IfcSourceModelRegistry();
    sources.register({
      modelId: sourceModelId,
      fileName: "acceptance.ifc",
      bytes,
    });
    const importer = new IfcMissionImportService({
      wasmPath,
      wasmAbsolute: true,
      createApi: () => new NodeIfcAPI() as unknown as IfcMissionImportApiPort,
    });
    const coordinator = new IfcMissionRoundtripCoordinator({
      repository,
      storageSelection,
      importer,
      exporter: new IfcModelExportService(sources, codec()),
      sources,
    });
    return { coordinator, repository };
  };

  const firstPage = createRoundtrip(annotated.bytes);
  const loaded = await firstPage.coordinator.importLoadedModel(
    sourceModelId,
    "acceptance.ifc",
    annotated.bytes,
  );
  assert.equal(loaded.importedCount, 2);
  const service = new RobotMissionService(firstPage.repository, {
    now: () => updatedTimestamp,
  });
  service.addTask("mission-retained", {
    id: "task-command-added",
    name: "Command-added navigation",
    actionType: "NAVIGATE_TO",
    targetObjects: [
      {
        globalId: targetGlobalId,
        modelId: sourceModelId,
        expressId: 2,
        ifcClass: "IFCBUILDINGELEMENTPROXY",
      },
    ],
  });
  service.updateTask("mission-retained", "task-retained", {
    name: "Command-edited pass",
    actionType: "PASS_THROUGH",
    targetObjects: [],
    affectedObjects: [
      {
        globalId: targetGlobalId,
        modelId: sourceModelId,
        expressId: 2,
        ifcClass: "IFCBUILDINGELEMENTPROXY",
      },
    ],
  });
  service.deleteTask("mission-retained", "task-deleted");
  service.setTaskExecutionOrder("mission-retained", [
    "task-command-added",
    "task-retained",
  ]);
  const edited = service.listMissions();

  const firstCycle = await firstPage.coordinator.exportModel(
    sourceModelId,
    false,
  );
  assert.deepEqual(
    {
      added: firstCycle.addedCount,
      updated: firstCycle.updatedCount,
      removed: firstCycle.removedCount,
    },
    { added: 0, updated: 1, removed: 0 },
  );

  const reloadedPage = createRoundtrip(firstCycle.bytes);
  await reloadedPage.coordinator.importLoadedModel(
    sourceModelId,
    "acceptance.ifc",
    firstCycle.bytes,
  );
  assert.equal(
    compareRobotMissionsSemantically(edited, reloadedPage.repository.list())
      .equal,
    true,
  );
  const firstReload = await importMissions(firstCycle.bytes);

  const secondCycle = await reloadedPage.coordinator.exportModel(
    sourceModelId,
    false,
  );
  assert.deepEqual(
    {
      added: secondCycle.addedCount,
      updated: secondCycle.updatedCount,
      removed: secondCycle.removedCount,
    },
    { added: 0, updated: 0, removed: 0 },
  );
  const secondReload = await importMissions(secondCycle.bytes);
  assert.equal(
    compareRobotMissionsSemantically(edited, secondReload.missions).equal,
    true,
  );
  assert.deepEqual(
    ownedEntityCounts(secondReload),
    ownedEntityCounts(firstReload),
  );
  const firstIdentities = provenanceByIdentity(firstReload);
  for (const [identity, entity] of provenanceByIdentity(secondReload)) {
    if (!entity.globalId) continue;
    assert.equal(
      entity.globalId,
      firstIdentities.get(identity)?.globalId,
      identity,
    );
  }
});

test("real legacy annotations normalize sequence identity and version metadata on replacement", async () => {
  const intended = [initialMissions()[0]];
  const currentExport = await replace(sourceIfc("IFC4"), intended);
  const currentImport = await importMissions(currentExport.bytes);
  const currentSequenceIdentity = "relation/sequence/sequence-retained";
  const legacyBytes = await createLegacyAnnotation(
    currentExport.bytes,
    currentImport,
    intended[0].id,
    currentSequenceIdentity,
  );
  const legacyImport = await importMissions(legacyBytes);

  for (const warningCode of [
    "IFC_ANNOTATION_SCHEMA_VERSION_LEGACY",
    "IFC_SEQUENCE_ID_COMPATIBILITY_FALLBACK",
    "IFC_SCHEDULE_AUTHORED_STATE_UNKNOWN",
  ]) {
    assert.equal(
      legacyImport.issues.some((entry) => entry.code === warningCode),
      true,
      warningCode,
    );
  }
  assert.equal(legacyImport.missions.length, 1);
  const legacyGraph = mapMissionToIfcRecords(legacyImport.missions[0]);
  const migratedSequenceIdentity = legacyGraph.records.find(
    (record) => record.entity === "IfcRelSequence",
  )?.id;
  assert.ok(migratedSequenceIdentity);
  const legacySequenceGlobalId = requiredGlobalId(
    legacyImport,
    migratedSequenceIdentity,
  );

  const normalizedExport = await replace(legacyBytes, legacyImport.missions);
  const normalizedImport = await importMissions(normalizedExport.bytes);
  assert.equal(
    compareRobotMissionsSemantically(
      legacyImport.missions,
      normalizedImport.missions,
    ).equal,
    true,
    JSON.stringify(normalizedImport.issues),
  );
  assert.equal(
    normalizedImport.issues.some((entry) => entry.kind === "compatibility"),
    false,
  );
  assert.equal(
    requiredGlobalId(normalizedImport, migratedSequenceIdentity),
    legacySequenceGlobalId,
  );
  assert.equal(
    requiredGlobalId(
      normalizedImport,
      `property-set/RobotMission/${intended[0].id}`,
    ),
    requiredGlobalId(
      legacyImport,
      `property-set/RobotMission/${intended[0].id}`,
    ),
  );
});

test("real empty authoritative replacement removes every owned graph", async () => {
  const firstExport = await replace(sourceIfc("IFC4"), initialMissions());
  const removed = await replace(firstExport.bytes, []);
  const imported = await importMissions(removed.bytes);

  assert.deepEqual(imported.missions, []);
  assert.deepEqual(imported.provenance.entities, []);
  assert.equal(imported.issues.length, 0);
  const unrelatedRoots = await rootFacts(removed.bytes);
  for (const globalId of [
    projectGlobalId,
    targetGlobalId,
    unrelatedTaskGlobalId,
    unrelatedPropertySetGlobalId,
    unrelatedRelationGlobalId,
  ]) {
    assert.equal(unrelatedRoots.has(globalId), true, globalId);
  }
});

for (const schema of [
  "IFC4",
  "IFC4X3",
  "IFC4X3_ADD1",
  "IFC4X3_ADD2",
] as const) {
  test(`real ${schema} replacement is idempotent after normalization`, async () => {
    const missions = [editedMissions()[0]];
    const firstExport = await replace(sourceIfc(schema), missions);
    const firstImport = await importMissions(firstExport.bytes);
    const secondExport = await replace(firstExport.bytes, missions);
    const secondImport = await importMissions(secondExport.bytes);

    assert.equal(firstExport.schema, schema);
    assert.equal(secondExport.schema, schema);
    assert.equal(
      compareRobotMissionsSemantically(missions, secondImport.missions).equal,
      true,
      JSON.stringify(secondImport.issues),
    );
    assert.deepEqual(
      ownedEntityCounts(secondImport),
      ownedEntityCounts(firstImport),
    );
    const firstByIdentity = provenanceByIdentity(firstImport);
    for (const [identity, secondEntry] of provenanceByIdentity(secondImport)) {
      if (!secondEntry.globalId) continue;
      assert.equal(
        secondEntry.globalId,
        firstByIdentity.get(identity)?.globalId,
      );
    }
  });
}
