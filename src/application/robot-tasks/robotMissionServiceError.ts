/**
 * Error raised when an application command cannot address the requested
 * mission or task, or would violate an application-level invariant.
 */
export class RobotMissionServiceError extends Error {
  /**
   * Creates an application-specific error while preserving the standard Error
   * contract expected by UI and test callers.
   *
   * @param message Human-readable explanation of the failed command.
   */
  constructor(message: string) {
    super(message);
    this.name = "RobotMissionServiceError";
  }
}
