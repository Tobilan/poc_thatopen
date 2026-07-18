# AGENTS.md

## Projektkontext

Dieses Projekt ist Teil einer Masterarbeit zur Entwicklung eines browserbasierten IFC-Viewers und Editors für robotische Aufgabenannotation in Gebäudemodellen.

Ziel ist ein Proof of Concept, mit dem IFC- beziehungsweise Fragments-Modelle im Browser performant angezeigt, Bauteile ausgewählt und Roboteraufgaben fachlich sauber modelliert werden können. Die Roboteraufgaben sollen zunächst intern als strukturiertes Datenmodell verwaltet und später in IFC-kompatible Strukturen übersetzt, exportiert oder über ein Backend validiert werden können.

Der Viewer soll langfristig verwendet werden, um autonome Roboter oder Fahrzeuge in Gebäuden zu unterstützen. Dazu sollen Aufgaben wie Navigation, Türbedienung, Lichtschalterbedienung, Durchqueren von Öffnungen oder andere objektbezogene Aktionen als Annotationen mit IFC-Objekten verknüpft werden.

Priorität haben:

- stabile und erweiterbare Architektur
- performantes Rendering großer Gebäudemodelle
- klare Trennung zwischen Viewer, internem Task-Modell und IFC-Mapping
- nachvollziehbare Modellierungsentscheidungen für die Masterarbeit
- kleine, testbare Entwicklungsschritte

## Primäres Ziel des Proof of Concept

Der erste Prototyp soll Folgendes ermöglichen:

1. Browserbasiertes Anzeigen eines IFC- oder Fragments-Modells.
2. Performantes Laden größerer Gebäudemodelle.
3. Auswahl einzelner Bauteile im 3D-Modell.
4. Anzeige relevanter Elementinformationen wie `GlobalId`, Name, Typ und Properties.
5. Erstellen einfacher Roboteraufgaben an ausgewählten Bauteilen.
6. Gruppieren mehrerer Roboteraufgaben zu einer Mission.
7. Definieren einer Reihenfolge zwischen Aufgaben.
8. Speichern der Task-Informationen in einem internen TypeScript-Datenmodell.
9. Vorbereiten einer späteren IFC-kompatiblen Serialisierung.
10. Perspektivisch: Validierung, Export oder Erzeugung bearbeiteter IFC-Dateien im Backend.

Der erste PoC muss keinen vollständigen IFC-Roundtrip garantieren. Ein sauberes internes Task-Modell mit späterem IFC-Mapping ist wichtiger als ein vorschneller STEP-Export.

## Empfohlener Technologie-Stack

### Entwicklungsumgebung

- IDE: Visual Studio Code
- Runtime: Node.js LTS
- Paketmanager: npm
- Versionsverwaltung: Git
- Browser: Chrome oder Edge für Debugging und Performance-Analyse

### Frontend

- Vite
- TypeScript
- Three.js
- That Open Components
- That Open Components Front
- That Open Fragments
- web-ifc

### That-Open-Pakete

Für den Kern des Viewers verwenden:

```bash
npm i @thatopen/components @thatopen/components-front @thatopen/fragments web-ifc three
```

Für spätere UI-Erweiterungen optional:

```bash
npm i @thatopen/ui @thatopen/ui-obc
```

## Architekturentscheidung für IFC und Rendering

Für große IFC-Dateien soll nicht dauerhaft direkt mit IFC im Browser gerendert werden. Stattdessen soll bevorzugt eine Pipeline verwendet werden:

```text
IFC-Datei → Konvertierung → Fragments-Modell → Browser-Rendering
```

Das IFC-Modell bleibt die fachliche Ausgangsdatei. Für performantes Rendering im Browser wird bevorzugt das Fragments-Format genutzt. Die Konvertierung kann im Frontend als Proof of Concept getestet werden, sollte für eine robustere Architektur aber perspektivisch in ein Backend ausgelagert werden.

Die dauerhafte fachliche Referenz auf IFC-Elemente soll über `GlobalId` erfolgen. Interne Fragment-IDs dürfen für Rendering, Auswahl und Laufzeitoperationen genutzt werden, dürfen aber nicht die einzige dauerhafte Referenz sein.

