import type {
  RobotActionProperties,
  RobotMission,
  RobotMissionSchedule,
  RobotObjectReference,
  RobotTask,
  RobotTaskPriority,
  RobotTaskStatus,
  RobotTaskTime,
  RobotActionType,
  TaskViewpoint,
} from "./types";

/**
 * Input accepted by createMission. Child tasks and sequence relations are not
 * accepted here because every new mission starts as an empty parent container
 * and receives its executable steps through the dedicated builder functions.
 */
export interface CreateMissionInput {
  /** Stable application-level identifier of the new mission. */
  id: string;

  /** Human-readable mission name. */
  name: string;

  /** Optional longer explanation of the mission goal. */
  description?: string;

  /** Initial lifecycle state; defaults to planned when omitted. */
  status?: RobotTaskStatus;

  /** Initial priority; defaults to medium when omitted. */
  priority?: RobotTaskPriority;

  /** Optional schedule metadata for the mission as a whole. */
  schedule?: RobotMissionSchedule;

  /** Optional explicit creation timestamp, useful when restoring domain data. */
  createdAt?: string;
}

/**
 * Input accepted by createRobotTask. Collection fields are optional for caller
 * convenience and are initialized to independent empty arrays by the builder.
 */
export interface CreateRobotTaskInput {
  /** Stable application-level identifier of the new task. */
  id: string;

  /** Human-readable task name. */
  name: string;

  /** Optional longer explanation of the executable step. */
  description?: string;

  /** Concrete action that the robot must execute. */
  actionType: RobotActionType;

  /** Initial lifecycle state; defaults to planned when omitted. */
  status?: RobotTaskStatus;

  /** Initial priority; defaults to medium when omitted. */
  priority?: RobotTaskPriority;

  /** IFC objects directly targeted or used as context by the task. */
  targetObjects?: RobotObjectReference[];

  /** IFC objects affected indirectly by execution of the task. */
  affectedObjects?: RobotObjectReference[];

  /** Starting object or spatial reference used by a MOVE task. */
  startReference?: RobotObjectReference;

  /** Destination object or spatial reference used by a MOVE task. */
  targetReference?: RobotObjectReference;

  /** Concrete action semantics owned by this task. */
  properties?: RobotActionProperties;

  /** Optional planning and execution timing. */
  time?: RobotTaskTime;

  /** Optional viewer camera state associated with the annotation. */
  viewpoint?: TaskViewpoint;

  /** Optional marker position in viewer coordinates. */
  markerPosition?: [number, number, number];

  /** Optional explicit creation timestamp, useful when restoring domain data. */
  createdAt?: string;
}

/**
 * Error raised when a builder cannot preserve a domain invariant, such as a
 * required name being empty or a mission receiving a duplicate task ID.
 */
export class RobotTaskDomainError extends Error {
  /**
   * Creates a domain-specific error while preserving the standard Error API.
   *
   * @param message Human-readable explanation of the violated invariant.
   */
  constructor(message: string) {
    super(message);
    this.name = "RobotTaskDomainError";
  }
}

/**
 * Normalizes and validates a required textual value.
 *
 * Leading and trailing whitespace is removed so IDs and names are stored in a
 * canonical form. A value containing only whitespace violates the same domain
 * invariant as an empty string.
 *
 * @param value Raw text supplied by the caller.
 * @param field Field label included in a possible error message.
 * @returns The trimmed, non-empty text.
 * @throws RobotTaskDomainError When the normalized value is empty.
 */
const requireText = (value: string, field: string) => {
  // The normalized value is reused for both validation and the returned field.
  const trimmed = value.trim();
  if (!trimmed) throw new RobotTaskDomainError(`${field} is required.`);
  return trimmed;
};

/**
 * Produces a canonical comparison key for an IFC object reference.
 *
 * GlobalId takes precedence because it is the durable IFC identifier. When a
 * GlobalId is unavailable, modelId and expressId are combined because express
 * IDs are unique only inside one model.
 *
 * @param reference IFC object reference to identify.
 * @returns A namespaced key suitable for equality and duplicate checks.
 */
