import type { RobotMission } from "../../domain/robot-tasks";
import type { RobotMissionRepository } from "./missionRepository";

/** Counts returned after atomically upserting reconstructed mission aggregates. */
export interface ImportRobotMissionsResult {
  importedCount: number;
  replacedCount: number;
}

/**
 * Saves reconstructed missions without touching their imported timestamps.
 * Existing IDs are replaced through the repository upsert contract; unrelated
 * aggregates are intentionally left alone.
 */
export const importRobotMissions = (
  repository: RobotMissionRepository,
  missions: readonly RobotMission[],
): ImportRobotMissionsResult => {
  const seen = new Set<string>();
  for (const mission of missions) {
    if (seen.has(mission.id)) {
      throw new Error(`Import contains duplicate mission id ${mission.id}.`);
    }
    seen.add(mission.id);
  }

  let importedCount = 0;
  let replacedCount = 0;
  for (const mission of missions) {
    if (repository.get(mission.id)) replacedCount += 1;
    else importedCount += 1;
    repository.save(mission);
  }
  return { importedCount, replacedCount };
};
