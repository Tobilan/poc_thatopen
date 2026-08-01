import assert from "node:assert/strict";
import test from "node:test";
import {
  areRobotMissionsSemanticallyEqual,
  canonicalizeRobotMission,
  canonicalizeRobotMissions,
  compareRobotMissionsSemantically,
} from "../../src/application/robot-tasks";
import type {
  RobotMission,
  RobotObjectReference,
  RobotTask,
} from "../../src/domain/robot-tasks";

/** Returns a complete task that exercises every IFC-serialized domain field. */
const completeTask = (): RobotTask => ({
  id: "task-a",
  name: "Move between doors",
  description: "Use the accessible route",
  actionType: "MOVE",
  status: "in_progress",
  priority: "critical",
  targetObjects: [
    { globalId: "door-b" },
    { globalId: "door-a", name: "Original display name" },
  ],
  affectedObjects: [{ globalId: "light-a" }],
  startReference: { globalId: "door-a" },
  targetReference: { globalId: "door-b" },
  properties: {
    targetState: "ARRIVED",
    targetObjectRole: "DESTINATION",
    affectedObjectRole: "ILLUMINATED_ROUTE",
    requiredCapability: "NAVIGATION",
    preconditions: ["Door A is open", "Route is clear"],
    postconditions: ["Robot is at Door B"],
    successCondition: "Pose reached",
  },
  time: {
    scheduleStart: "2026-01-01T08:31",
    scheduleFinish: "2026-01-01T08:32Z",
    scheduleDuration: "PT1M",
    actualStart: "2026-01-01T08:31+01:00",
    actualFinish: "2026-01-01T08:32+01:00",
    remainingTime: "PT30S",
    completion: 0,
  },
  viewpoint: {
    cameraPosition: [1, 2, 3],
    cameraTarget: [4, 5, 6],
  },
  markerPosition: [7, 8, 9],
  createdAt: "2026-01-01T08:30",
  updatedAt: "2026-01-01T08:31Z",
});

/** Creates a smaller task used to make hierarchy and dependency order visible. */
const namedTask = (id: string): RobotTask => ({
  id,
  name: id,
  actionType: "NAVIGATE_TO",
  status: "planned",
  priority: "medium",
  targetObjects: [{ globalId: `${id}-target` }],
  affectedObjects: [],
  createdAt: "2026-01-01T08:30:00",
  updatedAt: "2026-01-01T08:30:00",
});

/** Builds a mission whose relation order is intentionally not lexical. */
const completeMission = (id = "mission-b"): RobotMission => ({
  id,
  name: `Mission ${id}`,
  description: "Roundtrip comparison fixture",
  status: "open",
  priority: "high",
  tasks: [completeTask(), namedTask("task-b"), namedTask("task-c")],
  sequences: [
    {
      id: "sequence-b",
      predecessorTaskId: "task-b",
      successorTaskId: "task-c",
      sequenceType: "START_START",
    },
    {
      id: "sequence-a",
      predecessorTaskId: "task-a",
      successorTaskId: "task-b",
      sequenceType: "FINISH_START",
    },
  ],
  schedule: {
    id: `schedule-${id}`,
    name: `Schedule ${id}`,
    scheduleFinish: "2026-01-01T09:00",
    scheduleDuration: "PT30M",
  },
  createdAt: "2026-01-01T08:30",
  updatedAt: "2026-01-01T08:31Z",
});

/** Deeply copies the typed aggregate so tests can mutate independent variants. */
const copyMission = (mission: RobotMission): RobotMission => ({
  ...mission,
  tasks: mission.tasks.map((task) => ({
    ...task,
    targetObjects: task.targetObjects.map((reference) => ({ ...reference })),
    affectedObjects: task.affectedObjects.map((reference) => ({
      ...reference,
    })),
    startReference: task.startReference
      ? { ...task.startReference }
      : undefined,
    targetReference: task.targetReference
      ? { ...task.targetReference }
      : undefined,
    properties: task.properties
      ? {
          ...task.properties,
          preconditions: task.properties.preconditions
            ? [...task.properties.preconditions]
            : undefined,
          postconditions: task.properties.postconditions
            ? [...task.properties.postconditions]
            : undefined,
        }
      : undefined,
    time: task.time ? { ...task.time } : undefined,
    viewpoint: task.viewpoint
      ? {
          cameraPosition: [...task.viewpoint.cameraPosition],
          cameraTarget: [...task.viewpoint.cameraTarget],
        }
      : undefined,
    markerPosition: task.markerPosition ? [...task.markerPosition] : undefined,
  })),
  sequences: mission.sequences.map((sequence) => ({ ...sequence })),
  schedule: mission.schedule ? { ...mission.schedule } : undefined,
});

