import {
  compareRobotMissionsSemantically,
  importRobotMissions,
  type RobotMissionRepository,
  type RobotMissionStorageSelection,
} from "../../application/robot-tasks";
import type {
  RobotMission,
  RobotObjectReference,
} from "../../domain/robot-tasks";
import type {
  IfcMissionImportIssue,
  IfcMissionImportService,
} from "../model-import";
import type {
  IfcModelExportResult,
  IfcModelExportService,
  IfcSourceModelRegistry,
} from "../model-export";
import { IfcMissionRoundtripError } from "./ifcMissionRoundtripError";
import { IfcMissionSourceRegistry } from "./ifcMissionSourceRegistry";

/** Read-only importer surface used by the orchestration layer and tests. */
export type IfcMissionImporter = Pick<IfcMissionImportService, "import">;

/** Existing exporter surface composed by this coordinator. */
export type IfcMissionExporter = Pick<IfcModelExportService, "exportModel">;

export interface IfcMissionLoadSummary {
  modelId: string;
  fileName: string;
  schema: string;
  importedCount: number;
  replacedCount: number;
  warningCount: number;
  errorCount: number;
  issues: readonly IfcMissionImportIssue[];
  unsafeForExport: boolean;
  activeMissionId?: string;
}

export interface IfcMissionExportSummary extends IfcModelExportResult {
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  warningCount: number;
}

export interface IfcMissionRoundtripCoordinatorOptions {
  repository: RobotMissionRepository;
  storageSelection: RobotMissionStorageSelection;
  importer: IfcMissionImporter;
  exporter: IfcMissionExporter;
  sources: IfcSourceModelRegistry;
  missionSources?: IfcMissionSourceRegistry;
}

/** Every object reference serialized by a mission. */
const missionReferences = (mission: RobotMission): RobotObjectReference[] =>
  mission.tasks.flatMap((task) => [
    ...task.targetObjects,
    ...task.affectedObjects,
    ...(task.startReference ? [task.startReference] : []),
    ...(task.targetReference ? [task.targetReference] : []),
  ]);

/** Defensive domain snapshot for infrastructure baselines. */
const copyMissions = (missions: readonly RobotMission[]): RobotMission[] =>
  missions.map((mission) => structuredClone(mission));

/** Composes importer, repository upsert, source scope, and verified exporter. */
export class IfcMissionRoundtripCoordinator {
  private readonly repository: RobotMissionRepository;
  private readonly storageSelection: RobotMissionStorageSelection;
  private readonly importer: IfcMissionImporter;
  private readonly exporter: IfcMissionExporter;
  private readonly sources: IfcSourceModelRegistry;
  readonly missionSources: IfcMissionSourceRegistry;

  constructor(options: IfcMissionRoundtripCoordinatorOptions) {
    this.repository = options.repository;
    this.storageSelection = options.storageSelection;
    this.importer = options.importer;
    this.exporter = options.exporter;
    this.sources = options.sources;
    this.missionSources =
      options.missionSources ?? new IfcMissionSourceRegistry();
  }