## Empfohlene Projektstruktur

```text
project-root/
├── public/
│   ├── models/
│   │   ├── example.ifc
│   │   └── example.frag
│   └── workers/
├── src/
│   ├── main.ts
│   ├── viewer/
│   │   ├── createWorld.ts
│   │   ├── loadFragments.ts
│   │   ├── selection.ts
│   │   └── camera.ts
│   ├── tasks/
│   │   ├── robotTaskTypes.ts
│   │   ├── robotTaskStore.ts
│   │   ├── robotTaskBuilders.ts
│   │   ├── robotTaskValidation.ts
│   │   ├── taskMarkers.ts
│   │   └── taskPanel.ts
│   ├── ifc/
│   │   ├── ifcImport.ts
│   │   ├── propertyMapping.ts
│   │   ├── ifcRobotTaskMapping.ts
│   │   └── ifcRelationRecords.ts
│   ├── ui/
│   │   ├── layout.ts
│   │   └── propertyPanel.ts
│   └── styles/
│       └── main.css
├── test/
│   ├── robotTaskModel.test.ts
│   ├── robotTaskValidation.test.ts
│   └── ifcRobotTaskMapping.test.ts
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── AGENTS.md
```

Diese Struktur ist eine Empfehlung. Wenn das bestehende Repository bereits anders aufgebaut ist, soll ein Agent die vorhandene Struktur respektieren und nur gezielt erweitern.

## Lokales Setup

Projekt erzeugen, falls noch kein Projekt existiert:

```bash
npm create bim-app@latest
```

Abhängigkeiten installieren:

```bash
npm install
npm i @thatopen/components @thatopen/components-front @thatopen/fragments web-ifc three
```

Development-Server starten:

```bash
npm run dev
```

Standardmäßig läuft Vite meist unter:

```text
http://localhost:5173
```

## Debugging in VS Code

Lege folgende Datei an:

```text
.vscode/launch.json
```

Für Chrome:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug IFC Viewer",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/src",
      "sourceMaps": true
    }
  ]
}
```

Falls der Code nicht unter `src` liegt, `webRoot` auf `${workspaceFolder}` setzen.

## Fachlicher IFC-Kontext

Das Projekt modelliert Roboteraufgaben als IFC-kompatible Aufgabenstrukturen.

Die zentrale fachliche Entscheidung lautet:

```text
IFC liefert die strukturellen Relationsträger.
Die konkrete Robotik-Aktionssemantik wird als benutzerdefiniertes Property-Modell an IfcTask modelliert.
```

Das bedeutet:

- Eine Roboteraufgabe wird als `IfcTask` verstanden.
- Eine Mission ist ein Parent- beziehungsweise Summary-Task.
- Ausführbare Schritte sind Child-Tasks.
- Ziel- und Kontextobjekte werden über IFC-Relationen referenziert.
- Konkrete Aktionen wie `OPEN`, `CLOSE`, `SWITCH_ON`, `SWITCH_OFF`, `MOVE`, `PASS_THROUGH` oder `NAVIGATE_TO` sind projektspezifische Werte, keine nativen IFC-Enums.
- Diese konkreten Aktionswerte gehören an den Task, nicht primär an das Zielobjekt.

## IFC-Modellierungsregeln für Roboteraufgaben

### Missionen und Tasks

Eine Roboter-Mission wird als Parent-Task modelliert.

```text
IfcTask #mission
  = Roboter-Mission / Summary Task
```

Konkrete ausführbare Schritte werden als Child-Tasks modelliert.

```text
IfcTask #subtask
  = ausführbarer Roboter-Schritt
```

### Task-Gruppierung

Tasks werden über `IfcRelNests` gruppiert.

```text
IfcRelNests
  RelatingObject = parent IfcTask
  RelatedObjects = child IfcTasks
```

Beispielhafte Bedeutung:

```text
Mission
  enthält
    Subtask A
    Subtask B
    Subtask C
```

`IfcRelNests` beschreibt die hierarchische Zerlegung, nicht die zeitliche Ausführungsreihenfolge.

### Task-Reihenfolge

Die Reihenfolge von Tasks wird über `IfcRelSequence` beschrieben.

```text
IfcRelSequence
  RelatingProcess = predecessor task
  RelatedProcess  = successor task
  SequenceType    = FINISH_START
