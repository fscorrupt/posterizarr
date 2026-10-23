# Scheduled Plex Image Cleanup

Repeated custom poster/titlecard uploads can leave old, unselected images in Plex's metadata directory. Changing the selected poster does not necessarily remove those files.

Posterizarr provides a separate **Plex Image Cleanup** scheduler task inspired by [ImageMaid](https://github.com/Kometa-Team/ImageMaid), by **meisnate12 and the Kometa Team**. ImageMaid in turn credits **bullmoose20's Plex Bloat Fix**. Selected-artwork protection in this integration adapts ImageMaid's MIT-licensed helpers. This is a limited image-cleanup integration, not the complete ImageMaid application.

## Scheduled Only

- No cleanup schedule is created or enabled by default.
- Cleanup does not run on startup, after an upload, after overlay sync, or when previewing artwork.
- Add a **Plex Image Cleanup** task in Scheduler and explicitly enable the scheduler. Its Run Now control is disabled, and the manual-run API rejects this mode.
- Schedule it in a separate maintenance window after Posterizarr, Kometa, TitleCardMaker, and other artwork writers. In-app overlay work and queued requests exclude cleanup; overlay requests arriving during cleanup wait until it finishes. Existing scheduled tasks remain serialized by the scheduler. A loaded active Plex Sync worker also causes cleanup to skip.
- API snapshot mode refuses to proceed while Plex reports active playback sessions. External tools and users changing artwork are not locked by Posterizarr; keep them idle throughout cleanup. Cleanup is not a transaction with the live Plex server.

## Configuration

The **Plex Data Directory** is the Plex application-data directory containing `Metadata`, `Cache`, and `Plug-in Support`. It is not Posterizarr's clean-asset folder or the media-library directory.

For Docker, explicitly mount that directory into Posterizarr with `:rw` and configure `/plex` in the cleanup schedule. Leave the scheduler's **Read Only (Report)** switch enabled initially. It is on by default and prevents image changes even when the mount is writable. No mount is added automatically.

### Docker Compose Examples

Merge the relevant fragment into your existing `posterizarr` service, retaining its current environment entries and volumes. These are additions, not complete replacement Compose files.

Linux host:

```yaml
services:
    posterizarr:
        environment:
            - "RUN_TIME=disabled"
        volumes:
            - "/path/to/Plex Media Server:/plex:rw"
```

Windows host with Plex container data:

```yaml
services:
    posterizarr:
        environment:
            - "RUN_TIME=disabled"
        volumes:
            - 'C:\Docker\Plex\Library\Application Support\Plex Media Server:/plex:rw'
```

Replace the host path with the actual Plex data directory. API Export also requires `Preferences.xml` in that directory. A native Windows Plex installation without this file must use the stopped-Plex Local Database mode instead.

Keep **Read Only (Report)** enabled in the scheduler for the initial run. After reviewing the report, switch it off and choose Quarantine or Remove. With the `:rw` mount shown above, this does not require recreating the container. Ensure the container user has the required permissions; a writable mount alone does not grant filesystem permissions.

An optional Docker `:ro` mount provides an additional operating-system-level write block. The scheduler switch cannot change Docker mount permissions: if you deliberately use `:ro`, writable cleanup still requires changing the mount to `:rw` and recreating the container.

`RUN_TIME=disabled` disables the container's separate script timer so it does not compete with the UI scheduler. Neither the volume mount nor this setting creates or enables a cleanup schedule.

### Scheduling With Plex Running

**Posterizarr does not start or stop Plex.** Use **Plex API Export** for an unattended cleanup schedule while Plex stays running. Local Database mode requires you to stop Plex separately beforehand and is intended for offline maintenance.

1. Configure the Plex URL/token in Posterizarr and mount the data directory as shown above.
2. In Scheduler, select **Plex Image Cleanup**, set **Plex Data Directory** to `/plex`, and select **Plex API Export**.
3. Keep **Read Only (Report)** enabled and the default seven-day minimum age for the first scheduled run.
4. Choose a maintenance window with no playback or other artwork-writing jobs, add the schedule, and explicitly enable the UI scheduler.
5. Review the cleanup log before disabling Read Only and selecting Quarantine or confirmed permanent removal.

Choose the snapshot source:

- **Plex API Export:** Uses the existing configured Plex URL/token to download a fresh database export. The `machineIdentifier` returned by Plex's `/identity` endpoint must match either `MachineIdentifier` or `ProcessedMachineIdentifier` in the mounted `Preferences.xml`; Plex installations can expose the processed identifier instead of the raw value. This prevents cleaning one server's files using another server's selections. Redirects are not followed; oversized or ambiguous exports are rejected. Only the database member is read from ZIP exports, without extracting archive paths.
- **Local Database:** Reads `Plug-in Support/Databases/com.plexapp.plugins.library.db` into a temporary SQLite backup. Plex must be stopped; the task refuses this mode if WAL/SHM files exist before or after the snapshot. There is no ignore-running override. On platforms without `Preferences.xml`, use this stopped-Plex mode.

The snapshot is queried read-only and removed when the task finishes. Posterizarr never edits the Plex database. Database exports are limited to 20 GiB.

If an identity mismatch remains after updating Posterizarr, verify that the configured Plex URL points to the server whose data directory is mounted at `/plex`. Compare only the two identifier attributes above with `/identity`; do not share the entire `Preferences.xml`, which can contain tokens and other private settings. Do not bypass the mismatch check.

## Actions

**Read Only (Report)** is enabled by default for new schedules and schedules that do not yet have a `cleanup_read_only` setting. While enabled, it locks the Action field to Report Only, clears permanent-removal confirmation, and forces Report mode in the backend even if a saved request contains Quarantine or Remove. Switching it off permits selecting a writable action; permanent removal still needs its separate confirmation.

| Action | Behavior |
|---|---|
| Report Only | Default. Counts eligible images and bytes without modifying images. Start here. |
| Move to Quarantine | Moves eligible images to a unique directory under `database/plex-image-quarantine/` in Posterizarr's writable data directory. Original metadata-relative paths are preserved. |
| Permanently Remove | Deletes eligible images. Requires an explicit confirmation checkbox saved with that schedule. Cannot be undone. |

Quarantine is not automatically purged. It removes files from Plex's metadata tree but does not reclaim total disk space when the quarantine is on the same filesystem. Review it before deleting it. To recover a quarantined image, stop artwork writers and copy it back under Plex's `Metadata` directory using its preserved relative path; existing files must not be overwritten blindly.

### Delete Reviewed Quarantine Runs

Open **Asset Management > Plex Image Quarantine** to see each cleanup run, its server-local creation time, file count, and stored size. This view is available only when Plex is enabled with a configured URL and either a Plex Image Cleanup schedule exists or previous cleanup data is present (a quarantine run, report, or nonempty cleanup log). It stays hidden for Emby/Jellyfin-only installations, even if old Plex cleanup data remains on disk. After checking the artwork in Plex and keeping any recovery buffer you need, use the trash icon beside that run and confirm **Delete Permanently**. Only that run's quarantined recovery copies are removed; other runs and active Plex artwork are not touched. Deletion cannot be undone.

This is an explicit user action, not an automatic purge or a manual execution of the scheduled Plex cleanup task. The scheduled task's Read Only setting does not prevent separately confirmed deletion of already quarantined copies. Deletion is disabled while cleanup or another purge is active, and linked/unreadable run contents are refused. The backend accepts only generated run IDs inside Posterizarr's `database/plex-image-quarantine` directory, never arbitrary filesystem paths.

The **Remove** action in the scheduler still deletes eligible images directly from Plex's metadata directory; it does not empty quarantine. Quarantined copies can alternatively be deleted through the host filesystem after review.

## Protection Rules

- Only valid JPEG/PNG/WebP images with extensionless SHA-1-style names under metadata `Uploads` directories are considered.
- Selected posters, backgrounds, banners, clear logos, and square artwork are protected by every available supported `metadata_items` selection column, across the entire database.
- Unsupported or empty metadata databases abort cleanup rather than assuming nothing is selected.
- Provider/default images outside `Uploads`, `Contents` trees, uploaded themes, symlinks, junctions, and non-image files are excluded.
- A grace period defaults to **7 days** and cannot be shorter than **1 day**.
- Before moving/removing anything, the task refreshes selected-artwork data. Each candidate's path, size, modification timestamp, and selected status are rechecked. Files changed or selected since discovery are skipped.
- The task does not clear PhotoTranscoder, empty Plex trash, clean bundles, optimize databases, or touch Posterizarr's original assets.

An older unselected upload may still be a useful alternative poster. Quarantine is preferable to permanent removal until you have reviewed a Report run.

## Reports

Each executed task creates `UILogs/PlexImageCleanup.log` at startup and appends timestamped progress for snapshot creation/download, selected-artwork protection, metadata scanning, and candidate processing. Long scans report progress periodically rather than once per image. The final JSON summary is appended to this log and written to `UILogs/last_image_cleanup_report.json`.

The top navigation shows **IMAGE CLEANUP**, not Overlay Sync. Click that activity badge, or the log button beside the saved schedule, to open the cleanup live log. Cleanup has no Overlay Sync Stop action. Reports include action, candidate/changed counts and bytes, skipped files, errors, and the quarantine path when applicable. Busy skips are recorded by the scheduler.

## ImageMaid License

The following notice applies to the ImageMaid-derived selected-artwork protection logic. Upstream: <https://github.com/Kometa-Team/ImageMaid>.

```text
MIT License

Copyright (c) 2026 meisnate12

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```