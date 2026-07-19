import assert from "node:assert/strict";
import test from "node:test";
import {
  RobotMissionService,
  RobotMissionServiceError,
} from "../../src/application/robot-tasks";
import type {
  RobotMissionClock,
  RobotMissionRepository,
} from "../../src/application/robot-tasks";
import type {
  RobotMission,
  RobotObjectReference,
} from "../../src/domain/robot-tasks";

/** Timestamp used when a test command creates its mission aggregate. */
const missionCreatedAt = "2026-01-01T08:00:00.000Z";

/** Timestamp used when a test command adds an executable child task. */
const taskAddedAt = "2026-01-01T08:05:00.000Z";

/** Timestamp used when a test command updates existing domain state. */
const stateUpdatedAt = "2026-01-01T08:10:00.000Z";

/** Durable door identity shared by direct-object assignment tests. */
const doorReference: RobotObjectReference = {
  globalId: "door-global-id",
  modelId: "building-model",
  expressId: 101,
  ifcClass: "IFCDOOR",
};

/** Model-local switch identity shared by affected-object assignment tests. */
const switchReference: RobotObjectReference = {
  modelId: "building-model",
  expressId: 202,
  ifcClass: "IFCSWITCHINGDEVICE",
};

/** Spatial origin used by MOVE task service tests. */
const startReference: RobotObjectReference = {
  globalId: "start-space-global-id",
  ifcClass: "IFCSPACE",
};

/** Spatial destination used by MOVE task service tests. */
const targetReference: RobotObjectReference = {
  globalId: "target-space-global-id",
  ifcClass: "IFCSPACE",
};

/** Deterministic clock contract with a test-only time adjustment operation. */
interface MutableClock extends RobotMissionClock {
  /** Advances the ISO 8601 value returned by the next now() call. */
  set(value: string): void;
}

/**
 * Creates a mutable deterministic clock used to control command timestamps.
 *
 * Tests explicitly advance the captured current value between commands so they
 * can distinguish creation, insertion, and modification times without relying
 * on wall-clock timing.
 *
 * @param initialValue ISO 8601 timestamp returned until the clock is advanced.
 * @returns A RobotMissionClock with a test-only set operation.
 */
const createMutableClock = (initialValue: string): MutableClock => {
  /** ISO 8601 value captured and returned by the clock closure. */
  let current = initialValue;
  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
  };
};

/**
 * Small repository test double that records complete mission aggregates.
 *
 * The service should treat this port as its source of truth. saveCount allows
 * tests to prove that rejected commands do not persist a partial aggregate.
 */
class InMemoryMissionRepository implements RobotMissionRepository {
  /** Mission snapshots indexed by their stable application identifiers. */
  private readonly missions = new Map<string, RobotMission>();

  /** Number of successful save calls received from the service. */
  saveCount = 0;

  /**
   * Lists stored missions in insertion order.
   *
   * @returns Every mission currently held by the test repository.
   */
  list(): RobotMission[] {
    return [...this.missions.values()];
  }

  /**
   * Retrieves a mission by its stable ID.
   *
   * @param missionId Identifier requested by the application service.
   * @returns The stored aggregate or null when it is absent.
   */
  get(missionId: string): RobotMission | null {
    return this.missions.get(missionId) ?? null;
  }

  /**
   * Inserts or replaces one complete mission aggregate.
   *
   * @param mission Aggregate persisted by a successful service command.
   */
  save(mission: RobotMission): void {
    this.missions.set(mission.id, mission);
    this.saveCount += 1;
  }

  /**
   * Removes a stored aggregate by ID.
   *
   * @param missionId Identifier of the aggregate to remove.
   */
  delete(missionId: string): void {
    this.missions.delete(missionId);
  }

  /** Removes every mission owned by this test repository. */
  clear(): void {
    this.missions.clear();
  }
}

/** Service fixture shared by tests that need deterministic state and time. */
interface ServiceFixture {
  /** Application service under test. */
  service: RobotMissionService;

  /** Repository used to inspect persisted aggregates and save attempts. */
  repository: InMemoryMissionRepository;

  /** Mutable clock used to advance command timestamps. */
  clock: MutableClock;
}

/**
 * Creates an isolated service with in-memory persistence and a fixed clock.
 *
 * @returns Fresh service, repository, and clock instances for one test.
 */
const createServiceFixture = (): ServiceFixture => {
  const repository = new InMemoryMissionRepository();
  const clock = createMutableClock(missionCreatedAt);
  return {
    service: new RobotMissionService(repository, clock),
    repository,
    clock,
  };
};

