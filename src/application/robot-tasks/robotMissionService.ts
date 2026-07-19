import {
  addTaskSequence,
  addTaskToMission,
  assignAffectedObject,
  assignMovementReferences,
  assignRobotActionProperties,
  assignTargetObject,
  assignTaskTime,
  createRobotMission,
  createRobotTask,
  createTaskSequence,
  validateMission,
} from "../../domain/robot-tasks";
import type {
  CreateMissionInput,
  CreateRobotTaskInput,
  CreateTaskSequenceInput,
  RobotActionProperties,
  RobotMission,
  RobotObjectReference,
  RobotTask,
  RobotTaskTime,
  RobotTaskValidationIssue,
} from "../../domain/robot-tasks";
import type { RobotMissionRepository } from "./missionRepository";
import { RobotMissionServiceError } from "./robotMissionServiceError";

/** Mutable RobotTask fields accepted by the application-level update command. */
export type RobotTaskUpdate = Partial<
  Pick<
    RobotTask,
    | "name"
    | "description"
    | "actionType"
    | "status"
    | "priority"
    | "targetObjects"
    | "affectedObjects"
    | "startReference"
    | "targetReference"
    | "properties"
    | "time"
    | "viewpoint"
    | "markerPosition"
  >
>;

/** Semantic collection to which a viewer selection should be assigned. */
export type RobotObjectAssignmentRole = "target" | "affected";

/**
 * Clock port used to keep timestamps deterministic in tests and replaceable in
 * other runtimes.
 */
export interface RobotMissionClock {
  /** @returns The current time as an ISO 8601 string. */
  now(): string;
}

/** Default system clock used when the caller does not inject another clock. */
const systemClock: RobotMissionClock = {
  now: () => new Date().toISOString(),
};

/**
 * Checks whether a task-update command explicitly contains one mutable field.
 *
 * Property presence is different from value coalescing for optional fields: an
 * explicitly supplied `undefined` clears existing optional data, while an
 * omitted property leaves the current value unchanged.
 *
 * @param update Task patch supplied by the application caller.
 * @param field Mutable field whose presence should be checked.
 * @returns True when the patch owns the property, including value undefined.
 */
const hasOwnUpdateField = (
  update: RobotTaskUpdate,
  field: keyof RobotTaskUpdate,
) => Object.prototype.hasOwnProperty.call(update, field);

/**
 * Application boundary for creating and editing robot-mission aggregates.
 *
 * The service coordinates immutable domain builders and one persistence port.
 * It does not read viewer selections, render markers, subscribe to UI events,
 * access localStorage directly, or decide how missions will map to IFC.
 */
export class RobotMissionService {
  /** Repository that owns persisted mission state. */
  private readonly repository: RobotMissionRepository;

  /** Clock used for every timestamp produced by an application command. */
  private readonly clock: RobotMissionClock;

  /**
   * Creates a mission service with replaceable persistence and time sources.
   *
   * @param repository Persistence port used as the service's source of truth.
   * @param clock Optional deterministic clock; defaults to the system clock.
   */
  constructor(
    repository: RobotMissionRepository,
    clock: RobotMissionClock = systemClock,
  ) {
    this.repository = repository;
    this.clock = clock;
  }

  /**
   * Lists the missions currently known to the repository.
   *
   * @returns Every stored RobotMission.
   */
  listMissions(): RobotMission[] {
    return this.repository.list();
  }

  /**
   * Retrieves one mission without involving the viewer or domain mapping code.
   *
   * @param missionId Stable mission identifier.
   * @returns The stored mission when found; otherwise null.
   */
  getMission(missionId: string): RobotMission | null {
    return this.repository.get(missionId);
  }

  /**
   * Creates and persists an empty mission container.
   *
   * Empty missions are intentionally allowed as authoring drafts. Callers run
   * validateMission explicitly once they need to check executability.
   *
   * @param input Identity and optional metadata for the new mission.
   * @returns The newly persisted RobotMission.
   * @throws RobotMissionServiceError When the mission ID already exists.
   */
  createMission(input: CreateMissionInput): RobotMission {
    const now = this.clock.now();
    const mission = createRobotMission(input, now);
    if (this.repository.get(mission.id)) {
      throw new RobotMissionServiceError(
        `Mission ${mission.id} already exists.`,
      );
    }
    return this.saveMission(mission);
  }

  /**
   * Deletes an existing mission and all child data contained in its aggregate.
   *
   * @param missionId Stable identifier of the mission to delete.
   * @throws RobotMissionServiceError When the mission does not exist.
   */
  deleteMission(missionId: string): void {
    this.requireMission(missionId);
    this.repository.delete(missionId);
  }