/** Adds runtime-only source metadata while retaining the same GlobalId. */
const enrich = (
  reference: RobotObjectReference,
  expressId: number,
): RobotObjectReference => ({
  globalId: reference.globalId!,
  modelId: "direct-ifc-model",
  expressId,
  ifcClass: "IFCDOOR",
  name: "Imported display name",
});

test("semantic comparison accepts documented IFC roundtrip canonicalization", () => {
  const expectedB = completeMission("mission-b");
  const expectedA = completeMission("mission-a");
  const actualA = copyMission(expectedA);
  const actualB = copyMission(expectedB);

  for (const actual of [actualA, actualB]) {
    actual.createdAt = "2026-01-01T08:30:00";
    actual.updatedAt = "2026-01-01T08:31:00Z";
    actual.schedule!.scheduleStart = "2026-01-01T08:30:00";
    actual.schedule!.scheduleFinish = "2026-01-01T09:00:00";
    actual.sequences.reverse();
    const task = actual.tasks[0];
    task.createdAt = "2026-01-01T08:30:00";
    task.updatedAt = "2026-01-01T08:31:00Z";
    task.time = {
      ...task.time,
      scheduleStart: "2026-01-01T08:31:00",
      scheduleFinish: "2026-01-01T08:32:00Z",
      actualStart: "2026-01-01T08:31:00+01:00",
      actualFinish: "2026-01-01T08:32:00+01:00",
      completion: undefined,
    };
    task.targetObjects = task.targetObjects
      .map((reference, index) => enrich(reference, index + 10))
      .reverse();
    task.affectedObjects = task.affectedObjects.map((reference, index) =>
      enrich(reference, index + 20),
    );
    task.startReference = enrich(task.startReference!, 10);
    task.targetReference = enrich(task.targetReference!, 11);
  }

  const comparison = compareRobotMissionsSemantically(
    [expectedB, expectedA],
    [actualA, actualB],
  );
  assert.deepEqual(comparison, { equal: true, differences: [] });
  assert.equal(
    areRobotMissionsSemanticallyEqual(
      [expectedB, expectedA],
      [actualA, actualB],
    ),
    true,
  );
});

test("comparison recognizes a GlobalId added to a model-local source reference", () => {
  const expected = completeMission();
  const actual = copyMission(expected);
  expected.tasks[0].targetObjects = [
    { modelId: "direct-ifc-model", expressId: 42 },
  ];
  actual.tasks[0].targetObjects = [
    {
      globalId: "resolved-global-id",
      modelId: "direct-ifc-model",
      expressId: 42,
      ifcClass: "IFCDOOR",
      name: "Resolved door",
    },
  ];

  assert.equal(areRobotMissionsSemanticallyEqual([expected], [actual]), true);
});

test("canonicalization is immutable and retains task hierarchy order", () => {
  const mission = completeMission();
  const canonical = canonicalizeRobotMission(mission);

  assert.deepEqual(
    mission.tasks.map((task) => task.id),
    ["task-a", "task-b", "task-c"],
  );
  assert.deepEqual(
    canonical.tasks.map((task) => task.id),
    ["task-a", "task-b", "task-c"],
  );
  assert.deepEqual(
    mission.sequences.map((sequence) => sequence.id),
    ["sequence-b", "sequence-a"],
  );
  assert.deepEqual(
    canonical.sequences.map((sequence) => sequence.id),
    ["sequence-a", "sequence-b"],
  );
  assert.deepEqual(canonical.tasks[0].targetObjects, [
    "global:door-a",
    "global:door-b",
  ]);
  assert.equal(canonical.tasks[0].time?.completion, undefined);
  assert.equal(canonical.tasks[0].time?.scheduleStart, "2026-01-01T08:31:00");
  assert.equal(canonical.schedule?.scheduleStart, "2026-01-01T08:30:00");
});

