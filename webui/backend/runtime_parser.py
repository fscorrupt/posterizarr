"""
Utility module for parsing runtime statistics from log files and JSON files
"""

import re
import json
from pathlib import Path
from typing import Dict, Optional
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def parse_runtime_from_log(log_path: Path, mode: str = "normal") -> Optional[Dict]:
    """
    Parse runtime statistics from a log file

    Args:
        log_path: Path to the log file
        mode: The run mode (normal, testing, manual, backup, etc.)

    Returns:
        Dictionary with parsed runtime data or None if parsing failed
    """
    try:
        if not log_path.exists():
            logger.warning(f"Log file not found: {log_path}")
            return None

        # Read last 150 lines to find the runtime info
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            last_lines = lines[-150:] if len(lines) > 150 else lines

        runtime_seconds = None
        runtime_formatted = None
        total_images = 0
        posters = 0
        seasons = 0
        backgrounds = 0
        titlecards = 0
        errors = 0
        fallback_images = 0

        # Parse from bottom to top to get latest run
        for line in reversed(last_lines):
            # Look for: "Script execution time: 0h 1m 23s"
            if "Script execution time:" in line and runtime_formatted is None:
                match = re.search(r"(\d+)h\s*(\d+)m\s*(\d+)s", line)
                if match:
                    hours = int(match.group(1))
                    minutes = int(match.group(2))
                    seconds = int(match.group(3))
                    runtime_seconds = hours * 3600 + minutes * 60 + seconds
                    runtime_formatted = f"{hours}h {minutes}m {seconds}s"

            # Look for: "Finished, Total images downloaded: 42" OR "Finished, Total images created: 42"
            if (
                "Total images downloaded:" in line or "Total images created:" in line
            ) and total_images == 0:
                match = re.search(r"Total images (?:downloaded|created):\s*(\d+)", line)
                if match:
                    total_images = int(match.group(1))

            # Look for: "Show/Movie Posters created: 127| Season images created: 0 | Background images created: 127 | TitleCards created: 0"
            # OR: "Show/Movie Posters downloaded: 10| Season images downloaded: 5 | Background images downloaded: 3 | TitleCards downloaded: 2"
            if (
                "Show/Movie Posters created:" in line
                or "Show/Movie Posters downloaded:" in line
            ) and posters == 0:
                # Posters
                poster_match = re.search(
                    r"Show/Movie Posters (?:created|downloaded):\s*(\d+)", line
                )
                if poster_match:
                    posters = int(poster_match.group(1))

                # Seasons
                season_match = re.search(
                    r"Season images (?:created|downloaded):\s*(\d+)", line
                )
                if season_match:
                    seasons = int(season_match.group(1))

                # Backgrounds
                bg_match = re.search(
                    r"Background images (?:created|downloaded):\s*(\d+)", line
                )
                if bg_match:
                    backgrounds = int(bg_match.group(1))

                # TitleCards
                tc_match = re.search(
                    r"TitleCards (?:created|downloaded):\s*(\d+)", line
                )
                if tc_match:
                    titlecards = int(tc_match.group(1))

            # Look for: "During execution '5' Errors occurred"
            if "Errors occurred" in line and errors == 0:
                match = re.search(r"execution\s+'(\d+)'\s+Errors", line)
                if match:
                    errors = int(match.group(1))

            # Look for: "'8' times the script took a fallback image"
            if (
                "times the script took a fallback image" in line
                and fallback_images == 0
            ):
                match = re.search(
                    r"'(\d+)'\s+times the script took a fallback image", line
                )
                if match:
                    fallback_images = int(match.group(1))

            # Stop searching once we found everything from the same run
            if runtime_formatted and (
                total_images > 0 or (posters + seasons + backgrounds + titlecards) > 0
            ):
                break

        # If runtime was not found, we don't have complete data
        if runtime_formatted is None:
            logger.warning(f"Could not find runtime data in {log_path}")
            return None

        # If total_images was not found but we have individual counts, calculate it
        if total_images == 0 and (posters + seasons + backgrounds + titlecards) > 0:
            total_images = posters + seasons + backgrounds + titlecards

        # Note: Log files don't contain start_time/end_time timestamps
        # Setting these to empty strings means duplicate detection will rely on
        # the time-based strategy (recent entry within 5 seconds)
        return {
            "mode": mode,
            "runtime_seconds": runtime_seconds,
            "runtime_formatted": runtime_formatted,
            "total_images": total_images,
            "posters": posters,
            "seasons": seasons,
            "backgrounds": backgrounds,
            "titlecards": titlecards,
            "errors": errors,
            "fallbacks": fallback_images,
            "log_file": log_path.name,
            "start_time": "",  # Not available in log files
            "end_time": "",  # Not available in log files
        }

    except Exception as e:
        logger.error(f"Error parsing runtime from log: {e}")
        return None


