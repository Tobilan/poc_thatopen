import type { IfcLineObject } from "web-ifc";
import { mapMissionToIfcRecords } from "../robot-tasks";
import type {
  IfcRobotMissionRecordGraph,
  IfcRobotTaskRecord,
  IfcRobotTaskRecordEntity,
} from "../robot-tasks";
import {
  WebIfcMissionReader,
  type IfcMissionEntityProvenance,
  type IfcMissionImportResult,
  type IfcMissionReaderApiPort,
} from "../model-import";
import { IfcMissionReplacementError } from "./ifcMissionReplacementError";
import type { IfcMissionReplacementIssue } from "./ifcMissionReplacementError";
import type { SupportedMissionIfcSchema } from "./ifcSchemaAdapter";
import {
  WebIfcMissionWriter,
  type IfcMissionWriteManifest,
  type IfcMissionWriterApiPort,
  type IfcMissionWriterOptions,
} from "./webIfcMissionWriter";

/** Mutation operations added to the existing reader and writer API boundaries. */
export interface IfcMissionReplacementApiPort
  extends IfcMissionWriterApiPort,
    IfcMissionReaderApiPort {
  GetAllLines(modelID: number): { size(): number; get(index: number): number };
  DeleteLine(modelID: number, expressID: number): void;
}

/** Result retained for fresh-runtime verification after saving the model. */
export interface IfcMissionReplacementManifest {
  graph?: IfcRobotMissionRecordGraph;
  writeManifest?: IfcMissionWriteManifest;
  removedExpressIds: number[];
  imported: IfcMissionImportResult;
}

const entityTypeName = (entity: IfcRobotTaskRecordEntity): string =>
  entity.toUpperCase();

const rootEntities = new Set<IfcRobotTaskRecordEntity>([
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

const collectHandleReferences = (value: unknown, result: Set<number>): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectHandleReferences(entry, result));
    return;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type === 5 &&
    typeof candidate.value === "number" &&
    Number.isInteger(candidate.value)
  ) {
    result.add(candidate.value);
    return;
  }
  Object.values(candidate).forEach((entry) =>
    collectHandleReferences(entry, result),
  );
};

const combinedGraph = (
  graphs: readonly IfcRobotMissionRecordGraph[],
): IfcRobotMissionRecordGraph | undefined => {
  if (!graphs.length) return undefined;
  return {
    missionId: "robot-mission-authoritative-collection",
    rootTask: graphs[0].rootTask,
    records: graphs.flatMap((graph) => graph.records),
  };
};

const migrationRecord = (recordIdentity: string): boolean =>
  recordIdentity.includes("/RobotMission/") &&
  (recordIdentity.endsWith("/AnnotationSchemaVersion") ||
    recordIdentity.endsWith("/HasExplicitSchedule"));

/**
 * Replaces the complete recognized application-owned graph in an isolated IFC.
 *
 * `web-ifc` has no transaction and does not protect DeleteLine from dangling
 * references. This implementation therefore performs every ownership,
 * reference, identity, external-object, GUID, and line-construction check using
 * the untouched model. Only then are owned lines deleted and the fully prepared
 * replacement lines written with fresh express IDs above the original maximum.
 */