const referenceKey = (reference: RobotObjectReference) => {
  if (reference.globalId) return `global:${reference.globalId}`;
  return `express:${reference.modelId}:${reference.expressId}`;
};

/**
 * Adds an IFC object reference to an immutable collection unless the same
 * durable or model-local identity is already present.
 *
 * @param references Existing reference collection. It is never mutated.
 * @param reference Candidate reference to add.
 * @returns The original array for a duplicate, otherwise a new extended array.
 */
const addUniqueReference = (
  references: RobotObjectReference[],
  reference: RobotObjectReference,
) => {
  // The candidate key is calculated once and compared with every existing key.
  const key = referenceKey(reference);
  return references.some((candidate) => referenceKey(candidate) === key)
    ? references
    : [...references, reference];
};

/**
 * Returns an immutable task copy with a new modification timestamp.
 *
 * Centralizing this small operation ensures every assignment helper updates the
 * timestamp consistently without changing the original task object.
 *
 * @param task Task whose timestamp should be updated.
 * @param updatedAt ISO 8601 timestamp representing the modification time.
 * @returns A shallow task copy with the supplied updatedAt value.
 */
const touchTask = (task: RobotTask, updatedAt: string): RobotTask => ({
  ...task,
  updatedAt,
});

/**
 * Creates a new mission parent container with no child tasks or sequences.
 *
 * Required textual fields are trimmed and validated. Optional lifecycle values
 * receive deterministic defaults, and both timestamps initially refer to the
 * same creation instant. The optional `now` parameter makes tests and imports
 * deterministic without coupling the domain model to a clock service.
 *
 * @param input Descriptive values and optional schedule for the mission.
 * @param now Default ISO 8601 timestamp used when input.createdAt is absent.
 * @returns A valid empty RobotMission ready to receive child tasks.
 * @throws RobotTaskDomainError When the mission ID or name is empty.
 */
export const createMission = (
  input: CreateMissionInput,
  now = new Date().toISOString(),
): RobotMission => {
  // A supplied creation timestamp is preserved; otherwise the current time wins.
  const createdAt = input.createdAt ?? now;
  return {
    id: requireText(input.id, "Mission id"),
    name: requireText(input.name, "Mission name"),
    description: input.description,
    status: input.status ?? "planned",
    priority: input.priority ?? "medium",
    tasks: [],
    sequences: [],
    schedule: input.schedule,
    createdAt,
    updatedAt: createdAt,
  };
};

/**
 * Creates one executable robot task from caller-provided domain data.
 *
 * Required text is normalized, status and priority receive defaults, and target
 * collections are copied so later caller mutations cannot modify the task by
 * reference. Action-specific completeness, such as MOVE references, is checked
 * separately by validateTask so partially authored forms can still be modeled.
 *
 * @param input Identity, action semantics, references, and optional metadata.
 * @param now Default ISO 8601 timestamp used when input.createdAt is absent.
 * @returns A new RobotTask with independent target and affected-object arrays.
 * @throws RobotTaskDomainError When the task ID or name is empty.
 */
export const createRobotTask = (
  input: CreateRobotTaskInput,
  now = new Date().toISOString(),
): RobotTask => {
  // Creation and initial modification timestamps must describe the same instant.
  const createdAt = input.createdAt ?? now;
  return {
    id: requireText(input.id, "Task id"),
    name: requireText(input.name, "Task name"),
    description: input.description,
    actionType: input.actionType,
    status: input.status ?? "planned",
    priority: input.priority ?? "medium",
    targetObjects: [...(input.targetObjects ?? [])],
    affectedObjects: [...(input.affectedObjects ?? [])],
    startReference: input.startReference,
    targetReference: input.targetReference,
    properties: input.properties,
    time: input.time,
    viewpoint: input.viewpoint,
    markerPosition: input.markerPosition,
    createdAt,
    updatedAt: createdAt,
  };
};

