/* eslint-disable max-classes-per-file -- Reader, scoped context, and typed graph failure form one import boundary. */
import {
  IFCRELASSIGNSTOCONTROL,
  IFCRELASSIGNSTOPROCESS,
  IFCRELASSIGNSTOPRODUCT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELNESTS,
  IFCRELSEQUENCE,
  IFCTASK,
} from "web-ifc";
import {
  ROBOT_ACTION_TYPES,
  validateMission,
  type RobotActionProperties,
  type RobotActionType,
  type RobotMission,
  type RobotMissionSchedule,
  type RobotObjectReference,
  type RobotTask,
  type RobotTaskPriority,
  type RobotTaskSequence,
  type RobotTaskSequenceType,
  type RobotTaskStatus,
  type RobotTaskTime,
} from "../../domain/robot-tasks";
import { ROBOT_MISSION_ANNOTATION_SCHEMA_VERSION } from "../robot-tasks";
import type {
  IfcMissionEntityProvenance,
  IfcMissionImportIssue,
  IfcMissionImportResult,
} from "./ifcMissionImportTypes";

/** Small vector surface returned by web-ifc type queries. */
export interface IfcMissionReaderIdVectorPort {
  size(): number;
  get(index: number): number;
}

/** Read-only web-ifc operations required by graph detection and reconstruction. */
export interface IfcMissionReaderApiPort {
  GetLineIDsWithType(
    modelID: number,
    type: number,
    includeInherited?: boolean,
  ): IfcMissionReaderIdVectorPort;
  GetLine(modelID: number, expressID: number, flatten?: boolean): unknown;
  GetLineType(modelID: number, expressID: number): number;
  GetNameFromTypeCode(type: number): string;
}

type IfcLine = Record<string, any> & { expressID?: number };

interface IndexedLine {
  expressId: number;
  line: IfcLine;
}

interface ReaderIndexes {
  tasks: Map<number, IfcLine>;
  nests: IndexedLine[];
  sequences: IndexedLine[];
  processAssignments: IndexedLine[];
  productAssignments: IndexedLine[];
  controlAssignments: IndexedLine[];
  propertyRelations: IndexedLine[];
  parentMissionIdsByTask: Map<number, Set<number>>;
}

class GraphIssue extends Error {
  constructor(readonly issue: IfcMissionImportIssue) {
    super(issue.message);
  }
}

const wrapped = (value: any): unknown =>
  value && typeof value === "object" && "value" in value ? value.value : value;

const optional = (value: any): unknown =>
  value === null || value === undefined ? undefined : wrapped(value);

const referenceId = (value: any): number | undefined => {
  const candidate = wrapped(value);
  return typeof candidate === "number" && Number.isInteger(candidate)
    ? candidate
    : undefined;
};

const referenceIds = (value: any): number[] =>
  Array.isArray(value)
    ? value.map(referenceId).filter((id): id is number => id !== undefined)
    : [];

/** True only when an IFC aggregate contains one valid reference to the owner. */
const referencesExactly = (value: any, expectedExpressId: number): boolean =>
  Array.isArray(value) &&
  value.length === 1 &&
  referenceId(value[0]) === expectedExpressId;

const textValue = (value: any): string | undefined => {
  const candidate = optional(value);
  return typeof candidate === "string" ? candidate : undefined;
};

const numberValue = (value: any): number | undefined => {
  const candidate = optional(value);
  return typeof candidate === "number" ? candidate : undefined;
};

const ids = (vector: IfcMissionReaderIdVectorPort): number[] => {
  const result: number[] = [];
  for (let index = 0; index < vector.size(); index += 1) {
    result.push(vector.get(index));
  }
  return result;
};

const encodedId = (...segments: Array<string | number>) =>
  segments.map((segment) => encodeURIComponent(String(segment))).join("/");

const issue = (
  code: string,
  severity: "error" | "warning",
  kind: IfcMissionImportIssue["kind"],
  message: string,
  context: Partial<IfcMissionImportIssue> = {},
): IfcMissionImportIssue => ({ code, severity, kind, message, ...context });

const fail = (
  code: string,
  message: string,
  context: Partial<IfcMissionImportIssue>,
): never => {
  throw new GraphIssue(
    issue(code, "error", "malformed-ifc-graph", message, context),
  );
};

const priority = (
  value: any,
  context: Partial<IfcMissionImportIssue>,
): RobotTaskPriority | undefined => {
  const candidate = numberValue(value);
  if (candidate === undefined) return undefined;
  const result = (
    {
      1: "low",
      2: "medium",
      3: "high",
      4: "critical",
    } as Record<number, RobotTaskPriority>
  )[candidate];
  if (!result) {
    fail(
      "IFC_PRIORITY_UNSUPPORTED",
      `Unsupported IfcTask priority ${candidate}.`,
      context,
    );
  }
  return result;
};

const status = (
  value: any,
  context: Partial<IfcMissionImportIssue>,
): RobotTaskStatus | undefined => {
  const candidate = textValue(value);
  if (candidate === undefined) return undefined;
  if (
    !["planned", "open", "in_progress", "done", "blocked", "failed"].includes(
      candidate,
    )
  ) {
    fail(
      "IFC_STATUS_UNSUPPORTED",
      `Unsupported RobotTask status ${candidate}.`,
      context,
    );
  }
  return candidate as RobotTaskStatus;
};

const requireText = (
  value: any,
  code: string,
  field: string,
  context: Partial<IfcMissionImportIssue>,
): string => {
  const candidate = textValue(value)?.trim();
  if (!candidate) fail(code, `${field} is required.`, context);
  return candidate!;
};

/** Stateful helper scoped to one reader call and one open web-ifc model. */
class MissionReadContext {
  readonly issues: IfcMissionImportIssue[] = [];
  readonly provenance: IfcMissionEntityProvenance[] = [];
  private readonly provenanceIndexes = new Map<string, number>();

