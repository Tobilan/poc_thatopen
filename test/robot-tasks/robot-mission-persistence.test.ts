import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskSequence,
  addTaskToMission,
  createRobotMission,
  createRobotTask,
  createTaskSequence,
} from "../../src/domain/robot-tasks";
import type { RobotMission } from "../../src/domain/robot-tasks";
import {
  LocalStorageRobotMissionRepository,
  ROBOT_MISSION_STORAGE_KEY,
  RobotMissionPersistenceError,
} from "../../src/persistence/robot-tasks";
import type { RobotMissionStorage } from "../../src/persistence/robot-tasks";

/** Fixed timestamp used by every persisted aggregate fixture. */
const persistedAt = "2026-02-01T09:00:00.000Z";

/** Updated timestamp used to distinguish a repository upsert from insertion. */
const upsertedAt = "2026-02-01T09:30:00.000Z";

/** Storage key used by the removed object-annotation implementation. */
const legacyStorageKey = "robot-tasks:v1:legacy-model-hash";

/** Arbitrary application key that the mission repository must never manage. */
const unrelatedStorageKey = "viewer-preferences";

/**
 * Produces the JSON-normalized representation that browser storage can retain.
 * Optional properties with value `undefined` are intentionally absent after a
 * localStorage round trip and remain semantically equivalent in the domain.
 *
 * @param value Domain value to serialize and parse exactly like the repository.
 * @returns A JSON-safe copy of the supplied value.
 */
const asStoredJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Browser-storage test double backed by an in-memory Map.
 *
 * Explicit seed and peek helpers allow tests to arrange corrupt or legacy data
 * and then prove that the repository leaves those raw values unchanged.
 */
class MemoryStorage implements RobotMissionStorage {
  /** Serialized values indexed by their browser-storage keys. */
  private readonly values = new Map<string, string>();

  /**
   * Reads one serialized value.
   *
   * @param key Storage key requested by the repository.
   * @returns The stored value or null when the key is absent.
   */
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /**
   * Inserts or replaces one serialized value.
   *
   * @param key Storage key written by the repository.
   * @param value Serialized JSON or test fixture data to store.
   */
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  /**
   * Removes one serialized value without changing other keys.
   *
   * @param key Storage key to delete.
   */
  removeItem(key: string): void {
    this.values.delete(key);
  }

