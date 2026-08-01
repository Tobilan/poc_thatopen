import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import * as TEMPLATES from "..";
import {
  CONTENT_GRID_GAP,
  CONTENT_GRID_ID,
  SMALL_COLUMN_WIDTH,
} from "../../globals";
import type {
  DirectIfcModelProvenance,
  ViewerObjectSelectionManager,
} from "../../viewer/robot-tasks";
import type {
  RobotMissionService,
  RobotMissionStorageSelection,
} from "../../application/robot-tasks";
import type { IfcSourceModelRegistry } from "../../ifc/model-export";
import type { IfcMissionRoundtripCoordinator } from "../../ifc/model-roundtrip";

type Viewer = "viewer";

type Models = {
  name: "models";
  state: TEMPLATES.ModelsPanelState;
};

type ElementData = {
  name: "elementData";
  state: TEMPLATES.ElementsDataPanelState;
};

type Viewpoints = { name: "viewpoints"; state: TEMPLATES.ViewpointsPanelState };

type RobotMissionTasks = {
  name: "robotMissionTasks";
  state: TEMPLATES.RobotMissionTasksPanelState;
};

export type ContentGridElements = [
  Viewer,
  Models,
  ElementData,
  Viewpoints,
  RobotMissionTasks,
];

export type ContentGridLayouts = ["Viewer"];

export interface ContentGridState {
  components: OBC.Components;
  world: OBC.World;
  id: string;
  viewportTemplate: BUI.StatelessComponent;
  selectionManager: ViewerObjectSelectionManager;
  modelProvenance: DirectIfcModelProvenance;
  ifcSourceRegistry: IfcSourceModelRegistry;
  ifcMissionRoundtrip: IfcMissionRoundtripCoordinator;
  missionService: RobotMissionService;
  missionStorageSelection: RobotMissionStorageSelection;
}

export const contentGridTemplate: BUI.StatefullComponent<ContentGridState> = (
  state,
) => {
  const {
    components,
    world,
    selectionManager,
    modelProvenance,
    ifcSourceRegistry,
    ifcMissionRoundtrip,
    missionService,
    missionStorageSelection,
  } = state;
  const missionPanelRefresh = new TEMPLATES.RobotMissionPanelRefresh();

  const onCreated = (e?: Element) => {
    if (!e) return;
    const grid = e as BUI.Grid<ContentGridLayouts, ContentGridElements>;

    grid.elements = {
      models: {
        template: TEMPLATES.modelsPanelTemplate,
        initialState: {
          components,
          modelProvenance,
          ifcSourceRegistry,
          ifcMissionRoundtrip,
          missionPanelRefresh,
        },
      },
      elementData: {
        template: TEMPLATES.elementsDataPanelTemplate,
        initialState: { components, selectionManager },
      },
      robotMissionTasks: {
        template: TEMPLATES.robotMissionTasksPanelTemplate,
        initialState: {
          missionService,
          missionStorageSelection,
          selectionManager,
          panelRefresh: missionPanelRefresh,
        },
      },
      viewpoints: {
        template: TEMPLATES.viewpointsPanelTemplate,
        initialState: { components, world, selectionManager },
      },
      viewer: state.viewportTemplate,
    };

    grid.layouts = {
      Viewer: {
        template: `
          "models viewer elementData" 1fr
          "robotMissionTasks viewer elementData" 2fr
          "viewpoints viewer elementData" 1fr
          /${SMALL_COLUMN_WIDTH} 1fr ${SMALL_COLUMN_WIDTH}
        `,
      },
    };
  };

  return BUI.html`
    <bim-grid id=${state.id} style="padding: ${CONTENT_GRID_GAP}; gap: ${CONTENT_GRID_GAP}" ${BUI.ref(onCreated)}></bim-grid>
  `;
};

export const getContentGrid = () => {
  const contentGrid = document.getElementById(CONTENT_GRID_ID) as BUI.Grid<
    ContentGridLayouts,
    ContentGridElements
  > | null;

  return contentGrid;
};
