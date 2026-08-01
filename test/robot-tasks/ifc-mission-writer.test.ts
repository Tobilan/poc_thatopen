import assert from "node:assert/strict";
import test from "node:test";
import {
  IFCGLOBALLYUNIQUEID,
  IFCOBJECTDEFINITION,
  IFCOWNERHISTORY,
  IFCPRODUCT,
  IFCPROJECT,
  IFCRELSEQUENCE,
  IFCROOT,
  IFCTASK,
  IFCTASKTIME,
  IFCTYPEPRODUCT,
} from "web-ifc";
import type { IfcLineObject } from "web-ifc";
import type {
  IfcExternalObjectReference,
  IfcRobotMissionRecordGraph,
} from "../../src/ifc/robot-tasks";
import { IfcModelExportError } from "../../src/ifc/model-export/ifcModelExportError";
import { normalizeMissionIfcSchema } from "../../src/ifc/model-export/ifcSchemaAdapter";
import {
  WebIfcMissionWriter,
  type IfcIdVectorPort,
  type IfcMissionWriterApiPort,
} from "../../src/ifc/model-export/webIfcMissionWriter";

/** Runtime model identifier used to scope express-ID-only object references. */
const sourceModelId = "source-model";

/** Creates a small immutable vector matching web-ifc's ID query result. */
const fakeIdVector = (ids: readonly number[]): IfcIdVectorPort => ({
  /** @returns Number of IDs contained in this fake vector. */
  size: () => ids.length,

  /** @returns ID at the requested zero-based position. */
  get: (index: number) => ids[index],
});

/** Configurable source-model facts used by the focused writer test double. */
interface FakeWriterApiOptions {
  /** Mapping exposed by web-ifc's GlobalId index. */
  guidExpressIds?: Readonly<Record<string, number>>;

  /** IDs accepted by IfcRelAssignsToProcess. */
  objectDefinitionIds?: readonly number[];

  /** Product IDs accepted by IfcRelAssignsToProduct. */
  productIds?: readonly number[];

  /** Type-product IDs accepted by IfcRelAssignsToProduct. */
  typeProductIds?: readonly number[];

  /** Numeric entity types of existing source lines used for identity checks. */
  sourceLineTypes?: Readonly<Record<number, number>>;
}

/**
 * Minimal in-memory implementation of the web-ifc operations used by the writer.
 *
 * It deliberately records writes so negative tests can prove that every source
 * object is resolved and type-checked before the generated IFC graph is mutated.
 */
class FakeWriterApi implements IfcMissionWriterApiPort {
  /** Generated line objects passed to web-ifc's mutating WriteLine operation. */
  readonly writtenLines: IfcLineObject[] = [];

  /** Number of times the source GlobalId index was requested. */
  guidMappingBuilds = 0;

  /** Counter used to return unique deterministic generated IFC GlobalIds. */
  private generatedGuid = 0;

  /** Source-model configuration returned by query methods. */
  constructor(private readonly options: FakeWriterApiOptions = {}) {}

  /** Records creation of the GUID lookup index. */
  CreateIfcGuidToExpressIdMapping(): void {
    this.guidMappingBuilds += 1;
  }

  /** Resolves a configured durable GlobalId, matching web-ifc's API shape. */
  GetExpressIdFromGuid(
    _modelID: number,
    guid: string,
  ): string | number | undefined {
    return this.options.guidExpressIds?.[guid];
  }

  /** Returns configured subtype-compatible ID sets for writer preflight. */
  GetLineIDsWithType(
    _modelID: number,
    type: number,
    _includeInherited?: boolean,
  ): IfcIdVectorPort {
    if (type === IFCOBJECTDEFINITION) {
      return fakeIdVector(this.options.objectDefinitionIds ?? []);
    }
    if (type === IFCPRODUCT) {
      return fakeIdVector(this.options.productIds ?? []);
    }
    if (type === IFCTYPEPRODUCT) {
      return fakeIdVector(this.options.typeProductIds ?? []);
    }
    if (type === IFCROOT) {
      return fakeIdVector([
        ...new Set(Object.values(this.options.guidExpressIds ?? {})),
      ]);
    }
    if (type === IFCPROJECT || type === IFCOWNERHISTORY) {
      return fakeIdVector([]);
    }
    return fakeIdVector([]);
  }

