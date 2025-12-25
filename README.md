# Prompt Manager

[中文文档](./README_zh.md) | **English**

Prompt Manager is a full‑stack prompt operations platform. It helps developers and prompt engineers version, diff, test, and optimize LLM prompts with a friendly UI plus an async FastAPI backend. Projects group prompts, every edit becomes a new version with rollback, and streaming SSE integrations allow rapid iterations with providers such as Aliyun Bailian.

![alt text](image.png)
![alt text](image-1.png)
![alt text](image-2.png)
![alt text](image-3.png)

## Features

- **Project workspace** – organize related prompts under one project with descriptions and metadata.
- **Automatic versioning** – each save creates a new prompt version, complete with timestamps and semantic diffing.
- **Diff & history** – compare versions visually, inspect change statistics, and rollback when needed.
- **Prompt testing playground** – send ad‑hoc user inputs, reorder turns, and consume streamed responses.
- **AI optimization** – run provider-backed prompt optimization with streaming previews and secondary editing.
- **Tag & category management** – classify prompts for fast filtering; includes dedicated admin pages.
- **Import / export** – backup or migrate your prompts via JSON/YAML.
- **Integration helpers** – copy-ready snippets and tutorials make embedding prompts in downstream systems simple.

## Tech Stack

### Backend

- **Runtime**: Python 3.10+
- **Framework**: FastAPI with Uvicorn
- **Database**: MongoDB via the async Motor driver
- **Utilities**: Pydantic v2 for schemas, SSE-Starlette for streaming, diff-match-patch for version diffs

### Frontend

- **Framework**: React + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Routing & Icons**: React Router, Lucide React

## Repository Layout

```
prompt-manager/
├── AGENTS.md                # Contributor guidelines for Codex/agents
├── README.md / README_zh.md # Documentation (English / Chinese)
├── backend_fastapi/
│   ├── pyproject.toml       # FastAPI backend dependencies
│   └── src/app/             # FastAPI application (config, routers, services, models)
├── frontend/                # Vite + React client
│   ├── public/              # Static assets
│   └── src/                 # Components, pages, services, Zustand stores
└── image*.png               # Screenshots used in the docs
```

## Prerequisites

- Python **3.10+**
- MongoDB **6.x+** (local or remote instance)
- Node.js **18+** and npm

## Backend Setup (`backend_fastapi`)

```bash
cd backend_fastapi
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

Create a `.env` file (values below mirror the defaults):

```env
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
MONGO_URI=mongodb://localhost:27017
MONGO_DB=prompt_manager
ALIYUN_API_KEY=
ALIYUN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=qwen-turbo
ALIYUN_SYSTEM_PROMPT=
CORS_ALLOW_ORIGINS=*
# FRONTEND_DIST_PATH=/opt/frontend-dist  # optional override; defaults to ../frontend/dist
```

Run the API locally:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src
```

Execute backend tests:

```bash
pytest
```

## Frontend Setup (`frontend`)

```bash
cd frontend
npm install
npm run dev    # start Vite dev server with proxy to FastAPI
npm run lint   # ESLint + React hooks rules
npm run check  # TypeScript project references
npm run build  # production bundle
```

The development server listens on `http://localhost:5173` by default and proxies API calls to `http://localhost:8080`.

Set `VITE_BACKEND_URL` in `frontend/.env.local` (or export it when launching Vite) if your local FastAPI backend runs on a different origin. Example:

```bash
echo "VITE_BACKEND_URL=http://localhost:9090" > frontend/.env.local
npm run dev
```

> For production or local “all-in-one” testing, run `npm run build` once. The FastAPI app will automatically serve the generated `frontend/dist` directory thanks to the default `FRONTEND_DIST_PATH`, so visiting the backend origin (e.g., `http://localhost:8080`) will render the SPA while `/api/...` continues returning JSON.

## Production Deployment

1. **Build the frontend bundle**
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   By default the build artifacts live in `frontend/dist`. Copy this directory onto the production server (for example `/opt/prompt-manager/frontend-dist`).

2. **Let FastAPI host the bundle (default)**
- The backend automatically looks for `frontend/dist` relative to the repo. Once that directory exists, it is mounted at `/`, while `/api` keeps handling JSON/SSE.
- If you store the built assets elsewhere, override `FRONTEND_DIST_PATH` with the absolute path.
- The static mount ships with an SPA fallback, so refreshing `/project/<id>` or other client routes always serves `index.html`.
- Prefer a CDN or standalone static host? Leave `FRONTEND_DIST_PATH` empty and point your reverse proxy to the external bundle while proxying `/api` to FastAPI.

3. **Configure CORS**
   - `CORS_ALLOW_ORIGINS` accepts a comma-separated list. Example: `CORS_ALLOW_ORIGINS=https://prompt.example.com,https://ops.example.com`.
   - When the frontend is co-hosted (Option A), the default `*` is safe to replace with the site origin for stricter policies.

4. **Run FastAPI behind a process manager**
   ```bash
   cd backend_fastapi
   source .venv/bin/activate
   uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src --workers 4
   ```
   Wrap this command with `systemd`, Supervisor, or Docker. Place Nginx or another reverse proxy in front to terminate TLS and forward traffic to `http://127.0.0.1:8080`.

5. **MongoDB & environment**
   - Point `MONGO_URI` at your managed cluster and ensure the production host can reach it securely.
   - Store `.env` files outside of version control and rotate provider keys regularly.
   
Port or domain changes only require updating the backend `.env` (`SERVER_PORT`, reverse proxy host, etc.). The SPA reads `window.location.origin`, so any user visiting the deployed FastAPI host automatically talks to the correct `/api`. Only when hosting the frontend on a different domain do you need to override `window.ENV.API_URL` (edit `frontend/public/config.js` before building or serve your own `config.js`).

## API Overview

The FastAPI service exposes REST + SSE endpoints under `/api`:

- `GET /api/projects` / `POST /api/projects` – list or create projects.
- `GET /api/projects/{project_id}/prompts` – fetch prompt versions in a project (filtered by name/category).
- `POST /api/projects/{project_id}/prompts` – create a prompt or bump a new version.
- `GET /api/prompts/{prompt_id}` – fetch a version; `PUT` updates content/metadata (and versions when needed).
- `GET /api/prompts/{prompt_id}/diff/{target_prompt_id}` – HTML diff payload.
- `POST /api/prompts/{prompt_id}:optimize` – SSE stream for optimization suggestions.
- `POST /api/prompts/{prompt_id}:test` – SSE playground for conversation testing.
- `GET/POST /api/settings` – read or update provider configuration.
- `GET /api/tags`, `GET /api/categories`, `GET /api/export` – supporting resources for organization and backups.

Refer to the FastAPI docs at `http://localhost:8080/docs` when the server is running for the complete contract.

## Development Tips

- Keep `.env` files in `backend_fastapi/` and `frontend/` (never commit keys).
- SSE payloads follow `{ text: string }`; reuse helper utilities when adding new streams.
- When integrating additional providers, add configuration keys to `backend_fastapi/.env` and surface them through the settings router so the UI stays in sync.
