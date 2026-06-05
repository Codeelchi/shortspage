# Plan: Workflow-Engine-Hardening und RAG-Quality-Integration

> Stand: 2026-06-05  
> Kontext: Die Workflow-Engine ist unter `apps/workflow-engine/` in RheinAgent eingebettet und unter `/workflows` erreichbar. Dieser Plan beschreibt die noch notwendigen Integrations- und Hardening-Schritte, damit die Engine sauber als nativer n8n-Ersatz im Dashboard betrieben werden kann und später RAG-Quality-/FAQ-Workflows orchestriert.

## 1. Zielbild

RheinAgent soll Workflows künftig nativ ausführen können, ohne dass n8n zwingend erforderlich ist. n8n bleibt zunächst als External-/Legacy-Provider erhalten, während neue Automationen bevorzugt über die native Workflow-Engine laufen.

Ziel-Topologie:

```text
Browser
  -> Caddy :8080
    -> /api/*       -> FastAPI Backend
    -> /workflows/* -> FastAPI Proxy -> Workflow Engine
    -> sonst        -> RheinAgent Frontend

Workflow Engine
  -> eigene UI/Builder unter /workflows
  -> eigenes PostgreSQL-Schema workflow
  -> Backend-Adapter fuer Auth, Permission, Team, Audit, Secret, Notification, AI, RAG, ExternalWorkflow
  -> spaeter Celery-Offload fuer robuste Ausfuehrung
```

Wichtige Grundsaetze:

- FastAPI bleibt Quelle der Wahrheit fuer Auth, RBAC, Teams, Audit, Secrets, AI und RAG.
- Die Engine darf keine parallele Auth- oder Secret-Welt aufbauen.
- Jede Workflow-Entitaet bleibt org-scoped und optional team-scoped.
- n8n bleibt bis zur Migration parallel lauffaehig.
- RAG-Quality und FAQ-Logik gehoeren primaer ins Backend; die Engine orchestriert spaeter Review-/Digest-/Maintenance-Flows.

## 2. Aktueller Stand

Bereits vorhanden:

- `apps/workflow-engine/` als eigener Next/Bun-Service.
- Eigenes Prisma-Schema mit `WorkflowDefinition`, `WorkflowVersion`, `WorkflowRun`, `WorkflowStepRun`, `ScheduledAction`, `ConnectorAccount`, `Approval`, `DigestDefinition`, `DigestRun`, `DigestItem`, `Credential`, `AuditEvent`.
- PostgreSQL-Isolation ueber Schema `workflow`.
- Caddy-Routing fuer `/workflows` und `/workflows/*` zum Backend.
- FastAPI-Proxy `app/api/workflows_proxy.py` mit signierten `X-*`-Identity-Headern.
- Engine-seitiger `RuntimeContext` mit HMAC-Signaturpruefung.
- Backend-Adapter-Endpoints fuer Workflow Engine in `app/api/workflow_engine.py`.
- Secret-Adapter ueber RheinAgent `secret_store`.
- n8n-ExternalWorkflow-Adapter.
- Modul-Toggle `workflows` und `faq` in `module_config.py`.

Noch nicht ausreichend fuer produktiven Cutover:

- Engine-Adapter geben Identity noch nicht konsistent an Backend-Calls weiter.
- RAG-Adapter nutzt aktuell Workaround ueber `options.userId`.
- Workflow-Ausfuehrung laeuft teilweise noch im Next-Prozess statt ueber robuste Queue.
- RheinAgent-Frontend-Seite `/workflows` ist noch n8n-Thin-Client.
- Engine-API-Routen muessen konsequenter RBAC-/Team-gehaertet werden.
- Secrets/Credentials muessen eindeutig ueber Backend Secret Adapter gefuehrt werden.
- RAG-Quality-/FAQ-Modul ist noch nicht implementiert.

## 3. Nicht-Ziele dieses Plans

Dieser Plan ersetzt nicht den bestehenden Plan `docs/plans/workflow-engine-integration.md`, sondern baut darauf auf.

Nicht in diesem Plan enthalten:

