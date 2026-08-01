# IM PVS IFC Viewer

Browser-based IFC and Fragments viewer for annotating building elements with structured robot missions. The project is a proof of concept developed in the context of a master's thesis. It combines performant BIM visualization with a domain model for robot tasks and a schema-aware IFC-STEP export.

The central modeling decision is:

> IFC provides the structural entities and relations. Concrete robotics action semantics are stored as custom properties on `IfcTask`.

A mission is therefore not stored as an ad-hoc property on a door or wall. It becomes a parent `IfcTask`, its executable steps become child `IfcTask` entities, and the referenced building objects retain their original IFC identity.

## Project status and scope

The repository implements an end-to-end proof of concept for:

- loading IFC and Fragments models in a browser;
- rendering large models through That Open Fragments;
- inspecting and selecting IFC objects, including overlapping geometry;
- authoring robot missions and ordered executable tasks;
- persisting the internal mission model in memory or browser `localStorage`;
- validating task semantics and dependency graphs;
- mapping missions to IFC entities and relations;
- importing recognized mission annotations from directly loaded IFC files into the active repository;
- writing missions into source-backed IFC4/IFC4X3 STEP files;
- reopening and verifying the generated IFC before it is downloaded.

This is not a general-purpose IFC editor or robot control system. Path planning, physical robot execution, multi-user synchronization, backend persistence, arbitrary `.frag`-to-IFC reconstruction, and a lossless IFC round trip for structural model edits are outside the current PoC.

## Technology stack

| Area                                  | Technology                                           |
| ------------------------------------- | ---------------------------------------------------- |
| Language and build                    | TypeScript, Vite, Node.js/npm                        |
| 3D rendering                          | Three.js                                             |
| BIM components                        | `@thatopen/components`, `@thatopen/components-front` |
| High-performance model representation | `@thatopen/fragments`                                |
| IFC parsing and STEP writing          | `web-ifc`                                            |
| UI                                    | `@thatopen/ui`, `@thatopen/ui-obc`                   |
| Tests                                 | Node.js test runner, bundled with esbuild            |

## Quick start

### Requirements

- Node.js LTS
- npm
- a current Chrome or Edge browser

### Install and run

```bash
npm install
npm run dev
```

Vite normally serves the application at `http://localhost:5173` and prints the exact URL in the terminal.

### Production build

```bash
npm run build
npm run preview
```

## IFC models used for annotation

The repository contains two IFC4 reference models in [`IFC/`](IFC/):

| File                                       | Approximate size | Source model indicated by the IFC header        | Intended use                            |
| ------------------------------------------ | ---------------: | ----------------------------------------------- | --------------------------------------- |
| [`01_Haus.ifc`](IFC/01_Haus.ifc)           |         2.45 MiB | FZK-Haus / Archicad 20                          | Smaller residential test model          |
| [`03_Institute.ifc`](IFC/03_Institute.ifc) |        10.43 MiB | Institute/office building variant / Archicad 20 | Larger performance and annotation model |

Both files declare `FILE_SCHEMA(('IFC4'))`, which is supported by the mission writer.

The application does not hard-code either file. Use **Models → Add → IFC** and choose the desired model from the local filesystem. Any directly imported, supported IFC can be annotated. The bundled files are reproducible examples for development and evaluation.

When an IFC is imported:

1. `web-ifc` parses the source IFC.
2. That Open converts it to a Fragments model for browser rendering.
3. The original IFC bytes and file name are retained in an in-memory source registry.
4. The mission importer reconstructs recognized project-owned annotations and bulk-upserts valid missions into the active repository without clearing unrelated missions.
5. Robot tasks refer to selected IFC objects primarily by `GlobalId` and retain the source `modelId` for roundtrip scoping.
6. Export replaces the selected source's mission graph, verifies it, and advances the in-memory source to those verified bytes for the next cycle.

An imported `.frag` file can be viewed, but it has no retained IFC source and therefore cannot currently be exported as a trustworthy IFC file.

## GUI features

The main layout contains the model panel, 3D viewport, selection data, robot mission editor, and viewpoint panel.

### Model loading and export

