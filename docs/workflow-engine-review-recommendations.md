# Workflow Engine Review Recommendations

> Stand: 2026-06-08  
> Kontext: Review der eingebetteten RheinAgent Workflow Engine unter `apps/workflow-engine/` mit Fokus auf Produktionsreife, Dashboard-Kompatibilitaet, RBAC/Team-Scoping, CI-Abdeckung, Secret Handling, RAG-Index-Wartung und zukuenftige praktische Features.

## 1. Zusammenfassung

Die Workflow Engine ist inzwischen deutlich weiter als in den frueheren Integrationsphasen. Die wichtigsten Correctness- und Sicherheitsprobleme aus dem Engine-Audit sind laut aktuellem Handoff abgearbeitet: Org-Scoping, Secret-Masking, Definition-Validierung, Cycle-Reject, fail-closed Conditions, No-Self-Approval, Scheduler Atomic Claim, Branch-/Edge-Routing sowie n8n-Importvalidierung.

Trotzdem bleiben einige wichtige Punkte offen, bevor die Engine als produktiver, team- und rollenbasierter n8n-Ersatz gelten sollte:

1. Die Engine wird noch nicht in der GitHub Actions CI gebaut oder getestet.
2. In den geprueften Engine-Routen ist zwar Org-Scoping vorhanden, aber keine explizite, zentrale Permission-/Team-Pruefung sichtbar.
3. Mehrere live genutzte Engine-Routen tragen noch veraltete Demo-/Reference-Kommentare.
4. Connector-Secrets werden beim Lesen maskiert, aber sensible Werte koennen weiterhin in `configJson` landen, wenn die UI oder API sie dort uebergibt.
5. Das RAG-Reindex-Template nutzt weiterhin einen taeglichen Full-Reindex als Standard, was fuer produktive RAG-Systeme meist unguenstig ist.
6. Das Workflow-Engine-Package traegt noch einen generischen Scaffold-Namen.

Dieser Bericht beschreibt die Punkte detailliert, schlaegt konkrete Massnahmen vor und nennt sinnvolle Feature-Erweiterungen fuer die naechsten Ausbaustufen.

---

## 2. Aktueller positiver Stand

### 2.1 Org-Scoping ist in den geprueften Routen vorhanden

Die Workflow-Detailroute prueft inzwischen, ob der geladene Workflow zur `organizationId` aus dem Runtime Context gehoert. Wird ein Workflow aus einer anderen Organisation angefragt, liefert die Route `404 Workflow not found`.

Beispielmuster:

```ts
const ctx = getRuntimeContext(request);
const workflow = await db.workflowDefinition.findUnique({ where: { id } });

if (!workflow || workflow.organizationId !== ctx.organizationId) {
  return NextResponse.json(
    { success: false, error: 'Workflow not found' },
    { status: 404 }
  );
}
```

Das ist die richtige Grundrichtung, weil fremde Organisationsdaten nicht durch unterscheidbare Fehler oder IDs sichtbar werden.

### 2.2 Publish-Validierung ist vorhanden

Der Publish-Pfad parst die gespeicherte Definition und ruft `validateWorkflowDefinition()` auf. Ungueltige Definitionen werden mit `400` und Fehlerdetails abgelehnt.

Das ist sinnvoll, weil Drafts im Builder unfertig sein duerfen, aber nur valide, ausfuehrbare Workflows aktiv werden sollten.

### 2.3 Scheduler-Correctness wurde verbessert

Der Scheduler wurde laut Handoff auf Atomic Claim und `nextRunAt`-Advance umgestellt. Dadurch sollen parallele Ticks/Replicas dieselbe Faelligkeit nicht mehrfach ausloesen. Ausserdem verhindert der fruehe Advance, dass ein fehlschlagender Start denselben Schedule bei jedem Tick erneut triggert.

### 2.4 Branch-/Edge-Routing wurde verbessert

