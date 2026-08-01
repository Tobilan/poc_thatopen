import { IfcAPI } from "web-ifc";
import type { LocateFileHandlerFn } from "web-ifc";
import {
  compareRobotMissionsSemantically,
  type RobotMissionSemanticDifference,
} from "../../application/robot-tasks";
import type { RobotMission } from "../../domain/robot-tasks";
import {
  mapMissionToIfcRecords,
  type IfcRobotMissionRecordGraph,
} from "../robot-tasks";
import {
  WebIfcMissionReader,
  type IfcMissionImportResult,
} from "../model-import";
import { IfcMissionReplacementError } from "./ifcMissionReplacementError";
import type { IfcMissionReplacementIssue } from "./ifcMissionReplacementError";
import { IfcModelExportError } from "./ifcModelExportError";
import { normalizeMissionIfcSchema } from "./ifcSchemaAdapter";
import {
  WebIfcMissionReplacer,
  type IfcMissionReplacementApiPort,
  type IfcMissionReplacementManifest,
} from "./webIfcMissionReplacer";
import { WebIfcMissionWriter } from "./webIfcMissionWriter";

/** Minimal vector contract used to verify that an IFC contains STEP entities. */
export interface IfcLineVectorPort {
  /** @returns Number of parsed IFC entity lines. */
  size(): number;
}

/** Minimal web-ifc API surface required by structural export validation. */
export interface IfcApiPort {
  /** Configures the runtime location of the web-ifc WASM binary. */
  SetWasmPath(path: string, absolute?: boolean): void;

  /** Initializes web-ifc before opening a model. */
  Init(
    customLocateFileHandler?: LocateFileHandlerFn,
    forceSingleThread?: boolean,
  ): Promise<void>;

  /** Opens IFC STEP bytes and returns a temporary web-ifc model handle. */
  OpenModel(data: Uint8Array): number;

  /** @returns Whether a temporary web-ifc model handle is currently open. */
  IsModelOpen(modelId: number): boolean;

  /** @returns Parsed IFC schema identifier such as IFC2X3 or IFC4. */
  GetModelSchema(modelId: number): string;

  /** @returns Vector containing every parsed IFC entity line identifier. */
  GetAllLines(modelId: number): IfcLineVectorPort;

  /** Serializes an open model into IFC STEP bytes. */
  SaveModel(modelId: number): Uint8Array;

  /** Closes one temporary model and releases its memory. */
  CloseModel(modelId: number): void;

  /** Disposes the isolated web-ifc runtime. */
  Dispose(): void;
}

/** Runtime configuration for isolated structural IFC validation. */
export interface WebIfcStructuralCodecOptions {
  /** WASM folder configured for the application's existing IFC loader. */
  wasmPath: string;

  /** Whether wasmPath is already absolute. */
  wasmAbsolute?: boolean;

  /** Optional custom WASM locator forwarded to web-ifc. */
  customLocateFileHandler?: LocateFileHandlerFn;

  /** Test seam for creating isolated web-ifc API instances. */
  createApi?: () => IfcApiPort;
}

/** Result of rewriting and revalidating one IFC STEP model. */
export interface StructurallyValidatedIfc {
  /** IFC bytes emitted by web-ifc and successfully parsed a second time. */
  bytes: Uint8Array;

  /** Schema reported consistently before and after serialization. */
  schema: string;
}

/** Port consumed by the application-level IFC model export service. */
export interface IfcStructuralCodec {
  /**
   * Parses, rewrites, and reparses source IFC bytes.
   *
   * @param source Original IFC STEP bytes retained during direct IFC import.
   * @returns Structurally validated IFC bytes and their schema.
   */
  rewriteAndValidate(source: Uint8Array): Promise<StructurallyValidatedIfc>;

  /**
   * Replaces owned annotations from pure mapped graphs and verifies the result.
   *
   * This graph-level compatibility entry point is also authoritative and never
   * appends. Application callers should prefer replaceMissionsAndValidate so
   * the final domain-level semantic comparison is included.
   */
  writeMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc>;

  /**
   * Replaces the complete recognized mission annotation collection atomically.
   *
   * `missions` is authoritative. Existing owned missions omitted from it are
   * deleted, matching concepts retain their IFC GlobalIds, and new concepts
   * receive new identities. Success additionally requires a fresh-runtime
   * reimport that is semantically equivalent to this intended collection.
   */
  replaceMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    missions: readonly RobotMission[],
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc>;
}

/** Parsed IFC information captured during one isolated web-ifc pass. */
interface ParsedIfcPass<Result = undefined> {
  /** Schema reported by web-ifc. */
  schema: string;

  /** Serialized bytes when the pass was requested to rewrite the model. */
  savedBytes?: Uint8Array;

  /** Optional result produced while the temporary model was open. */
  result: Result;
}

/** Replacement output plus the independent domain reconstruction it passed. */
interface ReimportedReplacement extends StructurallyValidatedIfc {
  imported: IfcMissionImportResult;
}

