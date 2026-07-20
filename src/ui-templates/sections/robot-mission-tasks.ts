import * as BUI from "@thatopen/ui";
import {
  getTasksInExecutionOrder,
  ROBOT_ACTION_TYPES,
  validateMission,
} from "../../domain/robot-tasks";
import type {
  RobotActionType,
  RobotMission,
  RobotObjectReference,
  RobotTask,
  RobotTaskTime,
  RobotTaskValidationIssue,
} from "../../domain/robot-tasks";
import { RobotMissionService } from "../../application/robot-tasks";
import { appIcons } from "../../globals";
import type { ViewerObjectSelectionManager } from "../../viewer/robot-tasks";

/** Dependencies supplied by the composition root to the mission/task panel. */
export interface RobotMissionTasksPanelState {
  /** Application service that owns new-domain mission commands and persistence. */
  missionService: RobotMissionService;

  /** Viewer adapter that exposes only confirmed, stable IFC object references. */
  selectionManager: ViewerObjectSelectionManager;
}

/** Mutable presentation state local to the mission/task panel. */
interface RobotMissionTasksViewState extends RobotMissionTasksPanelState {
  /** Mission currently displayed for authoring. */
  activeMissionId?: string;

  /** Informational or error text produced by the most recent UI command. */
  notice?: string;

  /** Requests a render after a UI command changes persisted or local state. */
  refresh: (
    update?: Partial<
      Pick<RobotMissionTasksViewState, "activeMissionId" | "notice">
    >,
  ) => void;
}

