/**
 * Public IFC-like mapping API for the new RobotMission domain model.
 *
 * This module exports typed intermediate records and a pure mapper only. It does
 * not expose STEP serialization, file mutation, import, or legacy roundtrip APIs.
 */
export * from "./annotationSchema";
export * from "./mapper";
export * from "./records";
