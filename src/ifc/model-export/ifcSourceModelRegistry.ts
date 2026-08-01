import { IfcModelExportError } from "./ifcModelExportError";

/** Immutable source data retained for a Fragments model loaded directly from IFC. */
export interface IfcSourceModel {
  /** Runtime identifier of the corresponding Fragments model. */
  modelId: string;

  /** Original IFC file name used to derive a meaningful download name. */
  fileName: string;

  /** Latest structurally verified IFC STEP bytes for this loaded model. */
  bytes: Uint8Array;
}

/** Lightweight source metadata suitable for model-selection user interfaces. */
export type IfcSourceModelSummary = Omit<IfcSourceModel, "bytes">;

/**
 * Associates direct IFC imports with their generated runtime Fragments models.
 *
 * A `.frag` file is deliberately not registered because Fragments data alone
 * cannot currently reconstruct every IFC entity, relationship, header value,
 * and schema constraint required for a lossless STEP export.
 */
export class IfcSourceModelRegistry {
  /** IFC sources indexed by the exact Fragments model identifier. */
  private readonly sources = new Map<string, IfcSourceModel>();

  /** Models edited after import and therefore unsafe for source-only export. */
  private readonly structurallyChangedModelIds = new Set<string>();

  /**
   * Retains the IFC source used to create one loaded Fragments model.
   *
   * The byte array is not copied to avoid doubling memory use for large models.
   * Callers transfer read-only ownership and must not mutate it afterwards.
   *
   * @param source Runtime model identity, original name, and IFC STEP bytes.
   */
  register(source: IfcSourceModel): void {
    const modelId = source.modelId.trim();
    const fileName = source.fileName.trim();
    if (!modelId) {
      throw new IfcModelExportError("An IFC source requires a model ID.");
    }
    if (!fileName) {
      throw new IfcModelExportError("An IFC source requires a file name.");
    }
    if (!source.bytes.byteLength) {
      throw new IfcModelExportError("An IFC source cannot be empty.");
    }
    this.sources.set(modelId, {
      modelId,
      fileName,
      bytes: source.bytes,
    });
    this.structurallyChangedModelIds.delete(modelId);
  }

  /**
   * Advances a retained source after a complete write/reopen/import check.
   *
   * Keeping the last verified bytes makes later exports true replacements of
   * the previous annotation graph, including its preserved IFC GlobalIds.
   * The original upload name remains stable for every generated download.
   *
   * @param modelId Runtime model whose verified source should advance.
   * @param bytes Fully validated replacement IFC bytes.
   */
  replaceVerifiedBytes(modelId: string, bytes: Uint8Array): void {
    const normalizedModelId = modelId.trim();
    const source = this.sources.get(normalizedModelId);
    if (!source) {
      throw new IfcModelExportError(
        "Verified IFC bytes require an existing source-backed model.",
      );
    }
    if (!bytes.byteLength) {
      throw new IfcModelExportError(
        "Verified IFC source bytes cannot be empty.",
      );
    }
    this.sources.set(normalizedModelId, { ...source, bytes });
  }

  /**
   * Finds the source IFC corresponding to a loaded Fragments model.
   *
   * @param modelId Runtime Fragments model identifier.
   * @returns Registered source or undefined for arbitrary `.frag` models.
   */
  get(modelId: string): IfcSourceModel | undefined {
    return this.sources.get(modelId.trim());
  }

  /** @returns Exportable IFC source identities without exposing their bytes. */
  list(): IfcSourceModelSummary[] {
    return [...this.sources.values()].map(({ modelId, fileName }) => ({
      modelId,
      fileName,
    }));
  }

  /**
   * Permanently marks a loaded source-backed model as changed for this session.
   *
   * Saving or clearing Fragments editor history does not make the retained IFC
   * source current again, so the marker remains until the model is reloaded.
   *
   * @param modelId Runtime Fragments model identifier reported by the editor.
   */
  markStructurallyChanged(modelId: string): void {
    const normalizedModelId = modelId.trim();
    if (this.sources.has(normalizedModelId)) {
      this.structurallyChangedModelIds.add(normalizedModelId);
    }
  }

  /**
   * Checks whether Fragments edits have diverged from the retained IFC source.
   *
   * @param modelId Runtime Fragments model identifier.
   * @returns True once an editor action has changed the model this session.
   */
  hasStructuralChanges(modelId: string): boolean {
    return this.structurallyChangedModelIds.has(modelId.trim());
  }

  /**
   * Removes retained IFC bytes when the corresponding model leaves the viewer.
   *
   * @param modelId Runtime Fragments model identifier being disposed.
   */
  unregister(modelId: string): void {
    const normalizedModelId = modelId.trim();
    this.sources.delete(normalizedModelId);
    this.structurallyChangedModelIds.delete(normalizedModelId);
  }

  /** Releases every retained IFC source byte array. */
  clear(): void {
    this.sources.clear();
    this.structurallyChangedModelIds.clear();
  }
}
