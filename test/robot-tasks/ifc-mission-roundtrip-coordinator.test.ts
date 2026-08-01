/* eslint-disable max-classes-per-file -- focused stateful port fakes remain local to this orchestration suite */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  RobotMissionRepository,
  RobotMissionStorageMode,
  RobotMissionStorageSelection,
} from "../../src/application/robot-tasks";
import {
  addTaskToMission,
  createRobotMission,
  createRobotTask,
  type RobotMission,
} from "../../src/domain/robot-tasks";
import { IfcSourceModelRegistry } from "../../src/ifc/model-export";
import type { IfcMissionImportResult } from "../../src/ifc/model-import";
import {
  IfcMissionRoundtripCoordinator,
  IfcMissionRoundtripError,
  importLoadedModelMissions,
  type IfcMissionExporter,
  type IfcMissionImporter,
} from "../../src/ifc/model-roundtrip";
import { InMemoryRobotMissionRepository } from "../../src/persistence/robot-tasks";

const timestamp = "2026-01-01T00:00:00Z";

const mission = (id: string, modelId: string): RobotMission =>
  addTaskToMission(
    createRobotMission({ id, name: `Mission ${id}` }, timestamp),
    createRobotTask(
      {
        id: `task-${id}`,
        name: `Task ${id}`,
        actionType: "NAVIGATE_TO",
        targetObjects: [
          {
            globalId: `global-${id}`,
            modelId,
            expressId: 2,
            ifcClass: "IFCBUILDINGELEMENTPROXY",
          },
        ],
      },
      timestamp,
    ),
    timestamp,
  );

const importResult = (
  modelId: string,
  missions: readonly RobotMission[],
  issues: IfcMissionImportResult["issues"] = [],
): IfcMissionImportResult => ({
  missions: [...missions],
  issues,
  schema: "IFC4",
  provenance: { sourceModelId: modelId, entities: [] },
});

class StorageSelection implements RobotMissionStorageSelection {
  constructor(private mode: RobotMissionStorageMode = "none") {}

  getMode(): RobotMissionStorageMode {
    return this.mode;
  }

  selectMode(mode: RobotMissionStorageMode): void {
    this.mode = mode;
  }

  isAvailable(mode: RobotMissionStorageMode): boolean {
    return mode !== "backend";
  }
}

class ScriptedImporter implements IfcMissionImporter {
  callCount = 0;

  constructor(private readonly results: IfcMissionImportResult[]) {}

  async import(): Promise<IfcMissionImportResult> {
    this.callCount += 1;
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected import call.");
    return result;
  }
}

class RecordingExporter implements IfcMissionExporter {
  readonly calls: Array<{
    modelId: string;
    missions: readonly RobotMission[] | undefined;
  }> = [];

  async exportModel(
    modelId: string,
    options: Parameters<IfcMissionExporter["exportModel"]>[1],
  ) {
    const normalized =
      typeof options === "boolean" || options === undefined ? {} : options;
    this.calls.push({ modelId, missions: normalized.missions });
    return {
      fileName: `${modelId}-export.ifc`,
      bytes: new Uint8Array([9, 9, 9]),
      schema: "IFC4",
      missionCount: normalized.missions?.length ?? 0,
    };
  }
}

const fixture = (
  results: IfcMissionImportResult[],
  repository: RobotMissionRepository = new InMemoryRobotMissionRepository(),
  selection = new StorageSelection(),
) => {
  const sources = new IfcSourceModelRegistry();
  const exporter = new RecordingExporter();
  const coordinator = new IfcMissionRoundtripCoordinator({
    repository,
    storageSelection: selection,
    importer: new ScriptedImporter(results),
    exporter,
    sources,
  });
  return { coordinator, exporter, repository, selection, sources };
};

test("pure Fragments models do not invoke the IFC mission importer", async () => {
  const importer = new ScriptedImporter([]);
  const sources = new IfcSourceModelRegistry();
  const coordinator = new IfcMissionRoundtripCoordinator({
    repository: new InMemoryRobotMissionRepository(),
    storageSelection: new StorageSelection(),
    importer,
    exporter: new RecordingExporter(),
    sources,
  });

  const result = await importLoadedModelMissions(
    coordinator,
    "fragments",
    "fragment-model",
    "model.frag",
    new Uint8Array([1]),
  );

  assert.equal(result, undefined);
  assert.equal(importer.callCount, 0);
  assert.equal(coordinator.missionSources.get("fragment-model"), undefined);
});