  constructor(
    private readonly api: IfcMissionReaderApiPort,
    private readonly modelId: number,
    readonly sourceModelId: string,
    readonly indexes: ReaderIndexes,
  ) {}

  line(expressId: number, context: Partial<IfcMissionImportIssue>): IfcLine {
    const value = this.api.GetLine(this.modelId, expressId, false);
    if (!value || typeof value !== "object") {
      fail(
        "IFC_REFERENCE_UNRESOLVED",
        `IFC reference #${expressId} cannot be resolved.`,
        {
          expressId,
          ...context,
        },
      );
    }
    return value as IfcLine;
  }

  entityType(expressId: number): string {
    return this.api.GetNameFromTypeCode(
      this.api.GetLineType(this.modelId, expressId),
    );
  }

  addProvenance(
    missionId: string,
    expressId: number,
    ownerId?: string,
    recordIdentity?: string,
    knownLine?: IfcLine,
  ): void {
    const key = `${missionId}:${expressId}`;
    const source = knownLine ?? this.line(expressId, { missionId });
    const existingIndex = this.provenanceIndexes.get(key);
    if (existingIndex !== undefined) {
      const existing = this.provenance[existingIndex];
      this.provenance[existingIndex] = {
        ...existing,
        recordIdentity: recordIdentity ?? existing.recordIdentity,
        ownerId: ownerId ?? existing.ownerId,
        globalId: textValue(source.GlobalId) ?? existing.globalId,
      };
      return;
    }
    this.provenanceIndexes.set(key, this.provenance.length);
    this.provenance.push({
      missionId,
      recordIdentity,
      entityType: this.entityType(expressId),
      expressId,
      globalId: textValue(source.GlobalId),
      ownerId,
    });
  }

  objectReference(
    expressId: number,
    context: Partial<IfcMissionImportIssue>,
  ): RobotObjectReference {
    const source = this.line(expressId, context);
    const globalId = textValue(source.GlobalId)?.trim();
    const metadata = {
      modelId: this.sourceModelId,
      expressId,
      ifcClass: this.entityType(expressId),
      name: textValue(source.Name),
    };
    return globalId ? { ...metadata, globalId } : metadata;
  }

  propertySets(
    ownerExpressId: number,
    name: "RobotMission" | "RobotTask" | "RobotAction",
    missionId: string,
    ownerId: string,
  ): Array<{ expressId: number; line: IfcLine; relation: IndexedLine }> {
    const result: Array<{
      expressId: number;
      line: IfcLine;
      relation: IndexedLine;
    }> = [];
    for (const relation of this.indexes.propertyRelations) {
      if (!referenceIds(relation.line.RelatedObjects).includes(ownerExpressId))
        continue;
      const propertySetId = referenceId(
        relation.line.RelatingPropertyDefinition,
      );
      if (propertySetId === undefined) continue;
      const propertySet = this.line(propertySetId, {
        missionId,
        taskId: ownerId,
      });
      if (textValue(propertySet.Name) !== name) continue;
      if (!referencesExactly(relation.line.RelatedObjects, ownerExpressId)) {
        fail(
          "IFC_PROPERTY_RELATION_SCOPE_INVALID",
          `${name} must be assigned only to its intended owner ${ownerId}.`,
          {
            missionId,
            taskId: name === "RobotMission" ? undefined : ownerId,
            expressId: relation.expressId,
            ifcEntityType: "IFCRELDEFINESBYPROPERTIES",
          },
        );
      }
      result.push({ expressId: propertySetId, line: propertySet, relation });
    }
    return result;
  }

  propertyValues(
    ownerExpressId: number,
    name: "RobotMission" | "RobotTask" | "RobotAction",
    missionId: string,
    ownerId: string,
  ): Map<string, unknown> {
    const sets = this.propertySets(ownerExpressId, name, missionId, ownerId);
    if (sets.length !== 1) {
      fail(
        sets.length ? "IFC_PROPERTY_SET_AMBIGUOUS" : "IFC_PROPERTY_SET_MISSING",
        `Expected exactly one ${name} property set for ${ownerId}; found ${sets.length}.`,
        {
          missionId,
          taskId: name === "RobotMission" ? undefined : ownerId,
          expressId: ownerExpressId,
          ifcEntityType: "IFCTASK",
        },
      );
    }
    const selected = sets[0];
    if (
      this.entityType(selected.expressId).toUpperCase() !== "IFCPROPERTYSET"
    ) {
      fail(
        "IFC_PROPERTY_SET_TYPE_INVALID",
        `${name} must reference an IfcPropertySet.`,
        {
          missionId,
          taskId: name === "RobotMission" ? undefined : ownerId,
          expressId: selected.expressId,
          ifcEntityType: this.entityType(selected.expressId),
        },
      );
    }
    const setRecordId = encodedId("property-set", name, ownerId);
    this.addProvenance(
      missionId,
      selected.expressId,
      ownerId,
      setRecordId,
      selected.line,
    );
    this.addProvenance(
      missionId,
      selected.relation.expressId,
      ownerId,
      encodedId("relation", name, ownerId),
      selected.relation.line,
    );
    const values = new Map<string, unknown>();
    for (const propertyId of referenceIds(selected.line.HasProperties)) {
      const property = this.line(propertyId, { missionId, taskId: ownerId });
      const propertyName = textValue(property.Name);
      if (!propertyName) continue;
      if (values.has(propertyName)) {
        fail(
          "IFC_PROPERTY_DUPLICATE",
          `Property ${propertyName} occurs more than once in ${name}.`,
          {
            missionId,
            taskId: name === "RobotMission" ? undefined : ownerId,
            expressId: propertyId,
            ifcEntityType: this.entityType(propertyId),
          },
        );
      }
      let value: unknown;
      if (Array.isArray(property.ListValues)) {
        value = property.ListValues.map(wrapped);
      } else if (
        property.NominalValue !== undefined &&
        property.NominalValue !== null
      ) {
        value = wrapped(property.NominalValue);
      } else {
        continue;
      }
      values.set(propertyName, value);
      const propertyKind = Array.isArray(property.ListValues)
        ? "property-list"
        : "property";
      this.addProvenance(
        missionId,
        propertyId,
        ownerId,
        encodedId(propertyKind, name, ownerId, propertyName),
        property,
      );
    }
    return values;
  }
}

