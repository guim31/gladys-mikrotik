# MikroTik

Verfolge deinen [MikroTik](https://mikrotik.com)-Router in Gladys, über dein
lokales Netzwerk: Erfahre anhand der Handys in deinem WLAN, wer zu Hause ist,
behalte den Zustand des Routers und die Raten deines Internetzugangs im Blick,
werde benachrichtigt, wenn das WAN ausfällt oder sich ein unbekanntes Gerät
verbindet, und sperre, wenn du es erlaubst, das Internet des Kinder-Tablets
aus einer Szene.

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Diese
> Integration wurde anhand der von MikroTik dokumentierten Antworten und der
> Testdaten der Home-Assistant-Integration geschrieben und getestet, nicht an
> einem echten Router. Wenn etwas nicht wie beschrieben funktioniert, sag es
> im [Gladys-Forum](https://community.gladysassistant.com) oder in den
> [Issues](https://github.com/guim31/gladys-mikrotik/issues).

Diese Integration ist nicht mit MikroTik verbunden.

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen MikroTik-Router mit **RouterOS 7** (REST-API) oder **RouterOS 6.43**
  oder neuer (API), von Gladys aus erreichbar.
- Einen dieser RouterOS-Dienste aktiviert (**IP** → **Services**): `www-ssl`
  (HTTPS, RouterOS 7), `api-ssl`, `www` (HTTP, RouterOS 7) oder `api`. Die
  Standardkonfiguration von RouterOS aktiviert `www` und `api`.
- Einen RouterOS-Benutzer für Gladys (siehe unten).

## Einrichtung

### Der RouterOS-Benutzer

Lege einen eigenen Benutzer an, statt `admin` zu verwenden. Ein Konto mit
**nur Leserechten** reicht für die Anwesenheitssensoren, die Messwerte, die
Auslöser und die Widgets. In einem Terminal (WinBox, WebFig oder SSH):

```
/user add name=gladys group=read password=ein-langes-passwort
```

Prüfe, dass die Gruppe die Berechtigung `api` hat, und `rest-api` unter
RouterOS 7 (**System** → **Users** → **Groups**). Die Befehle
(Firewall-Regeln, Neustart) brauchen eine Gruppe mit den Rechten `write` und
`reboot`, zum Beispiel `write`.

Für mehr Sicherheit erlaube den Dienst nur von der Adresse von Gladys aus,
z. B. `/ip service set www address=192.168.88.10/32`.

### Die Konfiguration

Öffne **Integrationen** → **MikroTik** → **Konfiguration**:

- **Adresse des Routers**: seine IP-Adresse (standardmäßig `192.168.88.1`),
  mit `:Port`, falls der Dienst nicht seinen Standardport nutzt.
- **Benutzername** und **Passwort** des RouterOS-Benutzers.
- **Protokoll**: _Automatisch_ probiert REST über HTTPS, API-SSL, REST über
  HTTP, dann API, und behält das erste, das funktioniert; die verschlüsselten
  zuerst. Wähle eines, um es festzulegen.
- **Selbstsigniertes Zertifikat akzeptieren**: für HTTPS und API-SSL. RouterOS
  nutzt ein selbstsigniertes Zertifikat, wenn du kein anderes installiert
  hast.
- **Aktualisierungsintervall**: 10 Sekunden bis 1 Minute (standardmäßig 30
  Sekunden).
- **WAN-Schnittstellen**: leer nimmt die Integration die Mitglieder der
  Schnittstellenliste `WAN` von RouterOS (die Standardkonfiguration legt
  `ether1` hinein), sonst `ether1`. Höchstens vier Namen, durch Kommas
  getrennt.
- **Anwesenheit**: die **Abwesenheitsverzögerung (Minuten)** und die Quellen (siehe unten).
- **Zu verfolgende Firewall-Regeln** und **Befehle erlauben** (siehe unten).
- **Sprache der Namen**: die Sprache der Geräte- und Funktionsnamen.

Drücke dann auf **Verbindung testen**: Der Bericht nennt das genutzte
Protokoll, die verfolgten WAN-Schnittstellen, die Anzahl der gesehenen Clients
und ob die verfolgten Regeln existieren. Öffne zum Schluss den Tab
**Entdecken** und füge die gewünschten Geräte hinzu.

## Die Geräte

### Der Router

Ein Gerät, benannt nach der RouterOS-Identität:

| Funktion                  | Was sie zeigt                                          |
| ------------------------- | ------------------------------------------------------ |
| CPU-Auslastung            | in %                                                   |
| Belegter Speicher         | in %                                                   |
| Temperatur                | in °C, wenn der Router einen Sensor hat                |
| Betriebszeit              | in Stunden                                             |
| RouterOS-Version          | z. B. `7.18.2`                                         |
| RouterOS-Update verfügbar | An, wenn RouterOS eine neuere Version meldet           |
| Download / Upload         | je WAN-Schnittstelle, in Mbit/s, gemittelt über Zyklus |
| WAN-Verbindung            | je WAN-Schnittstelle: An, wenn die Verbindung steht    |

Die Integration bittet RouterOS einmal am Tag, nach Updates zu suchen (ein
Benutzer mit nur Leserechten kann das nicht: Dann wird die letzte Suche von
RouterOS angezeigt).

### Anwesenheitssensoren

Der Tab Entdecken listet die Clients des Routers: seine DHCP-Leases, seine
WLAN-Registrierungstabellen (`wireless`, `wifiwave2`, `wifi` und CAPsMAN) und,
falls aktiviert, seine ARP-Tabelle. Füge die Handys hinzu, die du verfolgen
willst: Jedes wird ein Sensor **Anwesenheit**, benannt nach seinem Kommentar
in RouterOS, sonst nach seinem Hostnamen.

- Ein Gerät ist **anwesend**, sobald der Router es sieht: mit dem WLAN
  verbunden, oder mit einem lebendigen ARP-Eintrag, wenn **Auch die
  ARP-Tabelle nutzen** aktiviert ist, oder mit einem aktiven DHCP-Lease, wenn
  **DHCP-Lease als anwesend zählen** aktiviert ist.
- Es wird erst **abwesend**, wenn es während der
  **Abwesenheitsverzögerung** (standardmäßig 5 Minuten) nicht gesehen wurde:
  Ein Handy im Ruhezustand verlässt das WLAN für einige Minuten, ohne das Haus
  zu verlassen.
- Wenn der Router nicht gelesen werden kann, ändert niemand seinen Zustand.

Ein anwesendes Gerät wird alle zwei Minuten erneut gemeldet, damit auch die
Szenenaktion _Anwesenheit von Benutzern überprüfen_ von Gladys funktioniert; mit der
Abwesenheitsverzögerung brauchst du sie selten.

Handys nutzen pro Netzwerk eine private (zufällige) WLAN-Adresse. Lass sie
für dein WLAN zu Hause **fest** (unter iOS: _Private WLAN-Adresse_ auf
_Fest_; unter Android: zufällig pro Netzwerk, nicht pro Verbindung), sonst
wirkt das Gerät nach einer Änderung neu.

### Firewall-Regeln

Um eine Regel zu verfolgen, gib ihr in RouterOS einen Kommentar (**IP** →
**Firewall** → **Filter Rules**) und trage diesen Kommentar in **Zu
verfolgende Firewall-Regeln** ein (**Firewall-Regeln auflisten** zeigt die
kommentierten Regeln). Jede wird ein Gerät mit der Funktion **Regel
aktiviert** (An, wenn die Regel aktiviert ist). Die IPv4- und IPv6-Regeln mit
demselben Kommentar zählen als eine.

Der Zustand ist nur lesbar. Mit **Befehle erlauben** können die
Szenenaktionen und das Widget die Regel aktivieren oder deaktivieren: Die
Integration ändert dann nur das Flag `disabled` dieser Regeln und sonst nichts
an der Konfiguration.

## Dashboard

Drei Widgets:

- **MikroTik-Router**: CPU, Speicher, Temperatur, Download- und Upload-Rate
  der ersten WAN-Schnittstelle, der Zustand jeder WAN-Verbindung, die
  Betriebszeit, die RouterOS-Version oder das verfügbare Update und eine Taste
  **Neu starten** (mit Bestätigung), wenn die Befehle erlaubt sind.
- **Anwesende Geräte**: die als Anwesenheitssensoren verfolgten Geräte,
  anwesende zuerst, mit der Dauer der Abwesenheit der anderen. Die Einstellung
  **Anzeigen** behält nur die anwesenden.
- **Firewall-Regeln**: die verfolgten Regeln und, wenn die Befehle erlaubt
  sind, eine Taste pro Regel (höchstens vier), um sie zu aktivieren oder zu
  deaktivieren, mit Bestätigung. Ein Häkchen zeigt die aktivierten Regeln.

## Szenen

### Auslöser

- **Unbekanntes Gerät verbunden**: Eine noch nie gesehene MAC-Adresse hat
  sich mit dem WLAN verbunden oder ein DHCP-Lease erhalten. Die Geräte, die
  beim allerersten Start der Integration da sind, werden gelernt, ohne
  auszulösen. Filter: _Gesehen über_ (WLAN oder DHCP-Lease). Variablen:
  MAC-Adresse, IP-Adresse, Hostname, gesehen über, Schnittstelle.
- **WAN-Verbindung getrennt**: Eine WAN-Schnittstelle hat ihre Verbindung
  verloren. Filter: _Schnittstelle_. Variable: Schnittstelle.
- **WAN-Verbindung wiederhergestellt**: Die Verbindung ist zurück. Filter:
  _Schnittstelle_. Variablen: Schnittstelle, Ausfall in Minuten.

### Aktionen

Diese Aktionen brauchen **Befehle erlauben** und einen RouterOS-Benutzer mit den Rechten
`write` und `reboot`.

- **Firewall-Regel aktivieren** und **Firewall-Regel deaktivieren**: Wähle ein
  Regel-Gerät. Ausgabe: _Regel aktiviert_.
- **MikroTik-Router neu starten**: Das Netzwerk ist ein bis zwei Minuten
  unterbrochen.

### Szenenideen

- _Niemand zu Hause_: Wenn die Anwesenheit jedes Handys „Keine Anwesenheit“
  ist, schalte die Alarmanlage scharf und senke die Heizung.
- _Schlafenszeit für das Tablet_: Jeden Abend um 21 Uhr **Firewall-Regel
  aktivieren** „Kinder-Tablet sperren“; um 7 Uhr **Firewall-Regel
  deaktivieren**.
- _Internetausfall_: Bei **WAN-Verbindung getrennt** sende eine Nachricht über
  einen Kanal, der kein Internet braucht (ein SMS-Gateway im LAN), und bei
  **WAN-Verbindung wiederhergestellt** melde, wie lange er gedauert hat.
- _Wer ist das?_: Bei **Unbekanntes Gerät verbunden** schick dir eine
  Nachricht mit seinem Hostnamen und seiner IP-Adresse.

## Wie oft der Router gelesen wird

Die Integration liest den Router selbst, im Aktualisierungsintervall der
Konfiguration (Gladys fragt diese Geräte nicht ab). Eine Abfrage sind etwa
zehn kleine Listen (Ressourcen, Zustand, Schnittstellen, WLAN, ARP,
DHCP-Leases, Regeln): vernachlässigbar für den Router. Der Update-Status wird
stündlich gelesen, und RouterOS fragt einmal am Tag die Server von MikroTik.
Nur die Werte, die sich ändern, gehen an Gladys, dazu ein Lebenszeichen alle
sechs Stunden.

## Fehlerbehebung

- **„Benutzername oder Passwort vom Router abgelehnt“**: Prüfe sie in WinBox.
  Nach einer Ablehnung versucht es die Integration alle fünf Minuten erneut
  (jeder Versuch ist eine Zeile im Protokoll von RouterOS).
- **„der Benutzergruppe fehlt eine Berechtigung“**: Gib der Gruppe `api` (und
  `rest-api` unter RouterOS 7).
- **„Zertifikat abgelehnt“**: Aktiviere **Selbstsigniertes Zertifikat
  akzeptieren** oder installiere ein Zertifikat, dem Gladys vertraut.
- **„antwortet nicht“**: Prüfe die Adresse, dass der Dienst unter **IP** →
  **Services** aktiviert ist und dass sein Feld `address` Gladys erlaubt.
- **Keine WAN-Rate**: Die Raten brauchen zwei Abfragen; prüfe die Namen in
  **WAN-Schnittstellen**.
- **Ein Handy bleibt abwesend**: Aktiviere **Auch die ARP-Tabelle nutzen**,
  erhöhe die Abwesenheitsverzögerung und prüfe, dass seine private
  WLAN-Adresse fest ist.
- Mehr Details: Starte die Integration mit `LOG_LEVEL=debug`. Auf der
  Standardstufe zeigen die Protokolle nur den Start, den verlorenen und
  wiedergefundenen Router, die Probleme (je einmal) und deine Befehle.
  Passwörter erscheinen nie in den Protokollen.

## Grenzen

- Ein Router pro Integration. Mit mehreren Access Points verfolge die
  Anwesenheit auf dem, der alle Clients sieht (der CAPsMAN-Controller oder der
  Router mit der ARP-Tabelle).
- Der Zustand der WAN-Verbindung ist der der Schnittstelle: Ein
  Internetausfall hinter einer funktionierenden Verbindung (beim Anbieter)
  wird nicht erkannt.
- Die Raten sind Mittelwerte über das Aktualisierungsintervall, aus den
  Zählern der Schnittstellen.
- Die WLAN-Tabellen von Access Points anderer Marken werden nicht gelesen:
  Nutze die ARP-Tabelle.
- Geräte- und Funktionsnamen werden beim Hinzufügen eines Geräts zu Gladys
  festgelegt.
- Nur Filterregeln der Firewall (kein NAT, Mangle oder Kid Control), gefunden
  über ihren genauen Kommentar.
- Ohne die Hardware entwickelt: Die Antworten echter Router können von den
  dokumentierten abweichen. Rückmeldungen willkommen.
