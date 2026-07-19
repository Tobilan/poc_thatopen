import type * as OBC from "@thatopen/components";
import type { FragmentsModel, RaycastResult } from "@thatopen/fragments";
import {
  Vector2,
  type OrthographicCamera,
  type PerspectiveCamera,
} from "three";
import {
  convertViewerSelectionItemToRobotObjectReference,
  normalizeOptionalViewerText,
} from "./selection-adapter";
import {
  ThatOpenSelectionMetadataResolver,
  type ViewerSelectionItemData,
  type ViewerSelectionMetadataResolver,
} from "./selection-metadata";
import type {
  CandidateSource,
  SelectionCandidateBatch,
  SelectionHitPoint,
  SelectionPoint,
  ViewerObjectSelectionCandidate,
  ViewerObjectSelectionFilters,
} from "./selection-types";

/** Maximum number of distinct click hits enriched with IFC metadata. */
export const MAX_RAW_SELECTION_HITS = 100;

/** Camera and canvas access needed by the worker-backed Fragments raycaster. */
export interface ThatOpenSelectionRaycastContext {
  readonly dom: HTMLCanvasElement;
  getCamera(): PerspectiveCamera | OrthographicCamera;
}

interface NormalizedHit {
  readonly modelId: string;
  readonly localId: number;
  readonly distance: number;
  readonly rayDistance?: number;
  readonly point?: SelectionHitPoint;
  readonly visible: boolean;
}

interface UncheckedHit extends Omit<NormalizedHit, "visible"> {
  readonly model: FragmentsModel;
  readonly sourceIndex: number;
}

const normalizeIfcClass = (value: string): string => value.trim().toUpperCase();

const compareHits = (left: UncheckedHit, right: UncheckedHit): number => {
  const distanceDifference = left.distance - right.distance;
  if (distanceDifference !== 0) return distanceDifference;

  const leftRayDistance = left.rayDistance ?? Number.POSITIVE_INFINITY;
  const rightRayDistance = right.rayDistance ?? Number.POSITIVE_INFINITY;
  const rayDistanceDifference = leftRayDistance - rightRayDistance;
  if (rayDistanceDifference !== 0) return rayDistanceDifference;

  const modelDifference = left.modelId.localeCompare(right.modelId);
  if (modelDifference !== 0) return modelDifference;

  const localIdDifference = left.localId - right.localId;
  return localIdDifference || left.sourceIndex - right.sourceIndex;
};

const isClipped = (model: FragmentsModel, hit: RaycastResult): boolean => {
  try {
    const planes = model.getClippingPlanesEvent();
    return planes.some((plane) => plane.distanceToPoint(hit.point) <= 0);
  } catch {
    // Fragments raycasting already applies configured clipping planes. A
    // missing optional provider must not discard a valid worker result.
    return false;
  }
};

const toHitPoint = (hit: RaycastResult): SelectionHitPoint | undefined => {
  const { x, y, z } = hit.point;
  if (![x, y, z].every(Number.isFinite)) return undefined;
  return Object.freeze([x, y, z]) as SelectionHitPoint;
};

/**
 * Worker-backed candidate source that queries each loaded Fragments model.
 * Model failures are isolated so one unavailable delta/model cannot make all
 * other overlapping candidates disappear.
 */
export class ThatOpenSelectionCandidateSource implements CandidateSource {
  private readonly fragments: OBC.FragmentsManager;
  private readonly context: ThatOpenSelectionRaycastContext;
  private readonly metadataResolver: ViewerSelectionMetadataResolver;

  constructor(
    fragments: OBC.FragmentsManager,
    context: ThatOpenSelectionRaycastContext,
    metadataResolver: ViewerSelectionMetadataResolver = new ThatOpenSelectionMetadataResolver(
      fragments,
    ),
  ) {
    this.fragments = fragments;
    this.context = context;
    this.metadataResolver = metadataResolver;
  }

