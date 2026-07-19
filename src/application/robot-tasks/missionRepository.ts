import type { RobotMission } from "../../domain/robot-tasks";

/**
 * Persistence port used by the robot-mission application service.
 *
 * The interface deliberately speaks only in domain objects. Implementations may
 * store missions in localStorage today or in a backend later without exposing
 * storage keys, JSON envelopes, viewer objects, or IFC mapping details to the
 * application layer.
 */
export interface RobotMissionRepository {
  /**
   * Returns every stored mission in repository-defined stable order.
   *
   * @returns All currently persisted robot missions.
   */
  list(): RobotMission[];

  /**
   * Finds one mission by its stable application identifier.
   *
   * @param missionId Identifier of the mission to retrieve.
   * @returns The mission when found; otherwise null.
   */
  get(missionId: string): RobotMission | null;

  /**
   * Inserts a new mission or replaces the mission with the same identifier.
   *
   * @param mission Complete domain aggregate that should be persisted.
   */
  save(mission: RobotMission): void;

  /**
   * Removes one mission. Implementations treat an unknown identifier as a no-op.
   *
   * @param missionId Identifier of the mission to remove.
   */
  delete(missionId: string): void;

  /** Removes every mission managed by this repository implementation. */
  clear(): void;
}
