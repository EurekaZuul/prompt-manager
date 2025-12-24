from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.db import close_client, get_client
from app.routers import categories, export, health, projects, prompts, settings as settings_router, tags


def create_app() -> FastAPI:
    cfg = get_settings()
    print(cfg)

    app = FastAPI(title="Prompt Manager API", version="2.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_allow_origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api_router = APIRouter(prefix="/api")
    api_router.include_router(settings_router.router, tags=["settings"])
    api_router.include_router(projects.router, tags=["projects"])
    api_router.include_router(prompts.router, tags=["prompts"])
    api_router.include_router(tags.router, tags=["tags"])
    api_router.include_router(categories.router, tags=["categories"])
    api_router.include_router(export.router, tags=["export"])

    app.include_router(api_router)
    app.include_router(health.router)

    static_dir = cfg.frontend_dist_path
    if static_dir:
        static_path = Path(static_dir).resolve()
        if static_path.exists() and static_path.is_dir():
            app.mount("/", StaticFiles(directory=str(static_path), html=True), name="frontend")

    @app.on_event("startup")
    async def startup_event() -> None:  # pragma: no cover - wiring
        get_client()

    @app.on_event("shutdown")
    async def shutdown_event() -> None:  # pragma: no cover - wiring
        close_client()

    return app


app = create_app()