- Vollstaendige n8n-Migration aller Bestandsworkflows.
- Komplettes visuelles Redesign der Engine.
- Vollstaendige RAG-Quality-Implementierung in einem Schritt.
- Entfernen von n8n aus Compose.
- Freie Script-Ausfuehrung in Workflows.

## 4. Slice WE-H1 — Engine Identity Propagation

### Ziel

Alle Engine-zu-Backend-Adapter muessen den aktuellen Runtime-Kontext an das FastAPI-Backend weiterreichen. Dadurch werden echte scoped Permissions, `auth/verify` und sauberes RAG-Org-/Team-Scoping moeglich.

### Problem

Der Browserzugriff auf `/workflows` ist bereits ueber signierte Header abgesichert. Innerhalb der Engine gehen nachgelagerte Adapter-Calls zum Backend aber noch nicht konsistent mit derselben Identity heraus. Dadurch entstehen Workarounds wie `options.userId` im RAG-Adapter.

### Aufgaben

- Gemeinsame HTTP-Basis der Engine-Adapter identifizieren.
- `RuntimeContext` in Adapter-Calls verfuegbar machen.
- Bei jedem Backend-Adapter-Call mitschicken:
  - `X-Organization-Id`
  - `X-Team-Id`, falls vorhanden
  - `X-User-Id`
  - `X-User-Roles`
  - `X-User-Permissions`
  - `X-Request-Id`
  - `X-Correlation-Id`
  - `X-Context-Signature`
- `createContextHeaders(ctx, signingKey)` zentral verwenden.
- Backend-seitig `auth/verify` aktivieren oder ergaenzen.
- RAG-Backend-Endpunkte so umbauen, dass sie den echten User-Kontext aus Headern nutzen.
- `options.userId` nur noch als Legacy-Fallback oder gar nicht mehr verwenden.
- Tests fuer fehlende, falsche und korrekte Signatur ergaenzen.

### Akzeptanzkriterien

- Adapter-Calls funktionieren mit signierter Identity.
- Backend kann User, Org, Team und Permissions aus dem Request-Kontext ableiten.
- RAG-Query funktioniert ohne `options.userId` im Standardfall.
- Cross-Org- und Cross-Team-Zugriffe werden geblockt.
- Fehlende oder falsche Signatur wird in Production abgelehnt.

### Prioritaet

P0 — blockiert echte team- und rollenbasierte Workflows.

## 5. Slice WE-H2 — Proxy Module Guard

### Ziel

Die eingebettete Engine muss den RheinAgent-Modulschalter `workflows` respektieren.

### Aufgaben

- `workflows_proxy.py` um `require_module("workflows")` ergaenzen.
- Sicherstellen, dass deaktivierte Workflows nicht nur die Sidebar ausblenden, sondern auch `/workflows` blockieren.
- Tests:
  - Modul aktiv -> Proxy funktioniert.
  - Modul deaktiviert -> 404 oder definierter deaktiviert-Status.

### Akzeptanzkriterien

- `/workflows` ist nur erreichbar, wenn Modul `workflows` aktiv ist.
- Bestehende Auth bleibt unveraendert.
- Assets unter `/workflows/_next/*` sind ebenfalls geschuetzt.

### Prioritaet

P1.

## 6. Slice WE-H3 — Celery-Offload fuer Workflow-Ausfuehrung

### Ziel

Workflow-Runs sollen nicht dauerhaft fire-and-forget im Next-Prozess laufen, sondern robust ueber RheinAgent/Celery verarbeitet werden.

### Zielarchitektur

```text
Engine startet Run
  -> POST /api/v1/engine/tasks
  -> FastAPI legt Celery Task in Queue workflow
  -> Worker verarbeitet Task
  -> Task ruft Engine-Callback oder Engine-Execution-Endpunkt auf
  -> Engine fuehrt TS-Step-Logik aus
  -> Status/Cancel/Retry ueber Backend sichtbar
```

Empfehlung: Celery soll Queue-, Retry-, Status- und Cancel-Schicht sein. Die eigentliche Step-Logik bleibt in der TypeScript-Engine, damit keine doppelte Implementierung in Python entsteht.

### Aufgaben Backend

