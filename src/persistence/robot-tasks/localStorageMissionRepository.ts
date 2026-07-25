import type { RobotMissionRepository } from "../../application/robot-tasks";
import {
  ROBOT_ACTION_TYPES,
  validateTaskSequence,
} from "../../domain/robot-tasks";
import type {
  RobotMission,
  RobotObjectReference,
  RobotTask,
  RobotTaskSequence,
} from "../../domain/robot-tasks";
import { RobotMissionPersistenceError } from "./robotMissionPersistenceError";

/** Storage key reserved exclusively for the new robot-mission domain model. */
export const ROBOT_MISSION_STORAGE_KEY = "ifc-viewer:robot-missions:domain-v1";

/** Current JSON envelope version. No older version is read or migrated. */
const ROBOT_MISSION_STORAGE_VERSION = 1;

/**
 * Minimal browser-storage contract required by the repository.
 *
 * Depending on this structural interface instead of the global localStorage
 * singleton makes persistence deterministic in tests and explicit at the
 * composition root.
 */
export interface RobotMissionStorage {
  /** Reads a serialized value or null when the key is absent. */
  getItem(key: string): string | null;

  /** Writes or replaces one serialized value. */
  setItem(key: string, value: string): void;

  /** Removes one value without affecting unrelated storage keys. */
  removeItem(key: string): void;
}

/** JSON document stored under the repository's single versioned key. */
interface StoredMissionEnvelope {
  /** Exact schema version supported by this implementation. */
  version: typeof ROBOT_MISSION_STORAGE_VERSION;

  /** Complete new-domain mission aggregates. */
  missions: RobotMission[];
}

/** Checks whether an unknown JSON value is a non-null object record. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks whether an unknown JSON value is a string. */
const isString = (value: unknown): value is string => typeof value === "string";

/** Checks whether an unknown JSON value contains non-whitespace text. */
const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && Boolean(value.trim());

/** Checks whether an unknown JSON value is a finite number. */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Checks whether an unknown JSON value is an array containing only strings. */
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

/** Checks whether an unknown JSON value is a three-component numeric vector. */
const isVector3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);

/**
 * Evaluates an optional record property with a supplied type guard.
 *
 * @param record Object containing the property.
 * @param key Property name to validate.
 * @param guard Type guard applied when the property is present.
 * @returns True when the property is absent or satisfies the guard.
 */
const isOptional = (
  record: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => boolean,
) => record[key] === undefined || guard(record[key]);

/** Checks one optional string property on a deserialized record. */
const hasOptionalString = (record: Record<string, unknown>, key: string) =>
  isOptional(record, key, isString);

/** Checks whether a value belongs to a readonly collection of strings. */
const isOneOf = (value: unknown, values: readonly string[]) =>
  isString(value) && values.includes(value);

/** Checks whether every object has a distinct, non-empty identifier. */
const hasUniqueIds = (values: Array<{ id: string }>) => {
  const ids = values.map((value) => value.id);
  return (
    ids.every((id) => Boolean(id.trim())) && new Set(ids).size === ids.length
  );
};

/** Supported persisted lifecycle states for missions and tasks. */
const ROBOT_TASK_STATUSES = [
  "planned",
  "open",
  "in_progress",
  "done",
  "blocked",
  "failed",
] as const;

/** Supported persisted priority values for missions and tasks. */
const ROBOT_TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;

/** Supported persisted dependency types between executable tasks. */
const ROBOT_TASK_SEQUENCE_TYPES = [
  "FINISH_START",
  "START_START",
  "FINISH_FINISH",
  "START_FINISH",
] as const;

/**
 * Validates the identity and optional descriptive fields of one IFC reference.
 *
 * A GlobalId is preferred. Without it, a model ID and finite express ID are
 * required together. Concrete action properties are rejected because they
 * belong to RobotTask rather than to referenced IFC objects.
 */
const isRobotObjectReference = (
  value: unknown,
): value is RobotObjectReference => {
  if (!isRecord(value) || "properties" in value || "actionType" in value) {
    return false;
  }
  if (
    !hasOptionalString(value, "modelId") ||
    !hasOptionalString(value, "ifcClass") ||
    !hasOptionalString(value, "name") ||
    !isOptional(value, "expressId", isFiniteNumber)
  ) {
    return false;
  }
  if (isNonEmptyString(value.globalId)) return true;
  return (
    value.globalId === undefined &&
    isNonEmptyString(value.modelId) &&
    isFiniteNumber(value.expressId)
  );
};

