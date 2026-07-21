import {
  Handle,
  IFCOBJECTDEFINITION,
  IFCOWNERHISTORY,
  IFCPRODUCT,
  IFCPROJECT,
  IFCPROPERTYLISTVALUE,
  IFCPROPERTYSET,
  IFCPROPERTYSINGLEVALUE,
  IFCRELASSIGNSTOCONTROL,
  IFCRELASSIGNSTOPROCESS,
  IFCRELASSIGNSTOPRODUCT,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELNESTS,
  IFCRELSEQUENCE,
  IFCROOT,
  IFCTASK,
  IFCTASKTIME,
  IFCTYPEPRODUCT,
  IFCWORKSCHEDULE,
} from "web-ifc";
import type { IfcLineObject } from "web-ifc";
import type {
  IfcExternalObjectReference,
  IfcRecordReference,
  IfcRobotMissionRecordGraph,
  IfcRobotTaskRecord,
  IfcRobotTaskRecordEntity,
} from "../robot-tasks";
import { IfcModelExportError } from "./ifcModelExportError";
import {
  getMissionIfcSchemaNamespace,
  type SupportedMissionIfcSchema,
} from "./ifcSchemaAdapter";

/** Minimal numeric vector returned by web-ifc entity queries. */
export interface IfcIdVectorPort {
  /** @returns Number of express IDs in the vector. */
  size(): number;

  /** @returns Express ID stored at one zero-based vector position. */
  get(index: number): number;
}

/** web-ifc operations required while resolving and writing mission records. */
export interface IfcMissionWriterApiPort {
  /** Builds the GlobalId-to-express-ID index for the currently open model. */
  CreateIfcGuidToExpressIdMapping(modelID: number): void;

  /** Resolves one GlobalId through the previously created model index. */
  GetExpressIdFromGuid(
    modelID: number,
    guid: string,
  ): string | number | undefined;

  /** Returns entity IDs of one type, optionally including every subtype. */
  GetLineIDsWithType(
    modelID: number,
    type: number,
    includeInherited?: boolean,
  ): IfcIdVectorPort;

  /** Reads one parsed IFC entity without flattening its references. */
  GetLine(modelID: number, expressID: number, flatten?: boolean): unknown;

  /** Returns the numeric IFC entity type for one express ID. */
  GetLineType(modelID: number, expressID: number): number;

  /** @returns Highest express ID currently present in the open model. */
  GetMaxExpressID(modelID: number): number;

  /** Creates a valid schema-specific 22-character IFC GlobalId value. */
  CreateIFCGloballyUniqueId(modelID: number): unknown;

  /** Inserts one new line with its preallocated express ID into the model. */
  WriteLine<Type extends IfcLineObject>(
    modelID: number,
    lineObject: Type,
  ): void;
}

/** One generated record retained for the independent verification pass. */
export interface IfcMissionWriteEntry {
  /** Graph-local record identity. */
  recordId: string;

  /** IFC-like discriminator expected after the file is reopened. */
  entity: IfcRobotTaskRecordEntity;

  /** Newly allocated source-independent express ID. */
  expressId: number;

  /** Numeric web-ifc entity type expected at expressId. */
  type: number;

  /** Generated GlobalId for IfcRoot records. */
  globalId?: string;
}

/** Manifest connecting graph records and resolved source objects to STEP lines. */
export interface IfcMissionWriteManifest {
  /** Generated records in deterministic graph order. */
  entries: IfcMissionWriteEntry[];

  /** Resolved external express IDs grouped by owning assignment record. */
  externalExpressIds: Map<string, number[]>;
}

/** Internal namespace shape shared by generated IFC4 and IFC4X3 constructors. */
type IfcRuntimeNamespace = Record<string, any>;

/** Supported graph discriminator to web-ifc entity-code mapping. */
const RECORD_TYPE_CODES: Record<IfcRobotTaskRecordEntity, number> = {
  IfcTask: IFCTASK,
  IfcTaskTime: IFCTASKTIME,
  IfcWorkSchedule: IFCWORKSCHEDULE,
  IfcRelNests: IFCRELNESTS,
  IfcRelSequence: IFCRELSEQUENCE,
  IfcRelAssignsToProcess: IFCRELASSIGNSTOPROCESS,
  IfcRelAssignsToProduct: IFCRELASSIGNSTOPRODUCT,
  IfcRelAssignsToControl: IFCRELASSIGNSTOCONTROL,
  IfcRelDefinesByProperties: IFCRELDEFINESBYPROPERTIES,
  IfcPropertySet: IFCPROPERTYSET,
  IfcPropertySingleValue: IFCPROPERTYSINGLEVALUE,
  IfcPropertyListValue: IFCPROPERTYLISTVALUE,
};

/** Entity kinds derived from IfcRoot and therefore requiring a GlobalId. */
const ROOT_RECORD_ENTITIES = new Set<IfcRobotTaskRecordEntity>([
  "IfcTask",
  "IfcWorkSchedule",
  "IfcRelNests",
  "IfcRelSequence",
  "IfcRelAssignsToProcess",
  "IfcRelAssignsToProduct",
  "IfcRelAssignsToControl",
  "IfcRelDefinesByProperties",
  "IfcPropertySet",
]);