If/Else- und Branch-Workflows sollen nicht mehr beide Zweige ausfuehren. Die Engine nutzt dafuer Reachability-/Edge-Aktivitaetslogik wie `isEdgeActive()` und `isNodeReachable()`.

### 2.5 Templates sind vorhanden

Die Engine enthaelt bereits praxisnahe Workflow-Templates wie:

- taeglicher E-Mail-Digest,
- woechentlicher Team-Digest,
- RAG-Reindex-Schedule,
- Backup-Status-Digest,
- approval-basierter Mailversand.

Das ist eine gute Grundlage fuer ein Dashboard, das nicht nur technische Workflows anbietet, sondern fachliche Automationen fuer Administratoren und Teamleads.

---

## 3. Empfehlung 1: Workflow Engine in CI aufnehmen

### Problem

Die aktuelle CI prueft Backend und Frontend, aber nicht `apps/workflow-engine/`. Dadurch koennen TypeScript-, Build-, Lint- oder Dependency-Probleme in der Engine unbemerkt in `master` landen.

Der aktuelle Handoff nennt lokale Verifikation ueber:

```bash
cd apps/workflow-engine
bun run build
bun run lint
# plus Harness-Skripte wie verify-workflows.ts, verify-approval.ts, verify-scheduler.ts usw.
```

Lokale Verifikation ist gut, aber sie ersetzt keine CI-Gate-Pruefung.

### Risiko

Ohne CI-Abdeckung kann Folgendes passieren:

- Engine kompiliert lokal bei einem Entwickler, aber nicht in sauberer CI-Umgebung.
- Dependency- oder Lockfile-Probleme bleiben unbemerkt.
- Routing-/Builder-Aenderungen brechen die Engine, obwohl Backend/Frontend CI gruen bleibt.
- Zukuenftige Agenten oder Entwickler vergessen die Sonderverifikation.
- Sicherheitsfixes in Engine-Routen werden nicht automatisch gegen Regressionen geschuetzt.

### Empfehlung

Einen eigenen GitHub-Actions-Job `workflow-engine` ergaenzen.

Minimaler CI-Job:

```yaml
workflow-engine:
  name: Workflow Engine (build, lint)
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: apps/workflow-engine
  steps:
    - uses: actions/checkout@v6

    - name: Set up Bun
      uses: oven-sh/setup-bun@v2

    - name: Install dependencies
      run: bun install --frozen-lockfile

    - name: Build
      run: bun run build

    - name: Lint
      run: bun run lint
```

Falls die Engine ein eigenes Typecheck-Script erhaelt, sollte es explizit eingebaut werden:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Dann im CI-Job:

```yaml
- name: Typecheck
  run: bun run typecheck
```

### Erweiterte CI mit Harness-Skripten

Wenn die vorhandenen Harness-Skripte stabil ohne externe Dienste laufen, sollten sie ebenfalls aufgenommen werden:

```yaml
- name: Verify workflow engine harnesses
  run: |
    bun run scripts/verify-workflows.ts
    bun run scripts/verify-approval.ts
    bun run scripts/verify-scheduler.ts
    bun run scripts/verify-branch-routing.ts
    bun run scripts/verify-n8n-import.ts
```

Falls einzelne Harnesses externe Dienste oder lokale Datenbanken benoetigen, sollten sie entweder:

- auf Mock-/SQLite-/Testmodus umgestellt werden,
- in einen separaten optionalen Job wandern,
- oder als `workflow-engine-smoke` nur bei bestimmten Branches laufen.

### Akzeptanzkriterien

- Pull Requests werden rot, wenn `apps/workflow-engine` nicht mehr baut.
- Lint-Fehler in der Engine blockieren Merge.
- TypeScript-Fehler in der Engine blockieren Merge.
- Wichtige Engine-Harnesses laufen reproduzierbar in CI oder sind bewusst als lokale Checks dokumentiert.

### Prioritaet