```

`RelatingProcess` ist der Vorgänger. `RelatedProcess` ist der Nachfolger. Standardmäßig soll `FINISH_START` verwendet werden, sofern keine andere Abhängigkeit explizit gefordert ist.

### Task-Zeitinformationen

Zeitinformationen werden über das direkte Attribut `IfcTask.TaskTime` modelliert.

```text
IfcTask
  TaskTime -> IfcTaskTime
```

`IfcTaskTime` kann enthalten:

- `ScheduleStart`
- `ScheduleFinish`
- `ScheduleDuration`
- `ActualStart`
- `ActualFinish`
- `RemainingTime`
- `Completion`

Wichtig:

- `IfcTaskTime` wird nicht über `IfcRelDefinesByProperties` modelliert.
- Für den PoC reicht zunächst ein internes Zeitmodell, das später auf `IfcTaskTime` gemappt werden kann.

### Work Schedule

Ein gesamter Aufgabenplan kann über `IfcWorkSchedule` modelliert werden.

```text
IfcWorkSchedule
  IfcRelAssignsToControl
    RelatedObjects = [mission IfcTask]
```

`IfcWorkSchedule` bündelt den Ablaufplan. Der Parent-Task der Mission wird dem Schedule über `IfcRelAssignsToControl` zugeordnet.

### Task-zu-Objekt-Relation

Ein Task wird mit Ziel- oder Kontextobjekten über `IfcRelAssignsToProcess` verbunden.

```text
IfcRelAssignsToProcess
  Name            = relation role
  RelatingProcess = IfcTask
  RelatedObjects  = target/context IFC objects
```

Empfohlene Relationsnamen:

- `OPERATES_ON`
- `AFFECTS`
- `PASSES_THROUGH`
- `NAVIGATES_TO`
- `MOVE_FROM`

Beispiele der Bedeutung:

```text
OPERATES_ON
  Der Task manipuliert oder bedient dieses Objekt direkt.

AFFECTS
  Der Task beeinflusst dieses Objekt funktional, bedient es aber nicht direkt.

PASSES_THROUGH
  Der Task durchquert ein Objekt oder eine Öffnung.

NAVIGATES_TO
  Der Task navigiert zu einem Objekt oder Bereich.

MOVE_FROM
  Das Objekt dient als Startreferenz einer Bewegungsaufgabe.
```

### Bewegung

Für Bewegungsaufgaben gilt:

```text
MOVE_FROM
  IfcRelAssignsToProcess
    RelatingProcess = move task
    RelatedObjects  = start reference object

MOVE_TO
  IfcRelAssignsToProduct
    RelatedObjects  = [move task]
    RelatingProduct = target reference object
```

Im PoC dürfen Türen als Navigationsreferenzen verwendet werden, zum Beispiel `Door1` und `Door2`. Der Code soll jedoch so entworfen werden, dass später statt Türen auch `IfcSpace`, `IfcSpatialZone`, Waypoints, Approach Poses oder andere Navigationsreferenzen verwendet werden können.

### Task-spezifische RobotAction-Properties

Konkrete Aktionsdaten gehören an den Task.

```text
IfcTask "Open Door"
  IfcRelDefinesByProperties
    RelatedObjects = [task]
    RelatingPropertyDefinition = IfcPropertySet "RobotAction"