  /** No existing parsed line is needed by these focused write tests. */
  GetLine(_modelID: number, expressID: number): unknown {
    const globalId = Object.entries(this.options.guidExpressIds ?? {}).find(
      ([, candidateExpressId]) => candidateExpressId === expressID,
    )?.[0];
    return globalId ? { GlobalId: { value: globalId } } : undefined;
  }

  /** Returns configured existing-line types for preserved identity checks. */
  GetLineType(_modelID: number, expressID: number): number {
    return this.options.sourceLineTypes?.[expressID] ?? 0;
  }

  /** Leaves ample source-ID space before deterministic generated records. */
  GetMaxExpressID(): number {
    return 1000;
  }

  /** Returns the requested candidate because the fake source has no collisions. */
  GetNextExpressID(_modelID: number, expressID: number): number {
    return expressID;
  }

  /** Returns a unique stable value accepted by generated schema constructors. */
  CreateIFCGloballyUniqueId(): unknown {
    this.generatedGuid += 1;
    return `generated-guid-${this.generatedGuid}`;
  }

  /** Wraps a supplied primitive exactly like web-ifc's typed-value factory. */
  CreateIfcType(_modelID: number, type: number, entry: unknown): unknown {
    return { type, value: entry };
  }

  /** Records each mutation so atomic preflight behavior can be asserted. */
  WriteLine<Type extends IfcLineObject>(
    _modelID: number,
    lineObject: Type,
  ): void {
    this.writtenLines.push(lineObject);
  }
}

/** Reference to the sole generated task in focused assignment graphs. */
const taskReference = { entity: "IfcTask", id: "task" } as const;

/** Creates the generated task record needed by an assignment relationship. */
const taskRecord = {
  entity: "IfcTask",
  id: taskReference.id,
  sourceId: "domain-task",
  role: "EXECUTABLE_TASK",
  name: "Resolve source object",
  identification: "domain-task",
  objectType: "RobotTask",
  predefinedType: "USERDEFINED",
} as const;

/** Creates a minimal graph containing one process assignment to source objects. */
const processGraph = (
  ...references: IfcExternalObjectReference[]
): IfcRobotMissionRecordGraph => ({
  missionId: "mission",
  rootTask: taskReference,
  records: [
    taskRecord,
    {
      entity: "IfcRelAssignsToProcess",
      id: "process-assignment",
      name: "OPERATES_ON",
      relatingProcess: taskReference,
      relatedObjects: references,
    },
  ],
});

/** Creates a minimal graph containing one MOVE_TO product assignment. */
const productGraph = (
  reference: IfcExternalObjectReference,
): IfcRobotMissionRecordGraph => ({
  missionId: "mission",
  rootTask: taskReference,
  records: [
    taskRecord,
    {
      entity: "IfcRelAssignsToProduct",
      id: "product-assignment",
      name: "MOVE_TO",
      relatedObjects: [taskReference],
      relatingProduct: reference,
    },
  ],
});

/** IFC4 remains in the IFC4 constructor family after whitespace normalization. */
test("schema adapter normalizes IFC4", () => {
  assert.equal(normalizeMissionIfcSchema("  ifc4  "), "IFC4");
});

/** Published IFC 4.3 and its supported addenda share the IFC4X3 namespace. */
test("schema adapter normalizes IFC4X3 header aliases", () => {
  for (const schema of ["IFC4X3", "IFC4X3_ADD1", "IFC4X3_ADD2"]) {
    assert.equal(normalizeMissionIfcSchema(schema), "IFC4X3");
  }
});

/** The mission writer intentionally does not attempt an IFC2X3 conversion. */
test("schema adapter rejects IFC2X3", () => {
  assert.throws(
    () => normalizeMissionIfcSchema("IFC2X3"),
    (error: unknown) =>
      error instanceof IfcModelExportError &&
      /supports IFC4 and IFC4X3 only/i.test(error.message),
  );
});

