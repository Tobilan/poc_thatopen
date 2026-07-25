/**
 * Complete runtime list of robot actions supported by the current proof of
 * concept. Keeping the values in a readonly tuple provides one source of truth
 * for both compile-time typing and runtime validation.
 */
export const ROBOT_ACTION_TYPES = [
  "OPEN",
  "CLOSE",
  "SWITCH_ON",
  "SWITCH_OFF",
  "MOVE",
  "PASS_THROUGH",
  "NAVIGATE_TO",
] as const;

/** Union of every supported concrete robot action value. */
export type RobotActionType = (typeof ROBOT_ACTION_TYPES)[number];

/** Lifecycle states shared by missions and executable robot tasks. */
export type RobotTaskStatus =
  | "planned"
  | "open"
  | "in_progress"
  | "done"
  | "blocked"
  | "failed";

/** Relative importance used when missions or tasks compete for execution. */
export type RobotTaskPriority = "low" | "medium" | "high" | "critical";

/**
 * Optional descriptive data associated with an IFC object reference.
 * These fields identify or describe the object; they intentionally contain no
 * requested robot action because action semantics belong to RobotTask.
 */
interface RobotObjectReferenceMetadata {
  /**
   * Runtime identifier of the loaded IFC or Fragments model. It scopes a local
   * express ID and is therefore required when no IFC GlobalId is available.
   */
  modelId?: string;

  /**
   * Optional IFC entity type, for example IFCSPACE or IFCDOOR. Validation can
   * use this value to check whether an action targets a plausible object type.
   */
  ifcClass?: string;

  /** Optional human-readable object name copied from the source model. */
  name?: string;
}

/**
 * Stable reference to an IFC object.
 *
 * GlobalId is the preferred durable identifier. An express ID is supported as
 * a model-local fallback and therefore requires a modelId.
 */
export type RobotObjectReference = RobotObjectReferenceMetadata &
  (
    | {
        /** Preferred durable identifier of an IFC object. */
        globalId: string;

        /** Optional model-local express ID used for efficient runtime lookup. */
        expressId?: number;
      }
    | {
        /** Explicitly absent when the reference uses the local fallback form. */
        globalId?: undefined;

        /** Model that owns the model-local express ID. */
        modelId: string;

        /** Model-local IFC express ID used when no GlobalId is available. */
        expressId: number;
      }
  );

/**
 * Concrete semantics requested for one executable task. These values describe
 * what the robot should achieve and deliberately live on RobotTask instead of
 * RobotObjectReference, allowing the same IFC object to be used by different
 * tasks with different actions.
 */
export interface RobotActionProperties {
  /** Desired state after execution, for example OPEN, CLOSED, ON, or OFF. */
  targetState?: string;

  /** Semantic role of directly targeted objects in this action. */
  targetObjectRole?: string;

  /** Semantic role of objects affected indirectly by this action. */
  affectedObjectRole?: string;

  /** Robot capability required to execute the task successfully. */
  requiredCapability?: string;

  /** Conditions that must hold before execution may start. */
  preconditions?: string[];

  /** Conditions expected to hold after successful execution. */
  postconditions?: string[];

  /** Observable condition used to determine whether execution succeeded. */
  successCondition?: string;
}

/**
 * Scheduling and execution timing for one task. The structure remains separate
 * from RobotActionProperties because it is intended for a later direct mapping
 * to IfcTaskTime rather than to a custom property set.
 */
export interface RobotTaskTime {
  /** Planned ISO 8601 start timestamp. */
  scheduleStart?: string;

  /** Planned ISO 8601 finish timestamp. */
  scheduleFinish?: string;

  /** Planned ISO 8601 duration. */
  scheduleDuration?: string;

  /** Recorded ISO 8601 start timestamp. */
  actualStart?: string;

  /** Recorded ISO 8601 finish timestamp. */
  actualFinish?: string;

  /** Estimated ISO 8601 duration still required for completion. */
  remainingTime?: string;

  /** Completion ratio in the inclusive range from 0 to 1. */
  completion?: number;
}

/** Optional camera state from which a task annotation should be viewed. */
export interface TaskViewpoint {
  /** Camera position in viewer coordinates. */
  cameraPosition: [number, number, number];

  /** Point in viewer coordinates at which the camera is aimed. */
  cameraTarget: [number, number, number];
}

