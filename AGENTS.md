# Prompt Manager – Agent Guide

## Mission & Context
- Repository path: `/Volumes/Nvme固态/hy_project/open_source/prompt-manager-main`
- Goal: maintain and extend a prompt management platform while **rebuilding the Go/Gin backend in Python/FastAPI with MongoDB**. Preserve existing REST/SSE interfaces so the React frontend keeps working during the migration, then iterate with new features.
- Current stack: Go + Gin + GORM (MySQL/SQLite) for backend, React + Vite + Tailwind + Zustand for frontend. AI features call Aliyun Bailian (OpenAI-compatible) endpoints for prompt optimization and testing; responses can stream via SSE.

## Repository Overview
```
backend/   Go service (handlers, services, middleware, config, models, database init)
frontend/  Vite/React UI (pages, components, Zustand stores, API client, styling)
```

### Backend (Go)
- `main.go`: wires config/env, opens database, registers middleware, and mounts all `/api` routes plus `/health`.
- `config/config.go`: reads env vars (`DB_*`, `SERVER_PORT`, `LOG_LEVEL`).
- `database/database.go`: handles GORM initialization for MySQL or SQLite (the default) and auto-migrates tables (`Project`, `Prompt`, `Tag`, `Category`, `PromptHistory`, `Setting`).
- `models/models.go`: domain objects with UUID primary keys, timestamps, relationships, and `BeforeCreate` hooks.
- `handlers/`: REST handlers grouped by entity (`project`, `prompt`, `tag`, `category`, `export`, `settings`). They orchestrate DB ops, handle validation, and emit JSON responses or SSE streams.
- `services/`: shared utilities
  - `version_service.go`: semantic version bumps and comparisons.
  - `diff_service.go`: text diffing using `sergi/go-diff` to drive the diff viewer.
  - `aliyun_service.go`: wraps Aliyun-compatible chat APIs for optimization/testing (both request/response and streaming flows).
- `middleware/middleware.go`: CORS, panic recovery, request logging (currently only CORS + ErrorHandler are mounted).

### Frontend (React)
- `src/pages/`: feature pages (dashboard, project detail, version detail, prompt test playground, import/export, settings, tag & category management, integration tutorial).
- `src/components/`: reusable widgets (prompt cards, version diff viewer, forms, modals, streaming view, etc.).
- `src/services/api.ts`: REST client targeting `http://<host>:8080/api`. Implements every backend endpoint plus `fetch`-based SSE readers for optimization/testing streams.
- `src/types/models.ts`: Project/Prompt/Tag/Category structures mirroring backend DTOs.
- Global state uses Zustand; styling uses Tailwind CSS; Markdown rendering relies on `react-markdown` + `remark` plugins and `rehype-highlight/katex`.

### Core Domain Model
| Entity | Fields (Go) | Relationships / Notes |
| --- | --- | --- |
| `Project` | `id`, `name`, `description`, `created_at`, `updated_at` | `Prompts` (1→N), `Tags` (M↔N via `project_tags`) |
| `Prompt` | `id`, `project_id`, `name`, `version`, `content`, `description`, `category`, `created_at` | `Tags` (M↔N), `History` (1→N `PromptHistory`), belongs to `Project`. Version increments through `VersionService` on create/update/rollback. |
| `PromptHistory` | `id`, `prompt_id`, `operation`, `old_content`, `new_content`, `created_at` | Tracks create/update/rollback events. |
| `Tag` | `id`, `name`, `color`, `created_at` | Linked to projects/prompts. |
| `Category` | `id`, `name`, `color`, `created_at` | Referenced by prompts (strict validation). |
| `Setting` | `key`, `value` (+ description & timestamps) | Holds Aliyun API config, system prompt, etc. Acts like a simple key/value store. |

### API Surface (high-level)
- `/api/projects` CRUD plus prompt listings per project.
- `/api/prompts` CRUD, version diff, rollback, SDK fetch (`/projects/:id/sdk/prompt`), SSE-enabled `test-prompt`.
- `/api/tags`, `/api/categories`: CRUD endpoints.
- `/api/settings`: load/update settings plus `/optimize-prompt` SSE endpoint.
- `/api/export` & `/api/import`: JSON/CSV/YAML export/import of projects+prompts. (Known limitation: CSV export omits prompt `name`, making round-trips lossy.)
- `/health`: service ping.

### Streaming/SSE Behavior
- Both `/optimize-prompt` and `/test-prompt` optionally stream using `gin.Context.SSEvent`. Frontend SSE consumers expect `data: {"text": "...chunk..."}` lines and finish when the stream ends. Error events emit `event:error`.

## FastAPI + MongoDB Migration Plan
Objective: re-implement backend with FastAPI while keeping API parity so the current frontend continues operating. MongoDB becomes the primary persistence layer. Suggested approach:

1. **Project Structure**
   ```
   backend_fastapi/
     app/
       main.py
       config.py         # env parsing via Pydantic Settings
       db.py             # Motor/Beanie client initialization
       models/           # Mongo document models
       schemas/          # Pydantic response/request models
       routers/          # Equivalent route modules (projects, prompts, tags, categories, settings, export)
       services/         # Versioning, diff, Aliyun client, import/export helpers
       middleware.py     # CORS, logging, exception handling
       deps.py           # shared dependencies (DB, services)
   ```
   - Use **FastAPI** for routing, **Pydantic v2** for validation, **Motor** (+ optional ODM such as Beanie or ODMantic) for Mongo access.
   - Mirror existing endpoints and payloads; introduce a `/v2` namespace only when backwards-incompatible changes are necessary.