- Endpunkte ergaenzen:
  - `POST /api/v1/engine/tasks`
  - `GET /api/v1/engine/tasks/{task_id}/status`
  - `POST /api/v1/engine/tasks/{task_id}/cancel`
  - `POST /api/v1/engine/tasks/{task_id}/retry`
- Celery Task `workflow.execute_run` erstellen.
- Task-Metadaten speichern oder ueber Result Backend abrufbar machen.
- Queue `workflow` in Worker-Konfiguration aufnehmen.
- Worker-Command in Compose ergaenzen: `ai_chat,indexing,workflow`.
- Env fuer Backend und Worker konsistent durchreichen.

### Aufgaben Engine

- `EXECUTION_ADAPTER=celery` unter Production nutzen.
- `ENGINE_BACKEND_URL=http://backend:8000` setzen.
- `CELERY_QUEUE_NAME=workflow` setzen.
- `ENGINE_SERVICE_URL=http://workflow-engine:3000` setzen.
- Bestehende `executeRun`-Route nur noch fuer kontrollierte interne Callback-/Worker-Ausfuehrung nutzen.
- Idempotency fuer doppelte Starts pruefen.

### Akzeptanzkriterien

- Ein manueller Workflow-Run wird als Task in Queue `workflow` eingereiht.
- Worker verarbeitet den Run.
- Status ist abrufbar.
- Cancel und Retry funktionieren.
- Engine-Restart verliert keinen queued Run.
- Fehler werden in `WorkflowRun` und `WorkflowStepRun` sichtbar.

### Prioritaet

P0/P1 — notwendig vor produktivem Einsatz langer Workflows.

## 7. Slice WE-H4 — Dashboard-Umstellung auf eingebettete Engine

### Ziel

Die RheinAgent-Seite `/workflows` soll nicht mehr der alte n8n-Thin-Client sein, sondern auf die eingebettete Workflow-Engine zeigen.

### Aufgaben

- `apps/frontend/app/(app)/workflows/page.tsx` ersetzen oder zur Shell-Seite umbauen.
- Shell-Seite soll:
  - Modulstatus `workflows` respektieren.
  - Engine unter `/workflows` oeffnen oder einbetten.
  - n8n nur noch als Legacy-/External-Provider behandeln.
  - Alte n8n-Sync-Funktion aus Hauptansicht entfernen oder in Legacy-Bereich verschieben.
- Navigation/Sidebar auf native Workflows ausrichten.
- Engine-Theme an RheinAgent angleichen.
- z.ai-Branding und generischen Package-Namen bereinigen.

### Akzeptanzkriterien

- Klick auf Workflows fuehrt zur nativen Engine-UI.
- Bestehende Session wird ueber Proxy genutzt.
- Ohne Session bleibt `/workflows` 401.
- n8n-Status/Synchronisieren ist nicht mehr Hauptfokus.
- UI wirkt wie Teil von RheinAgent.

### Prioritaet

P1.

## 8. Slice WE-H5 — Engine API RBAC und Team Hardening

### Ziel

Alle Engine-API-Routen muessen RheinAgent-konforme Berechtigungs- und Teampruefungen durchfuehren.

### Aufgaben

- Mutierende Engine-Routen pruefen:
  - Workflow erstellen
  - Workflow bearbeiten
  - Workflow publishen
  - Workflow aktivieren/pausieren
  - Workflow ausfuehren
  - Schedule erstellen/bearbeiten
  - Connector erstellen/bearbeiten/testen
  - Digest erstellen/bearbeiten
  - Approval approve/reject
- Vor jeder Aktion Permission-Adapter aufrufen.
- `teamId` aus Request Body nicht blind vertrauen.
- Team-Mitgliedschaft oder Team-Manage-Recht pruefen.
- Sichtbarkeit `private`, `team`, `organization` pruefen.
- Cross-Team-Lesezugriffe blockieren.
- Step-Ausfuehrung muss Scope aus Run-Kontext beziehen, nicht aus Step-Input.

### Empfohlene Permissions

```text
workflow.view
workflow.create
workflow.manage
workflow.run
workflow.approve
connector.use
schedule.manage
digest.manage
```

