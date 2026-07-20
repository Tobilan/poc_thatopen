import type { RobotMission } from "../../domain/robot-tasks";

/** Storage destinations offered by the robot-mission authoring UI. */
export type RobotMissionStorageMode = "none" | "local-storage" | "backend";

/**
 * Application-facing control for selecting where mission aggregates are kept.
 *
 * Changing the mode changes the active repository; it does not copy missions
 * between storage destinations. This keeps an explicit user choice from
 * silently creating a durable browser copy of an in-memory draft.
 */
export interface RobotMissionStorageSelection {
  /** @returns The storage destination currently used by mission commands. */
  getMode(): RobotMissionStorageMode;

  /**
   * Selects the repository used by subsequent mission reads and writes.
   *
   * @param mode Desired mission storage destination.
   */
  selectMode(mode: RobotMissionStorageMode): void;

  /**
   * Reports whether a destination can currently accept mission commands.
   *
   * @param mode Storage destination whose implementation should be checked.
   * @returns False for UI placeholders that are not implemented yet.
   */
  isAvailable(mode: RobotMissionStorageMode): boolean;
}

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