/** Captures recognized graph identity even when later validation blocks import. */
const captureRecognizedProvenance = (
  context: MissionReadContext,
  missionExpressId: number,
  missionId: string,
): void => {
  const missionLine = context.indexes.tasks.get(missionExpressId)!;
  context.addProvenance(
    missionId,
    missionExpressId,
    missionId,
    undefined,
    missionLine,
  );
  const ownedTaskExpressIds = new Set<number>();
  for (const nest of context.indexes.nests) {
    if (referenceId(nest.line.RelatingObject) !== missionExpressId) continue;
    context.addProvenance(
      missionId,
      nest.expressId,
      missionId,
      undefined,
      nest.line,
    );
    referenceIds(nest.line.RelatedObjects).forEach((taskExpressId) => {
      ownedTaskExpressIds.add(taskExpressId);
      const taskLine = context.indexes.tasks.get(taskExpressId);
      if (!taskLine || textValue(taskLine.ObjectType) !== "RobotTask") return;
      const taskId = textValue(taskLine.Identification);
      context.addProvenance(
        missionId,
        taskExpressId,
        taskId,
        undefined,
        taskLine,
      );
      const taskTimeId = referenceId(taskLine.TaskTime);
      if (taskTimeId !== undefined)
        context.addProvenance(missionId, taskTimeId, taskId);
    });
  }
  const ownedOwnerIds = new Set([missionExpressId, ...ownedTaskExpressIds]);
  for (const relation of context.indexes.propertyRelations) {
    const relatedOwnerIds = referenceIds(relation.line.RelatedObjects).filter(
      (id) => ownedOwnerIds.has(id),
    );
    if (!relatedOwnerIds.length) continue;
    const ownerLine = context.indexes.tasks.get(relatedOwnerIds[0]);
    const ownerId = textValue(ownerLine?.Identification);
    const propertySetId = referenceId(relation.line.RelatingPropertyDefinition);
    if (propertySetId === undefined) continue;
    const propertySet = context.line(propertySetId, { missionId });
    if (
      !["RobotMission", "RobotTask", "RobotAction"].includes(
        textValue(propertySet.Name) ?? "",
      )
    )
      continue;
    context.addProvenance(
      missionId,
      relation.expressId,
      ownerId,
      undefined,
      relation.line,
    );
    context.addProvenance(
      missionId,
      propertySetId,
      ownerId,
      undefined,
      propertySet,
    );
    for (const propertyId of referenceIds(propertySet.HasProperties)) {
      context.addProvenance(missionId, propertyId, ownerId);
    }
  }
  for (const relation of [
    ...context.indexes.processAssignments,
    ...context.indexes.productAssignments,
    ...context.indexes.sequences,
  ]) {
    const taskReferences = [
      referenceId(relation.line.RelatingProcess),
      referenceId(relation.line.RelatedProcess),
      ...referenceIds(relation.line.RelatedObjects),
    ].filter((id): id is number => id !== undefined);
    const ownerExpressId = taskReferences.find((id) =>
      ownedTaskExpressIds.has(id),
    );
    if (ownerExpressId === undefined) continue;
    context.addProvenance(
      missionId,
      relation.expressId,
      textValue(context.indexes.tasks.get(ownerExpressId)?.Identification),
      undefined,
      relation.line,
    );
  }
  for (const relation of context.indexes.controlAssignments) {
    if (!referenceIds(relation.line.RelatedObjects).includes(missionExpressId))
      continue;
    context.addProvenance(
      missionId,
      relation.expressId,
      missionId,
      undefined,
      relation.line,
    );
    const scheduleId = referenceId(relation.line.RelatingControl);
    if (scheduleId !== undefined)
      context.addProvenance(missionId, scheduleId, missionId);
  }
};

const coordinates = (
  value: unknown,
  field: string,
  context: Partial<IfcMissionImportIssue>,
): [number, number, number] | undefined => {
  if (value === undefined) return undefined;
  const normalized = Array.isArray(value)
    ? value.map((coordinate) =>
        typeof coordinate === "string" && coordinate.trim()
          ? Number(coordinate)
          : coordinate,
      )
    : value;
  if (
    !Array.isArray(normalized) ||
    normalized.length !== 3 ||
    normalized.some(
      (coordinate) =>
        typeof coordinate !== "number" || !Number.isFinite(coordinate),
    )
  ) {
    fail(
      "IFC_COORDINATES_MALFORMED",
      `${field} must contain exactly three finite numbers.`,
      context,
    );
  }
  return normalized as [number, number, number];
};

const optionalScalarString = (
  values: Map<string, unknown>,
  name: string,
  context: Partial<IfcMissionImportIssue>,
): string | undefined => {
  const value = values.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    fail(
      "IFC_PROPERTY_TYPE_INVALID",
      `${name} must be a scalar string.`,
      context,
    );
  }
  return value as string;
};

const optionalStringList = (
  values: Map<string, unknown>,
  name: string,
  context: Partial<IfcMissionImportIssue>,
): string[] | undefined => {
  const value = values.get(name);
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    fail(
      "IFC_PROPERTY_TYPE_INVALID",
      `${name} must be a list of strings.`,
      context,
    );
  }
  return value as string[];
};

