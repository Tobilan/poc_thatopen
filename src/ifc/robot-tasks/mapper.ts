import { validateMission } from "../../domain/robot-tasks";
import type {
  RobotActionProperties,
  RobotActionType,
  RobotMission,
  RobotObjectReference,
  RobotTask,
  RobotTaskPriority,
} from "../../domain/robot-tasks";
import { ROBOT_MISSION_ANNOTATION_SCHEMA_VERSION } from "./annotationSchema";
import type {
  IfcExternalObjectReference,
  IfcProcessAssignmentName,
  IfcPropertyListValueRecord,
  IfcPropertyScalar,
  IfcPropertySetRecord,
  IfcPropertySingleValueRecord,
  IfcRecordReference,
  IfcRelAssignsToProcessRecord,
  IfcRelAssignsToProductRecord,
  IfcRelDefinesByPropertiesRecord,
  IfcRobotMissionRecordGraph,
  IfcRobotTaskRecord,
  IfcTaskRecord,
  IfcTaskTimeRecord,
} from "./records";

/** Error raised when an invalid mission cannot be mapped safely. */
export class IfcRobotTaskMappingError extends Error {
  /**
   * Creates a mapping error containing all blocking domain validation messages.
   *
   * @param messages Human-readable domain violations preventing record creation.
   */
  constructor(readonly messages: string[]) {
    super(`RobotMission cannot be mapped: ${messages.join(" ")}`);
    this.name = "IfcRobotTaskMappingError";
  }
}

/** Creates a collision-resistant, readable ID for one graph-local record. */
const recordId = (...segments: Array<string | number>) =>
  segments.map((segment) => encodeURIComponent(String(segment))).join("/");

/** Maps the domain priority scale to IfcTask.Priority. */
const ifcPriority = (
  priority: RobotTaskPriority | undefined,
): number | undefined => {
  if (priority === undefined) return undefined;
  return { low: 1, medium: 2, high: 3, critical: 4 }[priority];
};

/** Creates a typed pointer to one generated record. */
const reference = <Entity extends IfcRobotTaskRecord["entity"]>(
  entity: Entity,
  id: string,
): IfcRecordReference<Entity> => ({ entity, id });

/** Copies stable IFC identity and metadata without copying task action properties. */
const externalObjectReference = (
  source: RobotObjectReference,
): IfcExternalObjectReference => ({
  kind: "IfcObjectReference",
  globalId: source.globalId,
  modelId: source.modelId,
  expressId: source.expressId,
  ifcClass: source.ifcClass,
  name: source.name,
});

/** Chooses the semantic process relation name for a task's direct targets. */
const targetAssignmentName = (
  actionType: RobotActionType,
): IfcProcessAssignmentName => {
  if (actionType === "PASS_THROUGH") return "PASSES_THROUGH";
  if (actionType === "NAVIGATE_TO") return "NAVIGATES_TO";
  return "OPERATES_ON";
};

/** Adds one scalar property record and its typed property-set reference. */
const addSingleValue = (
  records: IfcRobotTaskRecord[],
  propertyReferences: IfcPropertySetRecord["hasProperties"],
  propertySetName: IfcPropertySetRecord["name"],
  ownerId: string,
  name: string,
  value: IfcPropertyScalar | undefined,
) => {
  if (value === undefined) return;
  const id = recordId("property", propertySetName, ownerId, name);
  const property: IfcPropertySingleValueRecord = {
    entity: "IfcPropertySingleValue",
    id,
    name,
    nominalValue: value,
  };
  records.push(property);
  propertyReferences.push(reference(property.entity, property.id));
};

/** Adds one list property record and its typed property-set reference. */
const addListValue = (
  records: IfcRobotTaskRecord[],
  propertyReferences: IfcPropertySetRecord["hasProperties"],
  propertySetName: IfcPropertySetRecord["name"],
  ownerId: string,
  name: string,
  values: readonly IfcPropertyScalar[] | undefined,
) => {
  if (values === undefined) return;
  const id = recordId("property-list", propertySetName, ownerId, name);
  const property: IfcPropertyListValueRecord = {
    entity: "IfcPropertyListValue",
    id,
    name,
    listValues: [...values],
  };
  records.push(property);
  propertyReferences.push(reference(property.entity, property.id));
};

/**
 * Maps action type and optional RobotActionProperties to a task-owned property set.
 *
 * ActionType is always present because it is the concrete behavior requested by
 * the executable task. Scalar fields become IfcPropertySingleValue records and
 * pre/postconditions become IfcPropertyListValue records. The relation's
 * relatedObjects collection contains only the generated IfcTask reference, so
 * these concrete values cannot be attached to target model objects.
 */