test("direct IFC import upserts valid missions and leaves unrelated missions intact", async () => {
  const imported = mission("owned", "model-a");
  const unrelated = mission("unrelated", "elsewhere");
  const existing = { ...imported, name: "Old name" };
  const setup = fixture([importResult("model-a", [imported])]);
  setup.repository.save(unrelated);
  setup.repository.save(existing);

  const summary = await setup.coordinator.importLoadedModel(
    "model-a",
    "a.ifc",
    new Uint8Array([1]),
  );

  assert.equal(summary.importedCount, 0);
  assert.equal(summary.replacedCount, 1);
  assert.deepEqual(setup.repository.get("owned"), imported);
  assert.deepEqual(setup.repository.get("unrelated"), unrelated);
  assert.equal(setup.repository.get("owned")?.createdAt, timestamp);
});

test("IFC without annotations is a normal load and does not clear missions", async () => {
  const unrelated = mission("unrelated", "model-a");
  const setup = fixture([importResult("model-a", [])]);
  setup.repository.save(unrelated);

  const summary = await setup.coordinator.importLoadedModel(
    "model-a",
    "a.ifc",
    new Uint8Array([1]),
  );

  assert.equal(summary.importedCount, 0);
  assert.equal(summary.errorCount, 0);
  assert.deepEqual(setup.repository.list(), [unrelated]);
});

test("malformed independent graph permits explicit partial import but blocks export", async () => {
  const valid = mission("valid", "model-a");
  const issue: IfcMissionImportResult["issues"][number] = {
    code: "DUPLICATE_TASK_ID",
    severity: "error",
    kind: "malformed-ifc-graph",
    missionId: "broken",
    message: "Broken mission graph.",
  };
  const setup = fixture([importResult("model-a", [valid], [issue])]);
  setup.sources.register({
    modelId: "model-a",
    fileName: "a.ifc",
    bytes: new Uint8Array([1]),
  });

  const summary = await setup.coordinator.importLoadedModel(
    "model-a",
    "a.ifc",
    new Uint8Array([1]),
  );

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.unsafeForExport, true);
  assert.deepEqual(setup.repository.get("valid"), valid);
  await assert.rejects(
    setup.coordinator.exportModel("model-a", false),
    (error: unknown) =>
      error instanceof IfcMissionRoundtripError &&
      error.code === "MISSION_SOURCE_UNSAFE",
  );
  assert.equal(setup.exporter.calls.length, 0);
});

test("selected source scopes missions and advances verified source bytes", async () => {
  const missionA = mission("a", "model-a");
  const missionB = mission("b", "model-b");
  const setup = fixture([
    importResult("model-a", [missionA]),
    importResult("model-b", [missionB]),
    importResult("model-a", [missionA]),
  ]);
  setup.sources.register({
    modelId: "model-a",
    fileName: "a.ifc",
    bytes: new Uint8Array([1]),
  });
  setup.sources.register({
    modelId: "model-b",
    fileName: "b.ifc",
    bytes: new Uint8Array([2]),
  });
  await setup.coordinator.importLoadedModel(
    "model-a",
    "a.ifc",
    new Uint8Array([1]),
  );
  await setup.coordinator.importLoadedModel(
    "model-b",
    "b.ifc",
    new Uint8Array([2]),
  );

  const summary = await setup.coordinator.exportModel("model-a", false);

  assert.deepEqual(
    setup.exporter.calls[0].missions?.map((candidate) => candidate.id),
    ["a"],
  );
  assert.equal(summary.addedCount, 0);
  assert.equal(summary.updatedCount, 0);
  assert.equal(summary.removedCount, 0);
  assert.deepEqual(
    setup.sources.get("model-a")?.bytes,
    new Uint8Array([9, 9, 9]),
  );
});

test("unavailable active storage reports an error without switching modes", async () => {
  const selection = new StorageSelection("backend");
  const setup = fixture(
    [importResult("model-a", [mission("a", "model-a")])],
    new InMemoryRobotMissionRepository(),
    selection,
  );

  await assert.rejects(
    setup.coordinator.importLoadedModel(
      "model-a",
      "a.ifc",
      new Uint8Array([1]),
    ),
    (error: unknown) =>
      error instanceof IfcMissionRoundtripError &&
      error.code === "MISSION_STORAGE_UNAVAILABLE",
  );
  assert.equal(selection.getMode(), "backend");
  assert.equal(setup.repository.list().length, 0);
  assert.equal(
    setup.coordinator.missionSources.get("model-a")?.unsafeForExport,
    true,
  );
});

test("removing a model clears roundtrip provenance without deleting missions", async () => {
  const owned = mission("owned", "model-a");
  const setup = fixture([importResult("model-a", [owned])]);
  await setup.coordinator.importLoadedModel(
    "model-a",
    "a.ifc",
    new Uint8Array([1]),
  );

  setup.coordinator.unregisterModel("model-a");

  assert.equal(setup.coordinator.missionSources.get("model-a"), undefined);
  assert.deepEqual(setup.repository.get("owned"), owned);
});
