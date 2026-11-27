export const CONFIG_TAB_METADATA = {
  System: {
    path: "/config/system",
    groups: ["WebUI Settings", "System Settings", "Language & Notifications"],
  },
  Providers: {
    path: "/config/providers",
    groups: ["Provider Settings"],
  },
  "Media Servers": {
    path: "/config/services",
    groups: ["Media Servers"],
  },
  "Global Visuals": {
    path: "/config/visuals",
    groups: ["Global Visuals"],
  },
  Posters: {
    path: "/config/posters",
    groups: ["Poster Settings", "Poster Overlays"],
  },
  Seasons: {
    path: "/config/seasons",
    groups: ["Season Settings", "Season Overlays", "Season Show Title"],
  },
  Backgrounds: {
    path: "/config/backgrounds",
    groups: ["Background Settings", "Background Overlays"],
  },
  "Title Cards": {
    path: "/config/titlecards",
    groups: [
      "Title Card Settings",
      "Title Card Overlay",
      "Title Card Title Text",
      "Title Card Episode Text",
    ],
  },
  Collections: {
    path: "/config/collections",
    groups: ["Collection Settings", "Collection Poster", "Collection Title"],
  },
};

const SENSITIVE_CONFIG_KEY_RE =
  /(password|token|secret|apikey|api_key|webhook|pin|basicauth|passphrase|clientid|client_id|clientsecret)/i;

function isSensitiveConfigKey(key) {
  return SENSITIVE_CONFIG_KEY_RE.test(String(key || ""));
}

