/**
 * Single esbuild entry point for the robot-mission architecture test suite.
 *
 * The project uses Node's built-in test runner rather than adding another test
 * framework. Importing each focused suite lets the existing package script
 * bundle TypeScript once and execute every registered `node:test` case.
 */
import "./robot-mission-domain.test";
import "./ifc-relation-mapper.test";
import "./ifc-model-export.test";
import "./ifc-mission-writer.test";
import "./ifc-mission-replacer.test";
import "./ifc-mission-export.integration.test";
import "./ifc-mission-replacement.integration.test";
import "./ifc-mission-reader.test";
import "./import-robot-missions.test";
import "./robot-mission-semantic-comparison.test";
import "./robot-mission-persistence.test";
import "./robot-mission-service.test";
import "./selectable-mission-repository.test";
import "./selection-candidate-source.test";
import "./viewer-selection-adapter.test";
import "./viewer-object-selection-manager.test";
