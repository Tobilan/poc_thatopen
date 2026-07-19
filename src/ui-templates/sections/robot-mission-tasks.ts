import * as BUI from "@thatopen/ui";
import { ROBOT_ACTION_TYPES, validateMission } from "../../domain/robot-tasks";
import type {
  RobotActionProperties,
  RobotActionType,
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

/** Splits a multiline text field into the non-empty task conditions it contains. */
const optionalLines = (form: FormData, field: string) => {
  const value = optionalText(form, field);
  if (!value) return undefined;
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
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

/** Creates a replacement RobotActionProperties value from one task-edit form. */
const readActionProperties = (
  form: FormData,
): RobotActionProperties | undefined => {
  const properties: RobotActionProperties = {
    targetState: optionalText(form, "targetState"),
    targetObjectRole: optionalText(form, "targetObjectRole"),
    affectedObjectRole: optionalText(form, "affectedObjectRole"),
    requiredCapability: optionalText(form, "requiredCapability"),
    preconditions: optionalLines(form, "preconditions"),
    postconditions: optionalLines(form, "postconditions"),
    successCondition: optionalText(form, "successCondition"),
  };
  return Object.values(properties).some((value) => value !== undefined)
    ? properties
    : undefined;
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
  issues: readonly RobotTaskValidationIssue[],
  selectedReference: RobotObjectReference | undefined,
  onSave: (event: SubmitEvent) => void,
  onDelete: () => void,
  onAssign: (role: "target" | "affected" | "start" | "destination") => void,
) => BUI.html`
  <details class="robot-task-card" open>
    <summary>
      <span>${task.name}</span>
      <span class="robot-task-action">${task.actionType}</span>
    </summary>
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

      <fieldset>
        <legend>Task-level RobotAction properties</legend>
        <div class="robot-task-fields two-columns">
          <label>Target state<input name="targetState" value=${task.properties?.targetState ?? ""} /></label>
          <label>Target role<input name="targetObjectRole" value=${task.properties?.targetObjectRole ?? ""} /></label>
          <label>Affected role<input name="affectedObjectRole" value=${task.properties?.affectedObjectRole ?? ""} /></label>
          <label>Required capability<input name="requiredCapability" value=${task.properties?.requiredCapability ?? ""} /></label>
        </div>
        <label>Preconditions (one per line)<textarea name="preconditions">${task.properties?.preconditions?.join("\n") ?? ""}</textarea></label>
        <label>Postconditions (one per line)<textarea name="postconditions">${task.properties?.postconditions?.join("\n") ?? ""}</textarea></label>
        <label>Success condition<input name="successCondition" value=${task.properties?.successCondition ?? ""} /></label>
      </fieldset>

      <fieldset>
        <legend>Optional task timing</legend>
        <div class="robot-task-fields two-columns">
          <label>Schedule start<input name="scheduleStart" type="datetime-local" value=${task.time?.scheduleStart ?? ""} /></label>
          <label>Schedule finish<input name="scheduleFinish" type="datetime-local" value=${task.time?.scheduleFinish ?? ""} /></label>
          <label>Schedule duration<input name="scheduleDuration" placeholder="PT10M" value=${task.time?.scheduleDuration ?? ""} /></label>
          <label>Completion (0-1)<input name="completion" type="number" min="0" max="1" step="0.01" value=${task.time?.completion ?? ""} /></label>
        </div>
      </fieldset>

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
    const notice = runCommand(
      () =>
        missionService.addTask(activeMission.id, {
          id: createId("task"),
          name,
          actionType,
        }),
      "Task draft stored. Assign its IFC references and resolve validation errors.",
    );
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
    const properties = readActionProperties(form);
    const time = readTaskTime(form);
    const notice = runCommand(() => {
      missionService.updateTask(activeMission.id, task.id, {
        name,
        actionType,
        properties,
        time,
      });
    }, "Task details stored. Review validation before treating the mission as complete.");
    updateView({ notice });
  };

  const onDeleteTask = (task: RobotTask) => () => {
    if (!activeMission) return;
    const notice = runCommand(
      () => missionService.deleteTask(activeMission.id, task.id),
      "Task deleted.",
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
                  ${activeMission.tasks.map((task) =>
                    taskTemplate(
                      task,
                      taskIssues(validationIssues, task.id),
                      selectedReference,
                      onSaveTask(task),
                      onDeleteTask(task),
                      onAssign(task),
                    ),
                  )}
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
