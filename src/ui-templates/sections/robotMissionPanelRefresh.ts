/** UI-only request to rerender the existing mission editor after external import. */
export interface RobotMissionPanelRefreshRequest {
  activeMissionId?: string;
}

/** Small presentation event shared by the model loader and mission panel. */
export class RobotMissionPanelRefresh {
  private readonly listeners = new Set<
    (request: RobotMissionPanelRefreshRequest) => void
  >();

  subscribe(
    listener: (request: RobotMissionPanelRefreshRequest) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(request: RobotMissionPanelRefreshRequest = {}): void {
    for (const listener of this.listeners) listener(request);
  }
}
