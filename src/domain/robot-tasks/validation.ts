import { validateTaskSequence } from "./sequencing";
import { ROBOT_ACTION_TYPES } from "./types";
import type {
  RobotMission,
  RobotObjectReference,
  RobotTask,
  RobotTaskValidationIssue,
} from "./types";

/**
 * Constructs one consistently shaped validation issue.
 *
 * Most validation findings are errors, so severity defaults to error. Callers
 * can explicitly request warning for uncertainty that should not invalidate the
 * domain object, such as missing IFC class information.
 *
 * @param code Stable machine-readable identifier of the validation rule.
 * @param message Human-readable explanation of the finding.
 * @param taskId Optional ID of the affected task.
 * @param severity Blocking error or non-blocking warning.
 * @returns A RobotTaskValidationIssue ready to append to a result collection.
 */
const issue = (
  code: string,
  message: string,
  taskId?: string,
  severity: "error" | "warning" = "error",
): RobotTaskValidationIssue => ({ code, severity, message, taskId });

/**
 * Validates the runtime values inside one IFC object reference.
 *
 * The TypeScript union prevents most invalid references at compile time, but
 * runtime validation remains necessary for deserialized JSON or untyped external
 * data. GlobalIds may not be blank, express IDs must be non-negative integers,
 * and a local express ID requires a model ID when no GlobalId exists.
 *
 * @param reference Object reference whose identifier values should be checked.
 * @param taskId Task that owns the reference, used to contextualize issues.
 * @returns Every identifier-related issue found for this reference.
 */
const validateReference = (
  reference: RobotObjectReference,
  taskId: string,
): RobotTaskValidationIssue[] => {
  // Local accumulator allows multiple independent reference defects to be shown.
  const issues: RobotTaskValidationIssue[] = [];
  if (
    reference.globalId !== undefined &&
    (typeof reference.globalId !== "string" || !reference.globalId.trim())
  ) {
    issues.push(
      issue("OBJECT_GLOBAL_ID_INVALID", "GlobalId must not be empty.", taskId),
    );
  }
  if (reference.expressId !== undefined) {
    if (!Number.isInteger(reference.expressId) || reference.expressId < 0) {
      issues.push(
        issue(
          "OBJECT_EXPRESS_ID_INVALID",
          "Express ID must be a non-negative integer.",
          taskId,
        ),
      );
    }
    if (
      !reference.globalId &&
      (typeof reference.modelId !== "string" || !reference.modelId.trim())
    ) {
      issues.push(
        issue(
          "OBJECT_MODEL_ID_REQUIRED",
          "A model-local express ID requires a modelId.",
          taskId,
        ),
      );
    }
  }

  // Deserialized data can bypass TypeScript and place action semantics on a
  // reference. Static object metadata is allowed; only RobotAction-shaped
  // properties are rejected because those values must belong to the task.
  const unknownReference = reference as unknown as Record<string, unknown>;

  // Potential nested property record inspected for task-only RobotAction fields.
  const embeddedProperties = unknownReference.properties;
  if (
    embeddedProperties &&
    typeof embeddedProperties === "object" &&
    [
      "targetState",
      "targetObjectRole",
      "affectedObjectRole",
      "requiredCapability",
      "preconditions",
      "postconditions",
      "successCondition",
    ].some((propertyName) => propertyName in embeddedProperties)
  ) {
    issues.push(
      issue(
        "OBJECT_ACTION_PROPERTIES_FORBIDDEN",
        "RobotAction properties must be attached to the task, not an object reference.",
        taskId,
      ),
    );
  }
  return issues;
};

/**
 * Checks the known IFC class of every direct target against an action-specific
 * predicate.
 *
 * Missing IFC type information produces a warning because the action may still
 * be plausible. A known but incompatible type produces a blocking error. The
 * caller supplies the actual matching rule so door and switch validation share
 * the same reporting behavior.
 *
 * @param task Task whose direct target objects should be inspected.
 * @param expectedLabel Human-readable object category used in messages.
 * @param matches Predicate that accepts a normalized uppercase IFC class.
 * @returns Warnings and errors describing target-type compatibility.
 */