/** Operation executed against one initialized, structurally checked model. */
type IfcPassOperation<Result> = (
  api: IfcApiPort,
  modelId: number,
  schema: string,
) => Result;

/**
 * Uses isolated web-ifc instances to guarantee parseable IFC STEP output.
 *
 * The source is opened and serialized once. The produced bytes are then opened
 * again in a fresh runtime. Export succeeds only when both passes contain IFC
 * entities and report the same non-empty schema.
 */
export class WebIfcStructuralCodec implements IfcStructuralCodec {
  /** Runtime configuration and optional API factory. */
  private readonly options: WebIfcStructuralCodecOptions;

  /**
   * Creates a structural codec independent from the viewer's active IFC loader.
   *
   * @param options WASM configuration and optional test API factory.
   */
  constructor(options: WebIfcStructuralCodecOptions) {
    this.options = options;
  }

  /**
   * Rewrites source bytes and validates the resulting IFC with a second parse.
   *
   * @param source Original IFC source associated with a Fragments model.
   * @returns IFC output proven parseable by web-ifc after serialization.
   */
  async rewriteAndValidate(
    source: Uint8Array,
  ): Promise<StructurallyValidatedIfc> {
    if (!source.byteLength) {
      throw new IfcModelExportError("The IFC source is empty.");
    }
    const rewritten = await this.runPass(source, true);
    if (!rewritten.savedBytes?.byteLength) {
      throw new IfcModelExportError("web-ifc produced an empty IFC file.");
    }
    const verified = await this.runPass(rewritten.savedBytes, false);
    if (verified.schema !== rewritten.schema) {
      throw new IfcModelExportError(
        `IFC schema changed from ${rewritten.schema} to ${verified.schema} during export.`,
      );
    }
    return {
      bytes: rewritten.savedBytes,
      schema: verified.schema,
    };
  }

  /**
   * Replaces owned mission annotations from the supplied mapped graphs.
   *
   * This preserves the run-1 graph-level API while changing its mutation
   * semantics from append-only writing to the same duplicate-free replacement
   * used by the application export path.
   */
  async writeMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc> {
    const replaced = await this.replaceGraphsAndReimport(
      source,
      sourceModelId,
      graphs,
    );
    const expectedMissionIds = graphs
      .map((graph) => graph.missionId)
      .sort((left, right) => left.localeCompare(right));
    const actualMissionIds = replaced.imported.missions
      .map((mission) => mission.id)
      .sort((left, right) => left.localeCompare(right));
    if (
      JSON.stringify(expectedMissionIds) !== JSON.stringify(actualMissionIds)
    ) {
      throw new IfcMissionReplacementError([
        {
          code: "IFC_REIMPORT_MISSION_COLLECTION_MISMATCH",
          message: `Reimported mission IDs ${JSON.stringify(actualMissionIds)} do not match intended graph IDs ${JSON.stringify(expectedMissionIds)}.`,
        },
      ]);
    }
    return { bytes: replaced.bytes, schema: replaced.schema };
  }

  /**
   * Replaces the complete recognized application-owned mission graph.
   *
   * Mutation happens only inside the first isolated web-ifc runtime. The
   * replacer finishes all deletion-safety and identity preflight checks before
   * its first DeleteLine call. Bytes are returned only after a second runtime
   * has verified the written records, reimported the owned graph, and compared
   * its domain semantics with the caller's authoritative mission collection.
   */
  async replaceMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    missions: readonly RobotMission[],
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc> {
    if (!source.byteLength) {
      throw new IfcModelExportError("The IFC source is empty.");
    }
    const mappedMissions = missions.map(mapMissionToIfcRecords);
    if (JSON.stringify(mappedMissions) !== JSON.stringify(graphs)) {
      throw new IfcModelExportError(
        "Mission replacement graphs do not match the authoritative mission collection.",
      );
    }
    const replaced = await this.replaceGraphsAndReimport(
      source,
      sourceModelId,
      graphs,
    );
    const comparison = compareRobotMissionsSemantically(
      missions,
      replaced.imported.missions,
    );
    if (!comparison.equal) {
      throw new IfcMissionReplacementError(
        comparison.differences.map((difference) =>
          this.semanticDifferenceIssue(difference),
        ),
      );
    }
    return { bytes: replaced.bytes, schema: replaced.schema };
  }