/** Existing application-owned roots retain their source GlobalId on recreation. */
test("writer preserves a supplied GlobalId after verifying its source identity", () => {
  const preservedGlobalId = "1JYq5jWRT1jBq_L0X1v2w3";
  const sourceExpressId = 77;
  const api = new FakeWriterApi({
    guidExpressIds: { [preservedGlobalId]: sourceExpressId },
    sourceLineTypes: { [sourceExpressId]: IFCTASK },
  });
  const graph: IfcRobotMissionRecordGraph = {
    missionId: "mission",
    rootTask: taskReference,
    records: [taskRecord],
  };

  const manifest = new WebIfcMissionWriter().write(
    api,
    7,
    sourceModelId,
    graph,
    "IFC4",
    {
      preservedGlobalIds: new Map([
        [
          taskRecord.id,
          { globalId: preservedGlobalId, expressId: sourceExpressId },
        ],
      ]),
    },
  );

  const writtenTask = api.writtenLines.find((line) => line.type === IFCTASK) as
    | { GlobalId?: { type?: number; value?: string } }
    | undefined;
  assert.deepEqual(writtenTask?.GlobalId, {
    type: IFCGLOBALLYUNIQUEID,
    value: preservedGlobalId,
  });
  assert.equal(manifest.entries[0].globalId, preservedGlobalId);
});

/** A provenance claim must resolve to its exact existing source line. */
test("writer rejects a preserved GlobalId with a mismatched source express ID", () => {
  const preservedGlobalId = "1JYq5jWRT1jBq_L0X1v2w3";
  const api = new FakeWriterApi({
    guidExpressIds: { [preservedGlobalId]: 77 },
    sourceLineTypes: { 77: IFCTASK },
  });
  const graph: IfcRobotMissionRecordGraph = {
    missionId: "mission",
    rootTask: taskReference,
    records: [taskRecord],
  };

  assert.throws(
    () =>
      new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4", {
        preservedGlobalIds: new Map([
          [taskRecord.id, { globalId: preservedGlobalId, expressId: 78 }],
        ]),
      }),
    /does not resolve to source entity #78/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** One persistent IFC identity cannot be claimed by two graph records. */
test("writer rejects duplicate preserved GlobalId claims", () => {
  const preservedGlobalId = "1JYq5jWRT1jBq_L0X1v2w3";
  const sourceExpressId = 77;
  const secondTask = {
    ...taskRecord,
    id: "second-task",
    sourceId: "second-domain-task",
    identification: "second-domain-task",
  };
  const api = new FakeWriterApi({
    guidExpressIds: { [preservedGlobalId]: sourceExpressId },
    sourceLineTypes: { [sourceExpressId]: IFCTASK },
  });
  const graph: IfcRobotMissionRecordGraph = {
    missionId: "mission",
    rootTask: taskReference,
    records: [taskRecord, secondTask],
  };
  const preserved = {
    globalId: preservedGlobalId,
    expressId: sourceExpressId,
  };

  assert.throws(
    () =>
      new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4", {
        preservedGlobalIds: new Map([
          [taskRecord.id, preserved],
          [secondTask.id, preserved],
        ]),
      }),
    /claimed by more than one mission record/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** The stable domain sequence ID is serialized in IfcRelSequence.Name. */
test("writer stores the domain sequence ID in IfcRelSequence.Name", () => {
  const successorReference = { entity: "IfcTask", id: "successor" } as const;
  const graph: IfcRobotMissionRecordGraph = {
    missionId: "mission",
    rootTask: taskReference,
    records: [
      taskRecord,
      {
        ...taskRecord,
        id: successorReference.id,
        sourceId: "successor-domain-task",
        identification: "successor-domain-task",
      },
      {
        entity: "IfcRelSequence",
        id: "sequence-relation",
        sourceId: "domain-sequence-id",
        relatingProcess: taskReference,
        relatedProcess: successorReference,
        sequenceType: "START_START",
      },
    ],
  };
  const api = new FakeWriterApi();

  new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4X3");

  const sequence = api.writtenLines.find(
    (line) => line.type === IFCRELSEQUENCE,
  ) as { Name?: { value?: string } } | undefined;
  assert.equal(sequence?.Name?.value, "domain-sequence-id");
});

/** A GlobalId can resolve an object even when it came from another runtime model. */
test("writer prefers GlobalId and accepts a matching object from another runtime model", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "door-guid": 41 },
    objectDefinitionIds: [41],
  });
  const graph = processGraph({
    kind: "IfcObjectReference",
    globalId: "door-guid",
    modelId: "other-runtime-model",
    expressId: 999,
  });

  const manifest = new WebIfcMissionWriter().write(
    api,
    7,
    sourceModelId,
    graph,
    "IFC4",
  );

  assert.deepEqual(manifest.externalExpressIds.get("process-assignment"), [41]);
  assert.equal(api.writtenLines.length, graph.records.length);
  assert.equal(api.guidMappingBuilds, 1);
});

