import type { RobotObjectReference } from "../../domain/robot-tasks";
import type {
  CandidateSource,
  HighlightPort,
  SelectionPoint,
  SelectionStateListener,
  ViewerObjectSelectionCandidate,
  ViewerObjectSelectionFilterUpdate,
  ViewerObjectSelectionFilters,
  ViewerObjectSelectionManagerOptions,
  ViewerObjectSelectionSnapshot,
  ViewerObjectSelectionStatus,
} from "./selection-types";
import { ViewerSelectionReferenceError } from "./viewerSelectionReferenceError";

/** Maximum number of candidates intentionally exposed by the compact UI. */
const MAX_PRESENTED_CANDIDATES = 20;

/** Default selection behavior keeps spatial objects available for navigation. */
export const DEFAULT_VIEWER_SELECTION_FILTERS: ViewerObjectSelectionFilters = {
  visibleOnly: true,
  includeIfcClasses: [],
  excludeIfcClasses: [],
  maxCandidates: MAX_PRESENTED_CANDIDATES,
};

/** Normalizes IFC classes for case-insensitive exact filter comparisons. */
const normalizeIfcClasses = (values: readonly string[] | undefined) => [
  ...new Set(
    (values ?? [])
      .map((value) => value.trim().toUpperCase())
      .filter((value) => Boolean(value)),
  ),
];

/** Restricts configurable candidate counts to the supported chooser range. */
const normalizeCandidateLimit = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_VIEWER_SELECTION_FILTERS.maxCandidates;
  }
  return Math.min(MAX_PRESENTED_CANDIDATES, Math.max(1, Math.floor(value)));
};

/** Builds a complete immutable filter value from a partial update. */
const normalizeFilters = (
  update: ViewerObjectSelectionFilterUpdate | undefined,
  current: ViewerObjectSelectionFilters = DEFAULT_VIEWER_SELECTION_FILTERS,
): ViewerObjectSelectionFilters => ({
  visibleOnly: update?.visibleOnly ?? current.visibleOnly,
  includeIfcClasses: normalizeIfcClasses(
    update?.includeIfcClasses ?? current.includeIfcClasses,
  ),
  excludeIfcClasses: normalizeIfcClasses(
    update?.excludeIfcClasses ?? current.excludeIfcClasses,
  ),
  maxCandidates: normalizeCandidateLimit(
    update?.maxCandidates ?? current.maxCandidates,
  ),
});

/** Computes the CSS-pixel distance between two pointer positions. */
const pointerDistance = (left: SelectionPoint, right: SelectionPoint) =>
  Math.hypot(left.x - right.x, left.y - right.y);

/** Checks whether two metadata snapshots identify the same viewer item. */
const sameCandidate = (
  left: ViewerObjectSelectionCandidate | undefined,
  right: ViewerObjectSelectionCandidate | undefined,
) => left?.modelId === right?.modelId && left?.localId === right?.localId;

/** Produces a defensive copy for subscribers outside the manager. */
const cloneCandidate = (
  candidate: ViewerObjectSelectionCandidate,
): ViewerObjectSelectionCandidate => ({
  ...candidate,
  ...(candidate.point ? { point: [...candidate.point] } : {}),
  ...(candidate.reference ? { reference: { ...candidate.reference } } : {}),
});

/** Converts an unknown worker failure into safe chooser text. */
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "IFC selection failed.";

/**
 * Owns precise viewer selection state without owning missions or robot tasks.
 * Candidate lookup and highlighting are injected ports, keeping all state
 * transitions independently testable and outside the domain layer.
 */
