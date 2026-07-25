import type { ViewerExpressIdResolver } from "./selection-metadata";

/**
 * Records models that were created directly by the application's IFC loader.
 *
 * That Open currently preserves IFC express IDs as local IDs for that import
 * path. The same guarantee does not hold for arbitrary Fragments files, so the
 * registry is intentionally explicit instead of inferring provenance from a
 * file extension or from the shape of a local ID.
 */
export class DirectIfcModelProvenance implements ViewerExpressIdResolver {
  private readonly directIfcModelIds = new Set<string>();

  /** Marks a successfully requested direct IFC import as express-ID safe. */
  registerDirectIfcModel(modelId: string): void {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) {
      throw new Error("A direct IFC model must have a non-empty model ID.");
    }
    this.directIfcModelIds.add(normalizedModelId);
  }

  /** Removes provenance when a load fails or a model is disposed. */
  unregisterModel(modelId: string): void {
    this.directIfcModelIds.delete(modelId.trim());
  }

  /** Returns whether local IDs from the model may be treated as express IDs. */
  isDirectIfcModel(modelId: string): boolean {
    return this.directIfcModelIds.has(modelId.trim());
  }

  /**
   * Confirms local-ID equivalence only for explicitly registered IFC imports.
   */
  resolveExpressId(modelId: string, localId: number): number | undefined {
    if (!this.isDirectIfcModel(modelId)) return undefined;
    return Number.isInteger(localId) && localId >= 0 ? localId : undefined;
  }

  /** Clears all model provenance, for example when the viewer is disposed. */
  clear(): void {
    this.directIfcModelIds.clear();
  }
}
