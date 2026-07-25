Picking the right objects:
Future improvements:
  - action-specific filter (maybe search IFC for robot action anotations to opjects.)
  - X-Ray Mode
  - a selection-aware hook for the built-in model-list visibility control


Central features tbd:

Robot export format with mission and waypoints (json format) -> see ROS interfacing
  Offene Punkte:
    - Koordinaten als Punkte sollen durch bestehende Tools auf ROS-Kompatible Koordinatensysteme transformiert werden können
        -> Welchen Input benötigen die? Welcher Bezugspunkt wird verwendet?
        -> Generierung eines Weggraphen/ Vektoren zur Wegfindung offen. Evtl. überlegungen aus Paper "Improving autonomous robotic navigation using IFC files" Kapitel: Navigation maps. Allerdings komplett offen wie.
        -> Zusammenspiel mit Editor und Backend. Soll komplett alles im Browser passieren? Für was ist das Backend da? Laut Prof. Dünnweber soll alles im Editor passieren. (so habe ich ihn verstanden)
    - Teilsegmente von großen Ojekten (z.B. Wände) sollen ausgewählt werden und als Interaktionspunkt annotiert werden können.
      Ziel: Man wählt ein Segment einer Wand durch klick aus. Dadurch wird ein Referenzpunkt für die Position des Roboters generiert. Dieser Referenzpunkt
            wird per QR Code Visualisiert und an die Stelle der Wand gehängt. Dadurch erhält der Robotter seine genaue Position.
        -> Unklar wie das in die bestehende Struktur eingefügt werden soll.
            Option 1: Irgendwie per annotation ?
            Option 2: zusätzliches IfcOpjekt, welches in das IFC Modell eingefügt wird und Referenziert wird. Vmtl. auch besser für Re-Import von         bestehenden Missionen.

    - Gruppierung von RobotTasks in Hauptbereiche: Explore, Navigate, Localize, Execute, Recover from failure (?)
      in Verbindung mit Vorannotierten IfcObjekten in der Quelldatei. D.h. Mögliche Robot-Interaktionen sind an den Objekten der Quelldatei hinterlegt.
      z.B. Lichtschalter hat vordefinierte Aktionen: An, Aus. Diese können bei Auswahl übernommen und ausgewählt werden.
           Wand hat keine vordefinierte Aktion -> eine Auswahl aus den Gruppen (z.b. Localize) ist möglich um Position zu bestimmen.
      