/** Validates the optional concrete action-property object stored on a task. */
const isRobotActionProperties = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    hasOptionalString(value, "targetState") &&
    hasOptionalString(value, "targetObjectRole") &&
    hasOptionalString(value, "affectedObjectRole") &&
    hasOptionalString(value, "requiredCapability") &&
    isOptional(value, "preconditions", isStringArray) &&
    isOptional(value, "postconditions", isStringArray) &&
    hasOptionalString(value, "successCondition")
  );
};

/** Validates optional planning and execution timing stored directly on a task. */
const isRobotTaskTime = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    hasOptionalString(value, "scheduleStart") &&
    hasOptionalString(value, "scheduleFinish") &&
    hasOptionalString(value, "scheduleDuration") &&
    hasOptionalString(value, "actualStart") &&
    hasOptionalString(value, "actualFinish") &&
    hasOptionalString(value, "remainingTime") &&
    isOptional(value, "completion", isFiniteNumber)
  );
};

/** Validates optional viewer camera state stored as task annotation metadata. */
const isTaskViewpoint = (value: unknown) => {
  if (!isRecord(value)) return false;
  return isVector3(value.cameraPosition) && isVector3(value.cameraTarget);
};

/**
 * Structurally validates one executable task from the new domain model.
 *
 * This is deliberately a shape check rather than full domain validation. It
 * accepts incomplete authoring drafts while rejecting legacy field names such
 * as targetObjectGlobalIds or targetObjectReferences.
 */
const isRobotTask = (value: unknown): value is RobotTask => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isOneOf(value.actionType, ROBOT_ACTION_TYPES) &&
    Array.isArray(value.targetObjects) &&
    value.targetObjects.every(isRobotObjectReference) &&
    Array.isArray(value.affectedObjects) &&
    value.affectedObjects.every(isRobotObjectReference) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    hasOptionalString(value, "description") &&
    isOptional(value, "status", (candidate) =>
      isOneOf(candidate, ROBOT_TASK_STATUSES),
    ) &&
    isOptional(value, "priority", (candidate) =>
      isOneOf(candidate, ROBOT_TASK_PRIORITIES),
    ) &&
    isOptional(value, "startReference", isRobotObjectReference) &&
    isOptional(value, "targetReference", isRobotObjectReference) &&
    isOptional(value, "properties", isRobotActionProperties) &&
    isOptional(value, "time", isRobotTaskTime) &&
    isOptional(value, "viewpoint", isTaskViewpoint) &&
    isOptional(value, "markerPosition", isVector3)
  );
};

/** Validates one directed dependency stored inside a mission aggregate. */
const isRobotTaskSequence = (value: unknown): value is RobotTaskSequence => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.predecessorTaskId) &&
    isNonEmptyString(value.successorTaskId) &&
    isOneOf(value.sequenceType, ROBOT_TASK_SEQUENCE_TYPES)
  );
};

/** Validates optional mission-level schedule metadata. */
const isRobotMissionSchedule = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    hasOptionalString(value, "scheduleStart") &&
    hasOptionalString(value, "scheduleFinish") &&
    hasOptionalString(value, "scheduleDuration")
  );
};

/**
 * Structurally validates one mission aggregate without requiring it to contain
 * an executable task, because empty draft missions are valid persisted state.
 */
const isRobotMission = (value: unknown): value is RobotMission => {
  if (!isRecord(value)) return false;
  const hasMissionShape =
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isRobotTask) &&
    Array.isArray(value.sequences) &&
    value.sequences.every(isRobotTaskSequence) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    hasOptionalString(value, "description") &&
    isOptional(value, "status", (candidate) =>
      isOneOf(candidate, ROBOT_TASK_STATUSES),
    ) &&
    isOptional(value, "priority", (candidate) =>
      isOneOf(candidate, ROBOT_TASK_PRIORITIES),
    ) &&
    isOptional(value, "schedule", isRobotMissionSchedule);
  if (!hasMissionShape) return false;

  // The shape checks above narrow both collections to current domain records.
  const tasks = value.tasks as RobotTask[];
  const sequences = value.sequences as RobotTaskSequence[];
  return (
    hasUniqueIds(tasks) &&
    hasUniqueIds(sequences) &&
    !validateTaskSequence(tasks, sequences).some(
      (issue) => issue.severity === "error",
    )
  );
};

/** Validates the exact, migration-free JSON envelope owned by this repository. */
const isStoredMissionEnvelope = (
  value: unknown,
): value is StoredMissionEnvelope => {
  if (!isRecord(value)) return false;
  const hasEnvelopeShape =
    value.version === ROBOT_MISSION_STORAGE_VERSION &&
    Array.isArray(value.missions) &&
    value.missions.every(isRobotMission);
  if (!hasEnvelopeShape) return false;
  return hasUniqueIds(value.missions as RobotMission[]);
};

