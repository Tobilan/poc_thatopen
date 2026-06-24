import * as OBC from "@thatopen/components";
import * as WEBIFC from "web-ifc";
import {
  RobotAction,
  RobotActionExecutionStatus,
  RobotTask,
  RobotTaskPriority,
  RobotTaskStatus,
  RobotTargetState,
} from "./taskTypes";

const TASK_PSET_NAME = "Pset_RobotTask";

type IfcLine = {
  expressID: number;
  Name?: { value?: unknown };
  GlobalId?: { value?: unknown };
  OwnerHistory?: unknown;
  HasProperties?: Array<{ value?: unknown }>;
  NominalValue?: { value?: unknown };
  RelatingPropertyDefinition?: { value?: unknown };
  RelatedObjects?: Array<{ value?: unknown }>;
};

type IfcExportResult = {
  bytes: Uint8Array;
  taskCount: number;
};

const statuses: RobotTaskStatus[] = ["open", "in_progress", "done", "blocked"];
const priorities: RobotTaskPriority[] = ["low", "medium", "high"];
const targetStates: RobotTargetState[] = ["open", "closed", "on", "off"];
const executionStatuses: RobotActionExecutionStatus[] = [
  "not_executed",
  "succeeded",
  "failed",
];

const valueOf = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { value?: unknown };
  return candidate.value;
};

const stringValue = (value: unknown) => {
  const result = valueOf(value);
  return typeof result === "string" ? result : undefined;
};

const reference = (expressID: number) => ({ type: WEBIFC.REF, value: expressID });

const getTaskProperties = (task: RobotTask) => {
  const properties: Array<[string, string]> = [
    ["TaskId", task.id],
    ["Title", task.title],
    ["Status", task.status],
    ["Priority", task.priority],
    ["CreatedAt", task.createdAt],
    ["UpdatedAt", task.updatedAt],
  ];
  if (task.description) properties.push(["Description", task.description]);
  if (task.assignedRobot) properties.push(["AssignedRobot", task.assignedRobot]);
  if (task.markerPosition) {
    properties.push(["MarkerPosition", JSON.stringify(task.markerPosition)]);
  }
  if (task.action) {
    properties.push(["ActionVerb", task.action.verb.toUpperCase()]);
    properties.push(["TargetState", task.action.targetState.toUpperCase()]);
    if (task.action.interactionPoint) {
      properties.push([
        "InteractionPoint",
        JSON.stringify(task.action.interactionPoint),
      ]);
    }
    properties.push([
      "InteractionCoordinateReference",
      task.action.coordinateReference.toUpperCase(),
    ]);
    properties.push([
      "ExecutionStatus",
      task.action.executionStatus.toUpperCase(),
    ]);
    if (task.action.observedState) {
      properties.push(["ObservedState", task.action.observedState.toUpperCase()]);
    }
    if (task.action.executedAt) {
      properties.push(["ExecutedAt", task.action.executedAt]);
    }
  }
  return properties;
};

const getPsetName = (line: IfcLine) => stringValue(line.Name) === TASK_PSET_NAME;

const runWithIfcModel = async <T>(
  loader: OBC.IfcLoader,
  bytes: Uint8Array,
  action: (api: WEBIFC.IfcAPI, modelID: number) => T,
) => {
  let modelID: number | null = null;
  let api: WEBIFC.IfcAPI | null = null;
  try {
    modelID = await loader.readIfcFile(bytes);
    api = loader.webIfc;
    if (modelID < 0) throw new Error("The IFC file could not be opened for export.");
    return action(api, modelID);
  } finally {
    if (api && modelID !== null && modelID >= 0) api.CloseModel(modelID);
    loader.cleanUp();
  }
};

