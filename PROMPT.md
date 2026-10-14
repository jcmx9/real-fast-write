# Projektstart: real-fast-write (`rf-write`)

## Worum es geht

`real-fast-write` ist ein schlanker Markdown-Editor für macOS, Windows und Linux. Er wird mit `rf-write [notiz.md]` gestartet. Er ist das Gegenstück zu **real-fast-document** (`rf-document`, Repo `jcmx9/real-fast-document`, lokal `~/GitHub/real-fast-document`), das aus Markdown ein PDF setzt.

**Einsatz:** Ich schreibe im Kundentermin mit, und der Bildschirm wird dabei gezeigt: Thema, Teilnehmer, Agenda, Mitschrift, Aufgaben. Danach geht das PDF an den Kunden. Der Editor muss deshalb ruhig und präsentationstauglich sein und schon beim Tippen so aussehen wie das spätere PDF.

**Vorgeschichte:** Bisher läuft das über Zettlr mit dem Projekt `jcmx9/zettlr_rfdoc-Export` (lokal `~/GitHub/zettlr_rfdoc-Export`). Es liefert drei Dinge: ein Editor-Theme im rf-document-Look, Snippets und ein Exportprofil, das `rf-document` aufruft. Zettlr ist dafür zu groß und erlaubt nur CSS, keinen Code. Ein Schalter zum Ein- und Ausblenden des YAML-Headers ließ sich deshalb nicht sauber bauen. Zettlr bleibt übergangsweise in Betrieb, `rf-write` soll es ablösen.

## Erster Schritt: Grundlage wählen (noch nichts bauen)

Recherchiere und vergleiche, worauf `rf-write` aufsetzen soll, mit aktuellen Versionen und Lizenzen. Lege mir eine Empfehlung mit Begründung vor und warte auf meine Freigabe.

**Editor-Kern** (Markdown-Quelle muss Byte für Byte erhalten bleiben, denn rf-document liest die Datei unverändert):
- **CodeMirror 6** mit `@lezer/markdown`: Kern von Zettlr und Obsidian, Live-Vorschau über Decorations, Quelltext bleibt exakt. Meine Vermutung: der Favorit.
- **ProseMirror / Milkdown / TipTap:** echtes WYSIWYG, aber Markdown wird umgewandelt und neu geschrieben (Rundreise-Verluste?).
- **Monaco:** stark für Code, schwach für Fließtext.
- **Fertige CM6-Markdown-Editoren als Startpunkt**, z. B. ink-mde: Lizenz, Pflegezustand und Erweiterbarkeit prüfen.
- **Forks** (Zettlr: GPL und groß; MarkText: Pflegezustand?): nur der Vollständigkeit halber.

**Desktop-Hülle** (macOS, Windows, Linux; ein Installer bzw. Paket je Plattform):
- **Tauri 2:** klein, nutzt die System-Webview (WKWebView, WebView2, WebKitGTK). Zu prüfen: Unterschiede in Schriftdarstellung und CSS-Unterstützung (`:has()`, variable Fonts, `font-variant-numeric`) zwischen den drei Webviews, besonders WebKitGTK unter Linux.
- **Electron:** überall dasselbe Chromium, aber groß.
- **Wails, Neutralino:** kurz einordnen.

Bewerte nach:
- Größe und Startzeit
- gleiche Darstellung auf allen drei Systemen
- Aufruf von `rf-document` als Prozess
- Dateizugriff und Autosave
- CLI-Start `rf-write datei.md` (bei laufender Instanz in diese übergeben)
- Packaging und Code-Signing
- Pflegeaufwand für mich allein

## Funktionsumfang

### Version 1 (MVP)

1. **Ein Fenster, eine Notiz.** Öffnen, Speichern (Autosave, atomar schreiben, kein Datenverlust), zuletzt benutzte Dateien. `rf-write notiz.md` öffnet direkt; ohne Argument öffnet sich die letzte Notiz oder eine neue.
2. **Aussehen wie das PDF.**
   - Werte aus `~/GitHub/zettlr_rfdoc-Export/zettlr/rfdoc-zettlr.css` übernehmen. Sie stammen aus rf-documents `template.typ`, und das bleibt die Quelle der Wahrheit.
   - Größen: Text 10 pt; `#` 14 pt mit Haarlinie, `##` 12 pt, `###` unterstrichen, ab `####` kursiv.
   - Schriften: Source Sans/Serif/Code, Mediävalziffern im Text, Blocksatz mit Silbentrennung.
   - Hinweisboxen mit Balken links in den rf-document-Farben, Tabellen mit Streifen, Aufgaben mit Kästchen, Code mit Typst-ähnlichen Syntaxfarben.
   - Die Markdown-Zeichen treten zurück und werden erst sichtbar, wenn der Cursor davor steht.