/**
 * Creates a mission and adds one task using concise deterministic test data.
 *
 * @param fixture Service fixture that receives the new aggregate.
 * @param taskId Stable identifier of the child task.
 * @param actionType Supported action executed by the new task.
 * @returns The persisted mission after the task was added.
 */
const createMissionWithTask = (
  fixture: ServiceFixture,
  taskId: string,
  actionType: "OPEN" | "MOVE" | "NAVIGATE_TO" = "NAVIGATE_TO",
): RobotMission => {
  fixture.service.createMission({ id: "mission-1", name: "Test mission" });
  fixture.clock.set(taskAddedAt);
  return fixture.service.addTask("mission-1", {
    id: taskId,
    name: `Task ${taskId}`,
    actionType,
  });
};

/** Verifies deterministic timestamps and immutable create/add/update commands. */
test("service creates, adds, and updates domain state deterministically", () => {
  const fixture = createServiceFixture();
  const createdMission = fixture.service.createMission({
    id: "mission-1",
    name: "Door mission",
  });

  assert.equal(createdMission.createdAt, missionCreatedAt);
  assert.equal(createdMission.updatedAt, missionCreatedAt);

  fixture.clock.set(taskAddedAt);
  const missionWithTask = fixture.service.addTask("mission-1", {
    id: "open-door",
    name: "Open door",
    actionType: "OPEN",
  });
  const addedTask = missionWithTask.tasks[0];

  assert.deepEqual(createdMission.tasks, []);
  assert.equal(missionWithTask.updatedAt, taskAddedAt);
  assert.equal(addedTask.createdAt, taskAddedAt);
  assert.equal(addedTask.updatedAt, taskAddedAt);

  fixture.clock.set(stateUpdatedAt);
  const updatedMission = fixture.service.updateTask("mission-1", "open-door", {
    name: "Open entrance door",
    status: "in_progress",
  });
  const updatedTask = updatedMission.tasks[0];

  assert.equal(missionWithTask.tasks[0].name, "Open door");
  assert.equal(updatedTask.id, addedTask.id);
  assert.equal(updatedTask.createdAt, addedTask.createdAt);
  assert.equal(updatedTask.updatedAt, stateUpdatedAt);
  assert.equal(updatedTask.name, "Open entrance door");
  assert.equal(updatedTask.status, "in_progress");
  assert.equal(updatedMission.updatedAt, stateUpdatedAt);
  assert.deepEqual(fixture.repository.get("mission-1"), updatedMission);
});

/** Verifies that explicit undefined values clear optional task information. */
test("service updates can clear optional task fields", () => {
  const fixture = createServiceFixture();
  fixture.service.createMission({ id: "mission-1", name: "Test mission" });
  fixture.service.addTask("mission-1", {
    id: "documented-task",
    name: "Documented task",
    description: "Temporary authoring description",
    actionType: "OPEN",
    properties: { targetState: "OPEN" },
    time: { completion: 0 },
  });

  const mission = fixture.service.updateTask("mission-1", "documented-task", {
    description: undefined,
    status: undefined,
    priority: undefined,
    properties: undefined,
    time: undefined,
  });

  assert.equal(mission.tasks[0].description, undefined);
  assert.equal(mission.tasks[0].status, undefined);
  assert.equal(mission.tasks[0].priority, undefined);
  assert.equal(mission.tasks[0].properties, undefined);
  assert.equal(mission.tasks[0].time, undefined);
});

/** Verifies that task deletion also removes every incident sequence edge. */
test("service deletes a task and only its incident sequence relations", () => {
  const fixture = createServiceFixture();
  createMissionWithTask(fixture, "task-a");
  fixture.service.addTask("mission-1", {
    id: "task-b",
    name: "Task B",
    actionType: "NAVIGATE_TO",
  });
  fixture.service.addTask("mission-1", {
    id: "task-c",
    name: "Task C",
    actionType: "NAVIGATE_TO",
  });
  fixture.service.sequenceTasks("mission-1", {
    id: "a-to-b",
    predecessorTaskId: "task-a",
    successorTaskId: "task-b",
  });
  fixture.service.sequenceTasks("mission-1", {
    id: "b-to-c",
    predecessorTaskId: "task-b",
    successorTaskId: "task-c",
  });
  fixture.service.sequenceTasks("mission-1", {
    id: "a-to-c",
    predecessorTaskId: "task-a",
    successorTaskId: "task-c",
  });

  fixture.clock.set(stateUpdatedAt);
  const mission = fixture.service.deleteTask("mission-1", "task-b");

  assert.deepEqual(
    mission.tasks.map((task) => task.id),
    ["task-a", "task-c"],
  );
  assert.deepEqual(
    mission.sequences.map((sequence) => sequence.id),
    ["a-to-c"],
  );
  assert.equal(mission.updatedAt, stateUpdatedAt);
});

