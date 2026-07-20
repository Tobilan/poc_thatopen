import assert from "node:assert/strict";
import test from "node:test";
import { createRobotMission } from "../../src/domain/robot-tasks";
import {
  ROBOT_MISSION_STORAGE_KEY,
  RobotMissionPersistenceError,
  SelectableRobotMissionRepository,
} from "../../src/persistence/robot-tasks";
import type { RobotMissionStorage } from "../../src/persistence/robot-tasks";

/** Minimal localStorage-compatible test double for selectable persistence. */
class MemoryStorage implements RobotMissionStorage {
  /** Serialized browser values indexed by storage key. */
  private readonly values = new Map<string, string>();

  /** Reads one serialized value or null when the key is absent. */
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /** Inserts or replaces one serialized browser value. */
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  /** Removes one serialized browser value. */
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

/** Fixed timestamp used by selectable-repository mission fixtures. */
const createdAt = "2026-07-20T10:00:00.000Z";

/**
 * Normalizes a domain value exactly as JSON-backed browser storage does.
 *
 * @param value Domain value whose durable representation should be compared.
 * @returns Copy without optional properties whose values were undefined.
 */
const asStoredJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Verifies that the default mode is volatile and does not write localStorage. */
test("selectable repository defaults to page-local no-storage mode", () => {
  const storage = new MemoryStorage();
  const repository = new SelectableRobotMissionRepository(storage);
  const mission = createRobotMission(
    { id: "memory-mission", name: "Memory mission" },
    createdAt,
  );

  repository.save(mission);

  assert.equal(repository.getMode(), "none");
  assert.deepEqual(repository.list(), [mission]);
  assert.equal(storage.getItem(ROBOT_MISSION_STORAGE_KEY), null);
});

/** Verifies that switching stores neither copies nor destroys mission data. */
test("selectable repository keeps no-storage and localStorage missions isolated", () => {
  const storage = new MemoryStorage();
  const repository = new SelectableRobotMissionRepository(storage);
  const memoryMission = createRobotMission(
    { id: "memory-mission", name: "Memory mission" },
    createdAt,
  );
  const durableMission = createRobotMission(
    { id: "durable-mission", name: "Durable mission" },
    createdAt,
  );
  repository.save(memoryMission);

  repository.selectMode("local-storage");
  assert.deepEqual(repository.list(), []);
  repository.save(durableMission);
  assert.deepEqual(repository.list(), [asStoredJson(durableMission)]);

  repository.selectMode("none");
  assert.deepEqual(repository.list(), [memoryMission]);
  repository.selectMode("local-storage");
  assert.deepEqual(repository.list(), [asStoredJson(durableMission)]);
});

/** Verifies that the backend reserve cannot falsely report a successful save. */
test("selectable repository exposes backend as an unavailable placeholder", () => {
  const repository = new SelectableRobotMissionRepository(new MemoryStorage());
  const mission = createRobotMission(
    { id: "backend-mission", name: "Backend mission" },
    createdAt,
  );

  repository.selectMode("backend");

  assert.equal(repository.isAvailable("backend"), false);
  assert.deepEqual(repository.list(), []);
  assert.throws(() => repository.save(mission), RobotMissionPersistenceError);
});
