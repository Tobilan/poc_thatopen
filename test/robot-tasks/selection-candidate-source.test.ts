import assert from "node:assert/strict";
import test from "node:test";
import type * as OBC from "@thatopen/components";
import type { FragmentsModel, RaycastResult } from "@thatopen/fragments";
import { DirectIfcModelProvenance } from "../../src/viewer/robot-tasks/model-provenance";
import { ThatOpenSelectionMetadataResolver } from "../../src/viewer/robot-tasks/selection-metadata";
import { ThatOpenSelectionCandidateSource } from "../../src/viewer/robot-tasks/that-open-selection-candidate-source";
import type { ViewerObjectSelectionFilters } from "../../src/viewer/robot-tasks/selection-types";

const filters = (
  update: Partial<ViewerObjectSelectionFilters> = {},
): ViewerObjectSelectionFilters => ({
  visibleOnly: true,
  includeIfcClasses: [],
  excludeIfcClasses: [],
  maxCandidates: 20,
  ...update,
});

const raycastHit = (
  model: FragmentsModel,
  localId: number,
  distance: number,
  rayDistance = distance,
  point: readonly [number, number, number] = [distance, 0, 0],
): RaycastResult =>
  ({
    fragments: model,
    localId,
    itemId: localId,
    distance,
    rayDistance,
    point: { x: point[0], y: point[1], z: point[2] },
  }) as unknown as RaycastResult;

const fragmentsManager = (
  models: readonly FragmentsModel[],
): OBC.FragmentsManager =>
  ({
    list: new Map(models.map((model) => [model.modelId, model])),
  }) as unknown as OBC.FragmentsManager;

const raycastContext = {
  dom: {} as HTMLCanvasElement,
  getCamera: () =>
    ({}) as ReturnType<
      ConstructorParameters<
        typeof ThatOpenSelectionCandidateSource
      >[1]["getCamera"]
    >,
};