**Hoch / P1.**  
Die Engine ist inzwischen ein zentraler Produktbestandteil. Sie sollte nicht laenger ausserhalb der CI laufen.

---

## 4. Empfehlung 2: Explizite RBAC- und Team-Guards in Engine-Routen einfuehren

### Problem

In den geprueften Engine-Routen ist Org-Scoping sichtbar, aber keine explizite zentrale Permission-Pruefung. Beispiele:

- `POST /api/workflows` erstellt einen Workflow im aktuellen `organizationId`-Scope, akzeptiert aber `teamId` aus dem Request Body.
- `PATCH/PUT /api/workflows/[id]` erlaubt Felder wie `teamId` und `status` aus dem Body.
- `POST /api/workflows/[id]/publish` prueft Org-Scoping und Definition-Validierung, aber in der Route selbst keine sichtbare Permission wie `workflow.manage`.

Es kann sein, dass spaeter noch ein uebergeordneter Guard oder Adapter eingefuehrt wird. In den Live-Routen sollte die Berechtigung aber direkt sichtbar und testbar sein.

### Risiko

Ohne explizite Permission-/Team-Pruefung koennte ein eingeloggter Nutzer mit Zugriff auf `/workflows` potentiell:

- Workflows erstellen,
- Workflows fremden Teams zuordnen,
- Workflows bearbeiten,
- Status direkt setzen,
- Workflows publishen,
- Connectoren fuer Teams anlegen,
- Schedules konfigurieren,
- Aktionen starten, die eigentlich Admin- oder Teamlead-Rechte benoetigen.

Org-Scoping verhindert Cross-Org-Leaks, aber nicht automatisch Missbrauch innerhalb derselben Organisation.

### Empfehlung

Eine zentrale RBAC-Schicht in der Engine ergaenzen, die auf dem signierten Runtime Context basiert.

Moegliche Helper:

```ts
export function hasPermission(ctx: RuntimeContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

export function requirePermission(
  ctx: RuntimeContext,
  permission: string
): void {
  if (!hasPermission(ctx, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

export function requireAnyPermission(
  ctx: RuntimeContext,
  permissions: string[]
): void {
  if (!permissions.some((permission) => ctx.permissions.includes(permission))) {
    throw new ForbiddenError(`Missing one of permissions: ${permissions.join(', ')}`);
  }
}
```

Fuer Team-Scoping:

```ts
export async function assertTeamScope(params: {
  ctx: RuntimeContext;
  teamId: string | null | undefined;
  action: 'view' | 'manage' | 'run';
}): Promise<void> {
  const { ctx, teamId, action } = params;

  if (!teamId) return;

  if (ctx.permissions.includes('workflow.admin')) return;

  const scopedPermission =
    action === 'view'
      ? 'workflow.view.team'
      : action === 'run'
        ? 'workflow.run.team'
        : 'workflow.manage.team';

  if (!ctx.permissions.includes(scopedPermission)) {
    throw new ForbiddenError(`Missing team-scoped permission: ${scopedPermission}`);
  }

  // If team membership cannot be inferred from ctx, call TeamAdapter.
  // await teamAdapter.assertUserInTeam(ctx.userId, teamId)
}
```

### Empfohlene Permissions

Kurzfristig ausreichend:

```text
workflow.view
workflow.create
workflow.manage
workflow.run
workflow.approve
connector.view
connector.use
connector.manage
schedule.view
schedule.manage
digest.view
digest.manage
workflow.admin
```

Spaeter feiner:

```text
workflow.view.team
workflow.create.team
workflow.manage.team
workflow.run.team
workflow.runs.view
connector.manage_secrets
approval.manage
schedule.run_now
```

### Konkrete Routen-Gates

