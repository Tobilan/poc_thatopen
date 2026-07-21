import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskToMission,
  createRobotMission,
  createRobotTask,
  setMissionTaskExecutionOrder,
} from "../../src/domain/robot-tasks";
import type {
  RobotMission,
  RobotObjectReference,
} from "../../src/domain/robot-tasks";
import {
  IfcRobotTaskMappingError,
  mapMissionToIfcRecords,
} from "../../src/ifc/robot-tasks";
import type {
  IfcRobotMissionRecordGraph,
  IfcRobotTaskRecord,
  IfcPropertyListValueRecord,
  IfcPropertySingleValueRecord,
  IfcTaskRecord,
} from "../../src/ifc/robot-tasks";

/** Fixed timestamp used to keep mapped test aggregates deterministic. */
const timestamp = "2026-01-01T00:00:00.000Z";

/** Door targeted by OPEN and CLOSE interaction tasks. */
const door: RobotObjectReference = {
  globalId: "door-global-id",
  modelId: "building-model",
  expressId: 101,
  ifcClass: "IFCDOOR",
  name: "Entrance door",
};

/** Start object used by MOVE_FROM mapping. */
const startSpace: RobotObjectReference = {
  globalId: "start-space-global-id",
  ifcClass: "IFCSPACE",
  name: "Start space",
};

/** Destination object used by MOVE_TO mapping. */
const targetSpace: RobotObjectReference = {
  globalId: "target-space-global-id",
  ifcClass: "IFCSPACE",
  name: "Destination space",
};

/** Narrows a mapping result to records with one concrete IFC entity discriminator. */
const recordsOf = <Entity extends IfcRobotTaskRecord["entity"]>(
  graph: IfcRobotMissionRecordGraph,
  entity: Entity,
) =>
  graph.records.filter((record) => record.entity === entity) as Array<
    Extract<IfcRobotTaskRecord, { entity: Entity }>
  >;

/** Union of scalar and list records allowed inside a RobotAction property set. */
type IfcActionPropertyRecord =
  | IfcPropertySingleValueRecord
  | IfcPropertyListValueRecord;

/** Finds the generated executable IfcTask for one source domain task ID. */
const taskRecord = (
  graph: IfcRobotMissionRecordGraph,
  sourceTaskId: string,
): IfcTaskRecord => {
  const record = recordsOf(graph, "IfcTask").find(
    (candidate) =>
      candidate.role === "EXECUTABLE_TASK" &&
      candidate.sourceId === sourceTaskId,
  );
  assert.ok(record);
  return record;
};

/** Resolves all RobotAction property records attached to one generated task. */
const actionPropertyRecords = (
  graph: IfcRobotMissionRecordGraph,
  task: IfcTaskRecord,
) => {
  const relation = recordsOf(graph, "IfcRelDefinesByProperties").find(
    (candidate) =>
      candidate.relatedObjects.length === 1 &&
      candidate.relatedObjects[0].id === task.id,
  );
  assert.ok(relation);
  const propertySet = recordsOf(graph, "IfcPropertySet").find(
    (candidate) => candidate.id === relation.relatingPropertyDefinition.id,
  );
  assert.ok(propertySet);
  const propertyIds = new Set(
    propertySet.hasProperties.map((property) => property.id),
  );
  return {
    relation,
    propertySet,
    properties: graph.records.filter(
      (record): record is IfcActionPropertyRecord =>
        (record.entity === "IfcPropertySingleValue" ||
          record.entity === "IfcPropertyListValue") &&
        propertyIds.has(record.id),
    ),
  };
};