Optional spaeter granularer:

```text
workflow.view.team
workflow.manage.team
workflow.run.team
workflow.runs.view
workflow.admin
connector.manage
connector.manage_secrets
approval.manage
```

### Akzeptanzkriterien

- User ohne `workflow.create` kann keinen Workflow erstellen.
- User ohne Team-Recht kann keinen Workflow fuer fremdes Team erstellen.
- User ohne `workflow.run` kann keinen Run starten.
- Connectoren koennen nur mit `connector.use` und passendem Scope verwendet werden.
- Tests decken Cross-Team- und Cross-Org-Faelle ab.

### Prioritaet

P0/P1.

## 9. Slice WE-H6 — Secret- und Credential-Konsolidierung

### Ziel

Secrets duerfen nicht parallel in der Engine-DB gespeichert werden. RheinAgent Backend Secret Store bleibt Quelle der Wahrheit fuer geheime Werte.

### Aufgaben

- Verwendung des Engine-Modells `Credential` pruefen.
- Production-Regel einfuehren:
  - `configJson` darf nicht-geheime Metadaten enthalten.
  - `secretRef` verweist auf Backend Secret Store.
  - `credentialsJson` darf in Production keine echten Secret-Werte enthalten.
- Connector-UI so anpassen, dass Secret-Werte ueber Secret-Adapter gespeichert werden.
- Bestehende Demo-/Standalone-Credentials klar als Development-only markieren.
- Audit fuer Secret Store/Rotate/Delete sicherstellen.

### Akzeptanzkriterien

- Neue Connector-Secrets landen nur im Backend Secret Store.
- Secret-Werte werden nicht in Engine-Prisma-Tabellen abgelegt.
- UI zeigt Secrets nur maskiert.
- Rotation funktioniert ueber Backend-Adapter.

### Prioritaet

P1.

## 10. Slice WE-H7 — Scheduler-Produktionshaertung

### Ziel

Scheduled Actions sollen zuverlaessig und idempotent laufen.

### Aufgaben

- Due-Schedule-Dispatcher pruefen oder bauen.
- `nextRunAt`, `lastRunAt`, `enabled`, `misfirePolicy`, `maxConcurrentRuns` korrekt behandeln.
- `runAsUserId` oder `servicePrincipalId` erzwingen.
- Run-As-Permissions vor Ausfuehrung pruefen.
- Doppelte Starts verhindern, idealerweise per DB-Lock/atomarem Update.
- Pausierte/archivierte Workflows ueberspringen.
- Scheduler-Fehler sichtbar machen.

### Akzeptanzkriterien

- Cron-Workflow laeuft zur erwarteten Zeit.
- Pausierter Workflow wird nicht ausgefuehrt.
- `maxConcurrentRuns=1` verhindert parallele Laeufe.
- Fehlender Run-As-Kontext blockiert Ausfuehrung.
- Fehler erscheinen in Run-Historie und Audit.

### Prioritaet

P1/P2.

## 11. Slice RQ-I1 — RAG-Quality Backend-Modul vorbereiten

### Ziel

Antwortbewertung, haeufige Fragen, FAQ-Vorschlaege und gepruefte Antworten werden im FastAPI-Backend als Quelle der Wahrheit aufgebaut. Die Workflow-Engine orchestriert diese Funktionen nur.

### Neue Backend-Domain

```text
rag_quality/
  feedback
  query_records
  answer_records
  question_clusters
  faq_suggestions
  verified_answers
  ranking_signals
  stale_detection
```

### Neue Tabellen, grob

```text
rag_query_record
rag_answer_record
rag_answer_source
rag_answer_feedback
rag_question_cluster
rag_query_cluster_link
rag_faq_suggestion
rag_verified_answer
rag_ranking_signal
```

### Erste API-Schnittstellen

```text
POST /api/rag/answers/{answer_id}/feedback
GET  /api/rag-quality/overview
GET  /api/rag-quality/question-clusters
GET  /api/rag-quality/faq-suggestions
PATCH /api/rag-quality/faq-suggestions/{id}
POST /api/rag-quality/faq-suggestions/{id}/approve
GET  /api/rag-quality/verified-answers
POST /api/rag-quality/verified-answers
```