- Load local `.ifc` files and convert them to Fragments for rendering.
- Load existing `.frag` files directly.
- Display and search loaded models.
- Select a source-backed IFC model as the export target.
- Import valid mission annotations after a direct IFC has loaded and refresh the existing mission editor.
- Export the selected model only with missions associated with that source, plus unassigned missions whose explicit references belong to it.
- Report unsupported sources, structural edits, invalid missions, and unresolved object references instead of producing a misleading file.

### 3D viewer

- Orbit, pan, zoom, and focus the camera.
- Switch between perspective and orthographic projection.
- Toggle the world grid.
- Ambient occlusion, edge rendering, and Fragments level-of-detail materials.
- Show all, hide selected, or isolate selected components.
- Toggle a transparent “ghost” representation of the model.
- Apply persistent highlight colors to selected components.
- Create clipping sections.
- Measure length and area.

Selection is paused while measurement or clipping tools are active so tool input cannot accidentally change a robot-task target.

### IFC object selection

The selection workflow is designed for dense BIM geometry where several objects may lie under the same cursor position:

- worker-backed raycasts query all loaded Fragments models;
- hits are ordered by distance and deduplicated;
- clipped and optionally hidden objects are excluded;
- IFC metadata is resolved in batches;
- overlapping candidates can be previewed, cycled, and explicitly confirmed;
- keyboard controls support arrow keys, Enter, and Escape;
- filters can show visible objects only and exclude `IfcSpace` or opening elements;
- hover, candidate, and confirmed-selection highlights use separate styles;
- late asynchronous raycast results cannot overwrite a newer selection.

The confirmed selection is converted to a domain-level `RobotObjectReference`. A durable IFC `GlobalId` is preferred. A model-scoped `expressId` is accepted only as a fallback when it can be associated with the correct source model.

### Selection data

- Show the selected element's IFC properties in a structured table.
- Search and expand property rows.
- Display selection metadata such as IFC class, `GlobalId`, `expressId`, name, and hit distance.
- Export displayed property data as TSV.

### Robot mission editor

- Select the active storage mode.
- Create, select, and delete complete missions.
- Add and delete executable tasks.
- Choose one of the supported action types.
- Assign the confirmed IFC object as a target, affected object, MOVE start, or MOVE destination.
- Edit schedule start, finish, duration, and completion.
- Move tasks up or down; the UI regenerates a linear `FINISH_START` dependency chain.
- Show mission-level and task-level validation feedback.
- Save incomplete authoring drafts while preventing invalid missions from being exported.

The domain supports additional fields such as task descriptions, status, priority, action preconditions/postconditions, viewpoints, and marker positions. Not all of those fields currently have dedicated controls in the mission panel, but they are available through the TypeScript application service and are preserved by persistence and IFC mapping.

### Viewpoints

- Create a viewpoint from the current camera.
- Include the confirmed selection and persistent component colors.
- Use the selected object's name as the viewpoint title when available.
- List the created viewpoints through the That Open viewpoint table.

The standalone viewpoint panel and the optional `RobotTask.viewpoint` annotation field are currently separate concepts; automatic attachment of a newly created viewer viewpoint to a task is a future UI enhancement.

## Typical annotation workflow

1. Start the application and import an IFC file through the Models panel.
2. Existing valid robot missions are imported into the currently selected storage mode and become editable immediately. A file without annotations is a normal load.
3. Choose **No storage** for a temporary draft or **Local storage** for browser persistence before loading if imported missions should use that mode, then create or select a mission.
4. Add an executable task such as `OPEN` or `NAVIGATE_TO`.
5. Click an IFC object in the viewer.
6. If several objects overlap, select and confirm the intended candidate.
7. Assign the confirmed object to the task in the correct semantic role.
8. Add further tasks and arrange their execution order.
9. Resolve every blocking validation issue.
10. Select the source-backed model and press **Export IFC**.

The downloaded `<source-name>-export.ifc` contains the original building model plus the generated mission structure.

## Robot mission domain model

The internal TypeScript model is the application's source of truth. It is intentionally independent of Three.js, Fragments IDs, browser storage, and STEP syntax.

