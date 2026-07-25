/** Error raised when an IFC model cannot be exported without risking data loss. */
export class IfcModelExportError extends Error {
  /**
   * Creates an export-specific error suitable for direct display in the UI.
   *
   * @param message Human-readable reason why the safe export was rejected.
   */
  constructor(message: string) {
    super(message);
    this.name = "IfcModelExportError";
  }
}
