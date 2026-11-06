import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


logger = logging.getLogger(__name__)


class ContinuousLogFormatter(logging.Formatter):
    def __init__(self, frontend=False, max_characters=32768):
        prefix = "BACKEND:" if frontend else ""
        super().__init__(f"[%(asctime)s] [%(levelname)-8s] [{prefix}%(name)s:%(funcName)s:%(lineno)d] - %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
        self.frontend = frontend
        self.max_characters = max_characters
        self.ui_formatter = logging.Formatter("[%(asctime)s] [%(levelname)-8s] [UI:%(ui_component)s] - %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    def format(self, record):
        message = self.ui_formatter.format(record) if self.frontend and hasattr(record, "ui_component") else super().format(record)
        return message if len(message) <= self.max_characters else message[:self.max_characters] + " [truncated]"


def create_continuous_log_handler(log_file, frontend=False, max_bytes=10 * 1024 * 1024, backup_count=3):
    handler = RotatingFileHandler(log_file, mode="a", maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8", delay=True)
    handler.setFormatter(ContinuousLogFormatter(frontend, max_characters=max(128, min(32768, max_bytes // 8))))
    return handler


def write_frontend_log(handler, level, component, message):
    record = logging.LogRecord("ui", getattr(logging, str(level).upper(), logging.INFO), "", 0, message, (), None)
    record.ui_component = component
    handler.handle(record)


def rotate_run_log(log_file):
    path = Path(log_file)
    try:
        if path.is_file():
            path.replace(path.with_name(f"{path.stem}.old{path.suffix}"))
    except OSError as error:
        logger.warning("Could not rotate %s; retaining the active log: %s", path.name, error)


class RunLogFileHandler(logging.FileHandler):
    def start_run(self):
        self.acquire()
        try:
            if self.stream is not None:
                self.stream.flush()
                self.stream.close()
                self.stream = None
            rotate_run_log(self.baseFilename)
        finally:
            self.release()