/** Creates one valid mission containing OPEN, CLOSE, and MOVE child tasks. */
const createMappedMission = (): RobotMission => {
  const openTask = createRobotTask(
    {
      id: "open-door",
      name: "Open door",
      actionType: "OPEN",
      targetObjects: [door],
      properties: {
        targetState: "OPEN",
        requiredCapability: "door-operation",
        preconditions: ["Robot is at the entrance"],
      },
      time: { scheduleDuration: "PT30S", completion: 0 },
    },
    timestamp,
  );
  const closeTask = createRobotTask(
    {
      id: "close-door",
      name: "Close door",
      actionType: "CLOSE",
      targetObjects: [door],
      properties: { targetState: "CLOSED" },
    },
    timestamp,
  );
  const moveTask = createRobotTask(
    {
      id: "move-between-spaces",
      name: "Move between spaces",
      actionType: "MOVE",
      startReference: startSpace,
      targetReference: targetSpace,
    },
    timestamp,
  );
  let mission = createRobotMission(
    {
      id: "mission-1",
      name: "Door mission",
      status: "planned",
      priority: "high",
      schedule: {
        id: "schedule-1",
        name: "Door mission schedule",
        scheduleStart: "2026-01-01T08:00:00Z",
        scheduleFinish: "2026-01-01T08:30:00Z",
        scheduleDuration: "PT30M",
      },
    },
    timestamp,
  );
  mission = addTaskToMission(mission, openTask, timestamp);
  mission = addTaskToMission(mission, moveTask, timestamp);
  mission = addTaskToMission(mission, closeTask, timestamp);
  return setMissionTaskExecutionOrder(
    mission,
    [openTask.id, moveTask.id, closeTask.id],
    timestamp,
  );
};

/** Verifies OPEN and CLOSE object relations and task-owned action property sets. */
test("OPEN and CLOSE map to interaction relations and task-level RobotAction data", () => {
  const graph = mapMissionToIfcRecords(createMappedMission());

  for (const [sourceTaskId, expectedAction] of [
    ["open-door", "OPEN"],
    ["close-door", "CLOSE"],
  ] as const) {
    const task = taskRecord(graph, sourceTaskId);
    const targetRelation = recordsOf(graph, "IfcRelAssignsToProcess").find(
      (candidate) =>
        candidate.name === "OPERATES_ON" &&
        candidate.relatingProcess.id === task.id,
    );
    assert.ok(targetRelation);
    assert.equal(targetRelation.relatedObjects[0].globalId, door.globalId);

    const action = actionPropertyRecords(graph, task);
    assert.equal(action.propertySet.name, "RobotAction");
    assert.deepEqual(action.relation.relatedObjects, [
      { entity: "IfcTask", id: task.id },
    ]);
    const actionType = action.properties.find(
      (property): property is IfcPropertySingleValueRecord =>
        property.entity === "IfcPropertySingleValue" &&
        property.name === "ActionType",
    );
    assert.ok(actionType);
    assert.equal(actionType.nominalValue, expectedAction);

    if (sourceTaskId === "open-door") {
      const targetState = action.properties.find(
        (property): property is IfcPropertySingleValueRecord =>
          property.entity === "IfcPropertySingleValue" &&
          property.name === "TargetState",
      );
      const preconditions = action.properties.find(
        (property): property is IfcPropertyListValueRecord =>
          property.entity === "IfcPropertyListValue" &&
          property.name === "Preconditions",
      );
      assert.ok(targetState);
      assert.equal(targetState.nominalValue, "OPEN");
      assert.ok(preconditions);
      assert.deepEqual(preconditions.listValues, ["Robot is at the entrance"]);
    }
  }
});

/** Verifies MOVE origin and destination use their distinct IFC relation forms. */
test("MOVE maps MOVE_FROM and MOVE_TO references correctly", () => {
  const graph = mapMissionToIfcRecords(createMappedMission());
  const moveTask = taskRecord(graph, "move-between-spaces");
  const moveFrom = recordsOf(graph, "IfcRelAssignsToProcess").find(
    (record) =>
      record.name === "MOVE_FROM" && record.relatingProcess.id === moveTask.id,
  );
  const moveTo = recordsOf(graph, "IfcRelAssignsToProduct").find((record) =>
    record.relatedObjects.some((task) => task.id === moveTask.id),
  );

  assert.ok(moveFrom);
  assert.equal(moveFrom.relatedObjects[0].globalId, startSpace.globalId);
  assert.ok(moveTo);
  assert.equal(moveTo.name, "MOVE_TO");
  assert.equal(moveTo.relatingProduct.globalId, targetSpace.globalId);
});

