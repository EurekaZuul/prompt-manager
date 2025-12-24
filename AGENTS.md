# Repository Guidelines

## Project Structure & Module Organization
`backend_fastapi/src/app` houses the FastAPI service: `main.py` wires config, `config.py` handles env parsing, `models/` and `schemas/` define MongoDB documents plus response shapes, `routers/` mirrors the `/api` surface, and `services/` contains reusable logic (versioning, Aliyun integrations, diff helpers). Place backend tests under `backend_fastapi/tests` with the same package layout. The Vite/React client lives in `frontend/`, with shared UI primitives inside `src/components/`, feature pages in `src/pages/`, Zustand stores and API calls in `src/services/`. Static assets and screenshots sit at repo root (`image*.png`) for documentation.

## Build, Test, and Development Commands
Backend: create a virtualenv, install dependencies, then run Uvicorn from the project root:
```
cd backend_fastapi
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src
pytest  # run backend tests
```
Frontend: install Node 18+, then use npm scripts:
```
cd frontend
npm install
npm run dev        # start Vite + FastAPI proxy
npm run lint       # ESLint + React hooks rules
npm run check      # TypeScript project references
npm run build      # production bundle
```

## Coding Style & Naming Conventions
Follow PEP8 with 4‑space indents for backend code, keep FastAPI routers small, and reuse dependency injection helpers. Use `snake_case` for functions/variables, `PascalCase` for Pydantic models, and document tricky flows with short comments. The frontend uses TypeScript with JSX; prefer `PascalCase` for React components, `camelCase` for hooks/actions, and colocate styles via Tailwind utility classes. Keep SSE payload formats consistent (`{ text: string }`) to avoid breaking existing consumers.

## Testing Guidelines
Write async FastAPI tests with `pytest`/`pytest-asyncio`, naming files `test_<feature>.py` and covering both REST and SSE stream behaviors via `client.stream`. Mock external LLM providers with fixtures so multi-model routing stays deterministic. Frontend regressions are caught through `npm run check` (type safety) and `npm run lint`; add integration tests with React Testing Library under `frontend/src/__tests__` when UI logic becomes complex. Gate pull requests on these commands running cleanly.

## Commit & Pull Request Guidelines
History shows concise, descriptive summaries (e.g., `项目迁移到python后端`). Keep subject lines under ~70 characters, written in the imperative, and include scope tags when useful (`feat: add multi-provider models`). PRs should explain the user-facing change, note schema or API adjustments, attach screenshots/GIFs for UI updates, link related issues, and describe how functionality was verified (commands or manual steps). Request reviews for both frontend and backend owners when touching shared contracts.

## Security & Configuration Tips
Store provider credentials in `.env` files (`backend_fastapi/.env`, `frontend/.env`) and never commit them. Aliyun plus additional LLM providers require separate config entries—use descriptive keys (`PROVIDER_<NAME>_API_KEY`) and document defaults inside `README_zh.md`. For local MongoDB, keep the `MONGODB_URI` pointed at a secured instance and update Docker Compose overrides when exposing new ports.
