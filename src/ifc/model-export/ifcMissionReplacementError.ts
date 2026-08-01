import { IfcModelExportError } from "./ifcModelExportError";

/** Stable machine-readable reasons why an owned graph cannot be replaced. */
export interface IfcMissionReplacementIssue {
  code: string;
  message: string;
  expressId?: number;
  referrerExpressId?: number;
  entityType?: string;
  missionId?: string;
  recordIdentity?: string;
}

/** Export failure retaining every preflight issue without parsing prose. */
export class IfcMissionReplacementError extends IfcModelExportError {
  constructor(readonly issues: readonly IfcMissionReplacementIssue[]) {
    super(
      `Robot mission annotations cannot be replaced: ${issues
        .map((issue) => issue.message)
        .join(" ")}`,
    );
    this.name = "IfcMissionReplacementError";
  }
}