function stripMarkdown(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFallbackKeyName(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

export function buildDynamicOverlaySettingsSearchItems(t) {
  const dynamicOverlaysTitle = t("dynamicOverlays.title", "Dynamic Overlays");
  const engineSubtitle = `${dynamicOverlaysTitle} › Overlay Engine & Provider Settings`;

  return [
    {
      id: "overlay-setting:overlay_engine_settings",
      title: "Overlay Engine, Concurrency & Provider Settings",
      subtitle: `${dynamicOverlaysTitle} › Visual / YAML Config`,
      description:
        "Configure parallel RAM workers, debug pixel log, API keys (MDBList, OMDb, SIMKL), and auto-refresh schedule.",
      settingKey: "overlay_engine_settings",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "overlay_engine_settings",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "sliders",
      keywords:
        "overlay engine concurrency provider settings workers ram debug pixel log mdblist mdb omdb simkl api key ratings auto-sync",
    },
    {
      id: "overlay-setting:mdblist_api_key",
      title: "MDBList API Key",
      subtitle: engineSubtitle,
      description:
        "Optional MDBList API key for Trakt, Letterboxd, IMDb, and Rotten Tomatoes ratings.",
      settingKey: "mdblist_api_key",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "mdblist_api_key",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "settings",
      keywords:
        "mdblist mdb api key ratings trakt letterboxd imdb rotten tomatoes rt overlays provider",
    },
    {
      id: "overlay-setting:omdb_api_key",
      title: "OMDb API Key",
      subtitle: engineSubtitle,
      description:
        "Optional OMDb API key for IMDb, Rotten Tomatoes, and Metacritic ratings.",
      settingKey: "omdb_api_key",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "omdb_api_key",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "settings",
      keywords:
        "omdb omdbapi api key ratings imdb rotten tomatoes metacritic overlays provider",
    },
    {
      id: "overlay-setting:simkl_client_id",
      title: "SIMKL Client ID",
      subtitle: engineSubtitle,
      description:
        "Optional SIMKL Client ID for anime season and ratings overlays.",
      settingKey: "simkl_client_id",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "simkl_client_id",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "settings",
      keywords:
        "simkl client id api key anime season ratings overlays provider",
    },
    {
      id: "overlay-setting:season_rating_libraries",
      title: "Libraries for Anime Season Ratings",
      subtitle: engineSubtitle,
      description: "Select which libraries fetch anime season ratings via SIMKL.",
      settingKey: "season_rating_libraries",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "season_rating_libraries",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "settings",
      keywords: "anime season ratings simkl libraries overlays",
    },
    {
      id: "overlay-setting:auto_sync_on_startup",
      title: "Auto-Sync on New Artwork",
      subtitle: engineSubtitle,
      description:
        "Automatically add overlays whenever Posterizarr creates new artwork in scheduled runs.",
      settingKey: "auto_sync_on_startup",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "auto_sync_on_startup",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "settings",
      keywords: "auto sync startup new artwork scheduled runs dynamic overlays",
    },
    {
      id: "overlay-setting:ratings_cache_rules",
      title: "Saved Ratings & Refresh Rules",
      subtitle: engineSubtitle,
      description:
        "Tiered rating cache refresh intervals and Clear Ratings Cache action.",
      settingKey: "ratings_cache_rules",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "ratings_cache_rules",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "sparkles",
      keywords: "saved ratings refresh rules clear cache ttl mdblist omdb imdb",
    },
    {
      id: "overlay-setting:debug_logging",
      title: "Debug Pixel Coordinates Logging",
      subtitle: engineSubtitle,
      description:
        "Prints per-poster pixel coordinates and scale factors into DynamicOverlaysSync.log.",
      settingKey: "debug_logging",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "debug_logging",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "sliders",
      keywords: "debug pixel coordinates logging DynamicOverlaysSync.log overlays",
    },
    {
      id: "overlay-setting:concurrency",
      title: "Parallel In-Memory Processing",
      subtitle: engineSubtitle,
      description:
        "Number of artwork items composited and synchronized simultaneously in RAM (workers).",
      settingKey: "concurrency",
      route: "/dynamic-overlays?tab=config",
      navState: {
        overlaySettingKey: "concurrency",
        targetTab: "config",
        openEngineSettings: true,
      },
      iconKey: "sliders",
      keywords:
        "parallel workers concurrency ram in-memory processing threads speed overlays",
    },
    {
      id: "overlay-setting:change_detection_dry_run",
      title: "Dynamic Overlays Dry Run",
      subtitle: `${dynamicOverlaysTitle} › Media Change Detection`,
      description:
        "Render overlays locally without uploading to Plex, Jellyfin, or Emby.",
      settingKey: "change_detection_dry_run",
      route: "/dynamic-overlays?tab=media-changes",
      navState: {
        overlaySettingKey: "change_detection_dry_run",
        targetTab: "media-changes",
      },
      iconKey: "sliders",
      keywords:
        "dry run dryrun preview test no upload dynamic overlays media change detection",
    },
    {
      id: "overlay-setting:ratings_cache",
      title: "Ratings Cache & Auto-Refresh",
      subtitle: `${dynamicOverlaysTitle} › Ratings Cache`,
      description:
        "Browse or clear cached IMDb, Rotten Tomatoes, TMDb, Trakt, and Letterboxd ratings.",
      settingKey: "ratings_cache",
      route: "/dynamic-overlays?tab=ratings-cache",
      navState: {
        overlaySettingKey: "ratings_cache",
        targetTab: "ratings-cache",
      },
      iconKey: "sparkles",
      keywords:
        "ratings cache auto refresh browse clear imdb omdb mdblist rotten tomatoes trakt letterboxd",
    },
    {
      id: "overlay-setting:animetafill_simkl_client_id",
      title: "AniMetaFill SIMKL Client ID",
      subtitle: `${dynamicOverlaysTitle} › AniMetaFill`,
      description:
        "Required SIMKL Client ID for anime canon/filler episode classification.",
      settingKey: "animetafill_simkl_client_id",
      route: "/dynamic-overlays?tab=anime",
      navState: {
        overlaySettingKey: "animetafill_simkl_client_id",
        targetTab: "anime",
      },
      iconKey: "settings",
      keywords:
        "animetafill simkl client id api key anime filler canon mixed episodes",
    },
    {
      id: "overlay-setting:animetafill_sonarr",
      title: "AniMetaFill Sonarr Connection",
      subtitle: `${dynamicOverlaysTitle} › AniMetaFill`,
      description:
        "Optional Sonarr URL and API key for AniMetaFill anime episode mapping.",
      settingKey: "animetafill_sonarr",
      route: "/dynamic-overlays?tab=anime",
      navState: {
        overlaySettingKey: "animetafill_sonarr",
        targetTab: "anime",
      },
      iconKey: "settings",
      keywords: "animetafill sonarr url api key anime episodes",
    },
  ].map((item) => ({ ...item, category: "settings" }));
}

export function buildStaticSearchItems({ t, themes = {}, setTheme }) {
  const pages = [
    {
      id: "page:dashboard",
      title: t("nav.dashboard", "Dashboard"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/",
      iconKey: "activity",
      keywords: "home overview status stats summary dashboard startseite übersicht",
    },
    {
      id: "page:run-modes",
      title: t("nav.runModes", "Run Modes"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/run-modes",
      iconKey: "play",
      keywords: "run start execute dryrun testing normal manual schedule sync starten",
    },
    {
      id: "page:queue",
      title: t("topNavbar.views.queue", "Queue"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/queue",
      iconKey: "layers",
      keywords: "queue jobs tasks pending worker warteschlange",
    },
    {
      id: "page:scheduler",
      title: t("nav.scheduler", "Scheduler"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/scheduler",
      iconKey: "clock",
      keywords: "cron schedule timer automation zeitplan intervall",
    },
    {
      id: "page:auto-triggers",
      title: t("nav.autoTriggers", "Auto Triggers"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/auto-triggers",
      iconKey: "zap",
      keywords: "webhook sonarr radarr tautulli trigger automation arr",
    },
    {
      id: "page:export-plex",
      title: `${t("nav.mediaServerExport", "Media Server Export")} › ${t("mediaServerExport.plex", "Plex")}`,
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/media-server-export/plex",
      iconKey: "layers",
      keywords: "plex export library metadata database",
    },
    {
      id: "page:export-jellyfin-emby",
      title: `${t("nav.mediaServerExport", "Media Server Export")} › ${t("mediaServerExport.jellyfinEmby", "Jellyfin / Emby")}`,
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/media-server-export/jellyfin-emby",
      iconKey: "layers",
      keywords: "jellyfin emby export library metadata",
    },
    {
      id: "page:gallery-posters",
      title: t("assets.posters", "Posters"),
      subtitle: t("nav.assets", "Assets"),
      route: "/gallery/posters",
      iconKey: "image",
      keywords: "poster gallery images artwork filme serien bilder galerie",
    },
    {
      id: "page:gallery-backgrounds",
      title: t("assets.backgrounds", "Backgrounds"),
      subtitle: t("nav.assets", "Assets"),
      route: "/gallery/backgrounds",
      iconKey: "image",
      keywords: "background fanart backdrop hintergrundbilder",
    },
    {
      id: "page:gallery-seasons",
      title: t("assets.seasons", "Seasons"),
      subtitle: t("nav.assets", "Assets"),
      route: "/gallery/seasons",
      iconKey: "image",
      keywords: "season poster staffel tv show",
    },
    {
      id: "page:gallery-titlecards",
      title: t("assets.titleCards", "Title Cards"),
      subtitle: t("nav.assets", "Assets"),
      route: "/gallery/titlecards",
      iconKey: "image",
      keywords: "titlecard episode card titelbild",
    },
    {
      id: "page:manual-assets",
      title: "Manual Assets",
      subtitle: t("nav.assets", "Assets"),
      route: "/manual-assets",
      iconKey: "folder",
      keywords: "manual custom assets override upload eigene",
    },
    {
      id: "page:asset-backups",
      title: t("backupAssets.title", "Backups"),
      subtitle: t("nav.assets", "Assets"),
      route: "/asset-backups",
      iconKey: "folder",
      keywords: "backup restore archive sicherung",
    },
    {
      id: "page:image-quarantine",
      title: t("topNavbar.views.imageQuarantine", "Plex Image Quarantine"),
      subtitle: t("nav.assets", "Assets"),
      route: "/image-quarantine",
      iconKey: "image",
      keywords: "quarantine cleanup plex orphaned deleted",
    },
    {
      id: "page:asset-overview",
      title: t("nav.assetOverview", "Asset Overview"),
      subtitle: t("nav.assets", "Assets"),
      route: "/asset-overview",
      iconKey: "activity",
      keywords: "missing unresolved overview skipped imagechoices",
    },
    {
      id: "page:asset-title-review",
      title: t("nav.assetTitleReview", "Asset Title Review"),
      subtitle: t("nav.assets", "Assets"),
      route: "/asset-title-review",
      iconKey: "image",
      keywords: "title review rename matching",
    },
    {
      id: "page:test-gallery",
      title: t("nav.testGallery", "Test Gallery"),
      subtitle: t("nav.assets", "Assets"),
      route: "/test-gallery",
      iconKey: "image",
      keywords: "test gallery preview sample dry run",
    },
    {
      id: "page:collection-builder",
      title: "Collection Builder",
      subtitle: "Builders",
      route: "/media-server-collections",
      iconKey: "layers",
      keywords: "collection builder poster live editor sammlung",
    },
    {
      id: "page:logo-builder",
      title: "Logo Builder",
      subtitle: "Builders",
      route: "/media-server-logos",
      iconKey: "image",
      keywords: "logo builder clearlogo clearart",
    },
    {
      id: "page:overlay-builder",
      title: t("topNavbar.views.assetManager", "Overlay Builder"),
      subtitle: "Builders",
      route: "/assets-manager",
      iconKey: "layers",
      keywords: "overlay builder custom files fonts borders upload",
    },
    {
      id: "page:dynamic-overlays",
      title: t("dynamicOverlays.title", "Dynamic Overlays"),
      subtitle: "Builders › Rules",
      route: "/dynamic-overlays?tab=rules",
      iconKey: "sparkles",
      keywords: "dynamic overlays kometa yaml badges ratings resolution status language",
    },
    {
      id: "page:dynamic-overlays-community",
      title: `${t("dynamicOverlays.title", "Dynamic Overlays")} › ${t("communityGallery.tabTitle", "Community Gallery")}`,
      subtitle: "Builders › Importer",
      route: "/dynamic-overlays?tab=importer",
      iconKey: "globe",
      keywords: "community gallery overlay bundles import export share",
    },
    {
      id: "page:dynamic-overlays-visual",
      title: `${t("dynamicOverlays.title", "Dynamic Overlays")} › Visual / YAML Config`,
      subtitle: "Builders",
      route: "/dynamic-overlays?tab=config",
      iconKey: "sliders",
      keywords: "dynamic overlays config yaml editor visual studio mdblist mdb omdb simkl provider api key workers concurrency engine",
    },
    {
      id: "page:dynamic-overlays-preview",
      title: `${t("dynamicOverlays.title", "Dynamic Overlays")} › Live Preview`,
      subtitle: "Builders",
      route: "/dynamic-overlays?tab=preview",
      iconKey: "sparkles",
      keywords: "dynamic overlays preview sprite simulator dry run",
    },
    {
      id: "page:dynamic-overlays-anime",
      title: `${t("dynamicOverlays.title", "Dynamic Overlays")} › AniMetaFill`,
      subtitle: "Builders",
      route: "/dynamic-overlays?tab=anime",
      iconKey: "sparkles",
      keywords: "animetafill simkl anime ratings episodes",
    },
    {
      id: "page:dynamic-overlays-sync",
      title: `${t("dynamicOverlays.title", "Dynamic Overlays")} › Sync & Caches`,
      subtitle: "Builders",
      route: "/dynamic-overlays?tab=sync",
      iconKey: "sparkles",
      keywords: "overlay sync ratings cache imdb dataset media changes",
    },
    {
      id: "page:blueprints",
      title: t("topNavbar.views.blueprints", "Blueprint Builder"),
      subtitle: "Builders › Presets",
      route: "/blueprints",
      navState: { tab: "presets" },
      iconKey: "layers",
      keywords: "blueprints presets visual styles templates vorlagen",
    },
    {
      id: "page:blueprints-builder",
      title: `${t("topNavbar.views.blueprints", "Blueprint Builder")} › ${t("blueprints.builder.tabBuilder", "Builder")}`,
      subtitle: "Builders",
      route: "/blueprints",
      navState: { tab: "builder" },
      iconKey: "sliders",
      keywords: "blueprint editor customize style create export",
    },
    {
      id: "page:blueprints-community",
      title: `${t("topNavbar.views.blueprints", "Blueprint Builder")} › ${t("communityGallery.tabTitle", "Community Gallery")}`,
      subtitle: "Builders",
      route: "/blueprints",
      navState: { tab: "community" },
      iconKey: "globe",
      keywords: "community gallery blueprints styles presets github",
    },
    {
      id: "page:runtime-history",
      title: t("nav.runtimeHistory", "Runtime History"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/runtime-history",
      iconKey: "activity",
      keywords: "runtime history stats duration insights charts verlauf",
    },
    {
      id: "page:logs",
      title: t("nav.logs", "Logs"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/logs",
      iconKey: "fileText",
      keywords: "logs support zip debug error console protokolle",
    },
    {
      id: "page:how-it-works",
      title: t("nav.howItWorks", "How It Works"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/how-it-works",
      iconKey: "globe",
      keywords: "docs guide help documentation hilfe anleitung",
    },
    {
      id: "page:about",
      title: t("nav.about", "About"),
      subtitle: t("globalSearch.categories.pages", "Page"),
      route: "/about",
      iconKey: "globe",
      keywords: "about version updates release notes changelog über",
    },
    ...Object.entries(CONFIG_TAB_METADATA).map(([tabName, meta]) => ({
      id: `page:config-${tabName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: `${t("nav.config", "Configuration")} › ${tabName}`,
      subtitle: meta.groups.join(" · "),
      route: meta.path,
      iconKey: "settings",
      keywords: `config configuration settings einstellungen ${tabName} ${meta.groups.join(" ")}`,
    })),
  ].map((item) => ({ ...item, category: "pages" }));

  const actions = [
    {
      id: "action:onboarding",
      category: "actions",
      title: t("globalSearch.actions.openOnboarding", "Open Setup Wizard"),
      subtitle: t("globalSearch.actions.openOnboardingDesc", "Launch the guided Posterizarr onboarding modal"),
      iconKey: "zap",
      keywords: "onboarding setup wizard guide einrichtung assistent",
      action: () => window.dispatchEvent(new Event("openOnboarding")),
    },
    ...Object.entries(themes).map(([themeId, cfg]) => ({
      id: `action:theme-${themeId}`,
      category: "actions",
      title: t("globalSearch.actions.switchTheme", {
        name: cfg?.name || themeId,
        defaultValue: "Switch Theme: {{name}}",
      }),
      subtitle: t("globalSearch.actions.switchThemeDesc", "Apply color theme immediately"),
      iconKey: "palette",
      colorDot: cfg?.variables?.["--theme-primary"] || null,
      keywords: `theme color appearance design farbe ${themeId} ${cfg?.name || ""}`,
      action: () => setTheme?.(themeId),
    })),
  ];

  const overlaySettings = buildDynamicOverlaySettingsSearchItems(t);

  return [...pages, ...overlaySettings, ...actions];
}

export function buildConfigSearchItems(configPayload, t) {
  if (!configPayload || !configPayload.config) return [];
  const {
    config,
    ui_groups: uiGroups,
    display_names: displayNames = {},
    tooltips = {},
    using_flat_structure: usingFlatStructure = false,
  } = configPayload;

  const items = [];
  const seen = new Set();

  for (const [tabName, tabMeta] of Object.entries(CONFIG_TAB_METADATA)) {
    for (const groupName of tabMeta.groups) {
      let keys = [];
      if (usingFlatStructure && uiGroups) {
        keys = (uiGroups[groupName] || []).filter((k) => k in config);
      } else if (config[groupName] && typeof config[groupName] === "object") {
        keys = Object.keys(config[groupName]);
      }

      for (const key of keys) {
        const dedupeKey = `${groupName}:${key}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const displayName =
          key === "UseSilo" || key.startsWith("Silo")
            ? t(`silo.fields.${key}`, {
                defaultValue: displayNames[key] || formatFallbackKeyName(key),
              })
            : displayNames[key] || formatFallbackKeyName(key);

        const rawTooltip = tooltips[key] || tooltips[`${groupName}.${key}`] || "";
        const cleanTooltip = stripMarkdown(rawTooltip);
        const description =
          cleanTooltip.length > 130 ? `${cleanTooltip.slice(0, 127)}...` : cleanTooltip;

        let safeValueKeyword = "";
        if (!isSensitiveConfigKey(key)) {
          const val = usingFlatStructure ? config[key] : config[groupName]?.[key];
          if (typeof val === "boolean" || typeof val === "number") {
            safeValueKeyword = String(val);
          } else if (
            typeof val === "string" &&
            val.length > 0 &&
            val.length <= 48 &&
            !val.includes("://")
          ) {
            safeValueKeyword = val;
          }
        }

        items.push({
          id: `setting:${groupName}:${key}`,
          category: "settings",
          title: displayName,
          subtitle: `${tabName} › ${groupName}`,
          description,
          settingKey: key,
          groupName,
          tabPath: tabMeta.path,
          route: tabMeta.path,
          navState: { jumpToSetting: { group: groupName, key } },
          iconKey: "settings",
          keywords: `${key} ${displayName} ${groupName} ${tabName} ${cleanTooltip} ${safeValueKeyword}`,
        });
      }
    }
  }

  return items;
}

export function scoreLocalItem(item, tokens, fullQuery = "") {
  if (!tokens || tokens.length === 0) return 0;
  const primary = String(item.title || "");
  const secondary = [
    item.subtitle,
    item.description,
    item.settingKey,
    item.keywords,
  ]
    .filter(Boolean)
    .join(" ");

  const primLow = primary.toLowerCase();
  const keyLow = String(item.settingKey || "").toLowerCase();
  const combined = `${primLow} ${secondary.toLowerCase()}`;

  if (!tokens.every((tok) => combined.includes(tok))) {
    return 0;
  }

  let score = 1;
  const qLow = fullQuery.trim().toLowerCase();
  if (qLow) {
    if (primLow === qLow || keyLow === qLow) score += 120;
    else if (primLow.startsWith(qLow) || keyLow.startsWith(qLow)) score += 75;
    else if (primLow.includes(qLow) || keyLow.includes(qLow)) score += 45;
  }
  for (const tok of tokens) {
    if (primLow.includes(tok) || keyLow.includes(tok)) score += 25;
    else score += 8;
  }
  if (item.category === "pages") score += 6;
  return score;
}