interface RobotMissionAnnotationMetadata {
  legacy: boolean;
  hasExplicitSchedule?: boolean;
}

/** Validates the infrastructure schema marker before interpreting newer fields. */
const annotationMetadata = (
  values: Map<string, unknown>,
  context: MissionReadContext,
  missionContext: Partial<IfcMissionImportIssue>,
): RobotMissionAnnotationMetadata => {
  const rawVersion = values.get("AnnotationSchemaVersion");
  const rawScheduleMarker = values.get("HasExplicitSchedule");
  const currentMajor = Number(
    ROBOT_MISSION_ANNOTATION_SCHEMA_VERSION.split(".")[0],
  );
  let legacy = false;

  if (rawVersion === undefined) {
    legacy = true;
    context.issues.push(
      issue(
        "IFC_ANNOTATION_SCHEMA_VERSION_LEGACY",
        "warning",
        "compatibility",
        "RobotMission has no AnnotationSchemaVersion and is interpreted using the pre-version compatibility rules.",
        missionContext,
      ),
    );
  } else if (
    typeof rawVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(rawVersion)
  ) {
    fail(
      "IFC_ANNOTATION_SCHEMA_VERSION_INVALID",
      "RobotMission.AnnotationSchemaVersion must be a semantic version such as 1.0.0.",
      missionContext,
    );
  } else {
    const importedMajor = Number(rawVersion.split(".")[0]);
    if (importedMajor !== currentMajor) {
      fail(
        "IFC_ANNOTATION_SCHEMA_VERSION_UNSUPPORTED",
        `Annotation schema version ${rawVersion} is not supported by major version ${currentMajor}.`,
        missionContext,
      );
    }
  }

  if (rawScheduleMarker === undefined) {
    if (!legacy) {
      fail(
        "IFC_EXPLICIT_SCHEDULE_MARKER_MISSING",
        "Versioned RobotMission metadata requires HasExplicitSchedule.",
        missionContext,
      );
    }
    return { legacy };
  }
  if (typeof rawScheduleMarker !== "boolean") {
    fail(
      "IFC_EXPLICIT_SCHEDULE_MARKER_INVALID",
      "RobotMission.HasExplicitSchedule must be a boolean.",
      missionContext,
    );
  }
  return { legacy, hasExplicitSchedule: rawScheduleMarker as boolean };
};

const taskTime = (
  context: MissionReadContext,
  taskLine: IfcLine,
  missionId: string,
  taskId: string,
): RobotTaskTime | undefined => {
  const expressId = referenceId(taskLine.TaskTime);
  if (expressId === undefined) return undefined;
  const line = context.line(expressId, { missionId, taskId });
  if (context.entityType(expressId).toUpperCase() !== "IFCTASKTIME") {
    fail(
      "IFC_TASK_TIME_TYPE_INVALID",
      "IfcTask.TaskTime must reference IfcTaskTime.",
      {
        missionId,
        taskId,
        expressId,
        ifcEntityType: context.entityType(expressId),
      },
    );
  }
  context.addProvenance(
    missionId,
    expressId,
    taskId,
    encodedId("task-time", taskId),
    line,
  );
  const result: RobotTaskTime = {
    scheduleStart: textValue(line.ScheduleStart),
    scheduleFinish: textValue(line.ScheduleFinish),
    scheduleDuration: textValue(line.ScheduleDuration),
    actualStart: textValue(line.ActualStart),
    actualFinish: textValue(line.ActualFinish),
    remainingTime: textValue(line.RemainingTime),
    completion: numberValue(line.Completion),
  };
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : {};
};

const actionProperties = (
  values: Map<string, unknown>,
  context: Partial<IfcMissionImportIssue>,
): { actionType: RobotActionType; properties?: RobotActionProperties } => {
  const rawAction = optionalScalarString(values, "ActionType", context);
  if (!rawAction)
    fail(
      "IFC_ROBOT_ACTION_MISSING",
      "RobotAction.ActionType is required.",
      context,
    );
  if (!(ROBOT_ACTION_TYPES as readonly string[]).includes(rawAction!)) {
    fail(
      "IFC_ROBOT_ACTION_UNSUPPORTED",
      `Unsupported RobotAction value ${rawAction}.`,
      context,
    );
  }
  const properties: RobotActionProperties = {
    targetState: optionalScalarString(values, "TargetState", context),
    targetObjectRole: optionalScalarString(values, "TargetObjectRole", context),
    affectedObjectRole: optionalScalarString(
      values,
      "AffectedObjectRole",
      context,
    ),
    requiredCapability: optionalScalarString(
      values,
      "RequiredCapability",
      context,
    ),
    preconditions: optionalStringList(values, "Preconditions", context),
    postconditions: optionalStringList(values, "Postconditions", context),
    successCondition: optionalScalarString(values, "SuccessCondition", context),
  };
  return {
    actionType: rawAction as RobotActionType,
    properties: Object.values(properties).some((value) => value !== undefined)
      ? properties
      : undefined,
  };
};

const expectedTargetRole = (actionType: RobotActionType) => {
  if (actionType === "PASS_THROUGH") return "PASSES_THROUGH";
  if (actionType === "NAVIGATE_TO") return "NAVIGATES_TO";
  return "OPERATES_ON";
};

const reconstructAssignments = (
  context: MissionReadContext,
  taskExpressId: number,
  missionId: string,
  taskId: string,
  actionType: RobotActionType,
): Pick<
  RobotTask,
  "targetObjects" | "affectedObjects" | "startReference" | "targetReference"