test("candidate source orders, deduplicates, filters, and canonicalizes all hits", async () => {
  let parentModel = {} as FragmentsModel;
  let deltaModel = {} as FragmentsModel;
  let fragmentModel = {} as FragmentsModel;
  let guidRequests = 0;

  parentModel = {
    modelId: "ifc-parent",
    parentModelId: null,
    getClippingPlanesEvent: () => [
      { distanceToPoint: (point: { x: number }) => point.x },
    ],
    raycastAll: async () => [
      raycastHit(parentModel, 9, 0, 0, [-1, 0, 0]),
      raycastHit(parentModel, 1, 1),
      raycastHit(parentModel, 2, 2, 3),
      raycastHit(parentModel, 3, 2, 2),
    ],
    raycast: async () => raycastHit(parentModel, 1, 1),
    getVisible: async (localIds: number[]) =>
      localIds.map((localId) => localId !== 1),
    getItemsIdsWithGeometry: async () => [1, 2, 3, 9],
    getItemsWithGeometryCategories: async () => [
      "IFCDOOR",
      "IFCDOOR",
      "IFCDOOR",
      "IFCDOOR",
    ],
    getGuidsByLocalIds: async (localIds: number[]) => {
      guidRequests += 1;
      return localIds.map(() => null);
    },
    getItem: (localId: number) => ({
      getCategory: async () => "IFCDOOR",
      getAttributes: async () => ({
        getValue: (key: string) =>
          key === "Name" ? `Door ${localId}` : undefined,
      }),
    }),
  } as unknown as FragmentsModel;

  deltaModel = {
    modelId: "ifc-delta",
    parentModelId: "ifc-parent",
    getClippingPlanesEvent: () => [],
    raycastAll: async () => [raycastHit(deltaModel, 3, 2, 4)],
    raycast: async () => raycastHit(deltaModel, 3, 2, 4),
    getVisible: async (localIds: number[]) => localIds.map(() => true),
  } as unknown as FragmentsModel;

  fragmentModel = {
    modelId: "third-party-fragments",
    parentModelId: null,
    getClippingPlanesEvent: () => [],
    raycastAll: async () => [
      raycastHit(fragmentModel, 7, 3),
      raycastHit(fragmentModel, 8, 4),
    ],
    raycast: async () => raycastHit(fragmentModel, 7, 3),
    getVisible: async (localIds: number[]) => localIds.map(() => true),
    getItemsIdsWithGeometry: async () => [7, 8],
    getItemsWithGeometryCategories: async () => ["IFCDOOR", "IFCDOOR"],
    getGuidsByLocalIds: async (localIds: number[]) =>
      localIds.map((localId) => (localId === 7 ? "fragment-guid" : null)),
    getItem: (localId: number) => ({
      getCategory: async () => "IFCDOOR",
      getAttributes: async () => ({
        getValue: (key: string) =>
          key === "Name" ? `Fragment door ${localId}` : undefined,
      }),
    }),
  } as unknown as FragmentsModel;

  const failedModel = {
    modelId: "failed-model",
    parentModelId: null,
    raycastAll: async () => {
      throw new Error("worker failed");
    },
    raycast: async () => {
      throw new Error("worker failed");
    },
  } as unknown as FragmentsModel;
  const fragments = fragmentsManager([
    parentModel,
    deltaModel,
    fragmentModel,
    failedModel,
  ]);
  const provenance = new DirectIfcModelProvenance();
  provenance.registerDirectIfcModel("ifc-parent");
  const metadata = new ThatOpenSelectionMetadataResolver(fragments, provenance);
  const source = new ThatOpenSelectionCandidateSource(
    fragments,
    raycastContext,
    metadata,
  );

  const result = await source.pickCandidates(
    { x: 10, y: 20 },
    filters({ includeIfcClasses: [" ifcdoor "] }),
  );

  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.candidates.map(({ modelId, localId }) => [modelId, localId]),
    [
      ["ifc-parent", 3],
      ["ifc-parent", 2],
      ["third-party-fragments", 7],
      ["third-party-fragments", 8],
    ],
  );
  assert.deepEqual(result.candidates[0].reference, {
    modelId: "ifc-parent",
    expressId: 3,
    ifcClass: "IFCDOOR",
    name: "Door 3",
  });
  assert.deepEqual(result.candidates[2].reference, {
    globalId: "fragment-guid",
    modelId: "third-party-fragments",
    ifcClass: "IFCDOOR",
    name: "Fragment door 7",
  });
  assert.equal(result.candidates[2].expressId, undefined);
  assert.equal(result.candidates[3].reference, undefined);
  assert.match(result.candidates[3].confirmationError ?? "", /no stable IFC/i);
  assert.deepEqual(result.candidates[0].point, [2, 0, 0]);

  const excluded = await source.pickCandidates(
    { x: 10, y: 20 },
    filters({ excludeIfcClasses: ["IFCDOOR"] }),
  );
  assert.deepEqual(excluded.candidates, []);
  assert.equal(guidRequests, 1, "metadata is reused by the second click");
});

test("candidate source caps raw enrichment and displayed candidates", async () => {
  let model = {} as FragmentsModel;
  let requestedGuidCount = 0;
  model = {
    modelId: "dense-model",
    parentModelId: null,
    getClippingPlanesEvent: () => [],
    raycastAll: async () =>
      Array.from({ length: 105 }, (_, localId) =>
        raycastHit(model, localId, localId + 1),
      ),
    raycast: async () => raycastHit(model, 0, 1),
    getVisible: async (localIds: number[]) => localIds.map(() => true),
    getGuidsByLocalIds: async (localIds: number[]) => {
      requestedGuidCount += localIds.length;
      return localIds.map((localId) => `guid-${localId}`);
    },
    getItem: () => ({
      getCategory: async () => "IFCWALL",
      getAttributes: async () => null,
    }),
  } as unknown as FragmentsModel;
  const fragments = fragmentsManager([model]);
  const source = new ThatOpenSelectionCandidateSource(
    fragments,
    raycastContext,
  );

  const result = await source.pickCandidates(
    { x: 0, y: 0 },
    filters({ maxCandidates: 20 }),
  );

  assert.equal(result.candidates.length, 20);
  assert.equal(result.truncated, true);
  assert.equal(requestedGuidCount, 100);
  assert.deepEqual(
    result.candidates.map(({ localId }) => localId),
    Array.from({ length: 20 }, (_, index) => index),
  );
});