  /**
   * Creates an executable task and adds it to a mission as a child task.
   *
   * The domain builders normalize required fields and reject duplicate task IDs.
   * The mission and task receive the same command timestamp.
   *
   * @param missionId Identifier of the parent mission.
   * @param input Identity, action, references, and optional task metadata.
   * @returns The persisted mission containing the new task.
   */
  addTask(missionId: string, input: CreateRobotTaskInput): RobotMission {
    const mission = this.requireMission(missionId);
    const now = this.clock.now();
    const task = createRobotTask(input, now);
    return this.saveMission(addTaskToMission(mission, task, now));
  }

  /**
   * Replaces selected mutable fields of one task without changing its identity.
   *
   * Task ID and creation time are always preserved. Collection fields are copied
   * so callers cannot later mutate persisted task state through their input
   * arrays. Full action-specific validity remains an explicit validation step,
   * allowing a future task form to save incomplete drafts incrementally.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task to edit.
   * @param update Mutable task fields that should replace current values.
   * @returns The persisted mission containing the updated task.
   */
  updateTask(
    missionId: string,
    taskId: string,
    update: RobotTaskUpdate,
  ): RobotMission {
    return this.updateTaskInMission(missionId, taskId, (task, now) => {
      const nextTask = this.rebuildTask(task, update, now);
      return nextTask;
    });
  }

  /**
   * Deletes a child task and every sequence edge that references it.
   *
   * Removing incident edges is required to keep the mission graph structurally
   * sound and prevents dangling predecessor or successor IDs.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task to remove.
   * @returns The persisted mission without the task and its sequence relations.
   */
  deleteTask(missionId: string, taskId: string): RobotMission {
    const mission = this.requireMission(missionId);
    this.requireTask(mission, taskId);
    const now = this.clock.now();
    return this.saveMission({
      ...mission,
      tasks: mission.tasks.filter((task) => task.id !== taskId),
      sequences: mission.sequences.filter(
        (sequence) =>
          sequence.predecessorTaskId !== taskId &&
          sequence.successorTaskId !== taskId,
      ),
      updatedAt: now,
    });
  }

  /**
   * Adds a directed temporal dependency between two mission tasks.
   *
   * The existing sequencing builder checks endpoint existence, duplicate IDs,
   * self-references, and cycles before the changed mission is persisted.
   *
   * @param missionId Identifier of the mission that owns both tasks.
   * @param input Sequence ID, predecessor, successor, and dependency semantics.
   * @returns The persisted mission containing the new dependency.
   */
  sequenceTasks(
    missionId: string,
    input: CreateTaskSequenceInput,
  ): RobotMission {
    const mission = this.requireMission(missionId);
    const now = this.clock.now();
    const sequence = createTaskSequence(input);
    return this.saveMission(addTaskSequence(mission, sequence, now));
  }

  /**
   * Assigns a snapshot of selected IFC objects to a task.
   *
   * A viewer adapter must convert its library-specific selection into
   * RobotObjectReference values before invoking this method. The role is an
   * application decision, while reference identity and duplicate handling are
   * delegated to the domain builders.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task receiving the selected objects.
   * @param role Whether the objects are direct targets or indirectly affected.
   * @param references Domain references produced from the viewer selection.
   * @returns The persisted mission containing the assigned references.
   * @throws RobotMissionServiceError When the selection is empty.
   */
  assignSelectedObjectsToTask(
    missionId: string,
    taskId: string,
    role: RobotObjectAssignmentRole,
    references: readonly RobotObjectReference[],
  ): RobotMission {
    if (!references.length) {
      throw new RobotMissionServiceError(
        "At least one selected IFC object is required.",
      );
    }
    return this.updateTaskInMission(missionId, taskId, (task, now) =>
      references.reduce(
        (currentTask, reference) =>
          role === "target"
            ? assignTargetObject(currentTask, reference, now)
            : assignAffectedObject(currentTask, reference, now),
        task,
      ),
    );
  }

  /**
   * Assigns the start and destination references of a MOVE task.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task receiving the movement pair.
   * @param startReference Object or spatial reference at the movement origin.
   * @param targetReference Object or spatial reference at the destination.
   * @returns The persisted mission containing both movement references.
   */
  assignMovementReferencesToTask(
    missionId: string,
    taskId: string,
    startReference: RobotObjectReference,
    targetReference: RobotObjectReference,
  ): RobotMission {
    return this.updateTaskInMission(missionId, taskId, (task, now) =>
      assignMovementReferences(task, startReference, targetReference, now),
    );
  }

  /**
   * Replaces the concrete RobotAction properties owned by a task.
   *
   * The service never attaches these properties to selected object references.
   * This preserves the domain rule that action semantics belong to RobotTask.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task owning the action properties.
   * @param properties Replacement action semantics.
   * @returns The persisted mission containing the updated task.
   */
  assignRobotActionPropertiesToTask(
    missionId: string,
    taskId: string,
    properties: RobotActionProperties,
  ): RobotMission {
    return this.updateTaskInMission(missionId, taskId, (task, now) =>
      assignRobotActionProperties(task, properties, now),
    );
  }

