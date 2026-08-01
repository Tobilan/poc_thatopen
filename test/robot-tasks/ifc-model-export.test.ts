import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskToMission,
  createRobotMission,
  createRobotTask,
  type RobotMission,
} from "../../src/domain/robot-tasks";
import {
  IfcModelExportError,
  IfcModelExportService,
  IfcSourceModelRegistry,
  WebIfcStructuralCodec,
} from "../../src/ifc/model-export";
import type { IfcRobotMissionRecordGraph } from "../../src/ifc/robot-tasks";
import type {
  IfcApiPort,
  IfcStructuralCodec,
  StructurallyValidatedIfc,
} from "../../src/ifc/model-export";

/** Source bytes representing one direct IFC import in service-level tests. */
const sourceBytes = new Uint8Array([1, 2, 3]);

/** Rewritten bytes returned by structural-codec test doubles. */
const rewrittenBytes = new Uint8Array([4, 5, 6]);

/** Structural codec test double that records source bytes received from export. */
class RecordingStructuralCodec implements IfcStructuralCodec {
  /** Every source byte array supplied by the export service. */
  readonly inputs: Uint8Array[] = [];

  /** Mission-aware calls received from the export service. */
  readonly missionInputs: Array<{
    sourceModelId: string;
    missions: readonly RobotMission[];
    graphs: readonly IfcRobotMissionRecordGraph[];
  }> = [];

  /** Parses no IFC itself; returns deterministic validated test output. */
  async rewriteAndValidate(
    source: Uint8Array,
  ): Promise<StructurallyValidatedIfc> {
    this.inputs.push(source);
    return { bytes: rewrittenBytes, schema: "IFC4" };
  }

  /** Records mapped mission graphs without requiring web-ifc in service tests. */
  async writeMissionsAndValidate(
    source: Uint8Array,
    _sourceModelId: string,
    _graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc> {
    this.inputs.push(source);
    return { bytes: rewrittenBytes, schema: "IFC4" };
  }

  /** Records the authoritative collection used by duplicate-free replacement. */
  async replaceMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    missions: readonly RobotMission[],
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc> {
    this.inputs.push(source);
    this.missionInputs.push({ sourceModelId, missions, graphs });
    return { bytes: rewrittenBytes, schema: "IFC4" };
  }
}

/** Configuration used by one isolated fake web-ifc validation pass. */
interface FakeIfcApiOptions {
  /** Schema reported for the opened model. */
  schema?: string;

  /** Number of entity lines reported after parsing. */
  lineCount?: number;

  /** Bytes emitted when the first pass saves its model. */
  savedBytes?: Uint8Array;

  /** Whether OpenModel should return a valid handle. */
  opens?: boolean;
}

/** Observable counters added to the minimal fake web-ifc API port. */
interface FakeIfcApiState extends IfcApiPort {
  /** Number of times this isolated API parsed IFC bytes. */
  openCount: number;

  /** Number of times this isolated API serialized an IFC model. */
  saveCount: number;

