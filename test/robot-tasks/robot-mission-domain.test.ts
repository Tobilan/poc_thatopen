import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskSequence,
  addTaskToMission,
  assignAffectedObject,
  assignMovementReferences,
  assignRobotActionProperties,
  assignTaskTime,
  assignTargetObject,
  createRobotMission,
  createRobotTask,
  createTaskSequence,
  getTasksInExecutionOrder,
  setMissionTaskExecutionOrder,
  validateMission,
  validateMovementTask,
  validateObjectInteractionTask,
  validateTask,
  validateTaskSequence,
} from "../../src/domain/robot-tasks";
import type {
  RobotObjectReference,
  RobotMission,
  RobotTask,
} from "../../src/domain/robot-tasks/types";

/** Fixed timestamp that makes every builder result deterministic in these tests. */
const timestamp = "2026-01-01T00:00:00.000Z";

/** Door reference used to verify valid door operations and target assignment. */
const door: RobotObjectReference = {
  globalId: "door-global-id",
  ifcClass: "IFCDOOR",
};

/** Switch reference used as an indirectly affected object in the valid mission. */
const switchDevice: RobotObjectReference = {
  globalId: "switch-global-id",
  ifcClass: "IFCSWITCHINGDEVICE",
};

/** Origin reference used to verify the required MOVE start reference. */
const startSpace: RobotObjectReference = {
  globalId: "space-start-global-id",
  ifcClass: "IFCSPACE",
};

/** Destination reference used to verify the required MOVE target reference. */
const targetSpace: RobotObjectReference = {
  globalId: "space-target-global-id",
  ifcClass: "IFCSPACE",
};

/**
 * Extracts only blocking validation codes from a task.
 *
 * Tests use this helper when they care about a concrete failed validation rule
 * rather than non-blocking warnings or the complete issue objects.
 *
 * @param task Task whose validation errors should be reduced to their codes.
 * @returns Machine-readable codes for all validation issues with error severity.
 */
const errorCodes = (task: RobotTask) =>
  validateTask(task)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);

/** Verifies the complete happy path from task builders to mission validation. */
test("builders create a valid mission with executable tasks and a sequence", () => {
  let openDoorTask = createRobotTask(
    {
      id: "open-door",
      name: "Open the door",
      actionType: "OPEN",
    },
    timestamp,
  );
  openDoorTask = assignTargetObject(openDoorTask, door, timestamp);
  openDoorTask = assignAffectedObject(openDoorTask, switchDevice, timestamp);
  openDoorTask = assignRobotActionProperties(
    openDoorTask,
    { targetState: "OPEN", requiredCapability: "door-operation" },
    timestamp,
  );
  openDoorTask = assignTaskTime(
    openDoorTask,
    { scheduleDuration: "PT30S", completion: 0 },
    timestamp,
  );

  let moveTask = createRobotTask(
    {
      id: "move-to-space",
      name: "Move to target space",
      actionType: "MOVE",
    },
    timestamp,
  );
  moveTask = assignMovementReferences(
    moveTask,
    startSpace,
    targetSpace,
    timestamp,
  );

  let mission = createRobotMission(
    { id: "mission-1", name: "Open and move" },
    timestamp,
  );
  mission = addTaskToMission(mission, openDoorTask, timestamp);
  mission = addTaskToMission(mission, moveTask, timestamp);
  mission = addTaskSequence(
    mission,
    createTaskSequence({
      id: "open-before-move",
      predecessorTaskId: openDoorTask.id,
      successorTaskId: moveTask.id,
    }),
    timestamp,
  );

  assert.equal(mission.tasks.length, 2);
  assert.equal(mission.sequences.length, 1);
  assert.equal(mission.tasks[0].properties?.targetState, "OPEN");
  assert.equal(mission.tasks[0].time?.scheduleDuration, "PT30S");
  assert.deepEqual(validateMission(mission), []);
});

/** Verifies that an empty mission cannot be considered executable. */
test("validation reports missions without executable tasks", () => {
  const mission = createRobotMission(
    { id: "empty-mission", name: "Empty mission" },
    timestamp,
  );

  assert.ok(
    validateMission(mission).some(
      (issue) => issue.code === "MISSION_TASK_REQUIRED",
    ),
  );
});

/** Verifies runtime validation for imported data that bypasses builder checks. */
test("validation reports missing mission identifiers in malformed data", () => {
  const missionWithoutIdentity = {
    ...createRobotMission({ id: "valid-id", name: "Valid name" }, timestamp),
    id: "",
    name: "",
  } as RobotMission;

  const codes = validateMission(missionWithoutIdentity).map(
    (issue) => issue.code,
  );
  assert.ok(codes.includes("MISSION_ID_REQUIRED"));
  assert.ok(codes.includes("MISSION_NAME_REQUIRED"));
});

/** Verifies that every executable task requires a supported action type. */
test("validation reports a missing actionType in malformed imported data", () => {
  const taskWithoutAction = {
    ...createRobotTask(
      { id: "invalid-action", name: "Invalid action", actionType: "OPEN" },
      timestamp,
    ),
    actionType: undefined,
  } as unknown as RobotTask;

  assert.ok(
    errorCodes(taskWithoutAction).includes("TASK_ACTION_TYPE_REQUIRED"),
  );
});

