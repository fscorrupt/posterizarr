import yaml
import os
import time
import sys
import json
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from animetafill_core.database import AnimeDatabase
from animetafill_core.providers import AnimeFillerListProvider, SimklProvider, EpisodeData, EpisodeCategory
from animetafill_core.classifier import EpisodeClassifierService
from animetafill_core.plex_client import PlexScanner
from animetafill_core.sonarr_client import SonarrTranslator
from animetafill_core.kometa import KometaYamlGenerator
from animetafill_core.logger import logger

def load_config():
    """
    Loads configuration from config.yml, falling back to config.example.yml 
    if the primary config is missing.
    """
    config_path = 'config.yml'
    if not os.path.exists(config_path):
        config_path = 'config.example.yml'

    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def run_sync(scheduler=None, custom_config=None, force=False):
    """
    Core synchronization loop.
    
    This function handles the end-to-end synchronization process:
    1. Reads Plex libraries to find shows.
    2. Imports manual overrides from existing Kometa YAML (Reverse Sync).
    3. Queries Sonarr/Plex to establish episode maps.
    4. Researches missing filler data via SIMKL and AFL.
    5. Generates optimized Kometa Overlay YAMLs.
    """
    start_time = time.time()
    logger.system(f"Starting Sync Task: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    config = custom_config or load_config()

    # 1. Initialize Components
    db_path = config.get('database', {}).get('path', '/data/anime_data.db')
    data_dir = os.path.dirname(db_path) if db_path else "/data"
    db = AnimeDatabase(db_path)

    afl_provider = AnimeFillerListProvider()
    simkl_conf = config.get('simkl', {})
    simkl_provider = SimklProvider(simkl_conf.get('client_id'))

    classifier = EpisodeClassifierService(db, afl_provider, simkl_provider)

    server_conf = config.get('server') or config.get('plex') or {}
    srv_type = (server_conf.get('type') or config.get('media_server') or 'plex').lower()
    srv_url = server_conf.get('url') or config.get('server_url') or config.get('plex', {}).get('url') or ''
    srv_token = server_conf.get('token') or config.get('server_token') or config.get('plex', {}).get('token') or ''
    
    from animetafill_core.media_scanner import MediaServerScanner
    scanner = MediaServerScanner(server_type=srv_type, url=srv_url, token=srv_token)

    sonarr_conf = config.get('sonarr', {})
    sonarr = SonarrTranslator(sonarr_conf.get('url'), sonarr_conf.get('api_key'))

    kometa_conf = config.get('overlays') or config.get('overlay') or config.get('kometa', {})
    kometa_out = kometa_conf.get('output_dir', '/data/kometa_overlays')

    kometa_gen = KometaYamlGenerator(kometa_out, kometa_config=kometa_conf)
    kometa_gen.migrate_legacy_files("anime_overlays.yml")
    
    # 2. Fetch shows from Media Server (Plex, Jellyfin, Emby)
    target_libraries = server_conf.get('libraries') or config.get('target_libraries') or config.get('plex', {}).get('libraries') or []
    shows = scanner.get_shows_from_libraries(target_libraries)
    logger.info(f"Found {len(shows)} shows across {len(target_libraries)} {srv_type.upper()} libraries.")
    if not shows:
        logger.warning(f"No shows were found in {srv_type.upper()} library/libraries ({target_libraries}). Please ensure your media server is reachable and target libraries are configured.")

    json_export_path = os.path.join(data_dir, "anime_database.json")

    # -- REVERSE SYNC PHASE: Import manual edits from YAML --
    logger.system("Checking for manual edits in existing YAML...")
    existing_overlays = kometa_gen.get_existing_overlays("anime_overlays.yml")
    
    # Group by title (case-insensitive) to avoid redundant Sonarr lookups
    grouped_edits = {}
    for item in existing_overlays:
        t = item['title']
        norm_t = t.strip().lower()
        if norm_t not in grouped_edits: 
            grouped_edits[norm_t] = {"canonical": t, "edits": []}
        grouped_edits[norm_t]["edits"].append(item)

    for norm_title, data in grouped_edits.items():
        title = data["canonical"]
        edits = data["edits"]
        
        # Optimization: Only import from YAML if the show is not already synced 
        # OR if we are forcing a re-sync. This avoids redundant API calls.
        if db.has_ever_synced(title) and "--force" not in sys.argv:
            continue

        if sonarr.is_enabled and any(title.lower() == s.lower() for s in shows): # Only import what's in our library
            series_info = sonarr.get_series_info(title)
            if series_info:
                # Unpack numeric and title maps
                sonarr_map, _ = sonarr.get_absolute_to_season_map(series_info['id'])
                if not sonarr_map: continue
                
                inv_map = {v: k for k, v in sonarr_map.items()}
                
                all_eps = []
                for item in edits:
                    cat_enum = EpisodeCategory.from_string(item['category'])
                    for s_e in item['episodes']:
                        abs_num = inv_map.get(s_e)
                        if abs_num:
                            all_eps.append(EpisodeData(
                                number=abs_num,
                                title=f"Episode {abs_num}",
                                category=cat_enum
                            ))
                
                if all_eps:
                    db.upsert_episodes(title, all_eps)
                    logger.info(f"Imported {len(all_eps)} total markers for '{title}' from YAML.")

    # 3. Main Loop
    skipped_list = [] # Detailed tracker for unmapped_shows.json
    skipped_reasons = {}
    total_shows = len(shows)
    successful_count = 0

    def log_skip(reason, title):
        skipped_reasons[reason] = skipped_reasons.get(reason, 0) + 1
        skipped_list.append({"title": title, "reason": reason})
        logger.warning(f"Skip: {reason}")

    for idx, title in enumerate(shows, 1):
        try:
            logger.divider()
            logger.system(f"[ {idx:03} / {total_shows:03} ] Processing: {title}")

            # A. Validate via Sonarr or Native Media Server Mapping (Plex, Jellyfin, Emby)
            series_info = sonarr.get_series_info(title) if sonarr.is_enabled else None
            sonarr_map = {}
            status = 'unknown'

            if series_info:
                status = series_info.get('status', 'unknown')
                sonarr_map, _ = sonarr.get_absolute_to_season_map(series_info['id'])
            else:
                if sonarr.is_enabled:
                    logger.info("Not found in Sonarr. Attempting native media server fallback...")
                else:
                    logger.info(f"Sonarr not configured. Using native {srv_type.upper()} episode mapping...")
                sonarr_map = scanner.get_episode_map(title)
                if not sonarr_map:
                    log_skip(f"Not found in {srv_type.upper()} API", title)
                    continue
                logger.success(f"{srv_type.upper()}-native mapping created: {len(sonarr_map)} episodes.")

            sonarr_count = len(sonarr_map)

            # C. Get Local DB data
            db_mapping = db.get_episodes(title)
            db_count = sum(len(v) for v in db_mapping.values())

            # D. Smart Sync Logic
            # We only perform network-heavy research if:
            # - We have never synced this show before.
            # - The user explicitly requested a --force re-sync.
            # - Our local episode count is lower than Sonarr's (new episodes aired).
            force_resync = force or ("--force" in sys.argv)
            needs_update = False

            if not db.has_ever_synced(title):
                logger.db("No previous sync data. Initializing provider research...")
                needs_update = True
            elif force_resync:
                logger.warning(f"Force re-sync requested for {title}. Overriding local DB...")
                needs_update = True
            elif db_count < sonarr_count:
                logger.db(f"Local Sync Outdated ({db_count} local vs {sonarr_count} remote). Syncing...")
                needs_update = True
            else:
                logger.info(f"Local DB is already up-to-date ({db_count} markers). Skipping research.")

            if needs_update:
                title_candidates = series_info.get('alternate_titles', [title]) if series_info else [title]
                if title not in title_candidates:
                    title_candidates.insert(0, title)
                else:
                    # Move to front
                    title_candidates.remove(title)
                    title_candidates.insert(0, title)

                search_success, source_url = classifier.force_update_mapping(
                    title_candidates, 
                    tvdb_id=series_info.get('tvdb_id') if series_info else None,
                    expected_count=sonarr_count
                )

                if search_success and source_url:
                    logger.success(f"Source: {source_url}")

                # Fetch fresh mapping after search
                db_mapping = db.get_episodes(title)
                db_count = sum(len(v) for v in db_mapping.values())

                if not search_success and not any(db_mapping.values()):
                    log_skip("No filler data found in any sync tier", title)
                    continue

            # E. Stage Kometa Overlays
            if any(db_mapping.values()):
                # Use 2-tier mapping (Numeric + Title)
                sonarr_map, title_map = sonarr.get_absolute_to_season_map(series_info['id']) if series_info else (sonarr_map, {})
                kometa_gen.add_show_overlays(title, db_mapping, sonarr_map, title_map=title_map)
                successful_count += 1
                logger.success(f"Show mapped with {db_count} filler/canon markers.")
            else:
                log_skip("No filler data found", title)

        except Exception as e:
            logger.error(f"Failed to process {title}: {e}")
            log_skip("Internal Error", title)
            continue

    # 4. Finalize Exports
    kometa_gen.save_unified_file("anime_overlays.yml")
    db.export_to_json(json_export_path)

    # Export Unmapped Shows report
    unmapped_path = os.path.join(data_dir, "unmapped_shows.json")
    try:
        if os.path.dirname(unmapped_path):
            os.makedirs(os.path.dirname(unmapped_path), exist_ok=True)
        tmp_unmapped = f"{unmapped_path}.tmp"
        with open(tmp_unmapped, 'w') as f:
            json.dump({"date": str(datetime.now()), "skipped_shows": skipped_list}, f, indent=2)
        os.replace(tmp_unmapped, unmapped_path)
        logger.info(f"Unmapped shows report exported to {unmapped_path}")
    except Exception as e:
        logger.error(f"Failed to export unmapped shows report: {e}")

    # 5. Final Summary
    logger.divider()
    logger.system("FINAL SYNC SUMMARY")
    logger.info(f"Total Shows:         {total_shows}")
    logger.info(f"Successfully Mapped: {successful_count}")
    logger.info(f"Skipped/Failed:      {total_shows - successful_count}")

    # Calculate and format duration
    duration_total = time.time() - start_time
    if duration_total < 60:
        duration_str = f"{duration_total:.1f}s"
    else:
        duration_str = f"{int(duration_total // 60)}m {int(duration_total % 60)}s"
    logger.info(f"Run Duration:        {duration_str}")

    if scheduler:
        try:
            jobs = scheduler.get_jobs()
            if jobs:
                run_times = []
                for job in jobs:
                    nrt = getattr(job, 'next_run_time', None)
                    if nrt:
                        run_times.append(nrt)
                
                if run_times:
                    next_run = min(run_times)
                    logger.success(f"Next Scheduled Run: {next_run.strftime('%Y-%m-%d %H:%M:%S')}")
        except Exception as e:
            logger.warning(f"Could not determine next run time: {e}")

    if skipped_reasons:
        logger.info("Reasons for Skipping:")
        for reason, count in skipped_reasons.items():
            logger.info(f"  - {reason:<25} : {count}")
    
    logger.divider()
    logger.system("Sync Task Finished.")

def main():
    """
    Application entry point. 
    Handles both immediate CLI execution and background daemon scheduling.
    """
    print("""
    ==================================================
       AniMetaFill
       Automated Anime Filler Classification
    ==================================================
    """)
    logger.system("AniMetaFill Starting...")
    config = load_config()
    sched_conf = config.get('scheduling', {})

    # Check for immediate run flag (One-off run without scheduler)
    if not sched_conf.get('enabled', False):
        run_sync()
        return

    # Initialize Scheduler with TZ awareness
    tz = os.environ.get('TZ', 'UTC')
    scheduler = BackgroundScheduler(timezone=tz)
    logger.info(f"Scheduler initialized with timezone: {tz}")
    mode = sched_conf.get('mode', 'daily').lower()
    time_str = sched_conf.get('time', '03:00')
    
    # Parse time entries (Supports "03:00" or "02:30,05:30")
    time_points = []
    for entry in time_str.split(','):
        entry = entry.strip()
        if ':' in entry:
            h, m = entry.split(':')
            time_points.append((h, m))
        else:
            time_points.append((entry, "0"))

    # Add jobs for each requested time
    for h, m in time_points:
        if mode == 'interval':
            minutes = sched_conf.get('interval', 1440)
            scheduler.add_job(run_sync, IntervalTrigger(minutes=minutes), kwargs={'scheduler': scheduler})
            logger.system(f"Scheduled: Every {minutes} minutes.")
            break
        elif mode == 'daily':
            scheduler.add_job(run_sync, CronTrigger(hour=h, minute=m), kwargs={'scheduler': scheduler})
            logger.system(f"Scheduled: Daily at {h}:{m}.")
        elif mode == 'weekly':
            day_of_week = sched_conf.get('weekday', 'mon').lower()
            scheduler.add_job(run_sync, CronTrigger(day_of_week=day_of_week, hour=h, minute=m), kwargs={'scheduler': scheduler})
            logger.system(f"Scheduled: Weekly on {day_of_week} at {h}:{m}.")
        elif mode == 'monthly':
            day = sched_conf.get('day', 1)
            scheduler.add_job(run_sync, CronTrigger(day=day, hour=h, minute=m), kwargs={'scheduler': scheduler})
            logger.system(f"Scheduled: Monthly on day {day} at {h}:{m}.")

    # Start scheduler first so Job.next_run_time is populated
    scheduler.start()
    logger.success("Daemon is alive. Waiting for next schedule...")

    # Run immediate sync if --now is present OR run_on_startup is enabled
    if "--now" in sys.argv or sched_conf.get('run_on_startup', True):
        reason = "CLI --now" if "--now" in sys.argv else "Startup trigger"
        logger.info(f"Executing initial sync ({reason})...")
        run_sync(scheduler=scheduler)

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.warning("Daemon stopping...")

if __name__ == "__main__":
    main()
