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