> => {
  const process = context.indexes.processAssignments.filter(
    (entry) => referenceId(entry.line.RelatingProcess) === taskExpressId,
  );
  const allowedTarget = expectedTargetRole(actionType);
  const byName = new Map<string, IndexedLine[]>();
  for (const entry of process) {
    const name = textValue(entry.line.Name) ?? "";
    if (
      ![
        "OPERATES_ON",
        "AFFECTS",
        "PASSES_THROUGH",
        "NAVIGATES_TO",
        "MOVE_FROM",
      ].includes(name)
    ) {
      fail(
        "IFC_ASSIGNMENT_ROLE_UNSUPPORTED",
        `Unsupported process assignment role ${name || "<empty>"}.`,
        {
          missionId,
          taskId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELASSIGNSTOPROCESS",
        },
      );
    }
    if (
      ![
        allowedTarget,
        "AFFECTS",
        ...(actionType === "MOVE" ? ["MOVE_FROM"] : []),
      ].includes(name)
    ) {
      fail(
        "IFC_ASSIGNMENT_ROLE_CONTRADICTORY",
        `Assignment role ${name} contradicts action ${actionType}.`,
        {
          missionId,
          taskId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELASSIGNSTOPROCESS",
        },
      );
    }
    const entries = byName.get(name) ?? [];
    entries.push(entry);
    byName.set(name, entries);
  }
  for (const [name, entries] of byName) {
    if (entries.length > 1) {
      fail(
        "IFC_ASSIGNMENT_ROLE_AMBIGUOUS",
        `Task ${taskId} has multiple ${name} assignments.`,
        {
          missionId,
          taskId,
          expressId: entries[1].expressId,
          ifcEntityType: "IFCRELASSIGNSTOPROCESS",
        },
      );
    }
  }

  const refsFor = (name: string): RobotObjectReference[] => {
    const entry = byName.get(name)?.[0];
    if (!entry) return [];
    let relationKind = "targets";
    if (name === "AFFECTS") relationKind = "affected";
    if (name === "MOVE_FROM") relationKind = "move-from";
    context.addProvenance(
      missionId,
      entry.expressId,
      taskId,
      encodedId("relation", relationKind, taskId),
      entry.line,
    );
    return referenceIds(entry.line.RelatedObjects).map((expressId) =>
      context.objectReference(expressId, { missionId, taskId }),
    );
  };
  const starts = refsFor("MOVE_FROM");
  if (starts.length > 1) {
    fail(
      "IFC_MOVE_START_AMBIGUOUS",
      `MOVE task ${taskId} has multiple start references.`,
      { missionId, taskId },
    );
  }

  const productRelations = context.indexes.productAssignments.filter((entry) =>
    referenceIds(entry.line.RelatedObjects).includes(taskExpressId),
  );
  const destinations: Array<{
    reference: RobotObjectReference;
    entry: IndexedLine;
  }> = [];
  for (const entry of productRelations) {
    if (!referencesExactly(entry.line.RelatedObjects, taskExpressId)) {
      fail(
        "IFC_MOVE_DESTINATION_SCOPE_INVALID",
        `MOVE_TO for task ${taskId} must reference only that task.`,
        {
          missionId,
          taskId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELASSIGNSTOPRODUCT",
        },
      );
    }
    if (textValue(entry.line.Name) !== "MOVE_TO" || actionType !== "MOVE") {
      fail(
        "IFC_MOVE_DESTINATION_CONTRADICTORY",
        `Product assignment contradicts action ${actionType}.`,
        {
          missionId,
          taskId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELASSIGNSTOPRODUCT",
        },
      );
    }
    const destinationId = referenceId(entry.line.RelatingProduct);
    if (destinationId === undefined) {
      fail(
        "IFC_MOVE_DESTINATION_MISSING",
        "MOVE_TO has no destination product.",
        {
          missionId,
          taskId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELASSIGNSTOPRODUCT",
        },
      );
    }
    destinations.push({
      reference: context.objectReference(destinationId!, { missionId, taskId }),
      entry,
    });
  }
  const destinationKeys = new Set(
    destinations.map(
      ({ reference }) =>
        reference.globalId ?? `${reference.modelId}:${reference.expressId}`,
    ),
  );
  if (destinationKeys.size > 1) {
    fail(
      "IFC_MOVE_DESTINATION_AMBIGUOUS",
      `MOVE task ${taskId} has multiple different destinations.`,
      {
        missionId,
        taskId,
      },
    );
  }
  for (const { entry } of destinations) {
    context.addProvenance(
      missionId,
      entry.expressId,
      taskId,
      encodedId("relation", "move-to", taskId),
      entry.line,
    );
  }
  return {
    targetObjects: refsFor(allowedTarget),
    affectedObjects: refsFor("AFFECTS"),
    startReference: starts[0],
    targetReference: destinations[0]?.reference,
  };
};