const validateTargetClass = (
  task: RobotTask,
  expectedLabel: string,
  matches: (ifcClass: string) => boolean,
) => {
  // Every target is checked independently because a task may target many objects.
  const issues: RobotTaskValidationIssue[] = [];
  for (const target of task.targetObjects) {
    if (!target.ifcClass) {
      issues.push(
        issue(
          "TARGET_TYPE_UNKNOWN",
          `Target type is unavailable; expected a ${expectedLabel} object.`,
          task.id,
          "warning",
        ),
      );
    } else if (!matches(target.ifcClass.toUpperCase())) {
      issues.push(
        issue(
          "TARGET_TYPE_MISMATCH",
          `Action ${task.actionType} requires a ${expectedLabel} target.`,
          task.id,
        ),
      );
    }
  }
  return issues;
};

/**
 * Validates movement-specific requirements for a task.
 *
 * Non-MOVE tasks have no movement requirements and therefore produce no issues.
 * A MOVE task is executable only when both its origin and destination references
 * are present.
 *
 * @param task Task whose movement references should be checked.
 * @returns Missing-reference errors for MOVE tasks, otherwise an empty array.
 */
export function validateMovementTask(
  task: RobotTask,
): RobotTaskValidationIssue[] {
  if (task.actionType !== "MOVE") return [];

  // Accumulates the missing origin and destination findings for this MOVE task.
  const issues: RobotTaskValidationIssue[] = [];
  if (!task.startReference) {
    issues.push(
      issue("MOVE_START_REQUIRED", "MOVE requires a start reference.", task.id),
    );
  }
  if (!task.targetReference) {
    issues.push(
      issue(
        "MOVE_TARGET_REQUIRED",
        "MOVE requires a target reference.",
        task.id,
      ),
    );
  }
  return issues;
}

/**
 * Validates actions that directly interact with or pass through IFC objects.
 *
 * OPEN, CLOSE, SWITCH_ON, and SWITCH_OFF require at least one direct target.
 * PASS_THROUGH requires at least one object reference, either direct or affected,
 * so openings and equivalent navigation references can be represented. Known IFC
 * types are additionally checked for door-like and switch-like compatibility.
 *
 * @param task Task whose object interaction requirements should be checked.
 * @returns Object-reference errors and IFC type warnings or errors.
 */
export function validateObjectInteractionTask(
  task: RobotTask,
): RobotTaskValidationIssue[] {
  // Accumulates all object-reference and IFC-class findings for this task.
  const issues: RobotTaskValidationIssue[] = [];

  // Actions that manipulate an object directly must name at least one target.
  const requiresTarget = ["OPEN", "CLOSE", "SWITCH_ON", "SWITCH_OFF"];
  if (requiresTarget.includes(task.actionType) && !task.targetObjects.length) {
    issues.push(
      issue(
        "TASK_TARGET_REQUIRED",
        `${task.actionType} requires at least one target object.`,
        task.id,
      ),
    );
  }
  if (
    task.actionType === "PASS_THROUGH" &&
    !task.targetObjects.length &&
    !task.affectedObjects.length
  ) {
    issues.push(
      issue(
        "PASS_THROUGH_REFERENCE_REQUIRED",
        "PASS_THROUGH requires at least one referenced object.",
        task.id,
      ),
    );
  }
  if (task.actionType === "OPEN" || task.actionType === "CLOSE") {
    issues.push(
      ...validateTargetClass(task, "door-like", (ifcClass) =>
        ifcClass.includes("DOOR"),
      ),
    );
  }
  if (task.actionType === "SWITCH_ON" || task.actionType === "SWITCH_OFF") {
    issues.push(
      ...validateTargetClass(task, "switch-like", (ifcClass) =>
        ifcClass.includes("SWITCH"),
      ),
    );
  }
  return issues;
}