export class WebIfcMissionReplacer {
  replace(
    api: IfcMissionReplacementApiPort,
    modelId: number,
    sourceModelId: string,
    graphs: readonly IfcRobotMissionRecordGraph[],
    schema: SupportedMissionIfcSchema,
  ): IfcMissionReplacementManifest {
    const imported = new WebIfcMissionReader().read(
      api,
      modelId,
      sourceModelId,
      schema,
    );
    const issues: IfcMissionReplacementIssue[] = imported.issues
      .filter((entry) => entry.severity === "error")
      .map((entry) => ({
        code: entry.code,
        message: entry.message,
        expressId: entry.expressId,
        entityType: entry.ifcEntityType,
        missionId: entry.missionId,
      }));
    if (imported.provenance.sourceModelId !== sourceModelId) {
      issues.push({
        code: "IFC_PROVENANCE_MODEL_MISMATCH",
        message: `Imported provenance belongs to ${imported.provenance.sourceModelId}, not ${sourceModelId}.`,
      });
    }

    const desired = combinedGraph(graphs);
    const desiredRecords = new Map<string, IfcRobotTaskRecord>();
    const desiredRecordMissionIds = new Map<string, string>();
    const desiredMissionIds = new Set<string>();
    const desiredTaskIds = new Set<string>();
    for (const graph of graphs) {
      if (desiredMissionIds.has(graph.missionId)) {
        issues.push({
          code: "IFC_CURRENT_MISSION_ID_DUPLICATE",
          message: `Current mission ID ${graph.missionId} occurs more than once.`,
          missionId: graph.missionId,
        });
      }
      desiredMissionIds.add(graph.missionId);
      for (const record of graph.records) {
        if (desiredRecords.has(record.id)) {
          issues.push({
            code: "IFC_CURRENT_RECORD_ID_DUPLICATE",
            message: `Deterministic record ID ${record.id} occurs more than once.`,
            missionId: graph.missionId,
            recordIdentity: record.id,
          });
        }
        desiredRecords.set(record.id, record);
        desiredRecordMissionIds.set(record.id, graph.missionId);
        if (record.entity === "IfcTask" && record.role === "EXECUTABLE_TASK") {
          if (desiredTaskIds.has(record.sourceId)) {
            issues.push({
              code: "IFC_CURRENT_TASK_ID_DUPLICATE",
              message: `Current task ID ${record.sourceId} occurs in more than one mission.`,
              missionId: graph.missionId,
              recordIdentity: record.id,
            });
          }
          desiredTaskIds.add(record.sourceId);
        }
      }
    }

    const importedGraphs = imported.missions.map(mapMissionToIfcRecords);
    const importedRecords = new Map<string, IfcRobotTaskRecord>();
    for (const graph of importedGraphs) {
      for (const record of graph.records) {
        if (importedRecords.has(record.id)) {
          issues.push({
            code: "IFC_IMPORTED_CONCEPT_DUPLICATE",
            message: `Imported domain concept ${record.id} is claimed more than once.`,
            missionId: graph.missionId,
            recordIdentity: record.id,
          });
        }
        importedRecords.set(record.id, record);
      }
    }

    const provenanceByIdentity = new Map<string, IfcMissionEntityProvenance>();
    const provenanceExpressIds = new Set<number>();
    const provenanceGlobalIds = new Set<string>();
    for (const provenance of imported.provenance.entities) {
      if (!provenance.recordIdentity) {
        issues.push({
          code: "IFC_IMPORTED_OWNERSHIP_AMBIGUOUS",
          message: `Recognized entity #${provenance.expressId} has no deterministic application record identity.`,
          expressId: provenance.expressId,
          entityType: provenance.entityType,
          missionId: provenance.missionId,
        });
        continue;
      }
      const previous = provenanceByIdentity.get(provenance.recordIdentity);
      if (previous) {
        issues.push({
          code: "IFC_PROVENANCE_IDENTITY_DUPLICATE",
          message: `Imported record identity ${provenance.recordIdentity} is claimed by #${previous.expressId} and #${provenance.expressId}.`,
          expressId: provenance.expressId,
          recordIdentity: provenance.recordIdentity,
          missionId: provenance.missionId,
        });
      } else {
        provenanceByIdentity.set(provenance.recordIdentity, provenance);
      }
      if (provenanceExpressIds.has(provenance.expressId)) {
        issues.push({
          code: "IFC_PROVENANCE_EXPRESS_ID_DUPLICATE",
          message: `IFC entity #${provenance.expressId} is claimed by multiple application concepts.`,
          expressId: provenance.expressId,
          recordIdentity: provenance.recordIdentity,
          missionId: provenance.missionId,
        });
      }
      provenanceExpressIds.add(provenance.expressId);
      if (provenance.globalId) {
        if (provenanceGlobalIds.has(provenance.globalId)) {
          issues.push({
            code: "IFC_PROVENANCE_GLOBAL_ID_DUPLICATE",
            message: `Preserved IFC GlobalId ${provenance.globalId} is claimed more than once.`,
            expressId: provenance.expressId,
            recordIdentity: provenance.recordIdentity,
            missionId: provenance.missionId,
          });
        }
        provenanceGlobalIds.add(provenance.globalId);
      }
      const importedRecord = importedRecords.get(provenance.recordIdentity);
      if (!importedRecord) {
        issues.push({
          code: "IFC_IMPORTED_RECORD_UNSUPPORTED",
          message: `Recognized record ${provenance.recordIdentity} cannot be reconstructed by the current mapper.`,
          expressId: provenance.expressId,
          recordIdentity: provenance.recordIdentity,
          missionId: provenance.missionId,
        });
      } else if (
        entityTypeName(importedRecord.entity) !==
        provenance.entityType.toUpperCase()
      ) {
        issues.push({
          code: "IFC_PROVENANCE_ENTITY_TYPE_MISMATCH",
          message: `${provenance.recordIdentity} claims ${provenance.entityType}, expected ${importedRecord.entity}.`,
          expressId: provenance.expressId,
          recordIdentity: provenance.recordIdentity,
          missionId: provenance.missionId,
        });
      }
    }
    for (const recordIdentity of importedRecords.keys()) {
      if (
        !provenanceByIdentity.has(recordIdentity) &&
        !migrationRecord(recordIdentity)
      ) {
        issues.push({
          code: "IFC_PROVENANCE_RECORD_MISSING",
          message: `Imported concept ${recordIdentity} has no unique source provenance.`,
          recordIdentity,
        });
      }
    }

    const preservedGlobalIds = new Map<
      string,
      { globalId: string; expressId: number }
    >();
    for (const [recordIdentity, record] of desiredRecords) {
      const provenance = provenanceByIdentity.get(recordIdentity);
      if (!provenance) continue;
      if (rootEntities.has(record.entity)) {
        if (!provenance.globalId) {
          issues.push({
            code: "IFC_PRESERVED_GLOBAL_ID_MISSING",
            message: `Existing IfcRoot concept ${recordIdentity} has no GlobalId to preserve.`,
            expressId: provenance.expressId,
            recordIdentity,
            missionId: provenance.missionId,
          });
        } else {
          preservedGlobalIds.set(recordIdentity, {
            globalId: provenance.globalId,
            expressId: provenance.expressId,
          });
        }
      }
    }

    for (const referrerExpressId of this.allLineIds(api, modelId)) {
      if (provenanceExpressIds.has(referrerExpressId)) continue;
      const line = api.GetLine(modelId, referrerExpressId, false);
      const references = new Set<number>();
      collectHandleReferences(line, references);
      for (const referencedExpressId of references) {
        if (!provenanceExpressIds.has(referencedExpressId)) continue;
        issues.push({
          code: "IFC_OWNED_ENTITY_EXTERNALLY_REFERENCED",
          message: `External ${api.GetNameFromTypeCode(api.GetLineType(modelId, referrerExpressId))} #${referrerExpressId} references application-owned entity #${referencedExpressId}.`,
          expressId: referencedExpressId,
          referrerExpressId,
          entityType: api.GetNameFromTypeCode(
            api.GetLineType(modelId, referrerExpressId),
          ),
        });
      }
    }
    if (issues.length) throw new IfcMissionReplacementError(issues);

    let writeManifest: IfcMissionWriteManifest | undefined;
    const preparedLines: IfcLineObject[] = [];
    if (desired) {
      const writer = new WebIfcMissionWriter();
      const dryApi = new Proxy(api, {
        get(target, property, receiver) {
          if (property === "WriteLine") {
            return (_dryModelId: number, line: IfcLineObject) => {
              preparedLines.push(line);
            };
          }
          const member = Reflect.get(target, property, receiver) as unknown;
          return typeof member === "function" ? member.bind(target) : member;
        },
      }) as IfcMissionReplacementApiPort;
      const options: IfcMissionWriterOptions = { preservedGlobalIds };
      writeManifest = writer.write(
        dryApi,
        modelId,
        sourceModelId,
        desired,
        schema,
        options,
      );
      for (const [
        recordIdentity,
        referencedExpressIds,
      ] of writeManifest.externalExpressIds) {
        for (const referencedExpressId of referencedExpressIds) {
          if (!provenanceExpressIds.has(referencedExpressId)) continue;
          issues.push({
            code: "IFC_REPLACEMENT_EXTERNAL_REFERENCE_OWNED",
            message: `Replacement record ${recordIdentity} resolves an external object reference to application-owned source entity #${referencedExpressId}, which must be deleted and cannot remain an external target.`,
            expressId: referencedExpressId,
            entityType: api.GetNameFromTypeCode(
              api.GetLineType(modelId, referencedExpressId),
            ),
            missionId: desiredRecordMissionIds.get(recordIdentity),
            recordIdentity,
          });
        }
      }
    }
    if (issues.length) throw new IfcMissionReplacementError(issues);

    const removedExpressIds = [...provenanceExpressIds].sort(
      (left, right) =>
        this.deletionRank(api, modelId, left) -
          this.deletionRank(api, modelId, right) || left - right,
    );
    removedExpressIds.forEach((expressId) =>
      api.DeleteLine(modelId, expressId),
    );
    preparedLines.forEach((line) => api.WriteLine(modelId, line));
    return { graph: desired, writeManifest, removedExpressIds, imported };
  }

  private allLineIds(
    api: IfcMissionReplacementApiPort,
    modelId: number,
  ): number[] {
    const vector = api.GetAllLines(modelId);
    const result: number[] = [];
    for (let index = 0; index < vector.size(); index += 1) {
      result.push(vector.get(index));
    }
    return result;
  }

  /** Relations are removed before the entities to which they point. */
  private deletionRank(
    api: IfcMissionReplacementApiPort,
    modelId: number,
    expressId: number,
  ): number {
    const name = api
      .GetNameFromTypeCode(api.GetLineType(modelId, expressId))
      .toUpperCase();
    if (name.startsWith("IFCREL")) return 0;
    if (name === "IFCPROPERTYSET") return 1;
    if (name.startsWith("IFCPROPERTY") || name === "IFCTASKTIME") return 2;
    return 3;
  }
}