```mermaid
classDiagram
  class RobotMission {
    +string id
    +string name
    +RobotTaskStatus status
    +RobotTaskPriority priority
    +RobotTask[] tasks
    +RobotTaskSequence[] sequences
    +RobotMissionSchedule schedule
    +string createdAt
    +string updatedAt
  }

  class RobotTask {
    +string id
    +string name
    +RobotActionType actionType
    +RobotObjectReference[] targetObjects
    +RobotObjectReference[] affectedObjects
    +RobotObjectReference startReference
    +RobotObjectReference targetReference
    +RobotActionProperties properties
    +RobotTaskTime time
    +TaskViewpoint viewpoint
    +number[3] markerPosition
  }

  class RobotTaskSequence {
    +string id
    +string predecessorTaskId
    +string successorTaskId
    +RobotTaskSequenceType sequenceType
  }

  class RobotObjectReference {
    +string globalId
    +string modelId
    +number expressId
    +string ifcClass
    +string name
  }

  RobotMission "1" *-- "0..*" RobotTask : hierarchy
  RobotMission "1" *-- "0..*" RobotTaskSequence : execution dependencies
  RobotTask --> RobotObjectReference : target / affected / movement
```

### Mission

A `RobotMission` is an aggregate root containing:

- a stable ID, name, optional description, status, and priority;
- executable child tasks;
- explicit sequence relations between those tasks;
- optional mission schedule metadata;
- creation and modification timestamps.

The order of `tasks` represents hierarchy/display order. Execution dependencies are stored separately in `sequences`. This prevents task nesting from being incorrectly interpreted as temporal order.

### Task

A `RobotTask` contains the executable semantics:

- `actionType`;
- direct targets and indirectly affected objects;
- MOVE start and destination references;
- status and priority;
- direct task timing;
- task-owned robot action properties;
- optional viewpoint and marker annotation data;
- audit timestamps.

Supported action values are:

```text
OPEN
CLOSE
SWITCH_ON
SWITCH_OFF
MOVE
PASS_THROUGH
NAVIGATE_TO
```

These are project-specific robotics values, not native IFC enums.

### Object identity

`RobotObjectReference` keeps the domain coupled to IFC identity rather than rendering identity:

- `GlobalId` is the preferred persistent reference;
- `modelId + expressId` is a model-local fallback;
- `ifcClass` and `name` provide validation and presentation metadata;
- action semantics are never copied onto the referenced building object.

This allows the same door to be referenced by one `OPEN` task and a later `CLOSE` task without changing the door's static properties.

### Validation

Validation reports blocking errors and non-blocking warnings. Important rules include:

- mission and task IDs/names are required;
- a mission intended for execution/export needs at least one task;
- each task needs a supported `actionType`;
- object-oriented actions need a target or suitable reference;
- `OPEN`/`CLOSE` should reference a door-like object;
- `SWITCH_ON`/`SWITCH_OFF` should reference a switch-like object;
- MOVE requires both a start and destination;
- sequence endpoints must exist;
- a task cannot depend on itself;
- dependency graphs must be acyclic;
- completion must be between `0` and `1`;
- concrete RobotAction data must be attached to the task, not an IFC object reference.

When IFC type metadata is unavailable, type plausibility is reported as a warning rather than automatically invalidating an otherwise usable task.

## Resulting IFC mission model

The pure mapper first converts a valid domain mission into typed, IFC-like records. A separate writer resolves those records into schema-specific `web-ifc` entities. This separation keeps domain rules testable without loading WASM or mutating an IFC file.

```mermaid
flowchart TD
  WS[IfcWorkSchedule] -->|IfcRelAssignsToControl| M[IfcTask: RobotMission]
  M -->|IfcRelNests| T1[IfcTask: executable task 1]
  M -->|IfcRelNests| T2[IfcTask: executable task 2]
  T1 -->|IfcRelSequence FINISH_START| T2

  T1 -->|TaskTime attribute| TT[IfcTaskTime]
  T1 -->|IfcRelDefinesByProperties| RA[IfcPropertySet: RobotAction]
  T1 -->|IfcRelDefinesByProperties| RT[IfcPropertySet: RobotTask]
  M -->|IfcRelDefinesByProperties| RM[IfcPropertySet: RobotMission]

  T1 -->|IfcRelAssignsToProcess| O1[Existing IFC target or context object]
  T2 -->|MOVE_FROM / IfcRelAssignsToProcess| O2[Existing IFC start reference]
  T2 -->|MOVE_TO / IfcRelAssignsToProduct| O3[Existing IFC destination]
```

