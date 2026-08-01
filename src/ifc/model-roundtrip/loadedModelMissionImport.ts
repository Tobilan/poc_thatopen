import type {
  IfcMissionLoadSummary,
  IfcMissionRoundtripCoordinator,
} from "./ifcMissionRoundtripCoordinator";

/** Viewer file formats with deliberately different mission-import behavior. */
export type LoadedModelFormat = "direct-ifc" | "fragments";

/**
 * Applies the browser composition rule that only direct IFC bytes are parsed.
 * Pure Fragments models remain render-only and never enter the IFC importer.
 */
export const importLoadedModelMissions = (
  coordinator: IfcMissionRoundtripCoordinator,
  format: LoadedModelFormat,
  modelId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<IfcMissionLoadSummary | undefined> => {
  if (format === "fragments") return Promise.resolve(undefined);
  return coordinator.importLoadedModel(modelId, fileName, bytes);
};
