# AGENTS.md

## Projektkontext

Dieses Projekt ist Teil einer Masterarbeit. Ziel ist die Entwicklung eines browserbasierten IFC-Viewers und Editors, der Gebäudemodelle darstellen, Bauteile auswählbar machen und Aufgaben für Roboter im Gebäude verwalten kann. Die Aufgaben sollen als Annotationen beziehungsweise Task-Informationen mit IFC-Elementen verknüpft werden. Langfristig sollen bearbeitete Dateien im Backend geprüft, erzeugt oder exportiert werden können.

Der Viewer dient zunächst als Proof of Concept für das weitere Vorgehen. Priorität haben eine stabile Architektur, gute Erweiterbarkeit und performantes Rendering großer Gebäudemodelle.

## Primäres Ziel des PoC

Der erste Prototyp soll Folgendes ermöglichen:

1. Browserbasiertes Anzeigen eines IFC- beziehungsweise Fragments-Modells.
2. Performantes Laden größerer Modelle.
3. Auswahl einzelner Bauteile im 3D-Modell.
4. Anzeige relevanter Elementinformationen wie GlobalId, Name, Typ und Properties.
5. Erstellen einfacher Task-Annotationen an ausgewählten Bauteilen.
6. Speicherung der Task-Informationen so, dass sie später mit IFC, BCF oder einem Backend synchronisiert werden können.

## Empfohlener Technologie-Stack

### Entwicklungsumgebung

* IDE: Visual Studio Code
* Runtime: Node.js LTS
* Paketmanager: npm
* Versionsverwaltung: Git
* Browser: Chrome oder Edge für Debugging und Performance-Analyse

### Frontend

* Vite
* TypeScript
* Three.js
* That Open Components
* That Open Components Front
* That Open Fragments
* web-ifc

### That-Open-Pakete

Für den Kern des Viewers verwenden:

```bash
npm i @thatopen/components @thatopen/components-front @thatopen/fragments web-ifc three
```

Für spätere UI-Erweiterungen optional:

```bash
npm i @thatopen/ui @thatopen/ui-obc
```

## Architekturentscheidung

Für große IFC-Dateien soll nicht dauerhaft direkt mit IFC im Browser gerendert werden. Stattdessen soll eine Pipeline verwendet werden:

```text
IFC-Datei → Konvertierung → Fragments-Modell → Browser-Rendering
```

Das IFC-Modell bleibt die fachliche Ausgangsdatei. Für performantes Rendering im Browser wird bevorzugt das Fragments-Format genutzt. Die Konvertierung kann im Frontend als Proof of Concept getestet werden, sollte für eine robustere Architektur aber perspektivisch in ein Backend ausgelagert werden.

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
│   │   ├── taskTypes.ts
│   │   ├── taskStore.ts
│   │   ├── taskMarkers.ts
│   │   └── taskPanel.ts
│   ├── ifc/
│   │   ├── ifcImport.ts
│   │   └── propertyMapping.ts
│   ├── ui/
│   │   ├── layout.ts
│   │   └── propertyPanel.ts
│   └── styles/
│       └── main.css
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── AGENTS.md
```

## Lokales Setup

Projekt erzeugen:

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

## Fachliches Datenmodell für Tasks

Eine Task-Annotation sollte mindestens folgende Felder besitzen:

```ts
export type RobotTask = {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "done" | "blocked";
  priority: "low" | "medium" | "high";
  assignedRobot?: string;
  relatedElementGlobalId: string;
  relatedModelId?: string;
  viewpoint?: TaskViewpoint;
  markerPosition?: [number, number, number];
  createdAt: string;
  updatedAt: string;
};

export type TaskViewpoint = {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
};
```

Die Verknüpfung zur Geometrie soll primär über die IFC `GlobalId` erfolgen. Interne Fragment-IDs dürfen für Rendering und Auswahl genutzt werden, sollten aber nicht die einzige dauerhafte fachliche Referenz sein.

## Annotationen und IFC-Bezug

Für den PoC sollen Task-Daten zunächst nicht zwingend direkt in die IFC-Datei geschrieben werden. Die empfohlene Reihenfolge ist:

1. Task im Frontend erzeugen.
2. Task mit IFC-Element über `GlobalId` verknüpfen.
3. Task im lokalen Store oder Backend speichern.
4. Optional Viewpoint und Markerposition speichern.
5. Später Export als BCF, JSON oder IFC-Propertyset prüfen.

IFC-Roundtrip, also das zuverlässige Zurückschreiben geänderter Daten in eine IFC-Datei, soll als spätere Ausbaustufe behandelt werden. Für den Proof of Concept ist eine saubere externe Task-Struktur akzeptabel und technisch risikoärmer.

## Verhalten zukünftiger KI-/Coding-Agenten

Wenn ein Agent an diesem Projekt arbeitet, soll er:

* bestehende Architektur respektieren
* keine unnötigen Frameworks oder Bibliotheken hinzufügen
* TypeScript-Code bevorzugen
* That-Open-Komponenten gemäß ihrer Rolle einsetzen
* große Modelle über Fragments priorisieren
* IFC-Elementbezug über `GlobalId` erhalten
* Task-Datenmodell nicht ohne Grund ändern
* Änderungen klein, nachvollziehbar und testbar halten
* bei Fehlern zuerst Browser-Konsole, Network-Tab und Worker-/WASM-Pfade prüfen
* keine dauerhaften Daten nur in temporären Fragment-IDs speichern

## Nicht-Ziele des ersten PoC

Der erste PoC muss noch nicht leisten:

* vollständiger IFC-Editor
* garantierter IFC-Roundtrip
* vollständige Robotersteuerung
* produktionsreife Rechteverwaltung
* Multiuser-Synchronisation
* umfassende BIM-Validierung
* vollständige BCF-Implementierung

Diese Punkte sind wichtig, gehören aber in spätere Projektphasen.
