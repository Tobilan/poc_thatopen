import type * as OBC from "@thatopen/components";
import type { FragmentsModel } from "@thatopen/fragments";

/** Viewer metadata resolved for one model-local selection item. */
export interface ViewerSelectionItemData {
  /** Canonical runtime identifier of the loaded model. */
  modelId: string;

  /** That Open local identifier within the model. */
  localId: number;

  /** Confirmed IFC express ID; never inferred for arbitrary Fragments. */
  expressId?: number | null;

  /** Durable IFC GlobalId, when present in the source model. */
  globalId?: string | null;

  /** IFC entity class, for example IFCDOOR. */
  ifcClass?: string | null;

  /** Human-readable IFC Name attribute. */
  name?: unknown;
}

/** Optional port that can prove local-ID/IFC-express-ID equivalence. */
export interface ViewerExpressIdResolver {
  resolveExpressId(
    modelId: string,
    localId: number,
  ): number | undefined | Promise<number | undefined>;
}

/** Shared metadata boundary used by selection adapters and candidate picking. */
export interface ViewerSelectionMetadataResolver {
  resolveItems(
    modelId: string,
    localIds: readonly number[],
  ): Promise<readonly ViewerSelectionItemData[]>;

  clearCache(modelId?: string): void;
}

/** Default upper bound for resolved selection metadata kept in memory. */
export const DEFAULT_SELECTION_METADATA_CACHE_SIZE = 500;

/** Returns a fulfilled value while isolating optional metadata failures. */
const fulfilledValue = <T>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === "fulfilled" ? result.value : undefined;

/** Safely asks the provenance port for a confirmed express ID. */
const resolveExpressId = async (
  resolver: ViewerExpressIdResolver | undefined,
  modelId: string,
  localId: number,
): Promise<number | undefined> => {
  if (!resolver) return undefined;
  try {
    const expressId = await resolver.resolveExpressId(modelId, localId);
    return typeof expressId === "number" && Number.isFinite(expressId)
      ? expressId
      : undefined;
  } catch {
    return undefined;
  }
};

/** Resolves optional class/name data without coupling identity to enrichment. */
const resolveItemMetadata = async (
  model: FragmentsModel,
  localId: number,
): Promise<Pick<ViewerSelectionItemData, "name">> => {
  try {
    const item = model.getItem(localId);
    const [attributesResult] = await Promise.allSettled([item.getAttributes()]);
    const attributes = fulfilledValue(attributesResult);

    return {
      name: attributes?.getValue("Name"),
    };
  } catch {
    return {};
  }
};

/**
 * That Open metadata resolver with batched GUID reads and a bounded LRU cache.
 * Concurrent requests for the same item share the in-flight batch promise.
 */