const mapRobotActionProperties = (
  task: RobotTask,
  taskReference: IfcRecordReference<"IfcTask">,
  records: IfcRobotTaskRecord[],
) => {
  const propertyReferences: IfcPropertySetRecord["hasProperties"] = [];
  const properties: RobotActionProperties = task.properties ?? {};
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "ActionType",
    task.actionType,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "TargetState",
    properties.targetState,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "TargetObjectRole",
    properties.targetObjectRole,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "AffectedObjectRole",
    properties.affectedObjectRole,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "RequiredCapability",
    properties.requiredCapability,
  );
  addListValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "Preconditions",
    properties.preconditions,
  );
  addListValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "Postconditions",
    properties.postconditions,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotAction",
    task.id,
    "SuccessCondition",
    properties.successCondition,
  );

  const propertySet: IfcPropertySetRecord = {
    entity: "IfcPropertySet",
    id: recordId("property-set", "RobotAction", task.id),
    name: "RobotAction",
    hasProperties: propertyReferences,
  };
  records.push(propertySet);

  const relation: IfcRelDefinesByPropertiesRecord = {
    entity: "IfcRelDefinesByProperties",
    id: recordId("relation", "RobotAction", task.id),
    relatedObjects: [taskReference],
    relatingPropertyDefinition: reference(propertySet.entity, propertySet.id),
  };
  records.push(relation);
};

/** Maps application timestamps and optional viewer annotation data to a task. */
const mapTaskMetadata = (
  task: RobotTask,
  taskReference: IfcRecordReference<"IfcTask">,
  records: IfcRobotTaskRecord[],
) => {
  const propertyReferences: IfcPropertySetRecord["hasProperties"] = [];
  addSingleValue(
    records,
    propertyReferences,
    "RobotTask",
    task.id,
    "CreatedAt",
    task.createdAt,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotTask",
    task.id,
    "UpdatedAt",
    task.updatedAt,
  );
  addListValue(
    records,
    propertyReferences,
    "RobotTask",
    task.id,
    "CameraPosition",
    task.viewpoint?.cameraPosition,
  );
  addListValue(
    records,
    propertyReferences,
    "RobotTask",
    task.id,
    "CameraTarget",
    task.viewpoint?.cameraTarget,
  );
  addListValue(
    records,
    propertyReferences,
    "RobotTask",
    task.id,
    "MarkerPosition",
    task.markerPosition,
  );

  const propertySet: IfcPropertySetRecord = {
    entity: "IfcPropertySet",
    id: recordId("property-set", "RobotTask", task.id),
    name: "RobotTask",
    hasProperties: propertyReferences,
  };
  records.push(propertySet, {
    entity: "IfcRelDefinesByProperties",
    id: recordId("relation", "RobotTask", task.id),
    relatedObjects: [taskReference],
    relatingPropertyDefinition: reference(propertySet.entity, propertySet.id),
  });
};

/** Maps mission audit timestamps to a parent-task-owned custom property set. */
const mapMissionMetadata = (
  mission: RobotMission,
  missionReference: IfcRecordReference<"IfcTask">,
  records: IfcRobotTaskRecord[],
) => {
  const propertyReferences: IfcPropertySetRecord["hasProperties"] = [];
  addSingleValue(
    records,
    propertyReferences,
    "RobotMission",
    mission.id,
    "CreatedAt",
    mission.createdAt,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotMission",
    mission.id,
    "UpdatedAt",
    mission.updatedAt,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotMission",
    mission.id,
    "AnnotationSchemaVersion",
    ROBOT_MISSION_ANNOTATION_SCHEMA_VERSION,
  );
  addSingleValue(
    records,
    propertyReferences,
    "RobotMission",
    mission.id,
    "HasExplicitSchedule",
    mission.schedule !== undefined,
  );
  const propertySet: IfcPropertySetRecord = {
    entity: "IfcPropertySet",
    id: recordId("property-set", "RobotMission", mission.id),
    name: "RobotMission",
    hasProperties: propertyReferences,
  };
  records.push(propertySet, {
    entity: "IfcRelDefinesByProperties",
    id: recordId("relation", "RobotMission", mission.id),
    relatedObjects: [missionReference],
    relatingPropertyDefinition: reference(propertySet.entity, propertySet.id),
  });
};

/** Maps direct targets, affected objects, and MOVE references to IFC relations. */
const mapObjectAssignments = (
  task: RobotTask,
  taskReference: IfcRecordReference<"IfcTask">,
  records: IfcRobotTaskRecord[],
) => {
  if (task.targetObjects.length) {
    const relation: IfcRelAssignsToProcessRecord = {
      entity: "IfcRelAssignsToProcess",
      id: recordId("relation", "targets", task.id),
      name: targetAssignmentName(task.actionType),
      relatingProcess: taskReference,
      relatedObjects: task.targetObjects.map(externalObjectReference),
    };
    records.push(relation);
  }
  if (task.affectedObjects.length) {
    const relation: IfcRelAssignsToProcessRecord = {
      entity: "IfcRelAssignsToProcess",
      id: recordId("relation", "affected", task.id),
      name: "AFFECTS",
      relatingProcess: taskReference,
      relatedObjects: task.affectedObjects.map(externalObjectReference),
    };
    records.push(relation);
  }
  if (task.actionType === "MOVE" && task.startReference) {
    const relation: IfcRelAssignsToProcessRecord = {
      entity: "IfcRelAssignsToProcess",
      id: recordId("relation", "move-from", task.id),
      name: "MOVE_FROM",
      relatingProcess: taskReference,
      relatedObjects: [externalObjectReference(task.startReference)],
    };
    records.push(relation);
  }
  if (task.actionType === "MOVE" && task.targetReference) {
    const relation: IfcRelAssignsToProductRecord = {
      entity: "IfcRelAssignsToProduct",
      id: recordId("relation", "move-to", task.id),
      name: "MOVE_TO",
      relatedObjects: [taskReference],
      relatingProduct: externalObjectReference(task.targetReference),
    };
    records.push(relation);
  }
};