/** A model-local express ID remains a valid fallback for its exact source model. */
test("writer accepts expressID-only references from the exported source model", () => {
  const api = new FakeWriterApi({ objectDefinitionIds: [42] });
  const graph = processGraph({
    kind: "IfcObjectReference",
    modelId: sourceModelId,
    expressId: 42,
  });

  const manifest = new WebIfcMissionWriter().write(
    api,
    7,
    sourceModelId,
    graph,
    "IFC4X3",
  );

  assert.deepEqual(manifest.externalExpressIds.get("process-assignment"), [42]);
  assert.equal(api.writtenLines.length, graph.records.length);
});

/** Conflicting durable and local identities in the same source are ambiguous. */
test("writer rejects conflicting GlobalId and expressID before writing", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "door-guid": 41 },
    objectDefinitionIds: [41, 42],
  });
  const graph = processGraph({
    kind: "IfcObjectReference",
    globalId: "door-guid",
    modelId: sourceModelId,
    expressId: 42,
  });

  assert.throws(
    () => new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4"),
    /resolves to #41, not stored #42/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** Local IDs cannot be interpreted outside the direct source model that owns them. */
test("writer rejects expressID-only references from another runtime model", () => {
  const api = new FakeWriterApi({ objectDefinitionIds: [42] });
  const graph = processGraph({
    kind: "IfcObjectReference",
    modelId: "different-model",
    expressId: 42,
  });

  assert.throws(
    () => new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4"),
    /not present in the selected source IFC/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** A GUID that is absent from the selected source prevents the whole export. */
test("writer rejects unresolved GlobalIds atomically", () => {
  const graph = processGraph(
    {
      kind: "IfcObjectReference",
      globalId: "existing-guid",
      modelId: sourceModelId,
      expressId: 41,
    },
    {
      kind: "IfcObjectReference",
      globalId: "missing-guid",
    },
  );
  const configuredApi = new FakeWriterApi({
    guidExpressIds: { "existing-guid": 41 },
    objectDefinitionIds: [41],
  });

  assert.throws(
    () =>
      new WebIfcMissionWriter().write(
        configuredApi,
        7,
        sourceModelId,
        graph,
        "IFC4",
      ),
    /missing-guid.*not present/i,
  );
  assert.equal(configuredApi.writtenLines.length, 0);
});

/** Process assignments reject entities outside IfcObjectDefinition's select. */
test("writer rejects process-assignment references with incompatible IFC types", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "material-guid": 61 },
    productIds: [61],
  });
  const graph = processGraph({
    kind: "IfcObjectReference",
    globalId: "material-guid",
  });

  assert.throws(
    () => new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4"),
    /incompatible with this relation/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** MOVE_TO accepts IfcTypeProduct in addition to ordinary IfcProduct instances. */
test("writer accepts an IfcTypeProduct as MOVE_TO destination", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "destination-guid": 71 },
    typeProductIds: [71],
  });
  const graph = productGraph({
    kind: "IfcObjectReference",
    globalId: "destination-guid",
  });

  const manifest = new WebIfcMissionWriter().write(
    api,
    7,
    sourceModelId,
    graph,
    "IFC4X3",
  );

  assert.deepEqual(manifest.externalExpressIds.get("product-assignment"), [71]);
  assert.equal(api.writtenLines.length, graph.records.length);
});

