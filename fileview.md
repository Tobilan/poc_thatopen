# File View

This document maps the current project files to their role in the IFC viewer and robot-task annotation PoC. It also separates code that mainly wires or uses the That Open stack from code added specifically for robot tasks and IFC roundtrip export.

## Dependency boundary

The actual external functionality comes from installed packages in `package.json`:

| Package | Role in this project |
|---|---|
| `@thatopen/components` | Core BIM viewer services: components registry, worlds, scenes, camera, grids, fragments manager, IFC loader, clipping, bounding boxes, raycasters. |
| `@thatopen/components-front` | Frontend interaction/rendering helpers: postproduction renderer, highlighter, markers, length and area measurements. |
| `@thatopen/fragments` | Fragment model loading and rendering backend used by That Open's `FragmentsManager`. |
| `@thatopen/ui` | BIM UI web components, layout grid, buttons, dropdowns, panels and context menus. |
| `@thatopen/ui-obc` | Ready-made That Open UI helpers, especially model tables. |
| `web-ifc` | IFC parsing, entity lookup, IFC entity creation and normalized IFC serialization. |
| `three` | 3D primitives, colors, vectors and spheres used by the viewer and markers. |

`node_modules/` contains third-party code. The project-specific code is in `src/`.

## Root files

| File | Origin / category | Purpose |
|---|---|---|
| `AGENTS.md` | Project guidance | Describes project context, architecture decisions, task model expectations and agent working rules. |
| `README.md` | Project documentation | Currently minimal project readme. |
| `notes.md` | Project notes | Scratch/project notes. |
| `package.json` | Project configuration | Defines npm scripts and dependencies, including That Open, web-ifc, Three.js, Vite and TypeScript. |
| `package-lock.json` | Project configuration | Locked dependency versions. |
| `vite.config.ts` | Build tooling | Vite configuration. |
| `tsconfig.json` | Build tooling | TypeScript compiler configuration. |
| `index.html` | App shell | Browser entry HTML for the Vite app. |
| `.eslintrc.cjs` | Tooling | ESLint configuration. |
| `.gitignore` | Tooling | Git ignore rules. |

## Source files

### Application entry and shared constants

| File | Main category | Purpose |
|---|---|---|
| `src/main.ts` | That Open viewer setup + task integration | Creates the That Open `Components`, world, scene, camera, postproduction renderer, grid, IFC loader, fragments manager, highlighter, clipper and measurements. It also creates `TaskService`/`TaskStore`, registers task cleanup on model removal and injects the task service into the UI grid. |
| `src/globals.ts` | Shared app constants | Defines grid IDs, layout sizes, icon names and tooltip text used across the UI templates. |
| `src/style.css` | UI styling + added task styling | Contains base BIM UI theme overrides and viewer styling, plus task panel and robot-task marker CSS. |
| `src/vite-env.d.ts` | Vite/TypeScript generated support | Type declarations for Vite. |

### Robot-task implementation

These files are custom PoC code added for task annotations and IFC roundtrip behavior.

| File | Purpose |
|---|---|
| `src/tasks/taskTypes.ts` | Defines the `RobotTask` model, task status/priority types, optional `RobotAction`, action target states, execution status and task draft/update types. |
| `src/tasks/taskStore.ts` | Stores tasks outside the IFC in `localStorage`, grouped by SHA-256 model hash using keys like `robot-tasks:v1:<hash>`. It validates task data, creates IDs/timestamps, updates tasks and computes model hashes. |
| `src/tasks/taskMarkers.ts` | Converts task marker positions into 3D `OBF.Marker` buttons. Clicking a marker selects the corresponding task. |
| `src/tasks/taskService.ts` | Coordinates selection, task creation, task persistence, marker refresh, task selection/focus, IFC task import and IFC task export. It bridges the UI, That Open components and the task store. |
| `src/tasks/ifcRoundtrip.ts` | Handles IFC import/export of `Pset_RobotTask`. It supports normalized `web-ifc` export and source-preserving diff export that inserts only new STEP entities before the final DATA `ENDSEC;`. |
| `src/tasks/index.ts` | Barrel export for the task module. |

### UI templates

These files are project UI code built with `@thatopen/ui` and `@thatopen/ui-obc`. Some are original viewer scaffolding; some were extended for robot tasks.

