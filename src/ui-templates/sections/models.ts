import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import * as OBC from "@thatopen/components";
import { appIcons } from "../../globals";
import type { IfcSourceModelRegistry } from "../../ifc/model-export";
import {
  importLoadedModelMissions,
  type IfcMissionRoundtripCoordinator,
  type IfcMissionRoundtripError,
} from "../../ifc/model-roundtrip";
import type { DirectIfcModelProvenance } from "../../viewer/robot-tasks";
import type { RobotMissionPanelRefresh } from "./robotMissionPanelRefresh";

export interface ModelsPanelState {
  components: OBC.Components;
  modelProvenance: DirectIfcModelProvenance;
  ifcSourceRegistry: IfcSourceModelRegistry;
  ifcMissionRoundtrip: IfcMissionRoundtripCoordinator;
  missionPanelRefresh: RobotMissionPanelRefresh;
}

interface IfcRoundtripNotice {
  severity: "info" | "warning" | "error";
  summary: string;
  details?: readonly string[];
}

/** Mutable presentation state for the model export controls. */
interface IfcExportControlsState {
  /** Viewer component registry used to inspect loaded Fragments models. */
  components: OBC.Components;

  /** Registry identifying models backed by retained IFC source bytes. */
  ifcSourceRegistry: IfcSourceModelRegistry;

  /** Source-scoped importer/exporter orchestration. */
  ifcMissionRoundtrip: IfcMissionRoundtripCoordinator;

  /** Runtime identifier of the model selected for export. */
  selectedModelId?: string;

  /** Result or rejection message from the most recent export attempt. */
  notice?: IfcRoundtripNotice;

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

/** Presents typed orchestration failures without losing structured details. */
const errorNotice = (error: unknown): IfcRoundtripNotice => {
  const typed = error as Partial<IfcMissionRoundtripError> & {
    issues?: ReadonlyArray<{ code: string; message: string }>;
  };
  const details = Array.isArray(typed.details)
    ? typed.details
    : typed.issues?.map((issue) => `${issue.code}: ${issue.message}`);
  return {
    severity: "error",
    summary: error instanceof Error ? error.message : String(error),
    details,
  };
};

/** Renders a concise status with optional expandable diagnostics. */
const noticeTemplate = (notice?: IfcRoundtripNotice) =>
  notice
    ? BUI.html`
        <div class="ifc-export-notice ${notice.severity}">
          <p>${notice.summary}</p>
          ${
            notice.details?.length
              ? BUI.html`
                  <details>
                    <summary>${notice.details.length} diagnostic${notice.details.length === 1 ? "" : "s"}</summary>
                    <ul>${notice.details.map((detail) => BUI.html`<li>${detail}</li>`)}</ul>
                  </details>
                `
              : null
          }
        </div>
      `
    : null;

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
      const result = await state.ifcMissionRoundtrip.exportModel(
        selectedModelId,
        hasStructuralChanges,
      );
      downloadIfc(result.fileName, result.bytes);
      state.refresh({
        selectedModelId,
        notice: {
          severity: result.warningCount ? "warning" : "info",
          summary: `${result.fileName}: ${result.addedCount} added, ${result.updatedCount} updated, ${result.removedCount} removed; ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}; schema ${result.schema}.`,
        },
      });
    } catch (error) {
      state.refresh({
        selectedModelId,
        notice: errorNotice(error),
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
        The selected direct IFC is exported only with missions associated with that source (plus unassigned missions whose references belong to it), then independently imported again before download. Pure .frag models, malformed annotations, cross-model references, and structural Fragments edits stop export.
      </p>
      ${noticeTemplate(state.notice)}
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
    ifcMissionRoundtrip,
    missionPanelRefresh,
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
    ifcMissionRoundtrip,
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
        let loadedModelId = modelId;
        modelProvenance.registerDirectIfcModel(modelId);
        try {
          const model = await ifcLoader.load(bytes, true, modelId);
          loadedModelId = model.modelId;
          if (model.modelId !== modelId) {
            modelProvenance.unregisterModel(modelId);
          }
          modelProvenance.registerDirectIfcModel(model.modelId);
          ifcSourceRegistry.register({
            modelId: model.modelId,
            fileName: file.name,
            bytes,
          });
        } catch (error) {
          modelProvenance.unregisterModel(modelId);
          ifcSourceRegistry.unregister(modelId);
          throw error;
        }
        try {
          const imported = await importLoadedModelMissions(
            ifcMissionRoundtrip,
            "direct-ifc",
            loadedModelId,
            file.name,
            bytes,
          );
          if (!imported) {
            throw new Error(
              "Direct IFC mission import was unexpectedly skipped.",
            );
          }
          const issueDetails = imported.issues.map(
            (issue) => `${issue.code}: ${issue.message}`,
          );
          let severity: IfcRoundtripNotice["severity"] = "info";
          if (imported.warningCount) severity = "warning";
          if (imported.errorCount) severity = "error";
          refreshExportControls({
            selectedModelId: loadedModelId,
            notice: {
              severity,
              summary: imported.errorCount
                ? `${file.name} loaded with partial mission success: ${imported.importedCount} imported, ${imported.replacedCount} replaced, ${imported.warningCount} warnings, ${imported.errorCount} malformed mission errors. Mission export is disabled for this source.`
                : `${file.name} loaded: ${imported.importedCount} missions imported, ${imported.replacedCount} replaced, ${imported.warningCount} warnings.`,
              details: issueDetails.length ? issueDetails : undefined,
            },
          });
          missionPanelRefresh.emit({
            activeMissionId: imported.activeMissionId,
          });
        } catch (error) {
          refreshExportControls({
            selectedModelId: loadedModelId,
            notice: errorNotice(error),
          });
        }
        BUI.ContextMenu.removeMenus();
      } catch (error) {
        refreshExportControls({ notice: errorNotice(error) });
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
        await importLoadedModelMissions(
          ifcMissionRoundtrip,
          "fragments",
          model.modelId,
          file.name,
          bytes,
        );
        refreshExportControls({
          selectedModelId: model.modelId,
          notice: {
            severity: "info",
            summary:
              "Fragments loaded without an IFC source. Mission import and trustworthy IFC export are unavailable for this model.",
          },
        });
        BUI.ContextMenu.removeMenus();
      } catch (error) {
        refreshExportControls({ notice: errorNotice(error) });
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
