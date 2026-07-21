import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import type { RobotMissionService } from "../../application/robot-tasks";
import type {
  IfcModelExportService,
  IfcSourceModelRegistry,
} from "../../ifc/model-export";
import type { DirectIfcModelProvenance } from "../../viewer/robot-tasks";

export interface ModelsPanelState {
  components: OBC.Components;
  modelProvenance: DirectIfcModelProvenance;
  ifcSourceRegistry: IfcSourceModelRegistry;
  ifcExportService: IfcModelExportService;
  missionService: RobotMissionService;
}

/** Mutable presentation state for the model export controls. */
interface IfcExportControlsState {
  /** Viewer component registry used to inspect loaded Fragments models. */
  components: OBC.Components;

  /** Registry identifying models backed by retained IFC source bytes. */
  ifcSourceRegistry: IfcSourceModelRegistry;

  /** Service producing structurally validated IFC STEP output. */
  ifcExportService: IfcModelExportService;

  /** Application service providing the current internal mission aggregates. */
  missionService: RobotMissionService;

  /** Runtime identifier of the model selected for export. */
  selectedModelId?: string;

  /** Result or rejection message from the most recent export attempt. */
  notice?: string;

  /** Requests a focused rerender of only the IFC export controls. */
  refresh: (
    update?: Partial<
      Pick<IfcExportControlsState, "selectedModelId" | "notice">
    >,
  ) => void;
}

/**
 * Starts a browser download for already validated IFC STEP bytes.
 *
 * @param fileName Safe download name derived from the source IFC file.
 * @param bytes Structurally validated IFC STEP payload.
 */
