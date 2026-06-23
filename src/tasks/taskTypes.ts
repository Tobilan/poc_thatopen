export type RobotTaskStatus = "open" | "in_progress" | "done" | "blocked";

export type RobotTaskPriority = "low" | "medium" | "high";

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
  createdAt: string;
  updatedAt: string;
};

export type RobotTaskDraft = Pick<
  RobotTask,
  "title" | "description" | "status" | "priority" | "assignedRobot"
>;

export type RobotTaskUpdate = Partial<RobotTaskDraft>;
