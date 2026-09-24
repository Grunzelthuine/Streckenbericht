# Streckenbericht – Jagdgemeinschaft Thuine

Web-App (PWA) für die Erlegerliste. Du erfasst die Jagdtage, alle anderen sehen den aktuellen Stand über einen Link.

## Aufbau

Beim Öffnen erscheint die **Startseite** mit dem Logo und zwei Bereichen:

| Bereich | Seiten |
|---|---|
| **Niederwild** | **Strecke** (Gesamtstrecke je Wildart, Nachträge, PDF) → **Jagdtage** (alle Jagdtage mit Tageskönigen, Erfassen per Foto oder von Hand) → **Jagdkönig** (Rangliste, PDF mit Einzelnachweis) |
| **Schalenwild** | **Reh & Damm** (Kategorien, Erlegungen, Fallwild, je Schütze, PDF) |

Über „Start“ unten links geht es jederzeit zurück zur Startseite.

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

- **Reh- & Dammwild:** Auf der Seite „Reh & Damm“ unter „+ Erlegung / Fallwild eintragen“ Datum, Wildart, Kategorie und Schütze eintragen. Bei Fallwild wählst du statt des Schützen optional eine Ursache.
  - Rehwild: Rehbock, Ricke, Schmalreh, Kitz.
  - Dammwild: Hirsch 1a–3b, Alttier, Schmaltier, Spießer, Kalb, Hirschkalb.
  - Reh- und Dammwild zählt nicht zum Niederwild-Streckenbericht und nicht zum Jagdkönig.

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. GitHub-Repository
1. Bei github.com (Konto **Grunzelthuine**) ein neues Repository **`streckenbericht`** anlegen (Public).
2. Den **Inhalt** dieses Ordners hochladen, also `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` sowie die Ordner `icons/`, `vendor/` und `data/`.
3. Unter *Settings → Pages* als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen.
4. Nach etwa einer Minute ist die App erreichbar unter: **https://grunzelthuine.github.io/Streckenbericht/**

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

### 4. Reh- & Dammwild: Zugang für weitere Jäger
Reh- und Dammwild liegt in einem **eigenen Repository**. So können weitere Jäger dort eintragen, ohne an Jagdtage, Punkte oder Einstellungen zu kommen.

1. **Zweites Repository anlegen:** `streckenbericht-schalenwild`, **Public**, Haken bei „Add a README file“ setzen. Pages brauchst du hier nicht einzuschalten.
2. **Deinen eigenen Token erweitern:** Unter github.com/settings/personal-access-tokens deinen Token öffnen, dann **Edit** und bei „Repository access“ zusätzlich `streckenbericht-schalenwild` auswählen. Alternativ erstellst du einen neuen Token für beide Repositories.
3. **Pro Person einen Token erstellen**, aus deinem Konto: github.com/settings/personal-access-tokens/new
   - Name z. B. „Reh-Damm Andreas Kall“
   - Repository access: **nur** `streckenbericht-schalenwild`
   - Permissions → Contents: **Read and write**
   - Die Personen brauchen kein eigenes GitHub-Konto.
4. **In der App** unter Einstellungen → Zugang:
   - Du: „Ich bin“ Sebastian Bruns, Berechtigung „Voller Zugang“.
   - Die anderen: ihren Namen, „Reh- & Dammwild eintragen“ und ihren Token.

Jeder Eintrag merkt sich, **wer ihn eingetragen hat**. Wenn zwei Leute gleichzeitig speichern, geht nichts verloren.
Zugang entziehen: den Token der Person auf GitHub löschen.

Hattest du schon Reh-/Dammwild in Version 1.5 eingetragen, verschiebt die App diese Einträge beim ersten Öffnen mit vollem Zugang automatisch ins neue Repository.

### 5. Datenschutz: Passwort der Jagdgemeinschaft
1. Die neuen App-Dateien hochladen.
2. In der App unter Einstellungen → **Datenschutz** ein Passwort festlegen (mind. 6 Zeichen) und auf **Übernehmen** tippen.
   Beide Daten-Dateien (Niederwild und Reh/Damm) werden sofort verschlüsselt gespeichert. Auf GitHub steht danach nur noch unlesbarer Zeichensalat.
3. Das Passwort an die Jäger weitergeben. Jeder gibt es **einmal pro Gerät** ein.
4. **Passwort gut aufbewahren.** Ohne das Passwort lassen sich die Daten nicht mehr lesen.

**Passwort vergessen?** Auf dem Sperrbildschirm „Passwort vergessen?“ antippen (nur mit vollem Zugang). Als Stand wählst du „Stand auf diesem Gerät“ oder deine Sicherungsdatei, dann vergibst du ein neues Passwort. Beide Dateien werden neu verschlüsselt. Auf einem fremden Gerät fragt die App zusätzlich nach deinem GitHub-Token.
**Tipp:** Regelmäßig (z. B. nach jedem Jagdtag) unter Einstellungen → Datensicherung „Sicherung speichern“ in deinen OneDrive-Ordner.

Passwort ändern: Neues Passwort eintragen und übernehmen. Alle Geräte fragen dann einmal nach dem neuen Passwort.
Die Seite ist außerdem für Suchmaschinen gesperrt („noindex“).