/** Verifies mission nesting, task timing, and temporal sequence record creation. */
test("mission hierarchy, task time, and execution sequence map to IFC-like records", () => {
  const graph = mapMissionToIfcRecords(createMappedMission());
  const rootTask = recordsOf(graph, "IfcTask").find(
    (record) => record.role === "MISSION",
  );
  assert.ok(rootTask);
  assert.equal(rootTask.identification, "mission-1");
  assert.equal(rootTask.objectType, "RobotMission");
  assert.equal(rootTask.status, "planned");
  assert.equal(rootTask.priority, 3);

  const nests = recordsOf(graph, "IfcRelNests");
  assert.equal(nests.length, 1);
  assert.equal(nests[0].relatingObject.id, rootTask.id);
  assert.deepEqual(
    nests[0].relatedObjects.map((reference) => reference.id),
    ["open-door", "move-between-spaces", "close-door"].map(
      (taskId) => taskRecord(graph, taskId).id,
    ),
  );

  const sequences = recordsOf(graph, "IfcRelSequence");
  assert.equal(sequences.length, 2);
  assert.ok(
    sequences.every((sequence) => sequence.sequenceType === "FINISH_START"),
  );
  assert.equal(
    sequences[0].relatingProcess.id,
    taskRecord(graph, "open-door").id,
  );
  assert.equal(
    sequences[0].relatedProcess.id,
    taskRecord(graph, "move-between-spaces").id,
  );

  const openTask = taskRecord(graph, "open-door");
  assert.ok(openTask.taskTime);
  const time = recordsOf(graph, "IfcTaskTime").find(
    (record) => record.id === openTask.taskTime?.id,
  );
  assert.ok(time);
  assert.equal(time.scheduleDuration, "PT30S");
  assert.equal(time.completion, 0);

  const schedules = recordsOf(graph, "IfcWorkSchedule");
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].sourceId, "schedule-1");
  assert.equal(schedules[0].startTime, "2026-01-01T08:00:00Z");
  assert.equal(schedules[0].duration, "PT30M");
  const controls = recordsOf(graph, "IfcRelAssignsToControl");
  assert.equal(controls.length, 1);
  assert.deepEqual(controls[0].relatedObjects, [graph.rootTask]);
  assert.equal(controls[0].relatingControl.id, schedules[0].id);
});

/** Verifies application and viewer metadata remains task-owned during mapping. */
test("mission and task metadata map to custom task-owned property sets", () => {
  const graph = mapMissionToIfcRecords(createMappedMission());
  const names = recordsOf(graph, "IfcPropertySet").map(
    (propertySet) => propertySet.name,
  );

  assert.ok(names.includes("RobotMission"));
  assert.ok(names.includes("RobotTask"));
  const metadataNames = new Set(
    recordsOf(graph, "IfcPropertySingleValue").map((record) => record.name),
  );
  assert.ok(metadataNames.has("CreatedAt"));
  assert.ok(metadataNames.has("UpdatedAt"));
  assert.ok(
    recordsOf(graph, "IfcRelDefinesByProperties").every((relation) =>
      relation.relatedObjects.every((object) => object.entity === "IfcTask"),
    ),
  );
});

/** Verifies reserved property names and forbidden object-level action attachment. */
test("custom property sets avoid Pset_ and attach RobotAction only to IfcTask", () => {
  const graph = mapMissionToIfcRecords(createMappedMission());
  const propertySets = recordsOf(graph, "IfcPropertySet");
  assert.ok(propertySets.length > 0);
  assert.ok(
    propertySets.every((propertySet) => !propertySet.name.startsWith("Pset_")),
  );

  for (const relation of recordsOf(graph, "IfcRelDefinesByProperties")) {
    assert.ok(
      relation.relatedObjects.every(
        (relatedObject) => relatedObject.entity === "IfcTask",
      ),
    );
  }
  for (const objectRelation of recordsOf(graph, "IfcRelAssignsToProcess")) {
    assert.ok(
      objectRelation.relatedObjects.every(
        (relatedObject) => relatedObject.kind === "IfcObjectReference",
      ),
    );
  }
});

/** Verifies invalid cyclic domain data is rejected before record creation. */
test("mapper rejects cyclic task sequences", () => {
  const mission = createMappedMission();
  const cyclicMission: RobotMission = {
    ...mission,
    sequences: [
      ...mission.sequences,
      {
        id: "close-before-open",
        predecessorTaskId: "close-door",
        successorTaskId: "open-door",
        sequenceType: "FINISH_START",
      },
    ],
  };

  assert.throws(
    () => mapMissionToIfcRecords(cyclicMission),
    IfcRobotTaskMappingError,
  );
});
