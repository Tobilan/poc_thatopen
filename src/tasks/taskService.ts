import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { TaskMarkers } from "./taskMarkers";
import { TaskStore } from "./taskStore";
import { RobotTask, RobotTaskDraft, RobotTaskUpdate } from "./taskTypes";

export type TaskModelContext = {
  modelId: string;
  modelHash: string;
  label: string;
};

type StoredTask = {
  task: RobotTask;
  context: TaskModelContext;
};

export class TaskServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskServiceError";
  }
}

/** Coordinates task persistence, element selection and marker rendering. */
export class TaskService {
  private readonly contexts = new Map<string, TaskModelContext>();
  private readonly tasksByModelId = new Map<string, RobotTask[]>();
  private readonly listeners = new Set<() => void>();
  private readonly markers: TaskMarkers;
  private activeModelId: string | null = null;
  private selectedTaskId: string | null = null;
  private markerRefresh = 0;
  error: string | null = null;

  constructor(
    private readonly components: OBC.Components,
    world: OBC.World,
    private readonly store: TaskStore,
  ) {
    this.markers = new TaskMarkers(components, world, (taskId) => {
      void this.selectTask(taskId);
    });
  }

  get tasks() {
    if (!this.activeModelId) return [];
    return this.tasksByModelId.get(this.activeModelId) ?? [];
  }

  get selectedTask() {
    if (!this.selectedTaskId) return null;
    return this.findTask(this.selectedTaskId)?.task ?? null;
  }

  get activeModelLabel() {
    if (!this.activeModelId) return null;
    return this.contexts.get(this.activeModelId)?.label ?? null;
  }

  get canCreateTask() {
    const modelId = this.getSelectedModelId();
    return Boolean(modelId && this.contexts.has(modelId));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerModel(context: TaskModelContext) {
    this.contexts.set(context.modelId, context);
    this.activeModelId = context.modelId;
    this.selectedTaskId = null;
    try {
      this.tasksByModelId.set(context.modelId, this.store.get(context.modelHash));
      this.error = null;
    } catch (error) {
      this.tasksByModelId.set(context.modelId, []);
      this.setError(error);
    }
    this.refreshMarkers();
    this.notify();
  }

  unregisterModel(modelId: string) {
    this.contexts.delete(modelId);
    this.tasksByModelId.delete(modelId);
    if (this.activeModelId === modelId) {
      this.activeModelId = this.contexts.keys().next().value ?? null;
    }
    if (this.selectedTaskId && !this.findTask(this.selectedTaskId)) {
      this.selectedTaskId = null;
    }
    this.refreshMarkers();
    this.notify();
  }

  async createTask(draft: RobotTaskDraft) {
    const modelId = this.getSelectedModelId();
    if (!modelId) {
      throw new TaskServiceError("Select exactly one element before creating a task.");
    }
    const selection = this.getSingleSelection();
    const context = this.contexts.get(modelId);
    if (!context) throw new TaskServiceError("The selected model is not ready for tasks.");

    const fragments = this.components.get(OBC.FragmentsManager);
    const guids = await fragments.modelIdMapToGuids(selection);
    if (guids.length !== 1) {
      throw new TaskServiceError("The selected element has no unique IFC GlobalId.");
    }
    const center = await this.components.get(OBC.BoundingBoxer).getCenter(selection);
    const task = this.store.create(
      context.modelHash,
      draft,
      guids[0],
      modelId,
      [center.x, center.y, center.z],
    );

    const tasks = this.tasksByModelId.get(modelId) ?? [];
    tasks.unshift(task);
    this.tasksByModelId.set(modelId, tasks);
    this.activeModelId = modelId;
    this.selectedTaskId = task.id;
    this.error = null;
    this.refreshMarkers();
    this.notify();
    return task;
  }

  updateTask(id: string, update: RobotTaskUpdate) {
    const stored = this.findTask(id);
    if (!stored) throw new TaskServiceError("The selected task no longer exists.");
    const task = this.store.update(stored.context.modelHash, id, update);
    const tasks = this.tasksByModelId.get(stored.context.modelId) ?? [];
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index >= 0) tasks[index] = task;
    this.error = null;
    this.refreshMarkers();
    this.notify();
    return task;
  }

  deleteTask(id: string) {
    const stored = this.findTask(id);
    if (!stored) throw new TaskServiceError("The selected task no longer exists.");
    this.store.delete(stored.context.modelHash, id);
    const tasks = this.tasksByModelId.get(stored.context.modelId) ?? [];
    this.tasksByModelId.set(
      stored.context.modelId,
      tasks.filter((task) => task.id !== id),
    );
    if (this.selectedTaskId === id) this.selectedTaskId = null;
    this.error = null;
    this.refreshMarkers();
    this.notify();
  }

  async selectTask(id: string) {
    const stored = this.findTask(id);
    if (!stored) {
      this.error = "The selected task no longer exists.";
      this.notify();
      return;
    }
    const selection = await this.getTaskSelection(stored);
    if (!selection) {
      this.error = "The task's IFC element is not available in the loaded model.";
      this.notify();
      return;
    }

    const highlighter = this.components.get(OBF.Highlighter);
    await highlighter.highlightByID("select", selection, true, true);
    this.activeModelId = stored.context.modelId;
    this.selectedTaskId = id;
    this.error = null;
    this.notify();
  }

  private getSelectedModelId() {
    const selection = this.getSingleSelectionOrNull();
    if (!selection) return null;
    return Object.keys(selection)[0] ?? null;
  }

  private getSingleSelection() {
    const selection = this.getSingleSelectionOrNull();
    if (!selection) {
      throw new TaskServiceError("Select exactly one element before creating a task.");
    }
    return selection;
  }

  private getSingleSelectionOrNull() {
    const selection = this.components.get(OBF.Highlighter).selection.select;
    const entries = Object.entries(selection).filter(([, localIds]) => localIds.size);
    const count = entries.reduce((total, [, localIds]) => total + localIds.size, 0);
    if (entries.length !== 1 || count !== 1) return null;
    const [modelId, localIds] = entries[0];
    return { [modelId]: localIds };
  }

  private findTask(id: string): StoredTask | null {
    for (const [modelId, tasks] of this.tasksByModelId) {
      const task = tasks.find((candidate) => candidate.id === id);
      const context = this.contexts.get(modelId);
      if (task && context) return { task, context };
    }
    return null;
  }

  private async getTaskSelection(stored: StoredTask) {
    const fragments = this.components.get(OBC.FragmentsManager);
    const allModels = await fragments.guidsToModelIdMap([
      stored.task.relatedElementGlobalId,
    ]);
    const localIds = allModels[stored.context.modelId];
    if (!localIds?.size) return null;
    return { [stored.context.modelId]: localIds };
  }

  private refreshMarkers() {
    const refreshId = ++this.markerRefresh;
    void this.updateMarkers(refreshId);
  }

  private async updateMarkers(refreshId: number) {
    try {
      const available: RobotTask[] = [];
      for (const [modelId, tasks] of this.tasksByModelId) {
        const context = this.contexts.get(modelId);
        if (!context) continue;
        for (const task of tasks) {
          if (await this.getTaskSelection({ task, context })) available.push(task);
        }
      }
      if (refreshId !== this.markerRefresh) return;
      this.markers.sync(available);
    } catch {
      if (refreshId !== this.markerRefresh) return;
      this.markers.clear();
      this.error = "Task markers could not be resolved for the loaded model.";
      this.notify();
    }
  }

  private setError(error: unknown) {
    this.error = error instanceof Error ? error.message : "Task storage failed.";
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