### Mapping overview

| Internal concept         | IFC result                                              |
| ------------------------ | ------------------------------------------------------- |
| Mission                  | Parent `IfcTask`, `ObjectType = RobotMission`           |
| Executable step          | Child `IfcTask`, `ObjectType = RobotTask`               |
| Mission hierarchy        | `IfcRelNests`                                           |
| Task dependency          | `IfcRelSequence`, domain ID in `Name`                   |
| Task timing              | Direct `IfcTask.TaskTime → IfcTaskTime`                 |
| Mission plan             | `IfcWorkSchedule` + `IfcRelAssignsToControl`            |
| Direct interaction       | `IfcRelAssignsToProcess`, usually `OPERATES_ON`         |
| Indirect effect          | `IfcRelAssignsToProcess`, `AFFECTS`                     |
| Passage/navigation       | `PASSES_THROUGH` or `NAVIGATES_TO` relation name        |
| MOVE origin              | `IfcRelAssignsToProcess`, `MOVE_FROM`                   |
| MOVE destination         | `IfcRelAssignsToProduct`, `MOVE_TO`                     |
| Concrete action          | Task-owned `IfcPropertySet` named `RobotAction`         |
| Task annotation metadata | Task-owned `IfcPropertySet` named `RobotTask`           |
| Mission audit metadata   | Parent-task-owned `IfcPropertySet` named `RobotMission` |

`RobotAction` contains `ActionType` and optional values such as `TargetState`, `RequiredCapability`, `Preconditions`, `Postconditions`, and `SuccessCondition`. The custom property-set names intentionally do not use the reserved `Pset_` prefix.

Status is written to `IfcTask.Status`; domain priorities map from `low`, `medium`, `high`, and `critical` to IFC integer priorities `1` through `4`. `RobotTask` preserves task creation/update times plus optional camera and marker coordinates, while `RobotMission` preserves mission creation/update times. The mission-owned `RobotMission` property set also stores `AnnotationSchemaVersion = "1.0.0"` and `HasExplicitSchedule = true | false`. A work schedule remains structural infrastructure for every mission; when `HasExplicitSchedule` is false, import does not expose that generated fallback as an authored domain schedule.

Existing target objects are resolved against the selected source IFC by `GlobalId`, with a source-model-scoped `expressId` fallback. References that are missing, ambiguous, or incompatible with the required IFC select type stop the export. Recognized records representing the same deterministic domain concept retain their existing IFC GlobalId when recreated. New concepts receive new GlobalIds, while every recreated record receives a fresh serialization-local express ID. Existing building-object GlobalIds are never replaced by this annotation operation.

## IFC export pipeline

```mermaid
flowchart LR
  A[Direct IFC import] --> B[Retained source IFC bytes]
  B --> C[Detect owned graphs and provenance]
  D[Current RobotMission collection] --> E[Pure IFC record mapper]
  C --> F[Preflight complete replacement]
  E --> F
  F --> G[Delete and recreate only owned graph]
  G --> H[Save IFC STEP]
  H --> I[Fresh web-ifc instance reopens output]
  I --> J[Structural verification and mission reimport]
  J --> K[Semantic comparison]
  K --> L[Browser download]
```

The exporter currently supports `IFC4`, `IFC4X3`, `IFC4X3_ADD1`, and `IFC4X3_ADD2`. `IFC2X3` is rejected because the mission writer does not perform a schema conversion.

Export is a full replacement of the recognized application-owned annotation graph, not an append operation. The source-scoped mission collection is authoritative for the selected IFC: matching mission IDs are updated, new IDs are added, and an imported owned mission omitted from the collection is removed. Repeated import/export cycles therefore do not accumulate duplicate tasks, schedules, property sets, or relations. Only after save/reopen/reimport and semantic comparison succeed do the verified output bytes become the source of the next browser export.