  /** Number of times this isolated API was disposed. */
  disposeCount: number;
}

/**
 * Creates a deterministic web-ifc API used to test parse-write-reparse logic.
 *
 * @param options Values returned by schema, entity, save, and open operations.
 * @returns Minimal API port with observable operation counters.
 */
const createFakeIfcApi = (options: FakeIfcApiOptions): FakeIfcApiState => {
  /** Current fake model-open state retained by the returned method closures. */
  let open = false;
  return {
    openCount: 0,
    saveCount: 0,
    disposeCount: 0,
    SetWasmPath: () => {},
    Init: async () => {},
    OpenModel() {
      this.openCount += 1;
      open = options.opens !== false;
      return open ? 1 : -1;
    },
    IsModelOpen: () => open,
    GetModelSchema: () => options.schema ?? "IFC4",
    GetAllLines: () => ({ size: () => options.lineCount ?? 10 }),
    SaveModel() {
      this.saveCount += 1;
      return options.savedBytes ?? rewrittenBytes;
    },
    CloseModel: () => {
      open = false;
    },
    Dispose() {
      this.disposeCount += 1;
    },
  };
};

/** Verifies source registration and successful download-ready export results. */
test("IFC export service rewrites retained direct-IFC source bytes", async () => {
  const registry = new IfcSourceModelRegistry();
  const codec = new RecordingStructuralCodec();
  registry.register({
    modelId: "building-model",
    fileName: "building.ifc",
    bytes: sourceBytes,
  });
  const service = new IfcModelExportService(registry, codec);

  const result = await service.exportModel("building-model");

  assert.deepEqual(codec.inputs, [sourceBytes]);
  assert.equal(result.fileName, "building-export.ifc");
  assert.equal(result.schema, "IFC4");
  assert.equal(result.bytes, rewrittenBytes);
  assert.equal(result.missionCount, 0);
});

/** Verifies internal missions are mapped and routed through mission-aware writing. */
test("IFC export service includes current robot missions", async () => {
  const registry = new IfcSourceModelRegistry();
  const codec = new RecordingStructuralCodec();
  registry.register({
    modelId: "building-model",
    fileName: "building.ifc",
    bytes: sourceBytes,
  });
  const timestamp = "2026-01-01T00:00:00.000Z";
  const task = createRobotTask(
    {
      id: "navigate",
      name: "Navigate to room",
      actionType: "NAVIGATE_TO",
      targetObjects: [{ globalId: "room-global-id" }],
    },
    timestamp,
  );
  const mission = addTaskToMission(
    createRobotMission({ id: "mission", name: "Room mission" }, timestamp),
    task,
    timestamp,
  );
  const service = new IfcModelExportService(registry, codec);

  const result = await service.exportModel("building-model", {
    missions: [mission],
  });

  assert.equal(result.missionCount, 1);
  assert.equal(codec.missionInputs.length, 1);
  assert.equal(codec.missionInputs[0].sourceModelId, "building-model");
  assert.deepEqual(codec.missionInputs[0].missions, [mission]);
  assert.equal(codec.missionInputs[0].graphs[0].missionId, mission.id);
  assert.ok(
    codec.missionInputs[0].graphs[0].records.some(
      (record) => record.entity === "IfcTask" && record.sourceId === task.id,
    ),
  );
});

/** An explicitly supplied empty collection authoritatively removes annotations. */
test("IFC export service forwards an empty authoritative mission collection", async () => {
  const registry = new IfcSourceModelRegistry();
  const codec = new RecordingStructuralCodec();
  registry.register({
    modelId: "building-model",
    fileName: "building.ifc",
    bytes: sourceBytes,
  });
  const service = new IfcModelExportService(registry, codec);

  const result = await service.exportModel("building-model", { missions: [] });

  assert.equal(result.missionCount, 0);
  assert.equal(codec.missionInputs.length, 1);
  assert.deepEqual(codec.missionInputs[0].missions, []);
  assert.deepEqual(codec.missionInputs[0].graphs, []);
});

/** An absent optional value must never be interpreted as destructive intent. */
test("IFC export service does not delete missions for an undefined optional collection", async () => {
  const registry = new IfcSourceModelRegistry();
  const codec = new RecordingStructuralCodec();
  registry.register({
    modelId: "building-model",
    fileName: "building.ifc",
    bytes: sourceBytes,
  });
  const service = new IfcModelExportService(registry, codec);

  await service.exportModel("building-model", { missions: undefined });

  assert.deepEqual(codec.inputs, [sourceBytes]);
  assert.deepEqual(codec.missionInputs, []);
});

/** Verifies that fragment-only models cannot produce misleading IFC downloads. */
test("IFC export service rejects models without retained IFC source", async () => {
  const service = new IfcModelExportService(
    new IfcSourceModelRegistry(),
    new RecordingStructuralCodec(),
  );

  await assert.rejects(
    () => service.exportModel("fragment-only-model"),
    IfcModelExportError,
  );
});

/** Verifies that unsupported Fragments edits are rejected before serialization. */
test("IFC export service rejects structural Fragments changes", async () => {
  const registry = new IfcSourceModelRegistry();
  const codec = new RecordingStructuralCodec();
  registry.register({
    modelId: "changed-model",
    fileName: "changed.ifc",
    bytes: sourceBytes,
  });
  registry.markStructurallyChanged("changed-model");
  const service = new IfcModelExportService(registry, codec);

  await assert.rejects(
    () => service.exportModel("changed-model"),
    /structural edits/i,
  );
  assert.equal(codec.inputs.length, 0);
});

/** Verifies the required parse-write-reparse structural validation sequence. */
test("web-ifc codec reparses serialized output before returning it", async () => {
  const firstPass = createFakeIfcApi({ savedBytes: rewrittenBytes });
  const verificationPass = createFakeIfcApi({});
  const apis = [firstPass, verificationPass];
  const codec = new WebIfcStructuralCodec({
    wasmPath: "/wasm/",
    createApi: () => apis.shift() as FakeIfcApiState,
  });

  const result = await codec.rewriteAndValidate(sourceBytes);

  assert.equal(result.schema, "IFC4");
  assert.equal(result.bytes, rewrittenBytes);
  assert.equal(firstPass.openCount, 1);
  assert.equal(firstPass.saveCount, 1);
  assert.equal(verificationPass.openCount, 1);
  assert.equal(verificationPass.saveCount, 0);
  assert.equal(firstPass.disposeCount, 1);
  assert.equal(verificationPass.disposeCount, 1);
});

/** Verifies that schema drift between serialization passes aborts the export. */
test("web-ifc codec rejects schema drift in rewritten IFC output", async () => {
  const apis = [
    createFakeIfcApi({ schema: "IFC4", savedBytes: rewrittenBytes }),
    createFakeIfcApi({ schema: "IFC2X3" }),
  ];
  const codec = new WebIfcStructuralCodec({
    wasmPath: "/wasm/",
    createApi: () => apis.shift() as FakeIfcApiState,
  });

  await assert.rejects(
    () => codec.rewriteAndValidate(sourceBytes),
    /schema changed/i,
  );
});
