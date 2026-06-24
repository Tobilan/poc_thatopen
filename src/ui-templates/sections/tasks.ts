import * as BUI from "@thatopen/ui";
import { appIcons } from "../../globals";
import { TaskService } from "../../tasks/taskService";
import {
  RobotActionDraft,
  RobotActionExecutionStatus,
  RobotTask,
  RobotTaskDraft,
  RobotTaskPriority,
  RobotTaskStatus,
  RobotTargetState,
} from "../../tasks/taskTypes";

type TaskForm = RobotTaskDraft;

const defaultAction = (): RobotActionDraft => ({
  verb: "set_state",
  targetState: "closed",
  executionStatus: "not_executed",
});

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
      action: task.action
        ? {
            verb: task.action.verb,
            targetState: task.action.targetState,
            executionStatus: task.action.executionStatus,
            observedState: task.action.observedState,
            executedAt: task.action.executedAt,
          }
        : undefined,
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
const targetStateOptions: RobotTargetState[] = ["open", "closed", "on", "off"];
const executionStatusOptions: RobotActionExecutionStatus[] = [
  "not_executed",
  "succeeded",
  "failed",
];

const readableStatus = (status: RobotTaskStatus) => status.replace("_", " ");
const readableValue = (value: string) => value.replace(/_/g, " ");

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

  const onExportIfc = async () => {
    try {
      const exported = await service.exportActiveIfc();
      const blob = new Blob([exported.bytes], { type: "application/x-step" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.fileName;
      link.click();
      URL.revokeObjectURL(url);
      controller.message = `${exported.taskCount} task(s) exported to ${exported.fileName}.`;
      update();
    } catch (error) {
      showError(error);
    }
  };

  const setActionMode = ({ target }: { target: BUI.Dropdown }) => {
    const [mode] = target.value;
    controller.form.action = mode === "Set state" ? defaultAction() : undefined;
    update();
  };

  const setTargetState = ({ target }: { target: BUI.Dropdown }) => {
    const [targetState] = target.value;
    const action = controller.form.action;
    if (
      !action ||
      !targetStateOptions.includes(targetState as RobotTargetState)
    ) {
      return;
    }
    action.targetState = targetState as RobotTargetState;
  };

  const setExecutionStatus = ({ target }: { target: BUI.Dropdown }) => {
    const [executionStatus] = target.value;
    const action = controller.form.action;
    if (
      !action ||
      !executionStatusOptions.includes(
        executionStatus as RobotActionExecutionStatus,
      )
    ) {
      return;
    }
    action.executionStatus = executionStatus as RobotActionExecutionStatus;
    if (action.executionStatus === "not_executed") {
      delete action.observedState;
      delete action.executedAt;
    } else if (!action.executedAt) {
      action.executedAt = new Date().toISOString();
    }
    update();
  };

  const setObservedState = ({ target }: { target: BUI.Dropdown }) => {
    const [observedState] = target.value;
    const action = controller.form.action;
    if (!action) return;
    if (observedState === "Not recorded") {
      delete action.observedState;
      return;
    }
    if (targetStateOptions.includes(observedState as RobotTargetState)) {
      action.observedState = observedState as RobotTargetState;
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
          <div class="task-panel__header-actions">
            <bim-button style="flex: 0" label="Export IFC" icon=${appIcons.EXPORT} ?disabled=${!service.canExportActiveIfc} @click=${onExportIfc}></bim-button>
            <bim-button style="flex: 0" label="Add task" icon=${appIcons.ADD} ?disabled=${!service.canCreateTask} @click=${onStartCreate}></bim-button>
          </div>
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
                <bim-dropdown label="Robot action" @change=${setActionMode}>
                  <bim-option label="No action" ?checked=${!controller.form.action}></bim-option>
                  <bim-option label="Set state" ?checked=${Boolean(controller.form.action)}></bim-option>
                </bim-dropdown>
                ${controller.form.action
                  ? BUI.html`
                      <div class="task-form__choices">
                        <bim-dropdown label="Desired state" @change=${setTargetState}>
                          ${targetStateOptions.map(
                            (targetState) => BUI.html`<bim-option label=${targetState} ?checked=${controller.form.action?.targetState === targetState}></bim-option>`,
                          )}
                        </bim-dropdown>
                        <bim-dropdown label="Execution result" @change=${setExecutionStatus}>
                          ${executionStatusOptions.map(
                            (executionStatus) => BUI.html`<bim-option label=${executionStatus} ?checked=${controller.form.action?.executionStatus === executionStatus}></bim-option>`,
                          )}
                        </bim-dropdown>
                        <bim-dropdown label="Observed state" @change=${setObservedState}>
                          <bim-option label="Not recorded" ?checked=${!controller.form.action?.observedState}></bim-option>
                          ${targetStateOptions.map(
                            (targetState) => BUI.html`<bim-option label=${targetState} ?checked=${controller.form.action?.observedState === targetState}></bim-option>`,
                          )}
                        </bim-dropdown>
                      </div>
                      <bim-text-input vertical label="Executed at (ISO 8601)" .value=${controller.form.action.executedAt ?? ""} @input=${(event: Event) => {
                        const action = controller.form.action;
                        if (!action) return;
                        const value = (event.target as BUI.TextInput).value.trim();
                        if (value) action.executedAt = value;
                        else delete action.executedAt;
                      }}></bim-text-input>
                    `
                  : undefined}
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
                      ${task.action
                        ? BUI.html`<span>Action: ${readableValue(task.action.verb)} → ${task.action.targetState}</span>
                            <span>Execution: ${readableValue(task.action.executionStatus)}</span>`
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
