import json
import os
import sys
import hashlib
from datetime import datetime

def get_md5(file_path):
    """Calculates MD5 checksum in uppercase."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest().upper()

def update_manifest():
    plugins_config = [
        {
            "id": "Posterizarr.Plugin",
            "manifest_name": "Posterizarr",
            "guid": "f62d8560-6123-4567-89ab-cdef12345678"
        }
    ]

    # These variables are passed from the GitHub Action workflow
    event_name = os.getenv("GITHUB_EVENT_NAME")
    repo = os.getenv("GITHUB_REPOSITORY")
    version_str = os.getenv("VERSION")

    # Determine filename based on build type
    if event_name == "release":
        manifest_path = "manifest.json"
    else:
        manifest_path = "manifest-dev.json"

    print(f"Targeting manifest file: {manifest_path}")

    if not os.path.exists(manifest_path):
        print(f"Error: Manifest not found at {manifest_path}")
        sys.exit(1)

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    for config in plugins_config:
        plugin_id = config["id"]
        manifest_name = config["manifest_name"]

        zip_name = f"{plugin_id}_v{version_str}.zip"
        zip_path = os.path.join("release_package", zip_name)

        if not os.path.exists(zip_path):
            print(f"Skipping {plugin_id}: ZIP not found at {zip_path}")
            continue

        print(f"Updating {plugin_id} in manifest...")
        checksum = get_md5(zip_path)

        # Find the plugin in the manifest by name or guid
        plugin = next((p for p in manifest if p.get("name") == manifest_name or p.get("guid") == config["guid"]), None)

        if not plugin:
            print(f"Warning: Plugin {manifest_name} not found in manifest. Skipping.")
            continue

        # Separate Logic for Prod vs Dev
        if event_name == "release":
            # PRODUCTION
            source_url = f"https://github.com/{repo}/releases/download/{version_str}/{zip_name}"
            changelog = f"Official Release {version_str}"

            # Safety: Ensure NO dev versions exist in the production manifest
            plugin["versions"] = [v for v in plugin["versions"] if not v["version"].startswith("99.0.")]
        else:
            # DEV / NIGHTLY
            source_url = f"https://raw.githubusercontent.com/{repo}/builds/{zip_name}"
            changelog = f"Dev build: {datetime.now().strftime('%Y-%m-%d %H:%M')}"

            # This line removes any existing version that starts with "99.0." to prevent duplicates/bloat
            if version_str.startswith("99.0."):
                plugin["versions"] = [v for v in plugin["versions"] if not v["version"].startswith("99.0.")]

        new_version = {
            "version": version_str,
            "changelog": changelog,
            "targetAbi": "10.11.0.0",
            "sourceUrl": source_url,
            "checksum": checksum
        }

        # Insert the newest version at the beginning of the list
        plugin["versions"].insert(0, new_version)

    # Save the updated manifest back to disk
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Successfully updated {manifest_path} with version {version_str}")

if __name__ == "__main__":
    update_manifest()