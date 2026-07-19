import type * as OBC from "@thatopen/components";
import type { FragmentsModel } from "@thatopen/fragments";
import type { RobotObjectReference } from "../../domain/robot-tasks";
import { ViewerSelectionReferenceError } from "./viewerSelectionReferenceError";

/**
 * Viewer-derived information about one selected model item before it is
 * converted into the application-independent robot-task reference format.
 *
 * The `localId` name deliberately follows the That Open Components API. For
 * models produced by an IFC importer, this value may originate from an IFC
 * express ID, but the adapter never assumes that equivalence. Keeping the
 * viewer-specific name here prevents That Open terminology from leaking into
 * the domain layer.
 */
export interface ViewerSelectionItemData {
  /** Runtime identifier of the loaded IFC or Fragments model. */
  modelId: string;

  /** That Open local ID of the selected item within its loaded model. */
  localId: number;

  /**
   * Confirmed model-local IFC express ID. This is deliberately separate from
   * localId because arbitrary Fragments files may use another local numbering.
   */
  expressId?: number | null;

  /** Preferred durable IFC GlobalId, when the model provides one. */
  globalId?: string | null;

  /** Optional IFC category, for example IFCDOOR or IFCSPACE. */
  ifcClass?: string | null;

  /** Optional human-readable IFC Name attribute. */
  name?: unknown;
}

/**
 * Boundary implemented by viewer adapters that translate a That Open
 * selection into domain object references.
 *
 * Application services depend only on the returned `RobotObjectReference`
 * values. They do not receive a Highlighter, a Fragments model, or a
 * `ModelIdMap`, which keeps viewer state outside the application layer.
 */
export interface ViewerSelectionAdapter {
  /**
   * Resolves all items in a viewer selection to robot-task object references.
   *
   * @param selection That Open map containing model IDs and selected local IDs.
   * @returns Domain references in the iteration order of the supplied map.
   */
  toRobotObjectReferences(
    selection: OBC.ModelIdMap,
  ): Promise<RobotObjectReference[]>;
}

/**
 * Optional port that confirms whether a viewer-local ID has a corresponding
 * IFC express ID for the selected model.
 */
export interface ViewerExpressIdResolver {
  /**
   * Resolves a confirmed IFC express ID without assuming local-ID equivalence.
   *
   * @param modelId Runtime identifier of the selected Fragments model.
   * @param localId Viewer-local item identifier emitted by the Highlighter.
   * @returns A confirmed express ID, or undefined when it is not available.
   */
  resolveExpressId(
    modelId: string,
    localId: number,
  ): number | undefined | Promise<number | undefined>;
}

/**
 * Removes surrounding whitespace from an optional textual model value.
 * Empty strings and non-string values are treated as unavailable metadata so
 * they are not persisted as misleading identifiers or labels.
 *
 * @param value Unknown value read from a Fragments model.
 * @returns A non-empty trimmed string, or `undefined` when none is available.
 */
const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalizedValue = value.trim();
  return normalizedValue || undefined;
};

/**
 * Converts resolved viewer item data into domain object references without
 * accessing browser state, That Open components, or asynchronous APIs.
 *
 * IFC GlobalId is used as the durable identity whenever available. A confirmed
 * express ID may additionally support efficient model-local lookup or provide
 * the domain fallback when the source model has no GlobalId. The viewer's raw
 * local ID is never relabeled as an express ID. Optional IFC class and name
 * values are descriptive metadata only; concrete robot action semantics are
 * never copied onto the referenced object.
 *
 * This function is intentionally pure so mapping behavior can be unit-tested
 * with plain objects independently from the viewer and its worker.
 *
 * @param items Viewer item data resolved from one or more loaded models.
 * @returns Newly allocated robot-task object references.
 */
export const convertViewerSelectionItemsToRobotObjectReferences = (
  items: readonly ViewerSelectionItemData[],
): RobotObjectReference[] =>
  items.map((item): RobotObjectReference => {
    const globalId = normalizeOptionalText(item.globalId);
    const expressId =
      typeof item.expressId === "number" && Number.isFinite(item.expressId)
        ? item.expressId
        : undefined;
    const ifcClass = normalizeOptionalText(item.ifcClass);
    const name = normalizeOptionalText(item.name);
    const metadata = {
      ...(ifcClass ? { ifcClass } : {}),
      ...(name ? { name } : {}),
    };

    if (globalId) {
      return {
        globalId,
        modelId: item.modelId,
        ...(expressId === undefined ? {} : { expressId }),
        ...metadata,
      };
    }

    if (expressId !== undefined) {
      return { modelId: item.modelId, expressId, ...metadata };
    }

    throw new ViewerSelectionReferenceError(
      `Selected item ${item.modelId}:${item.localId} has no stable IFC identifier.`,
    );
  });

/**
 * Safely resolves an optional confirmed express ID for one selected item.
 * Invalid numbers and resolver failures are treated as unavailable so a valid
 * GlobalId can still be used; conversion later rejects an entirely local-only
 * reference.
 *
 * @param resolver Optional model-aware express-ID resolver.
 * @param modelId Runtime identifier of the selected model.
 * @param localId Viewer-local item identifier.
 * @returns A finite confirmed express ID, or undefined.
 */
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