  /**
   * Replaces direct task timing intended for a future IfcTaskTime mapping.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task receiving timing information.
   * @param time Replacement task schedule and execution timing.
   * @returns The persisted mission containing the updated timing.
   */
  assignTaskTimeToTask(
    missionId: string,
    taskId: string,
    time: RobotTaskTime,
  ): RobotMission {
    return this.updateTaskInMission(missionId, taskId, (task, now) =>
      assignTaskTime(task, time, now),
    );
  }

  /**
   * Runs domain validation for the currently persisted mission aggregate.
   *
   * @param missionId Identifier of the mission to validate.
   * @returns All blocking errors and non-blocking warnings found by the domain.
   */
  validateMission(missionId: string): RobotTaskValidationIssue[] {
    return validateMission(this.requireMission(missionId));
  }

  /**
   * Applies one immutable task transformation and persists the resulting mission.
   *
   * @param missionId Identifier of the parent mission.
   * @param taskId Identifier of the task to transform.
   * @param update Pure task operation receiving one shared command timestamp.
   * @returns The persisted mission containing the transformed task.
   */
  private updateTaskInMission(
    missionId: string,
    taskId: string,
    update: (task: RobotTask, now: string) => RobotTask,
  ): RobotMission {
    const mission = this.requireMission(missionId);
    const currentTask = this.requireTask(mission, taskId);
    const now = this.clock.now();
    const updatedTask = update(currentTask, now);
    return this.saveMission({
      ...mission,
      tasks: mission.tasks.map((task) =>
        task.id === taskId ? updatedTask : task,
      ),
      updatedAt: now,
    });
  }

  /**
   * Reconstructs a task update through the domain factory while preserving the
   * immutable identity and creation timestamp of the existing task.
   *
   * @param task Current persisted task.
   * @param update Mutable fields supplied by the application caller.
   * @param now Modification timestamp for the rebuilt task.
   * @returns An updated RobotTask with copied collection values.
   */
  private rebuildTask(
    task: RobotTask,
    update: RobotTaskUpdate,
    now: string,
  ): RobotTask {
    const rebuiltTask = createRobotTask(
      {
        id: task.id,
        name: update.name ?? task.name,
        description: hasOwnUpdateField(update, "description")
          ? update.description
          : task.description,
        actionType: update.actionType ?? task.actionType,
        status: update.status ?? task.status,
        priority: update.priority ?? task.priority,
        targetObjects: update.targetObjects ?? task.targetObjects,
        affectedObjects: update.affectedObjects ?? task.affectedObjects,
        startReference: hasOwnUpdateField(update, "startReference")
          ? update.startReference
          : task.startReference,
        targetReference: hasOwnUpdateField(update, "targetReference")
          ? update.targetReference
          : task.targetReference,
        properties: hasOwnUpdateField(update, "properties")
          ? update.properties
          : task.properties,
        time: hasOwnUpdateField(update, "time") ? update.time : task.time,
        viewpoint: hasOwnUpdateField(update, "viewpoint")
          ? update.viewpoint
          : task.viewpoint,
        markerPosition: hasOwnUpdateField(update, "markerPosition")
          ? update.markerPosition
          : task.markerPosition,
        createdAt: task.createdAt,
      },
      now,
    );
    return {
      ...rebuiltTask,
      status: hasOwnUpdateField(update, "status")
        ? update.status
        : rebuiltTask.status,
      priority: hasOwnUpdateField(update, "priority")
        ? update.priority
        : rebuiltTask.priority,
      updatedAt: now,
    };
  }

  /**
   * Retrieves a mission or turns an absent aggregate into a command error.
   *
   * @param missionId Identifier of the required mission.
   * @returns The persisted mission.
   * @throws RobotMissionServiceError When no mission uses the identifier.
   */
  private requireMission(missionId: string): RobotMission {
    const mission = this.repository.get(missionId);
    if (!mission) {
      throw new RobotMissionServiceError(
        `Mission ${missionId} does not exist.`,
      );
    }
    return mission;
  }

  /**
   * Resolves one child task inside an already loaded mission aggregate.
   *
   * @param mission Parent mission containing executable tasks.
   * @param taskId Identifier of the required child task.
   * @returns The matching RobotTask.
   * @throws RobotMissionServiceError When the task is absent.
   */
  private requireTask(mission: RobotMission, taskId: string): RobotTask {
    const task = mission.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new RobotMissionServiceError(`Task ${taskId} does not exist.`);
    }
    return task;
  }

  /**
   * Persists one complete mission aggregate and returns the same value for
   * fluent command implementations.
   *
   * @param mission Mission aggregate to upsert through the repository port.
   * @returns The persisted mission.
   */
  private saveMission(mission: RobotMission): RobotMission {
    this.repository.save(mission);
    return mission;
  }
}
