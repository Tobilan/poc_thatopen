import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { IFCTASK } from "web-ifc";
import {
  addTaskSequence,
  addTaskToMission,
  createRobotMission,
  createRobotTask,
  type RobotMission,
} from "../../src/domain/robot-tasks";
import {
  IfcMissionImportService,
  type IfcMissionImportApiPort,
} from "../../src/ifc/model-import";
import {
  WebIfcStructuralCodec,
  type IfcApiPort,
} from "../../src/ifc/model-export";
import { mapMissionToIfcRecords } from "../../src/ifc/robot-tasks";

/** Stable GlobalId of the existing source object referenced by the mission. */
const targetGlobalId = "1JYq5jWRT1jBq_L0X1v2w3";

/** Uses web-ifc's CommonJS Node build, which loads web-ifc-node.wasm locally. */
// eslint-disable-next-line global-require
const { IfcAPI: NodeIfcAPI } = require("web-ifc") as typeof import("web-ifc");

/** Produces a tiny source IFC that still contains a project and target product. */
const sourceIfc = (
  schema: "IFC4" | "IFC4X3" | "IFC4X3_ADD1" | "IFC4X3_ADD2",
): Uint8Array =>
  new TextEncoder().encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('minimal.ifc','2026-01-01T00:00:00',(),(),$,$,$);
FILE_SCHEMA(('${schema}'));
ENDSEC;
DATA;
#1=IFCPROJECT('0JYq5jWRT1jBq_L0X1v2w3',$,'Project',$,$,$,$,$,$);
#2=IFCBUILDINGELEMENTPROXY('${targetGlobalId}',$,'Mission target',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;`);

/** Builds a graph with task time, schedule, metadata, and a source assignment. */
const missionGraph = (suffix = "") => {
  const timestamp = "2026-01-01T00:00:00Z";
  const mission = createRobotMission(
    {
      id: `mission-integration${suffix}`,
      name: `Integration mission${suffix}`,
      schedule: {
        id: `schedule-integration${suffix}`,
        name: `Integration schedule${suffix}`,
        scheduleDuration: "PT10M",
      },
    },
    timestamp,
  );
  const task = createRobotTask(
    {
      id: `navigate-integration${suffix}`,
      name: "Navigate to target",
      actionType: "NAVIGATE_TO",
      targetObjects: [
        {
          globalId: targetGlobalId,
          modelId: "direct-ifc-model",
          expressId: 2,
          ifcClass: "IFCBUILDINGELEMENTPROXY",
        },
      ],
      time: {
        scheduleStart: "2026-01-01T08:30",
        scheduleDuration: "PT10M",
        completion: 0,
      },
      viewpoint: {
        cameraPosition: [1, 2, 3],
        cameraTarget: [4, 5, 6],
      },
      markerPosition: [7, 8, 9],
    },
    timestamp,
  );
  const passThroughTask = createRobotTask(
    {
      id: `pass-through-integration${suffix}`,
      name: "Pass through target",
      actionType: "PASS_THROUGH",
      affectedObjects: [
        {
          globalId: targetGlobalId,
          modelId: "direct-ifc-model",
          expressId: 2,
          ifcClass: "IFCBUILDINGELEMENTPROXY",
        },
      ],
    },
    timestamp,
  );
  const missionWithTasks = addTaskToMission(
    addTaskToMission(mission, task, timestamp),
    passThroughTask,
    timestamp,
  );
  return mapMissionToIfcRecords(
    addTaskSequence(
      missionWithTasks,
      {
        id: `navigate-before-pass-through${suffix}`,
        predecessorTaskId: task.id,
        successorTaskId: passThroughTask.id,
        sequenceType: "FINISH_START",
      },
      timestamp,
    ),
  );
};

/** Compares only domain semantics, allowing IFC lexical canonicalization. */
const semanticMission = (mission: RobotMission) => ({
  id: mission.id,
  name: mission.name,
  tasks: mission.tasks.map((task) => ({
    id: task.id,
    name: task.name,
    actionType: task.actionType,
    targets: task.targetObjects.map((reference) => reference.globalId),
    affected: task.affectedObjects.map((reference) => reference.globalId),
    time: task.time,
    viewpoint: task.viewpoint,
    markerPosition: task.markerPosition,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })),
  sequences: mission.sequences.map((sequence) => ({
    predecessorTaskId: sequence.predecessorTaskId,
    successorTaskId: sequence.successorTaskId,
    sequenceType: sequence.sequenceType,
  })),
  schedule: mission.schedule,
  createdAt: mission.createdAt,
  updatedAt: mission.updatedAt,
});