  async pickCandidates(
    point: SelectionPoint,
    filters: ViewerObjectSelectionFilters,
  ): Promise<SelectionCandidateBatch> {
    const rawHits = await this.raycastModels(point, true);
    const uniqueHits = this.normalizeHits(rawHits);
    const rawHitsTruncated = uniqueHits.length > MAX_RAW_SELECTION_HITS;
    const inspectedHits = uniqueHits.slice(0, MAX_RAW_SELECTION_HITS);
    const visibleHits = await this.resolveVisibility(inspectedHits, filters);
    const candidates = await this.enrichCandidates(visibleHits, filters);
    const displayedCandidates = candidates.slice(0, filters.maxCandidates);

    return Object.freeze({
      candidates: Object.freeze(displayedCandidates),
      truncated:
        rawHitsTruncated || candidates.length > displayedCandidates.length,
    });
  }

  async hoverCandidate(
    point: SelectionPoint,
    filters: ViewerObjectSelectionFilters,
  ): Promise<ViewerObjectSelectionCandidate | undefined> {
    const rawHits = await this.raycastModels(point, false);
    const uniqueHits = this.normalizeHits(rawHits);
    const visibleHits = await this.resolveVisibility(uniqueHits, filters);
    const candidates = await this.enrichCandidates(visibleHits, filters);
    return candidates[0];
  }

  private async raycastModels(
    point: SelectionPoint,
    all: boolean,
  ): Promise<readonly RaycastResult[]> {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];

    const data = {
      camera: this.context.getCamera(),
      mouse: new Vector2(point.x, point.y),
      dom: this.context.dom,
    };
    const models = [...this.fragments.list.values()];
    const settledResults = await Promise.allSettled(
      models.map((model) =>
        all ? model.raycastAll(data) : model.raycast(data),
      ),
    );