| Route/Funktion | Empfohlene Permission |
|---|---|
| `GET /api/workflows` | `workflow.view` oder `workflow.view.team` |
| `POST /api/workflows` | `workflow.create` |
| `GET /api/workflows/[id]` | `workflow.view` + Scope |
| `PATCH/PUT /api/workflows/[id]` | `workflow.manage` + Scope |
| `DELETE /api/workflows/[id]` | `workflow.manage` + Scope |
| `POST /api/workflows/[id]/publish` | `workflow.manage` + Scope |
| `POST /api/workflows/[id]/run` | `workflow.run` + Scope |
| `POST /api/schedules` | `schedule.manage` + Workflow-Scope |
| `POST /api/connectors` | `connector.manage` + Team-Scope |
| `POST /api/connectors/[id]/test` | `connector.use` oder `connector.manage` |
| `POST /api/approvals/[id]/approve` | `workflow.approve` + Approval-Scope |

### Status-Felder nicht blind erlauben

Aktuell ist `status` im Update-Allowlist-Muster enthalten. Das ist riskant, weil Lifecycle-Aktionen normalerweise eigene Endpunkte haben sollten.

Empfehlung:

- `status` aus normalem PATCH/PUT entfernen.
- Statuswechsel nur ueber dedizierte Endpunkte:
  - `/publish`
  - `/pause`
  - `/activate`
  - `/archive`
- Jeder Lifecycle-Endpunkt prueft eigene Rechte und Validierungsregeln.

### Akzeptanzkriterien

- Nutzer ohne `workflow.create` kann keinen Workflow erstellen.
- Nutzer ohne `workflow.manage` kann keinen Workflow bearbeiten oder publishen.
- Nutzer ohne Team-Recht kann keinen Workflow einem fremden Team zuordnen.
- Nutzer ohne `workflow.run` kann keinen Run starten.
- Tests decken mindestens folgende Faelle ab:
  - fehlende Permission -> 403,
  - falsches Team -> 403 oder 404,
  - falsche Org -> 404,
  - Admin -> erlaubt,
  - Teamlead mit Team-Scope -> erlaubt im eigenen Team.

### Prioritaet

**Hoch / P1.**  
Org-Scoping ist vorhanden, aber produktive Team-/Rollenfaehigkeit braucht sichtbare, zentrale Permission-Pruefungen.

---

## 5. Empfehlung 3: Secret Handling bei Connectoren haerten

### Problem

Connectoren maskieren sensible Config-Felder beim Serialisieren. Das ist positiv. Allerdings speichert `connectorService.create()` die uebergebene `config` direkt als `configJson`.

Wenn die UI oder API versehentlich echte Secrets in `config` uebergibt, koennen sie in der Engine-Datenbank landen. Beim Lesen sind sie maskiert, aber at-rest wurden sie trotzdem gespeichert.

### Risiko

- Secrets liegen in der Engine-DB statt im Backend Secret Store.
- Backups der Engine-DB enthalten moeglicherweise API-Keys, Tokens oder Passwoerter.
- Maskierung beim Lesen schuetzt nicht gegen DB-Zugriff, Dumps oder Fehlkonfiguration.
- Spaetere Integrationen koennten nicht wissen, ob `configJson` geheimnisfrei ist.

### Empfehlung

Klare Trennung einfuehren:

```text
configJson  -> nur nicht-geheime Connector-Konfiguration
secretRef   -> Referenz auf geheimen Wert im RheinAgent Backend Secret Store
```

Sensible Keys sollten serverseitig erkannt und abgelehnt oder automatisch ausgelagert werden.

Beispiele fuer sensible Keys:

```text
apiKey
api_key
secret
password
token
accessToken
refreshToken
clientSecret
privateKey
authKey
```

### Variante A: Strict Reject

Wenn `config` sensible Keys enthaelt, wird der Request abgelehnt:

```ts
if (containsSensitiveConfigKeys(config)) {
  return NextResponse.json(
    {
      success: false,
      error: 'Connector config contains secret fields. Use secretRef / Secret Adapter instead.',
    },
    { status: 400 }
  );
}
```

Vorteil:

- Einfach.
- Sicher.
- Keine implizite Magie.

Nachteil:

- UI muss Secret-Flow explizit implementieren.

### Variante B: Automatische Auslagerung

Die Engine erkennt sensible Felder, ruft den Secret Adapter auf, speichert den geheimen Wert im Backend und entfernt ihn aus `configJson`.

Ergebnis:

```json
{
  "configJson": {
    "host": "imap.example.com",
    "port": 993,
    "username": "service@example.com"
  },
  "secretRef": "wfsec_..."
}
```

Vorteil:

- Benutzerfreundlicher.

Nachteil:

- Komplexer.
- Fehlerfall muss sauber behandelt werden.

### Empfehlung fuer RheinAgent

Kurzfristig: **Strict Reject**.  
Mittelfristig: UI Wizard mit Secret Adapter.

### Akzeptanzkriterien

- Neue Connectoren speichern keine bekannten Secret-Felder in `configJson`.
- Secret-Werte werden nur ueber Backend Secret Store gespeichert.
- GET-Responses bleiben maskiert.
- Rotation aktualisiert Backend Secret Store, nicht nur lokale Dummy-Werte.
- Tests pruefen, dass `apiKey`, `password`, `token` etc. nicht persistiert werden.

### Prioritaet

**Hoch / P1.**  
Maskierung ist gut, aber produktive Secret-Sicherheit sollte bereits beim Schreiben beginnen.

---

## 6. Empfehlung 4: Stale Demo-Kommentare entfernen

### Problem

Mehrere live relevante Engine-Routen enthalten noch Header wie:

```ts
// DEMO / REFERENCE ROUTE
// This API route is part of the WORKFLOW standalone demo.
// In RheinAgent production, these endpoints are served by the FastAPI backend.
// This file serves as a reference implementation and should NOT be used
// as the production backend for RheinAgent.
```

Der Correctness-Plan stellt aber klar, dass diese Routen ueber `/workflows/*` live erreichbar sind und die Kommentare veraltet sind.

### Risiko

- Zukuenftige Entwickler oder KI-Agenten unterschaetzen die Relevanz dieser Routen.
- Sicherheitsluecken koennen als „nur Demo“ abgetan werden.
- Architekturverstaendnis wird erschwert.
- Reviews koennen falsche Prioritaeten setzen.

### Empfehlung

Header ersetzen durch produktionsnahe Beschreibung:

```ts
// ============================================================================
// RheinAgent Embedded Workflow Engine Route
// ============================================================================
// This route is served behind the FastAPI /workflows proxy.
// Identity is provided through signed X-* headers from RheinAgent.
// Handlers must enforce organization scope, permissions and team scope.
// ============================================================================
```

Fuer Routen, die wirklich nur Standalone-Demo sind, sollte das explizit und korrekt markiert werden:

```ts
// Standalone-only route. Not mounted in RheinAgent production.
```

### Akzeptanzkriterien

- Live-Routen enthalten keine falschen Demo-/Reference-Warnungen mehr.
- Standalone-only Routen sind eindeutig als solche markiert.
- Architektur-Doku nennt klar, welche API-Schicht produktiv ist.

### Prioritaet

**Mittel / P2.**  
Kein direkter Runtime-Bug, aber wichtig fuer Wartbarkeit und sichere Reviews.

---

## 7. Empfehlung 5: RAG-Reindex-Template in Index-Maintenance umbauen

### Problem

Das aktuelle Template `RAG-Reindex-Schedule` nutzt `fullReindex: true` als naechtlichen Standard. Eine taegliche Vollreindizierung ist fuer viele RAG-Systeme ineffizient und kann bei wachsendem Datenbestand zu unnoetiger Last fuehren.

### Risiko

- Unnoetige CPU-/RAM-/Embedding-Last.
- Laengere Laufzeiten.
- Mehr Fehlerquellen.
- Qdrant/Postgres werden unnoetig belastet.
- Grosse Wissensbestaende skalieren schlechter.
- Nutzer gewoehnen sich an einen falschen Standard.