test("hover uses nearest-only raycasts and preserves other model results", async () => {
  let goodModel = {} as FragmentsModel;
  let nearestCalls = 0;
  let allCalls = 0;
  goodModel = {
    modelId: "good-model",
    parentModelId: null,
    getClippingPlanesEvent: () => [],
    raycast: async () => {
      nearestCalls += 1;
      return raycastHit(goodModel, 4, 1);
    },
    raycastAll: async () => {
      allCalls += 1;
      return [];
    },
    getVisible: async () => [true],
    getItemsIdsWithGeometry: async () => [1],
    getItemsWithGeometryCategories: async () => ["IFCDOOR"],
    getGuidsByLocalIds: async () => ["hover-guid"],
    getItem: () => ({
      getCategory: async () => "IFCDOOR",
      getAttributes: async () => null,
    }),
  } as unknown as FragmentsModel;
  const failedModel = {
    modelId: "failed-model",
    parentModelId: null,
    raycast: async () => {
      throw new Error("worker unavailable");
    },
    raycastAll: async () => [],
  } as unknown as FragmentsModel;
  const fragments = fragmentsManager([failedModel, goodModel]);
  const source = new ThatOpenSelectionCandidateSource(
    fragments,
    raycastContext,
  );

  const candidate = await source.hoverCandidate({ x: 1, y: 2 }, filters());

  assert.equal(candidate?.globalId, "hover-guid");
  assert.equal(nearestCalls, 1);
  assert.equal(allCalls, 0);
});

test("candidate source reports an error when every available worker fails", async () => {
  const failedModel = {
    modelId: "failed-model",
    parentModelId: null,
    raycast: async () => {
      throw new Error("worker unavailable");
    },
    raycastAll: async () => {
      throw new Error("worker unavailable");
    },
  } as unknown as FragmentsModel;
  const source = new ThatOpenSelectionCandidateSource(
    fragmentsManager([failedModel]),
    raycastContext,
  );

  await assert.rejects(
    source.pickCandidates({ x: 1, y: 2 }, filters()),
    /Unable to query IFC selection candidates/,
  );
});

test("direct IFC provenance never promotes arbitrary Fragments local IDs", () => {
  const provenance = new DirectIfcModelProvenance();
  provenance.registerDirectIfcModel("direct-ifc");

  assert.equal(provenance.resolveExpressId("direct-ifc", 42), 42);
  assert.equal(provenance.resolveExpressId("arbitrary-frag", 42), undefined);
  provenance.unregisterModel("direct-ifc");
  assert.equal(provenance.resolveExpressId("direct-ifc", 42), undefined);
});

test("metadata resolver batches reads and evicts least-recently-used entries", async () => {
  const guidBatches: number[][] = [];
  const model = {
    modelId: "cache-model",
    getGuidsByLocalIds: async (localIds: number[]) => {
      guidBatches.push([...localIds]);
      return localIds.map((localId) => `guid-${localId}`);
    },
    getItemsIdsWithGeometry: async () => [1, 2, 3],
    getItemsWithGeometryCategories: async () => [
      "IFCDOOR",
      "IFCDOOR",
      "IFCDOOR",
    ],
    getItem: (localId: number) => ({
      getCategory: async () => "IFCDOOR",
      getAttributes: async () => ({
        getValue: () => `Door ${localId}`,
      }),
    }),
  } as unknown as FragmentsModel;
  const fragments = fragmentsManager([model]);
  const metadata = new ThatOpenSelectionMetadataResolver(
    fragments,
    undefined,
    2,
  );

  await metadata.resolveItems("cache-model", [1, 2]);
  await metadata.resolveItems("cache-model", [1, 2]);
  await metadata.resolveItems("cache-model", [3]);
  await metadata.resolveItems("cache-model", [1]);

  assert.deepEqual(guidBatches, [[1, 2], [3], [1]]);
});
