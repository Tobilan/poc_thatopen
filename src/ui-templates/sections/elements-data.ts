import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { appIcons } from "../../globals";
import type {
  ViewerObjectSelectionCandidate,
  ViewerObjectSelectionManager,
  ViewerObjectSelectionSnapshot,
} from "../../viewer/robot-tasks";

export interface ElementsDataPanelState {
  components: OBC.Components;
  selectionManager: ViewerObjectSelectionManager;
}

interface SelectionChooserState {
  manager: ViewerObjectSelectionManager;
  snapshot: ViewerObjectSelectionSnapshot;
}

const IFC_SPACE = "IFCSPACE";
const IFC_OPENINGS = ["IFCOPENINGELEMENT", "IFCOPENINGSTANDARDCASE"];

const candidateTitle = (candidate: ViewerObjectSelectionCandidate) =>
  candidate.name ||
  candidate.ifcClass ||
  `Object ${candidate.modelId}:${candidate.localId}`;

const optionalErrorMessage = (error: unknown) => {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
};

const candidateMetadata = (candidate: ViewerObjectSelectionCandidate) => {
  const values = [
    candidate.ifcClass,
    candidate.globalId ? `GlobalId ${candidate.globalId}` : undefined,
    candidate.expressId === undefined
      ? undefined
      : `expressID ${candidate.expressId}`,
    `distance ${candidate.distance.toFixed(3)}`,
  ];
  return values.filter(Boolean).join(" / ");
};

const selectionChooserTemplate: BUI.StatefullComponent<
  SelectionChooserState
> = ({ manager, snapshot }) => {
  const activeCandidate =
    snapshot.activeIndex === null
      ? undefined
      : snapshot.candidates[snapshot.activeIndex];
  const isChoosing = snapshot.status === "choosing";
  const hasConfirmedSelection = Boolean(snapshot.confirmedCandidate);

  const setExcluded = (ifcClasses: readonly string[], excluded: boolean) => {
    const excludedClasses = new Set(snapshot.filters.excludeIfcClasses);
    for (const ifcClass of ifcClasses) {
      if (excluded) excludedClasses.add(ifcClass);
      else excludedClasses.delete(ifcClass);
    }
    manager.setFilters({
      ...snapshot.filters,
      excludeIfcClasses: [...excludedClasses],
    });
  };

  const onKeyboard = (event: KeyboardEvent) => {
    if (!isChoosing) return;
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      if (activeCandidate?.reference) manager.confirmActiveCandidate();
    } else if (event.code === "Escape") {
      event.preventDefault();
      manager.cancelCandidateChoice();
    } else if (event.code === "ArrowDown") {
      event.preventDefault();
      manager.cycleCandidate("next");
    } else if (event.code === "ArrowUp") {
      event.preventDefault();
      manager.cycleCandidate("previous");
    }
  };

  const candidates = isChoosing
    ? snapshot.candidates.map((candidate, index) => {
        const error = optionalErrorMessage(candidate.confirmationError);
        return BUI.html`
          <button
            class="selection-candidate ${
              index === snapshot.activeIndex ? "active" : ""
            }"
            type="button"
            aria-current=${index === snapshot.activeIndex ? "true" : "false"}
            @click=${() => manager.setActiveCandidate(index)}
          >
            <span class="selection-candidate-title">${candidateTitle(
              candidate,
            )}</span>
            <span class="selection-candidate-metadata">${candidateMetadata(
              candidate,
            )}</span>
            ${
              error
                ? BUI.html`<span class="selection-candidate-error">${error}</span>`
                : null
            }
          </button>
        `;
      })
    : null;

  const statusMessage = (() => {
    if (!snapshot.enabled)
      return "Selection paused while another tool is active.";
    if (snapshot.status === "loading") return "Finding IFC objects...";
    if (snapshot.status === "error") {
      return optionalErrorMessage(snapshot.error) ?? "Selection failed.";
    }
    if (isChoosing) {
      return `${snapshot.candidates.length} objects under the cursor`;
    }
    if (snapshot.confirmedCandidate) {
      return `Selected: ${candidateTitle(snapshot.confirmedCandidate)}`;
    }
    return "Click an IFC object to select it.";
  })();

  let actions: BUI.TemplateResult | null = null;
  if (isChoosing) {
    actions = BUI.html`
      <div class="selection-chooser-actions">
        <bim-button
          label="Previous"
          @click=${() => manager.cycleCandidate("previous")}
        ></bim-button>
        <bim-button
          label="Next"
          @click=${() => manager.cycleCandidate("next")}
        ></bim-button>
        <bim-button
          label="Confirm"
          ?disabled=${!activeCandidate?.reference}
          @click=${() => manager.confirmActiveCandidate()}
        ></bim-button>
        <bim-button
          label="Cancel"
          @click=${() => manager.cancelCandidateChoice()}
        ></bim-button>
      </div>
    `;
  } else if (hasConfirmedSelection) {
    actions = BUI.html`
      <div class="selection-chooser-actions">
        <bim-button
          label="Clear selection"
          @click=${() => manager.clearSelection()}
        ></bim-button>
      </div>
    `;
  }

  return BUI.html`
    <div
      class="selection-candidate-chooser"
      tabindex="0"
      @keydown=${onKeyboard}
      aria-label="IFC object selection candidates"
    >
      <div class="selection-chooser-status">${statusMessage}</div>
      <div class="selection-filter-row">
        <bim-checkbox
          label="Visible only"
          ?checked=${snapshot.filters.visibleOnly}
          @change=${({ target }: { target: BUI.Checkbox }) =>
            manager.setFilters({
              ...snapshot.filters,
              visibleOnly: target.checked,
            })}
        ></bim-checkbox>
        <bim-checkbox
          label="Exclude spaces"
          ?checked=${snapshot.filters.excludeIfcClasses.includes(IFC_SPACE)}
          @change=${({ target }: { target: BUI.Checkbox }) =>
            setExcluded([IFC_SPACE], target.checked)}
        ></bim-checkbox>
        <bim-checkbox
          label="Exclude openings"
          ?checked=${IFC_OPENINGS.every((ifcClass) =>
            snapshot.filters.excludeIfcClasses.includes(ifcClass),
          )}
          @change=${({ target }: { target: BUI.Checkbox }) =>
            setExcluded(IFC_OPENINGS, target.checked)}
        ></bim-checkbox>
      </div>
      ${
        snapshot.truncated
          ? BUI.html`<div class="selection-candidate-warning">Showing the nearest ${snapshot.candidates.length} candidates.</div>`
          : null
      }
      ${
        candidates
          ? BUI.html`<div class="selection-candidate-list">${candidates}</div>`
          : null
      }
      ${actions}
    </div>
  `;
};

