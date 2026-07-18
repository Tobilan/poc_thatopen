import { RobotTaskDomainError } from "./builders";
import type {
  RobotMission,
  RobotTask,
  RobotTaskSequence,
  RobotTaskSequenceType,
  RobotTaskValidationIssue,
} from "./types";

/** Input required to create one directed task dependency. */
export interface CreateTaskSequenceInput {
  /** Stable application-level identifier of the sequence relation. */
  id: string;

  /** ID of the task that must occur first. */
  predecessorTaskId: string;

  /** ID of the task constrained by the predecessor. */
  successorTaskId: string;

  /** Temporal dependency semantics; defaults to FINISH_START. */
  sequenceType?: RobotTaskSequenceType;
}

/**
 * Creates a normalized directed dependency between two executable tasks.
 *
 * IDs are trimmed to avoid visually identical sequence or task references that
 * differ only by whitespace. Structural correctness is intentionally checked by
 * validateTaskSequence or addTaskSequence because this factory does not receive the
 * mission task collection needed to resolve the referenced IDs.
 *
 * @param input Sequence identity, predecessor, successor, and optional type.
 * @returns A normalized RobotTaskSequence using FINISH_START by default.
 */
export const createTaskSequence = (
  input: CreateTaskSequenceInput,
): RobotTaskSequence => ({
  id: input.id.trim(),
  predecessorTaskId: input.predecessorTaskId.trim(),
  successorTaskId: input.successorTaskId.trim(),
  sequenceType: input.sequenceType ?? "FINISH_START",
});

/**
 * Detects whether directed task dependencies contain at least one cycle.
 *
 * The function builds an adjacency list and performs depth-first traversal.
 * Encountering a task that is already in the active recursion path proves that
 * following successor edges can return to an unfinished predecessor. Completed
 * branches are cached so they are not traversed repeatedly.
 *
 * @param sequences Directed dependencies to analyze as a graph.
 * @returns True when any dependency cycle exists; otherwise false.
 */
export const hasTaskSequenceCycle = (sequences: RobotTaskSequence[]) => {
  // Maps every predecessor task ID to all task IDs that directly follow it.
  const successors = new Map<string, string[]>();
  for (const sequence of sequences) {
    // Reuse the existing successor list or start a new list for this predecessor.
    const current = successors.get(sequence.predecessorTaskId) ?? [];
    current.push(sequence.successorTaskId);
    successors.set(sequence.predecessorTaskId, current);
  }

  // IDs currently on the recursive path; revisiting one identifies a cycle.
  const visiting = new Set<string>();

  // IDs whose complete successor subgraph has already been proven acyclic.
  const visited = new Set<string>();

  /**
   * Traverses the successor graph starting at one task ID.
   *
   * @param taskId Current graph node being inspected.
   * @returns True as soon as the current branch reaches an active ancestor.
   */
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const successor of successors.get(taskId) ?? []) {
      if (visit(successor)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  // Every predecessor can be a disconnected graph root, so each key is checked.
  return Array.from(successors.keys()).some(visit);
};

/**
 * Validates task dependency records against a mission's executable tasks.
 *
 * Validation reports all discoverable problems instead of throwing: missing
 * sequence IDs, self-dependencies, references to unknown tasks, and cycles.
 * This makes the result suitable for form feedback and whole-mission validation.
 *
 * @param tasks Child tasks that sequence endpoints are allowed to reference.
 * @param sequences Directed dependencies to validate.
 * @returns Every sequence-related validation issue found in the supplied graph.
 */
export const validateTaskSequence = (
  tasks: RobotTask[],
  sequences: RobotTaskSequence[],
): RobotTaskValidationIssue[] => {
  // Mutable accumulator used only inside this validation call.
  const issues: RobotTaskValidationIssue[] = [];

  // Set lookup makes endpoint resolution constant-time for every sequence edge.
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const sequence of sequences) {
    if (typeof sequence.id !== "string" || !sequence.id.trim()) {
      issues.push({
        code: "SEQUENCE_ID_REQUIRED",
        severity: "error",
        message: "A sequence id is required.",
      });
    }
    if (sequence.predecessorTaskId === sequence.successorTaskId) {
      issues.push({
        code: "SEQUENCE_SELF_REFERENCE",
        severity: "error",
        message: "A task cannot be its own predecessor.",
        sequenceId: sequence.id,
        taskId: sequence.predecessorTaskId,
      });
    }

    // Both endpoints are checked uniformly and may each produce a separate issue.
    for (const taskId of [
      sequence.predecessorTaskId,
      sequence.successorTaskId,
    ]) {
      if (!taskIds.has(taskId)) {
        issues.push({
          code: "SEQUENCE_TASK_NOT_FOUND",
          severity: "error",
          message: `Sequence references unknown task ${taskId}.`,
          sequenceId: sequence.id,
          taskId,
        });
      }
    }
  }

  if (hasTaskSequenceCycle(sequences)) {
    issues.push({
      code: "SEQUENCE_CYCLE",
      severity: "error",
      message: "Task sequences must not contain a cycle.",
    });
  }
  return issues;
};

/**
 * Adds a validated dependency to a mission without mutating the mission.
 *
 * Sequence IDs must be unique. The complete prospective graph is validated so
 * the new edge cannot reference an unknown task, point to itself, or introduce a
 * cycle through existing edges. Invalid additions fail atomically and leave the
 * original mission untouched.
 *
 * @param mission Mission whose task graph receives the dependency.
 * @param sequence New directed dependency to append.
 * @param now ISO 8601 timestamp recorded as the mission modification time.
 * @returns A mission copy containing the validated dependency.
 * @throws RobotTaskDomainError For a duplicate ID or invalid resulting graph.
 */
export const addTaskSequence = (
  mission: RobotMission,
  sequence: RobotTaskSequence,
  now = new Date().toISOString(),
): RobotMission => {
  if (mission.sequences.some((existing) => existing.id === sequence.id)) {
    throw new RobotTaskDomainError(
      `Sequence id ${sequence.id} already exists.`,
    );
  }

  // Prospective immutable sequence collection used for validation and return.
  const nextSequences = [...mission.sequences, sequence];

  // Only blocking issues prevent a builder operation; warnings remain reportable.
  const errors = validateTaskSequence(mission.tasks, nextSequences).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length) throw new RobotTaskDomainError(errors[0].message);
  return { ...mission, sequences: nextSequences, updatedAt: now };
};