Mission/source association is infrastructure metadata, not part of `RobotMission`. An imported mission is associated with its runtime source model and the storage mode active during import. A mission already associated with another loaded IFC is excluded from the selected target. A newly authored, unassigned mission is claimed by the selected target only after a successful export, and any explicit object reference to another `modelId` blocks that export. Switching storage modes never copies data; it also blocks export of a source associated with a different mode until the original mode is active again.

The replacement boundary is deliberately narrow. Only entities identified by the importer as belonging to a complete `RobotMission` graph and associated with deterministic provenance may be removed. Building entities, building-object GlobalIds, unrelated `IfcTask`/`IfcWorkSchedule` process plans, unrelated property sets, unrelated relations, the source header, and the source schema remain outside that ownership boundary.

Export safety rules:

- only models with a retained direct IFC source are exportable;
- arbitrary `.frag` files are view-only for IFC export purposes;
- a source with malformed recognized annotations remains viewable but is unsafe for mission export until a corrected IFC is reloaded;
- mission/source association and the active storage mode must match the selected export target;
- structural Fragments edits mark the source-backed model as unsafe to export;
- every current mission must pass domain validation;
- duplicate mission, task, deterministic record, provenance, or preserved GlobalId claims stop replacement;
- every referenced object must resolve in the selected source IFC;
- before deletion, every IFC line is inspected for incoming references to the owned deletion set;
- an unknown external relation or unsupported external property set referencing an owned entity blocks export;
- a new object assignment cannot treat an owned entity scheduled for replacement as an external target;
- all ownership, identity, reference, GlobalId, and replacement-line checks finish before the first `DeleteLine` call;
- replacement runs in an isolated `web-ifc` model, so a failure returns no partial output and leaves the retained source bytes unchanged;
- the fresh-runtime pass confirms that every obsolete express ID is actually absent;
- the saved output must reopen with the same schema and contain exactly one owned graph per current mission ID;
- every generated entity and relation is verified, missions are reimported, and export fails if semantic comparison differs from the intended aggregates.

## IFC mission import

The read path is separate from source-backed export and does not parse STEP text. `IfcMissionImportService` owns the isolated `web-ifc` runtime and source-byte lifecycle; `WebIfcMissionReader` reads entities, detects project-owned graphs, validates their relations, reconstructs domain aggregates, and runs the existing domain validation. After a direct IFC is successfully rendered and its source bytes are registered, the browser orchestration invokes this importer and uses the existing `importRobotMissions` bulk-upsert boundary.

```text
IFC bytes
-> isolated web-ifc model
-> project ownership detection
-> graph validation
-> RobotMission reconstruction
-> domain validation
-> structured result and provenance
```

Ownership is intentionally narrow. A mission root must be an `IfcTask` with `ObjectType = RobotMission`, `PredefinedType = USERDEFINED`, and a stable `Identification`. Its children must be connected by one `IfcRelNests`, use `ObjectType = RobotTask` and `PredefinedType = USERDEFINED`, and carry task-owned `RobotAction` and `RobotTask` property sets. The root carries `RobotMission`. Unrelated tasks, schedules, hierarchies, assignments, and property sets are ignored. A file containing no owned mission is a successful empty import.

Each valid aggregate reconstructs mission/task identity, descriptive metadata, status, priority, hierarchy order, explicit dependencies, task time, schedule data, action semantics, task annotations, audit timestamps, and source-scoped object references. Action values are read only from the task-owned `RobotAction` set and are never inferred from building objects. Contradictory or ambiguous relations block only their owning mission; independent valid missions still import.

```ts
interface IfcMissionImportResult {
  missions: RobotMission[];
  issues: IfcMissionImportIssue[];
  provenance: IfcMissionRoundtripProvenance;
  schema: string;
}
```

