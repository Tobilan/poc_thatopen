/** Structured orchestration failure that is safe to present in the model UI. */
export class IfcMissionRoundtripError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "IfcMissionRoundtripError";
  }
}
