import assert from "node:assert/strict";
import test from "node:test";
import {
  convertViewerSelectionItemsToRobotObjectReferences,
  ThatOpenViewerSelectionAdapter,
  ViewerSelectionReferenceError,
} from "../../src/viewer/robot-tasks";

/**
 * Verifies that a durable IFC identifier is normalized and preserved together
 * with the viewer-local identifiers needed for efficient runtime lookup.
 */
test("conversion prefers a trimmed GlobalId and retains local lookup identifiers", () => {
  const references = convertViewerSelectionItemsToRobotObjectReferences([
    {
      modelId: "building-model",
      localId: 42,
      expressId: 42,
      globalId: "  3wP5DoorGlobalId  ",
    },
  ]);

  assert.deepEqual(references, [
    {
      globalId: "3wP5DoorGlobalId",
      modelId: "building-model",
      expressId: 42,
    },
  ]);
});

/**
 * Verifies that selected items remain referenceable when their source model
 * does not provide a durable IFC GlobalId.
 */
test("conversion falls back to modelId and expressId when GlobalId is missing", () => {
  const references = convertViewerSelectionItemsToRobotObjectReferences([
    {
      modelId: "fragment-model",
      localId: 17,
      expressId: 17,
      globalId: null,
    },
  ]);

  assert.deepEqual(references, [
    {
      modelId: "fragment-model",
      expressId: 17,
    },
  ]);
});

/**
 * Verifies that useful IFC metadata is trimmed while blank or non-textual
 * values are omitted instead of becoming misleading domain metadata.
 */
test("conversion normalizes IFC class and object name metadata", () => {
  const references = convertViewerSelectionItemsToRobotObjectReferences([
    {
      modelId: "model-with-metadata",
      localId: 1,
      expressId: 1,
      globalId: "door-guid",
      ifcClass: "  IFCDOOR  ",
      name: "  Main entrance door  ",
    },
    {
      modelId: "model-without-metadata",
      localId: 2,
      expressId: 2,
      globalId: "space-guid",
      ifcClass: "   ",
      name: 123,
    },
  ]);

  assert.deepEqual(references, [
    {
      globalId: "door-guid",
      modelId: "model-with-metadata",
      expressId: 1,
      ifcClass: "IFCDOOR",
      name: "Main entrance door",
    },
    {
      globalId: "space-guid",
      modelId: "model-without-metadata",
      expressId: 2,
    },
  ]);
});

/**
 * Verifies that a selection spanning multiple loaded models keeps the exact
 * order supplied by the viewer-resolution step.
 */
test("conversion preserves item order across multiple models", () => {
  const references = convertViewerSelectionItemsToRobotObjectReferences([
    {
      modelId: "second-loaded-model",
      localId: 8,
      expressId: 8,
      globalId: "second-guid",
    },
    {
      modelId: "first-loaded-model",
      localId: 3,
      expressId: 3,
      globalId: "first-guid",
    },
    {
      modelId: "second-loaded-model",
      localId: 9,
      expressId: 9,
      globalId: null,
    },
  ]);

  assert.deepEqual(
    references.map((reference) => [
      reference.modelId,
      reference.expressId,
      reference.globalId,
    ]),
    [
      ["second-loaded-model", 8, "second-guid"],
      ["first-loaded-model", 3, "first-guid"],
      ["second-loaded-model", 9, undefined],
    ],
  );
});

/** Verifies that an empty viewer selection produces no domain references. */
test("conversion returns an empty array for an empty selection", () => {
  assert.deepEqual(convertViewerSelectionItemsToRobotObjectReferences([]), []);
});

/**
 * Verifies the architectural rule that concrete action semantics are never
 * copied from viewer object data onto a RobotObjectReference.
 */
test("conversion does not copy action properties onto object references", () => {
  const viewerItemWithActionLikeFields = {
    modelId: "building-model",
    localId: 24,
    expressId: 24,
    globalId: "door-guid",
    ifcClass: "IFCDOOR",
    properties: { targetState: "OPEN" },
    actionType: "OPEN",
  };

  const [reference] = convertViewerSelectionItemsToRobotObjectReferences([
    viewerItemWithActionLikeFields,
  ]);

  assert.deepEqual(reference, {
    globalId: "door-guid",
    modelId: "building-model",
    expressId: 24,
    ifcClass: "IFCDOOR",
  });
  assert.equal("properties" in reference, false);
  assert.equal("actionType" in reference, false);
});

/** Verifies that a raw Fragments local ID is never persisted as an express ID. */
test("conversion rejects selections without a stable IFC identifier", () => {
  assert.throws(
    () =>
      convertViewerSelectionItemsToRobotObjectReferences([
        {
          modelId: "arbitrary-fragments-model",
          localId: 77,
          globalId: null,
        },
      ]),
    ViewerSelectionReferenceError,
  );
});

/**
 * Verifies aligned GUID and metadata resolution in the concrete That Open
 * adapter while using a separate resolver to confirm IFC express IDs.
 */
test("That Open adapter resolves ordered references without owning selection state", async () => {
  const model = {
    getGuidsByLocalIds: async (localIds: number[]) =>
      localIds.map((localId) => (localId === 5 ? "door-guid" : null)),
    getItem: (localId: number) => ({
      getCategory: async () => (localId === 5 ? "IFCDOOR" : "IFCSPACE"),
      getAttributes: async () => ({
        getValue: (key: string) => (key === "Name" ? `Item ${localId}` : null),
      }),
    }),
  };
  const fragments = {
    list: new Map([["model-a", model]]),
  } as unknown as ConstructorParameters<
    typeof ThatOpenViewerSelectionAdapter
  >[0];
  const adapter = new ThatOpenViewerSelectionAdapter(fragments, {
    resolveExpressId: (_modelId, localId) => localId + 100,
  });

  const references = await adapter.toRobotObjectReferences({
    "model-a": new Set([5, 8]),
  });

  assert.deepEqual(references, [
    {
      globalId: "door-guid",
      modelId: "model-a",
      expressId: 105,
      ifcClass: "IFCDOOR",
      name: "Item 5",
    },
    {
      modelId: "model-a",
      expressId: 108,
      ifcClass: "IFCSPACE",
      name: "Item 8",
    },
  ]);
});

/**
 * Verifies that missing models and failed GUID requests require a separately
 * confirmed express ID instead of silently using a Fragments local ID.
 */
test("That Open adapter uses only confirmed fallback express IDs", async () => {
  const failedModel = {
    getGuidsByLocalIds: async () => {
      throw new Error("Worker unavailable");
    },
    getItem: () => ({
      getCategory: async () => null,
      getAttributes: async () => null,
    }),
  };
  const fragments = {
    list: new Map([["failed-model", failedModel]]),
  } as unknown as ConstructorParameters<
    typeof ThatOpenViewerSelectionAdapter
  >[0];
  const adapter = new ThatOpenViewerSelectionAdapter(fragments, {
    resolveExpressId: (_modelId, localId) => localId + 1000,
  });

  const references = await adapter.toRobotObjectReferences({
    "missing-model": new Set([2]),
    "failed-model": new Set([3]),
  });

  assert.deepEqual(references, [
    { modelId: "missing-model", expressId: 1002 },
    { modelId: "failed-model", expressId: 1003 },
  ]);

  const unsafeAdapter = new ThatOpenViewerSelectionAdapter(fragments);
  await assert.rejects(
    () =>
      unsafeAdapter.toRobotObjectReferences({
        "missing-model": new Set([2]),
      }),
    ViewerSelectionReferenceError,
  );
});