Provenance remains outside the domain. For recognized application-owned entities it retains mission ownership, entity type, express ID, optional IFC GlobalId, owning mission/task ID, and a deterministic graph-record identity where the current mapping makes one derivable. Replacement joins this identity with newly mapped records to preserve GlobalIds without treating express IDs as persistent identity. The runtime `modelId` scopes every imported local express ID.

Current exports use annotation schema `1.0.0`. A sequence stores its stable domain ID in `IfcRelSequence.Name`; `HasExplicitSchedule` distinguishes authored schedule data from the always-generated `IfcWorkSchedule` infrastructure. Import accepts compatible version `1.x` annotations, rejects malformed values and unsupported major versions, and requires the explicit schedule marker on versioned graphs.

Pre-version files remain readable through documented compatibility behavior:

- without `AnnotationSchemaVersion`, import emits a legacy warning;
- without `IfcRelSequence.Name`, import derives `sequence/<predecessor>/<successor>/<type>` and warns;
- without `HasExplicitSchedule`, import reconstructs the available schedule but warns that authored and generated fallback states cannot be distinguished.

The next successful export writes schema version `1.0.0`, writes the derived compatibility sequence ID explicitly, and writes the schedule marker. Reimporting that normalized file no longer produces those legacy compatibility warnings.

Valid missions replace matching repository IDs while unrelated IDs remain untouched, and imported audit timestamps are preserved until an application command edits the aggregate. Blocking issues suppress their malformed mission; independent valid missions may still import with an explicit partial-success notice. The loaded building remains available, but any blocking import issue marks that source unsafe for mission export. Removing the model unregisters its provenance and safety state without deleting repository missions.

## Storage concept

Mission persistence is separated from model rendering and IFC export through a `RobotMissionRepository` port.

| Mode          | Implementation                       | Lifetime               | Behavior                                          |
| ------------- | ------------------------------------ | ---------------------- | ------------------------------------------------- |
| No storage    | `InMemoryRobotMissionRepository`     | Current page session   | Default; data disappears on reload                |
| Local storage | `LocalStorageRobotMissionRepository` | Browser profile/origin | Explicit opt-in; stores a versioned JSON envelope |
| Backend       | Reserved adapter slot                | Not implemented        | Visible but disabled/unavailable                  |

The local-storage key is:

```text
ifc-viewer:robot-missions:domain-v1
```

Stored shape:

```json
{
  "version": 1,
  "missions": []
}
```

Important storage properties:

- the complete mission aggregate is saved atomically;
- every application-service mutation persists through the active repository;
- stored data is structurally checked before use;
- corrupt JSON or unsupported versions are rejected without being overwritten;
- legacy keys are not read, migrated, or deleted;
- switching storage modes does not copy, merge, or remove missions;
- IFC source bytes remain session-only in the separate `IfcSourceModelRegistry`;
- import and export use the currently active storage mode without switching it automatically;
- unavailable backend storage produces a visible import/export error;
- export reads source-associated missions only from the currently active storage mode.

## Architecture

The project follows a layered, ports-and-adapters-oriented design. Dependencies point toward the domain model; viewer libraries, browser storage, and IFC writing stay at the edges.

```mermaid
flowchart TB
  subgraph UI[Presentation / UI templates]
    Models[Models and export panel]
    SelectionUI[Selection data and candidate chooser]
    MissionUI[Robot mission editor]
    ViewerUI[Viewer tools and viewpoints]
  end

  subgraph Composition[Composition root]
    Main[src/main.ts]
  end

  subgraph Viewer[Viewer adapters]
    Fragments[That Open Fragments raycasting]
    Selection[Selection manager and metadata adapter]
    Provenance[Direct-IFC model provenance]
  end

  subgraph Application[Application layer]
    Service[RobotMissionService]
    RepoPort[RobotMissionRepository port]
  end

  subgraph Domain[Domain layer]
    Types[Mission and task types]
    Builders[Immutable builders and sequencing]
    Validation[Mission validation]
  end

  subgraph Infrastructure[Persistence and IFC infrastructure]
    Repositories[In-memory / localStorage repositories]
    Mapper[Mission-to-IFC record mapper]
    Registry[IFC source registry]
    ExportService[IFC model export service]
    Writer[Schema adapter and web-ifc writer]
    Codec[Save, reopen, and verification codec]
    Importer[Read-only web-ifc mission importer]
    Roundtrip[Source-scoped roundtrip coordinator]
  end

  Main --> Models
  Main --> SelectionUI
  Main --> MissionUI
  Main --> ViewerUI
  Main --> Fragments
  Main --> Selection
  Main --> Provenance
  Main --> Service
  Main --> Repositories
  Main --> Registry
  Main --> ExportService
  Main --> Codec
  Main --> Roundtrip

  MissionUI --> Service
  SelectionUI --> Selection
  Selection --> Fragments
  Selection --> Types
  Service --> Builders
  Service --> Validation
  Service --> RepoPort
  Repositories -. implements .-> RepoPort
  Models --> Roundtrip
  Roundtrip --> RepoPort
  Roundtrip --> Importer
  Roundtrip --> ExportService
  ExportService --> Registry
  ExportService --> Mapper
  ExportService --> Codec
  Codec --> Writer
  Importer --> Types
  Mapper --> Validation
  Mapper --> Types
```