const getRobotPropertySetIds = (api: WEBIFC.IfcAPI, modelID: number) => {
  const psets = api.GetLineIDsWithType(modelID, WEBIFC.IFCPROPERTYSET);
  const ids: number[] = [];
  for (let index = 0; index < psets.size(); index += 1) {
    const pset = api.GetLine(modelID, psets.get(index)) as IfcLine;
    if (getPsetName(pset)) ids.push(pset.expressID);
  }
  return ids;
};

const removeExistingRobotTasks = (api: WEBIFC.IfcAPI, modelID: number) => {
  const psetIds = new Set(getRobotPropertySetIds(api, modelID));
  if (!psetIds.size) return;

  const relationIds = api.GetLineIDsWithType(
    modelID,
    WEBIFC.IFCRELDEFINESBYPROPERTIES,
  );
  for (let index = 0; index < relationIds.size(); index += 1) {
    const relation = api.GetLine(modelID, relationIds.get(index)) as IfcLine;
    const psetId = valueOf(relation.RelatingPropertyDefinition);
    if (typeof psetId === "number" && psetIds.has(psetId)) {
      api.DeleteLine(modelID, relation.expressID);
    }
  }

  for (const psetId of psetIds) {
    const pset = api.GetLine(modelID, psetId) as IfcLine;
    for (const property of pset.HasProperties ?? []) {
      const propertyId = valueOf(property);
      if (typeof propertyId === "number") api.DeleteLine(modelID, propertyId);
    }
    api.DeleteLine(modelID, psetId);
  }
};

const getElementExpressId = (
  api: WEBIFC.IfcAPI,
  modelID: number,
  globalId: string,
) => {
  const expressID = api.GetExpressIdFromGuid(modelID, globalId);
  return typeof expressID === "number" ? expressID : null;
};

export const exportTasksToIfc = async (
  loader: OBC.IfcLoader,
  source: Uint8Array,
  tasks: RobotTask[],
): Promise<IfcExportResult> => {
  return runWithIfcModel(loader, source, (api, modelID) => {
    removeExistingRobotTasks(api, modelID);

    let taskCount = 0;
    for (const task of tasks) {
      const elementId = getElementExpressId(
        api,
        modelID,
        task.relatedElementGlobalId,
      );
      if (elementId === null) continue;

      const element = api.GetLine(modelID, elementId) as IfcLine;
      const properties = getTaskProperties(task).map(([name, value]) => {
        return api.CreateIfcEntity(
          modelID,
          WEBIFC.IFCPROPERTYSINGLEVALUE,
          api.CreateIfcType(modelID, WEBIFC.IFCIDENTIFIER, name),
          null,
          api.CreateIfcType(modelID, WEBIFC.IFCTEXT, value),
          null,
        );
      });
      const propertySet = api.CreateIfcEntity(
        modelID,
        WEBIFC.IFCPROPERTYSET,
        api.CreateIFCGloballyUniqueId(modelID),
        element.OwnerHistory ?? null,
        api.CreateIfcType(modelID, WEBIFC.IFCLABEL, TASK_PSET_NAME),
        null,
        properties,
      );
      const relation = api.CreateIfcEntity(
        modelID,
        WEBIFC.IFCRELDEFINESBYPROPERTIES,
        api.CreateIFCGloballyUniqueId(modelID),
        element.OwnerHistory ?? null,
        null,
        null,
        [reference(elementId)],
        propertySet,
      );
      api.WriteLine(modelID, relation);
      taskCount += 1;
    }

    return { bytes: api.SaveModel(modelID), taskCount };
  });
};

const readPropertySet = (api: WEBIFC.IfcAPI, modelID: number, pset: IfcLine) => {
  const properties = new Map<string, string>();
  for (const propertyReference of pset.HasProperties ?? []) {
    const propertyId = valueOf(propertyReference);
    if (typeof propertyId !== "number") continue;
    const property = api.GetLine(modelID, propertyId) as IfcLine;
    const name = stringValue(property.Name);
    const value = stringValue(property.NominalValue);
    if (name && value !== undefined) properties.set(name, value);
  }
  return properties;
};