### Empfehlung

Das Template in **Index Maintenance** umbauen.

Neues Ziel:

```text
Nicht jeden Tag alles neu indizieren,
sondern taeglich neue, geaenderte, fehlerhafte und stale Inhalte behandeln.
```

Empfohlenes Template:

```text
Name: Index Maintenance
Trigger: taeglich 02:00
Steps:
  1. data_source.sync_changes
  2. data_source.retry_failed_documents
  3. data_source.reindex_stale_documents
  4. data_source.consistency_check
  5. notification.dashboard
```

Full-Reindex sollte ein separates Admin-Template bleiben:

```text
Name: Full RAG Rebuild
Trigger: manuell
Requires Approval: true
Risk Level: destructive/internal_heavy
Steps:
  1. approval.request
  2. data_source.full_reindex
  3. data_source.rebuild_vector_index
  4. notification.dashboard
```

### Sinnvolle Step-Typen

```text
data_source.sync_changes
```

Prueft externe Quellen oder Uploadbereiche auf neue/geaenderte/geloeschte Dokumente.

```text
data_source.retry_failed_documents
```

Versucht fehlgeschlagene Parsing-/Embedding-Jobs erneut.

```text
data_source.reindex_stale_documents
```

Indiziert Dokumente neu, deren Parser-, Chunking-, Embedding- oder Index-Version veraltet ist.

```text
data_source.consistency_check
```

Prueft, ob DB-Chunks und Vector-DB-Punkte konsistent sind.

```text
data_source.full_reindex
```

Bewusst schwerer Admin-/Wartungsstep fuer manuelle oder seltene Ausfuehrung.

### Akzeptanzkriterien

- Standard-Template nutzt keinen taeglichen Full-Reindex mehr.
- Full-Reindex bleibt als separates, risikogekennzeichnetes Template verfuegbar.
- UI erklaert Unterschied zwischen Maintenance und Full Rebuild.
- Full Rebuild benoetigt optional Approval.

### Prioritaet

**Mittel / P2.**  
Kein Security-Bug, aber sehr sinnvoll fuer Produktqualitaet und Skalierung.

---

## 8. Empfehlung 6: Workflow-Engine-Package-Metadaten korrigieren

### Problem

Das Package unter `apps/workflow-engine/package.json` heisst aktuell noch generisch:

```json
{
  "name": "nextjs_tailwind_shadcn_ts"
}
```

Das wirkt wie ein Scaffold-Rest.

### Risiko

- Verwirrung in Logs, Dependency-Tools und CI.
- Unklarer Projektkontext fuer Entwickler und Agenten.
- Schlechtere Wartbarkeit.

### Empfehlung

Package-Name anpassen:

```json
{
  "name": "rheinagent-workflow-engine",
  "version": "0.2.0",
  "private": true
}
```

Optional weitere Metadaten:

```json
{
  "description": "Embedded workflow engine for RheinAgent",
  "private": true
}
```

### Akzeptanzkriterien

- Package-Name beschreibt die Komponente korrekt.
- Docker-/Build-Skripte funktionieren unveraendert.
- Lockfile ist aktualisiert, falls noetig.

### Prioritaet

**Niedrig / P3.**  
Kleiner Hygiene-Fix, aber schnell erledigt.

---

## 9. Praktische Feature-Ideen fuer die naechsten Ausbaustufen

### 9.1 Workflow Permission Preview

Vor dem Publish sollte die Engine anzeigen, welche Berechtigungen und Connectoren ein Workflow benoetigt.

Beispiel:

```text
Dieser Workflow benoetigt:
- email.read
- ai.use
- connector.use
- approval.request
- notification.send
```

Zusatzinformationen:

```text
Team Vertrieb: vollstaendig erlaubt
Team Einkauf: Connector fehlt
Admin-Freigabe erforderlich wegen external_write
```

