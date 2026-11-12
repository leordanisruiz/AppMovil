import logging
import os
from datetime import datetime
from pathlib import Path
from typing import TextIO


class _ConsoleHandler(logging.StreamHandler):
    pass


class DailyFileHandler(logging.Handler):
    def __init__(self, log_directory: str | Path) -> None:
        super().__init__()
        self.log_directory = Path(log_directory).resolve()
        self.log_directory.mkdir(parents=True, exist_ok=True)
        self._current_date: str | None = None
        self._stream: TextIO | None = None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            record_date = datetime.fromtimestamp(record.created).strftime(
                "%Y-%m-%d"
            )
            if record_date != self._current_date:
                self._open_daily_file(record_date)

            if self._stream is None:
                raise OSError("Daily log file is not open.")

            self._stream.write(f"{self.format(record)}\n")
            self._stream.flush()
        except Exception:
            self.handleError(record)

    def _open_daily_file(self, record_date: str) -> None:
        if self._stream is not None:
            self._stream.close()

        log_file = self.log_directory / f"{record_date}.log"
        self._stream = log_file.open(
            mode="a",
            encoding="utf-8",
            errors="backslashreplace",
        )
        self._current_date = record_date

    def close(self) -> None:
        self.acquire()
        try:
            if self._stream is not None:
                self._stream.close()
                self._stream = None
                self._current_date = None
            super().close()
        finally:
            self.release()


def configure_logging() -> None:
    log_directory = Path(os.getenv("LOG_DIR", "logs"))
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    file_handler = next(
        (
            handler
            for handler in root_logger.handlers
            if isinstance(handler, DailyFileHandler)
            and handler.log_directory == log_directory.resolve()
        ),
        None,
    )
    if file_handler is None:
        file_handler = DailyFileHandler(log_directory)
        file_handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        root_logger.addHandler(file_handler)

    for logger_name in ("uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(logger_name)
        if file_handler not in uvicorn_logger.handlers:
            uvicorn_logger.addHandler(file_handler)

    if not any(
        isinstance(handler, _ConsoleHandler) for handler in root_logger.handlers
    ):
        console_handler = _ConsoleHandler()
        console_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        root_logger.addHandler(console_handler)