const getMarkerPosition = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((coordinate) => typeof coordinate === "number")
    ) {
      return parsed as [number, number, number];
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const getTargetState = (value: string | undefined) => {
  if (!value) return undefined;
  const state = value.toLowerCase() as RobotTargetState;
  return targetStates.includes(state) ? state : undefined;
};

const getExecutionStatus = (value: string | undefined) => {
  if (!value) return undefined;
  const status = value.toLowerCase() as RobotActionExecutionStatus;
  return executionStatuses.includes(status) ? status : undefined;
};

const getRobotAction = (properties: Map<string, string>) => {
  const verb = properties.get("ActionVerb")?.toLowerCase();
  const targetState = getTargetState(properties.get("TargetState"));
  const executionStatus = getExecutionStatus(properties.get("ExecutionStatus"));
  if (verb !== "set_state" || !targetState || !executionStatus) return undefined;

  const action: RobotAction = {
    verb: "set_state",
    targetState,
    coordinateReference: "viewer-local",
    executionStatus,
  };
  const interactionPoint = getMarkerPosition(properties.get("InteractionPoint"));
  const observedState = getTargetState(properties.get("ObservedState"));
  const executedAt = properties.get("ExecutedAt");
  if (interactionPoint) action.interactionPoint = interactionPoint;
  if (observedState) action.observedState = observedState;
  if (executedAt) action.executedAt = executedAt;
  return action;
};

export const importTasksFromIfc = async (
  loader: OBC.IfcLoader,
  source: Uint8Array,
  relatedModelId: string,
): Promise<RobotTask[]> => {
  return runWithIfcModel(loader, source, (api, modelID) => {
    const psetIds = new Set(getRobotPropertySetIds(api, modelID));
    if (!psetIds.size) return [];

    const relations = api.GetLineIDsWithType(
      modelID,
      WEBIFC.IFCRELDEFINESBYPROPERTIES,
    );
    const tasks: RobotTask[] = [];
    for (let index = 0; index < relations.size(); index += 1) {
      const relation = api.GetLine(modelID, relations.get(index)) as IfcLine;
      const psetId = valueOf(relation.RelatingPropertyDefinition);
      if (typeof psetId !== "number" || !psetIds.has(psetId)) continue;
      const properties = readPropertySet(
        api,
        modelID,
        api.GetLine(modelID, psetId) as IfcLine,
      );
      const id = properties.get("TaskId");
      const title = properties.get("Title");
      const status = properties.get("Status");
      const priority = properties.get("Priority");
      const createdAt = properties.get("CreatedAt");
      const updatedAt = properties.get("UpdatedAt");
      if (
        !id ||
        !title ||
        !status ||
        !priority ||
        !createdAt ||
        !updatedAt ||
        !statuses.includes(status as RobotTaskStatus) ||
        !priorities.includes(priority as RobotTaskPriority)
      ) {
        continue;
      }

      for (const relatedObject of relation.RelatedObjects ?? []) {
        const expressID = valueOf(relatedObject);
        if (typeof expressID !== "number") continue;
        const globalId = api.GetGuidFromExpressId(modelID, expressID);
        if (typeof globalId !== "string") continue;
        const task: RobotTask = {
          id,
          title,
          status: status as RobotTaskStatus,
          priority: priority as RobotTaskPriority,
          relatedElementGlobalId: globalId,
          relatedModelId,
          createdAt,
          updatedAt,
        };
        const description = properties.get("Description");
        const assignedRobot = properties.get("AssignedRobot");
        const markerPosition = getMarkerPosition(properties.get("MarkerPosition"));
        const action = getRobotAction(properties);
        if (description) task.description = description;
        if (assignedRobot) task.assignedRobot = assignedRobot;
        if (markerPosition) task.markerPosition = markerPosition;
        if (action) task.action = action;
        tasks.push(task);
      }
    }
    return tasks;
  });
};
