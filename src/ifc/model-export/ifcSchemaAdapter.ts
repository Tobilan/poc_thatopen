import { IFC4, IFC4X3 } from "web-ifc";
import { IfcModelExportError } from "./ifcModelExportError";

/** Canonical schema families supported by mission-aware IFC serialization. */
export type SupportedMissionIfcSchema = "IFC4" | "IFC4X3";

/** Runtime constructor namespace used for one canonical schema family. */
export type MissionIfcSchemaNamespace = typeof IFC4 | typeof IFC4X3;

/** IFC 4.3 header names recognized by the installed web-ifc schema bundle. */
const IFC4X3_SCHEMA_NAMES = new Set(["IFC4X3", "IFC4X3_ADD1", "IFC4X3_ADD2"]);

/**
 * Normalizes one source schema without changing the source file's header.
 *
 * `web-ifc` exposes one IFC4X3 constructor namespace for the published IFC 4.3
 * schema and its supported release-candidate/addendum aliases. Normalization is
 * used only to select constructors; the codec separately verifies that the
 * exact source schema string survives serialization.
 *
 * @param sourceSchema Schema name reported by web-ifc for the opened source.
 * @returns Canonical constructor family used by the mission writer.
 * @throws IfcModelExportError When the source schema is unsupported.
 */
export const normalizeMissionIfcSchema = (
  sourceSchema: string,
): SupportedMissionIfcSchema => {
  const normalized = sourceSchema.trim().toUpperCase();
  if (normalized === "IFC4") return "IFC4";
  if (IFC4X3_SCHEMA_NAMES.has(normalized)) return "IFC4X3";
  throw new IfcModelExportError(
    `Mission-aware IFC export supports IFC4 and IFC4X3 only; received ${normalized || "an unknown schema"}.`,
  );
};

/**
 * Selects the generated web-ifc constructors for a canonical schema family.
 *
 * @param schema Canonical schema returned by normalizeMissionIfcSchema.
 * @returns Runtime namespace containing entity, value, and enum constructors.
 */
export const getMissionIfcSchemaNamespace = (
  schema: SupportedMissionIfcSchema,
): MissionIfcSchemaNamespace => (schema === "IFC4" ? IFC4 : IFC4X3);