    const hits: RaycastResult[] = [];
    let failedModelCount = 0;
    for (const result of settledResults) {
      if (result.status === "rejected") {
        failedModelCount += 1;
        continue;
      }
      if (!result.value) continue;
      if (Array.isArray(result.value)) hits.push(...result.value);
      else hits.push(result.value);
    }
    if (!hits.length && failedModelCount > 0) {
      throw new Error("Unable to query IFC selection candidates.");
    }
    return hits;
  }

  private normalizeHits(
    rawHits: readonly RaycastResult[],
  ): readonly UncheckedHit[] {
    const hits: UncheckedHit[] = [];

    rawHits.forEach((hit, sourceIndex) => {
      const { fragments: hitModel, localId, distance } = hit;
      if (
        !hitModel ||
        !Number.isFinite(localId) ||
        !Number.isFinite(distance) ||
        isClipped(hitModel, hit)
      ) {
        return;
      }

      const modelId = hitModel.parentModelId ?? hitModel.modelId;
      const model = this.fragments.list.get(modelId) ?? hitModel;
      const rayDistance = Number.isFinite(hit.rayDistance)
        ? hit.rayDistance
        : undefined;
      const hitPoint = toHitPoint(hit);

      hits.push({
        modelId,
        localId,
        distance,
        ...(rayDistance === undefined ? {} : { rayDistance }),
        ...(hitPoint === undefined ? {} : { point: hitPoint }),
        model,
        sourceIndex,
      });
    });

    hits.sort(compareHits);
    const seen = new Set<string>();
    return hits.filter((hit) => {
      const key = `${hit.modelId}\u0000${hit.localId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async resolveVisibility(
    hits: readonly UncheckedHit[],
    filters: ViewerObjectSelectionFilters,
  ): Promise<readonly NormalizedHit[]> {
    const groups = new Map<FragmentsModel, UncheckedHit[]>();
    for (const hit of hits) {
      const modelHits = groups.get(hit.model) ?? [];
      modelHits.push(hit);
      groups.set(hit.model, modelHits);
    }

    const groupEntries = [...groups.entries()];
    const visibilityResults = await Promise.allSettled(
      groupEntries.map(([model, modelHits]) =>
        model.getVisible(modelHits.map((hit) => hit.localId)),
      ),
    );
    const visibilityByKey = new Map<string, boolean>();

    groupEntries.forEach(([, modelHits], groupIndex) => {
      const result = visibilityResults[groupIndex];
      modelHits.forEach((hit, hitIndex) => {
        // A fulfilled Fragments raycast is visible geometry. Preserve that
        // reliable fallback if a separate visibility worker request fails.
        const visible =
          result.status === "fulfilled"
            ? result.value[hitIndex] !== false
            : true;
        visibilityByKey.set(`${hit.modelId}\u0000${hit.localId}`, visible);
      });
    });

    return hits
      .map((hit): NormalizedHit => {
        const visible =
          visibilityByKey.get(`${hit.modelId}\u0000${hit.localId}`) ?? true;
        return {
          modelId: hit.modelId,
          localId: hit.localId,
          distance: hit.distance,
          ...(hit.rayDistance === undefined
            ? {}
            : { rayDistance: hit.rayDistance }),
          ...(hit.point === undefined ? {} : { point: hit.point }),
          visible,
        };
      })
      .filter((hit) => !filters.visibleOnly || hit.visible);
  }

  private async enrichCandidates(
    hits: readonly NormalizedHit[],
    filters: ViewerObjectSelectionFilters,
  ): Promise<readonly ViewerObjectSelectionCandidate[]> {
    const hitsByModel = new Map<string, NormalizedHit[]>();
    for (const hit of hits) {
      const modelHits = hitsByModel.get(hit.modelId) ?? [];
      modelHits.push(hit);
      hitsByModel.set(hit.modelId, modelHits);
    }

    const modelEntries = [...hitsByModel.entries()];
    const metadataResults = await Promise.allSettled(
      modelEntries.map(([modelId, modelHits]) =>
        this.metadataResolver.resolveItems(
          modelId,
          modelHits.map((hit) => hit.localId),
        ),
      ),
    );
    const metadataByKey = new Map<string, ViewerSelectionItemData>();

    modelEntries.forEach(([modelId, modelHits], modelIndex) => {
      const result = metadataResults[modelIndex];
      modelHits.forEach((hit, hitIndex) => {
        const fallback = { modelId, localId: hit.localId };
        const metadata =
          result.status === "fulfilled"
            ? (result.value[hitIndex] ?? fallback)
            : fallback;
        metadataByKey.set(`${modelId}\u0000${hit.localId}`, metadata);
      });
    });

    const include = new Set(filters.includeIfcClasses.map(normalizeIfcClass));
    const exclude = new Set(filters.excludeIfcClasses.map(normalizeIfcClass));
    const candidates: ViewerObjectSelectionCandidate[] = [];

    for (const hit of hits) {
      const metadata = metadataByKey.get(
        `${hit.modelId}\u0000${hit.localId}`,
      ) ?? { modelId: hit.modelId, localId: hit.localId };
      const ifcClass = normalizeOptionalViewerText(metadata.ifcClass);
      const normalizedClass = ifcClass
        ? normalizeIfcClass(ifcClass)
        : undefined;
      if (normalizedClass && exclude.has(normalizedClass)) continue;
      if (
        include.size > 0 &&
        (!normalizedClass || !include.has(normalizedClass))
      ) {
        continue;
      }

      candidates.push(this.createCandidate(hit, metadata));
    }

    return candidates;
  }

  private createCandidate(
    hit: NormalizedHit,
    metadata: ViewerSelectionItemData,
  ): ViewerObjectSelectionCandidate {
    const globalId = normalizeOptionalViewerText(metadata.globalId);
    const expressId =
      typeof metadata.expressId === "number" &&
      Number.isFinite(metadata.expressId)
        ? metadata.expressId
        : undefined;
    const ifcClass = normalizeOptionalViewerText(metadata.ifcClass);
    const name = normalizeOptionalViewerText(metadata.name);
    let reference;
    let confirmationError: string | undefined;

    try {
      reference = Object.freeze(
        convertViewerSelectionItemToRobotObjectReference(metadata),
      );
    } catch (error) {
      confirmationError =
        error instanceof Error
          ? error.message
          : `Selected item ${hit.modelId}:${hit.localId} has no stable IFC identifier.`;
    }

    return Object.freeze({
      modelId: hit.modelId,
      localId: hit.localId,
      distance: hit.distance,
      ...(hit.rayDistance === undefined
        ? {}
        : { rayDistance: hit.rayDistance }),
      ...(hit.point === undefined ? {} : { point: hit.point }),
      ...(globalId === undefined ? {} : { globalId }),
      ...(expressId === undefined ? {} : { expressId }),
      ...(ifcClass === undefined ? {} : { ifcClass }),
      ...(name === undefined ? {} : { name }),
      visible: hit.visible,
      ...(reference === undefined ? {} : { reference }),
      ...(confirmationError === undefined ? {} : { confirmationError }),
    });
  }
}
