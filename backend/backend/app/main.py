import logging

from fastapi import FastAPI
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.cors import CORSMiddleware

from app.api.v1 import auth, novedades, operador, tareas
from app.core import database
from app.core.config import get_settings
from app.core.logging_config import configure_logging
from app.middleware.auth_middleware import JWTAuthMiddleware

configure_logging()

logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
)

app.add_middleware(JWTAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
    expose_headers=[
        "Accept-Ranges",
        "Content-Disposition",
        "Content-Length",
        "Content-Type",
    ],
)
app.include_router(auth.router, prefix=f"{settings.api_v1_prefix}/auth", tags=["auth"])
app.include_router(
    operador.router,
    prefix=f"{settings.api_v1_prefix}/operador",
    tags=["operador"],
)
app.include_router(
    novedades.router,
    prefix=f"{settings.api_v1_prefix}/novedades",
    tags=["novedades"],
)
app.include_router(
    tareas.router,
    prefix=f"{settings.api_v1_prefix}/tareas",
    tags=["tareas"],
)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/database", tags=["health"])
def database_health_check() -> dict[str, str]:
    if database.engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL no está configurada.",
        )

    try:
        with database.engine.connect() as connection:
            connection.execute(text("SELECT 1")).scalar_one()
    except SQLAlchemyError as exc:
        logger.error(
            "Database health check failed (%s).",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo conectar a la base de datos configurada.",
        ) from None

    return {"status": "ok", "database": "connected"}
