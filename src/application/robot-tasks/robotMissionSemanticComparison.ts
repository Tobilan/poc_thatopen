import type {
  RobotActionProperties,
  RobotMission,
  RobotMissionSchedule,
  RobotObjectReference,
  RobotTask,
  RobotTaskSequence,
  RobotTaskTime,
  TaskViewpoint,
} from "../../domain/robot-tasks";

/** Durable object identity retained by semantic roundtrip comparison. */
export type CanonicalRobotObjectReference = string;

/** Task timing after applying IFC writer/importer lexical compatibility rules. */
export type CanonicalRobotTaskTime = RobotTaskTime;

/** Executable task representation used for semantic IFC roundtrip comparison. */
export type CanonicalRobotTask = Omit<
  RobotTask,
  | "targetObjects"
  | "affectedObjects"
  | "startReference"
  | "targetReference"
  | "properties"
  | "time"
  | "viewpoint"
  | "markerPosition"
> & {
  targetObjects: CanonicalRobotObjectReference[];
  affectedObjects: CanonicalRobotObjectReference[];
  startReference?: CanonicalRobotObjectReference;
  targetReference?: CanonicalRobotObjectReference;
  properties?: RobotActionProperties;
  time?: CanonicalRobotTaskTime;
  viewpoint?: TaskViewpoint;
  markerPosition?: [number, number, number];
};

/** Mission representation with stable collection ordering and lexical values. */
export type CanonicalRobotMission = Omit<
  RobotMission,
  "tasks" | "sequences" | "schedule"
> & {
  tasks: CanonicalRobotTask[];
  sequences: RobotTaskSequence[];
  schedule?: RobotMissionSchedule;
};

/** One stable, machine-readable semantic difference between mission collections. */
export interface RobotMissionSemanticDifference {
  /** Dot/bracket path inside the canonical mission collections. */
  path: string;

  /** Canonical value expected by the caller. */
  expected: unknown;

  /** Canonical value reconstructed from IFC. */
  actual: unknown;

  /** Human-readable message suitable for an export error. */
  message: string;
}

/** Structured result returned after canonical semantic comparison. */
export interface RobotMissionSemanticComparisonResult {
  equal: boolean;
  differences: RobotMissionSemanticDifference[];
}

/** ISO timestamp form accepted by the writer when seconds are omitted. */
const MINUTE_PRECISION_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/;

/** Adds the seconds emitted by web-ifc without changing zones or wall time. */
const canonicalTimestamp = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const match = value.match(MINUTE_PRECISION_TIMESTAMP);
  return match ? `${match[1]}:00${match[2] ?? ""}` : value;
};

/** Locale-independent lexical ordering used by every canonical collection. */
const compareText = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

/** Model-scoped fallback identity when both local parts are available. */
const localReferenceKey = (
  reference: RobotObjectReference,
): string | undefined =>
  reference.modelId !== undefined && reference.expressId !== undefined
    ? `express:${reference.modelId}:${reference.expressId}`
    : undefined;

/** GlobalId learned for a model-local identity, or null when aliases conflict. */
type ReferenceAliases = ReadonlyMap<string, string | null>;

/** Collects every object reference serialized by one task. */
const taskReferences = (task: RobotTask): RobotObjectReference[] => [
  ...task.targetObjects,
  ...task.affectedObjects,
  ...(task.startReference ? [task.startReference] : []),
  ...(task.targetReference ? [task.targetReference] : []),
];

/**
 * Learns GlobalIds added by the importer to model-local source references.
 *
 * A conflict is deliberately retained as null rather than choosing either
 * GlobalId, ensuring ambiguous source identities cannot compare equal.
 */
const referenceAliases = (
  missions: readonly RobotMission[],
): ReferenceAliases => {
  const result = new Map<string, string | null>();
  for (const mission of missions) {
    for (const task of mission.tasks) {
      for (const reference of taskReferences(task)) {
        if (reference.globalId === undefined) continue;
        const localKey = localReferenceKey(reference);
        if (localKey === undefined) continue;
        const globalId = reference.globalId.trim();
        if (!result.has(localKey)) result.set(localKey, globalId);
        else if (result.get(localKey) !== globalId) result.set(localKey, null);
      }
    }
  }
  return result;
};

/**
 * Reduces an enriched viewer/import reference to its durable IFC identity.
 *
 * GlobalId deliberately takes precedence over runtime model metadata. If a
 * source object has no GlobalId, the model-scoped express ID remains the only
 * identity that can be compared safely.
 */
