# Streckenbericht – Jagdgemeinschaft Thuine

Web-App (PWA) für die Erlegerliste. Du erfasst die Jagdtage, alle anderen sehen den aktuellen Stand über einen Link.

## Aufbau

| Seite | Inhalt |
|---|---|
| **Jagdtage** | Kennzahlen, alle Jagdtage des Jagdjahres mit Tages-, Vize- und Sonderkönig. Antippen öffnet die Details. Im Bearbeitungsmodus: Foto auswerten oder manuell erfassen, bearbeiten, löschen |
| **Strecke** | Gesamtstrecke je Wildart im Jagdjahr, Vergleich der Jagdjahre, PDF-Export |
| **Jagdkönig** | Siegerpodest und Rangliste nach der Punktsumme im Jagdjahr, PDF-Export mit Einzelnachweis (Datum, Wild, Punkte) |

- **Jagdjahr:** 1.4. bis 31.3., angezeigt als „2025/26“. Ein neues Jagdjahr entsteht automatisch mit dem ersten Jagdtag.
- **Punkte:** Hase 5 · Fasan 3 · Kaninchen 2,5 · Taube, Schnepfe, Ente, Fuchs, Sonstiges je 1. Die Punkte lassen sich in den Einstellungen ändern.
- **Vom Hund gegriffen:** Das Stück zählt zur Strecke und wird dem Schützen zugerechnet, bringt aber keine Punkte.
- **Tageskönige:** Jagd- und Vizekönig werden aus den Punkten berechnet, bei Gleichstand gibt es mehrere. Den Sonderkönig trägst du von Hand ein.
- **Gleiche Punktzahl bedeutet gleicher Platz.**
- **Jagd mit Venslage:** Beim Erfassen „Jagd mit Venslage“ wählen.
  - Unsere Schützen werden wie gewohnt eingetragen, die Venslager Jäger mit Namen darunter.
  - In den Streckenbericht geht nur die Zeile **„Erlegt in Thuine“** (das Wild aus dem Revier Thuine).
  - Tages-, Vize- und Sonderkönig werden über **alle** Jäger ermittelt.
  - Für den **Jahres-Jagdkönig** zählen nur unsere Schützen.
  - Die KI erkennt diesen Zettel automatisch. Namen, die sie nicht lesen kann, trägst du von Hand ein. Einträge wie „Ast“ zählen nicht als Wild.
- **Große Treibjagd (mit Gästen):** Beim Erfassen „Gr. Treibjagd“ wählen.
  - Unsere Schützen werden wie gewohnt eingetragen. Die Gäste aus den freien Zeilen unter unseren Namen kommen mit Namen und „Gast von …“ dazu.
  - **Alles** Wild, auch das der Gäste, geht in den Streckenbericht.
  - Tages-, Vize- und Sonderkönig werden über alle Jäger ermittelt.
  - Für den **Jahres-Jagdkönig** zählen nur unsere Schützen.
  - Die KI erkennt den Zettel „Große Treibjagd“. Unleserliche Gastnamen trägst du von Hand ein.

- **Nachträge (Wild außerhalb der Jagdtage):** Auf der Seite **Strecke** unter „+ Wild nachtragen“ Datum, Wildart, Anzahl und optional „Erlegt von / Bemerkung“ eintragen.
  - Nachträge zählen zur Gesamtstrecke und erscheinen im Streckenbericht-PDF in einer eigenen Spalte und Liste.
  - Für den Jagdkönig zählen sie **nicht**.
  - Einen Nachtrag antippen, um ihn zu ändern oder zu löschen.
- **Wildarten:** Hase, Fasan, Kaninchen, Taube, Schnepfe, Ente, Fuchs, Krähe, Sonstiges.
  - Neue Wildarten legst du direkt beim Nachtragen an („+ Neue Wildart …“) oder unter Einstellungen → Wildarten & Punkte.
  - Eigene Wildarten lassen sich wieder entfernen, solange sie nirgends eingetragen sind.

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. GitHub-Repository
1. Bei github.com (Konto **Grunzelthuine**) ein neues Repository **`streckenbericht`** anlegen (Public).
2. Den **Inhalt** dieses Ordners hochladen, also `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` sowie die Ordner `icons/`, `vendor/` und `data/`.
3. Unter *Settings → Pages* als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen.
4. Nach etwa einer Minute ist die App erreichbar unter: **https://grunzelthuine.github.io/streckenbericht/**

Diesen Link bekommen alle Jäger. Auf dem iPhone mit Safari öffnen, dann *Teilen → Zum Home-Bildschirm*.

### 2. Schreibzugang (nur für dich)
1. Im Browser (nicht in der GitHub-App) direkt **https://github.com/settings/personal-access-tokens/new** öffnen.
   Alternativ: oben rechts auf dein **Profilbild → Settings** (die Konto-Einstellungen, nicht die Settings des Repositorys), dann links ganz unten **Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   Unter *Token name* z. B. „Streckenbericht“ eintragen und unter *Expiration* eine Laufzeit wählen (bis zu 1 Jahr).
2. *Repository access:* „Only select repositories“ und dann `streckenbericht` wählen.
3. *Permissions → Repository permissions → Contents:* **Read and write**.
4. Den Token kopieren (beginnt mit `github_pat_…`).
5. In der App auf das Zahnrad tippen, bei **Zugriffs-Token** einfügen und auf **Übernehmen** tippen. Konto und Repository werden automatisch aus dem Link erkannt.

Danach erscheinen die Schaltflächen zum Erfassen. Ohne Token ist die App nur zum Ansehen.

### 3. Foto-Auswertung (KI)
1. Auf console.anthropic.com einen API-Schlüssel erstellen und ein kleines Guthaben aufladen (pro Foto ca. 1–3 Cent).
2. In der App unter *Einstellungen → Anthropic-API-Schlüssel* einfügen.
3. **Verfügbare Modelle laden** antippen. Das prüft den Schlüssel und wählt automatisch ein aktuelles Sonnet-Modell.

Token und API-Schlüssel werden **nur auf deinem Gerät** gespeichert, nicht im Repository.

## Ablauf am Jagdtag
1. Die Erlegerliste wie gewohnt am Tisch ausfüllen.
2. In der App **📷 Erlegerliste fotografieren** antippen.
3. Die KI trägt alles vor. Wenn die handschriftlichen Punkte nicht zur Berechnung passen oder die KI unsicher ist, wird die Zeile **orange markiert**. Neue Namen (Gäste) ordnest du zu oder legst sie als neuen Schützen an.
4. Kurz prüfen und auf **Speichern** tippen. Der neue Stand ist sofort für alle sichtbar.

Beim Speichern ohne Netz bleiben die Daten auf dem Gerät, und oben erscheint „Erneut senden“.

## Neue Version einspielen
Nach jeder Änderung an den App-Dateien in `sw.js` die Zeile `VERSION = 'sb-1.0.0'` hochzählen. Die Nutzer sehen dann den Hinweis **„Neue Version verfügbar – Neu laden“**.

## Daten
Alle Daten liegen in `data/strecke.json`. Jede Speicherung ist ein Commit in GitHub, dadurch gibt es automatisch eine Versionshistorie. Zusätzlich gibt es in den Einstellungen **JSON sichern / einspielen**.

Enthalten sind die Jagdtage 18.10., 03.11., 08.11. und 29.11.2025, übernommen von den Erlegerlisten.
