import logging
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from app.core.logging_config import DailyFileHandler


class DailyFileHandlerTests(unittest.TestCase):
    def test_logs_append_to_one_file_per_record_date(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            handler = DailyFileHandler(temporary_directory)
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger = logging.getLogger("daily-file-handler-test")
            logger.propagate = False
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)

            try:
                first_day = datetime(2026, 10, 15, 10, 0).timestamp()
                next_day = datetime(2026, 10, 16, 9, 0).timestamp()
                self._emit(logger, first_day, "first message")
                self._emit(logger, first_day + 60, "same day message")
                self._emit(logger, next_day, "next day message")
            finally:
                logger.removeHandler(handler)
                handler.close()

            log_directory = Path(temporary_directory)
            first_day_log = (log_directory / "2026-10-15.log").read_text(
                encoding="utf-8"
            )
            next_day_log = (log_directory / "2026-10-16.log").read_text(
                encoding="utf-8"
            )

            self.assertEqual(
                first_day_log.splitlines(),
                ["first message", "same day message"],
            )
            self.assertEqual(next_day_log.splitlines(), ["next day message"])

    @staticmethod
    def _emit(logger: logging.Logger, timestamp: float, message: str) -> None:
        record = logger.makeRecord(
            logger.name,
            logging.INFO,
            __file__,
            1,
            message,
            (),
            None,
        )
        record.created = timestamp
        logger.handle(record)


if __name__ == "__main__":
    unittest.main()
