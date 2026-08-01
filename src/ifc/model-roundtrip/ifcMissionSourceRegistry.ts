import type { RobotMissionStorageMode } from "../../application/robot-tasks";
import type { RobotMission } from "../../domain/robot-tasks";
import type {
  IfcMissionImportIssue,
  IfcMissionRoundtripProvenance,
} from "../model-import";

/** Source-scoped infrastructure state kept deliberately outside the domain. */
export interface IfcMissionSourceState {
  modelId: string;
  fileName: string;
  storageMode: RobotMissionStorageMode;
  missions: readonly RobotMission[];
  issues: readonly IfcMissionImportIssue[];
  provenance: IfcMissionRoundtripProvenance;
  unsafeForExport: boolean;
}

/**
 * Tracks which loaded IFC owns imported/exported mission annotations.
 *
 * Mission IDs remain global domain identities. Ownership is scoped by active
 * storage mode so switching repositories never silently moves or exports data.
 */
export class IfcMissionSourceRegistry {
  private readonly sources = new Map<string, IfcMissionSourceState>();

  private readonly missionOwners = new Map<
    RobotMissionStorageMode,
    Map<string, string>
  >();

  get(modelId: string): IfcMissionSourceState | undefined {
    return this.sources.get(modelId.trim());
  }

  ownerOf(
    missionId: string,
    storageMode: RobotMissionStorageMode,
  ): string | undefined {
    return this.missionOwners.get(storageMode)?.get(missionId);
  }

  /** Replaces all roundtrip metadata discovered for one loaded source. */
  register(state: IfcMissionSourceState): void {
    this.unregister(state.modelId);
    this.sources.set(state.modelId, state);
    const owners = this.ownersFor(state.storageMode);
    for (const mission of state.missions) {
      owners.set(mission.id, state.modelId);
    }
  }

  /** Associates newly authored missions after a verified selected-target export. */
  assignMissions(
    modelId: string,
    storageMode: RobotMissionStorageMode,
    missionIds: readonly string[],
  ): void {
    const owners = this.ownersFor(storageMode);
    for (const missionId of missionIds) owners.set(missionId, modelId);
  }

  /** Removes only source/provenance/ownership metadata, never domain missions. */
  unregister(modelId: string): void {
    const normalizedModelId = modelId.trim();
    this.sources.delete(normalizedModelId);
    for (const owners of this.missionOwners.values()) {
      for (const [missionId, ownerModelId] of owners) {
        if (ownerModelId === normalizedModelId) owners.delete(missionId);
      }
    }
  }

  private ownersFor(storageMode: RobotMissionStorageMode): Map<string, string> {
    let owners = this.missionOwners.get(storageMode);
    if (!owners) {
      owners = new Map();
      this.missionOwners.set(storageMode, owners);
    }
    return owners;
  }
}