const canonicalReference = (
  reference: RobotObjectReference,
  aliases: ReferenceAliases,
): CanonicalRobotObjectReference => {
  if (reference.globalId !== undefined) {
    return `global:${reference.globalId.trim()}`;
  }
  const localKey = localReferenceKey(reference)!;
  const enrichedGlobalId = aliases.get(localKey);
  return enrichedGlobalId ? `global:${enrichedGlobalId}` : localKey;
};

/** IFC assignment object collections are sets, so only identities are ordered. */
const canonicalReferences = (
  references: readonly RobotObjectReference[],
  aliases: ReferenceAliases,
): CanonicalRobotObjectReference[] =>
  references
    .map((reference) => canonicalReference(reference, aliases))
    .sort(compareText);

/** Copies task-owned action semantics and preserves list ordering. */
const canonicalProperties = (
  properties: RobotActionProperties | undefined,
): RobotActionProperties | undefined => {
  if (properties === undefined) return undefined;
  const result: RobotActionProperties = {
    targetState: properties.targetState,
    targetObjectRole: properties.targetObjectRole,
    affectedObjectRole: properties.affectedObjectRole,
    requiredCapability: properties.requiredCapability,
    preconditions: properties.preconditions
      ? [...properties.preconditions]
      : undefined,
    postconditions: properties.postconditions
      ? [...properties.postconditions]
      : undefined,
    successCondition: properties.successCondition,
  };
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : undefined;
};

/** Applies the exact task-time losses and date lexical changes of the writer. */
const canonicalTaskTime = (
  time: RobotTaskTime | undefined,
): CanonicalRobotTaskTime | undefined => {
  if (time === undefined) return undefined;
  return {
    scheduleStart: canonicalTimestamp(time.scheduleStart),
    scheduleFinish: canonicalTimestamp(time.scheduleFinish),
    scheduleDuration: time.scheduleDuration,
    actualStart: canonicalTimestamp(time.actualStart),
    actualFinish: canonicalTimestamp(time.actualFinish),
    remainingTime: time.remainingTime,
    // IfcPositiveRatioMeasure excludes zero, so the writer emits it as absent.
    completion: time.completion === 0 ? undefined : time.completion,
  };
};

/** Copies a viewer viewpoint so canonicalization never aliases domain state. */
const canonicalViewpoint = (
  viewpoint: TaskViewpoint | undefined,
): TaskViewpoint | undefined =>
  viewpoint
    ? {
        cameraPosition: [...viewpoint.cameraPosition],
        cameraTarget: [...viewpoint.cameraTarget],
      }
    : undefined;

/** Canonicalizes one task while retaining its position in the hierarchy. */
const canonicalTask = (
  task: RobotTask,
  aliases: ReferenceAliases,
): CanonicalRobotTask => ({
  id: task.id,
  name: task.name,
  description: task.description,
  actionType: task.actionType,
  status: task.status,
  priority: task.priority,
  targetObjects: canonicalReferences(task.targetObjects, aliases),
  affectedObjects: canonicalReferences(task.affectedObjects, aliases),
  startReference: task.startReference
    ? canonicalReference(task.startReference, aliases)
    : undefined,
  targetReference: task.targetReference
    ? canonicalReference(task.targetReference, aliases)
    : undefined,
  properties: canonicalProperties(task.properties),
  time: canonicalTaskTime(task.time),
  viewpoint: canonicalViewpoint(task.viewpoint),
  markerPosition: task.markerPosition ? [...task.markerPosition] : undefined,
  createdAt: canonicalTimestamp(task.createdAt)!,
  updatedAt: canonicalTimestamp(task.updatedAt)!,
});

/** Stable ordering for independently enumerated IfcRelSequence records. */
const sequenceComparisonKey = (sequence: RobotTaskSequence): string =>
  [
    sequence.id,
    sequence.predecessorTaskId,
    sequence.successorTaskId,
    sequence.sequenceType,
  ].join("\u0000");

/** Copies and orders sequence relations without changing their fields. */
const canonicalSequences = (
  sequences: readonly RobotTaskSequence[],
): RobotTaskSequence[] =>
  sequences
    .map((sequence) => ({ ...sequence }))
    .sort((left, right) =>
      compareText(sequenceComparisonKey(left), sequenceComparisonKey(right)),
    );

/** Applies the generated work-schedule start fallback to an explicit schedule. */
const canonicalSchedule = (
  mission: RobotMission,
): RobotMissionSchedule | undefined => {
  if (mission.schedule === undefined) return undefined;
  return {
    id: mission.schedule.id,
    name: mission.schedule.name,
    scheduleStart: canonicalTimestamp(
      mission.schedule.scheduleStart ?? mission.createdAt,
    ),
    scheduleFinish: canonicalTimestamp(mission.schedule.scheduleFinish),
    scheduleDuration: mission.schedule.scheduleDuration,
  };
};