/** Maps optional RobotTaskTime to a direct IfcTask.TaskTime-style record reference. */
const mapTask = (
  task: RobotTask,
  records: IfcRobotTaskRecord[],
): IfcTaskRecord => {
  const taskTimeId = task.time ? recordId("task-time", task.id) : undefined;
  const taskRecord: IfcTaskRecord = {
    entity: "IfcTask",
    id: recordId("task", task.id),
    sourceId: task.id,
    role: "EXECUTABLE_TASK",
    name: task.name,
    description: task.description,
    identification: task.id,
    objectType: "RobotTask",
    status: task.status,
    priority: ifcPriority(task.priority),
    taskTime: taskTimeId ? reference("IfcTaskTime", taskTimeId) : undefined,
  };
  records.push(taskRecord);

  if (task.time && taskTimeId) {
    const taskTime: IfcTaskTimeRecord = {
      entity: "IfcTaskTime",
      id: taskTimeId,
      sourceTaskId: task.id,
      ...task.time,
    };
    records.push(taskTime);
  }

  const taskReference = reference(taskRecord.entity, taskRecord.id);
  mapObjectAssignments(task, taskReference, records);
  mapRobotActionProperties(task, taskReference, records);
  mapTaskMetadata(task, taskReference, records);
  return taskRecord;
};

/**
 * Converts a valid RobotMission into a deterministic internal IFC-like graph.
 *
 * The mapper creates records only; it performs no STEP formatting, file writes,
 * web-ifc mutation, or legacy roundtrip behavior. Blocking domain validation
 * errors stop mapping so invalid sequence graphs and incomplete executable tasks
 * cannot be represented as if they were ready for serialization.
 *
 * @param mission New-domain RobotMission aggregate to map.
 * @returns Flat typed records with explicit graph references.
 * @throws IfcRobotTaskMappingError When domain validation reports errors.
 */
export const mapMissionToIfcRecords = (
  mission: RobotMission,
): IfcRobotMissionRecordGraph => {
  const errors = validateMission(mission).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length) {
    throw new IfcRobotTaskMappingError(
      errors.map((validationIssue) => validationIssue.message),
    );
  }

  const records: IfcRobotTaskRecord[] = [];
  const missionTask: IfcTaskRecord = {
    entity: "IfcTask",
    id: recordId("mission-task", mission.id),
    sourceId: mission.id,
    role: "MISSION",
    name: mission.name,
    description: mission.description,
    identification: mission.id,
    objectType: "RobotMission",
    status: mission.status,
    priority: ifcPriority(mission.priority),
  };
  records.push(missionTask);
  const missionReference = reference(missionTask.entity, missionTask.id);
  mapMissionMetadata(mission, missionReference, records);

  const taskRecords = mission.tasks.map((task) => mapTask(task, records));
  records.push({
    entity: "IfcRelNests",
    id: recordId("relation", "nests", mission.id),
    relatingObject: missionReference,
    relatedObjects: taskRecords.map((taskRecord) =>
      reference(taskRecord.entity, taskRecord.id),
    ),
  });

  const scheduleId = mission.schedule?.id ?? recordId("schedule", mission.id);
  const workScheduleId = recordId("work-schedule", scheduleId);
  records.push(
    {
      entity: "IfcWorkSchedule",
      id: workScheduleId,
      sourceId: scheduleId,
      name: mission.schedule?.name ?? `${mission.name} Schedule`,
      identification: scheduleId,
      creationDate: mission.createdAt,
      startTime: mission.schedule?.scheduleStart ?? mission.createdAt,
      finishTime: mission.schedule?.scheduleFinish,
      duration: mission.schedule?.scheduleDuration,
    },
    {
      entity: "IfcRelAssignsToControl",
      id: recordId("relation", "schedule", mission.id),
      relatedObjects: [missionReference],
      relatingControl: reference("IfcWorkSchedule", workScheduleId),
    },
  );

  const taskRecordBySourceId = new Map(
    taskRecords.map((taskRecord) => [taskRecord.sourceId, taskRecord]),
  );
  for (const sequence of mission.sequences) {
    const predecessor = taskRecordBySourceId.get(sequence.predecessorTaskId)!;
    const successor = taskRecordBySourceId.get(sequence.successorTaskId)!;
    records.push({
      entity: "IfcRelSequence",
      id: recordId("relation", "sequence", sequence.id),
      sourceId: sequence.id,
      relatingProcess: reference(predecessor.entity, predecessor.id),
      relatedProcess: reference(successor.entity, successor.id),
      sequenceType: sequence.sequenceType,
    });
  }

  return {
    missionId: mission.id,
    rootTask: missionReference,
    records,
  };
};