### Layer responsibilities

| Layer            | Main locations                                                 | Responsibility                                                                                   |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Composition root | [`src/main.ts`](src/main.ts)                                   | Creates That Open components, services, repositories, selection adapters, and UI state           |
| Domain           | [`src/domain/robot-tasks/`](src/domain/robot-tasks/)           | Framework-independent types, immutable builders, sequencing, and validation                      |
| Application      | [`src/application/robot-tasks/`](src/application/robot-tasks/) | Mission use cases and persistence port                                                           |
| Persistence      | [`src/persistence/robot-tasks/`](src/persistence/robot-tasks/) | In-memory, `localStorage`, and selectable repository adapters                                    |
| Viewer adapters  | [`src/viewer/robot-tasks/`](src/viewer/robot-tasks/)           | Fragments selection, metadata resolution, stable IFC reference conversion, highlights            |
| IFC mapping      | [`src/ifc/robot-tasks/`](src/ifc/robot-tasks/)                 | Pure domain-to-IFC record graph                                                                  |
| IFC export       | [`src/ifc/model-export/`](src/ifc/model-export/)               | Source registry, schema selection, STEP writing, and independent verification                    |
| IFC import       | [`src/ifc/model-import/`](src/ifc/model-import/)               | Read-only web-ifc access, owned-graph validation, reconstruction, issues, and provenance         |
| IFC orchestration | [`src/ifc/model-roundtrip/`](src/ifc/model-roundtrip/)         | Active-repository upsert, source association, safety state, scoped export, and source advancement |
| UI               | [`src/ui-templates/`](src/ui-templates/)                       | Model, selection, mission, viewpoint, and viewer-tool components                                 |
| Tests            | [`test/robot-tasks/`](test/robot-tasks/)                       | Domain, application, persistence, selection, mapping, writer, and real web-ifc integration tests |

## Programmatic mission example

The UI uses the same application service shown below. Each command saves the complete changed mission through the chosen repository. Replace the example IFC GlobalId with an object from the imported source model.

```ts
import { RobotMissionService } from "./src/application/robot-tasks";
import { LocalStorageRobotMissionRepository } from "./src/persistence/robot-tasks";
import {
  IfcModelExportService,
  IfcSourceModelRegistry,
  WebIfcStructuralCodec,
} from "./src/ifc/model-export";

const repository = new LocalStorageRobotMissionRepository(window.localStorage);
const missions = new RobotMissionService(repository);

const missionId = "entrance-mission";
const door = {
  globalId: "REPLACE_WITH_SOURCE_IFC_GLOBAL_ID",
  ifcClass: "IFCDOOR",
  name: "Main entrance",
} as const;

missions.createMission({
  id: missionId,
  name: "Enter the building",
  description: "Open and pass through the main entrance",
  schedule: {
    id: "entrance-schedule",
    name: "Entrance schedule",
    scheduleStart: "2026-07-22T08:00:00Z",
    scheduleDuration: "PT2M",
  },
});

missions.addTask(missionId, {
  id: "open-door",
  name: "Open the main entrance",
  actionType: "OPEN",
  targetObjects: [door],
  properties: {
    targetState: "OPEN",
    requiredCapability: "door-operation",
    successCondition: "Door is open",
  },
  time: { scheduleDuration: "PT30S", completion: 0 },
});

missions.addTask(missionId, {
  id: "pass-door",
  name: "Pass through the entrance",
  actionType: "PASS_THROUGH",
  targetObjects: [door],
  time: { scheduleDuration: "PT30S" },
});

missions.setTaskExecutionOrder(missionId, ["open-door", "pass-door"]);

const blockingIssues = missions
  .validateMission(missionId)
  .filter((issue) => issue.severity === "error");
if (blockingIssues.length) {
  throw new Error(blockingIssues.map((issue) => issue.message).join(" "));
}

// The service commands above have already saved the mission to localStorage.
const savedMission = repository.get(missionId);
```