| File | Main category | Purpose |
|---|---|---|
| `src/ui-templates/index.ts` | UI barrel export | Re-exports UI template modules. |
| `src/ui-templates/grids/content.ts` | UI layout + task integration | Defines the main content grid with model list, viewer, element data, viewpoints and the added Robot Tasks panel. |
| `src/ui-templates/grids/viewport.ts` | Viewer UI | Defines the floating viewport UI layout/toolbars. |
| `src/ui-templates/grids/index.ts` | UI barrel export | Re-exports grid templates. |
| `src/ui-templates/groups/grid-sidebar.ts` | UI navigation | Defines the sidebar used to switch layouts. |
| `src/ui-templates/groups/index.ts` | UI barrel export | Re-exports group templates. |
| `src/ui-templates/buttons/viewport-settings.ts` | Viewer UI control | Defines viewport settings UI, including camera/postproduction-related controls. |
| `src/ui-templates/buttons/index.ts` | UI barrel export | Re-exports button templates. |
| `src/ui-templates/toolbars/viewer-toolbar.ts` | Viewer interaction toolbar | Provides viewer actions such as focus, hide/show, isolate, colorize and similar model interaction controls using That Open components. |
| `src/ui-templates/toolbars/index.ts` | UI barrel export | Re-exports toolbar templates. |
| `src/ui-templates/sections/models.ts` | Model import UI + task registration | Loads `.ifc` files through `OBC.IfcLoader` and `.frag` files through `FragmentsManager`, computes the SHA-256 model hash, creates collision-resistant model IDs and registers loaded models with `TaskService`. |
| `src/ui-templates/sections/elements-data.ts` | Element data UI | Shows selected element data/properties from the loaded model. |
| `src/ui-templates/sections/viewpoints.ts` | Viewpoint UI | Manages viewer viewpoints. |
| `src/ui-templates/sections/tasks.ts` | Robot-task UI | Custom task panel. It provides task creation/editing/deletion, action fields, execution result fields, task list, task selection and the IFC export menu with normalized and source-preserving modes. |
| `src/ui-templates/sections/index.ts` | UI barrel export | Re-exports section templates. |

### BIM component example

| File | Main category | Purpose |
|---|---|---|
| `src/bim-components/index.ts` | Example/custom component export | Barrel export for local BIM components. |
| `src/bim-components/CustomComponent/index.ts` | Example/custom component | Local custom component scaffold/example. Not part of That Open itself, but follows the component-extension pattern. |

## Runtime data and generated output

| Path | Purpose |
|---|---|
| `IFC/` | Local IFC files used for manual testing and comparison. |
| `dist/` | Vite build output. Generated, not source code. |
| `node_modules/` | Installed dependencies, including That Open packages and `web-ifc`. Not project-authored source code. |

## What That Open provides versus what was added

### Provided by That Open / third-party packages

- Component registry and lifecycle: `OBC.Components`.
- Viewer world, scene, camera and grid: `OBC.Worlds`, `OBC.SimpleScene`, `OBC.OrthoPerspectiveCamera`, `OBC.Grids`.
- Rendering and visual interaction: `OBF.PostproductionRenderer`, `OBF.Highlighter`, `OBF.Marker`.
- Model loading/rendering pipeline: `OBC.IfcLoader`, `OBC.FragmentsManager`, `@thatopen/fragments`.
- Selection and geometry helpers used by the task feature: highlighter selection, GUID conversion and `OBC.BoundingBoxer`.
- UI primitives: BIM panels, grids, buttons, dropdowns, text inputs and context menus.
- IFC low-level parsing and writing: `web-ifc`.

### Added by this project

- The `RobotTask` and `RobotAction` data model.
- `localStorage` persistence grouped by SHA-256 model hash.
- Task creation from exactly one selected IFC element.
- Stable element references through IFC `GlobalId`.
- 3D robot-task markers.
- Robot Tasks UI panel.
- `Pset_RobotTask` import/export mapping.
- Normalized IFC export via `web-ifc`.
- Source-preserving IFC diff export for comparing original and exported files.
- Action semantics for robot tasks using `SET_STATE` plus target states like `CLOSED`, `OPEN`, `ON` and `OFF`.

## Current task data flow

```text
IFC or FRAG file
  -> model bytes are hashed
  -> model is loaded through That Open
  -> TaskService registers the loaded model
  -> tasks are loaded from localStorage by hash
  -> if no local tasks exist for an IFC file, Pset_RobotTask entries are imported
  -> selecting one element enables Add task
  -> selected fragment element is converted to IFC GlobalId
  -> task is stored and marker is rendered
  -> export writes Pset_RobotTask data back to IFC
```

## IFC export modes

| Mode | Implemented in | Behavior |
|---|---|---|
| Normalized IFC | `src/tasks/ifcRoundtrip.ts` | Opens the source IFC with `web-ifc`, removes existing `Pset_RobotTask` entries, creates new task property sets and serializes the model with `SaveModel()`. This can change formatting and file size. |
| Source-preserving IFC (Diff) | `src/tasks/ifcRoundtrip.ts` | Preserves the original source bytes and inserts only new task STEP records before the final DATA-section `ENDSEC;`. This is intended for comparison/debugging and refuses files that already contain `Pset_RobotTask`. |

