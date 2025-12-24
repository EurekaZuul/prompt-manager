# Repository Guidelines

## Project Structure & Module Organization
- `backend_fastapi/src/app` hosts the FastAPI application. `main.py` assembles middleware/routers, `config.py` reads `.env`, `models/` plus `schemas/` describe MongoDB documents and response payloads, `routers/` mirrors the `/api` surface, and `services/` centralize reusable logic (versioning, Aliyun integrations, diff helpers). Utilities shared across routers live under `core/`, `dependencies.py`, and `utils.py`. Place backend tests in `backend_fastapi/tests` following the same module layout.
- The Vite/React client sits in `frontend/`. Shared UI primitives are under `src/components/`, feature experiences under `src/pages/`, API calls and Zustand stores under `src/services/`, Tailwind styles under `src/index.css`, and global hooks/helpers in `src/hooks` and `src/lib`. Static screenshots remain at the repo root (`image*.png`).

## Build, Test, and Development Commands
Backend (Python 3.10+):
```
cd backend_fastapi
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src
pytest  # backend tests
```
Frontend (Node 18+):
```
cd frontend
npm install
npm run dev        # start Vite with FastAPI proxy
npm run lint       # ESLint + React hooks rules
npm run check      # TypeScript project references
npm run build      # production bundle
```

## Coding Style & Naming Conventions
- Backend: follow PEP8 with 4-space indents. Keep routers thin, push heavier logic to `services/`, and lean on FastAPI dependency injection (`Depends`) for DB clients and settings. Use `snake_case` for functions/variables, `PascalCase` for Pydantic models, and add concise comments for tricky flows.
- Frontend: TypeScript with JSX. Use `PascalCase` for components, `camelCase` for hooks/actions/store setters, and Tailwind utilities for styling. Centralize streaming helpers so SSE payloads always follow `{ text: string }`.

## Testing Guidelines
- Backend tests use `pytest`/`pytest-asyncio`. Name files `test_<feature>.py`, cover both REST responses and SSE streams via `client.stream`. Mock external LLM providers so version routing stays deterministic.
- Frontend regressions are gated on `npm run check` (types) and `npm run lint`. Add React Testing Library coverage under `frontend/src/__tests__` when components pick up conditional logic or asynchronous flows.

## Commit & Pull Request Guidelines
- Keep commit subjects imperative and under ~70 chars, optionally prefixed with scope tags (`feat:`, `fix:`, etc.). Reference user-facing changes, schema/API adjustments, and attach screenshots/GIFs for UI tweaks.
- PR descriptions must outline what changed, any new env variables/migrations, and how you verified the update (commands or manual steps). Request reviews from both frontend and backend owners when contracts overlap.

## Security & Configuration Tips
- Secrets belong in `.env` files (`backend_fastapi/.env`, `frontend/.env`). Never commit provider credentials.
- Aliyun and other LLM providers each require explicit settings; follow the naming style from `app.config.Settings` (e.g., `ALIYUN_API_KEY`) and document defaults in the READMEs.
- MongoDB defaults to `mongodb://localhost:27017/prompt_manager`; adjust `MONGO_URI`/`MONGO_DB` when targeting hosted clusters, and update Docker Compose overrides if new ports need exposing.