/** Returns a browser-generated identifier with a readable domain prefix. */
const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Converts a native form field to trimmed text or undefined when it is empty. */
const optionalText = (form: FormData, field: string) => {
  const value = form.get(field);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

/** Formats an object reference without treating local Fragments IDs as durable IFC IDs. */
const referenceLabel = (reference?: RobotObjectReference) => {
  if (!reference) return "No object assigned";
  const identity = reference.globalId
    ? `GlobalId ${reference.globalId}`
    : `${reference.modelId} / expressID ${reference.expressId}`;
  return [reference.name, reference.ifcClass, identity]
    .filter(Boolean)
    .join(" / ");
};

/** Groups validation findings by the task they describe for concise task cards. */
const taskIssues = (
  issues: readonly RobotTaskValidationIssue[],
  taskId: string,
) => issues.filter((issue) => issue.taskId === taskId);

/**
 * Resolves the named incoming and outgoing sequence relations for one task.
 *
 * The display uses the stored dependency type instead of assuming a particular
 * relation. The move controls create FINISH_START edges, while this helper also
 * keeps any future valid sequence type understandable in the panel.
 *
 * @param mission Mission containing the tasks and sequence relations to inspect.
 * @param task Task for which predecessor and successor labels are requested.
 * @returns Human-readable incoming and outgoing dependency labels.
 */
const taskSequenceLabels = (mission: RobotMission, task: RobotTask) => {
  const taskNames = new Map(
    mission.tasks.map((candidate) => [candidate.id, candidate.name]),
  );
  const label = (taskId: string, sequenceType: string) =>
    `${taskNames.get(taskId) ?? taskId} (${sequenceType})`;
  return {
    predecessors: mission.sequences
      .filter((sequence) => sequence.successorTaskId === task.id)
      .map((sequence) =>
        label(sequence.predecessorTaskId, sequence.sequenceType),
      ),
    successors: mission.sequences
      .filter((sequence) => sequence.predecessorTaskId === task.id)
      .map((sequence) =>
        label(sequence.successorTaskId, sequence.sequenceType),
      ),
  };
};

/** Renders a compact list of blocking errors and non-blocking warnings. */
const validationList = (issues: readonly RobotTaskValidationIssue[]) => {
  if (!issues.length) {
    return BUI.html`<p class="robot-task-validation valid">Mission is valid and ready for later execution or IFC mapping.</p>`;
  }
  return BUI.html`
    <ul class="robot-task-validation">
      ${issues.map(
        (issue) => BUI.html`
          <li class=${issue.severity}>
            <strong>${issue.severity === "error" ? "Error" : "Warning"}:</strong>
            ${issue.message}
          </li>
        `,
      )}
    </ul>
  `;
};

/** Creates a replacement RobotTaskTime value from one task-edit form. */
const readTaskTime = (form: FormData): RobotTaskTime | undefined => {
  const completionText = optionalText(form, "completion");
  const completion =
    completionText === undefined ? undefined : Number(completionText);
  const time: RobotTaskTime = {
    scheduleStart: optionalText(form, "scheduleStart"),
    scheduleFinish: optionalText(form, "scheduleFinish"),
    scheduleDuration: optionalText(form, "scheduleDuration"),
    completion: Number.isNaN(completion) ? undefined : completion,
  };
  return Object.values(time).some((value) => value !== undefined)
    ? time
    : undefined;
};

/** Renders the task editor and assignment controls for one executable task. */
const taskTemplate = (
  task: RobotTask,
  executionPosition: number,
  predecessors: readonly string[],
  successors: readonly string[],
  issues: readonly RobotTaskValidationIssue[],
  selectedReference: RobotObjectReference | undefined,
  onSave: (event: SubmitEvent) => void,
  onDelete: () => void,
  onAssign: (role: "target" | "affected" | "start" | "destination") => void,
  onMove: (direction: "up" | "down") => void,
  canMoveUp: boolean,
  canMoveDown: boolean,
) => BUI.html`
  <details class="robot-task-card" open>
    <summary>
      <span>${executionPosition}. ${task.name}</span>
      <span class="robot-task-action">${task.actionType}</span>
    </summary>
    <div class="robot-task-sequence">
      <span><strong>Predecessor:</strong> ${predecessors.length ? predecessors.join(" | ") : "None"}</span>
      <span><strong>Successor:</strong> ${successors.length ? successors.join(" | ") : "None"}</span>
      <div class="robot-task-sequence-actions">
        <button type="button" ?disabled=${!canMoveUp} @click=${() => onMove("up")}>Move up</button>
        <button type="button" ?disabled=${!canMoveDown} @click=${() => onMove("down")}>Move down</button>
      </div>
    </div>
    <form @submit=${onSave} class="robot-task-form">
      <div class="robot-task-fields two-columns">
        <label>Task name<input name="name" required value=${task.name} /></label>
        <label>Action
          <select name="actionType">
            ${ROBOT_ACTION_TYPES.map(
              (actionType) =>
                BUI.html`<option value=${actionType} ?selected=${actionType === task.actionType}>${actionType}</option>`,
            )}
          </select>
        </label>
      </div>

      <p class="robot-task-selection">Confirmed viewer selection: ${referenceLabel(selectedReference)}</p>
      <div class="robot-task-assignment-actions">
        <button type="button" ?disabled=${!selectedReference} @click=${() => onAssign("target")}>Add target</button>
        <button type="button" ?disabled=${!selectedReference} @click=${() => onAssign("affected")}>Add affected</button>
        <button type="button" ?disabled=${!selectedReference} @click=${() => onAssign("start")}>Set MOVE start</button>
        <button type="button" ?disabled=${!selectedReference} @click=${() => onAssign("destination")}>Set MOVE target</button>
      </div>
      <div class="robot-task-reference-list">
        <span><strong>Targets:</strong> ${task.targetObjects.length ? task.targetObjects.map(referenceLabel).join(" | ") : "None"}</span>
        <span><strong>Affected:</strong> ${task.affectedObjects.length ? task.affectedObjects.map(referenceLabel).join(" | ") : "None"}</span>
        <span><strong>MOVE start:</strong> ${referenceLabel(task.startReference)}</span>
        <span><strong>MOVE target:</strong> ${referenceLabel(task.targetReference)}</span>
      </div>

      <details class="robot-task-timing">
        <summary>Optional task timing</summary>
        <div class="robot-task-fields two-columns">
          <label>Schedule start<input name="scheduleStart" type="datetime-local" value=${task.time?.scheduleStart ?? ""} /></label>
          <label>Schedule finish<input name="scheduleFinish" type="datetime-local" value=${task.time?.scheduleFinish ?? ""} /></label>
          <label>Schedule duration<input name="scheduleDuration" placeholder="PT10M" value=${task.time?.scheduleDuration ?? ""} /></label>
          <label>Completion (0-1)<input name="completion" type="number" min="0" max="1" step="0.01" value=${task.time?.completion ?? ""} /></label>
        </div>
      </details>

      ${validationList(issues)}
      <div class="robot-task-form-actions">
        <button type="submit">Save task details</button>
        <button type="button" class="danger" @click=${onDelete}>Delete task</button>
      </div>
    </form>
  </details>
`;

/**
 * Interactive authoring UI for the new RobotMission aggregate.
 *
 * The component uses only application commands and confirmed viewer references;
 * it never constructs legacy object annotations or performs IFC serialization.
 */
const robotMissionTasksContentTemplate: BUI.StatefullComponent<
  RobotMissionTasksViewState
> = (state) => {
  const { missionService, selectionManager } = state;
  const missions = missionService.listMissions();
  const activeMission =
    missions.find((mission) => mission.id === state.activeMissionId) ??
    missions[0];
  const activeMissionId = activeMission?.id;
  const validationIssues = activeMission ? validateMission(activeMission) : [];
  const selectedReference = selectionManager.getSnapshot().confirmedReference;
  const orderedTasks = activeMission
    ? getTasksInExecutionOrder(activeMission.tasks, activeMission.sequences)
    : [];

  const updateView = (
    update: Partial<
      Pick<RobotMissionTasksViewState, "activeMissionId" | "notice">
    > = {},
  ) => {
    state.refresh({
      activeMissionId: update.activeMissionId ?? activeMissionId,
      notice: update.notice,
    });
  };

  const runCommand = (command: () => void, successMessage: string) => {
    try {
      command();
      return successMessage;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const onCreateMission = (event: SubmitEvent) => {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const name = optionalText(form, "missionName");
    if (!name) return;
    const id = createId("mission");
    const notice = runCommand(
      () =>
        missionService.createMission({
          id,
          name,
          description: optionalText(form, "missionDescription"),
        }),
      "Mission draft stored.",
    );
    updateView({ activeMissionId: id, notice });
  };

  const onAddTask = (event: SubmitEvent) => {
    event.preventDefault();
    if (!activeMission) return;
    const form = new FormData(event.target as HTMLFormElement);
    const name = optionalText(form, "taskName");
    const actionType = form.get("newTaskAction") as RobotActionType;
    if (!name) return;
    const taskId = createId("task");
    const notice = runCommand(() => {
      missionService.addTask(activeMission.id, {
        id: taskId,
        name,
        actionType,
      });
      missionService.setTaskExecutionOrder(activeMission.id, [
        ...orderedTasks.map((task) => task.id),
        taskId,
      ]);
    }, "Task draft stored. Assign its IFC references and resolve validation errors.");
    updateView({ notice });
  };

  const selectMission = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    updateView({ activeMissionId: select.value, notice: undefined });
  };

  const onSaveTask = (task: RobotTask) => (event: SubmitEvent) => {
    event.preventDefault();
    if (!activeMission) return;
    const form = new FormData(event.target as HTMLFormElement);
    const name = optionalText(form, "name");
    const actionType = form.get("actionType") as RobotActionType;
    if (!name) return;
    const time = readTaskTime(form);
    const notice = runCommand(() => {
      missionService.updateTask(activeMission.id, task.id, {
        name,
        actionType,
        time,
      });
    }, "Task details stored. Review validation before treating the mission as complete.");
    updateView({ notice });
  };

  const onDeleteTask = (task: RobotTask) => () => {
    if (!activeMission) return;
    const notice = runCommand(() => {
      missionService.deleteTask(activeMission.id, task.id);
      missionService.setTaskExecutionOrder(
        activeMission.id,
        orderedTasks
          .filter((candidate) => candidate.id !== task.id)
          .map((candidate) => candidate.id),
      );
    }, "Task deleted and the remaining FINISH_START sequence was updated.");
    updateView({ notice });
  };

  /** Moves one task one position within the persisted linear mission plan. */
  const onMoveTask = (task: RobotTask) => (direction: "up" | "down") => {
    if (!activeMission) return;
    const currentIndex = orderedTasks.findIndex(
      (candidate) => candidate.id === task.id,
    );
    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedTasks.length
    ) {
      return;
    }
    const orderedTaskIds = orderedTasks.map((candidate) => candidate.id);
    [orderedTaskIds[currentIndex], orderedTaskIds[targetIndex]] = [
      orderedTaskIds[targetIndex],
      orderedTaskIds[currentIndex],
    ];
    const notice = runCommand(
      () =>
        missionService.setTaskExecutionOrder(activeMission.id, orderedTaskIds),
      "Task order stored as FINISH_START sequence relations.",
    );
    updateView({ notice });
  };

  const onAssign =
    (task: RobotTask) =>
    (role: "target" | "affected" | "start" | "destination") => {
      if (!activeMission || !selectedReference) return;
      const notice = runCommand(() => {
        if (role === "target" || role === "affected") {
          missionService.assignSelectedObjectsToTask(
            activeMission.id,
            task.id,
            role,
            [selectedReference],
          );
          return;
        }
        missionService.updateTask(activeMission.id, task.id, {
          ...(role === "start"
            ? { startReference: selectedReference }
            : { targetReference: selectedReference }),
        });
      }, "Confirmed IFC object assigned to the task.");
      updateView({ notice });
    };

  return BUI.html`
    <div class="robot-mission-panel">
      <form class="robot-mission-create" @submit=${onCreateMission}>
        <label>Mission name<input name="missionName" required placeholder="e.g. Floor 1 delivery" /></label>
        <label>Description<input name="missionDescription" placeholder="Optional mission goal" /></label>
        <button type="submit">Create mission</button>
      </form>

      ${
        missions.length
          ? BUI.html`
              <label class="robot-mission-picker">Active mission
                <select @change=${selectMission}>
                  ${missions.map(
                    (mission) =>
                      BUI.html`<option value=${mission.id} ?selected=${mission.id === activeMissionId}>${mission.name}</option>`,
                  )}
                </select>
              </label>
            `
          : BUI.html`<p class="robot-task-empty">Create a mission to begin authoring executable robot tasks.</p>`
      }
      ${state.notice ? BUI.html`<p class="robot-task-notice">${state.notice}</p>` : null}

      ${
        activeMission
          ? BUI.html`
              <section class="robot-mission-editor">
                <h3>${activeMission.name}</h3>
                <p class="robot-task-draft-note">Draft changes are saved through the new mission repository. The validation list below must have no errors before this mission is ready for later execution or IFC mapping.</p>
                ${validationList(validationIssues)}
                <form class="robot-task-create" @submit=${onAddTask}>
                  <label>New task name<input name="taskName" required placeholder="e.g. Open main entrance" /></label>
                  <label>Action
                    <select name="newTaskAction">
                      ${ROBOT_ACTION_TYPES.map(
                        (actionType) =>
                          BUI.html`<option value=${actionType}>${actionType}</option>`,
                      )}
                    </select>
                  </label>
                  <button type="submit">Add executable task</button>
                </form>
                <div class="robot-task-list">
                  ${orderedTasks.map((task, index) => {
                    const sequenceLabels = taskSequenceLabels(
                      activeMission,
                      task,
                    );
                    return taskTemplate(
                      task,
                      index + 1,
                      sequenceLabels.predecessors,
                      sequenceLabels.successors,
                      taskIssues(validationIssues, task.id),
                      selectedReference,
                      onSaveTask(task),
                      onDeleteTask(task),
                      onAssign(task),
                      onMoveTask(task),
                      index > 0,
                      index < orderedTasks.length - 1,
                    );
                  })}
                </div>
              </section>
            `
          : null
      }
    </div>
  `;
};

/** Creates the panel and keeps its view synchronized with confirmed viewer selection. */
export const robotMissionTasksPanelTemplate: BUI.StatefullComponent<
  RobotMissionTasksPanelState
> = (state) => {
  const initialMission = state.missionService.listMissions()[0];
  let updateContent: (update: Partial<RobotMissionTasksViewState>) => void;
  const refresh = (
    update: Partial<
      Pick<RobotMissionTasksViewState, "activeMissionId" | "notice">
    > = {},
  ) => updateContent(update);
  const [content, contentUpdater] = BUI.Component.create<
    HTMLElement,
    RobotMissionTasksViewState
  >(robotMissionTasksContentTemplate, {
    ...state,
    activeMissionId: initialMission?.id,
    refresh,
  });
  updateContent = contentUpdater;

  state.selectionManager.subscribe(() => refresh());

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.TASK} label="Robot Missions">
      ${content}
    </bim-panel-section>
  `;
};