  /** Performs the shared authoritative graph replacement and fresh reimport. */
  private async replaceGraphsAndReimport(
    source: Uint8Array,
    sourceModelId: string,
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<ReimportedReplacement> {
    if (!source.byteLength) {
      throw new IfcModelExportError("The IFC source is empty.");
    }
    const replacer = new WebIfcMissionReplacer();
    const rewritten = await this.runPass(
      source,
      true,
      (api, modelId, sourceSchema) =>
        replacer.replace(
          api as unknown as IfcMissionReplacementApiPort,
          modelId,
          sourceModelId,
          graphs,
          normalizeMissionIfcSchema(sourceSchema),
        ),
    );
    if (!rewritten.savedBytes?.byteLength) {
      throw new IfcModelExportError("web-ifc produced an empty IFC file.");
    }
    const verified = await this.runPass(
      rewritten.savedBytes,
      false,
      (api, modelId, sourceSchema) => {
        normalizeMissionIfcSchema(sourceSchema);
        const replacementApi = api as unknown as IfcMissionReplacementApiPort;
        this.verifyReplacementRecords(
          replacementApi,
          modelId,
          rewritten.result,
        );
        return new WebIfcMissionReader().read(
          replacementApi,
          modelId,
          sourceModelId,
          sourceSchema,
        );
      },
    );
    if (verified.schema !== rewritten.schema) {
      throw new IfcModelExportError(
        `IFC schema changed from ${rewritten.schema} to ${verified.schema} during export.`,
      );
    }
    const blockingIssues = verified.result.issues.filter(
      (entry) => entry.severity === "error" || entry.kind === "compatibility",
    );
    if (blockingIssues.length) {
      throw new IfcMissionReplacementError(
        blockingIssues.map((entry) => ({
          code: `IFC_REIMPORT_${entry.code}`,
          message: `Reimport after replacement: ${entry.message}`,
          expressId: entry.expressId,
          entityType: entry.ifcEntityType,
          missionId: entry.missionId,
        })),
      );
    }
    return {
      bytes: rewritten.savedBytes,
      schema: verified.schema,
      imported: verified.result,
    };
  }

  /** Verifies the replacement manifest without assuming any generated graph. */
  private verifyReplacementRecords(
    api: IfcMissionReplacementApiPort,
    modelId: number,
    manifest: IfcMissionReplacementManifest,
  ): void {
    const lineIds = api.GetAllLines(modelId);
    const existingExpressIds = new Set<number>();
    for (let index = 0; index < lineIds.size(); index += 1) {
      existingExpressIds.add(lineIds.get(index));
    }
    const survivingRemovedIds = manifest.removedExpressIds.filter((expressId) =>
      existingExpressIds.has(expressId),
    );
    if (survivingRemovedIds.length) {
      throw new IfcMissionReplacementError(
        survivingRemovedIds.map((expressId) => ({
          code: "IFC_REMOVED_ENTITY_STILL_PRESENT",
          message: `Obsolete application-owned entity #${expressId} remains after replacement serialization.`,
          expressId,
        })),
      );
    }
    if (!manifest.graph && !manifest.writeManifest) return;
    if (!manifest.graph || !manifest.writeManifest) {
      throw new IfcModelExportError(
        "Mission replacement produced an incomplete verification manifest.",
      );
    }
    new WebIfcMissionWriter().verify(
      api,
      modelId,
      manifest.graph,
      manifest.writeManifest,
    );
  }

  /** Converts one semantic mismatch into the exporter's structured issue form. */
  private semanticDifferenceIssue(
    difference: RobotMissionSemanticDifference,
  ): IfcMissionReplacementIssue {
    return {
      code: "IFC_REIMPORT_SEMANTIC_MISMATCH",
      message: difference.message,
      recordIdentity: difference.path,
    };
  }

  /**
   * Runs one isolated parse and optionally serializes its open IFC model.
   *
   * @param bytes IFC STEP bytes to inspect.
   * @param save Whether this pass should emit rewritten IFC bytes.
   * @returns Parsed schema and optional serialized output.
   */
  private async runPass<Result = undefined>(
    bytes: Uint8Array,
    save: boolean,
    operation?: IfcPassOperation<Result>,
  ): Promise<ParsedIfcPass<Result>> {
    const api = this.options.createApi?.() ?? new IfcAPI();
    let initialized = false;
    let modelId = -1;
    try {
      api.SetWasmPath(this.options.wasmPath, this.options.wasmAbsolute);
      await api.Init(this.options.customLocateFileHandler, true);
      initialized = true;
      modelId = api.OpenModel(bytes);
      if (modelId < 0 || !api.IsModelOpen(modelId)) {
        throw new IfcModelExportError("web-ifc could not open the IFC model.");
      }
      const schema = api.GetModelSchema(modelId).trim();
      if (!schema) {
        throw new IfcModelExportError(
          "The IFC model has no recognized schema.",
        );
      }
      if (api.GetAllLines(modelId).size() === 0) {
        throw new IfcModelExportError(
          "The IFC model contains no entity lines.",
        );
      }
      const result = operation
        ? operation(api, modelId, schema)
        : (undefined as Result);
      return {
        schema,
        savedBytes: save ? api.SaveModel(modelId) : undefined,
        result,
      };
    } catch (error) {
      if (error instanceof IfcModelExportError) throw error;
      throw new IfcModelExportError(
        `IFC structural validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (modelId >= 0 && api.IsModelOpen(modelId)) {
        api.CloseModel(modelId);
      }
      if (initialized) api.Dispose();
    }
  }
}