/** Verifies that direct object interactions cannot omit their target objects. */
test("object interaction validation requires targets for door and switch actions", () => {
  const openWithoutTarget = createRobotTask(
    { id: "open-without-target", name: "Open", actionType: "OPEN" },
    timestamp,
  );
  const switchWithoutTarget = createRobotTask(
    { id: "switch-without-target", name: "Switch", actionType: "SWITCH_ON" },
    timestamp,
  );

  assert.ok(
    validateObjectInteractionTask(openWithoutTarget).some(
      (issue) => issue.code === "TASK_TARGET_REQUIRED",
    ),
  );
  assert.ok(
    validateObjectInteractionTask(switchWithoutTarget).some(
      (issue) => issue.code === "TASK_TARGET_REQUIRED",
    ),
  );
});

/** Verifies that a MOVE task cannot omit its destination reference. */
test("movement validation requires both movement references", () => {
  const incompleteMove = createRobotTask(
    {
      id: "incomplete-move",
      name: "Incomplete move",
      actionType: "MOVE",
      startReference: startSpace,
    },
    timestamp,
  );

  assert.deepEqual(
    validateMovementTask(incompleteMove).map((issue) => issue.code),
    ["MOVE_TARGET_REQUIRED"],
  );
});

/** Verifies that passing through a building element requires a model reference. */
test("PASS_THROUGH requires at least one object reference", () => {
  const passThrough = createRobotTask(
    {
      id: "pass-through-without-reference",
      name: "Pass through",
      actionType: "PASS_THROUGH",
    },
    timestamp,
  );

  assert.ok(
    errorCodes(passThrough).includes("PASS_THROUGH_REFERENCE_REQUIRED"),
  );
});

/** Verifies that task-only action properties cannot be placed on IFC references. */
test("validation rejects out-of-range completion and action properties on objects", () => {
  const referenceWithActionProperties = {
    globalId: "invalid-door-global-id",
    ifcClass: "IFCDOOR",
    properties: { targetState: "OPEN" },
  } as unknown as RobotObjectReference;
  const invalidTask = createRobotTask(
    {
      id: "invalid-properties",
      name: "Invalid properties",
      actionType: "OPEN",
      targetObjects: [referenceWithActionProperties],
      time: { completion: 1.1 },
    },
    timestamp,
  );

  assert.deepEqual(errorCodes(invalidTask).sort(), [
    "OBJECT_ACTION_PROPERTIES_FORBIDDEN",
    "TASK_COMPLETION_OUT_OF_RANGE",
  ]);
});

/** Verifies that dependency cycles are detected before a mission is executed. */
test("sequence validation detects dependency cycles", () => {
  const firstTask = createRobotTask(
    {
      id: "first",
      name: "First",
      actionType: "NAVIGATE_TO",
      targetObjects: [startSpace],
    },
    timestamp,
  );
  const secondTask = createRobotTask(
    {
      id: "second",
      name: "Second",
      actionType: "NAVIGATE_TO",
      targetObjects: [targetSpace],
    },
    timestamp,
  );
  const sequences = [
    createTaskSequence({
      id: "first-to-second",
      predecessorTaskId: firstTask.id,
      successorTaskId: secondTask.id,
    }),
    createTaskSequence({
      id: "second-to-first",
      predecessorTaskId: secondTask.id,
      successorTaskId: firstTask.id,
    }),
  ];

  assert.ok(
    validateTaskSequence([firstTask, secondTask], sequences).some(
      (issue) => issue.code === "SEQUENCE_CYCLE",
    ),
  );
});

/** Verifies that a persisted linear order creates deterministic FINISH_START edges. */
test("execution ordering reorders nested tasks and replaces the sequence chain", () => {
  const first = createRobotTask(
    {
      id: "first",
      name: "First",
      actionType: "NAVIGATE_TO",
      targetObjects: [startSpace],
    },
    timestamp,
  );
  const second = createRobotTask(
    {
      id: "second",
      name: "Second",
      actionType: "NAVIGATE_TO",
      targetObjects: [targetSpace],
    },
    timestamp,
  );
  const third = createRobotTask(
    {
      id: "third",
      name: "Third",
      actionType: "PASS_THROUGH",
      targetObjects: [door],
    },
    timestamp,
  );
  let mission = createRobotMission(
    { id: "ordered-mission", name: "Ordered mission" },
    timestamp,
  );
  mission = addTaskToMission(mission, first, timestamp);
  mission = addTaskToMission(mission, second, timestamp);
  mission = addTaskToMission(mission, third, timestamp);

  const reorderedMission = setMissionTaskExecutionOrder(
    mission,
    [third.id, first.id, second.id],
    timestamp,
  );

  assert.deepEqual(
    reorderedMission.tasks.map((task) => task.id),
    ["third", "first", "second"],
  );
  assert.deepEqual(reorderedMission.sequences, [
    {
      id: "execution-order-1",
      predecessorTaskId: "third",
      successorTaskId: "first",
      sequenceType: "FINISH_START",
    },
    {
      id: "execution-order-2",
      predecessorTaskId: "first",
      successorTaskId: "second",
      sequenceType: "FINISH_START",
    },
  ]);
  assert.deepEqual(
    getTasksInExecutionOrder(
      reorderedMission.tasks,
      reorderedMission.sequences,
    ).map((task) => task.id),
    ["third", "first", "second"],
  );
  assert.deepEqual(
    validateTaskSequence(reorderedMission.tasks, reorderedMission.sequences),
    [],
  );
});