```

Die Property-Set-Instanz beschreibt die konkrete Aktion dieses Tasks.

Beispielhafte Property-Namen:

- `ActionType`
- `TargetState`
- `TargetObjectRole`
- `AffectedObjectRole`
- `RequiredCapability`
- `Preconditions`
- `Postconditions`
- `SuccessCondition`

Wichtig:

- Konkrete Aktionsdaten wie `OPEN` oder `CLOSE` sollen nicht primär am Zielobjekt, sondern am `IfcTask` hängen.
- Das gleiche Zielobjekt kann in verschiedenen Tasks unterschiedliche Aktionen erhalten.
- Beispiel: Dieselbe Tür kann in einem Task geöffnet und in einem anderen Task geschlossen werden.

### Objekt-spezifische Properties

Properties am Objekt sind erlaubt, sollen aber eine andere Semantik haben.

Objekt-Properties beschreiben Fähigkeiten oder statische robotikrelevante Metadaten des Objekts, nicht die konkrete angeforderte Aktion.

Beispiele:

- `SupportedActions`
- `ManipulationTarget`
- `RequiredForce`
- `HandleLocation`
- `ApproachSide`
- `IsRobotOperable`

Dafür kann ein eigenes Property Set verwendet werden, zum Beispiel:

```text
IfcPropertySet "RobotInteractionCapability"
```

### Benennung von Custom Property Sets

Der Präfix `Pset_` soll nicht für eigene Property Sets verwendet werden, weil dieser Präfix offiziellen IFC Property Sets vorbehalten ist.

Nicht verwenden:

```text
Pset_RobotAction
```

Stattdessen verwenden:

```text
RobotAction
RobotTask
RobotMission
RobotInteractionCapability
```

## Unterstützte RobotAction-Werte im PoC

Der initiale Proof of Concept soll folgende Aktionswerte unterstützen:

```text
OPEN
CLOSE
SWITCH_ON
SWITCH_OFF
MOVE
PASS_THROUGH
NAVIGATE_TO
```

Diese Werte sind benutzerdefinierte Robotik-Aktionswerte. Sie sind keine nativen standardisierten IFC-Enums.

## Internes TypeScript-Datenmodell

Vor einer IFC-Serialisierung soll ein sauberes internes Modell verwendet werden.

```ts
export type RobotActionType =
  | "OPEN"
  | "CLOSE"
  | "SWITCH_ON"
  | "SWITCH_OFF"
  | "MOVE"
  | "PASS_THROUGH"
  | "NAVIGATE_TO";

export type RobotTaskStatus =
  | "planned"
  | "open"
  | "in_progress"
  | "done"
  | "blocked"
  | "failed";

export type RobotTaskPriority = "low" | "medium" | "high" | "critical";

export interface RobotMission {
  id: string;
  name: string;
  description?: string;
  status?: RobotTaskStatus;
  priority?: RobotTaskPriority;
  tasks: RobotTask[];
  schedule?: RobotSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface RobotTask {
  id: string;
  name: string;
  description?: string;
  actionType: RobotActionType;
  status?: RobotTaskStatus;
  priority?: RobotTaskPriority;

  /** IFC GlobalIds of directly targeted or referenced objects. */
  targetObjectGlobalIds: string[];

  /** IFC GlobalIds of objects affected indirectly by the task. */
  affectedObjectGlobalIds?: string[];

  /** Start reference for movement tasks. Usually an IFC GlobalId. */
  startReferenceGlobalId?: string;

  /** Target reference for movement tasks. Usually an IFC GlobalId. */
  targetReferenceGlobalId?: string;

  /** Optional predecessor task ids for sequence creation. */
  predecessorTaskIds?: string[];

  time?: RobotTaskTime;
  properties?: RobotActionProperties;
  viewpoint?: TaskViewpoint;
  markerPosition?: [number, number, number];
  createdAt: string;
  updatedAt: string;
}

export interface RobotSchedule {
  id: string;
  name: string;
  scheduleStart?: string;
  scheduleFinish?: string;
  scheduleDuration?: string;
}

export interface RobotTaskTime {
  scheduleStart?: string;
  scheduleFinish?: string;
  scheduleDuration?: string;
  actualStart?: string;
  actualFinish?: string;
  completion?: number;
}

export interface RobotActionProperties {
  targetState?: string;
  targetObjectRole?: string;
  affectedObjectRole?: string;
  requiredCapability?: string;
  preconditions?: string[];
  postconditions?: string[];
  successCondition?: string;
}

export interface TaskViewpoint {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}
```

Dieses Modell darf erweitert werden, soll aber nicht ohne Grund ersetzt werden.

## IFC-Mapping-Zielstruktur

Ein Mapper vom internen Modell zu IFC-ähnlichen Records soll später folgende Entitäten erzeugen können:

- `IfcTask` für Mission und Subtasks
- `IfcTaskTime` aus `RobotTaskTime`
- `IfcRelNests` von Mission zu Subtasks
- `IfcRelSequence` zwischen geordneten Subtasks
- `IfcWorkSchedule` für den Gesamtplan
- `IfcRelAssignsToControl` von Schedule zu Mission
- `IfcRelAssignsToProcess` für Objektinteraktionen und `MOVE_FROM`
- `IfcRelAssignsToProduct` für `MOVE_TO`
- `IfcRelDefinesByProperties` vom Task zum Property Set
- `IfcPropertySet` mit `IfcPropertySingleValue` und `IfcPropertyListValue`

Der erste Mapper darf eine interne Zwischenrepräsentation erzeugen. Er muss nicht sofort gültige STEP-Zeilen schreiben.

## Beispielhafte fachliche Zielstruktur

Eine Mission mit vier Schritten:

```text
IfcTask #200 "Roboter Aufgabe"
  IfcRelNests
    IfcTask #201 "Öffne IfcDoor1"
    IfcTask #202 "Bewege von IfcDoor1 nach IfcDoor2"
    IfcTask #203 "Öffne IfcDoor2"
    IfcTask #204 "Durchquere IfcDoor2"

IfcRelSequence
  #201 -> #202
  #202 -> #203
  #203 -> #204
```

Objektinteraktion:

```text
IfcTask #201 "Öffne IfcDoor1"
  IfcRelAssignsToProcess
    Name = OPERATES_ON
    RelatingProcess = #201
    RelatedObjects = [IfcDoor1]