### Akzeptanzkriterien

- RAG-Antworten koennen bewertet werden.
- Frage, Antwort und Quellen werden nachvollziehbar gespeichert.
- Feedback ist org-/team-scoped.
- Kein Prompt/keine volle Antwort im Audit.

### Prioritaet

P1 nach WE-H1, weil sauberes User-/Team-Scoping noetig ist.

## 12. Slice RQ-I2 — FAQ-Vorschlaege und Admin-Dashboard

### Ziel

Administratoren und Teamleads erhalten im Dashboard Vorschlaege fuer haeufige oder gut bewertete Fragen.

### Dashboard-Bereich

```text
Wissensqualitaet
  Uebersicht
  Haeufige Fragen
  FAQ-Vorschlaege
  Gepruefte Antworten
  Schlecht bewertete Antworten
  Quellenqualitaet
  Veraltete Antworten
```

### Workflow

```text
Mitarbeiter fragt
  -> RAG antwortet
  -> Mitarbeiter bewertet
  -> Frage wird geclustert
  -> System erstellt FAQ-Vorschlag
  -> Admin bearbeitet Frage, Antwort und Quellen
  -> Admin veroeffentlicht gepruefte Antwort
  -> naechste aehnliche Frage nutzt gepruefte Antwort bevorzugt
```

### Akzeptanzkriterien

- FAQ-Vorschlaege zeigen Haeufigkeit, Feedbackquote, Team und Quellen.
- Admin kann Frage und Antwort bearbeiten.
- Admin kann Quellen entfernen/ergaenzen.
- Admin kann als team- oder org-sichtbare FAQ veroeffentlichen.

### Prioritaet

P2.

## 13. Slice RQ-I3 — Workflow-Steps fuer RAG Quality

### Ziel

Die Workflow-Engine kann RAG-Quality-Prozesse automatisieren.

### Neue Step-Typen

```text
rag_quality.find_frequent_questions
rag_quality.generate_faq_suggestions
rag_quality.mark_stale_answers
rag_quality.notify_reviewers
rag_quality.publish_verified_answer
rag_quality.create_quality_digest
```

### Beispiel-Workflow: FAQ Review Digest

```text
Trigger: schedule, taeglich 17:00
Step 1: rag_quality.find_frequent_questions
Step 2: rag_quality.generate_faq_suggestions
Step 3: notification.digest
Step 4: approval.request fuer Teamlead/Admin
```

### Beispiel-Workflow: Stale FAQ bei Dokumentaenderung

```text
Trigger: document.updated
Step 1: rag_quality.mark_stale_answers
Step 2: notification.dashboard
```

### Akzeptanzkriterien

- Engine ruft RAG-Quality-Backend nur ueber Adapter mit Identity auf.
- Team-/Org-Scope wird eingehalten.
- Workflows koennen FAQ-Vorschlaege automatisch erzeugen.
- Admins erhalten Digest/Review-Aufgaben.

### Prioritaet

P2/P3 nach RQ-I1/RQ-I2.

## 14. Reihenfolge der Umsetzung

Empfohlene Reihenfolge:

```text
1. WE-H1 Identity Propagation
2. WE-H2 Proxy Module Guard
3. WE-H5 Engine API RBAC/Team Hardening
4. WE-H3 Celery-Offload
5. WE-H4 Dashboard-Umstellung
6. WE-H6 Secret-/Credential-Konsolidierung
7. WE-H7 Scheduler-Produktionshaertung
8. RQ-I1 RAG-Quality Backend-Modul
9. RQ-I2 FAQ-Vorschlaege Dashboard
10. RQ-I3 RAG-Quality Workflow-Steps
```

Begruendung:

- Identity/RBAC muss zuerst sauber sein, sonst werden RAG-Quality und FAQ spaeter unsicher.
- Celery-Offload sollte vor langen Digest-/AI-/RAG-Workflows kommen.
- Dashboard-Umstellung ist wichtig fuer UX, aber weniger kritisch als Security.
- RAG-Quality baut auf sauberem User-/Team-Kontext auf.