/**
 * Adds an executable task as a child of a mission without mutating either input.
 *
 * Task IDs must be unique inside a mission because hierarchy and sequence
 * relations refer to tasks by ID. The mission modification timestamp advances
 * only after the duplicate check succeeds.
 *
 * @param mission Parent mission that receives the executable child task.
 * @param task Task to append to the mission hierarchy.
 * @param now ISO 8601 timestamp recorded as the mission modification time.
 * @returns A new mission containing the existing tasks followed by the new task.
 * @throws RobotTaskDomainError When another task already uses the same ID.
 */
export const addSubtask = (
  mission: RobotMission,
  task: RobotTask,
  now = new Date().toISOString(),
): RobotMission => {
  if (mission.tasks.some((existingTask) => existingTask.id === task.id)) {
    throw new RobotTaskDomainError(`Task id ${task.id} already exists.`);
  }
  return { ...mission, tasks: [...mission.tasks, task], updatedAt: now };
};

/**
 * Associates a directly targeted or contextual IFC object with a task.
 *
 * The operation is immutable and idempotent: assigning the same IFC identity a
 * second time does not create a duplicate entry. The task timestamp is updated
 * even when the candidate reference was already present, recording the attempted
 * domain update consistently with the other assignment helpers.
 *
 * @param task Task that operates on or otherwise directly references the object.
 * @param reference Stable IFC object identity to assign.
 * @param now ISO 8601 timestamp recorded as the task modification time.
 * @returns A task copy containing the unique target reference.
 */
export const assignTargetObject = (
  task: RobotTask,
  reference: RobotObjectReference,
  now = new Date().toISOString(),
): RobotTask =>
  touchTask(
    {
      ...task,
      targetObjects: addUniqueReference(task.targetObjects, reference),
    },
    now,
  );

/**
 * Associates an indirectly affected IFC object with a task.
 *
 * Affected objects are deliberately stored separately from direct targets so a
 * later IFC mapper can choose the correct relationship role. Equality uses the
 * same durable-reference rules as assignTargetObject.
 *
 * @param task Task whose execution affects the object indirectly.
 * @param reference Stable IFC object identity to assign.
 * @param now ISO 8601 timestamp recorded as the task modification time.
 * @returns A task copy containing the unique affected-object reference.
 */
export const assignAffectedObject = (
  task: RobotTask,
  reference: RobotObjectReference,
  now = new Date().toISOString(),
): RobotTask =>
  touchTask(
    {
      ...task,
      affectedObjects: addUniqueReference(task.affectedObjects, reference),
    },
    now,
  );

/**
 * Assigns the origin and destination used by a movement task.
 *
 * This helper does not silently change actionType to MOVE; callers remain
 * responsible for choosing the action, while validateTask verifies that every
 * MOVE task has both references. Keeping both arguments required prevents this
 * builder from producing a half-updated movement pair.
 *
 * @param task Task receiving the movement references.
 * @param startReference Object or spatial reference from which movement starts.
 * @param targetReference Object or spatial reference at which movement ends.
 * @param now ISO 8601 timestamp recorded as the task modification time.
 * @returns A task copy with both movement references assigned.
 */
export const assignMovementReferences = (
  task: RobotTask,
  startReference: RobotObjectReference,
  targetReference: RobotObjectReference,
  now = new Date().toISOString(),
): RobotTask => touchTask({ ...task, startReference, targetReference }, now);

/**
 * Replaces the concrete robot-action property set owned by a task.
 *
 * The properties are intentionally assigned to RobotTask rather than to any IFC
 * object reference. Consequently, the same door or switch may participate in
 * several tasks that request different states or capabilities.
 *
 * @param task Task that owns the concrete action semantics.
 * @param properties Complete replacement RobotActionProperties value.
 * @param now ISO 8601 timestamp recorded as the task modification time.
 * @returns A task copy with the supplied action properties.
 */
export const assignRobotActionProperties = (
  task: RobotTask,
  properties: RobotActionProperties,
  now = new Date().toISOString(),
): RobotTask => touchTask({ ...task, properties }, now);