def save_runtime_to_db(log_path: Path, mode: str = "normal"):
    """
    Parse runtime from JSON file (preferred) or log file and save to database
    This function is now ATOMIC thanks to changes in runtime_database.py

    Args:
        log_path: Path to the log file (used to determine JSON file location)
        mode: The run mode
    """
    try:
        from runtime_database import runtime_db

        runtime_data = None

        # Map mode to JSON filename
        mode_json_map = {
            "normal": "normal.json",
            "testing": "testing.json",
            "manual": "manual.json",
            "backup": "backup.json",
            "syncjelly": "syncjelly.json",
            "syncemby": "syncemby.json",
            "scheduled": "scheduled.json",
            "tautulli": "tautulli.json",
            "arr": "arr.json",
            "replace": "replace.json",
        }

        # Try to find and parse JSON file first (preferred)
        json_filename = mode_json_map.get(mode)
        if json_filename:
            json_path = log_path.parent / json_filename
            if json_path.exists():
                runtime_data = parse_runtime_from_json(json_path, mode)
                if runtime_data:
                    logger.info(f"Parsed runtime data from {json_filename}")

        # Fallback to log file if JSON not found or failed
        if not runtime_data:
            logger.info(
                f"JSON file not found, falling back to log file: {log_path.name}"
            )
            runtime_data = parse_runtime_from_log(log_path, mode)

        if runtime_data:
            # The database now handles the atomic duplicate check internally.
            logger.debug(f"Attempting to import: mode={mode}, start={runtime_data.get('start_time')}, end={runtime_data.get('end_time')}")
            runtime_db.add_runtime_entry(**runtime_data)

        else:
            logger.warning(f"No runtime data to save for {mode} mode")

    except Exception as e:
        logger.error(f"Error saving runtime to database: {e}")