export class ThatOpenSelectionMetadataResolver
  implements ViewerSelectionMetadataResolver
{
  private readonly fragments: OBC.FragmentsManager;
  private readonly expressIdResolver?: ViewerExpressIdResolver;
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, Readonly<ViewerSelectionItemData>>();
  private readonly pending = new Map<
    string,
    Promise<Readonly<ViewerSelectionItemData>>
  >();
  private readonly ifcClassMaps = new Map<
    string,
    Promise<ReadonlyMap<number, string | null>>
  >();

  constructor(
    fragments: OBC.FragmentsManager,
    expressIdResolver?: ViewerExpressIdResolver,
    maxCacheEntries = DEFAULT_SELECTION_METADATA_CACHE_SIZE,
  ) {
    this.fragments = fragments;
    this.expressIdResolver = expressIdResolver;
    this.maxCacheEntries = Math.max(0, Math.floor(maxCacheEntries));
  }

  async resolveItems(
    modelId: string,
    localIds: readonly number[],
  ): Promise<readonly ViewerSelectionItemData[]> {
    const missingIds: number[] = [];
    const missingKeys = new Set<string>();

    for (const localId of localIds) {
      const key = this.cacheKey(modelId, localId);
      if (
        !this.cache.has(key) &&
        !this.pending.has(key) &&
        !missingKeys.has(key)
      ) {
        missingIds.push(localId);
        missingKeys.add(key);
      }
    }

    if (missingIds.length > 0) {
      this.startBatch(modelId, missingIds);
    }

    return Promise.all(
      localIds.map((localId) => this.resolveCachedOrPending(modelId, localId)),
    );
  }

  clearCache(modelId?: string): void {
    if (modelId === undefined) {
      this.cache.clear();
      this.ifcClassMaps.clear();
      return;
    }

    const prefix = `${modelId}\u0000`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    this.ifcClassMaps.delete(modelId);
  }

  private cacheKey(modelId: string, localId: number): string {
    return `${modelId}\u0000${localId}`;
  }

  private getCached(
    key: string,
  ): Readonly<ViewerSelectionItemData> | undefined {
    const value = this.cache.get(key);
    if (!value) return undefined;

    // Reinsert on access so Map iteration order acts as a compact LRU queue.
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  private storeCached(
    key: string,
    value: Readonly<ViewerSelectionItemData>,
  ): void {
    if (this.maxCacheEntries === 0) return;
    this.cache.delete(key);
    this.cache.set(key, value);

    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private async resolveCachedOrPending(
    modelId: string,
    localId: number,
  ): Promise<Readonly<ViewerSelectionItemData>> {
    const key = this.cacheKey(modelId, localId);
    const cached = this.getCached(key);
    if (cached) return cached;

    const pending = this.pending.get(key);
    if (pending) return pending;

    // The entry can only be absent when a zero-sized batch was interrupted.
    const [resolved] = await this.resolveBatch(modelId, [localId]);
    return resolved;
  }

  private startBatch(modelId: string, localIds: readonly number[]): void {
    const batchPromise = this.resolveBatch(modelId, localIds);

    localIds.forEach((localId, index) => {
      const key = this.cacheKey(modelId, localId);
      const itemPromise = batchPromise.then(
        (items) => {
          const value = items[index];
          this.pending.delete(key);
          this.storeCached(key, value);
          return value;
        },
        (error: unknown) => {
          this.pending.delete(key);
          throw error;
        },
      );
      this.pending.set(key, itemPromise);
    });
  }

  /**
   * Reads IFC classes through the supported batch API. Calling Item.getCategory
   * would dispatch the unavailable `getItemCategory` worker action in
   * Fragments 3.2 and repeatedly log worker TypeErrors in the browser.
   */
  private getIfcClassMap(
    model: FragmentsModel,
  ): Promise<ReadonlyMap<number, string | null>> {
    const cached = this.ifcClassMaps.get(model.modelId);
    if (cached) return cached;

    const mapPromise = Promise.resolve()
      .then(() =>
        Promise.all([
          model.getItemsIdsWithGeometry(),
          model.getItemsWithGeometryCategories(),
        ]),
      )
      .then(([localIds, ifcClasses]) => {
        const classes = new Map<number, string | null>();
        localIds.forEach((localId, index) => {
          classes.set(localId, ifcClasses[index] ?? null);
        });
        return classes;
      })
      .catch(() => new Map<number, string | null>());
    this.ifcClassMaps.set(model.modelId, mapPromise);
    return mapPromise;
  }

  private async resolveBatch(
    modelId: string,
    localIds: readonly number[],
  ): Promise<readonly Readonly<ViewerSelectionItemData>[]> {
    const expressIdsPromise = Promise.all(
      localIds.map((localId) =>
        resolveExpressId(this.expressIdResolver, modelId, localId),
      ),
    );
    const model = this.fragments.list.get(modelId);

    if (!model) {
      const expressIds = await expressIdsPromise;
      return localIds.map((localId, index) =>
        Object.freeze({ modelId, localId, expressId: expressIds[index] }),
      );
    }

    const [expressIds, globalIds, ifcClasses, metadata] = await Promise.all([
      expressIdsPromise,
      model
        .getGuidsByLocalIds([...localIds])
        .catch(() => localIds.map(() => null)),
      this.getIfcClassMap(model),
      Promise.all(
        localIds.map((localId) => resolveItemMetadata(model, localId)),
      ),
    ]);

    return localIds.map((localId, index) =>
      Object.freeze({
        modelId,
        localId,
        expressId: expressIds[index],
        globalId: globalIds[index],
        ifcClass: ifcClasses.get(localId),
        ...metadata[index],
      }),
    );
  }
}