/** Verifies role-aware, multi-object selection assignment and deduplication. */
test("service assigns selected target and affected objects without duplicates", () => {
  const fixture = createServiceFixture();
  createMissionWithTask(fixture, "open-door", "OPEN");

  fixture.service.assignSelectedObjectsToTask(
    "mission-1",
    "open-door",
    "target",
    [doorReference, doorReference],
  );
  const mission = fixture.service.assignSelectedObjectsToTask(
    "mission-1",
    "open-door",
    "affected",
    [switchReference, switchReference],
  );

  assert.deepEqual(mission.tasks[0].targetObjects, [doorReference]);
  assert.deepEqual(mission.tasks[0].affectedObjects, [switchReference]);
  assert.equal("properties" in mission.tasks[0].targetObjects[0], false);
});

/** Verifies that movement origins and destinations remain explicit task data. */
test("service assigns both references required by a movement task", () => {
  const fixture = createServiceFixture();
  createMissionWithTask(fixture, "move", "MOVE");

  const mission = fixture.service.assignMovementReferencesToTask(
    "mission-1",
    "move",
    startReference,
    targetReference,
  );

  assert.deepEqual(mission.tasks[0].startReference, startReference);
  assert.deepEqual(mission.tasks[0].targetReference, targetReference);
});

/** Verifies cycle rejection without persisting the rejected graph mutation. */
test("service rejects cyclic sequences atomically", () => {
  const fixture = createServiceFixture();
  createMissionWithTask(fixture, "task-a");
  fixture.service.addTask("mission-1", {
    id: "task-b",
    name: "Task B",
    actionType: "NAVIGATE_TO",
  });
  fixture.service.sequenceTasks("mission-1", {
    id: "a-to-b",
    predecessorTaskId: "task-a",
    successorTaskId: "task-b",
  });

  const persistedBeforeRejection = fixture.repository.get("mission-1");
  const saveCountBeforeRejection = fixture.repository.saveCount;

  assert.throws(
    () =>
      fixture.service.sequenceTasks("mission-1", {
        id: "b-to-a",
        predecessorTaskId: "task-b",
        successorTaskId: "task-a",
      }),
    /cycle/i,
  );
  assert.equal(fixture.repository.saveCount, saveCountBeforeRejection);
  assert.deepEqual(
    fixture.repository.get("mission-1"),
    persistedBeforeRejection,
  );
});

/** Verifies explicit errors for commands addressing absent aggregate IDs. */
test("service rejects missing mission and task identifiers", () => {
  const fixture = createServiceFixture();

  assert.throws(
    () =>
      fixture.service.addTask("missing-mission", {
        id: "task-a",
        name: "Task A",
        actionType: "NAVIGATE_TO",
      }),
    RobotMissionServiceError,
  );

  fixture.service.createMission({ id: "mission-1", name: "Test mission" });
  const saveCountBeforeMissingTask = fixture.repository.saveCount;
  assert.throws(
    () =>
      fixture.service.updateTask("mission-1", "missing-task", {
        name: "Unavailable task",
      }),
    /Task missing-task does not exist/,
  );
  assert.equal(fixture.repository.saveCount, saveCountBeforeMissingTask);
});

/** Verifies that the application service persists a complete linear execution plan. */
test("service reorders tasks into a FINISH_START execution chain", () => {
  const fixture = createServiceFixture();
  createMissionWithTask(fixture, "task-a");
  fixture.service.addTask("mission-1", {
    id: "task-b",
    name: "Task B",
    actionType: "NAVIGATE_TO",
  });
  fixture.service.addTask("mission-1", {
    id: "task-c",
    name: "Task C",
    actionType: "NAVIGATE_TO",
  });

  fixture.clock.set(stateUpdatedAt);
  const mission = fixture.service.setTaskExecutionOrder("mission-1", [
    "task-c",
    "task-a",
    "task-b",
  ]);

  assert.deepEqual(
    mission.tasks.map((task) => task.id),
    ["task-c", "task-a", "task-b"],
  );
  assert.deepEqual(
    mission.sequences.map((sequence) => ({
      predecessorTaskId: sequence.predecessorTaskId,
      successorTaskId: sequence.successorTaskId,
      sequenceType: sequence.sequenceType,
    })),
    [
      {
        predecessorTaskId: "task-c",
        successorTaskId: "task-a",
        sequenceType: "FINISH_START",
      },
      {
        predecessorTaskId: "task-a",
        successorTaskId: "task-b",
        sequenceType: "FINISH_START",
      },
    ],
  );
  assert.equal(mission.updatedAt, stateUpdatedAt);
  assert.deepEqual(fixture.repository.get("mission-1"), mission);
});