const reconstructTask = (
  context: MissionReadContext,
  taskExpressId: number,
  missionId: string,
): RobotTask => {
  const line = context.line(taskExpressId, { missionId });
  const taskId = requireText(
    line.Identification,
    "IFC_TASK_ID_MISSING",
    "RobotTask Identification",
    {
      missionId,
      expressId: taskExpressId,
      ifcEntityType: "IFCTASK",
    },
  );
  const taskContext = {
    missionId,
    taskId,
    expressId: taskExpressId,
    ifcEntityType: "IFCTASK",
  };
  if (
    textValue(line.ObjectType) !== "RobotTask" ||
    textValue(line.PredefinedType) !== "USERDEFINED"
  ) {
    fail(
      "IFC_CHILD_TASK_NOT_OWNED",
      `Nested task ${taskId} does not satisfy RobotTask ownership markers.`,
      taskContext,
    );
  }
  context.addProvenance(
    missionId,
    taskExpressId,
    taskId,
    encodedId("task", taskId),
    line,
  );
  const actionValues = context.propertyValues(
    taskExpressId,
    "RobotAction",
    missionId,
    taskId,
  );
  const metadata = context.propertyValues(
    taskExpressId,
    "RobotTask",
    missionId,
    taskId,
  );
  const action = actionProperties(actionValues, taskContext);
  const createdAt = requireText(
    metadata.get("CreatedAt"),
    "IFC_TASK_CREATED_AT_MISSING",
    "RobotTask.CreatedAt",
    taskContext,
  );
  const updatedAt = requireText(
    metadata.get("UpdatedAt"),
    "IFC_TASK_UPDATED_AT_MISSING",
    "RobotTask.UpdatedAt",
    taskContext,
  );
  const cameraPosition = coordinates(
    metadata.get("CameraPosition"),
    "CameraPosition",
    taskContext,
  );
  const cameraTarget = coordinates(
    metadata.get("CameraTarget"),
    "CameraTarget",
    taskContext,
  );
  if ((cameraPosition && !cameraTarget) || (!cameraPosition && cameraTarget)) {
    fail(
      "IFC_VIEWPOINT_INCOMPLETE",
      "CameraPosition and CameraTarget must occur together.",
      taskContext,
    );
  }
  return {
    id: taskId,
    name: requireText(
      line.Name,
      "IFC_TASK_NAME_MISSING",
      "RobotTask Name",
      taskContext,
    ),
    description: textValue(line.Description),
    status: status(line.Status, taskContext),
    priority: priority(line.Priority, taskContext),
    actionType: action.actionType,
    ...reconstructAssignments(
      context,
      taskExpressId,
      missionId,
      taskId,
      action.actionType,
    ),
    properties: action.properties,
    time: taskTime(context, line, missionId, taskId),
    viewpoint:
      cameraPosition && cameraTarget
        ? { cameraPosition, cameraTarget }
        : undefined,
    markerPosition: coordinates(
      metadata.get("MarkerPosition"),
      "MarkerPosition",
      taskContext,
    ),
    createdAt,
    updatedAt,
  };
};

const reconstructSequences = (
  context: MissionReadContext,
  missionId: string,
  tasksByExpressId: Map<number, RobotTask>,
): RobotTaskSequence[] => {
  const result: RobotTaskSequence[] = [];
  const supported = new Set<RobotTaskSequenceType>([
    "FINISH_START",
    "START_START",
    "FINISH_FINISH",
    "START_FINISH",
  ]);
  for (const entry of context.indexes.sequences) {
    const predecessorExpressId = referenceId(entry.line.RelatingProcess);
    const successorExpressId = referenceId(entry.line.RelatedProcess);
    const predecessor =
      predecessorExpressId === undefined
        ? undefined
        : tasksByExpressId.get(predecessorExpressId);
    const successor =
      successorExpressId === undefined
        ? undefined
        : tasksByExpressId.get(successorExpressId);
    if (!predecessor && !successor) continue;
    if (!predecessor || !successor) {
      fail(
        "IFC_SEQUENCE_CROSSES_MISSION",
        "A project-owned task sequence crosses the mission boundary.",
        {
          missionId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELSEQUENCE",
        },
      );
    }
    const rawType = textValue(entry.line.SequenceType) ?? "FINISH_START";
    if (!supported.has(rawType as RobotTaskSequenceType)) {
      fail(
        "IFC_SEQUENCE_TYPE_UNSUPPORTED",
        `Unsupported sequence type ${rawType}.`,
        {
          missionId,
          expressId: entry.expressId,
          ifcEntityType: "IFCRELSEQUENCE",
        },
      );
    }
    const explicitSequenceId = textValue(entry.line.Name)?.trim();
    const sequenceId =
      explicitSequenceId ??
      encodedId("sequence", predecessor!.id, successor!.id, rawType);
    if (!explicitSequenceId) {
      context.issues.push(
        issue(
          "IFC_SEQUENCE_ID_COMPATIBILITY_FALLBACK",
          "warning",
          "compatibility",
          `IfcRelSequence #${entry.expressId} has no project-owned sequence ID; ${sequenceId} was derived deterministically.`,
          {
            missionId,
            expressId: entry.expressId,
            ifcEntityType: "IFCRELSEQUENCE",
          },
        ),
      );
    }
    context.addProvenance(
      missionId,
      entry.expressId,
      undefined,
      encodedId("relation", "sequence", sequenceId),
      entry.line,
    );
    result.push({
      id: sequenceId,
      predecessorTaskId: predecessor!.id,
      successorTaskId: successor!.id,
      sequenceType: rawType as RobotTaskSequenceType,
    });
  }
  return result;
};