/** Dependency-safe order used for both ID allocation and line insertion. */
const RECORD_WRITE_ORDER: IfcRobotTaskRecordEntity[][] = [
  ["IfcPropertySingleValue", "IfcPropertyListValue", "IfcTaskTime"],
  ["IfcTask", "IfcWorkSchedule"],
  ["IfcPropertySet"],
  [
    "IfcRelNests",
    "IfcRelSequence",
    "IfcRelAssignsToProcess",
    "IfcRelAssignsToProduct",
    "IfcRelAssignsToControl",
    "IfcRelDefinesByProperties",
  ],
];

/** ISO 8601 timestamp parts accepted from APIs and datetime-local controls. */
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** ISO 8601 duration subset accepted by IFC scheduling values. */
const ISO_DURATION =
  /^P(?=\d|T\d)(?:\d+(?:\.\d+)?Y)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?W)?(?:\d+(?:\.\d+)?D)?(?:T(?=\d)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/;

/** Converts a web-ifc vector into a set suitable for repeated subtype checks. */
const vectorToSet = (vector: IfcIdVectorPort): Set<number> => {
  const result = new Set<number>();
  for (let index = 0; index < vector.size(); index += 1) {
    result.add(vector.get(index));
  }
  return result;
};

/** Reads the scalar payload from a web-ifc value wrapper or returns the value. */
const wrappedValue = (value: any): unknown =>
  value && typeof value === "object" && "value" in value ? value.value : value;

/** Normalizes absent STEP optionals to the domain's undefined convention. */
const optionalWrappedValue = (value: any): unknown =>
  value === null || value === undefined ? undefined : wrappedValue(value);

/** Converts a reference wrapper into a numeric express ID. */
const handleValue = (value: any): number | undefined => {
  const candidate = Number(wrappedValue(value));
  return Number.isInteger(candidate) && candidate > 0 ? candidate : undefined;
};

/** Converts an array of web-ifc handles into plain express IDs. */
const handleValues = (values: any): number[] =>
  Array.isArray(values)
    ? values
        .map(handleValue)
        .filter((value): value is number => value !== undefined)
    : [];

/** Raises an export-specific error when two primitive or array values differ. */
const assertEquivalent = (
  actual: unknown,
  expected: unknown,
  context: string,
): void => {
  let comparableActual = actual;
  if (typeof expected === "number" && typeof actual === "string") {
    const numericActual = Number(actual);
    if (Number.isFinite(numericActual)) comparableActual = numericActual;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    comparableActual = actual.map((value, index) => {
      const expectedValue = expected[index];
      if (typeof expectedValue !== "number" || typeof value !== "string") {
        return value;
      }
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : value;
    });
  }
  if (JSON.stringify(comparableActual) !== JSON.stringify(expected)) {
    throw new IfcModelExportError(
      `Generated IFC verification failed for ${context}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
};

/** Ensures one label or identifier respects IFC's 255-character bound. */
const validBoundedString = (value: string, context: string): string => {
  if (value.length > 255) {
    throw new IfcModelExportError(
      `${context} exceeds the IFC limit of 255 characters.`,
    );
  }
  return value;
};

/**
 * Validates and normalizes one domain timestamp for IfcDateTime.
 *
 * Browser datetime-local controls commonly omit seconds. IFC requires them, so
 * a semantically equivalent `:00` is appended without changing the time zone.
 */
const validDateTime = (value: string, context: string): string => {
  const match = value.match(ISO_DATE_TIME);
  if (!match) {
    throw new IfcModelExportError(
      `${context} must be a valid ISO 8601 date-time value.`,
    );
  }
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const maximumDay = new Date(
    Date.UTC(Number(year), numericMonth, 0),
  ).getUTCDate();
  const zoneParts = zone?.match(/^([+-])(\d{2}):(\d{2})$/);
  const zoneHour = zoneParts ? Number(zoneParts[2]) : 0;
  const zoneMinute = zoneParts ? Number(zoneParts[3]) : 0;
  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    numericDay > maximumDay ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second ?? "00") > 59 ||
    zoneHour > 14 ||
    zoneMinute > 59 ||
    (zoneHour === 14 && zoneMinute !== 0)
  ) {
    throw new IfcModelExportError(
      `${context} must be a valid ISO 8601 date-time value.`,
    );
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}${fraction ?? ""}${zone ?? ""}`;
};

/** Ensures one domain duration can be represented by IfcDuration. */
const validDuration = (value: string, context: string): string => {
  if (!ISO_DURATION.test(value)) {
    throw new IfcModelExportError(
      `${context} must be a valid non-negative ISO 8601 duration.`,
    );
  }
  return value;
};

/** Returns the exact primitive value that will be emitted for one property. */
const serializedPropertyValue = (
  name: string,
  value: string | number | boolean,
): string | number | boolean => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new IfcModelExportError(`${name} must contain a finite number.`);
  }
  if (
    typeof value === "string" &&
    (name === "CreatedAt" || name === "UpdatedAt")
  ) {
    return validDateTime(value, name);
  }
  return value;
};

/** Returns a readable stable identity for an external object error message. */
const externalReferenceLabel = (
  reference: IfcExternalObjectReference,
): string =>
  reference.globalId ??
  `${reference.modelId ?? "unknown-model"}#${reference.expressId ?? "unknown"}`;

/** Verifies and normalizes an express ID returned by web-ifc. */
const resolvedExpressId = (
  value: string | number | undefined,
): number | undefined => {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0
    ? normalized
    : undefined;
};

/**
 * Writes and later verifies a complete schema-independent mission graph.
 *
 * The writer never reads domain services or viewer state. All source-object
 * references are resolved before the first new line is inserted, making a
 * failed export atomic from the caller's perspective.
 */
export class WebIfcMissionWriter {
  /**
   * Resolves external objects and writes every record into one open IFC model.
   *
   * @param api Initialized web-ifc API containing the open source model.
   * @param modelId Temporary numeric web-ifc model handle.
   * @param sourceModelId Runtime model ID that scopes express-ID fallbacks.
   * @param graph Complete mission record graph produced by the pure mapper.
   * @param schema Canonical constructor family selected from the source schema.
   * @returns Manifest required to verify the independently reopened output.
   */
  write(
    api: IfcMissionWriterApiPort,
    modelId: number,
    sourceModelId: string,
    graph: IfcRobotMissionRecordGraph,
    schema: SupportedMissionIfcSchema,
  ): IfcMissionWriteManifest {
    this.preflightGraph(graph);
    const recordsById = new Map<string, IfcRobotTaskRecord>();
    for (const record of graph.records) {
      if (recordsById.has(record.id)) {
        throw new IfcModelExportError(
          `Mission graph contains duplicate record ID ${record.id}.`,
        );
      }
      recordsById.set(record.id, record);
    }

    const sourceGuidExpressIds = this.buildGlobalIdIndex(api, modelId);
    const externalExpressIds = this.resolveExternalObjects(
      api,
      modelId,
      sourceModelId,
      graph,
      sourceGuidExpressIds,
    );
    const recordExpressIds = this.allocateExpressIds(api, modelId, graph);
    const runtime = getMissionIfcSchemaNamespace(
      schema,
    ) as unknown as IfcRuntimeNamespace;
    const ownerHistory = this.findOwnerHistory(api, modelId);
    const globalIds = new Map<string, unknown>();
    const globalIdStrings = new Set<string>();

    for (const record of graph.records) {
      if (!ROOT_RECORD_ENTITIES.has(record.entity)) continue;
      const globalId = api.CreateIFCGloballyUniqueId(modelId);
      const value = String(wrappedValue(globalId) ?? "");
      const existingExpressId = value
        ? sourceGuidExpressIds.get(value)
        : undefined;
      if (!value || globalIdStrings.has(value) || existingExpressId) {
        throw new IfcModelExportError(
          "web-ifc did not produce source-wide unique GlobalIds for generated mission records.",
        );
      }
      globalIdStrings.add(value);
      globalIds.set(record.id, globalId);
    }

    const entriesById = new Map<string, IfcMissionWriteEntry>();

    for (const group of RECORD_WRITE_ORDER) {
      for (const record of graph.records) {
        if (!group.includes(record.entity)) continue;
        const line = this.createLine(
          runtime,
          record,
          ownerHistory,
          globalIds,
          recordExpressIds,
          recordsById,
          externalExpressIds,
        );
        const expressId = recordExpressIds.get(record.id)!;
        line.expressID = expressId;
        api.WriteLine(modelId, line);
        entriesById.set(record.id, {
          recordId: record.id,
          entity: record.entity,
          expressId,
          type: RECORD_TYPE_CODES[record.entity],
          globalId: ROOT_RECORD_ENTITIES.has(record.entity)
            ? String(wrappedValue(globalIds.get(record.id)) ?? "")
            : undefined,
        });
      }
    }

    if (entriesById.size !== graph.records.length) {
      throw new IfcModelExportError(
        "Mission graph contains an entity that the IFC writer does not support.",
      );
    }
    return {
      entries: graph.records.map((record) => entriesById.get(record.id)!),
      externalExpressIds,
    };
  }

  /**
   * Verifies every generated line and relationship after output is reopened.
   *
   * This check supplements parseability with graph-specific invariants that a
   * permissive STEP parser may not enforce, including USERDEFINED ObjectType and
   * the zero-completion exception required by IfcPositiveRatioMeasure.
   */
  verify(
    api: IfcMissionWriterApiPort,
    modelId: number,
    graph: IfcRobotMissionRecordGraph,
    manifest: IfcMissionWriteManifest,
  ): void {
    const entryById = new Map(
      manifest.entries.map((entry) => [entry.recordId, entry]),
    );
    const generatedGuids = new Set<string>();
    const allGuidExpressIds = this.buildGlobalIdIndex(api, modelId);

    for (const entry of manifest.entries) {
      const line = api.GetLine(modelId, entry.expressId, false) as any;
      if (!line) {
        throw new IfcModelExportError(
          `Generated IFC record ${entry.recordId} is missing after serialization.`,
        );
      }
      assertEquivalent(
        api.GetLineType(modelId, entry.expressId),
        entry.type,
        `${entry.recordId} entity type`,
      );
      if (entry.globalId) {
        assertEquivalent(
          wrappedValue(line.GlobalId),
          entry.globalId,
          `${entry.recordId} GlobalId`,
        );
        if (generatedGuids.has(entry.globalId)) {
          throw new IfcModelExportError(
            "Generated mission records contain duplicate IFC GlobalIds.",
          );
        }
        assertEquivalent(
          allGuidExpressIds.get(entry.globalId),
          entry.expressId,
          `${entry.recordId} GlobalId index`,
        );
        generatedGuids.add(entry.globalId);
      }
    }

    const expressIdFor = (reference: IfcRecordReference): number => {
      const entry = entryById.get(reference.id);
      if (!entry || entry.entity !== reference.entity) {
        throw new IfcModelExportError(
          `Generated IFC reference ${reference.entity}:${reference.id} is unresolved.`,
        );
      }
      return entry.expressId;
    };

    for (const record of graph.records) {
      const entry = entryById.get(record.id)!;
      const line = api.GetLine(modelId, entry.expressId, false) as any;
      switch (record.entity) {
        case "IfcPropertySingleValue":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            wrappedValue(line.NominalValue),
            serializedPropertyValue(record.name, record.nominalValue),
            `${record.id}.NominalValue`,
          );
          break;
        case "IfcPropertyListValue":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            (line.ListValues ?? []).map(wrappedValue),
            record.listValues,
            `${record.id}.ListValues`,
          );
          break;
        case "IfcTaskTime":
          this.verifyTaskTime(line, record);
          break;
        case "IfcTask":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            optionalWrappedValue(line.Description),
            record.description,
            `${record.id}.Description`,
          );
          assertEquivalent(
            wrappedValue(line.ObjectType),
            record.objectType,
            `${record.id}.ObjectType`,
          );
          assertEquivalent(
            wrappedValue(line.Identification),
            record.identification,
            `${record.id}.Identification`,
          );
          assertEquivalent(
            optionalWrappedValue(line.Status),
            record.status,
            `${record.id}.Status`,
          );
          assertEquivalent(
            optionalWrappedValue(line.Priority),
            record.priority,
            `${record.id}.Priority`,
          );
          assertEquivalent(
            wrappedValue(line.PredefinedType),
            "USERDEFINED",
            `${record.id}.PredefinedType`,
          );
          assertEquivalent(
            handleValue(line.TaskTime),
            record.taskTime ? expressIdFor(record.taskTime) : undefined,
            `${record.id}.TaskTime`,
          );
          break;
        case "IfcWorkSchedule":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            wrappedValue(line.Identification),
            record.identification,
            `${record.id}.Identification`,
          );
          assertEquivalent(
            wrappedValue(line.CreationDate),
            validDateTime(record.creationDate, `${record.id}.CreationDate`),
            `${record.id}.CreationDate`,
          );
          assertEquivalent(
            wrappedValue(line.StartTime),
            validDateTime(record.startTime, `${record.id}.StartTime`),
            `${record.id}.StartTime`,
          );
          assertEquivalent(
            optionalWrappedValue(line.FinishTime),
            record.finishTime === undefined
              ? undefined
              : validDateTime(record.finishTime, `${record.id}.FinishTime`),
            `${record.id}.FinishTime`,
          );
          assertEquivalent(
            optionalWrappedValue(line.Duration),
            record.duration,
            `${record.id}.Duration`,
          );
          assertEquivalent(
            wrappedValue(line.PredefinedType),
            "PLANNED",
            `${record.id}.PredefinedType`,
          );
          break;
        case "IfcPropertySet":
          if (record.name.startsWith("Pset_")) {
            throw new IfcModelExportError(
              `Custom property set ${record.name} uses the reserved Pset_ prefix.`,
            );
          }
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            handleValues(line.HasProperties),
            record.hasProperties.map(expressIdFor),
            `${record.id}.HasProperties`,
          );
          break;
        case "IfcRelNests":
          assertEquivalent(
            handleValue(line.RelatingObject),
            expressIdFor(record.relatingObject),
            `${record.id}.RelatingObject`,
          );
          assertEquivalent(
            handleValues(line.RelatedObjects),
            record.relatedObjects.map(expressIdFor),
            `${record.id}.RelatedObjects`,
          );
          break;
        case "IfcRelSequence":
          assertEquivalent(
            handleValue(line.RelatingProcess),
            expressIdFor(record.relatingProcess),
            `${record.id}.RelatingProcess`,
          );
          assertEquivalent(
            handleValue(line.RelatedProcess),
            expressIdFor(record.relatedProcess),
            `${record.id}.RelatedProcess`,
          );
          assertEquivalent(
            wrappedValue(line.SequenceType),
            record.sequenceType,
            `${record.id}.SequenceType`,
          );
          break;
        case "IfcRelAssignsToProcess":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            handleValue(line.RelatingProcess),
            expressIdFor(record.relatingProcess),
            `${record.id}.RelatingProcess`,
          );
          assertEquivalent(
            handleValues(line.RelatedObjects),
            manifest.externalExpressIds.get(record.id),
            `${record.id}.RelatedObjects`,
          );
          break;
        case "IfcRelAssignsToProduct":
          assertEquivalent(
            wrappedValue(line.Name),
            record.name,
            `${record.id}.Name`,
          );
          assertEquivalent(
            handleValues(line.RelatedObjects),
            record.relatedObjects.map(expressIdFor),
            `${record.id}.RelatedObjects`,
          );
          assertEquivalent(
            handleValue(line.RelatingProduct),
            manifest.externalExpressIds.get(record.id)?.[0],
            `${record.id}.RelatingProduct`,
          );
          break;
        case "IfcRelAssignsToControl":
          assertEquivalent(
            handleValues(line.RelatedObjects),
            record.relatedObjects.map(expressIdFor),
            `${record.id}.RelatedObjects`,
          );
          assertEquivalent(
            handleValue(line.RelatingControl),
            expressIdFor(record.relatingControl),
            `${record.id}.RelatingControl`,
          );
          break;
        case "IfcRelDefinesByProperties":
          assertEquivalent(
            handleValues(line.RelatedObjects),
            record.relatedObjects.map(expressIdFor),
            `${record.id}.RelatedObjects`,
          );
          assertEquivalent(
            handleValue(line.RelatingPropertyDefinition),
            expressIdFor(record.relatingPropertyDefinition),
            `${record.id}.RelatingPropertyDefinition`,
          );
          break;
        default: {
          const exhaustive: never = record;
          throw new IfcModelExportError(
            `Cannot verify unsupported mission record ${String(exhaustive)}.`,
          );
        }
      }
    }

    const actionPropertySets = graph.records.filter(
      (record) =>
        record.entity === "IfcPropertySet" && record.name === "RobotAction",
    );
    for (const propertySet of actionPropertySets) {
      const relation = graph.records.find(
        (record) =>
          record.entity === "IfcRelDefinesByProperties" &&
          record.relatingPropertyDefinition.id === propertySet.id,
      );
      if (
        !relation ||
        relation.entity !== "IfcRelDefinesByProperties" ||
        relation.relatedObjects.some(
          (reference) => reference.entity !== "IfcTask",
        )
      ) {
        throw new IfcModelExportError(
          "RobotAction property sets must be attached only to generated IfcTask records.",
        );
      }
    }
  }

  /**
   * Checks IFC lexical, length, and numeric constraints before the first write.
   *
   * Domain validation focuses on robot-task semantics. This export-specific
   * pass prevents values that TypeScript can represent but IFC cannot, such as
   * overlong labels, malformed durations, or non-finite coordinates.
   */
  private preflightGraph(graph: IfcRobotMissionRecordGraph): void {
    for (const record of graph.records) {
      switch (record.entity) {
        case "IfcTask":
          validBoundedString(record.name, `${record.id}.Name`);
          validBoundedString(
            record.identification,
            `${record.id}.Identification`,
          );
          validBoundedString(record.objectType, `${record.id}.ObjectType`);
          if (record.status !== undefined) {
            validBoundedString(record.status, `${record.id}.Status`);
          }
          if (
            record.priority !== undefined &&
            (!Number.isInteger(record.priority) ||
              record.priority < 1 ||
              record.priority > 4)
          ) {
            throw new IfcModelExportError(
              `${record.id}.Priority must be an integer from 1 through 4.`,
            );
          }
          break;
        case "IfcWorkSchedule":
          validBoundedString(record.name, `${record.id}.Name`);
          validBoundedString(
            record.identification,
            `${record.id}.Identification`,
          );
          validDateTime(record.creationDate, `${record.id}.CreationDate`);
          validDateTime(record.startTime, `${record.id}.StartTime`);
          if (record.finishTime !== undefined) {
            validDateTime(record.finishTime, `${record.id}.FinishTime`);
          }
          if (record.duration !== undefined) {
            validDuration(record.duration, `${record.id}.Duration`);
          }
          break;
        case "IfcTaskTime":
          for (const [name, value] of [
            ["ScheduleStart", record.scheduleStart],
            ["ScheduleFinish", record.scheduleFinish],
            ["ActualStart", record.actualStart],
            ["ActualFinish", record.actualFinish],
          ] as const) {
            if (value !== undefined) {
              validDateTime(value, `${record.id}.${name}`);
            }
          }
          for (const [name, value] of [
            ["ScheduleDuration", record.scheduleDuration],
            ["RemainingTime", record.remainingTime],
          ] as const) {
            if (value !== undefined) {
              validDuration(value, `${record.id}.${name}`);
            }
          }
          if (
            record.completion !== undefined &&
            (!Number.isFinite(record.completion) ||
              record.completion < 0 ||
              record.completion > 1)
          ) {
            throw new IfcModelExportError(
              `${record.id}.Completion must be between 0 and 1.`,
            );
          }
          break;
        case "IfcPropertySingleValue":
          validBoundedString(record.name, `${record.id}.Name`);
          serializedPropertyValue(record.name, record.nominalValue);
          if (
            typeof record.nominalValue === "string" &&
            [
              "ActionType",
              "TargetState",
              "TargetObjectRole",
              "AffectedObjectRole",
              "RequiredCapability",
              "Priority",
            ].includes(record.name)
          ) {
            validBoundedString(
              record.nominalValue,
              `${record.id}.NominalValue`,
            );
          }
          break;
        case "IfcPropertyListValue":
          validBoundedString(record.name, `${record.id}.Name`);
          record.listValues.forEach((value, index) => {
            if (typeof value === "number" && !Number.isFinite(value)) {
              throw new IfcModelExportError(
                `${record.id}.ListValues[${index}] must be finite.`,
              );
            }
          });
          break;
        case "IfcPropertySet":
          validBoundedString(record.name, `${record.id}.Name`);
          if (record.name.startsWith("Pset_")) {
            throw new IfcModelExportError(
              `Custom property set ${record.name} uses the reserved Pset_ prefix.`,
            );
          }
          break;
        case "IfcRelNests":
        case "IfcRelSequence":
        case "IfcRelAssignsToProcess":
        case "IfcRelAssignsToProduct":
        case "IfcRelAssignsToControl":
        case "IfcRelDefinesByProperties":
          break;
        default: {
          const exhaustive: never = record;
          throw new IfcModelExportError(
            `Cannot preflight unsupported mission record ${String(exhaustive)}.`,
          );
        }
      }
    }
  }

  /** Allocates collision-free IDs for every graph record before writing handles. */
  private allocateExpressIds(
    api: IfcMissionWriterApiPort,
    modelId: number,
    graph: IfcRobotMissionRecordGraph,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const maximumSourceId = api.GetMaxExpressID(modelId);
    if (!Number.isInteger(maximumSourceId) || maximumSourceId < 0) {
      throw new IfcModelExportError(
        "web-ifc reported an invalid maximum express ID.",
      );
    }
    const recordsInWriteOrder = RECORD_WRITE_ORDER.flatMap((group) =>
      graph.records.filter((record) => group.includes(record.entity)),
    );
    if (recordsInWriteOrder.length !== graph.records.length) {
      throw new IfcModelExportError(
        "Mission graph contains an entity that cannot receive an express ID.",
      );
    }
    recordsInWriteOrder.forEach((record, index) => {
      const expressId = maximumSourceId + index + 1;
      if (!Number.isInteger(expressId) || expressId <= 0) {
        throw new IfcModelExportError(
          `web-ifc could not allocate an express ID for ${record.id}.`,
        );
      }
      result.set(record.id, expressId);
    });
    return result;
  }

  /** Resolves the source model's owner history without creating fake provenance. */
  private findOwnerHistory(
    api: IfcMissionWriterApiPort,
    modelId: number,
  ): unknown {
    const projectIds = api.GetLineIDsWithType(modelId, IFCPROJECT);
    if (projectIds.size()) {
      const project = api.GetLine(modelId, projectIds.get(0), false) as any;
      if (project?.OwnerHistory) return project.OwnerHistory;
    }
    const ownerHistoryIds = api.GetLineIDsWithType(modelId, IFCOWNERHISTORY);
    return ownerHistoryIds.size() ? new Handle(ownerHistoryIds.get(0)) : null;
  }

  /**
   * Indexes every IfcRoot GlobalId, including spatial objects and process roots.
   *
   * web-ifc's convenience GUID map currently indexes only IfcElement subtypes,
   * which is insufficient for navigational references such as IfcSpace and for
   * validating generated IfcTask GUIDs.
   */
  private buildGlobalIdIndex(
    api: IfcMissionWriterApiPort,
    modelId: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const rootIds = api.GetLineIDsWithType(modelId, IFCROOT, true);
    for (let index = 0; index < rootIds.size(); index += 1) {
      const expressId = rootIds.get(index);
      const line = api.GetLine(modelId, expressId, false) as any;
      const globalId = String(wrappedValue(line?.GlobalId) ?? "").trim();
      if (!globalId) continue;
      if (result.has(globalId)) {
        throw new IfcModelExportError(
          `Source IFC contains duplicate GlobalId ${globalId}.`,
        );
      }
      result.set(globalId, expressId);
    }
    return result;
  }

  /** Resolves and type-checks all external model references before any write. */
  private resolveExternalObjects(
    api: IfcMissionWriterApiPort,
    modelId: number,
    sourceModelId: string,
    graph: IfcRobotMissionRecordGraph,
    sourceGuidExpressIds: Map<string, number>,
  ): Map<string, number[]> {
    api.CreateIfcGuidToExpressIdMapping(modelId);
    const objectDefinitions = vectorToSet(
      api.GetLineIDsWithType(modelId, IFCOBJECTDEFINITION, true),
    );
    const products = vectorToSet(
      api.GetLineIDsWithType(modelId, IFCPRODUCT, true),
    );
    for (const typeProduct of vectorToSet(
      api.GetLineIDsWithType(modelId, IFCTYPEPRODUCT, true),
    )) {
      products.add(typeProduct);
    }
    const result = new Map<string, number[]>();
    const errors: string[] = [];

    const resolve = (
      reference: IfcExternalObjectReference,
      allowedIds: Set<number>,
      relationId: string,
    ): number | undefined => {
      let expressId: number | undefined;
      if (reference.globalId) {
        const globalId = reference.globalId.trim();
        expressId =
          sourceGuidExpressIds.get(globalId) ??
          resolvedExpressId(api.GetExpressIdFromGuid(modelId, globalId));
        if (
          expressId &&
          reference.modelId === sourceModelId &&
          reference.expressId !== undefined &&
          reference.expressId !== expressId
        ) {
          errors.push(
            `${relationId}: GlobalId ${reference.globalId} resolves to #${expressId}, not stored #${reference.expressId}.`,
          );
          return undefined;
        }
      } else if (
        reference.modelId === sourceModelId &&
        reference.expressId !== undefined
      ) {
        expressId = reference.expressId;
      }

      if (!expressId) {
        errors.push(
          `${relationId}: object ${externalReferenceLabel(reference)} is not present in the selected source IFC.`,
        );
        return undefined;
      }
      if (!allowedIds.has(expressId)) {
        errors.push(
          `${relationId}: object ${externalReferenceLabel(reference)} has an IFC type incompatible with this relation.`,
        );
        return undefined;
      }
      return expressId;
    };

    for (const record of graph.records) {
      if (record.entity === "IfcRelAssignsToProcess") {
        const resolved = record.relatedObjects
          .map((reference) => resolve(reference, objectDefinitions, record.id))
          .filter((value): value is number => value !== undefined);
        result.set(record.id, [...new Set(resolved)]);
      }
      if (record.entity === "IfcRelAssignsToProduct") {
        const resolved = resolve(record.relatingProduct, products, record.id);
        result.set(record.id, resolved ? [resolved] : []);
      }
    }

    if (errors.length) {
      throw new IfcModelExportError(
        `Mission object references could not be resolved: ${errors.join(" ")}`,
      );
    }
    return result;
  }

  /** Resolves a graph reference to a preallocated IFC handle. */
  private internalHandle(
    reference: IfcRecordReference,
    recordExpressIds: Map<string, number>,
    recordsById: Map<string, IfcRobotTaskRecord>,
  ): Handle<unknown> {
    const record = recordsById.get(reference.id);
    const expressId = recordExpressIds.get(reference.id);
    if (!record || record.entity !== reference.entity || !expressId) {
      throw new IfcModelExportError(
        `Mission graph reference ${reference.entity}:${reference.id} is invalid.`,
      );
    }
    return new Handle(expressId);
  }

  /** Creates the schema-specific web-ifc line for one graph record. */
  private createLine(
    schema: IfcRuntimeNamespace,
    record: IfcRobotTaskRecord,
    ownerHistory: unknown,
    globalIds: Map<string, unknown>,
    recordExpressIds: Map<string, number>,
    recordsById: Map<string, IfcRobotTaskRecord>,
    externalExpressIds: Map<string, number[]>,
  ): IfcLineObject {
    const internal = (reference: IfcRecordReference) =>
      this.internalHandle(reference, recordExpressIds, recordsById);
    const globalId = () => globalIds.get(record.id);
    const label = (value: string | undefined) =>
      value === undefined ? null : new schema.IfcLabel(value);
    const text = (value: string | undefined) =>
      value === undefined ? null : new schema.IfcText(value);
    const identifier = (value: string) => new schema.IfcIdentifier(value);
    const dateTime = (value: string | undefined, context: string) =>
      value === undefined
        ? null
        : new schema.IfcDateTime(validDateTime(value, context));
    const duration = (value: string | undefined, context: string) =>
      value === undefined
        ? null
        : new schema.IfcDuration(validDuration(value, context));
    const scalar = (name: string, value: string | number | boolean) => {
      const serialized = serializedPropertyValue(name, value);
      if (typeof serialized === "number") return new schema.IfcReal(serialized);
      if (typeof value === "boolean") return new schema.IfcBoolean(value);
      if (name === "CreatedAt" || name === "UpdatedAt") {
        return new schema.IfcDateTime(serialized);
      }
      if (
        [
          "ActionType",
          "TargetState",
          "TargetObjectRole",
          "AffectedObjectRole",
          "RequiredCapability",
          "Priority",
        ].includes(name)
      ) {
        return new schema.IfcLabel(serialized);
      }
      return new schema.IfcText(serialized);
    };

    switch (record.entity) {
      case "IfcPropertySingleValue":
        return new schema.IfcPropertySingleValue(
          identifier(record.name),
          null,
          scalar(record.name, record.nominalValue),
          null,
        );
      case "IfcPropertyListValue":
        return new schema.IfcPropertyListValue(
          identifier(record.name),
          null,
          record.listValues.map((value) => scalar(record.name, value)),
          null,
        );
      case "IfcTaskTime": {
        const hasDuration = Boolean(
          record.scheduleDuration || record.remainingTime,
        );
        const completion =
          record.completion === undefined || record.completion === 0
            ? null
            : new schema.IfcPositiveRatioMeasure(record.completion);
        return new schema.IfcTaskTime(
          null,
          null,
          null,
          hasDuration ? schema.IfcTaskDurationEnum.ELAPSEDTIME : null,
          duration(record.scheduleDuration, `${record.id}.ScheduleDuration`),
          dateTime(record.scheduleStart, `${record.id}.ScheduleStart`),
          dateTime(record.scheduleFinish, `${record.id}.ScheduleFinish`),
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          dateTime(record.actualStart, `${record.id}.ActualStart`),
          dateTime(record.actualFinish, `${record.id}.ActualFinish`),
          duration(record.remainingTime, `${record.id}.RemainingTime`),
          completion,
        );
      }
      case "IfcTask":
        return new schema.IfcTask(
          globalId(),
          ownerHistory,
          label(record.name),
          text(record.description),
          label(record.objectType),
          identifier(record.identification),
          null,
          label(record.status),
          null,
          new schema.IfcBoolean(false),
          record.priority === undefined
            ? null
            : new schema.IfcInteger(record.priority),
          record.taskTime ? internal(record.taskTime) : null,
          schema.IfcTaskTypeEnum.USERDEFINED,
        );
      case "IfcWorkSchedule":
        return new schema.IfcWorkSchedule(
          globalId(),
          ownerHistory,
          label(record.name),
          null,
          label("RobotMissionSchedule"),
          identifier(record.identification),
          dateTime(record.creationDate, `${record.id}.CreationDate`),
          null,
          null,
          duration(record.duration, `${record.id}.Duration`),
          null,
          dateTime(record.startTime, `${record.id}.StartTime`),
          dateTime(record.finishTime, `${record.id}.FinishTime`),
          schema.IfcWorkScheduleTypeEnum.PLANNED,
        );
      case "IfcPropertySet":
        if (record.name.startsWith("Pset_")) {
          throw new IfcModelExportError(
            `Custom property set ${record.name} uses the reserved Pset_ prefix.`,
          );
        }
        return new schema.IfcPropertySet(
          globalId(),
          ownerHistory,
          label(record.name),
          null,
          record.hasProperties.map(internal),
        );
      case "IfcRelNests":
        return new schema.IfcRelNests(
          globalId(),
          ownerHistory,
          label("MISSION_TASKS"),
          null,
          internal(record.relatingObject),
          record.relatedObjects.map(internal),
        );
      case "IfcRelSequence":
        return new schema.IfcRelSequence(
          globalId(),
          ownerHistory,
          null,
          null,
          internal(record.relatingProcess),
          internal(record.relatedProcess),
          null,
          schema.IfcSequenceEnum[record.sequenceType],
          null,
        );
      case "IfcRelAssignsToProcess":
        return new schema.IfcRelAssignsToProcess(
          globalId(),
          ownerHistory,
          label(record.name),
          null,
          (externalExpressIds.get(record.id) ?? []).map(
            (expressId) => new Handle(expressId),
          ),
          null,
          internal(record.relatingProcess),
          null,
        );
      case "IfcRelAssignsToProduct":
        return new schema.IfcRelAssignsToProduct(
          globalId(),
          ownerHistory,
          label(record.name),
          null,
          record.relatedObjects.map(internal),
          null,
          new Handle(externalExpressIds.get(record.id)![0]),
        );
      case "IfcRelAssignsToControl":
        return new schema.IfcRelAssignsToControl(
          globalId(),
          ownerHistory,
          label("MISSION_SCHEDULE"),
          null,
          record.relatedObjects.map(internal),
          null,
          internal(record.relatingControl),
        );
      case "IfcRelDefinesByProperties":
        return new schema.IfcRelDefinesByProperties(
          globalId(),
          ownerHistory,
          null,
          null,
          record.relatedObjects.map(internal),
          internal(record.relatingPropertyDefinition),
        );
      default: {
        const exhaustive: never = record;
        throw new IfcModelExportError(
          `Cannot serialize unsupported mission record ${String(exhaustive)}.`,
        );
      }
    }
  }

  /** Verifies direct IfcTaskTime fields, including the valid zero exception. */
  private verifyTaskTime(
    line: any,
    record: Extract<IfcRobotTaskRecord, { entity: "IfcTaskTime" }>,
  ): void {
    for (const [attribute, expected] of [
      ["ScheduleStart", record.scheduleStart],
      ["ScheduleFinish", record.scheduleFinish],
      ["ScheduleDuration", record.scheduleDuration],
      ["ActualStart", record.actualStart],
      ["ActualFinish", record.actualFinish],
      ["RemainingTime", record.remainingTime],
    ] as const) {
      let serializedExpected: string | undefined;
      if (expected !== undefined) {
        serializedExpected =
          attribute.endsWith("Duration") || attribute === "RemainingTime"
            ? validDuration(expected, `${record.id}.${attribute}`)
            : validDateTime(expected, `${record.id}.${attribute}`);
      }
      assertEquivalent(
        optionalWrappedValue(line[attribute]),
        serializedExpected,
        `${record.id}.${attribute}`,
      );
    }
    assertEquivalent(
      optionalWrappedValue(line.Completion),
      record.completion === 0 ? undefined : record.completion,
      `${record.id}.Completion`,
    );
  }
}
