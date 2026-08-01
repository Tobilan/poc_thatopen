import type { RobotMission } from "../../domain/robot-tasks";

/** Import findings are grouped by their origin so callers never parse messages. */
export type IfcMissionImportIssueKind =
  | "malformed-ifc-graph"
  | "domain-validation"
  | "compatibility";

/** Blocking errors suppress one mission; warnings preserve the reconstructed value. */
export type IfcMissionImportIssueSeverity = "error" | "warning";

/** Structured diagnostic produced while detecting or rebuilding robot missions. */
export interface IfcMissionImportIssue {
  code: string;
  severity: IfcMissionImportIssueSeverity;
  kind: IfcMissionImportIssueKind;
  message: string;
  ifcEntityType?: string;
  expressId?: number;
  missionId?: string;
  taskId?: string;
}

/** Identity retained outside the domain for a later duplicate-free IFC update. */
export interface IfcMissionEntityProvenance {
  missionId: string;
  recordIdentity?: string;
  entityType: string;
  expressId: number;
  globalId?: string;
  ownerId?: string;
}

/** Source-scoped infrastructure metadata for every recognized owned entity. */
export interface IfcMissionRoundtripProvenance {
  sourceModelId: string;
  entities: IfcMissionEntityProvenance[];
}

/** Complete read-only result returned for one IFC source model. */
export interface IfcMissionImportResult {
  missions: RobotMission[];
  issues: IfcMissionImportIssue[];
  provenance: IfcMissionRoundtripProvenance;
  schema: string;
}
