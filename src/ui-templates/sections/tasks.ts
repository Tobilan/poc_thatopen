import * as BUI from "@thatopen/ui";
import { appIcons } from "../../globals";
import { TaskService } from "../../tasks/taskService";
import {
  RobotTask,
  RobotTaskDraft,
  RobotTaskPriority,
  RobotTaskStatus,
} from "../../tasks/taskTypes";

type TaskForm = RobotTaskDraft;

const defaultForm = (): TaskForm => ({
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  assignedRobot: "",
});

class TaskPanelController {
  form = defaultForm();
  editingTaskId: string | null = null;
  creating = false;
  message: string | null = null;
  unsubscribe?: () => void;

  startCreate() {
    this.form = defaultForm();
    this.editingTaskId = null;
    this.creating = true;
    this.message = null;
  }

  startEdit(task: RobotTask) {
    this.form = {
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      assignedRobot: task.assignedRobot ?? "",
    };
    this.editingTaskId = task.id;
    this.creating = false;
    this.message = null;
  }

  closeForm() {
    this.form = defaultForm();
    this.editingTaskId = null;
    this.creating = false;
    this.message = null;
  }
}

export interface TasksPanelState {
  service: TaskService;
  controller?: TaskPanelController;
}

const statusOptions: RobotTaskStatus[] = [
  "open",
  "in_progress",
  "done",
  "blocked",
];

const priorityOptions: RobotTaskPriority[] = ["low", "medium", "high"];

const readableStatus = (status: RobotTaskStatus) => status.replace("_", " ");

export const tasksPanelTemplate: BUI.StatefullComponent<TasksPanelState> = (
  state,
  update,
) => {
  const { service } = state;
  const controller = state.controller ?? new TaskPanelController();
  state.controller = controller;
  if (!controller.unsubscribe) controller.unsubscribe = service.subscribe(update);

  const showError = (error: unknown) => {
    controller.message =
      error instanceof Error ? error.message : "The task action could not be completed.";
    update();
  };

  const onStartCreate = () => {
    if (!service.canCreateTask) {
      controller.message = "Select exactly one element in the active model first.";
      update();
      return;
    }
    controller.startCreate();
    update();
  };

  const onSave = async () => {
    try {
      if (controller.editingTaskId) {
        service.updateTask(controller.editingTaskId, controller.form);
      } else {
        await service.createTask(controller.form);
      }
      controller.closeForm();
      update();
    } catch (error) {
      showError(error);
    }
  };

  const onSelectTask = async (task: RobotTask) => {
    await service.selectTask(task.id);
    if (service.error) controller.message = service.error;
    else controller.message = null;
    update();
  };

  const onDelete = (task: RobotTask) => {
    try {
      service.deleteTask(task.id);
      if (controller.editingTaskId === task.id) controller.closeForm();
      update();
    } catch (error) {
      showError(error);
    }
  };

  const formVisible = controller.creating || controller.editingTaskId !== null;
  const selectedTask = service.selectedTask;
  const message = controller.message ?? service.error;

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="Robot Tasks">
      <div class="task-panel">
        <div class="task-panel__header">
          <span class="task-panel__model">${service.activeModelLabel ?? "No model loaded"}</span>
          <bim-button style="flex: 0" label="Add task" icon=${appIcons.ADD} ?disabled=${!service.canCreateTask} @click=${onStartCreate}></bim-button>
        </div>
        ${message
          ? BUI.html`<p class="task-panel__message">${message}</p>`
          : undefined}
        ${formVisible
          ? BUI.html`
              <div class="task-form">
                <bim-text-input vertical label="Title" .value=${controller.form.title} @input=${(event: Event) => {
                  controller.form.title = (event.target as BUI.TextInput).value;
                }}></bim-text-input>
                <bim-text-input vertical rows="3" label="Description" .value=${controller.form.description ?? ""} @input=${(event: Event) => {
                  controller.form.description = (event.target as BUI.TextInput).value;
                }}></bim-text-input>
                <bim-text-input vertical label="Assigned robot" .value=${controller.form.assignedRobot ?? ""} @input=${(event: Event) => {
                  controller.form.assignedRobot = (event.target as BUI.TextInput).value;
                }}></bim-text-input>
                <div class="task-form__choices">
                  <bim-dropdown label="Status" @change=${({ target }: { target: BUI.Dropdown }) => {
                    const [status] = target.value;
                    if (status && statusOptions.includes(status as RobotTaskStatus)) {
                      controller.form.status = status as RobotTaskStatus;
                    }
                  }}>
                    ${statusOptions.map(
                      (status) => BUI.html`<bim-option label=${readableStatus(status)} ?checked=${controller.form.status === status}></bim-option>`,
                    )}
                  </bim-dropdown>
                  <bim-dropdown label="Priority" @change=${({ target }: { target: BUI.Dropdown }) => {
                    const [priority] = target.value;
                    if (priority && priorityOptions.includes(priority as RobotTaskPriority)) {
                      controller.form.priority = priority as RobotTaskPriority;
                    }
                  }}>
                    ${priorityOptions.map(
                      (priority) => BUI.html`<bim-option label=${priority} ?checked=${controller.form.priority === priority}></bim-option>`,
                    )}
                  </bim-dropdown>
                </div>
                <div class="task-form__actions">
                  <bim-button style="flex: 0" label="Save" icon="mdi:content-save" @click=${onSave}></bim-button>
                  <bim-button style="flex: 0" label="Cancel" @click=${() => {
                    controller.closeForm();
                    update();
                  }}></bim-button>
                </div>
              </div>
            `
          : undefined}
        <div class="task-list">
          ${service.tasks.length
            ? service.tasks.map(
                (task) => BUI.html`
                  <article class="task-list__item ${selectedTask?.id === task.id ? "selected" : ""}">
                    <div class="task-list__content">
                      <strong>${task.title}</strong>
                      <span>${readableStatus(task.status)} · ${task.priority}</span>
                      ${task.assignedRobot
                        ? BUI.html`<span>Robot: ${task.assignedRobot}</span>`
                        : undefined}
                      <code>${task.relatedElementGlobalId}</code>
                    </div>
                    <div class="task-list__actions">
                      <bim-button style="flex: 0" icon=${appIcons.SELECT} tooltip-title="Select element" @click=${() => onSelectTask(task)}></bim-button>
                      <bim-button style="flex: 0" icon=${appIcons.SETTINGS} tooltip-title="Edit task" @click=${() => {
                        controller.startEdit(task);
                        update();
                      }}></bim-button>
                      <bim-button style="flex: 0" icon="mdi:delete" tooltip-title="Delete task" @click=${() => onDelete(task)}></bim-button>
                    </div>
                  </article>
                `,
              )
            : BUI.html`<p class="task-panel__empty">No tasks for this model yet.</p>`}
        </div>
      </div>
    </bim-panel-section>
  `;
};
