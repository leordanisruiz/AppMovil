import asyncio
import logging

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.logging_config import configure_logging
from app.services.push_notification_worker import (
    create_push_notification_worker,
)


async def main() -> None:
    configure_logging()
    settings = get_settings()
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is required for the push worker.")
    if not settings.expo_push_token_encryption_key:
        raise RuntimeError(
            "EXPO_PUSH_TOKEN_ENCRYPTION_KEY is required for the push worker."
        )

    logging.getLogger(__name__).info(
        "Expo notification worker started; polling every %s seconds.",
        settings.expo_poll_interval_seconds,
    )
    await create_push_notification_worker().run()


if __name__ == "__main__":
    asyncio.run(main())
