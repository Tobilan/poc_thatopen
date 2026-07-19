/**
 * Single esbuild entry point for the robot-mission architecture test suite.
 *
 * The project uses Node's built-in test runner rather than adding another test
 * framework. Importing each focused suite lets the existing package script
 * bundle TypeScript once and execute every registered `node:test` case.
 */
import "./robot-mission-domain.test";
import "./robot-mission-persistence.test";
import "./robot-mission-service.test";
import "./viewer-selection-adapter.test";
