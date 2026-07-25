import type {
  RobotMissionRepository,
  RobotMissionStorageMode,
  RobotMissionStorageSelection,
} from "../../application/robot-tasks";
import type { RobotMission } from "../../domain/robot-tasks";
import { InMemoryRobotMissionRepository } from "./inMemoryMissionRepository";
import {
  LocalStorageRobotMissionRepository,
  type RobotMissionStorage,
} from "./localStorageMissionRepository";
import { RobotMissionPersistenceError } from "./robotMissionPersistenceError";

/**
 * Repository facade that routes mission commands to the user-selected store.
 *
 * The page-local and localStorage repositories remain independent sources of
 * truth. Switching modes never copies, merges, or deletes their missions. The
 * backend mode is intentionally represented as an unavailable placeholder so
 * the UI can expose the planned option without pretending that data was saved.
 */
export class SelectableRobotMissionRepository
  implements RobotMissionRepository, RobotMissionStorageSelection
{
  /** Volatile repository whose contents disappear when the page reloads. */
  private readonly inMemoryRepository = new InMemoryRobotMissionRepository();

  /** Durable browser repository used only after explicit user selection. */
  private readonly localStorageRepository: LocalStorageRobotMissionRepository;

  /** Destination used by all current repository reads and writes. */
  private activeMode: RobotMissionStorageMode;

  /**
   * Creates the selectable repository with page-local storage as the default.
   *
   * @param storage Browser storage implementation used by localStorage mode.
   * @param initialMode Optional initial destination; defaults to no persistence.
   */
  constructor(
    storage: RobotMissionStorage,
    initialMode: RobotMissionStorageMode = "none",
  ) {
    this.localStorageRepository = new LocalStorageRobotMissionRepository(
      storage,
    );
    this.activeMode = initialMode;
  }

  /** @returns The storage destination currently used for mission commands. */
  getMode(): RobotMissionStorageMode {
    return this.activeMode;
  }

  /**
   * Changes the active destination without moving data between repositories.
   *
   * @param mode Destination selected in the mission authoring panel.
   */
  selectMode(mode: RobotMissionStorageMode): void {
    this.activeMode = mode;
  }

  /**
   * Reports whether the selected destination has an operational adapter.
   *
   * @param mode Destination to inspect.
   * @returns False only for the reserved backend option.
   */
  isAvailable(mode: RobotMissionStorageMode): boolean {
    return mode !== "backend";
  }

  /** @returns Missions from the active store, or none for backend placeholder mode. */
  list(): RobotMission[] {
    return this.activeRepository()?.list() ?? [];
  }

  /**
   * Reads one mission from the active store.
   *
   * @param missionId Stable mission identifier.
   * @returns The matching mission, or null when unavailable or absent.
   */
  get(missionId: string): RobotMission | null {
    return this.activeRepository()?.get(missionId) ?? null;
  }

  /**
   * Saves one mission to the active operational repository.
   *
   * @param mission Complete mission aggregate to persist.
   * @throws RobotMissionPersistenceError While backend mode is unavailable.
   */
  save(mission: RobotMission): void {
    this.requireActiveRepository().save(mission);
  }

  /**
   * Deletes one complete mission from only the active repository.
   *
   * @param missionId Stable mission identifier to remove.
   * @throws RobotMissionPersistenceError While backend mode is unavailable.
   */
  delete(missionId: string): void {
    this.requireActiveRepository().delete(missionId);
  }

  /**
   * Removes all missions from only the active operational repository.
   *
   * @throws RobotMissionPersistenceError While backend mode is unavailable.
   */
  clear(): void {
    this.requireActiveRepository().clear();
  }

  /**
   * Resolves the repository for the currently selected operational mode.
   *
   * @returns Active adapter, or undefined for the future backend destination.
   */
  private activeRepository(): RobotMissionRepository | undefined {
    if (this.activeMode === "none") return this.inMemoryRepository;
    if (this.activeMode === "local-storage") {
      return this.localStorageRepository;
    }
    return undefined;
  }

  /**
   * Resolves a writable repository and rejects the backend placeholder.
   *
   * @returns Active page-local or localStorage adapter.
   * @throws RobotMissionPersistenceError When backend mode is selected.
   */
  private requireActiveRepository(): RobotMissionRepository {
    const repository = this.activeRepository();
    if (!repository) {
      throw new RobotMissionPersistenceError(
        "Backend mission storage is reserved for a future implementation.",
      );
    }
    return repository;
  }
}