/**
 * Validates one executable task independently of its containing mission.
 *
 * The function checks required identity and action fields, every IFC reference,
 * completion bounds, action-specific reference requirements, and compatible IFC
 * target classes when type information is available. It collects all findings
 * rather than throwing so callers can display complete authoring feedback.
 *
 * @param task Executable task to validate.
 * @returns All blocking errors and non-blocking warnings found on the task.
 */
export const validateTask = (task: RobotTask): RobotTaskValidationIssue[] => {
  // Mutable accumulator scoped to this validation pass.
  const issues: RobotTaskValidationIssue[] = [];
  if (typeof task.id !== "string" || !task.id.trim()) {
    issues.push(issue("TASK_ID_REQUIRED", "Task id is required."));
  }
  if (typeof task.name !== "string" || !task.name.trim()) {
    issues.push(issue("TASK_NAME_REQUIRED", "Task name is required.", task.id));
  }

  // Runtime membership protects against malformed data that bypassed TypeScript.
  const actionTypeIsValid = (ROBOT_ACTION_TYPES as readonly unknown[]).includes(
    task.actionType,
  );
  if (!actionTypeIsValid) {
    issues.push(
      issue(
        task.actionType
          ? "TASK_ACTION_TYPE_UNSUPPORTED"
          : "TASK_ACTION_TYPE_REQUIRED",
        task.actionType
          ? `Unsupported robot action type ${String(task.actionType)}.`
          : "Task actionType is required.",
        task.id,
      ),
    );
  }

  // Flatten every reference-bearing task field so identity rules are applied once.
  const references = [
    ...task.targetObjects,
    ...task.affectedObjects,
    ...(task.startReference ? [task.startReference] : []),
    ...(task.targetReference ? [task.targetReference] : []),
  ];
  for (const reference of references) {
    issues.push(...validateReference(reference, task.id));
  }

  if (task.time?.completion !== undefined) {
    // Local binding keeps the numeric range expression concise and readable.
    const { completion } = task.time;
    if (!Number.isFinite(completion) || completion < 0 || completion > 1) {
      issues.push(
        issue(
          "TASK_COMPLETION_OUT_OF_RANGE",
          "Task completion must be between 0 and 1.",
          task.id,
        ),
      );
    }
  }

  // Invalid action values cannot be evaluated against action-specific rules.
  if (actionTypeIsValid) {
    issues.push(...validateMovementTask(task));
    issues.push(...validateObjectInteractionTask(task));
  }
  return issues;
};

/**
 * Validates a complete mission, its executable child tasks, and their sequence
 * graph.
 *
 * Mission identity and non-empty hierarchy are checked first. Task IDs must be
 * unique because sequence endpoints use those IDs. Each task then receives its
 * own domain validation, followed by graph validation across all dependencies.
 * The returned list is a complete aggregate suitable for UI or backend use.
 *
 * @param mission Mission aggregate to validate.
 * @returns Every mission-, task-, reference-, timing-, and sequence-level issue.
 */
export const validateMission = (
  mission: RobotMission,
): RobotTaskValidationIssue[] => {
  // Aggregate accumulator preserves findings from every validation level.
  const issues: RobotTaskValidationIssue[] = [];
  if (typeof mission.id !== "string" || !mission.id.trim()) {
    issues.push(issue("MISSION_ID_REQUIRED", "Mission id is required."));
  }
  if (typeof mission.name !== "string" || !mission.name.trim()) {
    issues.push(issue("MISSION_NAME_REQUIRED", "Mission name is required."));
  }
  if (!mission.tasks.length) {
    issues.push(
      issue("MISSION_TASK_REQUIRED", "Mission requires an executable task."),
    );
  }

  // Tracks IDs already encountered while walking the mission's child tasks.
  const taskIds = new Set<string>();
  for (const task of mission.tasks) {
    if (taskIds.has(task.id)) {
      issues.push(
        issue("TASK_ID_DUPLICATE", `Duplicate task id ${task.id}.`, task.id),
      );
    }
    taskIds.add(task.id);
    issues.push(...validateTask(task));
  }
  issues.push(...validateTaskSequence(mission.tasks, mission.sequences));
  return issues;
};