const reconstructSchedule = (
  context: MissionReadContext,
  missionExpressId: number,
  missionId: string,
  annotation: RobotMissionAnnotationMetadata,
): RobotMissionSchedule | undefined => {
  const relations = context.indexes.controlAssignments.filter((entry) =>
    referenceIds(entry.line.RelatedObjects).includes(missionExpressId),
  );
  if (!relations.length) {
    if (annotation.hasExplicitSchedule !== undefined) {
      fail(
        "IFC_SCHEDULE_INFRASTRUCTURE_MISSING",
        `Versioned mission ${missionId} requires generated IfcWorkSchedule infrastructure.`,
        { missionId, expressId: missionExpressId, ifcEntityType: "IFCTASK" },
      );
    }
    return undefined;
  }
  if (relations.length > 1) {
    fail(
      "IFC_SCHEDULE_AMBIGUOUS",
      `Mission ${missionId} is controlled by multiple work schedules.`,
      {
        missionId,
        expressId: relations[1].expressId,
        ifcEntityType: "IFCRELASSIGNSTOCONTROL",
      },
    );
  }
  const relation = relations[0];
  if (!referencesExactly(relation.line.RelatedObjects, missionExpressId)) {
    fail(
      "IFC_SCHEDULE_RELATION_SCOPE_INVALID",
      `Mission schedule relation for ${missionId} must reference only that mission.`,
      {
        missionId,
        expressId: relation.expressId,
        ifcEntityType: "IFCRELASSIGNSTOCONTROL",
      },
    );
  }
  const scheduleExpressId = referenceId(relation.line.RelatingControl);
  if (scheduleExpressId === undefined) {
    fail(
      "IFC_SCHEDULE_MISSING",
      "Mission schedule relation has no controlling schedule.",
      {
        missionId,
        expressId: relation.expressId,
        ifcEntityType: "IFCRELASSIGNSTOCONTROL",
      },
    );
  }
  const schedule = context.line(scheduleExpressId!, { missionId });
  if (
    context.entityType(scheduleExpressId!).toUpperCase() !== "IFCWORKSCHEDULE"
  ) {
    fail(
      "IFC_SCHEDULE_TYPE_INVALID",
      "IfcRelAssignsToControl must reference an IfcWorkSchedule.",
      {
        missionId,
        expressId: scheduleExpressId,
        ifcEntityType: context.entityType(scheduleExpressId!),
      },
    );
  }
  const scheduleId = requireText(
    schedule.Identification,
    "IFC_SCHEDULE_ID_MISSING",
    "IfcWorkSchedule Identification",
    {
      missionId,
      expressId: scheduleExpressId,
      ifcEntityType: "IFCWORKSCHEDULE",
    },
  );
  context.addProvenance(
    missionId,
    scheduleExpressId!,
    missionId,
    encodedId("work-schedule", scheduleId),
    schedule,
  );
  context.addProvenance(
    missionId,
    relation.expressId,
    missionId,
    encodedId("relation", "schedule", missionId),
    relation.line,
  );
  const reconstructed: RobotMissionSchedule = {
    id: scheduleId,
    name: requireText(
      schedule.Name,
      "IFC_SCHEDULE_NAME_MISSING",
      "IfcWorkSchedule Name",
      {
        missionId,
        expressId: scheduleExpressId,
        ifcEntityType: "IFCWORKSCHEDULE",
      },
    ),
    scheduleStart: textValue(schedule.StartTime),
    scheduleFinish: textValue(schedule.FinishTime),
    scheduleDuration: textValue(schedule.Duration),
  };
  if (annotation.hasExplicitSchedule === false) return undefined;
  if (annotation.hasExplicitSchedule === undefined) {
    context.issues.push(
      issue(
        "IFC_SCHEDULE_AUTHORED_STATE_UNKNOWN",
        "warning",
        "compatibility",
        "This IFC predates the explicit schedule marker; generated fallback and explicitly authored schedules cannot be distinguished.",
        {
          missionId,
          expressId: scheduleExpressId,
          ifcEntityType: "IFCWORKSCHEDULE",
        },
      ),
    );
  }
  return reconstructed;
};

const reconstructMission = (
  context: MissionReadContext,
  missionExpressId: number,
  duplicateMissionIds: ReadonlySet<string>,
): RobotMission => {
  const line = context.indexes.tasks.get(missionExpressId)!;
  const missionId = requireText(
    line.Identification,
    "IFC_MISSION_ID_MISSING",
    "RobotMission Identification",
    {
      expressId: missionExpressId,
      ifcEntityType: "IFCTASK",
    },
  );
  const missionContext = {
    missionId,
    expressId: missionExpressId,
    ifcEntityType: "IFCTASK",
  };
  if (textValue(line.PredefinedType) !== "USERDEFINED") {
    fail(
      "IFC_MISSION_PREDEFINED_TYPE_INVALID",
      `Project-owned mission ${missionId} must use PredefinedType USERDEFINED.`,
      missionContext,
    );
  }
  if (duplicateMissionIds.has(missionId)) {
    fail(
      "IFC_MISSION_ID_DUPLICATE",
      `Project-owned mission ID ${missionId} occurs more than once.`,
      missionContext,
    );
  }
  context.addProvenance(
    missionId,
    missionExpressId,
    missionId,
    encodedId("mission-task", missionId),
    line,
  );
  const metadata = context.propertyValues(
    missionExpressId,
    "RobotMission",
    missionId,
    missionId,
  );
  const annotation = annotationMetadata(metadata, context, missionContext);
  const nests = context.indexes.nests.filter(
    (entry) => referenceId(entry.line.RelatingObject) === missionExpressId,
  );
  if (nests.length !== 1) {
    fail(
      nests.length
        ? "IFC_MISSION_HIERARCHY_AMBIGUOUS"
        : "IFC_MISSION_HIERARCHY_MISSING",
      `Mission ${missionId} requires exactly one IfcRelNests hierarchy; found ${nests.length}.`,
      missionContext,
    );
  }
  const nest = nests[0];
  const childExpressIds = referenceIds(nest.line.RelatedObjects);
  if (
    !childExpressIds.length ||
    new Set(childExpressIds).size !== childExpressIds.length
  ) {
    fail(
      "IFC_MISSION_HIERARCHY_INVALID",
      `Mission ${missionId} has an empty or duplicate child hierarchy.`,
      {
        ...missionContext,
        expressId: nest.expressId,
        ifcEntityType: "IFCRELNESTS",
      },
    );
  }
  context.addProvenance(
    missionId,
    nest.expressId,
    missionId,
    encodedId("relation", "nests", missionId),
    nest.line,
  );
  const tasks = childExpressIds.map((taskExpressId) => {
    if (!context.indexes.tasks.has(taskExpressId)) {
      fail(
        "IFC_CHILD_NOT_TASK",
        `Mission ${missionId} nests non-IfcTask entity #${taskExpressId}.`,
        {
          missionId,
          expressId: taskExpressId,
          ifcEntityType: context.entityType(taskExpressId),
        },
      );
    }
    const parents = context.indexes.parentMissionIdsByTask.get(taskExpressId);
    if ((parents?.size ?? 0) > 1) {
      fail(
        "IFC_TASK_MULTIPLE_MISSION_PARENTS",
        `Executable task #${taskExpressId} is nested below multiple project-owned missions.`,
        {
          missionId,
          expressId: taskExpressId,
          ifcEntityType: "IFCTASK",
        },
      );
    }
    return reconstructTask(context, taskExpressId, missionId);
  });
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      fail(
        "IFC_TASK_ID_DUPLICATE",
        `Task ID ${task.id} occurs more than once in mission ${missionId}.`,
        {
          missionId,
          taskId: task.id,
        },
      );
    }
    taskIds.add(task.id);
  }
  const tasksByExpressId = new Map(
    childExpressIds.map((expressId, index) => [expressId, tasks[index]]),
  );
  const mission: RobotMission = {
    id: missionId,
    name: requireText(
      line.Name,
      "IFC_MISSION_NAME_MISSING",
      "RobotMission Name",
      missionContext,
    ),
    description: textValue(line.Description),
    status: status(line.Status, missionContext),
    priority: priority(line.Priority, missionContext),
    tasks,
    sequences: reconstructSequences(context, missionId, tasksByExpressId),
    schedule: reconstructSchedule(
      context,
      missionExpressId,
      missionId,
      annotation,
    ),
    createdAt: requireText(
      metadata.get("CreatedAt"),
      "IFC_MISSION_CREATED_AT_MISSING",
      "RobotMission.CreatedAt",
      missionContext,
    ),
    updatedAt: requireText(
      metadata.get("UpdatedAt"),
      "IFC_MISSION_UPDATED_AT_MISSING",
      "RobotMission.UpdatedAt",
      missionContext,
    ),
  };
  const validationIssues = validateMission(mission);
  for (const validationIssue of validationIssues) {
    context.issues.push(
      issue(
        `DOMAIN_${validationIssue.code}`,
        validationIssue.severity,
        "domain-validation",
        validationIssue.message,
        { missionId, taskId: validationIssue.taskId },
      ),
    );
  }
  if (
    validationIssues.some(
      (validationIssue) => validationIssue.severity === "error",
    )
  ) {
    fail(
      "IFC_RECONSTRUCTED_MISSION_INVALID",
      `Reconstructed mission ${missionId} failed domain validation.`,
      missionContext,
    );
  }
  return mission;
};