2. **Data Modeling in MongoDB**
   - Use UUID strings for `_id` fields to keep compatibility with frontend IDs (Mongo ObjectId → string mismatch would break clients).
   - Collections:
     - `projects`: references `tags` via array of IDs; embed minimal prompt metadata for quick dashboard queries (optional).
     - `prompts`: store `project_id`, `version`, `content`, `description`, `category`, timestamps, `tag_ids` array.
     - `prompt_histories`: same shape as current table.
     - `tags`, `categories`, `settings`.
   - Implement indexes on `project_id+name`, `project_id+name+version`, `tag_ids`, and timestamps for filtering.
   - Consider referencing tags/categories by ID but denormalize `name/color` snapshots inside prompts if fast tag filtering is required.

3. **Services & Utilities**
   - **Versioning**: Reuse semantics from `VersionService` (major/minor/patch). Provide a shared helper module.
   - **Diffs**: `python-diff-match-patch` mirrors Go behavior for consistent diff HTML.
   - **Aliyun Client**: replicate `services/aliyun_service.go` using `httpx` or `aiohttp`. Provide both synchronous response and SSE-compatible streaming via FastAPI's `EventSourceResponse` or `StreamingResponse`.
   - **Import/Export**: Maintain JSON/CSV/YAML functionality. Address CSV prompt-name issue during refactor.

4. **Route Parity Checklist**
   - `/api/projects` (+search) – ensure `.populate`/aggregation supplies tags and prompt counts.
   - `/api/projects/:id/prompts` – filter support: tag, version, name, category, date range.
   - `/api/prompts/*` – include diff, rollback semantics (create new document with incremented version).
   - `/api/projects/:id/sdk/prompt` – maintain name+version/tag filtering.
   - `/api/tags`, `/api/categories`, `/api/settings`.
   - `/api/export`/`/api/import`.
   - SSE endpoints consistent with frontend expectations (JSON chunk payload with `text` key).

5. **Incremental Migration Strategy**
   - **Phase 1**: Scaffold FastAPI service alongside Go backend. Provide `.env` compatibility and Docker Compose entry.
   - **Phase 2**: Reimplement read-only endpoints to validate models/schemas.
   - **Phase 3**: Add write operations, imports/exports, SSE endpoints.
   - **Phase 4**: Switch frontend `.env` (`VITE_API_URL`) to FastAPI host; run regression tests.
   - **Phase 5**: Remove Go backend once stability confirmed.

6. **Database Migration**
   - Export existing SQL data via `/api/export` (JSON) → transform → seed Mongo (write script under `scripts/migrate_sql_to_mongo.py`).
   - Preserve historical versions and relations by mapping join tables to arrays.
   - Validate that semantic versions remain consistent after import.

7. **Testing & Tooling**
   - Unit tests: Pydantic schema validation, service logic (versioning/diffs), Mongo repos (using `mongomock` or ephemeral containers).
   - Integration tests: FastAPI `TestClient` covering each endpoint including SSE (test streaming by iterating `client.stream`).
   - Lint/format: `ruff`, `mypy`, `black`.

8. **Deployment Considerations**
   - Provide Dockerfiles for FastAPI + Mongo, with `.env`-driven config matching names currently in `config/`.
   - Document SSE proxy requirements (e.g., Nginx config for streaming).
   - Expose health checks compatible with existing `/health`.

## Known Issues / Observations
- CSV export omits prompt `name`, making imports unable to reconstruct names reliably (see `backend/handlers/export_handler.go` comments).
- `settings` table accepts arbitrary keys; implement schema validation before persisting to Mongo to avoid typos.
- Middleware currently enables `Access-Control-Allow-Origin: *`; review before production hardening.
- Gin server only loads `.env`; missing file aborts startup. FastAPI version should treat `.env` as optional with sensible defaults.

## Enhancement Backlog Ideas
1. Role-based access control (auth + API tokens) before exposing service publicly.
2. Project-level sharing/export templates.
3. Prompt testing with multiple LLM providers; abstract provider client.
4. Diff viewer improvements (line numbers, word-level toggles).
5. Batch tag/category operations and analytics (usage counts, last-used timestamps).

## Workflow Tips
- Frontend expects the backend at `/api`; keep URL stable or surface via `window.ENV.API_URL`.
- SSE responses must flush frequently; in FastAPI, prefer `EventSourceResponse`.
- When adding new endpoints, update `frontend/src/services/api.ts` and related Zustand stores/components.
- Keep UTC timestamps and ISO 8601 strings for Mongo responses so frontend date handling stays unchanged.
- For future contributors: review `README.md` and screenshots (`image*.png`) for UX expectations before changing APIs.

## Next Immediate Steps
1. Confirm MongoDB deployment target (local Docker vs managed Atlas) and credentials strategy.
2. Define FastAPI scaffold and dependency versions in a new `backend_fastapi` folder.
3. Draft Pydantic models mirroring `models/models.go` to ensure migration parity.
4. Plan SQL→Mongo migration script using the JSON export format.
5. Create a compatibility test suite comparing responses from Go vs FastAPI for representative endpoints.
