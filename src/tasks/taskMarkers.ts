import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { RobotTask } from "./taskTypes";

export class TaskMarkers {
  private readonly markers: OBF.Marker;
  private readonly markerIds = new Map<string, string>();

  constructor(
    components: OBC.Components,
    private readonly world: OBC.World,
    private readonly onSelect: (taskId: string) => void,
  ) {
    this.markers = components.get(OBF.Marker);
  }

  sync(tasks: RobotTask[]) {
    this.clear();
    for (const task of tasks) {
      if (!task.markerPosition) continue;
      const element = this.createElement(task);
      const point = new THREE.Vector3(...task.markerPosition);
      const markerId = this.markers.create(this.world, element, point, true);
      if (markerId) this.markerIds.set(task.id, markerId);
    }
  }

  clear() {
    for (const markerId of this.markerIds.values()) {
      this.markers.delete(markerId);
    }
    this.markerIds.clear();
  }

  private createElement(task: RobotTask) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `robot-task-marker robot-task-marker--${task.status}`;
    element.textContent = "R";
    element.title = `${task.title} (${task.status})`;
    element.setAttribute("aria-label", `Open task: ${task.title}`);
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onSelect(task.id);
    });
    return element;
  }
}
