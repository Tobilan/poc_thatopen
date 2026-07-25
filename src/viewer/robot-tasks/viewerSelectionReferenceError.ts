/**
 * Error raised when a selected viewer item has neither a durable IFC GlobalId
 * nor an explicitly confirmed model-local IFC express ID.
 */
export class ViewerSelectionReferenceError extends Error {
  /**
   * Creates an adapter error that a future UI can present without persisting an
   * unstable Fragments-only item identifier.
   *
   * @param message Human-readable explanation of the unresolved selection.
   */
  constructor(message: string) {
    super(message);
    this.name = "ViewerSelectionReferenceError";
  }
}