export class ViewerObjectSelectionManager {
  private readonly candidateSource: CandidateSource;
  private readonly highlightPort: HighlightPort;
  private readonly listeners = new Set<SelectionStateListener>();
  private readonly now: () => number;
  private readonly hoverThrottleMs: number;
  private readonly repeatedPickTolerancePx: number;
  private filters: ViewerObjectSelectionFilters;
  private candidates: readonly ViewerObjectSelectionCandidate[] = [];
  private hoveredCandidate?: ViewerObjectSelectionCandidate;
  private activeIndex: number | null = null;
  private confirmedCandidate?: ViewerObjectSelectionCandidate;
  private status: ViewerObjectSelectionStatus = "idle";
  private error?: string;
  private truncated = false;
  private enabled = true;
  private disposed = false;
  private pickGeneration = 0;
  private hoverGeneration = 0;
  private lastHoverStartedAt = Number.NEGATIVE_INFINITY;
  private lastPickPoint?: SelectionPoint;
  private candidateSessionValid = false;

  /**
   * Creates a manager around viewer-specific lookup and rendering ports.
   * @param candidateSource Resolves IFC objects under client coordinates.
   * @param highlightPort Draws hover, candidate, and confirmed styles.
   * @param initialFilters Optional initial filter overrides.
   * @param options Optional timing hooks and pointer tolerances.
   */
  constructor(
    candidateSource: CandidateSource,
    highlightPort: HighlightPort,
    initialFilters?: ViewerObjectSelectionFilterUpdate,
    options: ViewerObjectSelectionManagerOptions = {},
  ) {
    this.candidateSource = candidateSource;
    this.highlightPort = highlightPort;
    this.filters = normalizeFilters(initialFilters);
    this.hoverThrottleMs = Math.max(0, options.hoverThrottleMs ?? 100);
    this.repeatedPickTolerancePx = Math.max(
      0,
      options.repeatedPickTolerancePx ?? 4,
    );
    this.now = options.now ?? Date.now;
  }

  /**
   * Resolves all useful candidates under an intentional canvas click. Repeated
   * clicks within the configured tolerance cycle the open candidate session.
   */
  async pickAt(point: SelectionPoint): Promise<ViewerObjectSelectionSnapshot> {
    this.assertUsable();
    if (!this.enabled) return this.getSnapshot();

    if (
      this.status === "choosing" &&
      this.candidateSessionValid &&
      this.lastPickPoint &&
      this.candidates.length > 1 &&
      pointerDistance(point, this.lastPickPoint) <= this.repeatedPickTolerancePx
    ) {
      await this.cycleCandidate("next");
      return this.getSnapshot();
    }

    const generation = ++this.pickGeneration;
    this.error = undefined;
    this.status = "loading";
    this.candidates = [];
    this.activeIndex = null;
    this.truncated = false;
    this.candidateSessionValid = false;
    await this.clearHoverInternal();
    await this.highlightPort.showCandidates([]);
    this.notify();

    try {
      const batch = await this.candidateSource.pickCandidates(
        { ...point },
        this.filters,
      );
      if (generation !== this.pickGeneration || !this.enabled) {
        return this.getSnapshot();
      }

      const resolvedCandidates = batch.candidates.slice(
        0,
        this.filters.maxCandidates,
      );
      this.lastPickPoint = { ...point };
      this.candidateSessionValid = true;
      this.candidates = resolvedCandidates;
      this.truncated = Boolean(batch.truncated);

      if (!resolvedCandidates.length) {
        await this.clearSelectionInternal(false);
        return this.getSnapshot();
      }

      this.activeIndex = 0;
      if (resolvedCandidates.length === 1 && resolvedCandidates[0].reference) {
        await this.confirmCandidate(resolvedCandidates[0]);
        return this.getSnapshot();
      }

      this.status = "choosing";
      await this.highlightPort.showCandidates(
        resolvedCandidates,
        resolvedCandidates[0],
      );
      this.notify();
      return this.getSnapshot();
    } catch (error) {
      if (generation !== this.pickGeneration) return this.getSnapshot();
      this.candidates = [];
      this.activeIndex = null;
      this.candidateSessionValid = false;
      this.truncated = false;
      this.error = getErrorMessage(error);
      this.status = "error";
      await this.highlightPort.showCandidates([]);
      this.notify();
      return this.getSnapshot();
    }
  }