const indexLines = (
  api: IfcMissionReaderApiPort,
  modelId: number,
  type: number,
): IndexedLine[] =>
  ids(api.GetLineIDsWithType(modelId, type, false)).map((expressId) => ({
    expressId,
    line: api.GetLine(modelId, expressId, false) as IfcLine,
  }));

/** Detects owned mission roots and reconstructs independent valid aggregates. */
export class WebIfcMissionReader {
  read(
    api: IfcMissionReaderApiPort,
    modelId: number,
    sourceModelId: string,
    schema: string,
  ): IfcMissionImportResult {
    const taskEntries = indexLines(api, modelId, IFCTASK);
    const tasks = new Map(
      taskEntries.map(({ expressId, line }) => [expressId, line]),
    );
    const indexes: ReaderIndexes = {
      tasks,
      nests: indexLines(api, modelId, IFCRELNESTS),
      sequences: indexLines(api, modelId, IFCRELSEQUENCE),
      processAssignments: indexLines(api, modelId, IFCRELASSIGNSTOPROCESS),
      productAssignments: indexLines(api, modelId, IFCRELASSIGNSTOPRODUCT),
      controlAssignments: indexLines(api, modelId, IFCRELASSIGNSTOCONTROL),
      propertyRelations: indexLines(api, modelId, IFCRELDEFINESBYPROPERTIES),
      parentMissionIdsByTask: new Map(),
    };
    const missionEntries = taskEntries.filter(
      ({ line }) => textValue(line.ObjectType) === "RobotMission",
    );
    const missionExpressIds = new Set(
      missionEntries.map(({ expressId }) => expressId),
    );
    for (const nest of indexes.nests) {
      const parentId = referenceId(nest.line.RelatingObject);
      if (parentId === undefined || !missionExpressIds.has(parentId)) continue;
      for (const childId of referenceIds(nest.line.RelatedObjects)) {
        const parents =
          indexes.parentMissionIdsByTask.get(childId) ?? new Set<number>();
        parents.add(parentId);
        indexes.parentMissionIdsByTask.set(childId, parents);
      }
    }
    const missionIdCounts = new Map<string, number>();
    for (const { line } of missionEntries) {
      const missionId = textValue(line.Identification)?.trim();
      if (missionId)
        missionIdCounts.set(
          missionId,
          (missionIdCounts.get(missionId) ?? 0) + 1,
        );
    }
    const duplicateMissionIds = new Set(
      [...missionIdCounts]
        .filter(([, count]) => count > 1)
        .map(([missionId]) => missionId),
    );
    const context = new MissionReadContext(
      api,
      modelId,
      sourceModelId,
      indexes,
    );
    const missions: RobotMission[] = [];
    for (const { expressId, line } of missionEntries) {
      try {
        const detectedMissionId = textValue(line.Identification)?.trim();
        if (detectedMissionId) {
          captureRecognizedProvenance(context, expressId, detectedMissionId);
        }
        missions.push(
          reconstructMission(context, expressId, duplicateMissionIds),
        );
      } catch (error) {
        if (!(error instanceof GraphIssue)) throw error;
        context.issues.push(error.issue);
      }
    }
    return {
      missions,
      issues: context.issues,
      provenance: { sourceModelId, entities: context.provenance },
      schema,
    };
  }
}