def parse_runtime_from_json(json_path: Path, mode: str = None) -> Optional[Dict]:
    """
    Parse runtime statistics from a JSON file
    ... (omitted docstring for brevity) ...
    """
    try:
        if not json_path.exists():
            logger.warning(f"JSON file not found: {json_path}")
            return None

        # Infer mode from filename if not provided
        if mode is None:
            filename = json_path.stem.lower()  # Get filename without extension
            mode = filename  # Use filename as mode (e.g., "normal", "manual", "test")

        # Read JSON file
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Parse runtime
        runtime_raw = data.get("Runtime", "00:00:00")
        runtime_seconds = _parse_runtime_to_seconds(runtime_raw)
        # Reformat to new format (Xh:Ym:Zs)
        hours = runtime_seconds // 3600
        minutes = (runtime_seconds % 3600) // 60
        seconds = runtime_seconds % 60
        runtime_formatted = f"{hours}h {minutes}m {seconds}s"

        # Parse image counts - handle None values from JSON
        posters = max(0, int(data.get("Posters") or 0))
        backgrounds = max(0, int(data.get("Backgrounds") or 0))
        titlecards = max(0, int(data.get("Titlecards") or 0))
        seasons = max(0, int(data.get("Seasons") or 0))
        collections = max(0, int(data.get("Collections") or 0))
        total_images = posters + backgrounds + titlecards + seasons + collections

        # Parse fallback count - support both old and new formats
        fallback_count = 0
        fallbacks_data = data.get("Fallbacks", 0)
        if isinstance(fallbacks_data, int):
            fallback_count = fallbacks_data
        elif isinstance(fallbacks_data, list):
            for item in fallbacks_data:
                if isinstance(item, dict):
                    fallback_value = str(item.get("Fallback", "false")).lower()
                    if fallback_value == "true":
                        fallback_count += 1

        # Parse textless count - support both formats
        textless_count = 0
        textless_data = data.get("Textless", 0)
        if isinstance(textless_data, int):
            textless_count = textless_data
        elif isinstance(textless_data, list):
            for item in textless_data:
                if isinstance(item, dict):
                    textless_value = str(item.get("Textless", "false")).lower()
                    if textless_value == "true":
                        textless_count += 1

        # Parse truncated and text counts (direct numbers in new format, handle list format if any)
        truncated_count = 0
        truncated_data = data.get("Truncated", 0)
        if isinstance(truncated_data, int):
            truncated_count = truncated_data
        elif isinstance(truncated_data, list):
            for item in truncated_data:
                if isinstance(item, dict):
                    truncated_value = str(item.get("Truncated", "false")).lower()
                    if truncated_value == "true":
                        truncated_count += 1
        elif isinstance(truncated_data, dict):
            # If it's a single dict instead of a list
            truncated_value = str(truncated_data.get("Truncated", "false")).lower()
            if truncated_value == "true":
                truncated_count = 1

        text_count = 0
        text_data = data.get("Text", 0)
        if isinstance(text_data, int):
            text_count = text_data
        elif isinstance(text_data, list):
            for item in text_data:
                if isinstance(item, dict):
                    text_value = str(item.get("Text", "false")).lower()
                    if text_value == "true":
                        text_count += 1
        elif isinstance(text_data, dict):
            # If it's a single dict instead of a list
            text_value = str(text_data.get("Text", "false")).lower()
            if text_value == "true":
                text_count = 1

        # --- START DATE FORMAT FIX ---
        start_time_raw = data.get("Start time", "")
        end_time_raw = data.get("End Time", "")

        def reformat_date(date_str):
            if not date_str:
                return ""
            try:
                # Parse the "DD.MM.YYYY HH:MM:SS" format
                dt = datetime.strptime(date_str, '%d.%m.%Y %H:%M:%S')
                # Convert to "YYYY-MM-DDTHH:MM:SS" (ISO format)
                return dt.isoformat()
            except (ValueError, TypeError):
                # If it's already in a good format (like ISO) or is "N/A", return as-is
                if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", date_str):
                    return date_str
                logger.warning(f"Could not parse date '{date_str}', returning as-is.")
                return date_str

        start_time_formatted = reformat_date(start_time_raw)
        end_time_formatted = reformat_date(end_time_raw)
        # --- END DATE FORMAT FIX ---

        # Build the result dictionary
        result = {
            "mode": mode,
            "runtime_seconds": runtime_seconds,
            "runtime_formatted": runtime_formatted,
            "total_images": total_images,
            "posters": posters,
            "seasons": seasons,
            "backgrounds": backgrounds,
            "titlecards": titlecards,
            "collections": collections,
            "errors": data.get("Errors") or 0,
            "fallbacks": fallback_count,
            "textless": textless_count,
            "truncated": truncated_count,
            "text": text_count,
            "tba_skipped": data.get("TBA Skipped") or 0,
            "jap_chines_skipped": data.get("Jap/Chines Skipped") or 0,
            "notification_sent": str(data.get("Notification Sent", "false")).lower()
            == "true",
            "uptime_kuma": str(data.get("Uptime Kuma", "false")).lower() == "true",
            "images_cleared": data.get("Images cleared") or 0,
            "folders_cleared": data.get("Folders Cleared") or 0,
            "space_saved": data.get("Space saved", ""),
            "script_version": data.get("Script Version", ""),
            "im_version": data.get("IM Version", ""),
            "start_time": start_time_formatted, # Use formatted version
            "end_time": end_time_formatted,   # Use formatted version
            "log_file": json_path.name,
        }

        logger.info(
            f"Successfully parsed {json_path.name}: {runtime_formatted}, {total_images} images"
        )
        return result

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {json_path}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error parsing runtime from JSON: {e}")
        return None