test("task hierarchy reordering is a semantic difference with a stable path", () => {
  const expected = completeMission();
  const actual = copyMission(expected);
  [actual.tasks[0], actual.tasks[1]] = [actual.tasks[1], actual.tasks[0]];

  const comparison = compareRobotMissionsSemantically([expected], [actual]);
  assert.equal(comparison.equal, false);
  assert.ok(
    comparison.differences.some(
      (difference) =>
        difference.path === "missions[0].tasks[0].id" &&
        difference.expected === "task-a" &&
        difference.actual === "task-b",
    ),
  );
});

test("structured comparison reports precise changes to serialized fields", () => {
  const expected = completeMission();
  const actual = copyMission(expected);
  actual.tasks[0].name = "Changed task name";

  const comparison = compareRobotMissionsSemantically([expected], [actual]);
  assert.deepEqual(comparison, {
    equal: false,
    differences: [
      {
        path: "missions[0].tasks[0].name",
        expected: "Move between doors",
        actual: "Changed task name",
        message:
          'missions[0].tasks[0].name: expected "Move between doors", received "Changed task name".',
      },
    ],
  });
});

test("comparison detects non-canonical field changes and sequence identity", () => {
  const expected = completeMission();
  const cases: Array<[string, (mission: RobotMission) => void]> = [
    ["mission description", (mission) => (mission.description = "Changed")],
    ["mission status", (mission) => (mission.status = "done")],
    ["mission priority", (mission) => (mission.priority = "low")],
    [
      "mission timestamp",
      (mission) => (mission.updatedAt = "2027-01-01T00:00:00Z"),
    ],
    ["schedule id", (mission) => (mission.schedule!.id = "changed")],
    ["schedule name", (mission) => (mission.schedule!.name = "Changed")],
    [
      "schedule finish",
      (mission) => (mission.schedule!.scheduleFinish = "2026-01-01T10:00:00"),
    ],
    [
      "schedule duration",
      (mission) => (mission.schedule!.scheduleDuration = "PT2H"),
    ],
    [
      "task description",
      (mission) => (mission.tasks[0].description = "Changed"),
    ],
    ["action type", (mission) => (mission.tasks[0].actionType = "NAVIGATE_TO")],
    ["task status", (mission) => (mission.tasks[0].status = "done")],
    ["task priority", (mission) => (mission.tasks[0].priority = "low")],
    [
      "target identity",
      (mission) => (mission.tasks[0].targetObjects[0] = { globalId: "other" }),
    ],
    ["affected identity", (mission) => (mission.tasks[0].affectedObjects = [])],
    [
      "movement origin",
      (mission) => (mission.tasks[0].startReference = { globalId: "other" }),
    ],
    [
      "movement target",
      (mission) => (mission.tasks[0].targetReference = { globalId: "other" }),
    ],
    [
      "action scalar",
      (mission) => (mission.tasks[0].properties!.targetState = "OTHER"),
    ],
    [
      "action list",
      (mission) => (mission.tasks[0].properties!.preconditions = ["Other"]),
    ],
    [
      "task duration",
      (mission) => (mission.tasks[0].time!.scheduleDuration = "PT2M"),
    ],
    [
      "non-zero completion",
      (mission) => (mission.tasks[0].time!.completion = 0.5),
    ],
    [
      "viewpoint",
      (mission) => (mission.tasks[0].viewpoint!.cameraPosition[0] = 99),
    ],
    ["marker", (mission) => (mission.tasks[0].markerPosition![0] = 99)],
    [
      "task timestamp",
      (mission) => (mission.tasks[0].updatedAt = "2027-01-01T00:00:00Z"),
    ],
    ["sequence id", (mission) => (mission.sequences[0].id = "changed")],
    [
      "sequence endpoint",
      (mission) => (mission.sequences[0].successorTaskId = "task-a"),
    ],
    [
      "sequence type",
      (mission) => (mission.sequences[0].sequenceType = "FINISH_FINISH"),
    ],
  ];

  for (const [label, mutate] of cases) {
    const actual = copyMission(expected);
    mutate(actual);
    assert.equal(
      areRobotMissionsSemanticallyEqual([expected], [actual]),
      false,
      label,
    );
  }
});

test("collection canonicalization orders missions but does not mutate inputs", () => {
  const missionB = completeMission("mission-b");
  const missionA = completeMission("mission-a");
  const canonical = canonicalizeRobotMissions([missionB, missionA]);

  assert.deepEqual(
    canonical.map((mission) => mission.id),
    ["mission-a", "mission-b"],
  );
  assert.equal(missionB.id, "mission-b");
  assert.equal(missionA.id, "mission-a");
});
