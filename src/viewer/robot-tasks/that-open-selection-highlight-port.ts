import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import type { ViewerObjectSelectionCandidate } from "./selection-types";

export const ROBOT_SELECTION_HOVER_STYLE = "robot-selection-hover";
export const ROBOT_SELECTION_CANDIDATES_STYLE = "robot-selection-candidates";
export const ROBOT_SELECTION_ACTIVE_STYLE = "robot-selection-active";

/**
 * Highlighter styles that represent short-lived picking state rather than
 * user-authored model colors. Consumers such as viewpoints must ignore them.
 */
export const ROBOT_SELECTION_TRANSIENT_STYLES: ReadonlySet<string> = new Set([
  ROBOT_SELECTION_HOVER_STYLE,
  ROBOT_SELECTION_CANDIDATES_STYLE,
  ROBOT_SELECTION_ACTIVE_STYLE,
]);

const candidatesToModelIdMap = (
  candidates: readonly ViewerObjectSelectionCandidate[],
): OBC.ModelIdMap => {
  const result: OBC.ModelIdMap = {};
  for (const candidate of candidates) {
    const localIds = result[candidate.modelId] ?? new Set<number>();
    localIds.add(candidate.localId);
    result[candidate.modelId] = localIds;
  }
  return result;
};

const sameCandidate = (
  first: ViewerObjectSelectionCandidate,
  second: ViewerObjectSelectionCandidate,
) => first.modelId === second.modelId && first.localId === second.localId;

/**
 * Maps selection-manager feedback onto independent That Open Highlighter
 * styles. Confirmed selection deliberately uses the existing `select` style
 * so the property table and viewer actions continue to work unchanged.
 */
export class ThatOpenSelectionHighlightPort {
  private readonly highlighter: OBF.Highlighter;

  /** Serializes fragment color changes triggered by rapid candidate cycling. */
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(highlighter: OBF.Highlighter) {
    this.highlighter = highlighter;
    this.ensureStyles();
  }

  async showHover(candidate?: ViewerObjectSelectionCandidate): Promise<void> {
    await this.enqueueUpdate(() =>
      this.replaceStyle(
        ROBOT_SELECTION_HOVER_STYLE,
        candidate ? [candidate] : [],
      ),
    );
  }

  async showCandidates(
    candidates: readonly ViewerObjectSelectionCandidate[],
    activeCandidate?: ViewerObjectSelectionCandidate,
  ): Promise<void> {
    await this.enqueueUpdate(async () => {
      const inactiveCandidates = activeCandidate
        ? candidates.filter(
            (candidate) => !sameCandidate(candidate, activeCandidate),
          )
        : candidates;

      await this.replaceStyle(
        ROBOT_SELECTION_CANDIDATES_STYLE,
        inactiveCandidates,
      );
      await this.replaceStyle(
        ROBOT_SELECTION_ACTIVE_STYLE,
        activeCandidate ? [activeCandidate] : [],
      );
    });
  }

  async showConfirmed(
    candidate?: ViewerObjectSelectionCandidate,
  ): Promise<void> {
    await this.enqueueUpdate(() =>
      this.replaceStyle("select", candidate ? [candidate] : []),
    );
  }

  /**
   * Adds one renderer mutation to the queue. Failures remain visible to the
   * caller while the internal chain recovers for later pointer input.
   */
  private enqueueUpdate(update: () => Promise<void>): Promise<void> {
    const queuedUpdate = this.updateQueue.then(update, update);
    this.updateQueue = queuedUpdate.catch(() => undefined);
    return queuedUpdate;
  }

  private ensureStyles() {
    if (!this.highlighter.styles.has(ROBOT_SELECTION_HOVER_STYLE)) {
      this.highlighter.styles.set(ROBOT_SELECTION_HOVER_STYLE, {
        color: new THREE.Color("#2ed9ff"),
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 0.85,
        transparent: true,
      });
    }
    if (!this.highlighter.styles.has(ROBOT_SELECTION_CANDIDATES_STYLE)) {
      this.highlighter.styles.set(ROBOT_SELECTION_CANDIDATES_STYLE, {
        color: new THREE.Color("#9b6cff"),
        renderedFaces: FRAGS.RenderedFaces.ONE,
        opacity: 0.3,
        transparent: true,
      });
    }
    if (!this.highlighter.styles.has(ROBOT_SELECTION_ACTIVE_STYLE)) {
      this.highlighter.styles.set(ROBOT_SELECTION_ACTIVE_STYLE, {
        color: new THREE.Color("#ff9f2f"),
        renderedFaces: FRAGS.RenderedFaces.TWO,
        opacity: 0.95,
        transparent: true,
        depthTest: false,
      });
    }
  }

  private async replaceStyle(
    style: string,
    candidates: readonly ViewerObjectSelectionCandidate[],
  ): Promise<void> {
    if (!candidates.length) {
      await this.highlighter.clear(style);
      return;
    }
    await this.highlighter.highlightByID(
      style,
      candidatesToModelIdMap(candidates),
      true,
      false,
    );
  }
}