**Wichtig:** Die Datei `data/strecke.json` in diesem Ordner ist der alte Startstand im Klartext. **Nicht mehr hochladen**, sonst werden die aktuellen Daten überschrieben und sind wieder lesbar.

**Alte Klartext-Versionen entfernen (einmalig, empfohlen):** GitHub speichert alle früheren Versionen einer Datei. Die unverschlüsselten Stände vor Schritt 2 sind deshalb in der Versionsgeschichte noch abrufbar. So wirst du sie los:
1. Im Repository `streckenbericht` die verschlüsselte Datei `data/strecke.json` öffnen und über **Download raw file** herunterladen.
2. *Settings → General* öffnen, das Repository in `streckenbericht-alt` umbenennen und ganz unten unter „Danger Zone“ auf **Private** stellen. Private Repositories sind kostenlos.
3. Ein neues, öffentliches Repository `streckenbericht` anlegen. Die App-Dateien aus diesem Ordner hochladen, aber **nicht** `data/strecke.json` von hier, sondern die heruntergeladene verschlüsselte Datei in den Ordner `data/`. Danach GitHub Pages wieder einschalten wie in Schritt 1.
4. **Deinen Token bearbeiten** und bei Repository access das neue `streckenbericht` auswählen. Tokens sind an das konkrete Repository gebunden, nicht an den Namen.
5. Für `streckenbericht-schalenwild` gilt dasselbe nur, wenn dort schon vor dem Passwort Einträge gespeichert wurden. Dann müssten allerdings auch die sechs Reh-&-Damm-Tokens auf das neue Repository umgestellt werden.

### 6. Wild melden (alle Jäger → Posteingang)
Auf der Startseite kann jeder mit dem Passwort ein erlegtes Stück melden. Die Meldungen landen verschlüsselt in einem eigenen Repository, und du übernimmst sie per Knopfdruck.
1. Neues Repository `Streckenbericht-meldungen` anlegen (Private oder Public, der Inhalt ist verschlüsselt).
2. Einen Fine-grained Token **nur für dieses Repository** erstellen: *Contents: Read and write*. Ablaufdatum möglichst lang, bei Ablauf neu erstellen und eintragen.
3. In der App: *Einstellungen → Meldungen*, Token einfügen und übernehmen. Der Token wird verschlüsselt in den Hauptdaten gespeichert und gelangt so automatisch auf alle Geräte. Keiner muss etwas einrichten.
4. Neue Meldungen erscheinen bei dir auf der Startseite als **„📬 N neue Meldungen“**. „Übernehmen“ öffnet das passende Formular (Nachtrag bzw. Reh- & Dammwild) vorausgefüllt, nach dem Speichern verschwindet die Meldung. 5. **Push aufs Handy (optional):** App *ntfy* installieren (kostenlos, kein Konto). In der Streckenbericht-App unter *Einstellungen → Meldungen* auf „Kanal erzeugen“ tippen, dann „Übernehmen“. In ntfy auf „+“ tippen und genau diesen Kanalnamen abonnieren (Server ntfy.sh). Mit „Test senden“ prüfen. Die Nachricht enthält nur Wildart und Datum, keine Namen.
6. **Zahl am App-Symbol (optional):** „Zahl am App-Symbol erlauben“ antippen und die Mitteilungen erlauben. Die Zahl aktualisiert sich, sobald die App geöffnet wird.

## Jagdkönig freigeben
Den Jagdkönig des **laufenden** Jagdjahres sieht zunächst nur der Admin. Auf der Seite Jagdkönig zeigt die Karte „🔒 Nur für dich sichtbar“ den Knopf **„Für alle freigeben“** (zweimal tippen). Mit „Wieder sperren“ lässt sich das zurücknehmen. Vergangene Jagdjahre sind immer für alle sichtbar. Die Jagdtage mit Tageskönigen bleiben sichtbar.

## Ablauf am Jagdtag
1. Die Erlegerliste wie gewohnt am Tisch ausfüllen.
2. In der App **📷 Erlegerliste fotografieren** antippen.
3. Die KI trägt alles vor. Wenn die handschriftlichen Punkte nicht zur Berechnung passen oder die KI unsicher ist, wird die Zeile **orange markiert**. Neue Namen (Gäste) ordnest du zu oder legst sie als neuen Schützen an.
4. Kurz prüfen und auf **Speichern** tippen. Der neue Stand ist sofort für alle sichtbar.

Beim Speichern ohne Netz bleiben die Daten auf dem Gerät, und oben erscheint „Erneut senden“.

## Neue Version einspielen
Nach jeder Änderung an den App-Dateien in `sw.js` die Zeile `VERSION = 'sb-2.2.0'` hochzählen. Die Nutzer sehen dann den Hinweis **„Neue Version verfügbar – Neu laden“**.

## Daten
Alle Daten liegen in `data/strecke.json`. Jede Speicherung ist ein Commit in GitHub, dadurch gibt es automatisch eine Versionshistorie. Zusätzlich gibt es in den Einstellungen **„Sicherung speichern“ / „Sicherung einspielen“**. Die Sicherung enthält Niederwild und Reh- & Dammwild **unverschlüsselt**, gehört also nur in deinen eigenen Ordner.

Enthalten sind die Jagdtage 18.10., 03.11., 08.11. und 29.11.2025, übernommen von den Erlegerlisten.
