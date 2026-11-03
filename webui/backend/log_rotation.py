import logging
from pathlib import Path


logger = logging.getLogger(__name__)


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