Nutzen:

- Admins verstehen vor Aktivierung die Auswirkungen.
- Fehlende Rechte werden frueh sichtbar.
- Weniger fehlgeschlagene Runs durch falsche Konfiguration.

### 9.2 Workflow Dry Run

Ein Testlauf ohne echte externe Side Effects.

Eigenschaften:

- AI/RAG optional echt oder gemockt.
- E-Mail/HTTP/destruktive Schritte werden blockiert oder simuliert.
- Node-Ausgaben werden angezeigt.
- Variablen, Bedingungen und Branching werden validiert.

UI-Button:

```text
Testlauf ohne externe Aktionen
```

Nutzen:

- Sehr hilfreich im visuellen Builder.
- Sicheres Testen vor Publish.
- Reduziert Angst vor Automatisierungen.

### 9.3 Workflow Risk Score

Jeder Workflow bekommt automatisch eine Risikostufe:

```text
read_only
internal_write
external_write
destructive
```

Moegliche Kriterien:

- nutzt externe Connectoren,
- sendet E-Mails,
- schreibt in Datenquellen,
- loescht Daten,
- nutzt HTTP-Requests,
- nutzt AI mit externem Provider,
- greift auf RAG-Daten zu.

UI-Badges:

```text
Benoetigt Approval
Nutzt externe API
Sendet E-Mail
Schreibt Daten
Greift auf RAG zu
```

Nutzen:

- Governance.
- Bessere Admin-Entscheidungen.
- Grundlage fuer automatische Approval-Regeln.

### 9.4 Workflow Run Replay

Fehlgeschlagene Runs sollten gezielt wiederholbar sein.

Varianten:

```text
Mit gleichem Input wiederholen
Ab Step X wiederholen
Nur fehlgeschlagene Steps wiederholen
Als Dry Run wiederholen
```

Nutzen:

- Sehr praktisch fuer lange Digest-, RAG- und E-Mail-Flows.
- Spart Zeit bei transienten Fehlern.
- Verbessert Betrieb und Support.

### 9.5 Connector Health Dashboard

Ein eigener Gesundheitsbereich fuer Connectoren.

Metriken:

```text
Letzter erfolgreicher Test
Letzter Fehler
Fehlerrate
Secret laeuft bald ab
Betroffene Workflows
Letzte Nutzung
Durchschnittliche Antwortzeit
```

Nutzen:

- Admins sehen sofort, warum Workflows fehlschlagen.
- Proaktive Warnungen vor ablaufenden Tokens.
- Schnellere Fehlerdiagnose.

### 9.6 Template Setup Wizard

Templates sollten nicht nur angelegt werden, sondern durch einen Setup-Assistenten fuehren.

Beispielablauf:

```text
1. Team waehlen
2. Connector waehlen
3. Zeitplan waehlen
4. Approval-Regel waehlen
5. Testlauf starten
6. Publish
```

Nutzen:

- Macht die Engine fuer Nicht-Entwickler nutzbar.
- Weniger leere oder falsch konfigurierte Drafts.
- Hoher Produktwert fuer interne Teams.

### 9.7 Aktivierungs-Vorschau

Vor Aktivierung zeigt RheinAgent eine Zusammenfassung:

```text
Naechster Lauf: morgen 08:00
Betroffene Teams: Vertrieb
Nutzt Connector: sales-mailbox
Sendet an: Dashboard + Teamlead
Approval noetig: ja
Max. 50 E-Mails pro Lauf
Geschaetzte Laufzeit: 1-3 Minuten
Risiko: external_write
```

Nutzen:

- Transparenz.
- Weniger Fehlkonfiguration.
- Besseres Vertrauen in geplante Automationen.

### 9.8 RAG Quality Review Workflow

Fuer das geplante Antwortbewertungs-/FAQ-Feature sollte ein Workflow-Template entstehen:

```text
Trigger: taeglich 17:00
Step 1: rag_quality.find_frequent_questions
Step 2: rag_quality.find_poor_answers
Step 3: rag_quality.generate_faq_suggestions
Step 4: approval.request
Step 5: notification.digest
```

Nutzen:

- Haeufige Fragen werden automatisch sichtbar.
- Admins erhalten konkrete FAQ-Vorschlaege.
- RAG-Qualitaet verbessert sich kontinuierlich.

### 9.9 Verified Answer Fast Path

Wenn eine Frage sehr aehnlich zu einer freigegebenen FAQ-/Verified-Answer ist, sollte RheinAgent zuerst diese Antwort anzeigen.

Ablauf:

```text
User fragt
  -> Query Embedding
  -> Verified Answer Match
  -> Quellen-/Scope-Pruefung
  -> Antwort anzeigen
  -> optional "trotzdem neu suchen"
```

Nutzen:

- Weniger grosse Suchlaeufe.
- Schnellere Antworten.
- Bessere Qualitaet bei wiederkehrenden Fragen.

### 9.10 Wissensluecken-Dashboard

RAG-Fragen mit schlechten oder fehlenden Antworten sollten gesammelt werden.

Kennzahlen:

```text
Haeufig gefragt, aber schlechte Antwort
Keine passenden Quellen gefunden
Antwort oft negativ bewertet
Quelle als veraltet gemeldet
Viele Suchlaeufe ohne Klick/Verwendung
```

Nutzen:

- Admins sehen, wo Dokumentation fehlt.
- Datenquellen koennen gezielt verbessert werden.
- FAQ-Aufbau wird datengetrieben.

---

## 10. Empfohlene Reihenfolge

### Sofort / P1

1. Engine-CI ergaenzen.
2. Explizite Permission-/Team-Guards in Engine-Routen einfuehren.
3. Connector-Secret-Persistenz haerten.

### Danach / P2

4. Stale Demo-Kommentare entfernen.
5. RAG-Reindex-Template in Index-Maintenance umbauen.
6. Workflow Risk Score und Permission Preview einfuehren.

### Anschliessend / P3

7. Dry Run und Run Replay bauen.
8. Connector Health Dashboard ergaenzen.
9. Template Setup Wizard umsetzen.
10. RAG-Quality-/FAQ-Modul und dazu passende Workflow-Steps implementieren.

---

## 11. Definition of Done fuer die naechste Haertungsrunde

Die naechste Haertungsrunde gilt als abgeschlossen, wenn:

- `apps/workflow-engine` in CI gebaut und gelintet wird.
- Engine-Typecheck in CI laeuft.
- Wichtige Engine-Harnesses entweder in CI laufen oder bewusst dokumentiert ausgeschlossen sind.
- Workflow-Create/Edit/Publish/Run mit Permission-Guards geschuetzt sind.
- Team-Zuordnung serverseitig geprueft wird.
- Connector-Create/Update keine bekannten Secret-Felder in `configJson` persistiert.
- Live-Routen keine falschen Demo-Kommentare mehr tragen.
- Das Standard-RAG-Template nicht mehr taeglichen Full-Reindex empfiehlt.

---

## 12. Fazit

Die Workflow Engine ist inzwischen eine realistische Grundlage fuer den nativen n8n-Ersatz in RheinAgent. Die groessten frueheren Correctness-Probleme scheinen erledigt zu sein. Die naechste Stufe sollte sich weniger auf Grundmechanik und mehr auf Produktionsreife konzentrieren:

```text
CI-Abdeckung
+ explizites RBAC/Team-Hardening
+ robustes Secret Handling
+ bessere RAG-Maintenance-Templates
+ praktische Admin-Features
```

Danach ist die Engine gut positioniert, um geplante Aktionen, E-Mail-Digests, RAG-Qualitaetsreviews und FAQ-Automatisierungen direkt im Dashboard abzubilden.
