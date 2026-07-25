import type * as OBC from "@thatopen/components";
import type { RobotObjectReference } from "../../domain/robot-tasks";
import {
  ThatOpenSelectionMetadataResolver,
  type ViewerExpressIdResolver,
  type ViewerSelectionItemData,
  type ViewerSelectionMetadataResolver,
} from "./selection-metadata";
import { ViewerSelectionReferenceError } from "./viewerSelectionReferenceError";

export type {
  ViewerExpressIdResolver,
  ViewerSelectionItemData,
  ViewerSelectionMetadataResolver,
} from "./selection-metadata";

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
 * Removes surrounding whitespace from an optional textual model value.
 * Empty strings and non-string values are treated as unavailable metadata so
 * they are not persisted as misleading identifiers or labels.
 *
 * @param value Unknown value read from a Fragments model.
 * @returns A non-empty trimmed string, or `undefined` when none is available.
 */
export const normalizeOptionalViewerText = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalizedValue = value.trim();
  return normalizedValue || undefined;
};

/** Converts one resolved viewer item into a stable domain reference. */
export const convertViewerSelectionItemToRobotObjectReference = (
  item: ViewerSelectionItemData,
): RobotObjectReference => {
  const globalId = normalizeOptionalViewerText(item.globalId);
  const expressId =
    typeof item.expressId === "number" && Number.isFinite(item.expressId)
      ? item.expressId
      : undefined;
  const ifcClass = normalizeOptionalViewerText(item.ifcClass);
  const name = normalizeOptionalViewerText(item.name);
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
  items.map(convertViewerSelectionItemToRobotObjectReference);

/**
 * Concrete viewer adapter for selections created by the That Open Highlighter.
 *
 * The adapter reads identifiers and descriptive IFC metadata from loaded
 * Fragments models. It neither stores missions nor mutates tasks, and it has no
 * knowledge of persistence or future IFC serialization semantics.
 */
export class ThatOpenViewerSelectionAdapter implements ViewerSelectionAdapter {
  /** Shared resolver keeps identity and enrichment consistent with picking. */
  private readonly metadataResolver: ViewerSelectionMetadataResolver;

  /**
   * Creates an adapter over the application's existing Fragments manager.
   *
   * @param fragments Initialized manager that owns all loaded viewer models.
   * @param expressIdResolver Optional model-aware confirmation of express IDs.
   */
  constructor(
    fragments: OBC.FragmentsManager,
    expressIdResolver?: ViewerExpressIdResolver,
    metadataResolver?: ViewerSelectionMetadataResolver,
  ) {
    this.metadataResolver =
      metadataResolver ??
      new ThatOpenSelectionMetadataResolver(fragments, expressIdResolver);
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
        this.metadataResolver.resolveItems(modelId, [...localIds]),
      ),
    );

    return convertViewerSelectionItemsToRobotObjectReferences(
      selectedItemsByModel.flat(),
    );
  }
}