export const elementsDataPanelTemplate: BUI.StatefullComponent<
  ElementsDataPanelState
> = (state) => {
  const { components, selectionManager } = state;

  // const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(OBF.Highlighter);

  const [propsTable, updatePropsTable] = CUI.tables.itemsData({
    components,
    modelIdMap: {},
  });

  propsTable.preserveStructureOnFilter = true;

  const [selectionChooser, updateSelectionChooser] = BUI.Component.create<
    HTMLElement,
    SelectionChooserState
  >(selectionChooserTemplate, {
    manager: selectionManager,
    snapshot: selectionManager.getSnapshot(),
  });
  selectionManager.subscribe((snapshot) => {
    updateSelectionChooser({ snapshot });
  });
  // fragments.onFragmentsDisposed.add(() => updatePropsTable());

  highlighter.events.select.onHighlight.add((modelIdMap) => {
    // const panel = document.getElementById("data")!;
    // panel.style.removeProperty("display");
    updatePropsTable({ modelIdMap });
  });

  highlighter.events.select.onClear.add(() => {
    // const panel = document.getElementById("data")!;
    // panel.style.display = "none";
    updatePropsTable({ modelIdMap: {} });
  });

  const search = (e: Event) => {
    const input = e.target as BUI.TextInput;
    propsTable.queryString = input.value;
  };

  const toggleExpanded = () => {
    propsTable.expanded = !propsTable.expanded;
  };

  const sectionId = BUI.Manager.newRandomId();

  return BUI.html`
    <bim-panel-section fixed id=${sectionId} icon=${appIcons.TASK} label="Selection Data">
      ${selectionChooser}
      <div style="display: flex; gap: 0.375rem;">
        <bim-text-input @input=${search} vertical placeholder="Search..." debounce="200"></bim-text-input>
        <bim-button style="flex: 0;" @click=${toggleExpanded} icon=${appIcons.EXPAND}></bim-button>
        <bim-button style="flex: 0;" @click=${() => propsTable.downloadData("ElementData", "tsv")} icon=${appIcons.EXPORT} tooltip-title="Export Data" tooltip-text="Export the shown properties to TSV."></bim-button>
      </div>
      ${propsTable}
    </bim-panel-section> 
  `;
};
