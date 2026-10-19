import yaml
import os
import sys
import re
import shutil
import glob
from typing import Dict, List

class KometaYamlGenerator:
    """
    Generates Kometa-compliant YAML files containing surgical episode-level overlays.
    Uses 'filepath.regex' to target episodes without bloating Plex metadata.
    """
    def get_existing_overlays(self, filename: str = "anime_overlays.yml") -> List[dict]:
        """
        Parses the existing YAML file back into a list of raw show info.
        Returns: List of {"title": str, "category": str, "episodes": List[str]}
        """
        file_path = os.path.join(self.output_dir, filename)
        if not os.path.exists(file_path):
            return []

        results = []
        try:
            with open(file_path, 'r') as f:
                data = yaml.safe_load(f)
                if not data or 'overlays' not in data:
                    return []

                # Inverse label mapping to find category from text
                inv_labels = {v.lower(): k for k, v in self.labels.items()}

                for overlay_name, details in data['overlays'].items():
                    filters = details.get('filters', {})
                    show_title = filters.get('show_title')
                    regex = filters.get('filepath.regex')
                    label = details.get('template', {}).get('label', '').lower()

                    if show_title and regex:
                        # Extract SxxExx from (?i)(S01E01|S01E02)
                        # We look for anything matching S\d+E\d+
                        episodes = re.findall(r'S\d+E\d+', regex, re.IGNORECASE)
                        category = inv_labels.get(label, 'filler') # default to filler if unknown

                        results.append({
                            "title": show_title,
                            "category": category,
                            "episodes": [ep.upper() for ep in episodes]
                        })
        except Exception as e:
            print(f"  Warning: Could not parse existing YAML: {e}")

        return results

    def __init__(self, output_dir: str, kometa_config: dict = None):
        self.output_dir = output_dir
        self.config = kometa_config or {}

        # Load sub-configs with defaults
        self.labels = self.config.get('labels', {
            "canon": "Canon", "filler": "Filler", "mixed": "Mixed"
        })
        self.colors = self.config.get('colors', {
            "canon": "#27C24CB3", "filler": "#FF0000B3", "mixed": "#FFA500B3"
        })
        self.aesthetic = self.config.get('aesthetic', {
            "horizontal_align": "left",
            "vertical_align": "top",
            "horizontal_offset": 0,
            "vertical_offset": 15,
            "back_color": "#000000BF",
            "back_width": 300,
            "back_height": 100,
            "font_size": 70
        })
        self.font_path = self.config.get('font_path', 'config/fonts/Colus-Regular.ttf')
        self.overlays: Dict[str, dict] = {}

        try:
            os.makedirs(self.output_dir, exist_ok=True)
        except PermissionError:
            print(f"\n  Error: No permission to create or write to the Kometa output directory: '{self.output_dir}'")
            print("  Fix: Ensure your /data folder is writable by the container user.")
            sys.exit(1)

    def _get_templates(self) -> dict:
        """Defines the highly-configurable Premium Aesthetic templates."""
        return {
            "AnimeBar": {
                "overlay": {
                    "name": "text(<<label>>)",
                    "horizontal_align": self.aesthetic.get("horizontal_align", "left"),
                    "vertical_align": self.aesthetic.get("vertical_align", "top"),
                    "horizontal_offset": self.aesthetic.get("horizontal_offset", 0),
                    "vertical_offset": self.aesthetic.get("vertical_offset", 15),
                    "back_color": self.aesthetic.get("back_color", "#000000BF"),
                    "font_color": "<<color>>",
                    "back_width": self.aesthetic.get("back_width", 300),
                    "back_height": self.aesthetic.get("back_height", 100),
                    "font": self.font_path,
                    "font_size": self.aesthetic.get("font_size", 70)
                }
            }
        }

    def migrate_legacy_files(self, master_filename: str = "anime_overlays.yml"):
        """Scans the output directory and merges legacy overlay files."""
        backup_dir = os.path.join(self.output_dir, ".backup")
        legacy_files = glob.glob(os.path.join(self.output_dir, "*_overlays.yml"))
        for file_path in legacy_files:
            filename = os.path.basename(file_path)
            if filename == master_filename: continue
            try:
                with open(file_path, 'r') as f:
                    data = yaml.safe_load(f)
                    if data and 'overlays' in data:
                        self.overlays.update(data['overlays'])
                os.makedirs(backup_dir, exist_ok=True)
                shutil.move(file_path, os.path.join(backup_dir, filename))
            except Exception: pass

    def _normalize_title(self, title: str) -> str:
        """Strips punctuation/spaces for title-based matching."""
        if not title: return ""
        return re.sub(r'[^a-z0-9]', '', title.lower())

    def add_show_overlays(self, anime_title: str, episode_mapping: Dict[str, List[tuple]], sonarr_map: Dict[int, str], title_map: Dict[str, str] = None):
        """
        Creates localized regex-based overlay blocks using a 2-tier matching strategy:
        1. Numerical check via sonarr_map (Absolute Number)
        2. Surgical Text check via title_map (Normalized Title) - handles Specials/Shifts
        """
        title_map = title_map or {}
        for category, episodes_data in episode_mapping.items():
            if not episodes_data: continue

            # Use configured labels and colors
            label_text = self.labels.get(category, category.title())
            hex_color = self.colors.get(category, "#262626B3")

            episode_list = []
            for abs_num, ep_title in episodes_data:
                # Priority 1: Absolute Number Match
                s_e = sonarr_map.get(abs_num)
                
                # Priority 2: Title Fallback Match (Crucial for Specials and Season Shifts)
                if not s_e and ep_title:
                    norm_title = self._normalize_title(ep_title)
                    s_e = title_map.get(norm_title)

                if s_e:
                    episode_list.append(s_e)

            if episode_list:
                overlay_block_title = f"{anime_title} - {label_text}"
                regex_pattern = f"(?i)({'|'.join(episode_list)})"

                self.overlays[overlay_block_title] = {
                    "template": {
                        "name": "AnimeBar",
                        "label": label_text,
                        "color": hex_color
                    },
                    "builder_level": "episode",
                    "plex_search": {
                        "title.is": anime_title
                    },
                    "filters": {
                        "show_title": anime_title,
                        "filepath.regex": regex_pattern
                    }
                }

    def save_unified_file(self, filename: str = "anime_overlays.yml"):
        """
        Saves the finalized unified overlay file atomically using a temporary file
        and os.replace. This prevents Kometa from reading a partially-written
        file during active runs.
        """
        if not self.overlays: return None
        file_path = os.path.join(self.output_dir, filename)
        tmp_path = f"{file_path}.tmp"
        try:
            with open(tmp_path, 'w') as f:
                yaml.dump({"templates": self._get_templates(), "overlays": self.overlays}, f, default_flow_style=False, sort_keys=False)
            os.replace(tmp_path, file_path)
            return file_path
        except Exception:
            if os.path.exists(tmp_path): os.remove(tmp_path)
            return None
