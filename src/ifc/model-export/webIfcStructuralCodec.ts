import { IfcAPI } from "web-ifc";
import type { LocateFileHandlerFn } from "web-ifc";
import type { IfcRobotMissionRecordGraph } from "../robot-tasks";
import { IfcModelExportError } from "./ifcModelExportError";
import { normalizeMissionIfcSchema } from "./ifcSchemaAdapter";
import {
  WebIfcMissionWriter,
  type IfcMissionWriterApiPort,
} from "./webIfcMissionWriter";

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
   * Writes mapped robot missions into a source IFC and independently verifies them.
   *
   * @param source Original retained IFC STEP bytes.
   * @param sourceModelId Runtime model ID used by local object references.
   * @param graphs Valid mission graphs produced by the pure IFC mapper.
   * @returns IFC bytes containing source data and all supplied missions.
   */
  writeMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
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
   * Adds mapped mission records before the existing save-and-reopen validation.
   *
   * Every graph is written into the same isolated source model. The second pass
   * verifies both STEP parseability and every generated task/relation attribute.
   */
  async writeMissionsAndValidate(
    source: Uint8Array,
    sourceModelId: string,
    graphs: readonly IfcRobotMissionRecordGraph[],
  ): Promise<StructurallyValidatedIfc> {
    if (!graphs.length) return this.rewriteAndValidate(source);
    if (!source.byteLength) {
      throw new IfcModelExportError("The IFC source is empty.");
    }
    const writer = new WebIfcMissionWriter();
    const rewritten = await this.runPass(
      source,
      true,
      (api, modelId, sourceSchema) => {
        const schema = normalizeMissionIfcSchema(sourceSchema);
        const writerApi = api as unknown as IfcMissionWriterApiPort;
        return graphs.map((graph) =>
          writer.write(writerApi, modelId, sourceModelId, graph, schema),
        );
      },
    );
    if (!rewritten.savedBytes?.byteLength) {
      throw new IfcModelExportError("web-ifc produced an empty IFC file.");
    }
    const verified = await this.runPass(
      rewritten.savedBytes,
      false,
      (api, modelId, sourceSchema) => {
        normalizeMissionIfcSchema(sourceSchema);
        const writerApi = api as unknown as IfcMissionWriterApiPort;
        graphs.forEach((graph, index) => {
          writer.verify(writerApi, modelId, graph, rewritten.result[index]);
        });
      },
    );
    if (verified.schema !== rewritten.schema) {
      throw new IfcModelExportError(
        `IFC schema changed from ${rewritten.schema} to ${verified.schema} during export.`,
      );
    }
    return { bytes: rewritten.savedBytes, schema: verified.schema };
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