3. **Schriften** werden nicht mitgeliefert, sondern aus dem Install-Ordner von rf-document geladen:
   - Install-Ordner: `~/.local/share/real-fast-document/fonts/`, Windows `%LOCALAPPDATA%\real-fast-document\fonts\`.
   - Dateien: `SourceSans3VF-*`, `SourceSerif4Variable-*`, `SourceCodeVF-*`, `NotoEmoji[wght].ttf`.
   - Fehlt rf-document, mit Systemschriften weiterlaufen und einen Hinweis zeigen.
4. **Header-Schalter:** Ein Knopf und ein Tastenkürzel blenden das YAML-Front-Matter aus und ein, je Fenster, und die Einstellung wird gemerkt. Beim Ausblenden darf der Cursor nicht unsichtbar im Header landen.
5. **Präsentationsmodus** (Tastenkürzel): Vollbild, alles außer dem Text ausgeblendet, Schrift größer (einstellbar), Header aus, angenehme Zeilenlänge.
6. **Snippets mit Sprungstellen:** `:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage`.
   - Vorlagen und Syntax aus `~/GitHub/zettlr_rfdoc-Export/zettlr/snippets/` übernehmen: `$1`, `${1:Vorgabe}`, `$0`, Variablen wie `$CURRENT_YEAR`.
   - Tab springt weiter, die erste Sprungstelle ist beim Einfügen aktiv.
   - Eigene Snippets liegen als Dateien in einem Benutzerordner.
   - `:header` enthält genau die Schlüssel von rf-documents `header.md`: In den Tests prüfen, dass die Schlüssel übereinstimmen. Das Muster muss Ziffern erfassen (`h1_break`).
7. **Export-Knopf** (Tastenkürzel):
   - ruft `rf-document <notiz.md> <ziel.pdf>` auf; vorher speichern
   - Exit-Code und stderr auswerten, Fehler verständlich anzeigen
   - Danach das PDF öffnen, oder mit `RFD_NO_OPEN=1` rf-document das Öffnen überlassen; das entscheidest du.
   - rf-document suchen über `RF_DOCUMENT`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `%LOCALAPPDATA%\Microsoft\WindowsApps\rf-document.cmd` und `PATH`. Das Programm startet als GUI-App mit minimalem PATH.

### Später

- Gliederung als Seitenleiste
- Suche in der Notiz
- Bilder als Vorschau
- Mermaid
- Dunkelmodus
- Ordneransicht
- Aufgabenlisten im Editor als Tabelle wie im PDF

### Nicht-Ziele

- Keine Bibliothek, keine Vault-Verwaltung, keine Plugins, kein Sync.
- Kein eigenes PDF-Rendering: Das PDF macht ausschließlich rf-document.
- Keine Funktionen von rf-document nachbauen. Lücken dort werden in rf-document behoben, nicht hier.

## Konventionen

- **Name und Ort:** Repo `jcmx9/real-fast-write`, lokal `~/GitHub/real-fast-write`, Befehl `rf-write`.
- **Autorenidentität:** `jcmx9` (nie den Klarnamen).
- **Lizenz:** MIT.
- **Versionierung:** CalVer `YY.M.MICRO` mit einer zentralen Versionsquelle.
- **Branches:** `main` (nur über PR, grüne CI), `dev` als Integrationsbranch, Feature-Branches `feature/…`, `fix/…`. Squash-Merge nach `dev`, Rebase-Merge nach `main`, Tag `v*` startet das Release.
- **Commits:** Conventional Commits auf Englisch. **Keine** Co-Authored-By-Zeilen für KI.
- **Dokumentation:** `README.md` (de) und `README.en.md` (en) mit identischem Inhalt und gegenseitigem Sprachlink. Dazu `CHANGELOG.md` (Keep a Changelog), `CONTRIBUTING.md`, `SECURITY.md`.
- **CI** auf macOS, Windows und Linux:
  - Lint, Typecheck, Tests
  - Build der Pakete
  - ein End-to-End-Export mit echtem rf-document, installiert über dessen Bootstrap, wie im Job `real-rf-document` von zettlr_rfdoc-Export
- **Merge erst, wenn alle Checks grün sind.** Release-Skripte brechen bei jedem Fehler ab und prüfen vor dem Taggen die Version auf `main`.
- **Installation:** ein Einzeiler je Plattform, wie bei rf-document. Pakete aus den GitHub Releases.

## Vorgehen

1. Repo-Grundgerüst anlegen erst nach meiner Freigabe des Plans, einschließlich `git init` und GitHub-Repo.
2. Grundlagen-Vergleich (siehe oben) → Empfehlung → Freigabe.
3. Architektur und MVP-Plan vorlegen: Module, Datenfluss Editor ↔ Datei ↔ rf-document, Teststrategie → Freigabe.
4. Umsetzen in kleinen PRs. Jede sichtbare Funktion mit Screenshot auf allen drei Systemen prüfen (CI-Artefakte).
5. `CLAUDE.md` für das Repo anlegen, sobald die Struktur steht.