## 15. Verifikation

Backend:

```bash
cd apps/backend
uv run ruff check .
uv run pytest -q --basetemp=.pytest-tmp
```

Frontend:

```bash
cd apps/frontend
npm install
npx tsc --noEmit
npm test
npm run build
```

Workflow Engine:

```bash
cd apps/workflow-engine
bun install
bun run build
bun run lint
```

Stack-Smoke-Test:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d --build backend frontend caddy postgres redis worker beat workflow-engine
```

Manuelle Pruefung:

- Login als Admin.
- `/workflows` oeffnen.
- Ohne Session `/workflows` pruefen -> 401.
- Workflows-Modul deaktivieren -> `/workflows` gesperrt.
- Workflow erstellen -> RBAC pruefen.
- Workflow starten -> Run-Historie pruefen.
- RAG-Step ausfuehren -> Scope und Quellenrechte pruefen.
- Secret-Connector erstellen -> kein Secret in Engine-DB.

## 16. Risiken

| Risiko | Auswirkung | Gegenmassnahme |
|---|---|---|
| Identity wird nicht an Adapter weitergegeben | Cross-Team-/RAG-Scoping unsicher oder Workarounds | WE-H1 als P0 |
| Step-Logik doppelt in Python und TS | Divergenz, Wartungskosten | Celery nur Queue, TS bleibt Ausfuehrer |
| Engine speichert Secrets selbst | Security-Risiko | Secret Adapter erzwingen |
| Dashboard zeigt alte n8n-UI | Nutzer verstehen nativen Builder nicht | WE-H4 |
| Feedback/FAQ ohne Scope | Datenleak zwischen Teams | RAG-Quality erst nach Identity/RBAC |
| Ranking-Feedback zementiert falsche Antworten | Schlechte Antworten werden bevorzugt | verified/stale/review-Status, begrenzte Boosts |

## 17. Definition of Done fuer Cutover-Bereitschaft

Die Workflow Engine gilt als bereit fuer produktiven Parallelbetrieb, wenn:

- `/workflows` ueber RheinAgent-Session und signierten Proxy laeuft.
- Modul-Gating aktiv ist.
- Engine-Adapter echte Identity an Backend weitergeben.
- Backend-Adapter scoped Permissions pruefen koennen.
- Workflow-CRUD und Run-Start team-/rollenbasiert gehaertet sind.
- Runs nicht mehr nur fire-and-forget im Next-Prozess laufen.
- Secrets nur ueber RheinAgent Secret Store gespeichert werden.
- Dashboard auf native Engine zeigt.
- n8n als External/Legacy Provider weiter lauffaehig bleibt.
- Tests fuer Cross-Team, Cross-Org, fehlende Permissions und fehlende Signaturen existieren.

## 18. Definition of Done fuer RAG-Quality-Integration

RAG-Quality gilt als sinnvoll integriert, wenn:

- Nutzer RAG-Antworten bewerten koennen.
- Frage, Antwort und Quellen scoped gespeichert werden.
- Haeufige Fragen erkannt und geclustert werden.
- FAQ-Vorschlaege im Dashboard erscheinen.
- Admin/Teamlead Frage, Antwort und Quellen bearbeiten kann.
- Gepruefte Antworten bei aehnlichen Fragen bevorzugt genutzt werden.
- Veraenderte Quellen betroffene Antworten als stale markieren.
- Workflow Engine Review-/Digest-Flows fuer FAQ-Vorschlaege ausloesen kann.

## 19. Kurzfazit

Die Engine ist bereits gut genug eingebettet, um als Grundlage fuer den nativen n8n-Ersatz zu dienen. Vor produktiver Nutzung muessen aber Identity, RBAC/Team-Hardening, Celery-Offload, Dashboard-Umstellung und Secret-Konsolidierung abgeschlossen werden.

RAG-Quality und FAQ sollten nicht direkt in der Engine als Quelle der Wahrheit entstehen, sondern im FastAPI-Backend. Die Workflow Engine wird danach zur Automationsschicht fuer Review, Digest, Stale Detection und FAQ-Publishing.
