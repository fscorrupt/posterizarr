import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  Upload,
  RefreshCw,
  Loader2,
  Download,
  Check,
  Star,
  Image as ImageIcon,
  AlertCircle,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import { BLUEPRINTS } from "./Blueprints";

const API_URL = "/api";

function AssetReplacer({ asset, onClose, onSuccess }) {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isPosterizarrRunning, setIsPosterizarrRunning] = useState(false);
  const [previews, setPreviews] = useState({ tmdb: [], tvdb: [], fanart: [] });
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [dbData, setDbData] = useState(asset._dbData || null); // Store database data in state
  const [languageOrder, setLanguageOrder] = useState({
    poster: [],
    background: [],
    season: [],
  });

  const [activeTab, setActiveTab] = useState("upload");
  const [processWithOverlays, setProcessWithOverlays] = useState(true);
  const [addToQueue, setAddToQueue] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [blueprintId, setBlueprintId] = useState("none");
  const [customBlueprints, setCustomBlueprints] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null); // Store the actual file
  const [uploadHasText, setUploadHasText] = useState(false); // Track if uploaded asset has text
  const [imageDimensions, setImageDimensions] = useState(null); // Store {width, height}
  const [isDimensionValid, setIsDimensionValid] = useState(false); // Track if dimensions are valid
  const [activeProviderTab, setActiveProviderTab] = useState("tmdb"); // Provider tabs: tmdb, tvdb, fanart
  const [languageFilter, setLanguageFilter] = useState("all");

  // Logo selection mode
  const [logoSelectionMode, setLogoSelectionMode] = useState(false);

  // Season override settings
  const [overrideSeasonName, setOverrideSeasonName] = useState(false);
  const [seasonOverrideText, setSeasonOverrideText] = useState("Staffel");
  const [specialSeasonOverrideText, setSpecialSeasonOverrideText] = useState("Spezial");

  // Confirmation dialog states
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [showPreviewConfirm, setShowPreviewConfirm] = useState(false);
  const [showFetchConfirm, setShowFetchConfirm] = useState(false);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [pendingFetchParams, setPendingFetchParams] = useState(null);

  // Manual form for editable parameters (overlay processing)
  const [manualForm, setManualForm] = useState({
    titletext: "",
    foldername: "",
    libraryname: "",
    seasonPosterName: "", // For season posters and titlecards
    episodeNumber: "", // For titlecards
    episodeTitleName: "", // For titlecards
  });

  // Manual search state (separate from manual form!)
  const [manualSearchForm, setManualSearchForm] = useState({
    seasonNumber: "", // For searching seasons
    episodeNumber: "", // For searching episodes
  });

  // Extract metadata from asset
  const extractMetadata = () => {
    console.log("=== AssetReplacer: Extracting Metadata ===");
    console.log("Asset path:", asset.path);
    console.log("Asset type:", asset.type);
    console.log("Asset _dbData:", asset._dbData);
    console.log("State dbData:", dbData);

    // Extract metadata from path including provider IDs if present
    let title = null;
    let showTitle = null;
    let year = null;
    let folderName = null;
    let libraryName = null;
    let tmdb_id = null;
    let tvdb_id = null;
    let imdb_id = null;

    // Extract library name (parent folder: "4K", "TV", etc.)
    const pathSegments = asset.path?.split(/[\/\\]/).filter(Boolean);
    console.log("Path segments:", pathSegments);

    if (pathSegments && pathSegments.length > 0) {
      // Find library name - usually the top-level folder like "4K" or "TV"
      for (let i = 0; i < pathSegments.length; i++) {
        // Common library folder names
        if (pathSegments[i].match(/^(4K|TV|Movies|Series|Anime)$/i)) {
          libraryName = pathSegments[i];
          console.log(`Found library name: ${libraryName}`);
          break;
        }
      }
      // If not found, use the first segment as library name
      if (!libraryName && pathSegments.length > 0) {
        libraryName = pathSegments[0];
        console.log(`Using first segment as library name: ${libraryName}`);
      }
    }

    // Determine asset type first (needed for title extraction logic)
    let assetType = "poster";
    if (asset.path?.includes("background") || asset.type === "background") {
      assetType = "background";
    } else if (asset.path?.includes("Season") || asset.type === "season") {
      assetType = "season";
    } else if (asset.path?.match(/S\d+E\d+/) || asset.type === "titlecard") {
      assetType = "titlecard";
    } else if (asset.path?.startsWith("Collections/") || asset.path?.startsWith("Collections\\") || asset.type === "collection") {
      assetType = "collection";
    }
    console.log(`Detected asset type: ${assetType}`);

    // For seasons and titlecards, extract title from parent folder (show name)
    if (assetType === "season" || assetType === "titlecard") {
      console.log("Processing TV show asset (season or titlecard)");
      // Path format: ".../Show Name (Year) {tvdb-123}/Season01/..." or ".../Show Name (Year) {tvdb-123}/S01E01.jpg"

      if (pathSegments && pathSegments.length > 1) {
        // Find the show folder (parent of Season folder or file)
        let showFolderIndex = -1;
        for (let i = pathSegments.length - 1; i >= 0; i--) {
          if (
            pathSegments[i].match(/Season\d+/i) ||
            pathSegments[i].match(/S\d+E\d+/)
          ) {
            showFolderIndex = i - 1;
            break;
          }
        }

        // If no Season folder found, try to find show folder by looking for {tvdb-} or {tmdb-}
        if (showFolderIndex === -1) {
          for (let i = 0; i < pathSegments.length; i++) {
            if (pathSegments[i].match(/\{(tvdb|tmdb)-\d+\}/)) {
              showFolderIndex = i;
              break;
            }
          }
        }

        if (showFolderIndex >= 0 && pathSegments[showFolderIndex]) {
          const showFolder = pathSegments[showFolderIndex];
          folderName = showFolder; // Store the full folder name

          // Extract title and year - remove ALL ID tags in various formats:
          // {tmdb-123}, {tvdb-456}, {imdb-tt123}, [tmdb-123], [tvdb-456], (tmdb-123), (xxx-yyy), etc.
          // Pattern: "Show Name (2020) {tmdb-123}" or "Show Name (2020) [imdb-tt123][tvdb-456]" or "Show Name (2020) (tmdb-123)"
          let cleanFolder = showFolder
            .replace(/\s*\{[^}]+\}/g, "") // Remove {xxx-yyy}
            .replace(/\s*\[[^\]]+\]/g, "") // Remove [xxx-yyy]
            .replace(/\s*\((tmdb|tvdb|imdb)-[^)]+\)/gi, "") // Remove (tmdb-xxx), (tvdb-xxx), (imdb-xxx)
            .replace(/\s*\([a-z]+-[^)]+\)/gi, "") // Remove generic (xxx-yyy) format
            .trim();

          // Now extract title and year
          const showMatch = cleanFolder.match(/^(.+?)\s*\((\d{4})\)\s*$/);
          if (showMatch) {
            title = showMatch[1].trim();
            showTitle = title;
            year = parseInt(showMatch[2]);
          } else {
            // Fallback: try to extract year separately
            const yearMatch = cleanFolder.match(/\((\d{4})\)/);
            if (yearMatch) {
              year = parseInt(yearMatch[1]);
              title = cleanFolder.replace(/\s*\(\d{4}\)\s*/, "").trim();
              showTitle = title;
            } else {
              title = cleanFolder;
              showTitle = title;
            }
          }
        }
      }
    } else {
      // For movies/posters/backgrounds: extract from the main folder/file
      // Find folder with year pattern (ignoring ALL tags)
      if (pathSegments && pathSegments.length > 0) {
        for (let i = pathSegments.length - 1; i >= 0; i--) {
          const segment = pathSegments[i];
          // Check if this segment has a year pattern
          if (segment.match(/\(\d{4}\)/)) {
            folderName = segment;

            // Clean the folder name from ALL ID tags in various formats:
            // {tmdb-123}, [tvdb-456], (imdb-tt123), (xxx-yyy), etc.
            let cleanSegment = segment
              .replace(/\s*\{[^}]+\}/g, "") // Remove {xxx-yyy}
              .replace(/\s*\[[^\]]+\]/g, "") // Remove [xxx-yyy]
              .replace(/\s*\((tmdb|tvdb|imdb)-[^)]+\)/gi, "") // Remove (tmdb-xxx), (tvdb-xxx), (imdb-xxx)
              .replace(/\s*\([a-z]+-[^)]+\)/gi, "") // Remove generic (xxx-yyy) format
              .trim();

            // Extract title and year
            const match = cleanSegment.match(/^(.+?)\s*\((\d{4})\)\s*$/);
            if (match) {
              title = match[1].trim();
              year = parseInt(match[2]);
            } else {
              // Fallback
              const yearMatch = cleanSegment.match(/\((\d{4})\)/);
              if (yearMatch) {
                year = parseInt(yearMatch[1]);
                title = cleanSegment.replace(/\s*\(\d{4}\)\s*/, "").trim();
              } else {
                title = cleanSegment;
              }
            }
            break;
          }
        }

        // If no folder with year found, try fallback
        if (!folderName) {
          const yearMatch = asset.path?.match(/\((\d{4})\)/);
          if (yearMatch) {
            year = parseInt(yearMatch[1]);
          }

          // Try to extract title from last folder/file segment
          if (pathSegments && pathSegments.length > 0) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            // Check if it's a file (has extension)
            const isFile = lastSegment.match(/\.[^.]+$/);
            const folderSegment =
              isFile && pathSegments.length > 1
                ? pathSegments[pathSegments.length - 2]
                : lastSegment;

            folderName = folderSegment;

            // Remove year and ALL ID tags (in various bracket formats), and file extension
            // Filters: {tmdb-123}, [tvdb-456], (imdb-tt123), (xxx-yyy), etc.
            const cleanTitle = folderSegment
              .replace(/\s*\(\d{4}\)\s*/, "")
              .replace(/\s*\{[^}]+\}/g, "") // Remove {xxx-yyy}
              .replace(/\s*\[[^\]]+\]/g, "") // Remove [xxx-yyy]
              .replace(/\s*\((tmdb|tvdb|imdb)-[^)]+\)/gi, "") // Remove (tmdb-xxx), (tvdb-xxx), (imdb-xxx)
              .replace(/\s*\([a-z]+-[^)]+\)/gi, "") // Remove generic (xxx-yyy) format
              .replace(/\.[^.]+$/, "")
              .trim();
            if (cleanTitle) {
              title = cleanTitle;
            }
          }
        }
      }
    }
    // Extract season/episode numbers
    // Priority 1: From asset path (absolute truth for specific files like S01E01)
    // Priority 2: From DB Title field (fallback)
    let seasonNumber = null;
    let episodeNumber = null;

    // First try the path
    const pathSeasonMatch = asset.path?.match(/Season\s*(\d+)/i);
    const pathEpisodeMatch = asset.path?.match(/S(\d+)E(\d+)/i);

    if (pathSeasonMatch) {
      seasonNumber = parseInt(pathSeasonMatch[1]);
    }
    if (pathEpisodeMatch) {
      if (seasonNumber === null) seasonNumber = parseInt(pathEpisodeMatch[1]);
      episodeNumber = parseInt(pathEpisodeMatch[2]);
    }

    // Fallback: Extract from DB Title field if path didn't have it
    if (seasonNumber === null || episodeNumber === null) {
      const dbTitle = dbData?.Title || "";
      if (dbTitle) {
        const dbSeasonMatch = dbTitle.match(/Season\s*(\d+)/i);
        const dbEpisodeMatch = dbTitle.match(/S(\d+)E(\d+)/i);

        if (dbSeasonMatch && seasonNumber === null) {
          seasonNumber = parseInt(dbSeasonMatch[1]);
          console.log(`Season number from DB Title '${dbTitle}': ${seasonNumber}`);
        }
        if (dbEpisodeMatch) {
          if (seasonNumber === null) seasonNumber = parseInt(dbEpisodeMatch[1]);
          if (episodeNumber === null) episodeNumber = parseInt(dbEpisodeMatch[2]);
          console.log(`Episode info from DB Title '${dbTitle}': S${seasonNumber}E${episodeNumber}`);
        }
      }
    }
    // Only override title if it's NOT a season or titlecard, as their DB Title
    // contains extra info (e.g., "Show | Season 01" or "S01E01 | Episode")
    if (dbData?.Title) {
      if (assetType === "season") {
        // If it's a season and contains "|", grab the right side (e.g., "Season 1")
        if (dbData.Title.includes("|")) {
          showTitle = dbData.Title.split("|")[0].trim();
          title = dbData.Title.split("|")[1].trim();
          console.log(`Extracted Season Title from DB: ${title }`);
        } else {
          // Fallback: use "Season" + the raw number (no leading zero)
          title = seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;
        }
      } else if (assetType === "titlecard") {
        if (dbData.Title.includes("|")) {
          showTitle = dbData.Title.split("|")[0].trim();
        }
      } else if (assetType !== "titlecard") {
        // Standard override for Movies/Shows, skipping titlecards
        title  = dbData.Title;
        console.log(`Using Title from database: ${title }`);
      }
    }
    if (dbData?.year) {
      year = parseInt(dbData.year);
      console.log(`Using Year from database: ${year}`);
    }

    // Determine mediaType
    const backendAssetType = (asset.type || "").toLowerCase();
    const dbType = (dbData?.Type || "").toLowerCase();
    const libName = (libraryName || "").toLowerCase(); // Corrected variable name

    let mediaType = "movie"; // Default fallback

    // 1. STRICT DATABASE CHECK (Primary Source of Trust)
    if (dbType.includes("movie")) {
      mediaType = "movie";
      console.log("MediaType strictly determined by DB: movie");
    } else if (dbType.includes("show") || dbType.includes("series")) {
      mediaType = "tv";
      console.log("MediaType strictly determined by DB: tv");
    }
    // 2. HEURISTIC FALLBACK (Only used if DB data is missing/inconclusive)
    else if (
      backendAssetType.includes("show") ||
      backendAssetType.includes("season") ||
      backendAssetType.includes("episode") ||
      assetType === "season" ||
      assetType === "titlecard" ||
      libName.includes("tv") ||
      libName.includes("show") ||
      libName.includes("series") ||
      libName.includes("serier")
    ) {
      mediaType = "tv";
      console.log(`MediaType determined by fallback heuristics: ${mediaType}`);
    } else {
      console.log(`Defaulting to: ${mediaType}`);
    }

    console.log(`Backend asset.type: '${backendAssetType}'`);
    console.log(`DB data Type: '${dbType}'`);
    console.log(`Library Name: '${libName}'`);
    console.log(`Derived mediaType: '${mediaType}'`);

    // Priority 1: Use provider IDs from database (most reliable source of truth)
    // Database fields: tmdbid, tvdbid, imdbid (from ImageChoices.db)
    if (dbData?.tmdbid) {
      tmdb_id = dbData.tmdbid;
      console.log(`Using TMDB ID from database: ${tmdb_id}`);
    }
    if (dbData?.tvdbid) {
      tvdb_id = dbData.tvdbid;
      console.log(`Using TVDB ID from database: ${tvdb_id}`);
    }
    // IMDB ID from database (if available)
    if (dbData?.imdbid && !imdb_id) {
      imdb_id = dbData.imdbid;
      console.log(`Using IMDB ID from database: ${imdb_id}`);
    }

    // Priority 2: Fallback to extracting IDs from folder name if not in database
    // Supports formats: {tmdb-123}, [tmdb-123], (tmdb-123), {tvdb-456}, [tvdb-456], {imdb-tt123}, etc.
    if (folderName) {
      // TMDB ID - match various bracket formats (only if not already set from DB)
      if (!tmdb_id) {
        const tmdbMatch = folderName.match(/[\[{(]tmdb-(\d+)[\]})]/i);
        if (tmdbMatch) {
          tmdb_id = tmdbMatch[1];
          console.log(`Extracted TMDB ID from folder: ${tmdb_id}`);
        }
      }

      // TVDB ID - match various bracket formats (only if not already set from DB)
      if (!tvdb_id) {
        const tvdbMatch = folderName.match(/[\[{(]tvdb-(\d+)[\]})]/i);
        if (tvdbMatch) {
          tvdb_id = tvdbMatch[1];
          console.log(`Extracted TVDB ID from folder: ${tvdb_id}`);
        }
      }

      // IMDB ID - match various bracket formats (format: tt1234567)
      // Note: IMDB ID typically not in database, so always check folder
      if (!imdb_id) {
        const imdbMatch = folderName.match(/[\[{(]imdb-(tt\d+)[\]})]/i);
        if (imdbMatch) {
          imdb_id = imdbMatch[1];
          console.log(`Extracted IMDB ID from folder: ${imdb_id}`);
        }
      }
    }

    // If collection, try stripping "Collection" from title for better TMDB/Fanart search
    if (assetType === "collection" && title) {
      title = title.replace(/\s*Collection$/i, "").trim();
      if (showTitle) {
        showTitle = showTitle.replace(/\s*Collection$/i, "").trim();
      }
    }

    const metadata = {
      tmdb_id: tmdb_id,
      tvdb_id: tvdb_id,
      imdb_id: imdb_id,
      title: title,
      show_title: showTitle,
      year: year,
      folder_name: folderName,
      library_name: libraryName,
      media_type: mediaType,
      asset_type: assetType,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    };

    console.log("=== Extracted Metadata ===");
    console.log("Title:", title);
    console.log("Year:", year);
    console.log("Folder Name:", folderName);
    console.log("Library Name:", libraryName);
    console.log("TMDB ID:", tmdb_id);
    console.log("TVDB ID:", tvdb_id);
    console.log("IMDB ID:", imdb_id);
    console.log("Media Type:", mediaType);
    console.log("Asset Type:", assetType);
    console.log("Season Number:", seasonNumber);
    console.log("Episode Number:", episodeNumber);
    console.log("==========================");

    return metadata;
  };

  // Determine if we should use horizontal layout (backgrounds and titlecards)
  // Use useMemo to recalculate metadata only when asset or dbData changes
  const metadata = React.useMemo(() => extractMetadata(), [asset, dbData]);
  const useHorizontalLayout =
    metadata.asset_type === "background" || metadata.asset_type === "titlecard";

  // Manual search state - initialize with detected metadata
  const [manualSearch, setManualSearch] = useState(false);
  const [searchTitle, setSearchTitle] = useState("");
  const [searchYear, setSearchYear] = useState("");

  // Check if Posterizarr is running on component mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/status`);
        if (response.ok) {
          const data = await response.json();
          setIsPosterizarrRunning(data.running || false);

          if (data.running) {
            console.log(
              "Posterizarr is currently running, replacement operations will be blocked"
            );
          }
        }
      } catch (error) {
        console.error("Error checking Posterizarr status:", error);
      }
    };

    checkStatus();
    // Poll status every 3 seconds while component is mounted
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Update search fields when metadata changes (when switching assets)
  useEffect(() => {
    setSearchTitle(metadata.title || "");
    setSearchYear(metadata.year ? String(metadata.year) : "");
    // Reset previews when switching to a new asset
    setPreviews({ tmdb: [], tvdb: [], fanart: [] });
    setSelectedPreview(null);
  }, [metadata]);

  // Handle Logo Fetching with FavProvider priority AND LogoLanguageOrder
  const handleFetchLogos = async () => {
    console.log("=== Fetching Logos ===");
    setLogoSelectionMode(true);
    setLoading(true);

    const logoMetadata = {
      ...metadata,
      asset_type: "logo",
    };

    try {
      // ----------------------------------------------------------------------
      // 1. Fetch User Config (FavProvider & LogoLanguageOrder)
      // ----------------------------------------------------------------------
      let userFavProvider = "fanart"; // Default fallback
      let languageOrderList = [];

      try {
        const configResponse = await fetch(`${API_URL}/config`);
        if (configResponse.ok) {
          const configData = await configResponse.json();
          // Handle flat or grouped config structure
          const cfg = configData.config || {};
          const apiPart = cfg.ApiPart || {};

          // A) Get FavProvider
          const provider = cfg.FavProvider || cfg.favprovider || apiPart.FavProvider || apiPart.favprovider;
          if (provider) {
            const p = provider.toLowerCase();
            if (p.includes("tmdb")) userFavProvider = "tmdb";
            else if (p.includes("tvdb")) userFavProvider = "tvdb";
            else if (p.includes("fanart")) userFavProvider = "fanart";
          }

          // B) Get LogoLanguageOrder (Handle Array or String)
          const rawOrder = cfg.LogoLanguageOrder || apiPart.LogoLanguageOrder;

          if (Array.isArray(rawOrder)) {
            languageOrderList = rawOrder.map(lang => lang.trim().toLowerCase());
          } else if (typeof rawOrder === 'string' && rawOrder) {
            languageOrderList = rawOrder.split(",").map(lang => lang.trim().toLowerCase());
          }

          if (languageOrderList.length > 0) {
            console.log("Applying Logo Language Order:", languageOrderList);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch config for logo preference:", e);
      }

      // ----------------------------------------------------------------------
      // 2. Fetch Replacements
      // ----------------------------------------------------------------------
      const response = await fetch(`${API_URL}/assets/fetch-replacements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_path: asset.path,
          ...logoMetadata,
        }),
      });

      const data = await response.json();
      if (data.success) {
        let results = {
          tmdb: data.results.tmdb || [],
          tvdb: data.results.tvdb || [],
          fanart: data.results.fanart || [],
        };

        // --------------------------------------------------------------------
        // 3. Filter & Sort by LogoLanguageOrder (STRICT MODE)
        // --------------------------------------------------------------------
        if (languageOrderList.length > 0) {
          const processLogos = (logoList) => {
            if (!logoList) return [];

            // A) Filter: REMOVE logos not in the allowed list
            const filtered = logoList.filter(logo => {
              const logoLang = (logo.language || "xx").toLowerCase();
              return languageOrderList.includes(logoLang);
            });

            // B) Sort: Order exactly as they appear in LogoLanguageOrder
            return filtered.sort((a, b) => {
              const langA = (a.language || "xx").toLowerCase();
              const langB = (b.language || "xx").toLowerCase();
              return languageOrderList.indexOf(langA) - languageOrderList.indexOf(langB);
            });
          };

          // Apply to all providers
          results.tmdb = processLogos(results.tmdb);
          results.tvdb = processLogos(results.tvdb);
          results.fanart = processLogos(results.fanart);
        }

        setPreviews(results);

        // --------------------------------------------------------------------
        // 4. Determine Active Provider
        // --------------------------------------------------------------------
        let activeProvider = userFavProvider;

        // Fallback if preferred provider has no logos (after filtering)
        if (!results[activeProvider] || results[activeProvider].length === 0) {
          if (results.fanart.length > 0) activeProvider = "fanart";
          else if (results.tmdb.length > 0) activeProvider = "tmdb";
          else if (results.tvdb.length > 0) activeProvider = "tvdb";
        }

        // Check if we have any results at all
        const totalResults = results.tmdb.length + results.tvdb.length + results.fanart.length;

        if (totalResults > 0) {
          setActiveProviderTab(activeProvider);
          setActiveTab("previews");
        } else {
          // If 0 results, check if it was due to strict filtering
          if (languageOrderList.length > 0) {
            showError(t("assetReplacer.noLogosMatchingLanguages", { languages: languageOrderList.join(", ") }));
          } else {
            showError(t("assetReplacer.fetchPreviewsError"));
          }
          // Stay on upload tab or handle as prefered
          setLogoSelectionMode(false);
        }

      } else {
        showError(t("assetReplacer.fetchPreviewsError"));
        setLogoSelectionMode(false);
      }
    } catch (err) {
      showError(err.message);
      setLogoSelectionMode(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoSelect = (preview) => {
    setManualForm((prev) => ({
      ...prev,
      titletext: preview.original_url,
    }));
    setActiveTab("upload");
    setLogoSelectionMode(false);
    showInfo(t("assetReplacer.logoApplied"));
  };

  // Fetch language order preferences from config
  useEffect(() => {
    const fetchLanguageOrder = async () => {
      try {
        const response = await fetch(`${API_URL}/config`);
        if (response.ok) {
          const data = await response.json();

          // Handle both flat and grouped config structures
          let configSource;
          if (data.using_flat_structure) {
            // Flat structure: config keys are directly in data.config
            configSource = data.config || {};
            console.log("Using flat config structure");
          } else {
            // Grouped structure: config keys are under ApiPart
            configSource = data.config?.ApiPart || data.ApiPart || {};
            console.log("Using grouped config structure");
          }

          // Extract Season Poster Name overrides
          let overrideSeasonNameVal = false;
          let seasonOverrideTextVal = "Staffel";
          let specialSeasonOverrideTextVal = "Spezial";

          if (data.using_flat_structure) {
            const flatConfig = data.config || {};
            overrideSeasonNameVal = flatConfig.SeasonPosterOverrideSeasonName;
            seasonOverrideTextVal = flatConfig.SeasonPosterSeasonOverrideText || "Staffel";
            specialSeasonOverrideTextVal = flatConfig.SeasonPosterSpecialSeasonOverrideText || "Spezial";
          } else {
            const seasonPart = data.config?.SeasonPosterOverlayPart || data.SeasonPosterOverlayPart || {};
            overrideSeasonNameVal = seasonPart.OverrideSeasonName;
            seasonOverrideTextVal = seasonPart.SeasonOverrideText || "Staffel";
            specialSeasonOverrideTextVal = seasonPart.SpecialSeasonOverrideText || "Spezial";
          }

          // Handle string versions of booleans
          const isOverrideEnabled = overrideSeasonNameVal === true || overrideSeasonNameVal === "true";

          setOverrideSeasonName(isOverrideEnabled);
          setSeasonOverrideText(seasonOverrideTextVal);
          setSpecialSeasonOverrideText(specialSeasonOverrideTextVal);

          // Process PreferredBackgroundLanguageOrder - handle "PleaseFillMe"
          let backgroundOrder =
            configSource.PreferredBackgroundLanguageOrder ||
            configSource.preferredbackgroundlanguageorder ||
            [];

          let posterOrder =
            configSource.PreferredLanguageOrder ||
            configSource.preferredlanguageorder ||
            [];

          let seasonOrder =
            configSource.PreferredSeasonLanguageOrder ||
            configSource.preferredseasonlanguageorder ||
            [];

          let tcOrder =
            configSource.PreferredTCLanguageOrder ||
            configSource.preferredtclanguageorder ||
            [];

          if (
            backgroundOrder.length === 1 &&
            backgroundOrder[0] === "PleaseFillMe"
          ) {
            // Use poster language order as fallback
            backgroundOrder = posterOrder;
          }

          if (tcOrder.length === 1 && tcOrder[0] === "PleaseFillMe") {
            // Use poster language order as fallback
            tcOrder = posterOrder;
          }

          setLanguageOrder({
            poster: posterOrder,
            background: backgroundOrder,
            season: seasonOrder,
            titlecard: tcOrder,
          });

          console.log("Loaded language preferences:", {
            poster: posterOrder,
            background: backgroundOrder,
            season: seasonOrder,
            titlecard: tcOrder,
            rawBackground: configSource.PreferredBackgroundLanguageOrder,
            rawTitleCard: configSource.PreferredTCLanguageOrder,
          });
        }
      } catch (error) {
        console.error("Error fetching language order config:", error);
      }
    };

    fetchLanguageOrder();
  }, []);

  // Fetch database data if not provided (e.g., when opened from FolderView)
  useEffect(() => {
    // Determine what kind of asset we are dealing with based on the path
    const assetPathLower = asset?.path?.toLowerCase() || "";
    const isTitleCard = assetPathLower.includes("titlecard") || /s\d+e\d+/i.test(assetPathLower);
    const isSeason = assetPathLower.includes("season") && !isTitleCard;
    const isBackground = assetPathLower.includes("background");

    // Extract target season and episode from path to find EXACT matches
    const targetSeason = assetPathLower.match(/s(\d+)e\d+/i)?.[1] || assetPathLower.match(/season\s*(\d+)/i)?.[1];
    const targetEpisode = assetPathLower.match(/s\d+e(\d+)/i)?.[1];

    // Helper function to find a match in a list of records
    const findMatch = (records, libraryName, rootfolder) => {
      const libraryMatchingRecords = records.filter(
        (r) =>
          (r.LibraryName && r.LibraryName === libraryName) ||
          (r.library_name && r.library_name === libraryName)
      );

      const rootfolderMatchingRecords = libraryMatchingRecords.filter(
        (r) =>
          (r.Rootfolder && r.Rootfolder === rootfolder) ||
          (r.root_foldername && r.root_foldername === rootfolder)
      );

      if (rootfolderMatchingRecords.length === 0) return null;

      // Prioritize dynamically based on the SPECIFIC asset type!
      if (isTitleCard) {
        // 1. EXACT EPISODE MATCH
        if (targetSeason !== undefined && targetEpisode !== undefined) {
           const exactMatch = rootfolderMatchingRecords.find(r => {
             const title = r.Title || "";
             const match = title.match(/S(\d+)E(\d+)/i);
             if (match) {
                return parseInt(match[1]) === parseInt(targetSeason) && parseInt(match[2]) === parseInt(targetEpisode);
             }
             return false;
           });
           if (exactMatch) return exactMatch;
        }

        // 2. Fallback
        return (
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Episode") || r.Type?.includes("TitleCard")) ||
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Show") || r.Type?.includes("Movie") || r.library_type?.includes("show")) ||
          rootfolderMatchingRecords[0]
        );
      } else if (isSeason) {
        return (
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Season") && !r.Type?.includes("Episode")) ||
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Show") || r.Type?.includes("Movie") || r.library_type?.includes("show")) ||
          rootfolderMatchingRecords[0]
        );
      } else if (isBackground) {
        return (
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Background")) ||
          rootfolderMatchingRecords.find((r) => r.Type?.includes("Show") || r.Type?.includes("Movie") || r.library_type?.includes("show")) ||
          rootfolderMatchingRecords[0]
        );
      }

      // Default fallback (Posters) -> Prioritize Show/Movie
      return (
        rootfolderMatchingRecords.find(
          (r) =>
            (r.Type?.includes("Show") || r.Type?.includes("Movie")) ||
            (r.library_type?.includes("show") || r.library_type?.includes("movie"))
        ) ||
        rootfolderMatchingRecords[0]
      );
    };

    const normalizeMediaExportData = (record) => {
      if (!record) return null;
      return {
        LibraryName: record.library_name,
        Rootfolder: record.root_foldername,
        Title: record.title,
        Type: record.library_type,
        tmdbid: record.tmdbid,
        tvdbid: record.tvdbid,
        imdbid: record.imdbid,
        year: record.year,
      };
    };

    const fetchDatabaseData = async () => {
      // Detect if the DB data we currently hold is for the WRONG episode
      let isWrongEpisode = false;
      if (isTitleCard && dbData && targetSeason !== undefined && targetEpisode !== undefined) {
        const dbEpMatch = (dbData.Title || "").match(/S(\d+)E(\d+)/i);
        if (dbEpMatch) {
           if (parseInt(dbEpMatch[1]) !== parseInt(targetSeason) || parseInt(dbEpMatch[2]) !== parseInt(targetEpisode)) {
              isWrongEpisode = true;
           }
        }
      }

      // We need data if we have the wrong episode, OR if we are missing the EpisodeTitle
      const needsEpisodeData = isTitleCard && (isWrongEpisode || !dbData?.EpisodeTitle) && !dbData?._attemptedEpisodeFetch;

      if (dbData !== null && !needsEpisodeData) {
        console.log("Already have adequate database data, skipping fetch");
        return;
      }

      // --- Parse Path ---
      const pathParts = asset.path?.split(/[\/\\]/).filter(Boolean);
      if (!pathParts || pathParts.length < 2) return;
      const libraryName = pathParts[0];
      const rootfolder = pathParts[1];
      // --- End Parse Path ---

      try {
        let response;

        // Only check Plex Export if we don't already have dbData
        if (!dbData) {
          console.log("Checking Plex Export DB (/api/plex-export/library)...");
          response = await fetch(`${API_URL}/plex-export/library`);
          if (response.ok) {
            const plexData = await response.json();
            if (plexData.success && plexData.data) {
              const matchingRecord = findMatch(plexData.data, libraryName, rootfolder);
              if (matchingRecord) {
                setDbData(normalizeMediaExportData(matchingRecord));
                if (!isTitleCard) return;
              }
            }
          }
        }

        // Only check Other Media Export (Jellyfin/Emby) if we don't already have dbData
        if (!dbData) {
          console.log("Checking Other Media Export DB (/api/other-media-export/library)...");
          response = await fetch(`${API_URL}/other-media-export/library`);
          if (response.ok) {
            const otherData = await response.json();
            if (otherData.success && otherData.data) {
              const matchingRecord = findMatch(otherData.data, libraryName, rootfolder);
              if (matchingRecord) {
                setDbData(normalizeMediaExportData(matchingRecord));
                if (!isTitleCard) return;
              }
            }
          }
        }

        // --- Try ImageChoices (Posterizarr DB) ---
        console.log("Checking ImageChoices DB for Asset specific info...");
        response = await fetch(`${API_URL}/imagechoices`);
        if (response.ok) {
          const allRecords = await response.json();
          const matchingRecord = findMatch(allRecords, libraryName, rootfolder);

          if (matchingRecord) {
            console.log("✓ Found matching record in ImageChoices DB:", matchingRecord);
            // Merge records to overwrite the wrong episode title with the newly found correct one
            setDbData((prev) => ({
                ...prev,
                ...matchingRecord,
                _attemptedEpisodeFetch: true
            }));
            return;
          }
        }

        if (needsEpisodeData) {
            setDbData(prev => ({ ...prev, _attemptedEpisodeFetch: true }));
        }

      } catch (error) {
        console.error("Error fetching database data:", error);
      }
    };

    fetchDatabaseData();
  }, [asset.path, dbData]);

  // Load custom blueprints
  useEffect(() => {
    fetch("/api/custom-blueprints")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCustomBlueprints(data);
        }
      })
      .catch(e => console.error("Failed to fetch custom blueprints", e));
  }, []);

  // Initialize season number from metadata
  useEffect(() => {
    // Check if season_number exists (including 0 for specials)
    if (metadata.season_number !== null && metadata.season_number !== undefined) {
      if (metadata.asset_type === "season") {
        // Always format as standard "Season X" or "Specials" for folder/file structure
        const standardSeasonNum = metadata.season_number === 0 ? "Specials" : `Season ${metadata.season_number}`;

        setManualForm((prev) => ({
          ...prev,
          seasonPosterName: standardSeasonNum,
        }));
        setManualSearchForm((prev) => ({
          ...prev,
          seasonNumber: String(metadata.season_number),
        }));
      } else if (metadata.asset_type === "titlecard") {
        const seasonNum = String(metadata.season_number).padStart(2, "0");
        setManualForm((prev) => ({
          ...prev,
          seasonPosterName: seasonNum,
        }));
        setManualSearchForm((prev) => ({
          ...prev,
          seasonNumber: String(metadata.season_number),
        }));
      }
    }
  }, [metadata.season_number, metadata.asset_type]);

  // Initialize episode data from metadata (for titlecards)
  useEffect(() => {
    if (metadata.episode_number) {
      const episodeNum = String(metadata.episode_number).padStart(2, "0");

      let episodeTitleName = "";
      const dbTitle = dbData?.Title || "";

      // Try to parse from the "S01E01 | The Title" format
      if (dbTitle && dbTitle.includes("|")) {
        const parts = dbTitle.split("|");
        if (parts.length >= 2) {
          episodeTitleName = parts[1].trim();
          console.log(`Episode title parsed from DB Title: '${episodeTitleName}'`);
        }
      }
      // Fallback: Check if it's explicitly stored as EpisodeTitle
      else if (dbData?.EpisodeTitle) {
        episodeTitleName = dbData.EpisodeTitle;
        console.log(`Episode title from DB field: '${episodeTitleName}'`);
      }

      setManualForm((prev) => ({
        ...prev,
        episodeNumber: episodeNum,
        episodeTitleName: episodeTitleName || prev.episodeTitleName,
      }));
      setManualSearchForm((prev) => ({
        ...prev,
        episodeNumber: String(metadata.episode_number),
      }));
    }
  }, [metadata.episode_number, dbData]);

  // Initialize title text from metadata
  useEffect(() => {
    if (metadata.title) {
      let finalTitle = metadata.title;
      if (metadata.asset_type === "season" && overrideSeasonName) {
        if (metadata.season_number !== null && metadata.season_number !== undefined) {
          if (metadata.season_number === 0) {
            finalTitle = specialSeasonOverrideText;
          } else {
            finalTitle = `${seasonOverrideText} ${metadata.season_number}`;
          }
        }
      }
      setManualForm((prev) => ({
        ...prev,
        titletext: finalTitle,
        foldername: metadata.folder_name || "",
        libraryname: metadata.library_name || "",
      }));
    }
  }, [
    metadata.title,
    metadata.folder_name,
    metadata.library_name,
    metadata.asset_type,
    metadata.season_number,
    overrideSeasonName,
    seasonOverrideText,
    specialSeasonOverrideText
  ]);

  const handleFetchClick = () => {
    console.log("=== AssetReplacer: Fetch Button Clicked ===");

    // Validation
    let metadata = extractMetadata();

    if (manualSearch) {
      console.log("Using manual search mode");
      if (!searchTitle.trim()) {
        console.warn("Manual search: No title provided");
        showError(t("assetReplacer.enterTitleError"));
        return;
      }

      metadata = {
        ...metadata,
        title: searchTitle.trim(),
        show_title: searchTitle.trim(),
        year: searchYear ? parseInt(searchYear) : null,
        tmdb_id: null,
        tvdb_id: null,
        imdb_id: null,
        season_number: manualSearchForm.seasonNumber
          ? parseInt(manualSearchForm.seasonNumber)
          : metadata.season_number,
        episode_number: manualSearchForm.episodeNumber
          ? parseInt(manualSearchForm.episodeNumber)
          : metadata.episode_number,
      };
    }

    setPendingFetchParams({ metadata, manualSearch });
    setShowFetchConfirm(true);
  };

  const fetchPreviews = async () => {
    console.log("=== AssetReplacer: Fetching Previews ===");
    setShowFetchConfirm(false);

    if (!pendingFetchParams) {
      console.error("No pending fetch params found!");
      return;
    }

    const { metadata, manualSearch: isManualSearch } = pendingFetchParams;
    console.log("Fetch params:", { metadata, isManualSearch });

    setLoading(true);
    showError(null);

    try {
      const response = await fetch(`${API_URL}/assets/fetch-replacements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asset_path: asset.path,
          is_manual_search: isManualSearch,
          ...metadata,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const results = {
          tmdb: data.results.tmdb || [],
          tvdb: data.results.tvdb || [],
          fanart: data.results.fanart || [],
        };

        setPreviews(results);
        showSuccess(
          t("assetReplacer.foundReplacements", {
            count: data.total_count,
            sources: Object.keys(results).filter((k) => results[k].length > 0)
              .length,
          })
        );

        if (results.tmdb.length > 0) setActiveProviderTab("tmdb");
        else if (results.tvdb.length > 0) setActiveProviderTab("tvdb");
        else if (results.fanart.length > 0) setActiveProviderTab("fanart");

        setActiveTab("previews");
      } else {
        console.error("API returned error:", data.error || "Unknown error");
        showError(t("assetReplacer.fetchPreviewsError"));
      }
    } catch (err) {
      console.error("✗ Error fetching previews:", err);
      showError(
        t("assetReplacer.errorFetchingPreviews", { error: err.message })
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showError(t("assetReplacer.selectImageError"));
      return;
    }

    setUploadedFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImage(reader.result);

      const img = new Image();
      img.onload = () => {
        const width = img.width;
        const height = img.height;
        setImageDimensions({ width, height });

        const POSTER_RATIO = 2 / 3;
        const BACKGROUND_RATIO = 16 / 9;
        const TOLERANCE = 0.05;

        if (height === 0) {
          setIsDimensionValid(false);
          showError(
            t("assetReplacer.imageHeightZero", "Image height cannot be zero.")
          );
          return;
        }

        const imageRatio = width / height;
        let isValid = false;
        let expectedRatio = 0;
        let expectedRatioString = "";

        if (
          metadata.asset_type === "poster" ||
          metadata.asset_type === "season"
        ) {
          expectedRatio = POSTER_RATIO;
          expectedRatioString = "2:3";
          isValid = Math.abs(imageRatio - POSTER_RATIO) <= TOLERANCE;
        } else {
          expectedRatio = BACKGROUND_RATIO;
          expectedRatioString = "16:9";
          isValid = Math.abs(imageRatio - BACKGROUND_RATIO) <= TOLERANCE;
        }

        setIsDimensionValid(isValid);

        if (!isValid) {
          showError(
            t("assetReplacer.invalidImageRatio", {
              width,
              height,
              ratio: imageRatio.toFixed(3),
              expectedRatioString: expectedRatioString,
              expectedRatio: expectedRatio.toFixed(3),
            })
          );
        } else {
          showSuccess(
            t("assetReplacer.imageDimensionsValid", { width, height })
          );
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    if (!uploadedFile || !isDimensionValid) {
      showError(t("assetReplacer.selectValidImage"));
      return;
    }

    if (isPosterizarrRunning && !addToQueue) {
      showError(t("assetReplacer.posterizarrRunningError"));
      return;
    }

    setShowUploadConfirm(true);
  };

  const handleConfirmUpload = async () => {
    setShowUploadConfirm(false);
    setUploading(true);
    showError(null);

    try {
      let url = `${API_URL}/assets/upload-replacement?asset_path=${encodeURIComponent(
        asset.path
      )}&process_with_overlays=${processWithOverlays}&add_to_queue=${addToQueue}&asset_type=${encodeURIComponent(metadata.asset_type)}&mediaType=${encodeURIComponent(metadata.mediaType)}`;

      if (processWithOverlays && blueprintId && blueprintId !== "none") {
        const bp = [...BLUEPRINTS, ...customBlueprints].find(b => b.id === blueprintId);
        if (bp && bp.updates?.nested) {
          const bpName = bp.customTitle || (bp.titleKey ? t(bp.titleKey) : bp.id);
          const overridesWithContext = { ...bp.updates.nested, ActiveBlueprintName: bpName };
          url += `&blueprint_overrides=${encodeURIComponent(JSON.stringify(overridesWithContext))}`;
        }
      }

      if (processWithOverlays) {
        const titleText = manualForm?.titletext ?? metadata.title;
        const folderName = manualForm?.foldername || metadata.folder_name;
        const libraryName = manualForm?.libraryname || metadata.library_name;

        if (titleText === undefined || titleText === null) {
          showError(t("assetReplacer.enterTitleTextError"));
          setUploading(false);
          return;
        }
        if (!folderName || !folderName.trim()) {
          showError(t("assetReplacer.enterFolderNameError"));
          setUploading(false);
          return;
        }
        if (!libraryName || !libraryName.trim()) {
          showError(t("assetReplacer.enterLibraryNameError"));
          setUploading(false);
          return;
        }

        url += `&title_text=${encodeURIComponent(titleText)}`;
        url += `&folder_name=${encodeURIComponent(folderName)}`;
        url += `&library_name=${encodeURIComponent(libraryName)}`;

        if (metadata.asset_type === "season") {
          const seasonPosterName = manualForm?.seasonPosterName;
          if (!seasonPosterName || !seasonPosterName.trim()) {
            showError(t("assetReplacer.enterSeasonNumberError"));
            setUploading(false);
            return;
          }
          url += `&season_number=${encodeURIComponent(seasonPosterName)}`;
        }

        if (metadata.asset_type === "titlecard") {
          const episodeNumber = manualForm?.episodeNumber;
          const episodeTitleName = manualForm?.episodeTitleName;

          if (!episodeNumber || !episodeNumber.trim()) {
            showError(t("assetReplacer.enterEpisodeNumberError"));
            setUploading(false);
            return;
          }
          if (!episodeTitleName || !episodeTitleName.trim()) {
            showError(t("assetReplacer.enterEpisodeTitleError"));
            setUploading(false);
            return;
          }

          url += `&episode_number=${encodeURIComponent(episodeNumber)}`;
          url += `&episode_title=${encodeURIComponent(episodeTitleName)}`;
        }
      }

      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("asset_type", metadata.asset_type);

      // Append posterWithText
      formData.append("posterWithText", uploadHasText);

      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        if (data.manual_run_triggered) {
          showSuccess(t("assetReplacer.replacedAndQueued"));
          if (!addToQueue) {
            window.dispatchEvent(new Event("assetReplaced"));
          }
          if (onSuccess) await onSuccess(!addToQueue);
          onClose();
        } else {
          showSuccess(t("assetReplacer.replacedSuccessfully"));
          if (!addToQueue) {
            window.dispatchEvent(new Event("assetReplaced"));
          }
          setTimeout(async () => {
            if (onSuccess) await onSuccess(!addToQueue);
            onClose();
          }, 2000);
        }
      } else {
        showError(t("assetReplacer.uploadError"));
      }
    } catch (err) {
      showError(t("assetReplacer.errorUploadingFile", { error: err.message }));
    } finally {
      setUploading(false);
    }
  };

  const handlePreviewClick = (preview) => {
    if (logoSelectionMode) {
      handleLogoSelect(preview);
      return;
    }

    if (isPosterizarrRunning && !addToQueue) {
      showError(t("assetReplacer.posterizarrRunningError"));
      return;
    }

    setPendingPreview(preview);
    setShowPreviewConfirm(true);
  };

  const handleSelectPreview = async () => {
    setShowPreviewConfirm(false);
    const preview = pendingPreview;

    if (!preview) return;

    setUploading(true);
    showError(null);

    // Validation
    if (
      processWithOverlays &&
      (metadata.asset_type === "poster" || metadata.asset_type === "background")
    ) {
      const titleText = manualForm?.titletext ?? metadata.title;
      const folderName = manualForm?.foldername || metadata.folder_name;
      const libraryName = manualForm?.libraryname || metadata.library_name;

      if (titleText === undefined || titleText === null) {
        showError(t("assetReplacer.enterTitleTextError"));
        setUploading(false);
        return;
      }
      if (!folderName || !folderName.trim()) {
        showError(t("assetReplacer.enterFolderNameError"));
        setUploading(false);
        return;
      }
      if (!libraryName || !libraryName.trim()) {
        showError(t("assetReplacer.enterLibraryNameError"));
        setUploading(false);
        return;
      }
    }

    // Validation for season posters
    if (processWithOverlays && metadata.asset_type === "season") {
      const titleText = manualForm?.titletext ?? metadata.title;
      const folderName = manualForm?.foldername || metadata.folder_name;
      const libraryName = manualForm?.libraryname || metadata.library_name;
      const seasonPosterName = manualForm?.seasonPosterName;

      if (titleText === undefined || titleText === null) {
        showError(t("assetReplacer.enterTitleTextError"));
        setUploading(false);
        return;
      }
      if (!folderName || !folderName.trim()) {
        showError(t("assetReplacer.enterFolderNameError"));
        setUploading(false);
        return;
      }
      if (!libraryName || !libraryName.trim()) {
        showError(t("assetReplacer.enterLibraryNameError"));
        setUploading(false);
        return;
      }
      if (!seasonPosterName || !seasonPosterName.trim()) {
        showError(t("assetReplacer.enterSeasonPosterNameError"));
        setUploading(false);
        return;
      }
    }

    // Validation for title cards
    if (processWithOverlays && metadata.asset_type === "titlecard") {
      const folderName = manualForm?.foldername || metadata.folder_name;
      const libraryName = manualForm?.libraryname || metadata.library_name;
      const seasonPosterName = manualForm?.seasonPosterName;
      const episodeNumber = manualForm?.episodeNumber;
      const episodeTitleName = manualForm?.episodeTitleName;

      if (!folderName || !folderName.trim()) {
        showError(t("assetReplacer.enterFolderNameError"));
        setUploading(false);
        return;
      }
      if (!libraryName || !libraryName.trim()) {
        showError(t("assetReplacer.enterLibraryNameError"));
        setUploading(false);
        return;
      }
      if (!seasonPosterName || !seasonPosterName.trim()) {
        showError(t("assetReplacer.enterSeasonPosterNameError"));
        setUploading(false);
        return;
      }
      if (!episodeNumber || !episodeNumber.trim()) {
        showError(t("assetReplacer.enterEpisodeNumberError"));
        setUploading(false);
        return;
      }
      if (!episodeTitleName || !episodeTitleName.trim()) {
        showError(t("assetReplacer.enterEpisodeTitleError"));
        setUploading(false);
        return;
      }
    }

    try {
      let url = `${API_URL}/assets/replace-from-url?asset_path=${encodeURIComponent(
        asset.path
      )}&image_url=${encodeURIComponent(
        preview.original_url
      )}&process_with_overlays=${processWithOverlays}&add_to_queue=${addToQueue}&asset_type=${encodeURIComponent(metadata.asset_type)}&mediaType=${encodeURIComponent(metadata.mediaType)}`;

      if (processWithOverlays && metadata.asset_type !== "titlecard") {
        const titleText = manualForm?.titletext ?? metadata.title;
        const folderName = manualForm?.foldername || metadata.folder_name;
        const libraryName = manualForm?.libraryname || metadata.library_name;

        if (titleText !== undefined && titleText !== null) url += `&title_text=${encodeURIComponent(titleText)}`;
        if (folderName) url += `&folder_name=${encodeURIComponent(folderName)}`;
        if (libraryName) url += `&library_name=${encodeURIComponent(libraryName)}`;
      }

      if (processWithOverlays && metadata.asset_type === "season") {
        const seasonPosterName = manualForm?.seasonPosterName;
        if (seasonPosterName) {
          url += `&season_number=${encodeURIComponent(seasonPosterName)}`;
        }
      }

      if (processWithOverlays && metadata.asset_type === "titlecard") {
        const folderName = manualForm?.foldername || metadata.folder_name;
        const libraryName = manualForm?.libraryname || metadata.library_name;
        const seasonPosterName = manualForm?.seasonPosterName;
        const episodeNumber = manualForm?.episodeNumber;
        const episodeTitleName = manualForm?.episodeTitleName;

        if (folderName) url += `&folder_name=${encodeURIComponent(folderName)}`;
        if (libraryName) url += `&library_name=${encodeURIComponent(libraryName)}`;
        if (seasonPosterName) url += `&season_number=${encodeURIComponent(seasonPosterName)}`;
        if (episodeNumber) url += `&episode_number=${encodeURIComponent(episodeNumber)}`;
        if (episodeTitleName) url += `&episode_title=${encodeURIComponent(episodeTitleName)}`;
      }

      if (processWithOverlays && blueprintId && blueprintId !== "none") {
        const bp = [...BLUEPRINTS, ...customBlueprints].find(b => b.id === blueprintId);
        if (bp && bp.updates?.nested) {
          const bpName = bp.customTitle || (bp.titleKey ? t(bp.titleKey) : bp.id);
          const overridesWithContext = { ...bp.updates.nested, ActiveBlueprintName: bpName };
          url += `&blueprint_overrides=${encodeURIComponent(JSON.stringify(overridesWithContext))}`;
        }
      }

      const response = await fetch(url, { method: "POST" });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const data = await response.json();

      if (data.success) {
        if (data.manual_run_triggered) {
          showSuccess(t("assetReplacer.replacedAndQueued"));
          if (!addToQueue) {
            window.dispatchEvent(new Event("assetReplaced"));
          }
          if (onSuccess) await onSuccess(!addToQueue);
          onClose();
        } else {
          showSuccess(t("assetReplacer.replacedSuccessfully"));
          if (!addToQueue) {
            window.dispatchEvent(new Event("assetReplaced"));
          }
          setTimeout(async () => {
            if (onSuccess) await onSuccess(!addToQueue);
            onClose();
          }, 2000);
        }
      } else {
        showError(t("assetReplacer.replaceError"));
      }
    } catch (err) {
      showError(t("assetReplacer.errorReplacingAsset", { error: err.message }));
    } finally {
      setUploading(false);
    }
  };

  const totalPreviews = Object.values(previews).flat().length;

  const currentProviderPreviews = previews[activeProviderTab] || [];
  const availableLanguages = ["all", ...new Set(currentProviderPreviews.map(p => (p.language || "xx").toLowerCase()))];
  const effectiveLanguageFilter = availableLanguages.includes(languageFilter) ? languageFilter : "all";

  const filteredPreviews = effectiveLanguageFilter === "all" 
    ? currentProviderPreviews 
    : currentProviderPreviews.filter(p => (p.language || "xx").toLowerCase() === effectiveLanguageFilter);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-theme-card rounded-none sm:rounded-xl border-0 sm:border border-theme max-w-6xl w-full h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Posterizarr Running Warning */}
        {isPosterizarrRunning && (
          <div className="bg-orange-900/30 border-b-4 border-orange-500 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-orange-200">
                  Posterizarr is Currently Running
                </p>
                <p className="text-sm text-orange-300/80">
                  Asset replacement is disabled while Posterizarr is processing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="border-b border-theme p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-theme-text flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 rounded-lg bg-theme-primary/10">
                  <RefreshCw className="w-4 h-4 sm:w-6 sm:h-6 text-theme-primary" />
                </div>
                <span className="break-words">
                  {logoSelectionMode ? t("assetReplacer.selectLogoTitle") : t("assetReplacer.title")}
                </span>
              </h2>
              <p className="text-sm sm:text-lg font-bold text-theme-text mt-0.5 sm:mt-1 break-words">
                {asset.path.split(/[\\/]/).slice(-2, -1)[0] || "Unknown"}
              </p>
              <p className="text-xs text-theme-muted break-all mt-1">
                {asset.path}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 p-2 hover:bg-theme-hover rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-theme-muted" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-theme px-4 sm:px-6">
          <div className="flex gap-2 sm:gap-4 -mb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab("upload")}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 font-medium transition-colors border-b-2 whitespace-nowrap text-sm:text-base ${activeTab === "upload"
                ? "text-theme-primary border-theme-primary"
                : "text-theme-muted border-transparent hover:text-theme-text"
                }`}
            >
              <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1.5 sm:mr-2" />
              <span className="hidden sm:inline">
                {t("assetReplacer.uploadCustom")}
              </span>
              <span className="sm:hidden">Upload</span>
            </button>
            <button
              onClick={() => setActiveTab("previews")}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 font-medium transition-colors border-b-2 whitespace-nowrap text-sm:text-base ${activeTab === "previews"
                ? "text-theme-primary border-theme-primary"
                : "text-theme-muted border-transparent hover:text-theme-text"
                }`}
            >
              <ImageIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1.5 sm:mr-2" />
              <span className="hidden sm:inline">
                {t("assetReplacer.servicePreviews")}
              </span>
              <span className="sm:hidden">Previews</span>
              {totalPreviews > 0 && (
                <span className="ml-1.5 sm:ml-2 px-1.5 sm:px-2 py-0.5 bg-theme-primary/20 text-theme-primary rounded-full text-xs">
                  {totalPreviews}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {activeTab === "upload" && (
            <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
              {/* Process with Overlays Toggle */}
              {(metadata.asset_type === "poster" ||
                metadata.asset_type === "background" ||
                metadata.asset_type === "season" ||
                metadata.asset_type === "titlecard" ||
                metadata.asset_type === "collection") && (
                  <div className="bg-theme-hover border border-theme rounded-lg p-3 sm:p-4">
                    <div className="flex items-start sm:items-center justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs sm:text-sm font-medium text-theme-text break-words">
                          Process with overlays after replace
                        </h4>
                        <p className="text-xs text-theme-muted mt-0.5 leading-relaxed">
                          {processWithOverlays
                            ? "Applies borders, overlays & text to the replaced asset based on overlay settings. Asset will be saved to assets/ folder."
                            : "Direct replacement without overlay processing. Asset will be saved to manualassets/ folder for manual use."}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          setProcessWithOverlays(!processWithOverlays)
                        }
                        className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-primary focus:ring-offset-2 focus:ring-offset-theme-bg ${processWithOverlays ? "bg-theme-primary" : "bg-gray-600"
                          }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${processWithOverlays
                            ? "translate-x-6"
                            : "translate-x-1"
                            }`}
                        />
                      </button>
                    </div>

                    {/* Add to Queue Toggle */}
                    <div className="flex items-start sm:items-center justify-between gap-3 mb-2 pt-3 border-t border-theme/30">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs sm:text-sm font-medium text-theme-text break-words">
                          Add to Queue
                        </h4>
                        <p className="text-xs text-theme-muted mt-0.5 leading-relaxed">
                          {addToQueue
                            ? "Asset replacement will be queued and executed later."
                            : "Asset will be replaced immediately."}
                        </p>
                      </div>
                      <button
                        onClick={() => setAddToQueue(!addToQueue)}
                        className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-primary focus:ring-offset-2 focus:ring-offset-theme-bg ${addToQueue ? "bg-theme-primary" : "bg-gray-600"
                          }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${addToQueue ? "translate-x-6" : "translate-x-1"
                            }`}
                        />
                      </button>
                    </div>

                    {/* Parameter Inputs */}
                    {processWithOverlays && (
                      <div className="mt-4 pt-4 border-t border-theme space-y-3">

                        {/* Title Text - For all types except titlecard */}
                        {metadata.asset_type !== "titlecard" && (
                          <div>
                            <label className="block text-xs font-medium text-theme-text mb-1">
                              Title Text
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={manualForm?.titletext || ""}
                                onChange={(e) =>
                                  setManualForm({
                                    ...manualForm,
                                    titletext: e.target.value,
                                  })
                                }
                                placeholder="Enter text or Browse for Logo..."
                                className="flex-1 px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                              />
                              <button
                                type="button"
                                onClick={handleFetchLogos}
                                disabled={loading}
                                title="Browse for Logos/ClearArt"
                                className="px-3 py-1.5 bg-theme-card hover:bg-theme-hover border border-theme rounded text-theme-text transition-colors flex items-center gap-2 whitespace-nowrap"
                              >
                                {loading && logoSelectionMode ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Search className="w-4 h-4" />
                                )}
                                <span className="hidden sm:inline">{t("assetReplacer.browseLogos")}</span>
                              </button>
                            </div>
                            {manualForm?.titletext?.startsWith("http") && (
                              <p className="text-[10px] text-green-400 mt-1 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Logo URL detected.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Folder Name */}
                        {metadata.asset_type !== "collection" && (
                          <div>
                            <label className="block text-xs font-medium text-theme-text mb-1">
                              Folder Name *
                            </label>
                            <input
                              type="text"
                              value={manualForm?.foldername || ""}
                              onChange={(e) =>
                                setManualForm({
                                  ...manualForm,
                                  foldername: e.target.value,
                                })
                              }
                              placeholder="e.g., Movie Name (2019) {tmdb-123}"
                              className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                            />
                          </div>
                        )}

                        {/* Blueprint Selection */}
                        <div className="pt-3 border-t border-theme/30 mt-3">
                          <label className="block text-xs font-medium text-theme-text mb-1">
                            Blueprint Selection
                          </label>
                          <select
                            value={blueprintId}
                            onChange={(e) => setBlueprintId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary transition-colors"
                            disabled={uploading}
                          >
                            <option value="none">{t("assetReplacer.defaultGlobalConfig", "Default (Global Config)")}</option>
                            {[...BLUEPRINTS, ...customBlueprints].map((bp) => (
                              <option key={bp.id} value={bp.id}>
                                {bp.id.startsWith('custom_') ? (bp.titleKey || bp.customTitle) : t(bp.titleKey)}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] sm:text-xs text-theme-muted mt-1">
                            Optionally override global settings with a specific blueprint.
                          </p>
                        </div>

                        {/* Library Name */}
                        <div>
                          <label className="block text-xs font-medium text-theme-text mb-1">
                            Library Name *
                          </label>
                          <input
                            type="text"
                            value={manualForm?.libraryname || ""}
                            onChange={(e) =>
                              setManualForm({
                                ...manualForm,
                                libraryname: e.target.value,
                              })
                            }
                            placeholder="e.g., 4K"
                            className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                          />
                        </div>

                        {/* Season Number - For season posters */}
                        {metadata.asset_type === "season" && (
                          <div>
                            <label className="block text-xs font-medium text-theme-text mb-1">
                              Season Poster Name *
                            </label>
                            <input
                              type="text"
                              value={manualForm.seasonPosterName}
                              onChange={(e) =>
                                setManualForm({
                                  ...manualForm,
                                  seasonPosterName: e.target.value,
                                })
                              }
                              placeholder="Season 01 or Season 00 (Specials)"
                              className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                            />
                          </div>
                        )}

                        {/* TitleCard-specific fields */}
                        {metadata.asset_type === "titlecard" && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-theme-text mb-1">
                                Episode Title *
                              </label>
                              <input
                                type="text"
                                value={manualForm.episodeTitleName}
                                onChange={(e) =>
                                  setManualForm({
                                    ...manualForm,
                                    episodeTitleName: e.target.value,
                                  })
                                }
                                placeholder="e.g., Pilot"
                                className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-theme-text mb-1">
                                Season Number *
                              </label>
                              <input
                                type="text"
                                value={manualForm.seasonPosterName}
                                onChange={(e) =>
                                  setManualForm({
                                    ...manualForm,
                                    seasonPosterName: e.target.value,
                                  })
                                }
                                placeholder="e.g., 01"
                                className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-theme-text mb-1">
                                Episode Number *
                              </label>
                              <input
                                type="text"
                                value={manualForm.episodeNumber}
                                onChange={(e) =>
                                  setManualForm({
                                    ...manualForm,
                                    episodeNumber: e.target.value,
                                  })
                                }
                                placeholder="e.g., 01"
                                className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {/* Manual Search Toggle */}
              <div className="bg-theme-hover border border-theme rounded-lg p-3 sm:p-4">
                <div className="flex items-start sm:items-center justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs sm:text-sm font-medium text-theme-text break-words">
                      {t("assetReplacer.manualSearchByTitle")}
                    </h4>
                    <p className="text-xs text-theme-muted mt-0.5 leading-relaxed">
                      Search for assets instead of using detected metadata
                    </p>
                  </div>
                  <button
                    onClick={() => setManualSearch(!manualSearch)}
                    className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-primary focus:ring-offset-2 focus:ring-offset-theme-bg ${manualSearch ? "bg-theme-primary" : "bg-gray-600"
                      }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${manualSearch ? "translate-x-6" : "translate-x-1"
                        }`}
                    />
                  </button>
                </div>

                {/* Manual Search Fields */}
                {manualSearch && (
                  <div className="mt-4 pt-4 border-t border-theme space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-theme-text mb-1">
                        Title *
                      </label>
                      <input
                        type="text"
                        value={searchTitle}
                        onChange={(e) => setSearchTitle(e.target.value)}
                        placeholder="Enter movie/show title..."
                        className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-theme-text mb-1">
                        Year (optional)
                      </label>
                      <input
                        type="number"
                        value={searchYear}
                        onChange={(e) => setSearchYear(e.target.value)}
                        placeholder="2024"
                        min="1900"
                        max="2100"
                        className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                      />
                    </div>

                    {(metadata.asset_type === "season" ||
                      metadata.asset_type === "titlecard") && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-theme-text mb-1">
                              Season Number *
                            </label>
                            <input
                              type="number"
                              value={manualSearchForm.seasonNumber}
                              onChange={(e) =>
                                setManualSearchForm({
                                  ...manualSearchForm,
                                  seasonNumber: e.target.value,
                                })
                              }
                              className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                            />
                          </div>

                          {metadata.asset_type === "titlecard" && (
                            <div>
                              <label className="block text-xs font-medium text-theme-text mb-1">
                                Episode Number *
                              </label>
                              <input
                                type="number"
                                value={manualSearchForm.episodeNumber}
                                onChange={(e) =>
                                  setManualSearchForm({
                                    ...manualSearchForm,
                                    episodeNumber: e.target.value,
                                  })
                                }
                                className="w-full px-2 py-1.5 text-sm bg-theme-bg border border-theme rounded text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
                              />
                            </div>
                          )}
                        </>
                      )}

                    <div className="pt-3 border-t border-theme">
                      <button
                        onClick={handleFetchClick}
                        disabled={loading}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text rounded-lg transition-all"
                      >
                        <Download className="w-4 h-4 text-theme-primary" />
                        {loading
                          ? t("common.loading")
                          : t("assetReplacer.fetchFromServices")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Upload Section */}
              <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                  <div className="flex-1 w-full">
                    <h3 className="text-base sm:text-lg font-semibold text-theme-text mb-3">
                      {t("assetReplacer.uploadYourOwnImage")}
                    </h3>
                    <label className="block border-2 border-dashed border-theme rounded-lg p-4 sm:p-6 text-center cursor-pointer hover:border-theme-primary transition-colors">
                      <Upload className="w-8 h-8 sm:w-10 sm:h-10 text-theme-muted mx-auto mb-2" />
                      <p className="text-xs sm:text-sm text-theme-muted mb-2 sm:mb-3">
                        {t("assetReplacer.selectCustomImage")}
                      </p>
                      <span className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text rounded-lg">
                        <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-theme-primary" />
                        {uploading
                          ? t("assetReplacer.uploading")
                          : t("assetReplacer.chooseFile")}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                        disabled={uploading}
                      />
                    </label>

                    {/* Text / Textless Dropdown */}
                    {uploadedImage && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-theme-text mb-2">
                          Asset Type
                        </label>
                        <select
                          value={uploadHasText ? "text" : "textless"}
                          onChange={(e) => setUploadHasText(e.target.value === "text")}
                          className="w-full px-3 py-2 bg-theme-bg border border-theme rounded-lg text-sm text-theme-text focus:outline-none focus:border-theme-primary transition-colors"
                          disabled={uploading}
                        >
                          <option value="textless">Textless Asset (Clean)</option>
                          <option value="text">Has Language / Text</option>
                        </select>
                      </div>
                    )}
                    

                  </div>

                  {uploadedImage && (
                    <div className="w-full sm:w-48 flex-shrink-0">
                      <p className="text-xs font-medium text-theme-text mb-2">
                        Preview:
                      </p>
                      <div
                        className={`relative bg-theme rounded-lg overflow-hidden border border-theme mx-auto ${useHorizontalLayout
                          ? "aspect-[16/9] max-w-xs"
                          : "aspect-[2/3] max-w-[12rem]"
                          }`}
                      >
                        <img
                          src={uploadedImage}
                          alt="Upload preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {imageDimensions && (
                        <div
                          className={`mt-2 text-xs text-center p-2 rounded ${isDimensionValid
                            ? "bg-green-500/10 text-green-400 border border-green-500/30"
                            : "bg-red-500/10 text-red-400 border border-red-500/30"
                            }`}
                        >
                          {imageDimensions.width}x{imageDimensions.height}px
                          {isDimensionValid ? " ✓" : " ✗"}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {uploadedImage && (
                  <div className="mt-4">
                    <button
                      onClick={handleUploadClick}
                      disabled={!isDimensionValid || uploading || (isPosterizarrRunning && !addToQueue)}
                      className={`w-full px-4 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${isDimensionValid && !uploading && !isPosterizarrRunning
                        ? "bg-theme-primary hover:bg-theme-primary/90 text-white"
                        : "bg-gray-500/20 text-gray-500 cursor-not-allowed"
                        }`}
                    >
                      <Upload className="w-4 h-4" />
                      {uploading
                        ? t("assetReplacer.uploadingAsset")
                        : isPosterizarrRunning
                          ? "Upload Disabled (Running)"
                          : t("assetReplacer.uploadAssetButton")}
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-theme"></div>
                </div>
                <div className="relative flex justify-center text-xs sm:text-sm">
                  <span className="px-3 sm:px-4 bg-theme-bg text-theme-muted">
                    {manualSearch
                      ? t("assetReplacer.searchForAssets")
                      : t("assetReplacer.orFetchFromServices")}
                  </span>
                </div>
              </div>

              {/* Fetch Previews Button */}
              <div className="text-center">
                <button
                  onClick={handleFetchClick}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text rounded-lg transition-all"
                >
                  <Download className="w-4 h-4 sm:w-5 sm:h-5 text-theme-primary" />
                  {loading
                    ? t("common.loading")
                    : t("assetReplacer.fetchFromServices")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "previews" && (
            <div>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-theme-primary mb-4" />
                  <p className="text-theme-muted">
                    {t("assetReplacer.fetchingPreviews")}
                  </p>
                </div>
              ) : totalPreviews === 0 ? (
                <div className="text-center py-12">
                  <ImageIcon className="w-16 h-16 text-theme-muted mx-auto mb-4" />
                  <p className="text-theme-muted mb-4">
                    {t("assetReplacer.noPreviewsLoaded")}
                  </p>
                  <button
                    onClick={handleFetchClick}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text rounded-lg transition-all"
                  >
                    <Download className="w-5 h-5 text-theme-primary" />
                    {t("assetReplacer.fetchPreviews")}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="border-b border-theme mb-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setActiveProviderTab("tmdb")}
                        className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${activeProviderTab === "tmdb"
                          ? "text-blue-400 border-blue-400 bg-blue-500/10"
                          : "text-theme-muted border-transparent hover:text-theme-text hover:bg-theme-hover"
                          }`}
                      >
                        <span className="flex items-center gap-2">
                          TMDB {previews.tmdb.length > 0 && <span>({previews.tmdb.length})</span>}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveProviderTab("tvdb")}
                        className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${activeProviderTab === "tvdb"
                          ? "text-green-400 border-green-400 bg-green-500/10"
                          : "text-theme-muted border-transparent hover:text-theme-text hover:bg-theme-hover"
                          }`}
                      >
                        <span className="flex items-center gap-2">
                          TVDB {previews.tvdb.length > 0 && <span>({previews.tvdb.length})</span>}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveProviderTab("fanart")}
                        className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${activeProviderTab === "fanart"
                          ? "text-purple-400 border-purple-400 bg-purple-500/10"
                          : "text-theme-muted border-transparent hover:text-theme-text hover:bg-theme-hover"
                          }`}
                      >
                        <span className="flex items-center gap-2">
                          Fanart.tv {previews.fanart.length > 0 && <span>({previews.fanart.length})</span>}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    {/* Language Filter */}
                    {availableLanguages.length > 2 && (
                      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                        {availableLanguages.map((lang) => (
                          <button
                            key={lang}
                            onClick={() => setLanguageFilter(lang)}
                            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                              effectiveLanguageFilter === lang
                                ? "bg-theme-primary text-white"
                                : "bg-theme-bg border border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            {lang === "all" ? t("common.all", "All") : lang.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className={useHorizontalLayout
                      ? "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2"
                      : "grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2"
                    }>
                      {filteredPreviews.map((preview, index) => (
                        <PreviewCard
                          key={`${activeProviderTab}-${index}`}
                          preview={preview}
                          onSelect={() => handlePreviewClick(preview)}
                          disabled={uploading || (isPosterizarrRunning && !addToQueue)}
                          isHorizontal={useHorizontalLayout}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showUploadConfirm}
        onClose={() => setShowUploadConfirm(false)}
        onConfirm={handleConfirmUpload}
        title={t("assetReplacer.confirmReplaceTitle")}
        message={t("assetReplacer.confirmReplaceMessage")}
        confirmText={t("assetReplacer.confirmReplaceButton")}
        type="warning"
      />

      <ConfirmDialog
        isOpen={showPreviewConfirm}
        onClose={() => {
          setShowPreviewConfirm(false);
          setPendingPreview(null);
        }}
        onConfirm={handleSelectPreview}
        title={t("assetReplacer.confirmReplaceTitle")}
        message={t("assetReplacer.confirmReplaceMessage")}
        confirmText={t("assetReplacer.confirmReplaceButton")}
        type="warning"
      />

      <ConfirmDialog
        isOpen={showFetchConfirm}
        onClose={() => {
          setShowFetchConfirm(false);
          setPendingFetchParams(null);
        }}
        onConfirm={fetchPreviews}
        title={t("assetReplacer.confirmFetchTitle")}
        message={t("assetReplacer.confirmFetchMessage")}
        confirmText={t("assetReplacer.confirmFetchButton")}
        type="info"
      />
    </div >
  );
}

function PreviewCard({ preview, onSelect, disabled, isHorizontal = false }) {
  const { t } = useTranslation();
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Detect if it is a logo (updated to handle multiple variants)
  const isLogo = preview.type === "logo" ||
    preview.type?.includes("clearart") ||
    preview.type?.includes("clearlogo") ||
    preview.type?.includes("hdmovielogo");

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const response = await fetch(preview.original_url || preview.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const source = preview.source?.toLowerCase() || "image";
      const lang = preview.language || "";
      const timestamp = Date.now();
      const extension =
        preview.original_url?.split(".").pop()?.split("?")[0] || "jpg";
      a.download = `${source}_${lang}_${timestamp}.${extension}`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  return (
    <div
      className="group relative bg-theme-hover rounded-lg overflow-hidden border border-theme hover:border-theme-primary transition-all cursor-pointer"
      onClick={disabled ? undefined : onSelect}
    >
      <div
        className={`relative ${isLogo ? "bg-slate-700/50" : "bg-theme"} ${isHorizontal ? "aspect-[16/9]" : "aspect-[2/3]"
          }`}
      >
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-theme-muted" />
          </div>
        )}
        {imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="w-12 h-12 text-theme-muted" />
          </div>
        ) : (
          <img
            src={preview.url}
            alt="Preview"
            className={`w-full h-full ${isLogo ? "object-contain p-2" : "object-cover"} group-hover:scale-105 transition-all duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"
              }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        )}

        <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center">
          <button
            onClick={handleDownload}
            className="absolute top-2 right-2 px-3 py-2 bg-theme-primary hover:bg-theme-primary/80 rounded-lg transition-all shadow-lg z-10 flex items-center gap-2"
            title={t("assetReplacer.download") || "Download"}
          >
            <Download className="w-4 h-4 text-white" />
            <span className="text-white text-sm font-medium">
              {t("assetReplacer.download")}
            </span>
          </button>

          <Check className="w-10 h-10 text-green-400 mb-3" />

          <div
            className={`px-3 py-1 rounded-full text-xs font-semibold mb-2 ${preview.source === "TMDB"
              ? "bg-blue-500 text-white"
              : preview.source === "TVDB"
                ? "bg-green-500 text-white"
                : preview.source === "Fanart.tv"
                  ? "bg-purple-500 text-white"
                  : "bg-gray-500 text-white"
              }`}
          >
            {preview.source}
          </div>

          <div className="flex flex-wrap gap-1.5 justify-center mt-2">
            {(preview.width || preview.height) && (
              <span className="bg-slate-600 px-2 py-1 rounded text-xs text-white font-medium">
                {preview.width} × {preview.height}
              </span>
            )}
            {preview.language && (
              <span className="bg-theme-primary px-2 py-1 rounded text-xs text-white font-medium">
                {preview.language.toUpperCase()}
              </span>
            )}
            {preview.vote_average !== undefined && preview.vote_average > 0 && (
              <span className="bg-yellow-500 px-2 py-1 rounded text-xs text-white font-medium flex items-center gap-1">
                <Star className="w-3 h-3" />
                {preview.vote_average.toFixed(1)}
              </span>
            )}
            {preview.likes !== undefined && preview.likes > 0 && (
              <span className="bg-red-500 px-2 py-1 rounded text-xs text-white font-medium">
                ❤️ {preview.likes}
              </span>
            )}
            {preview.type && (
              <span className="bg-gray-600 px-2 py-1 rounded text-xs text-white font-medium">
                {preview.type === "episode_still"
                  ? "Episode"
                  : preview.type === "season_poster"
                    ? "Season"
                    : preview.type === "backdrop"
                      ? "Backdrop"
                      : preview.type === "poster"
                        ? "Poster"
                        : preview.type}
              </span>
            )}
          </div>

          <p className="text-white text-sm font-semibold mt-3 flex items-center gap-2">
            <Check className="w-4 h-4" />
            {disabled
              ? t("assetReplacer.uploading")
              : t("assetReplacer.select")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default AssetReplacer;