def _parse_runtime_to_seconds(runtime_str: str) -> int:
    """
    Convert runtime string to seconds

    Supports formats:
    - "00:27:43" (HH:MM:SS)
    - "0h:27m:43s" (new format with colons)
    - "0h 27m 43s" (legacy format with spaces)
    - "27m 43s"

    Args:
        runtime_str: Runtime string

    Returns:
        Total seconds
    """
    try:
        # Format: "00:27:43"
        if ":" in runtime_str:
            parts = runtime_str.split(":")
            if len(parts) == 3:
                hours, minutes, seconds = map(int, parts)
                return hours * 3600 + minutes * 60 + seconds
            elif len(parts) == 2:
                minutes, seconds = map(int, parts)
                return minutes * 60 + seconds

        # Format: "0h 27m 43s"
        hours = 0
        minutes = 0
        seconds = 0

        hour_match = re.search(r"(\d+)h", runtime_str)
        if hour_match:
            hours = int(hour_match.group(1))

        min_match = re.search(r"(\d+)m", runtime_str)
        if min_match:
            minutes = int(min_match.group(1))

        sec_match = re.search(r"(\d+)s", runtime_str)
        if sec_match:
            seconds = int(sec_match.group(1))

        return hours * 3600 + minutes * 60 + seconds

    except Exception as e:
        logger.warning(f"Could not parse runtime '{runtime_str}': {e}")
        return 0


def import_json_to_db(logs_dir: Path = None):
    """
    Import runtime data from all JSON files in Logs directory to database
    This function is now ATOMIC thanks to changes in runtime_database.py

    This function looks for:
    - normal.json
    - manual.json
    - testing.json
    - tautulli.json
    - arr.json
    - syncjelly.json
    - syncemby.json
    - backup.json
    - scheduled.json

    Args:
        logs_dir: Path to Logs directory (auto-detected if not provided)
    """
    try:
        from runtime_database import runtime_db
        import os

        # Auto-detect logs directory if not provided
        if logs_dir is None:
            IS_DOCKER = os.getenv("POSTERIZARR_NON_ROOT") == "TRUE"
            if IS_DOCKER:
                BASE_DIR = Path("/config")
            else:
                BASE_DIR = Path(__file__).parent.parent.parent
            logs_dir = BASE_DIR / "Logs"

        if not logs_dir.exists():
            logger.warning(f"Logs directory not found: {logs_dir}")
            return

        # Define JSON files to check
        json_files = [
            ("normal.json", "normal"),
            ("manual.json", "manual"),
            ("testing.json", "testing"),
            ("tautulli.json", "tautulli"),
            ("arr.json", "arr"),
            ("syncjelly.json", "syncjelly"),
            ("syncemby.json", "syncemby"),
            ("backup.json", "backup"),
            ("scheduled.json", "scheduled"),
        ]

        imported_count = 0

        for json_file, mode in json_files:
            json_path = logs_dir / json_file

            if json_path.exists():
                runtime_data = parse_runtime_from_json(json_path, mode)

                if runtime_data:
                    # The database now handles the atomic duplicate check.
                    runtime_db.add_runtime_entry(**runtime_data)
                    imported_count += 1
                    logger.info(f"Imported {json_file} to database")


        logger.info(f"JSON import complete: {imported_count} files imported")

    except Exception as e:
        logger.error(f"Error importing JSON files to database: {e}")