export type RobotTaskStatus = "open" | "in_progress" | "done" | "blocked";

export type RobotTaskPriority = "low" | "medium" | "high";

export type RobotActionVerb = "set_state";

export type RobotTargetState = "open" | "closed" | "on" | "off";

export type RobotActionExecutionStatus =
  | "not_executed"
  | "succeeded"
  | "failed";

export type RobotAction = {
  verb: RobotActionVerb;
  targetState: RobotTargetState;
  interactionPoint?: [number, number, number];
  coordinateReference: "viewer-local";
  executionStatus: RobotActionExecutionStatus;
  observedState?: RobotTargetState;
  executedAt?: string;
};

export type RobotActionDraft = Omit<
  RobotAction,
  "interactionPoint" | "coordinateReference"
>;

export type TaskViewpoint = {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
};

export type RobotTask = {
  id: string;
  title: string;
  description?: string;
  status: RobotTaskStatus;
  priority: RobotTaskPriority;
  assignedRobot?: string;
  relatedElementGlobalId: string;
  relatedModelId?: string;
  viewpoint?: TaskViewpoint;
  markerPosition?: [number, number, number];
  action?: RobotAction;
  createdAt: string;
  updatedAt: string;
};

export type RobotTaskDraft = Pick<
  RobotTask,
  "title" | "description" | "status" | "priority" | "assignedRobot"
> & {
  action?: RobotActionDraft;
};

export type RobotTaskUpdate = Partial<RobotTaskDraft>;
