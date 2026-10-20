import logging
import logging.handlers
import os
import sys

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

class Logger:
    """
    Custom logger providing categorized, color-simulated console output 
    """
    def __init__(self):
        ui_logs_dir = os.environ.get("UI_LOGS_DIR")
        if not ui_logs_dir:
            if os.path.exists("/config/UILogs"):
                ui_logs_dir = "/config/UILogs"
            else:
                backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                root_dir = os.path.dirname(os.path.dirname(backend_dir))
                ui_logs_dir = os.path.join(root_dir, "UILogs")
        default_log = os.path.join(ui_logs_dir, "AniMetaFill.log")
        self.log_file = os.environ.get('LOG_FILE', default_log)
        log_dir = os.path.dirname(self.log_file)
        
        # Ensure log directory exists
        try:
            if log_dir and not os.path.exists(log_dir):
                os.makedirs(log_dir, exist_ok=True)
            
            # Setup RotatingFileHandler
            handler = logging.handlers.RotatingFileHandler(
                self.log_file, 
                maxBytes=10*1024*1024, # 10MB safety limit
                backupCount=5,
                encoding='utf-8'
            )
            
            # Per-run rotation: Force rollover if current log has data
            if os.path.exists(self.log_file) and os.path.getsize(self.log_file) > 0:
                handler.doRollover()

            # Configure dedicated Logger for AniMetaFill (do NOT modify root logger)
            self._file_logger = logging.getLogger("AniMetaFill")
            self._file_logger.setLevel(logging.INFO)
            self._file_logger.propagate = False
            
            # Clear existing handlers on AniMetaFill logger only
            for h in self._file_logger.handlers[:]:
                self._file_logger.removeHandler(h)
                
            formatter = logging.Formatter('%(asctime)s | %(levelname)-8s | %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
            handler.setFormatter(formatter)
            self._file_logger.addHandler(handler)
            
            print(f"  Info: Logging to {self.log_file} (UTF-8)")
            
        except Exception as e:
            # Fallback to console only if file access fails
            print(f"  Warning: Logger fallback to console only ({e})")

    def _log_to_file(self, level: str, msg: str):
        try:
            line = f"{level: <8} | {msg}"
            if hasattr(self, '_file_logger') and self._file_logger:
                self._file_logger.info(line)
        except Exception:
            pass

    def info(self, msg: str):
        print(f"  Info: {msg}")
        self._log_to_file("INFO", msg)

    def success(self, msg: str):
        print(f"  Success: {msg}")
        self._log_to_file("SUCCESS", msg)

    def warning(self, msg: str):
        print(f"  Warning: {msg}")
        self._log_to_file("WARNING", msg)

    def error(self, msg: str):
        print(f"  Error: {msg}")
        self._log_to_file("ERROR", msg)

    def system(self, msg: str):
        print(f"\n[SYSTEM] {msg}")
        self._log_to_file("SYSTEM", msg)

    def db(self, msg: str):
        print(f"  Database: {msg}")
        self._log_to_file("DATABASE", msg)

    def process(self, msg: str):
        print(f"  Sync: {msg}")
        self._log_to_file("SYNC", msg)

    def search(self, provider: str, msg: str):
        """Logs the start of a provider-specific search."""
        full_msg = f"[{provider}] Looking for: {msg}"
        print(f"  Search: {full_msg}")
        self._log_to_file("SEARCH", full_msg)

    def match(self, provider: str, msg: str):
        """Logs a successful match on a specific provider."""
        full_msg = f"[{provider}] Identified: {msg}"
        print(f"  Match: {full_msg}")
        self._log_to_file("MATCH", full_msg)

    def divider(self):
        print("-" * 50)

# Single instance
logger = Logger()
