import type { RobotObjectReference } from "../../domain/robot-tasks";

/** Client-space pointer coordinates used for viewer hit testing. */
export interface SelectionPoint {
  readonly x: number;
  readonly y: number;
}

/** Immutable world-space point at which a ray hit a candidate surface. */
export type SelectionHitPoint = readonly [number, number, number];

/**
 * One viewer item found below the pointer, enriched with IFC metadata and an
 * optional stable domain reference.
 */
export interface ViewerObjectSelectionCandidate {
  /** Runtime identifier of the loaded IFC or Fragments model. */
  readonly modelId: string;

  /** Viewer-local item identifier used exclusively for runtime operations. */
  readonly localId: number;

  /** Distance used as the primary nearest-surface ordering key. */
  readonly distance: number;

  /** Optional secondary ray-distance ordering key supplied by an adapter. */
  readonly rayDistance?: number;

  /** Optional world-space point at which the candidate surface was hit. */
  readonly point?: SelectionHitPoint;

  /** Preferred durable IFC identifier, when available. */
  readonly globalId?: string;

  /** Confirmed IFC express ID; never an assumed raw Fragments local ID. */
  readonly expressId?: number;

  /** Optional IFC class such as IFCDOOR or IFCSPACE. */
  readonly ifcClass?: string;

  /** Optional display label read from the source model. */
  readonly name?: string;

  /** Whether the item was visible when candidates were resolved. */
  readonly visible?: boolean;

  /** Stable domain reference that can be passed to a robot-task service. */
  readonly reference?: RobotObjectReference;

  /** Explanation shown when this candidate cannot be confirmed. */
  readonly confirmationError?: string;
}

/** Normalized filters applied to both click and hover candidate lookup. */
export interface ViewerObjectSelectionFilters {
  /** Exclude explicitly hidden candidates when true. */
  readonly visibleOnly: boolean;

  /** When non-empty, allow only these normalized IFC classes. */
  readonly includeIfcClasses: readonly string[];

  /** Always reject these normalized IFC classes. */
  readonly excludeIfcClasses: readonly string[];

  /** Maximum number of candidates exposed by one selection session. */
  readonly maxCandidates: number;
}

/** Partial filter input accepted by the manager. */
export type ViewerObjectSelectionFilterUpdate =
  Partial<ViewerObjectSelectionFilters>;

/** Candidate-source response for a deliberate click selection. */
export interface SelectionCandidateBatch {
  readonly candidates: readonly ViewerObjectSelectionCandidate[];
  /** True when the source stopped before inspecting all possible hits. */
  readonly truncated?: boolean;
}

/**
 * Viewer-specific boundary that performs hit testing and metadata lookup.
 * Implementations may use That Open, while the manager remains testable with
 * plain objects.
 */
export interface CandidateSource {
  pickCandidates(
    point: SelectionPoint,
    filters: ViewerObjectSelectionFilters,
  ): Promise<SelectionCandidateBatch>;

  hoverCandidate(
    point: SelectionPoint,
    filters: ViewerObjectSelectionFilters,
  ): Promise<ViewerObjectSelectionCandidate | undefined>;
}

/** Viewer-specific boundary for transient and confirmed visual feedback. */
export interface HighlightPort {
  showHover(candidate?: ViewerObjectSelectionCandidate): void | Promise<void>;

  showCandidates(
    candidates: readonly ViewerObjectSelectionCandidate[],
    activeCandidate?: ViewerObjectSelectionCandidate,
  ): void | Promise<void>;

  showConfirmed(
    candidate?: ViewerObjectSelectionCandidate,
  ): void | Promise<void>;
}

/** Coarse selection workflow state suitable for rendering a compact chooser. */
export type ViewerObjectSelectionStatus =
  | "idle"
  | "loading"
  | "choosing"
  | "confirmed"
  | "error";

/** Immutable public state emitted whenever the selection workflow changes. */
export interface ViewerObjectSelectionSnapshot {
  readonly status: ViewerObjectSelectionStatus;
  readonly enabled: boolean;
  readonly hoveredCandidate?: ViewerObjectSelectionCandidate;
  readonly candidates: readonly ViewerObjectSelectionCandidate[];
  readonly activeIndex: number | null;
  readonly confirmedCandidate?: ViewerObjectSelectionCandidate;
  readonly confirmedReference?: RobotObjectReference;
  readonly filters: ViewerObjectSelectionFilters;
  readonly truncated: boolean;
  readonly error?: string;
}

/** Subscriber invoked with a new immutable snapshot after each state change. */
export type SelectionStateListener = (
  snapshot: ViewerObjectSelectionSnapshot,
) => void;

/** Optional timing and pointer-tolerance configuration for the manager. */
export interface ViewerObjectSelectionManagerOptions {
  /** Minimum interval between hover source requests. Defaults to 100 ms. */
  readonly hoverThrottleMs?: number;

  /** Maximum distance for reusing and cycling a click session. Defaults to 4. */
  readonly repeatedPickTolerancePx?: number;

  /** Injectable monotonic clock used by focused tests. */
  readonly now?: () => number;
}