  IfcRelDefinesByProperties
    RelatedObjects = [#201]
    RelatingPropertyDefinition = IfcPropertySet "RobotAction"
      ActionType = OPEN
      TargetState = OPEN
```

Bewegung:

```text
IfcTask #202 "Bewege von IfcDoor1 nach IfcDoor2"
  IfcRelAssignsToProcess
    Name = MOVE_FROM
    RelatingProcess = #202
    RelatedObjects = [IfcDoor1]

  IfcRelAssignsToProduct
    Name = MOVE_TO
    RelatedObjects = [#202]
    RelatingProduct = IfcDoor2
```

## Validierungsregeln

Eine gültige Mission soll folgende Bedingungen erfüllen:

- Eine Mission besitzt eine ID und einen Namen.
- Eine Mission besitzt mindestens einen ausführbaren Task.
- Jeder ausführbare Task besitzt eine ID, einen Namen und einen `actionType`.
- Jeder objektbezogene Task besitzt mindestens ein Zielobjekt oder eine geeignete Referenz.
- `OPEN` und `CLOSE` sollen ein türartiges Zielobjekt referenzieren.
- `SWITCH_ON` und `SWITCH_OFF` sollen ein schalterartiges Zielobjekt referenzieren.
- `MOVE` soll eine Startreferenz und eine Zielreferenz besitzen.
- Sequenzen dürfen keine Zyklen enthalten.
- Ein Task darf nicht sein eigener Vorgänger sein.
- Konkrete RobotAction-Properties werden am Task modelliert, nicht am Zielobjekt.
- `completion` liegt zwischen `0` und `1`, falls verwendet.

Wenn die Typinformation des IFC-Objekts nicht verfügbar ist, soll die Validierung eine Warnung statt eines harten Fehlers erzeugen, sofern der Task ansonsten plausibel ist.

## Erwartete Builder- und Hilfsfunktionen

Falls Codex neue Funktionen implementiert, sollen sie klein und testbar sein.

Empfohlene Funktionen:

```ts
createMission(...)
createRobotTask(...)
addSubtask(...)
addSequence(...)
assignTargetObject(...)
assignAffectedObject(...)
assignMovementReferences(...)
assignRobotActionProperties(...)
validateMission(...)
validateTask(...)
validateTaskSequence(...)
mapMissionToIfcRecords(...)
```

## Test-Erwartungen

Unit Tests sollen bevorzugt für das interne Modell und das Mapping geschrieben werden.

Mindestens testen:

- Erzeugen einer Mission mit Subtasks.
- Erzeugen von `IfcRelNests` aus Parent-Task und Subtasks.
- Erzeugen von `IfcRelSequence` zwischen geordneten Subtasks.
- Erzeugen von `IfcRelAssignsToProcess` für Objektinteraktion.
- Erzeugen von `IfcRelAssignsToProduct` für Bewegungsziele.
- Erzeugen von taskbezogenen `RobotAction` Property Sets.
- Validierung ungültiger Tasks mit fehlendem `actionType`.
- Validierung ungültiger Tasks mit fehlendem Zielobjekt.
- Erkennung zyklischer Sequenzen.
- Sicherstellen, dass konkrete RobotAction-Properties am Task und nicht am Zielobjekt hängen.

Wenn ein Testframework noch nicht existiert, soll Codex erst prüfen, welches Setup im Projekt vorhanden ist, und keine unnötige Testinfrastruktur hinzufügen.

## Annotationen im Viewer

Für den PoC sollen Task-Daten zunächst nicht zwingend direkt in die IFC-Datei geschrieben werden.

Empfohlene Reihenfolge:

1. IFC- oder Fragments-Modell im Viewer laden.
2. Element im 3D-Modell auswählen.
3. IFC-Informationen wie `GlobalId`, Name, Typ und Properties auslesen.
4. Task im Frontend erzeugen.
5. Task über IFC `GlobalId` mit dem Element verknüpfen.
6. Task im lokalen Store oder Backend speichern.
7. Optional Viewpoint und Markerposition speichern.
8. Später Export als JSON, BCF oder IFC-kompatible Struktur prüfen.

IFC-Roundtrip, also das zuverlässige Zurückschreiben geänderter Daten in eine IFC-Datei, ist eine spätere Ausbaustufe.

## Verhalten zukünftiger KI-/Coding-Agenten

Wenn ein Agent an diesem Projekt arbeitet, soll er:

- diese Datei zuerst lesen und befolgen
- bestehende Architektur respektieren
- keine unnötigen Frameworks oder Bibliotheken hinzufügen
- TypeScript-Code bevorzugen
- That-Open-Komponenten gemäß ihrer Rolle einsetzen
- große Modelle über Fragments priorisieren
- IFC-Elementbezug über `GlobalId` erhalten
- interne Fragment-IDs nicht als einzige dauerhafte fachliche Referenz verwenden
- das interne Task-Modell vom IFC-Mapping trennen
- konkrete RobotAction-Daten am Task modellieren, nicht am Zielobjekt
- `IfcTaskTime` als Task-Zeitmodell behandeln, nicht als PropertySet
- Custom Property Sets nicht mit `Pset_` benennen
- Änderungen klein, nachvollziehbar und testbar halten
- bei Fehlern zuerst Browser-Konsole, Network-Tab und Worker-/WASM-Pfade prüfen
- vorhandene Tests ausführen oder neue Tests ergänzen, wenn Verhalten geändert wird
- vor größeren Refactorings kurz erklären, warum sie notwendig sind

## Nicht-Ziele des ersten PoC

Der erste PoC muss noch nicht leisten:

- vollständiger IFC-Editor
- garantierter IFC-Roundtrip
- vollständige Robotersteuerung
- reale Navigation oder Pfadplanung
- produktionsreife Rechteverwaltung
- Multiuser-Synchronisation
- umfassende BIM-Validierung
- vollständige BCF-Implementierung
- direkte Steuerung physischer Roboter
- vollständige STEP-Serialisierung aller IFC-Entitäten

Diese Punkte sind wichtig, gehören aber in spätere Projektphasen.

## Arbeitsweise für Codex

Bei neuen Aufgaben soll Codex bevorzugt so vorgehen:

1. Repository-Struktur prüfen.
2. Relevante bestehende Dateien lesen.
3. Kleine Implementierungsstrategie formulieren.
4. Minimal notwendige Änderungen durchführen.
5. Tests oder Typprüfung ausführen, sofern möglich.
6. Kurz berichten:
   - welche Dateien geändert wurden
   - welche Modellierungsentscheidung umgesetzt wurde
   - welche Tests ausgeführt wurden
   - welche offenen Punkte bleiben

Codex soll keine umfassenden Architekturwechsel vornehmen, wenn die Aufgabe auch durch gezielte Änderungen lösbar ist.