  /**
   * Seeds raw data without passing through the repository under test.
   *
   * @param key Key whose exact raw value should be arranged.
   * @param value Raw value used for legacy or malformed-data scenarios.
   */
  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  /**
   * Inspects an exact raw storage value after a repository operation.
   *
   * @param key Key whose current value should be observed.
   * @returns The stored value or null when it has been removed.
   */
  peek(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

/**
 * Creates a mission containing representative current-domain data.
 *
 * The aggregate includes task action properties, task timing, durable and local
 * object references, movement references, viewer metadata, schedule metadata,
 * and a sequence edge so persistence tests exercise the complete new shape.
 *
 * @param name Human-readable mission name used to distinguish upserted data.
 * @returns A complete RobotMission suitable for JSON round-trip assertions.
 */
const createPersistedMission = (
  name = "Persisted building mission",
): RobotMission => {
  const doorReference = {
    globalId: "door-global-id",
    modelId: "building-model",
    expressId: 11,
    ifcClass: "IFCDOOR",
    name: "Entrance door",
  } as const;
  const affectedReference = {
    modelId: "building-model",
    expressId: 12,
    ifcClass: "IFCLIGHTFIXTURE",
    name: "Entrance light",
  } as const;
  const startReference = {
    globalId: "start-space-global-id",
    ifcClass: "IFCSPACE",
  } as const;
  const targetReference = {
    globalId: "target-space-global-id",
    ifcClass: "IFCSPACE",
  } as const;

  const openTask = createRobotTask(
    {
      id: "open-door",
      name: "Open entrance door",
      description: "Open the door before navigation begins.",
      actionType: "OPEN",
      status: "planned",
      priority: "high",
      targetObjects: [doorReference],
      affectedObjects: [affectedReference],
      properties: {
        targetState: "OPEN",
        requiredCapability: "door-operation",
        preconditions: ["ROBOT_AT_DOOR"],
        postconditions: ["DOOR_OPEN"],
        successCondition: "Door reports an open state.",
      },
      time: {
        scheduleStart: persistedAt,
        scheduleDuration: "PT30S",
        completion: 0,
      },
      viewpoint: {
        cameraPosition: [1, 2, 3],
        cameraTarget: [4, 5, 6],
      },
      markerPosition: [7, 8, 9],
    },
    persistedAt,
  );
  const moveTask = createRobotTask(
    {
      id: "move-to-space",
      name: "Move through the entrance",
      actionType: "MOVE",
      startReference,
      targetReference,
    },
    persistedAt,
  );

  let mission = createRobotMission(
    {
      id: "mission-1",
      name,
      description: "Representative persisted aggregate.",
      status: "planned",
      priority: "critical",
      schedule: {
        id: "schedule-1",
        name: "Morning schedule",
        scheduleStart: persistedAt,
        scheduleDuration: "PT5M",
      },
    },
    persistedAt,
  );
  mission = addTaskToMission(mission, openTask, persistedAt);
  mission = addTaskToMission(mission, moveTask, persistedAt);
  return addTaskSequence(
    mission,
    createTaskSequence({
      id: "open-before-move",
      predecessorTaskId: openTask.id,
      successorTaskId: moveTask.id,
    }),
    persistedAt,
  );
};

/** Verifies complete JSON round-tripping and replacement by mission ID. */
test("localStorage repository round-trips and upserts new-domain missions", () => {
  const storage = new MemoryStorage();
  const repository = new LocalStorageRobotMissionRepository(storage);
  const originalMission = createPersistedMission();

  repository.save(originalMission);

  assert.deepEqual(
    repository.get(originalMission.id),
    asStoredJson(originalMission),
  );
  assert.deepEqual(repository.list(), [asStoredJson(originalMission)]);

  const upsertedMission: RobotMission = {
    ...originalMission,
    name: "Updated persisted mission",
    updatedAt: upsertedAt,
  };
  repository.save(upsertedMission);

  assert.equal(repository.list().length, 1);
  assert.deepEqual(
    repository.get(originalMission.id),
    asStoredJson(upsertedMission),
  );
});

/** Verifies that legacy annotation keys are ignored and never rewritten. */
test("localStorage repository leaves legacy task storage untouched", () => {
  const storage = new MemoryStorage();
  const legacyValue = JSON.stringify({ version: 1, tasks: [{ id: "legacy" }] });
  storage.seed(legacyStorageKey, legacyValue);
  const repository = new LocalStorageRobotMissionRepository(storage);

  assert.deepEqual(repository.list(), []);
  repository.save(createPersistedMission());

  assert.equal(storage.peek(legacyStorageKey), legacyValue);
  assert.notEqual(storage.peek(ROBOT_MISSION_STORAGE_KEY), null);
});

/** Verifies that clear removes only the new mission repository's own key. */
test("localStorage repository clear is scoped to new mission data", () => {
  const storage = new MemoryStorage();
  const legacyValue = "legacy-task-data";
  const unrelatedValue = "compact-layout";
  storage.seed(legacyStorageKey, legacyValue);
  storage.seed(unrelatedStorageKey, unrelatedValue);
  const repository = new LocalStorageRobotMissionRepository(storage);
  repository.save(createPersistedMission());

  repository.clear();

  assert.deepEqual(repository.list(), []);
  assert.equal(storage.peek(ROBOT_MISSION_STORAGE_KEY), null);
  assert.equal(storage.peek(legacyStorageKey), legacyValue);
  assert.equal(storage.peek(unrelatedStorageKey), unrelatedValue);
});

/** Verifies that malformed JSON is reported without modifying stored bytes. */
test("localStorage repository rejects corrupt JSON without overwriting it", () => {
  const storage = new MemoryStorage();
  const corruptValue = "{not-valid-json";
  storage.seed(ROBOT_MISSION_STORAGE_KEY, corruptValue);
  const repository = new LocalStorageRobotMissionRepository(storage);

  assert.throws(
    () => repository.list(),
    (error: unknown) =>
      error instanceof RobotMissionPersistenceError &&
      /valid JSON/.test(error.message),
  );
  assert.equal(storage.peek(ROBOT_MISSION_STORAGE_KEY), corruptValue);
});

/** Verifies strict version handling with no legacy migration or silent reset. */
test("localStorage repository rejects unsupported envelope versions", () => {
  const storage = new MemoryStorage();
  const unsupportedValue = JSON.stringify({ version: 2, missions: [] });
  storage.seed(ROBOT_MISSION_STORAGE_KEY, unsupportedValue);
  const repository = new LocalStorageRobotMissionRepository(storage);

  assert.throws(
    () => repository.get("mission-1"),
    (error: unknown) =>
      error instanceof RobotMissionPersistenceError &&
      /unsupported version or shape/.test(error.message),
  );
  assert.equal(storage.peek(ROBOT_MISSION_STORAGE_KEY), unsupportedValue);
});

/** Verifies that persistence rejects dangling or cyclic sequence structures. */
test("localStorage repository rejects invalid persisted sequence graphs", () => {
  const storage = new MemoryStorage();
  const mission = createPersistedMission();
  const invalidMission: RobotMission = {
    ...mission,
    sequences: [
      ...mission.sequences,
      {
        id: "move-before-open",
        predecessorTaskId: "move-to-space",
        successorTaskId: "open-door",
        sequenceType: "FINISH_START",
      },
    ],
  };
  const invalidValue = JSON.stringify({
    version: 1,
    missions: [invalidMission],
  });
  storage.seed(ROBOT_MISSION_STORAGE_KEY, invalidValue);
  const repository = new LocalStorageRobotMissionRepository(storage);

  assert.throws(() => repository.list(), RobotMissionPersistenceError);
  assert.equal(storage.peek(ROBOT_MISSION_STORAGE_KEY), invalidValue);
});

/** Verifies that duplicate mission identities cannot create ambiguous reads. */
test("localStorage repository rejects duplicate mission identifiers", () => {
  const storage = new MemoryStorage();
  const mission = createPersistedMission();
  const invalidValue = JSON.stringify({
    version: 1,
    missions: [mission, { ...mission, name: "Duplicate identity" }],
  });
  storage.seed(ROBOT_MISSION_STORAGE_KEY, invalidValue);
  const repository = new LocalStorageRobotMissionRepository(storage);

  assert.throws(() => repository.get(mission.id), RobotMissionPersistenceError);
  assert.equal(storage.peek(ROBOT_MISSION_STORAGE_KEY), invalidValue);
});