/**
 * One executable child step of a RobotMission. A task owns its action
 * semantics, timing, IFC object references, and optional viewer annotation
 * data, but it does not own mission hierarchy or sequence relations.
 */
export interface RobotTask {
  /** Stable application-level task identifier, unique within a mission. */
  id: string;

  /** Human-readable task name. */
  name: string;

  /** Optional longer explanation of the intended operation. */
  description?: string;

  /** Concrete robot action executed by this task. */
  actionType: RobotActionType;

  /** Current lifecycle state of the task. */
  status?: RobotTaskStatus;

  /** Scheduling or execution priority of the task. */
  priority?: RobotTaskPriority;

  /** Objects directly targeted or used as context by the action. */
  targetObjects: RobotObjectReference[];

  /** Objects affected indirectly by the action. */
  affectedObjects: RobotObjectReference[];

  /** Start reference for MOVE tasks. */
  startReference?: RobotObjectReference;

  /** Destination reference for MOVE tasks. */
  targetReference?: RobotObjectReference;

  /** Concrete action semantics belong to the task, never the object reference. */
  properties?: RobotActionProperties;

  /** Optional scheduling and execution timing. */
  time?: RobotTaskTime;

  /** Optional camera state associated with the task annotation. */
  viewpoint?: TaskViewpoint;

  /** Optional marker location in viewer coordinates. */
  markerPosition?: [number, number, number];

  /** ISO 8601 timestamp at which the task was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the most recent task change. */
  updatedAt: string;
}

/**
 * Dependency semantics between two tasks. FINISH_START is the default and
 * means that the successor may start only after the predecessor has finished.
 */
export type RobotTaskSequenceType =
  | "FINISH_START"
  | "START_START"
  | "FINISH_FINISH"
  | "START_FINISH";

/** Directed dependency from a predecessor task to a successor task. */
export interface RobotTaskSequence {
  /** Stable application-level identifier of this sequence relation. */
  id: string;

  /** ID of the task that occurs first in the dependency. */
  predecessorTaskId: string;

  /** ID of the task constrained by the predecessor. */
  successorTaskId: string;

  /** Temporal relationship applied between the two referenced tasks. */
  sequenceType: RobotTaskSequenceType;
}

/** Optional schedule metadata for the mission as a whole. */
export interface RobotMissionSchedule {
  /** Stable application-level schedule identifier. */
  id: string;

  /** Human-readable schedule name. */
  name: string;

  /** Planned ISO 8601 start timestamp of the mission schedule. */
  scheduleStart?: string;

  /** Planned ISO 8601 finish timestamp of the mission schedule. */
  scheduleFinish?: string;

  /** Planned ISO 8601 duration of the mission schedule. */
  scheduleDuration?: string;
}

/**
 * Parent container for an ordered robot workflow. The tasks array expresses
 * mission hierarchy, while the sequences array independently expresses
 * temporal dependencies between those executable child tasks.
 */
export interface RobotMission {
  /** Stable application-level mission identifier. */
  id: string;

  /** Human-readable mission name. */
  name: string;

  /** Optional longer explanation of the mission goal. */
  description?: string;

  /** Aggregate lifecycle state of the mission. */
  status?: RobotTaskStatus;

  /** Aggregate scheduling or execution priority. */
  priority?: RobotTaskPriority;

  /** Executable child tasks nested below the mission. */
  tasks: RobotTask[];

  /** Directed temporal dependencies between child tasks. */
  sequences: RobotTaskSequence[];

  /** Optional schedule controlling the mission as a whole. */
  schedule?: RobotMissionSchedule;

  /** ISO 8601 timestamp at which the mission was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the most recent mission change. */
  updatedAt: string;
}

/** Severity levels produced by domain validation. */
export type RobotTaskValidationSeverity = "error" | "warning";

/** One machine-readable and human-readable domain validation result. */
export interface RobotTaskValidationIssue {
  /** Stable code that callers can use without parsing the message text. */
  code: string;

  /** Indicates whether the issue blocks validity or only reports uncertainty. */
  severity: RobotTaskValidationSeverity;

  /** Human-readable explanation of the detected problem. */
  message: string;

  /** ID of the affected task when the issue is task-specific. */
  taskId?: string;

  /** ID of the affected sequence when the issue is sequence-specific. */
  sequenceId?: string;
}
