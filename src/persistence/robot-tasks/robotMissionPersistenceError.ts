/**
 * Error raised when the configured storage cannot be read, validated, or
 * written without losing the new mission model's structural guarantees.
 */
export class RobotMissionPersistenceError extends Error {
  /**
   * Creates a persistence-specific error suitable for UI error handling.
   *
   * @param message Human-readable explanation of the storage failure.
   */
  constructor(message: string) {
    super(message);
    this.name = "RobotMissionPersistenceError";
  }
}