/**
 * localStorage-backed implementation of the new mission repository port.
 *
 * All missions are stored in one versioned envelope for atomic index/data
 * updates. Only the new key is accessed: legacy annotation and IFC-roundtrip
 * keys are neither read, migrated, nor removed.
 */
export class LocalStorageRobotMissionRepository
  implements RobotMissionRepository
{
  /** Browser-like key/value storage supplied by the composition root. */
  private readonly storage: RobotMissionStorage;

  /** Key under which the versioned mission envelope is stored. */
  private readonly storageKey: string;

  /**
   * Creates a repository for one explicit browser storage instance.
   *
   * @param storage Usually window.localStorage; may be an in-memory test double.
   * @param storageKey Optional isolated key, primarily useful in tests.
   */
  constructor(
    storage: RobotMissionStorage,
    storageKey = ROBOT_MISSION_STORAGE_KEY,
  ) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /**
   * Reads every persisted mission in stable insertion order.
   *
   * @returns Complete new-domain mission aggregates.
   */
  list(): RobotMission[] {
    return this.readEnvelope().missions;
  }

  /**
   * Retrieves one mission by ID from the current envelope.
   *
   * @param missionId Stable mission identifier.
   * @returns The matching mission when found; otherwise null.
   */
  get(missionId: string): RobotMission | null {
    return (
      this.readEnvelope().missions.find(
        (mission) => mission.id === missionId,
      ) ?? null
    );
  }

  /**
   * Inserts or atomically replaces one complete mission aggregate.
   *
   * @param mission New-domain mission to persist.
   */
  save(mission: RobotMission): void {
    if (!isRobotMission(mission)) {
      throw new RobotMissionPersistenceError(
        "Only the current RobotMission domain shape can be stored.",
      );
    }
    const current = this.readEnvelope();
    const existingIndex = current.missions.findIndex(
      (candidate) => candidate.id === mission.id,
    );
    const missions = [...current.missions];
    if (existingIndex === -1) missions.push(mission);
    else missions[existingIndex] = mission;
    this.writeEnvelope({ version: ROBOT_MISSION_STORAGE_VERSION, missions });
  }

  /**
   * Removes one mission while leaving every unrelated and legacy key untouched.
   *
   * @param missionId Stable mission identifier to remove.
   */
  delete(missionId: string): void {
    const current = this.readEnvelope();
    const missions = current.missions.filter(
      (mission) => mission.id !== missionId,
    );
    if (missions.length === current.missions.length) return;
    if (!missions.length) {
      this.removeEnvelope();
      return;
    }
    this.writeEnvelope({ version: ROBOT_MISSION_STORAGE_VERSION, missions });
  }

  /**
   * Removes all new-domain missions by deleting only this repository's key.
   */
  clear(): void {
    this.removeEnvelope();
  }

  /**
   * Reads, parses, and structurally validates the stored JSON envelope.
   *
   * A missing key represents an empty repository. Invalid JSON, legacy shapes,
   * and unsupported versions are rejected without modifying the stored value.
   *
   * @returns A validated current-version envelope.
   * @throws RobotMissionPersistenceError When storage cannot be read or parsed.
   */
  private readEnvelope(): StoredMissionEnvelope {
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(this.storageKey);
    } catch {
      throw new RobotMissionPersistenceError(
        "Robot mission storage could not be read.",
      );
    }
    if (serialized === null) {
      return { version: ROBOT_MISSION_STORAGE_VERSION, missions: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      throw new RobotMissionPersistenceError(
        "Stored robot mission data is not valid JSON.",
      );
    }
    if (!isStoredMissionEnvelope(parsed)) {
      throw new RobotMissionPersistenceError(
        "Stored robot mission data has an unsupported version or shape.",
      );
    }
    return parsed;
  }

  /**
   * Serializes and writes a complete current-version envelope.
   *
   * @param envelope Validated new-domain mission collection to store.
   * @throws RobotMissionPersistenceError When serialization or storage fails.
   */
  private writeEnvelope(envelope: StoredMissionEnvelope): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch {
      throw new RobotMissionPersistenceError(
        "Robot mission storage could not be written.",
      );
    }
  }

  /**
   * Removes only this repository's envelope key.
   *
   * @throws RobotMissionPersistenceError When storage removal fails.
   */
  private removeEnvelope(): void {
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      throw new RobotMissionPersistenceError(
        "Robot mission storage could not be cleared.",
      );
    }
  }
}
