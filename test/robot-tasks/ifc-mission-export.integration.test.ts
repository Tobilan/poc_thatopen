import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { IFCTASK } from "web-ifc";
import {
  addTaskSequence,
  addTaskToMission,
  createRobotMission,
  createRobotTask,
} from "../../src/domain/robot-tasks";
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