/** MOVE_TO rejects an object definition that is neither product select variant. */
test("writer rejects non-product MOVE_TO destinations before writing", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "destination-guid": 72 },
    objectDefinitionIds: [72],
  });
  const graph = productGraph({
    kind: "IfcObjectReference",
    globalId: "destination-guid",
  });

  assert.throws(
    () =>
      new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4X3"),
    /incompatible with this relation/i,
  );
  assert.equal(api.writtenLines.length, 0);
});

/** Duplicate domain references collapse to one value in IFC SET attributes. */
test("writer deduplicates source objects that resolve to the same express ID", () => {
  const api = new FakeWriterApi({
    guidExpressIds: { "door-guid": 41 },
    objectDefinitionIds: [41],
  });
  const reference = {
    kind: "IfcObjectReference",
    globalId: "door-guid",
  } as const;

  const manifest = new WebIfcMissionWriter().write(
    api,
    7,
    sourceModelId,
    processGraph(reference, reference),
    "IFC4",
  );

  assert.deepEqual(manifest.externalExpressIds.get("process-assignment"), [41]);
});

/** Browser datetime-local values gain the seconds required by IfcDateTime. */
test("writer normalizes minute-precision task times before writing", () => {
  const api = new FakeWriterApi();
  const graph: IfcRobotMissionRecordGraph = {
    missionId: "mission",
    rootTask: taskReference,
    records: [
      {
        entity: "IfcTaskTime",
        id: "task-time",
        sourceTaskId: "domain-task",
        scheduleStart: "2026-01-01T08:30",
      },
      { ...taskRecord, taskTime: { entity: "IfcTaskTime", id: "task-time" } },
    ],
  };

  new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4X3");

  const taskTime = api.writtenLines.find(
    (line) => line.type === IFCTASKTIME,
  ) as { ScheduleStart?: { value?: string } } | undefined;
  assert.equal(taskTime?.ScheduleStart?.value, "2026-01-01T08:30:00");
});

/** Invalid IFC temporal lexical values are rejected before source mutation. */
test("writer rejects malformed task times and durations atomically", () => {
  for (const invalidRecord of [
    {
      entity: "IfcTaskTime",
      id: "invalid-date",
      sourceTaskId: "domain-task",
      scheduleStart: "2026-02-30T08:30",
    },
    {
      entity: "IfcTaskTime",
      id: "invalid-duration",
      sourceTaskId: "domain-task",
      scheduleDuration: "ten minutes",
    },
  ] as const) {
    const api = new FakeWriterApi();
    const graph: IfcRobotMissionRecordGraph = {
      missionId: "mission",
      rootTask: taskReference,
      records: [taskRecord, invalidRecord],
    };

    assert.throws(
      () =>
        new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4"),
      /ISO 8601/i,
    );
    assert.equal(api.writtenLines.length, 0);
  }
});

/** IFC labels/identifiers and real values are checked beyond domain validation. */
test("writer rejects overlong labels and non-finite coordinate values", () => {
  const invalidGraphs: IfcRobotMissionRecordGraph[] = [
    {
      missionId: "mission",
      rootTask: taskReference,
      records: [{ ...taskRecord, name: "x".repeat(256) }],
    },
    {
      missionId: "mission",
      rootTask: taskReference,
      records: [
        taskRecord,
        {
          entity: "IfcPropertyListValue",
          id: "invalid-coordinates",
          name: "CameraPosition",
          listValues: [0, Number.POSITIVE_INFINITY, 2],
        },
      ],
    },
  ];

  for (const graph of invalidGraphs) {
    const api = new FakeWriterApi();
    assert.throws(
      () =>
        new WebIfcMissionWriter().write(api, 7, sourceModelId, graph, "IFC4"),
      /255 characters|finite/i,
    );
    assert.equal(api.writtenLines.length, 0);
  }
});
