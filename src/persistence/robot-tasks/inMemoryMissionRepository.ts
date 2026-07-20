import type { RobotMissionRepository } from "../../application/robot-tasks";
import type { RobotMission } from "../../domain/robot-tasks";

/**
 * Process-local mission repository for the current browser page lifetime.
 *
 * This adapter deliberately has no browser-storage, network, file, or worker
 * dependency. Creating a new application instance creates a new repository,
 * so a browser reload starts with no RobotMission data from the previous page.
 */
export class InMemoryRobotMissionRepository implements RobotMissionRepository {
  /** Mission aggregates indexed by their stable application identifier. */
  private readonly missions = new Map<string, RobotMission>();

  /**
   * Lists the current page's mission aggregates in insertion order.
   *
   * @returns Every mission held only by this repository instance.
   */
  list(): RobotMission[] {
    return [...this.missions.values()];
  }

  /**
   * Retrieves one mission from the current in-memory page state.
   *
   * @param missionId Stable identifier of the requested mission.
   * @returns The matching mission or null when this page has not created it.
   */
  get(missionId: string): RobotMission | null {
    return this.missions.get(missionId) ?? null;
  }

  /**
   * Inserts or replaces a mission without writing outside this page lifetime.
   *
   * @param mission Complete new-domain mission aggregate to retain in memory.
   */
  save(mission: RobotMission): void {
    this.missions.set(mission.id, mission);
  }

  /**
   * Removes one mission from the current repository instance.
   *
   * @param missionId Stable identifier of the mission to remove.
   */
  delete(missionId: string): void {
    this.missions.delete(missionId);
  }

  /** Removes every mission held by the current browser page instance. */
  clear(): void {
    this.missions.clear();
  }
}