/**
 * Returns the value of a fulfilled promise result while turning rejected
 * metadata requests into an absent value. A missing category or name should
 * not prevent creation of a valid GlobalId or model-local reference.
 *
 * @param result Settled result of one optional model metadata request.
 * @returns The fulfilled value, or `undefined` after a rejection.
 */
const fulfilledValue = <T>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === "fulfilled" ? result.value : undefined;

/**
 * Resolves the optional IFC class and Name attribute of one Fragments item.
 * Both independent worker requests run concurrently. Failures are isolated to
 * the missing metadata because stable identity can still come from the
 * independently resolved GlobalId or confirmed express ID.
 *
 * @param model Loaded That Open Fragments model containing the item.
 * @param localId Model-local identifier emitted by the Highlighter.
 * @returns Optional class and name values for the pure conversion step.
 */
const resolveItemMetadata = async (
  model: FragmentsModel,
  localId: number,
): Promise<Pick<ViewerSelectionItemData, "ifcClass" | "name">> => {
  try {
    const item = model.getItem(localId);
    const [categoryResult, attributesResult] = await Promise.allSettled([
      item.getCategory(),
      item.getAttributes(),
    ]);
    const attributes = fulfilledValue(attributesResult);

    return {
      ifcClass: fulfilledValue(categoryResult),
      name: attributes?.getValue("Name"),
    };
  } catch {
    return {};
  }
};

/**
 * Resolves all selected local IDs belonging to one loaded model.
 *
 * GUIDs are queried in one batch so their result positions correspond to the
 * input local IDs. Class and name enrichment is performed per item. If the
 * model was disposed between selection and conversion, or an optional worker
 * request fails, the method preserves the selected item data for the final
 * stable-identity check instead of silently relabeling its local ID.
 *
 * @param fragments Manager that owns the currently loaded Fragments models.
 * @param modelId Runtime identifier from the Highlighter selection map.
 * @param localIds Selected local IDs within that model.
 * @returns Viewer item data ready for the pure domain conversion helper.
 */
const resolveModelSelection = async (
  fragments: OBC.FragmentsManager,
  expressIdResolver: ViewerExpressIdResolver | undefined,
  modelId: string,
  localIds: number[],
): Promise<ViewerSelectionItemData[]> => {
  const expressIds = await Promise.all(
    localIds.map((localId) =>
      resolveExpressId(expressIdResolver, modelId, localId),
    ),
  );
  const model = fragments.list.get(modelId);
  if (!model) {
    return localIds.map((localId, index) => ({
      modelId,
      localId,
      expressId: expressIds[index],
    }));
  }

  const [globalIds, metadata] = await Promise.all([
    model.getGuidsByLocalIds(localIds).catch(() => localIds.map(() => null)),
    Promise.all(localIds.map((localId) => resolveItemMetadata(model, localId))),
  ]);

  return localIds.map((localId, index) => ({
    modelId,
    localId,
    expressId: expressIds[index],
    globalId: globalIds[index],
    ...metadata[index],
  }));
};

/**
 * Concrete viewer adapter for selections created by the That Open Highlighter.
 *
 * The adapter reads identifiers and descriptive IFC metadata from loaded
 * Fragments models. It neither stores missions nor mutates tasks, and it has no
 * knowledge of persistence or future IFC serialization semantics.
 */
export class ThatOpenViewerSelectionAdapter implements ViewerSelectionAdapter {
  /** Manager used only to resolve selected model-local item IDs. */
  private readonly fragments: OBC.FragmentsManager;

  /** Optional source of confirmed IFC express IDs for model-local selections. */
  private readonly expressIdResolver?: ViewerExpressIdResolver;

  /**
   * Creates an adapter over the application's existing Fragments manager.
   *
   * @param fragments Initialized manager that owns all loaded viewer models.
   * @param expressIdResolver Optional model-aware confirmation of express IDs.
   */
  constructor(
    fragments: OBC.FragmentsManager,
    expressIdResolver?: ViewerExpressIdResolver,
  ) {
    this.fragments = fragments;
    this.expressIdResolver = expressIdResolver;
  }

  /**
   * Converts a snapshot of the Highlighter selection into domain references.
   * Model groups are resolved concurrently, after which the pure conversion
   * helper applies the stable-identity and metadata rules.
   *
   * @param selection Snapshot from `highlighter.selection.select` or an event.
   * @returns Robot object references without retaining viewer selection state.
   */
  async toRobotObjectReferences(
    selection: OBC.ModelIdMap,
  ): Promise<RobotObjectReference[]> {
    const selectedItemsByModel = await Promise.all(
      Object.entries(selection).map(([modelId, localIds]) =>
        resolveModelSelection(this.fragments, this.expressIdResolver, modelId, [
          ...localIds,
        ]),
      ),
    );

    return convertViewerSelectionItemsToRobotObjectReferences(
      selectedItemsByModel.flat(),
    );
  }
}
