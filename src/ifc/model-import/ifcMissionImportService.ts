import { IfcAPI } from "web-ifc";
import type { LocateFileHandlerFn } from "web-ifc";
import { IfcMissionImportError } from "./ifcMissionImportError";
import type { IfcMissionImportResult } from "./ifcMissionImportTypes";
import {
  WebIfcMissionReader,
  type IfcMissionReaderApiPort,
} from "./webIfcMissionReader";

/** web-ifc lifecycle surface owned only by the byte-level import service. */
export interface IfcMissionImportApiPort extends IfcMissionReaderApiPort {
  SetWasmPath(path: string, absolute?: boolean): void;
  Init(
    customLocateFileHandler?: LocateFileHandlerFn,
    forceSingleThread?: boolean,
  ): Promise<void>;
  OpenModel(data: Uint8Array): number;
  IsModelOpen(modelId: number): boolean;
  GetModelSchema(modelId: number): string;
  CloseModel(modelId: number): void;
  Dispose(): void;
}

/** Runtime configuration for isolated read-only IFC mission import. */
export interface IfcMissionImportServiceOptions {
  wasmPath: string;
  wasmAbsolute?: boolean;
  customLocateFileHandler?: LocateFileHandlerFn;
  createApi?: () => IfcMissionImportApiPort;
}

/** Opens IFC bytes in an isolated web-ifc runtime and delegates graph reading. */
export class IfcMissionImportService {
  constructor(private readonly options: IfcMissionImportServiceOptions) {}

  async import(
    source: Uint8Array,
    sourceModelId: string,
  ): Promise<IfcMissionImportResult> {
    if (!source.byteLength) {
      throw new IfcMissionImportError("The IFC source is empty.");
    }
    if (!sourceModelId.trim()) {
      throw new IfcMissionImportError("A runtime source modelId is required.");
    }

    const api = this.options.createApi?.() ?? new IfcAPI();
    let initialized = false;
    let modelId = -1;
    try {
      api.SetWasmPath(this.options.wasmPath, this.options.wasmAbsolute);
      await api.Init(this.options.customLocateFileHandler, true);
      initialized = true;
      modelId = api.OpenModel(source);
      if (modelId < 0 || !api.IsModelOpen(modelId)) {
        throw new IfcMissionImportError(
          "web-ifc could not open the IFC model.",
        );
      }
      const schema = api.GetModelSchema(modelId).trim();
      if (!schema) {
        throw new IfcMissionImportError(
          "The IFC model has no recognized schema.",
        );
      }
      return new WebIfcMissionReader().read(
        api,
        modelId,
        sourceModelId,
        schema,
      );
    } catch (error) {
      if (error instanceof IfcMissionImportError) throw error;
      throw new IfcMissionImportError(
        `IFC mission import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (modelId >= 0 && api.IsModelOpen(modelId)) api.CloseModel(modelId);
      if (initialized) api.Dispose();
    }
  }
}
