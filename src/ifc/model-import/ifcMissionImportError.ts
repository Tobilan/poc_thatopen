/** Infrastructure failure raised when IFC bytes cannot be opened or inspected. */
export class IfcMissionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IfcMissionImportError";
  }
}