To export, retain the exact bytes used for the direct IFC import and use the same runtime model ID as the viewer:

```ts
declare const sourceFile: File; // File selected by the user.
const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
const modelId = "viewer-model-id";

const sourceRegistry = new IfcSourceModelRegistry();
sourceRegistry.register({
  modelId,
  fileName: sourceFile.name,
  bytes: sourceBytes,
});

const exporter = new IfcModelExportService(
  sourceRegistry,
  new WebIfcStructuralCodec({
    wasmPath: "https://unpkg.com/web-ifc@0.0.72/",
    wasmAbsolute: true,
  }),
);

const result = await exporter.exportModel(modelId, {
  missions: missions.listMissions(),
});

const blob = new Blob([result.bytes.slice().buffer], {
  type: "application/x-step",
});
console.log(result.fileName, result.schema, result.missionCount, blob);
```

The application UI performs the final browser download automatically.

## Repository structure

```text
.
├── IFC/                              Reference IFC4 models
├── src/
│   ├── application/robot-tasks/     Mission use cases and repository port
│   ├── domain/robot-tasks/          Domain types, builders, sequencing, validation
│   ├── ifc/
│   │   ├── model-export/            Source-backed STEP writer and verifier
│   │   └── robot-tasks/             Pure IFC record mapping
│   ├── persistence/robot-tasks/     In-memory and localStorage adapters
│   ├── ui-templates/                Panels, grids, toolbars, and controls
│   ├── viewer/robot-tasks/          Selection and IFC-reference adapters
│   ├── main.ts                      Composition root and viewer initialization
│   └── style.css                    Application styles
├── test/robot-tasks/                Unit and web-ifc integration tests
├── AGENTS.md                        Project and modeling rules for coding agents
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Testing and quality checks

Run the complete robot-mission test suite:

```bash
npm test
```

The suite covers domain builders, validation, cyclic sequences, persistence, application services, viewer selection, IFC record mapping, source-object resolution, schema handling, and real IFC save/reopen integration.

Additional checks:

```bash
npm run typecheck:test
npm run build
npx eslint src test --ext .ts
```

The integration tests exercise real `web-ifc` output for IFC4, IFC4X3, IFC4X3 addenda, task timing, property sets, object assignments, identity-preserving replacement, repeated roundtrips, mission removal, multiple missions, source-scoped orchestration, and a two-cycle load/edit/export/reload acceptance flow through the command layer.

## Current limitations and planned extensions

- Backend mission storage is an architectural placeholder, not an active adapter.
- `.frag` files without a retained IFC source cannot be exported to IFC.
- Structural Fragments changes cannot yet be mapped safely back to IFC.
- IFC2X3 mission writing is unsupported.
- Pre-run-2 files without explicit sequence IDs or schedule markers require the documented compatibility inference on their first import; the next export normalizes them to annotation schema `1.0.0`.
- The PoC does not perform path planning or physical robot control.
- Viewpoints and marker positions are supported by the domain/mapping layer but need deeper mission-editor integration.
- Complete IFC editing, BCF workflows, authentication, and multi-user synchronization remain future work.
- Production deployments should self-host and version-lock the Fragments worker and `web-ifc` WASM assets instead of relying on development paths or a public CDN.