  /** Resolves throttled nearest-only feedback while no chooser is open. */
  async hoverAt(point: SelectionPoint): Promise<void> {
    this.assertUsable();
    if (
      !this.enabled ||
      this.status === "choosing" ||
      this.status === "loading"
    ) {
      await this.clearHoverInternal();
      return;
    }

    const now = this.now();
    if (now - this.lastHoverStartedAt < this.hoverThrottleMs) return;
    this.lastHoverStartedAt = now;
    const generation = ++this.hoverGeneration;

    try {
      const candidate = await this.candidateSource.hoverCandidate(
        { ...point },
        this.filters,
      );
      if (generation !== this.hoverGeneration || !this.enabled) return;
      if (sameCandidate(candidate, this.hoveredCandidate)) return;
      this.hoveredCandidate = candidate;
      await this.highlightPort.showHover(candidate);
      this.notify();
    } catch {
      if (generation !== this.hoverGeneration) return;
      await this.clearHoverInternal();
    }
  }

  /** Clears hover feedback when the pointer leaves the renderer canvas. */
  async clearHover(): Promise<void> {
    this.assertUsable();
    ++this.hoverGeneration;
    await this.clearHoverInternal();
  }

  /** Activates one candidate row and previews it in the 3D viewer. */
  async setActiveCandidate(index: number): Promise<void> {
    this.assertUsable();
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.candidates.length
    ) {
      throw new RangeError(
        `Candidate index ${index} is outside the active list.`,
      );
    }
    this.activeIndex = index;
    this.status = "choosing";
    this.error = undefined;
    await this.highlightPort.showCandidates(
      this.candidates,
      this.candidates[index],
    );
    this.notify();
  }

  /** Moves to the next or previous candidate with wraparound. */
  async cycleCandidate(direction: "next" | "previous"): Promise<void> {
    this.assertUsable();
    if (!this.candidates.length) return;
    const currentIndex = this.activeIndex ?? 0;
    const offset = direction === "next" ? 1 : -1;
    const nextIndex =
      (currentIndex + offset + this.candidates.length) % this.candidates.length;
    await this.setActiveCandidate(nextIndex);
  }

  /** Commits and returns a task-service-ready stable object reference. */
  async confirmActiveCandidate(): Promise<RobotObjectReference> {
    this.assertUsable();
    const candidate =
      this.activeIndex === null ? undefined : this.candidates[this.activeIndex];
    if (!candidate?.reference) {
      throw new ViewerSelectionReferenceError(
        candidate?.confirmationError ??
          "The active viewer candidate has no stable IFC identifier.",
      );
    }
    await this.confirmCandidate(candidate);
    return { ...candidate.reference };
  }

  /** Cancels candidate preview while preserving an earlier committed object. */
  async cancelCandidateChoice(): Promise<void> {
    this.assertUsable();
    ++this.pickGeneration;
    this.candidates = [];
    this.activeIndex = null;
    this.candidateSessionValid = false;
    this.lastPickPoint = undefined;
    this.truncated = false;
    this.error = undefined;
    this.status = this.confirmedCandidate ? "confirmed" : "idle";
    await this.highlightPort.showCandidates([]);
    this.notify();
  }

  /** Clears hover, candidate previews, and the committed viewer selection. */
  async clearSelection(): Promise<void> {
    this.assertUsable();
    await this.clearSelectionInternal(true);
  }

  /** Applies filters and refreshes an open chooser at its previous position. */
  async setFilters(
    update: ViewerObjectSelectionFilterUpdate,
  ): Promise<ViewerObjectSelectionSnapshot> {
    this.assertUsable();
    const repeatedPoint =
      this.status === "choosing" ? this.lastPickPoint : undefined;
    this.filters = normalizeFilters(update, this.filters);
    ++this.pickGeneration;
    this.candidateSessionValid = false;
    this.notify();
    if (repeatedPoint && this.enabled) return this.pickAt(repeatedPoint);
    return this.getSnapshot();
  }

  /** Invalidates transient candidates while retaining a committed selection. */
  invalidateCandidateSession(): void {
    if (this.disposed) return;
    ++this.pickGeneration;
    ++this.hoverGeneration;
    this.candidateSessionValid = false;
    this.lastPickPoint = undefined;
    this.candidates = [];
    this.activeIndex = null;
    this.hoveredCandidate = undefined;
    this.truncated = false;
    this.error = undefined;
    this.status = this.confirmedCandidate ? "confirmed" : "idle";
    this.ignoreRejectedHighlight(this.highlightPort.showCandidates([]));
    this.ignoreRejectedHighlight(this.highlightPort.showHover());
    this.notify();
  }

  /** Enables selection or clears it when another viewer tool takes control. */
  async setEnabled(enabled: boolean): Promise<void> {
    this.assertUsable();
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      await this.clearSelectionInternal(true);
      return;
    }
    this.notify();
  }

  /** Returns a defensive immutable snapshot for UI and service consumers. */
  getSnapshot(): ViewerObjectSelectionSnapshot {
    return {
      status: this.status,
      enabled: this.enabled,
      ...(this.hoveredCandidate
        ? { hoveredCandidate: cloneCandidate(this.hoveredCandidate) }
        : {}),
      candidates: this.candidates.map(cloneCandidate),
      activeIndex: this.activeIndex,
      ...(this.confirmedCandidate
        ? { confirmedCandidate: cloneCandidate(this.confirmedCandidate) }
        : {}),
      ...(this.confirmedCandidate?.reference
        ? { confirmedReference: { ...this.confirmedCandidate.reference } }
        : {}),
      filters: {
        ...this.filters,
        includeIfcClasses: [...this.filters.includeIfcClasses],
        excludeIfcClasses: [...this.filters.excludeIfcClasses],
      },
      truncated: this.truncated,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Registers a listener and immediately emits the current snapshot. */
  subscribe(listener: SelectionStateListener): () => void {
    this.assertUsable();
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clears visual state and permanently releases all subscribers. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.clearSelectionInternal(true);
    this.listeners.clear();
    this.disposed = true;
  }

  /** Commits one resolved candidate and closes all transient feedback. */
  private async confirmCandidate(
    candidate: ViewerObjectSelectionCandidate,
  ): Promise<void> {
    this.confirmedCandidate = candidate;
    this.candidates = [];
    this.activeIndex = null;
    this.candidateSessionValid = false;
    this.lastPickPoint = undefined;
    this.truncated = false;
    this.error = undefined;
    this.status = "confirmed";
    await this.clearHoverInternal();
    await this.highlightPort.showCandidates([]);
    await this.highlightPort.showConfirmed(candidate);
    this.notify();
  }

  /** Clears manager state and optionally invalidates in-flight source work. */
  private async clearSelectionInternal(
    invalidateRequests: boolean,
  ): Promise<void> {
    if (invalidateRequests) {
      ++this.pickGeneration;
      ++this.hoverGeneration;
    }
    this.candidates = [];
    this.hoveredCandidate = undefined;
    this.activeIndex = null;
    this.confirmedCandidate = undefined;
    this.candidateSessionValid = false;
    this.lastPickPoint = undefined;
    this.truncated = false;
    this.error = undefined;
    this.status = "idle";
    await this.highlightPort.showHover();
    await this.highlightPort.showCandidates([]);
    await this.highlightPort.showConfirmed();
    this.notify();
  }

  /** Clears hover state only when the renderer currently shows one. */
  private async clearHoverInternal(): Promise<void> {
    ++this.hoverGeneration;
    if (!this.hoveredCandidate) return;
    this.hoveredCandidate = undefined;
    await this.highlightPort.showHover();
    this.notify();
  }

  /** Emits one consistent snapshot to every current listener. */
  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * Keeps synchronous invalidation non-blocking while preventing an obsolete
   * disposed-model highlight update from becoming an unhandled rejection.
   */
  private ignoreRejectedHighlight(result: void | Promise<void>): void {
    if (result instanceof Promise) result.catch(() => undefined);
  }

  /** Rejects calls after disposal, when visual ports are no longer valid. */
  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("ViewerObjectSelectionManager has been disposed.");
    }
  }
}