/** Opens result bytes independently to assert original and generated entities. */
const inspectResult = async (
  bytes: Uint8Array,
  expectedSchema: string,
  expectedTaskCount = 3,
): Promise<void> => {
  const api = new NodeIfcAPI();
  api.SetWasmPath(`${path.resolve("node_modules/web-ifc")}${path.sep}`, true);
  await api.Init(undefined, true);
  const modelId = api.OpenModel(bytes);
  try {
    assert.equal(api.IsModelOpen(modelId), true);
    assert.equal(api.GetModelSchema(modelId), expectedSchema);
    assert.ok(api.GetLine(modelId, 1, false));
    assert.ok(api.GetLine(modelId, 2, false));
    assert.equal(
      api.GetLineIDsWithType(modelId, IFCTASK).size(),
      expectedTaskCount,
    );
  } finally {
    if (api.IsModelOpen(modelId)) api.CloseModel(modelId);
    api.Dispose();
  }
};

for (const schema of [
  "IFC4",
  "IFC4X3",
  "IFC4X3_ADD1",
  "IFC4X3_ADD2",
] as const) {
  test(`mission graph survives a real web-ifc ${schema} write and reopen`, async () => {
    const codec = new WebIfcStructuralCodec({
      wasmPath: `${path.resolve("node_modules/web-ifc")}${path.sep}`,
      wasmAbsolute: true,
      createApi: () => new NodeIfcAPI() as unknown as IfcApiPort,
    });

    const result = await codec.writeMissionsAndValidate(
      sourceIfc(schema),
      "direct-ifc-model",
      [missionGraph()],
    );

    assert.equal(result.schema, schema);
    assert.ok(result.bytes.byteLength > sourceIfc(schema).byteLength);
    await inspectResult(result.bytes, schema);
  });
}

test("multiple mission graphs survive one real web-ifc export", async () => {
  const codec = new WebIfcStructuralCodec({
    wasmPath: `${path.resolve("node_modules/web-ifc")}${path.sep}`,
    wasmAbsolute: true,
    createApi: () => new NodeIfcAPI() as unknown as IfcApiPort,
  });

  const result = await codec.writeMissionsAndValidate(
    sourceIfc("IFC4"),
    "direct-ifc-model",
    [missionGraph("-one"), missionGraph("-two")],
  );

  await inspectResult(result.bytes, "IFC4", 6);
});

test("domain mission survives existing writer and new real web-ifc importer semantically", async () => {
  const wasmPath = `${path.resolve("node_modules/web-ifc")}${path.sep}`;
  const codec = new WebIfcStructuralCodec({
    wasmPath,
    wasmAbsolute: true,
    createApi: () => new NodeIfcAPI() as unknown as IfcApiPort,
  });
  const graph = missionGraph("-roundtrip");
  const exported = await codec.writeMissionsAndValidate(
    sourceIfc("IFC4"),
    "direct-ifc-model",
    [graph],
  );
  const imported = await new IfcMissionImportService({
    wasmPath,
    wasmAbsolute: true,
    createApi: () => new NodeIfcAPI() as unknown as IfcMissionImportApiPort,
  }).import(exported.bytes, "direct-ifc-model");

  assert.equal(imported.missions.length, 1, JSON.stringify(imported.issues));
  assert.deepEqual(semanticMission(imported.missions[0]), {
    id: "mission-integration-roundtrip",
    name: "Integration mission-roundtrip",
    tasks: [
      {
        id: "navigate-integration-roundtrip",
        name: "Navigate to target",
        actionType: "NAVIGATE_TO",
        targets: [targetGlobalId],
        affected: [],
        time: {
          scheduleStart: "2026-01-01T08:30:00",
          scheduleFinish: undefined,
          scheduleDuration: "PT10M",
          actualStart: undefined,
          actualFinish: undefined,
          remainingTime: undefined,
          completion: undefined,
        },
        viewpoint: { cameraPosition: [1, 2, 3], cameraTarget: [4, 5, 6] },
        markerPosition: [7, 8, 9],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "pass-through-integration-roundtrip",
        name: "Pass through target",
        actionType: "PASS_THROUGH",
        targets: [],
        affected: [targetGlobalId],
        time: undefined,
        viewpoint: undefined,
        markerPosition: undefined,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    sequences: [
      {
        predecessorTaskId: "navigate-integration-roundtrip",
        successorTaskId: "pass-through-integration-roundtrip",
        sequenceType: "FINISH_START",
      },
    ],
    schedule: {
      id: "schedule-integration-roundtrip",
      name: "Integration schedule-roundtrip",
      scheduleStart: "2026-01-01T00:00:00Z",
      scheduleFinish: undefined,
      scheduleDuration: "PT10M",
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(
    imported.issues.some(
      (entry) => entry.code === "IFC_SEQUENCE_ID_COMPATIBILITY_FALLBACK",
    ),
    false,
  );
  assert.equal(
    imported.issues.some(
      (entry) => entry.code === "IFC_SCHEDULE_AUTHORED_STATE_UNKNOWN",
    ),
    false,
  );
  assert.ok(imported.provenance.entities.length > 10);
});
