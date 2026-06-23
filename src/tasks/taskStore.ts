import {
  RobotTask,
  RobotTaskDraft,
  RobotTaskPriority,
  RobotTaskStatus,
  RobotTaskUpdate,
} from "./taskTypes";

const STORAGE_PREFIX = "robot-tasks:v1:";

type TaskEnvelope = {
  version: 1;
  tasks: RobotTask[];
};

const statuses: RobotTaskStatus[] = ["open", "in_progress", "done", "blocked"];
const priorities: RobotTaskPriority[] = ["low", "medium", "high"];

const isString = (value: unknown): value is string => typeof value === "string";

const isPosition = (value: unknown): value is [number, number, number] => {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((coordinate) => typeof coordinate === "number")
  );
};

const isRobotTask = (value: unknown): value is RobotTask => {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<RobotTask>;
  return (
    isString(task.id) &&
    isString(task.title) &&
    statuses.includes(task.status as RobotTaskStatus) &&
    priorities.includes(task.priority as RobotTaskPriority) &&
    isString(task.relatedElementGlobalId) &&
    isString(task.createdAt) &&
    isString(task.updatedAt) &&
    (task.description === undefined || isString(task.description)) &&
    (task.assignedRobot === undefined || isString(task.assignedRobot)) &&
    (task.relatedModelId === undefined || isString(task.relatedModelId)) &&
    (task.markerPosition === undefined || isPosition(task.markerPosition))
  );
};

export class TaskStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskStorageError";
  }
}

/** Stores task data separately from IFC files, grouped by an immutable model hash. */
export class TaskStore {
  constructor(private readonly storage: Storage) {}

  get(modelHash: string): RobotTask[] {
    const raw = this.read(modelHash);
    return [...raw.tasks].sort((first, second) =>
      second.createdAt.localeCompare(first.createdAt),
    );
  }

  create(
    modelHash: string,
    draft: RobotTaskDraft,
    relatedElementGlobalId: string,
    relatedModelId: string,
    markerPosition: [number, number, number],
  ): RobotTask {
    const title = draft.title.trim();
    if (!title) throw new TaskStorageError("A task title is required.");

    const now = new Date().toISOString();
    const task: RobotTask = {
      id: crypto.randomUUID(),
      title,
      status: draft.status,
      priority: draft.priority,
      relatedElementGlobalId,
      relatedModelId,
      markerPosition,
      createdAt: now,
      updatedAt: now,
    };

    const description = draft.description?.trim();
    const assignedRobot = draft.assignedRobot?.trim();
    if (description) task.description = description;
    if (assignedRobot) task.assignedRobot = assignedRobot;

    const envelope = this.read(modelHash);
    envelope.tasks.push(task);
    this.write(modelHash, envelope);
    return task;
  }

  update(modelHash: string, id: string, update: RobotTaskUpdate): RobotTask {
    const envelope = this.read(modelHash);
    const task = envelope.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new TaskStorageError("The selected task no longer exists.");

    if (update.title !== undefined) {
      const title = update.title.trim();
      if (!title) throw new TaskStorageError("A task title is required.");
      task.title = title;
    }
    if (update.description !== undefined) {
      const description = update.description.trim();
      if (description) task.description = description;
      else delete task.description;
    }
    if (update.assignedRobot !== undefined) {
      const robot = update.assignedRobot.trim();
      if (robot) task.assignedRobot = robot;
      else delete task.assignedRobot;
    }
    if (update.status !== undefined) task.status = update.status;
    if (update.priority !== undefined) task.priority = update.priority;

    task.updatedAt = new Date().toISOString();
    this.write(modelHash, envelope);
    return task;
  }

  delete(modelHash: string, id: string): void {
    const envelope = this.read(modelHash);
    const nextTasks = envelope.tasks.filter((task) => task.id !== id);
    if (nextTasks.length === envelope.tasks.length) {
      throw new TaskStorageError("The selected task no longer exists.");
    }
    this.write(modelHash, { version: 1, tasks: nextTasks });
  }

  private read(modelHash: string): TaskEnvelope {
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(this.key(modelHash));
    } catch {
      throw new TaskStorageError("Task storage is unavailable in this browser.");
    }
    if (!serialized) return { version: 1, tasks: [] };

    try {
      const parsed = JSON.parse(serialized) as Partial<TaskEnvelope>;
      if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
        throw new Error("Unsupported task storage format.");
      }
      if (!parsed.tasks.every(isRobotTask)) {
        throw new Error("Invalid task data.");
      }
      return { version: 1, tasks: parsed.tasks };
    } catch {
      throw new TaskStorageError(
        "Stored task data is invalid. It was left unchanged.",
      );
    }
  }

  private write(modelHash: string, envelope: TaskEnvelope): void {
    try {
      this.storage.setItem(this.key(modelHash), JSON.stringify(envelope));
    } catch {
      throw new TaskStorageError("The task could not be saved to local storage.");
    }
  }

  private key(modelHash: string) {
    return `${STORAGE_PREFIX}${modelHash}`;
  }
}

export const getModelHash = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};