/**
 * Canonicalizes one mission for IFC export/import semantic comparison.
 *
 * Task order is intentionally retained because IfcRelNests represents the
 * application's hierarchy order. Sequence relation order is not retained
 * because independent IFC relation enumeration is not a workflow ordering.
 */
const canonicalizeRobotMissionWithAliases = (
  mission: RobotMission,
  aliases: ReferenceAliases,
): CanonicalRobotMission => ({
  id: mission.id,
  name: mission.name,
  description: mission.description,
  status: mission.status,
  priority: mission.priority,
  tasks: mission.tasks.map((task) => canonicalTask(task, aliases)),
  sequences: canonicalSequences(mission.sequences),
  schedule: canonicalSchedule(mission),
  createdAt: canonicalTimestamp(mission.createdAt)!,
  updatedAt: canonicalTimestamp(mission.updatedAt)!,
});

/** Canonicalizes one mission using object aliases available in that aggregate. */
export const canonicalizeRobotMission = (
  mission: RobotMission,
): CanonicalRobotMission =>
  canonicalizeRobotMissionWithAliases(mission, referenceAliases([mission]));

/** Stable ordering for independently imported mission roots. */
const missionComparisonKey = (mission: CanonicalRobotMission): string =>
  `${mission.id}\u0000${JSON.stringify(mission)}`;

/** Canonicalizes and orders missions with one shared object identity index. */
const canonicalizeRobotMissionsWithAliases = (
  missions: readonly RobotMission[],
  aliases: ReferenceAliases,
): CanonicalRobotMission[] =>
  missions
    .map((mission) => canonicalizeRobotMissionWithAliases(mission, aliases))
    .sort((left, right) =>
      compareText(missionComparisonKey(left), missionComparisonKey(right)),
    );

/** Canonicalizes a mission collection without depending on IFC line order. */
export const canonicalizeRobotMissions = (
  missions: readonly RobotMission[],
): CanonicalRobotMission[] =>
  canonicalizeRobotMissionsWithAliases(missions, referenceAliases(missions));

/** Formats possibly absent values consistently in structured diagnostics. */
const formattedValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
};

/** Appends one stable difference without throwing or mutating compared values. */
const addDifference = (
  differences: RobotMissionSemanticDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
): void => {
  differences.push({
    path,
    expected,
    actual,
    message: `${path}: expected ${formattedValue(expected)}, received ${formattedValue(actual)}.`,
  });
};

/** Recursively compares canonical JSON-like values in deterministic key order. */
const collectDifferences = (
  expected: unknown,
  actual: unknown,
  path: string,
  differences: RobotMissionSemanticDifference[],
): void => {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      addDifference(differences, path, expected, actual);
      return;
    }
    if (expected.length !== actual.length) {
      addDifference(
        differences,
        `${path}.length`,
        expected.length,
        actual.length,
      );
    }
    const sharedLength = Math.min(expected.length, actual.length);
    for (let index = 0; index < sharedLength; index += 1) {
      collectDifferences(
        expected[index],
        actual[index],
        `${path}[${index}]`,
        differences,
      );
    }
    return;
  }
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object"
  ) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [
      ...new Set([
        ...Object.keys(expectedRecord),
        ...Object.keys(actualRecord),
      ]),
    ].sort(compareText);
    for (const key of keys) {
      collectDifferences(
        expectedRecord[key],
        actualRecord[key],
        `${path}.${key}`,
        differences,
      );
    }
    return;
  }
  addDifference(differences, path, expected, actual);
};

/**
 * Compares intended and reconstructed mission collections after canonicalizing
 * only the documented IFC roundtrip compatibility differences.
 */
export const compareRobotMissionsSemantically = (
  expected: readonly RobotMission[],
  actual: readonly RobotMission[],
): RobotMissionSemanticComparisonResult => {
  const differences: RobotMissionSemanticDifference[] = [];
  const aliases = referenceAliases([...expected, ...actual]);
  collectDifferences(
    canonicalizeRobotMissionsWithAliases(expected, aliases),
    canonicalizeRobotMissionsWithAliases(actual, aliases),
    "missions",
    differences,
  );
  return { equal: differences.length === 0, differences };
};

/** Boolean convenience wrapper for callers that do not need diagnostics. */
export const areRobotMissionsSemanticallyEqual = (
  expected: readonly RobotMission[],
  actual: readonly RobotMission[],
): boolean => compareRobotMissionsSemantically(expected, actual).equal;