const downloadIfc = (fileName: string, bytes: Uint8Array) => {
  const blob = new Blob([bytes.slice().buffer], {
    type: "application/x-step",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Renders model selection and the safe IFC export command. */
const ifcExportControlsTemplate: BUI.StatefullComponent<
  IfcExportControlsState
> = (state) => {
  const fragments = state.components.get(OBC.FragmentsManager);
  const loadedModelIds = [...fragments.list.keys()];
  const sources = new Map(
    state.ifcSourceRegistry
      .list()
      .map((source) => [source.modelId, source] as const),
  );
  const exportableModelIds = loadedModelIds.filter((modelId) =>
    sources.has(modelId),
  );
  const selectedModelId = exportableModelIds.includes(
    state.selectedModelId ?? "",
  )
    ? state.selectedModelId
    : exportableModelIds[0];

  /** Stores the user's active export target without changing viewer selection. */
  const onSelectModel = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    state.refresh({ selectedModelId: select.value, notice: undefined });
  };

  /** Validates, rewrites, and downloads the selected source-backed IFC model. */
  const onExportIfc = async ({ target }: { target: BUI.Button }) => {
    if (!selectedModelId) return;
    const model = fragments.list.get(selectedModelId);
    const hasStructuralChanges = Boolean(
      model && (model.attrsChanges.size || model.relsChanges.size),
    );
    target.loading = true;
    try {
      const result = await state.ifcExportService.exportModel(selectedModelId, {
        hasStructuralChanges,
        missions: state.missionService.listMissions(),
      });
      downloadIfc(result.fileName, result.bytes);
      state.refresh({
        selectedModelId,
        notice: `${result.fileName} exported as structurally validated ${result.schema} with ${result.missionCount} robot mission${result.missionCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      state.refresh({
        selectedModelId,
        notice: error instanceof Error ? error.message : String(error),
      });
    } finally {
      target.loading = false;
    }
  };

  return BUI.html`
    <div class="ifc-export-controls">
      <label>IFC export model
        <select @change=${onSelectModel} ?disabled=${!exportableModelIds.length}>
          ${
            exportableModelIds.length
              ? exportableModelIds.map((modelId) => {
                  const source = sources.get(modelId);
                  return BUI.html`<option value=${modelId} ?selected=${modelId === selectedModelId}>${source?.fileName ?? modelId}</option>`;
                })
              : BUI.html`<option>No source-backed IFC model</option>`
          }
        </select>
      </label>
      <bim-button
        label="Export IFC"
        icon=${appIcons.EXPORT}
        ?disabled=${!selectedModelId}
        @click=${onExportIfc}
      ></bim-button>
      <p class="ifc-export-description">
        Direct IFC imports are exported with all current robot missions and independently parsed again before download. Pure .frag models and structural Fragments edits are not exported. Invalid missions or references outside the selected IFC stop the export.
      </p>
      ${state.notice ? BUI.html`<p class="ifc-export-notice">${state.notice}</p>` : null}
    </div>
  `;
};

export const modelsPanelTemplate: BUI.StatefullComponent<ModelsPanelState> = (
  state,
) => {
  const {
    components,
    modelProvenance,
    ifcSourceRegistry,
    ifcExportService,
    missionService,
  } = state;

  const ifcLoader = components.get(OBC.IfcLoader);
  const fragments = components.get(OBC.FragmentsManager);

  const [modelsList] = CUI.tables.modelsList({
    components,
    actions: { download: false },
  });

  let updateExportControls: (update: Partial<IfcExportControlsState>) => void;
  const refreshExportControls = (
    update: Partial<
      Pick<IfcExportControlsState, "selectedModelId" | "notice">
    > = {},
  ) => updateExportControls(update);
  const [ifcExportControls, exportControlsUpdater] = BUI.Component.create<
    HTMLElement,
    IfcExportControlsState
  >(ifcExportControlsTemplate, {
    components,
    ifcSourceRegistry,
    ifcExportService,
    missionService,
    refresh: refreshExportControls,
  });
  updateExportControls = exportControlsUpdater;

  fragments.list.onItemDeleted.add(() => refreshExportControls());

  const getModelId = async (fileName: string, bytes: Uint8Array) => {
    const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
    const hash = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const baseName = fileName.replace(/\.(ifc|frag)$/i, "");
    return `${baseName}-${hash.slice(0, 8)}`;
  };

  const onAddIfcModel = async ({ target }: { target: BUI.Button }) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.accept = ".ifc";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      target.loading = true;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const modelId = await getModelId(file.name, bytes);
        modelProvenance.registerDirectIfcModel(modelId);
        try {
          const model = await ifcLoader.load(bytes, true, modelId);
          if (model.modelId !== modelId) {
            modelProvenance.unregisterModel(modelId);
          }
          modelProvenance.registerDirectIfcModel(model.modelId);
          ifcSourceRegistry.register({
            modelId: model.modelId,
            fileName: file.name,
            bytes,
          });
          refreshExportControls({
            selectedModelId: model.modelId,
            notice: "IFC source retained for structurally validated export.",
          });
        } catch (error) {
          modelProvenance.unregisterModel(modelId);
          ifcSourceRegistry.unregister(modelId);
          throw error;
        }
        BUI.ContextMenu.removeMenus();
      } finally {
        target.loading = false;
      }
    });

    input.addEventListener("cancel", () => (target.loading = false));

    input.click();
  };

  const onAddFragmentsModel = async ({ target }: { target: BUI.Button }) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.accept = ".frag";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      target.loading = true;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const modelId = await getModelId(file.name, bytes);
        const model = await fragments.core.load(bytes, {
          modelId,
        });
        refreshExportControls({
          selectedModelId: model.modelId,
          notice:
            "Fragments loaded without an IFC source. Trustworthy IFC export is unavailable for this model.",
        });
        BUI.ContextMenu.removeMenus();
      } finally {
        target.loading = false;
      }
    });

    input.addEventListener("cancel", () => (target.loading = false));

    input.click();
  };

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    modelsList.queryString = input.value;
  };

  return BUI.html`
    <bim-panel-section fixed icon=${appIcons.MODEL} label="Models">
      <div style="display: flex; gap: 0.5rem;">
        <bim-text-input @input=${onSearch} vertical placeholder="Search..." debounce="200"></bim-text-input>
        <bim-button style="flex: 0;" icon=${appIcons.ADD}>
          <bim-context-menu style="gap: 0.25rem;">
            <bim-button label="IFC" @click=${onAddIfcModel}></bim-button>
            <bim-button label="Fragments" @click=${onAddFragmentsModel}></bim-button>
          </bim-context-menu> 
        </bim-button>
      </div>
      ${modelsList}
      ${ifcExportControls}
    </bim-panel-section> 
  `;
};
