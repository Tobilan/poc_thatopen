import type { RobotMission } from "../../domain/robot-tasks";
import { mapMissionToIfcRecords } from "../robot-tasks";
import { IfcModelExportError } from "./ifcModelExportError";
import type { IfcSourceModelRegistry } from "./ifcSourceModelRegistry";
import type { IfcStructuralCodec } from "./webIfcStructuralCodec";

/** Download-ready result produced after structural IFC validation. */
export interface IfcModelExportResult {
  /** Safe file name derived from the original direct IFC import. */
  fileName: string;

  /** Structurally revalidated IFC STEP bytes. */
  bytes: Uint8Array;

  /** IFC schema reported by both web-ifc validation passes. */
  schema: string;

  /** Number of complete RobotMission aggregates written to the IFC. */
  missionCount: number;
}

/** Optional mission and structural-edit inputs for one model export. */
export interface IfcModelExportOptions {
  /** Current internal missions to serialize into the selected source IFC. */
  missions?: readonly RobotMission[];

  /** Whether unsupported structural Fragments edits are present. */
  hasStructuralChanges?: boolean;
}

/**
 * Coordinates safe IFC export without depending on the viewer or browser UI.
 *
 * This service deliberately refuses arbitrary `.frag` models and changed IFC
 * structure. Until a complete Fragments-to-IFC mapper exists, those conditions
 * cannot preserve the model faithfully enough for a trustworthy IFC export.
 */
export class IfcModelExportService {
  /** Registry retaining source IFC bytes for direct IFC imports. */
  private readonly sources: IfcSourceModelRegistry;

  /** Codec responsible for parse-write-reparse structural validation. */
  private readonly codec: IfcStructuralCodec;

  /**
   * Creates a source-backed IFC export service.
   *
   * @param sources Direct-IFC source registry.
   * @param codec Structural IFC writer and validator.
   */
  constructor(sources: IfcSourceModelRegistry, codec: IfcStructuralCodec) {
    this.sources = sources;
    this.codec = codec;
  }

  /**
   * Produces a structurally validated IFC for one loaded Fragments model.
   *
   * @param modelId Runtime Fragments model identifier selected by the user.
   * @param hasStructuralChanges Whether unsupported Fragments edits are present.
   * @returns Download-ready IFC bytes, name, and verified schema.
   */
  async exportModel(
    modelId: string,
    options: IfcModelExportOptions | boolean = {},
  ): Promise<IfcModelExportResult> {
    const normalizedOptions =
      typeof options === "boolean"
        ? { hasStructuralChanges: options }
        : options;
    const source = this.sources.get(modelId);
    if (!source) {
      throw new IfcModelExportError(
        "This model has no retained IFC source. Pure .frag models cannot yet be reconstructed as trustworthy IFC files.",
      );
    }
    if (
      normalizedOptions.hasStructuralChanges ||
      this.sources.hasStructuralChanges(source.modelId)
    ) {
      throw new IfcModelExportError(
        "This Fragments model contains structural edits that cannot yet be mapped safely back to IFC.",
      );
    }
    const missions = normalizedOptions.missions ?? [];
    const validated = missions.length
      ? await this.codec.writeMissionsAndValidate(
          source.bytes,
          source.modelId,
          missions.map(mapMissionToIfcRecords),
        )
      : await this.codec.rewriteAndValidate(source.bytes);
    const baseName = source.fileName.replace(/\.ifc$/i, "") || "model";
    return {
      fileName: `${baseName}-export.ifc`,
      bytes: validated.bytes,
      schema: validated.schema,
      missionCount: missions.length,
    };
  }
}