  /** Imports annotations only after the corresponding direct IFC is loaded. */
  async importLoadedModel(
    modelId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<IfcMissionLoadSummary> {
    const storageMode = this.storageSelection.getMode();
    const result = await this.importer.import(bytes, modelId);
    const warningCount = result.issues.filter(
      (issue) => issue.severity === "warning",
    ).length;
    const errorCount = result.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    let importedCount = 0;
    let replacedCount = 0;
    let storageError = false;

    if (result.missions.length) {
      if (!this.storageSelection.isAvailable(storageMode)) {
        storageError = true;
      } else {
        ({ importedCount, replacedCount } = importRobotMissions(
          this.repository,
          result.missions,
        ));
      }
    }

    const storedMissions = storageError ? [] : copyMissions(result.missions);
    this.missionSources.register({
      modelId,
      fileName,
      storageMode,
      missions: storedMissions,
      issues: result.issues,
      provenance: result.provenance,
      unsafeForExport: errorCount > 0 || storageError,
    });

    if (storageError) {
      throw new IfcMissionRoundtripError(
        "Robot missions were found, but the selected backend storage is unavailable. The building remains loaded and mission export is disabled for this source.",
        "MISSION_STORAGE_UNAVAILABLE",
      );
    }

    return {
      modelId,
      fileName,
      schema: result.schema,
      importedCount,
      replacedCount,
      warningCount,
      errorCount,
      issues: result.issues,
      unsafeForExport: errorCount > 0,
      activeMissionId: result.missions[0]?.id,
    };
  }

  /** Exports only missions associated with, or newly assigned to, this target. */
  async exportModel(
    modelId: string,
    hasStructuralChanges: boolean,
  ): Promise<IfcMissionExportSummary> {
    const sourceState = this.missionSources.get(modelId);
    if (!sourceState) {
      throw new IfcMissionRoundtripError(
        "Mission roundtrip state is missing for this IFC. Reload the source before exporting.",
        "MISSION_SOURCE_NOT_REGISTERED",
      );
    }
    if (sourceState.unsafeForExport) {
      throw new IfcMissionRoundtripError(
        "This IFC contains malformed or unapplied robot annotations. Reload a corrected source before exporting missions.",
        "MISSION_SOURCE_UNSAFE",
        sourceState.issues.map((issue) => `${issue.code}: ${issue.message}`),
      );
    }
    const storageMode = this.storageSelection.getMode();
    if (storageMode !== sourceState.storageMode) {
      throw new IfcMissionRoundtripError(
        `This IFC was associated with mission storage mode '${sourceState.storageMode}', but '${storageMode}' is active. Switch back before exporting.`,
        "MISSION_STORAGE_MODE_CHANGED",
      );
    }
    if (!this.storageSelection.isAvailable(storageMode)) {
      throw new IfcMissionRoundtripError(
        "The selected mission storage is unavailable.",
        "MISSION_STORAGE_UNAVAILABLE",
      );
    }

    const allMissions = this.repository.list();
    const targetMissions = allMissions.filter((mission) => {
      const owner = this.missionSources.ownerOf(mission.id, storageMode);
      return owner === undefined || owner === modelId;
    });
    const crossModelReferences = targetMissions.flatMap((mission) =>
      missionReferences(mission)
        .filter(
          (reference) =>
            reference.modelId !== undefined && reference.modelId !== modelId,
        )
        .map(
          (reference) =>
            `${mission.id}: ${reference.modelId}/${reference.expressId ?? reference.globalId ?? "unknown"}`,
        ),
    );
    if (crossModelReferences.length) {
      throw new IfcMissionRoundtripError(
        "One or more missions reference a different loaded model than the selected export target.",
        "CROSS_MODEL_MISSION_REFERENCE",
        crossModelReferences,
      );
    }

    const previousById = new Map(
      sourceState.missions.map((mission) => [mission.id, mission]),
    );
    const currentById = new Map(
      targetMissions.map((mission) => [mission.id, mission]),
    );
    const addedCount = targetMissions.filter(
      (mission) => !previousById.has(mission.id),
    ).length;
    const removedCount = sourceState.missions.filter(
      (mission) => !currentById.has(mission.id),
    ).length;
    const updatedCount = targetMissions.filter((mission) => {
      const previous = previousById.get(mission.id);
      return (
        previous !== undefined &&
        !compareRobotMissionsSemantically([previous], [mission]).equal
      );
    }).length;

    const exported = await this.exporter.exportModel(modelId, {
      hasStructuralChanges,
      missions: targetMissions,
    });
    const verified = await this.importer.import(exported.bytes, modelId);
    const verificationErrors = verified.issues.filter(
      (issue) => issue.severity === "error",
    );
    const comparison = compareRobotMissionsSemantically(
      targetMissions,
      verified.missions,
    );
    if (verificationErrors.length || !comparison.equal) {
      throw new IfcMissionRoundtripError(
        "The exported IFC could not be accepted as the next verified roundtrip source.",
        "MISSION_EXPORT_REIMPORT_FAILED",
        [
          ...verificationErrors.map(
            (issue) => `${issue.code}: ${issue.message}`,
          ),
          ...comparison.differences.map((difference) => difference.message),
        ],
      );
    }

    this.sources.replaceVerifiedBytes(modelId, exported.bytes);
    const nextState = {
      modelId,
      fileName: sourceState.fileName,
      storageMode,
      missions: copyMissions(verified.missions),
      issues: verified.issues,
      provenance: verified.provenance,
      unsafeForExport: false,
    };
    this.missionSources.register(nextState);
    this.missionSources.assignMissions(
      modelId,
      storageMode,
      targetMissions.map((mission) => mission.id),
    );

    return {
      ...exported,
      addedCount,
      updatedCount,
      removedCount,
      warningCount: verified.issues.filter(
        (issue) => issue.severity === "warning",
      ).length,
    };
  }

  /** Clears infrastructure metadata when the viewer removes a model. */
  unregisterModel(modelId: string): void {
    this.missionSources.unregister(modelId);
  }
}
