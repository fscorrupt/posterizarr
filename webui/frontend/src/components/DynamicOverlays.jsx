/**
 * Dynamic Overlays UI Component for Posterizarr
 * ==============================================================================
 * HONOR & ATTRIBUTION:
 * Dynamic Overlays was designed and built with deep gratitude to the Kometa Project
 * (formerly Plex Meta Manager) created by meisnate12 & contributors under the MIT License.
 * The coordinate algorithms, optical bounding box calculations, dynamic queue slotting,
 * and template schema designs are adapted to provide seamless, config-driven dynamic artwork overlays.
 * ==============================================================================
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Layers,
  Sparkles,
  Heart,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  FileText,
  Eye,
  EyeOff,
  Search,
  Key,
  CheckSquare,
  Square,
  Database,
  Server,
  HardDrive,
  Film,
  Tv,
  Check,
  X,
  Loader2,
  HelpCircle,
  Clock,
  Play,
  Sliders,
  Trash2,
  FolderOpen,
  Plus,
  Save,
  Code,
  Edit3,
  Move,
  RotateCcw,
  Maximize2,
  Minimize2,
  Copy,
  FileCode,
  Zap,
  AlertCircle,
  ShieldCheck,
  StopCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Star,
  Filter,
  Calendar,
  Activity,
  LayoutGrid,
  Magnet,
  Image as ImageIcon,
  Volume2,
  Clapperboard,
  Type,
  Terminal,
  Palette
} from "lucide-react";
import { useToast } from "../context/ToastContext";

const DEFAULT_OVERLAY_PRESETS = [
  // User's core favorites
  { id: "runtimes", label: "Media Runtime", desc: "Duration badge (e.g. 124 min) - Recommended for Titlecards / Movies", level: "episode", category: "Core Overlays" },
  { id: "languages", label: "Audio Languages", desc: "Flags/badges for available audio tracks (DE, EN, JA, etc.) - Recommended for Titlecards / Movies", level: "episode", category: "Core Overlays" },
  { id: "ratings", label: "Audience / Critic Rating", desc: "IMDb / Rotten Tomatoes / TMDB / Metacritic score badges", level: "movie", category: "Core Overlays" },
  { id: "network", label: "Network Logo", desc: "TV network logos on season posters (HBO, Netflix, Apple TV+, etc.)", level: "season", category: "Core Overlays" },
  { id: "status", label: "Series Status", desc: "Airing, Returning, Ended, Canceled banner for TV series", level: "show", category: "Core Overlays" },
  { id: "commonsense", label: "Common Sense Media", desc: "Age rating badge (e.g. 10+, 14+, 18+)", level: "movie", category: "Core Overlays" },
  { id: "resolution", label: "Quality / Resolution Ribbon", desc: "4K, 1080p, HDR badges (used in overlays_movies.yml / overlays_tv.yml)", level: "movie", category: "Quality & Codecs" },
  { id: "ribbon", label: "Corner Ribbon", desc: "Corner ribbons for 4K UHD, Remux, HDR10+", level: "movie", category: "Quality & Codecs" },
  { id: "audio_codec", label: "Audio Codec", desc: "Dolby Atmos, TrueHD, DTS:X, DTS-HD MA, EAC3 badges", level: "movie", category: "Quality & Codecs" },
  { id: "video_format", label: "Video Format", desc: "HDR10, Dolby Vision, H.265 / HEVC format badges", level: "movie", category: "Quality & Codecs" },
  { id: "streaming", label: "Streaming Service", desc: "Platform badges (Netflix, Prime, Disney+, Apple TV+, Paramount+)", level: "show", category: "Branding" },
  { id: "studio", label: "Movie Studio", desc: "Studio logo overlays (Universal, Warner Bros, 20th Century, etc.)", level: "movie", category: "Branding" },
  { id: "content_rating_us_movie", label: "US Content Rating (Movie)", desc: "MPAA age rating (G, PG, PG-13, R, NC-17)", level: "movie", category: "Content Ratings" },
  { id: "content_rating_us_show", label: "US Content Rating (TV)", desc: "TV Parental Guidelines (TV-MA, TV-14, TV-PG)", level: "show", category: "Content Ratings" },
  { id: "content_rating_de", label: "German FSK Rating", desc: "FSK 0, 6, 12, 16, 18 badges", level: "movie", category: "Content Ratings" },
];

const PositionPicker = ({ value, onChange, label = "Position" }) => {
  const positions = [
    ["top-left", "top-center", "top-right"],
    ["center-left", "center", "center-right"],
    ["bottom-left", "bottom-center", "bottom-right"]
  ];
  const shortLabels = {
    "top-left": "TL", "top-center": "TC", "top-right": "TR",
    "center-left": "CL", "center": "C", "center-right": "CR",
    "bottom-left": "BL", "bottom-center": "BC", "bottom-right": "BR"
  };
  return (
    <div className="space-y-1 shrink-0">
      <div className="flex items-center justify-between gap-1">
        <label className="text-[10px] font-semibold text-theme-muted uppercase tracking-wider">{label}</label>
        <span className="text-[9px] font-mono text-theme-primary capitalize font-medium">{value?.replace("-", " ") || "top-left"}</span>
      </div>
      <div className="grid grid-cols-3 gap-0.5 w-20 p-1 bg-theme-hover/60 border border-theme rounded-lg">
        {positions.flat().map((pos) => {
          const isSel = value === pos;
          return (
            <button
              key={pos}
              type="button"
              onClick={() => onChange(pos)}
              className={`h-5 rounded text-[9px] font-bold transition-all ${
                isSel
                  ? "bg-theme-primary text-white shadow-sm ring-1 ring-white/30"
                  : "bg-theme-card/60 hover:bg-theme-card text-theme-muted hover:text-theme-text border border-theme/40"
              }`}
              title={pos}
            >
              {shortLabels[pos]}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const TEXT_BADGE_KEYS = ["runtime", "rating", "status", "age_rating", "languages", "anime", "video_format"];

const BadgeOffsetControls = ({ itemKey, offset, onChange, fonts = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const align = offset?.align || "left";
  const valign = offset?.valign || "top";
  const x = offset?.x ?? 0;
  const y = offset?.y ?? 0;
  const fontSize = offset?.font_size ?? "";
  const font = offset?.font ?? "";
  const isTextBadge = TEXT_BADGE_KEYS.includes(itemKey);

  return (
    <div className="pt-2 border-t border-theme/40 mt-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-theme-muted font-medium flex items-center gap-1.5">
          <Sliders className="w-3 h-3 text-theme-primary" />
          <span>Position:</span>
          <span className="font-mono text-theme-text text-[10px] bg-theme-hover px-1.5 py-0.5 rounded border border-theme">
            {align} {x}px · {valign} {y}px
            {isTextBadge && fontSize ? ` · ${fontSize}px` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-[11px] font-semibold text-theme-primary hover:underline transition-colors"
        >
          {isOpen ? "Done" : "Fine-tune"}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-2.5 bg-theme-hover/20 p-2.5 rounded-xl border border-theme mt-2 animate-in fade-in duration-150">
          <div className="grid grid-cols-2 gap-2.5">
            {/* Horizontal */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-theme-muted font-medium">
                <span>Align</span>
                <span>Offset (px)</span>
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={align}
                  onChange={(e) => onChange(itemKey, { ...offset, align: e.target.value }, true)}
                  className="bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium flex-1 focus:ring-1 focus:ring-theme-primary focus:outline-none"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
                <input
                  type="number"
                  value={x}
                  onChange={(e) => onChange(itemKey, { ...offset, x: parseInt(e.target.value) || 0 }, false)}
                  className="w-16 bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono focus:ring-1 focus:ring-theme-primary focus:outline-none text-right"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Vertical */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-theme-muted font-medium">
                <span>Align</span>
                <span>Offset (px)</span>
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={valign}
                  onChange={(e) => onChange(itemKey, { ...offset, valign: e.target.value }, true)}
                  className="bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium flex-1 focus:ring-1 focus:ring-theme-primary focus:outline-none"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
                <input
                  type="number"
                  value={y}
                  onChange={(e) => onChange(itemKey, { ...offset, y: parseInt(e.target.value) || 0 }, false)}
                  className="w-16 bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono focus:ring-1 focus:ring-theme-primary focus:outline-none text-right"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Typography: Font & Font Size controls if badge involves text */}
          {isTextBadge && (
            <div className="pt-2 border-t border-theme/40 grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-theme-muted font-medium">
                  <span className="flex items-center gap-1">
                    <Type className="w-2.5 h-2.5 text-theme-primary" />
                    Font Family
                  </span>
                </div>
                <select
                  value={font}
                  onChange={(e) => onChange(itemKey, { ...offset, font: e.target.value }, true)}
                  className="w-full bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium focus:ring-1 focus:ring-theme-primary focus:outline-none truncate"
                >
                  <option value="">Default Font</option>
                  {(fonts || []).map((f) => (
                    <option key={f} value={f}>
                      {f.replace(/\.(ttf|otf|woff2?)$/i, "")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-theme-muted font-medium">
                  <span>Font Size (px)</span>
                  {fontSize && <span className="font-mono text-[9px] text-theme-muted">{fontSize}px</span>}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="10"
                    max="180"
                    value={fontSize}
                    onChange={(e) => onChange(itemKey, { ...offset, font_size: e.target.value === "" ? "" : parseInt(e.target.value) || 0 }, true)}
                    placeholder="e.g. 50"
                    className="w-full bg-theme-card border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono focus:ring-1 focus:ring-theme-primary focus:outline-none"
                  />
                  {fontSize ? (
                    <button
                      type="button"
                      title="Reset font size to default"
                      onClick={() => onChange(itemKey, { ...offset, font_size: "" }, true)}
                      className="text-[10px] text-theme-muted hover:text-theme-primary px-1"
                    >
                      ↺
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function DynamicOverlays() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  const [schedulerConfig, setSchedulerConfig] = useState(null);
  const [isQuickScheduling, setIsQuickScheduling] = useState(false);

  const showToast = (message, type = "info") => {
    if (type === "error") {
      showError(message);
    } else if (type === "success") {
      showSuccess(message);
    } else {
      showInfo(message);
    }
  };

  const [activeTab, setActiveTab] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam && ["rules", "importer", "config", "preview", "sync", "anime"].includes(tabParam)) {
        return tabParam;
      }
      const savedTab = localStorage.getItem("posterizarr_active_overlay_tab");
      if (savedTab && ["rules", "importer", "config", "preview", "sync", "anime"].includes(savedTab)) {
        return savedTab;
      }
    } catch {}
    return "rules";
  });

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    try {
      localStorage.setItem("posterizarr_active_overlay_tab", tabId);
    } catch {}
  };

  const [activeAssetTarget, setActiveAssetTarget] = useState("all"); // "all", "poster", "backdrop", "season", "titlecard"
  const [multiRatingsParam, setMultiRatingsParam] = useState("");
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    open: false,
    title: "",
    message: "",
    confirmLabel: "Delete",
    onConfirm: null
  });
  const [selectedLibraries, setSelectedLibraries] = useState([]);
  const [removeLibraryModal, setRemoveLibraryModal] = useState({
    isOpen: false,
    librariesToRemove: []
  });
  const [isRemovingLibraries, setIsRemovingLibraries] = useState(false);
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [isYamlToolsModalOpen, setIsYamlToolsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Helper counts for badges per asset target
  const getAllActiveCount = (badges = {}) => {
    let count = 0;
    if (badges.critic_rating?.enabled || (badges.rating?.source === "ratings" && badges.rating?.enabled)) count++;
    if (badges.resolution?.enabled) count++;
    if (badges.age_rating?.enabled || (badges.rating?.source && badges.rating?.source !== "ratings" && badges.rating?.enabled)) count++;
    if (badges.runtime?.enabled) count++;
    if (badges.audio_languages?.enabled) count++;
    if (badges.status?.enabled) count++;
    if (badges.network?.enabled) count++;
    if (badges.anime?.enabled) count++;
    if (badges.audio_codec?.enabled) count++;
    if (badges.video_format?.enabled) count++;
    return count;
  };

  const getPosterActiveCount = (badges = {}, isTv = false) => {
    let count = 0;
    if (badges.critic_rating?.enabled || (badges.rating?.source === "ratings" && badges.rating?.enabled)) count++;
    if (badges.resolution?.enabled) count++;
    if (badges.age_rating?.enabled || (badges.rating?.source && badges.rating?.source !== "ratings" && badges.rating?.enabled)) count++;
    if (badges.audio_codec?.enabled) count++;
    if (badges.video_format?.enabled) count++;
    if (isTv) {
      if (badges.status?.enabled) count++;
      if (badges.network?.enabled && (badges.network?.level === "show" || badges.network?.level === "movie")) count++;
    } else {
      if (badges.runtime?.enabled) count++;
      if (badges.audio_languages?.enabled) count++;
    }
    return count;
  };

  const getBackdropActiveCount = () => {
    return featureSettings?.backdrop_overlays_enabled ? 1 : 0;
  };

  const getSeasonActiveCount = (badges = {}) => {
    let count = 0;
    if (badges.network?.enabled && (badges.network?.level === "season" || !badges.network?.level)) count++;
    if (badges.season_rating?.enabled) count++;
    if (badges.age_rating?.enabled && badges.age_rating?.level === "season") count++;
    return count;
  };

  const getTitleCardActiveCount = (badges = {}) => {
    let count = 0;
    if (badges.runtime?.enabled) count++;
    if (badges.audio_languages?.enabled) count++;
    if (badges.anime?.enabled) count++;
    if (badges.episode_rating?.enabled) count++;
    return count;
  };

  // Master Feature Settings (OFF by default)
  const [featureSettings, setFeatureSettings] = useState({
    enabled: false,
    sync_mode: "incremental",
    backdrop_overlays_enabled: true,
    rating_sources: ["imdb", "tomatoes", "tmdb", "tomatoesaudience"],
    rating_slots: { rating1: "imdb", rating2: "tomatoes", rating3: "tmdb" },
    rating_alignment: "horizontal",
    rating_position: "top-right",
    rating_contrast_box: true,
    mdblist_api_key: "",
    omdb_api_key: "",
    rating_cache_ttl_days: 7
  });
  const [isUpdatingFeatureSettings, setIsUpdatingFeatureSettings] = useState(false);
  const [ratingsCacheStats, setRatingsCacheStats] = useState(null);
  const [isClearingRatingsCache, setIsClearingRatingsCache] = useState(false);
  const [isBackdropPanelOpen, setIsBackdropPanelOpen] = useState(true);
  const [testingApiKey, setTestingApiKey] = useState({ mdblist: false, omdb: false });
  const [apiKeyTestResult, setApiKeyTestResult] = useState({ mdblist: null, omdb: null });
  const [showMdblistKey, setShowMdblistKey] = useState(false);
  const [showOmdbKey, setShowOmdbKey] = useState(false);

  // Visual Studio / YAML Translator state
  const [visualConfig, setVisualConfig] = useState({ libraries: {} });
  const [selectedVisualLib, setSelectedVisualLib] = useState(() => {
    try {
      return localStorage.getItem("posterizarr_selected_visual_lib") || "";
    } catch {
      return "";
    }
  });
  const [isVisualLoading, setIsVisualLoading] = useState(false);
  const [isVisualSaving, setIsVisualSaving] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importYamlText, setImportYamlText] = useState("");
  const [isImportingYaml, setIsImportingYaml] = useState(false);
  const [isAddLibModalOpen, setIsAddLibModalOpen] = useState(false);
  const [newLibForm, setNewLibForm] = useState({ name: "", media_type: "movie" });
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [dontShowWizardAgain, setDontShowWizardAgain] = useState(false);
  const [hasCompletedWizard, setHasCompletedWizard] = useState(() => {
    try {
      return localStorage.getItem("posterizarr_overlays_wizard_dismissed") === "true";
    } catch {
      return false;
    }
  });

  const dismissWizardInDb = async () => {
    setHasCompletedWizard(true);
    try {
      localStorage.setItem("posterizarr_overlays_wizard_dismissed", "true");
    } catch {}
    try {
      await fetch("/api/dynamic-overlays/wizard-dismiss", { method: "POST" });
    } catch (err) {
      console.warn("Failed saving wizard dismissal to DB:", err);
    }
  };
  const [wizardQuickStartDone, setWizardQuickStartDone] = useState(false);
  const [wizardConfigMode, setWizardConfigMode] = useState("presets"); // "presets" | "upload"
  const [wizardUploadedFiles, setWizardUploadedFiles] = useState([]);
  const [wizardExtractedKeys, setWizardExtractedKeys] = useState([]);
  const [isWizardUploading, setIsWizardUploading] = useState(false);
  const wizardFileInputRef = useRef(null);

  const [animetafillConfig, setAnimetafillConfig] = useState(null);
  const [animetafillStatus, setAnimetafillStatus] = useState(null);
  const [isAnimetafillSaving, setIsAnimetafillSaving] = useState(false);
  const [isAnimetafillRunning, setIsAnimetafillRunning] = useState(false);
  const [animetafillForce, setAnimetafillForce] = useState(false);
  const [animetafillPreviewTag, setAnimetafillPreviewTag] = useState("CANON");
  const [animetafillLibraries, setAnimetafillLibraries] = useState([]);
  const [isLoadingAnimLibraries, setIsLoadingAnimLibraries] = useState(false);
  const [animLibraryFilter, setAnimLibraryFilter] = useState("");
  const [isTestingSonarr, setIsTestingSonarr] = useState(false);
  const [sonarrTestResult, setSonarrTestResult] = useState(null);
  const [showSonarrKey, setShowSonarrKey] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [cacheData, setCacheData] = useState(null);

  // Overlay Cache Browser State
  const [isOverlayCacheModalOpen, setIsOverlayCacheModalOpen] = useState(false);
  const [overlayCacheItems, setOverlayCacheItems] = useState([]);
  const [overlayCacheLoading, setOverlayCacheLoading] = useState(false);
  const [overlayCacheSearch, setOverlayCacheSearch] = useState("");
  const [overlayCacheServer, setOverlayCacheServer] = useState("all");
  const [overlayCacheAssetType, setOverlayCacheAssetType] = useState("all");
  const [overlayCachePage, setOverlayCachePage] = useState(1);
  const [overlayCacheLimit, setOverlayCacheLimit] = useState(25);
  const [overlayCacheTotal, setOverlayCacheTotal] = useState(0);
  const [overlayCacheTotalPages, setOverlayCacheTotalPages] = useState(1);
  const [deletingOverlayCacheId, setDeletingOverlayCacheId] = useState(null);
  const [isClearCacheModalOpen, setIsClearCacheModalOpen] = useState(false);
  const [isClearingOverlayCache, setIsClearingOverlayCache] = useState(false);

  // Ratings Cache Browser State
  const [isRatingsCacheModalOpen, setIsRatingsCacheModalOpen] = useState(false);
  const [ratingsCacheItems, setRatingsCacheItems] = useState([]);
  const [ratingsCacheLoading, setRatingsCacheLoading] = useState(false);
  const [ratingsCacheSearch, setRatingsCacheSearch] = useState("");
  const [ratingsCacheServer, setRatingsCacheServer] = useState("all");
  const [ratingsCacheMediaType, setRatingsCacheMediaType] = useState("all");
  const [ratingsCacheStatus, setRatingsCacheStatus] = useState("all");
  const [ratingsCacheShowStatus, setRatingsCacheShowStatus] = useState("all");
  const [ratingsCachePage, setRatingsCachePage] = useState(1);
  const [ratingsCacheLimit, setRatingsCacheLimit] = useState(25);
  const [ratingsCacheTotal, setRatingsCacheTotal] = useState(0);
  const [ratingsCacheTotalPages, setRatingsCacheTotalPages] = useState(1);
  const [ratingsCacheStatsSummary, setRatingsCacheStatsSummary] = useState({ total: 0, valid: 0, expired: 0 });
  const [actionRatingCacheId, setActionRatingCacheId] = useState(null);

  // High-Speed Change Detection State
  const [isDetectingChanges, setIsDetectingChanges] = useState(false);
  const [changeDetectionReport, setChangeDetectionReport] = useState(null);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [isSyncingChanged, setIsSyncingChanged] = useState(false);
  const [changeSearchQuery, setChangeSearchQuery] = useState("");
  const [changeFilterType, setChangeFilterType] = useState("all");

  // Action states
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBatchFetching, setIsBatchFetching] = useState(false);
  const [fetchingAsset, setFetchingAsset] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Preview controls
  const [previewTemplate, setPreviewTemplate] = useState("movie_poster");
  const [previewRating, setPreviewRating] = useState("8.4");
  const [previewResolution, setPreviewResolution] = useState("4K");
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewStatusColor, setPreviewStatusColor] = useState("#FFA500");
  const [previewRuntime, setPreviewRuntime] = useState("1h 58m");
  const [previewLanguages, setPreviewLanguages] = useState("de,en");
  const [previewNetwork, setPreviewNetwork] = useState("");
  const [previewAnimeTag, setPreviewAnimeTag] = useState("");
  const [previewAgeRating, setPreviewAgeRating] = useState("15+");
  const [previewAgeSource, setPreviewAgeSource] = useState("commonsense");
  const [previewAudioCodec, setPreviewAudioCodec] = useState("truehd_atmos");
  const [previewAudioCodecStyle, setPreviewAudioCodecStyle] = useState("compact");
  const [previewVideoFormat, setPreviewVideoFormat] = useState("REMUX");
  const [isQuickStarting, setIsQuickStarting] = useState(false);
  const [previewTimestamp, setPreviewTimestamp] = useState(Date.now());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Badge Alignment Guidelines & Custom Test Images
  const [guideMode, setGuideMode] = useState("active"); // "active" | "all" | "off"
  const [selectedBadge, setSelectedBadge] = useState("rating");
  const [hoveredBadge, setHoveredBadge] = useState(null);
  const [snapToGuides, setSnapToGuides] = useState(true);
  const [customImages, setCustomImages] = useState({}); // { [template_type]: { dataUrl, filename, previewImageId, width, height } }
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const previewFileInputRef = useRef(null);
  const importFileInputRef = useRef(null);

  const handleImportFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setImportYamlText(content);
        showSuccess(`Loaded ${file.name}`);
      }
    };
    reader.onerror = () => {
      showError("Failed to read file.");
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const [activeSnapGuides, setActiveSnapGuides] = useState([]); // [{ type: "x" | "y", pos: number, label: string }]
  const [availableFonts, setAvailableFonts] = useState([]);
  const [resolutionMode, setResolutionMode] = useState("banner");

  useEffect(() => {
    fetch("/api/fonts")
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.files)) {
          setAvailableFonts(d.files);
        }
      })
      .catch(err => console.error("Error loading fonts:", err));
  }, []);

  // Drag-and-drop layout editor state (aligned with Kometa / Alien reference)
  const defaultPortraitOffsets = {
    rating: { x: 30, y: 25, align: "right", valign: "bottom", font_size: "", font: "" },
    runtime: { x: 140, y: 37, align: "center", valign: "bottom", font_size: 40, font: "" },
    status: { x: 0, y: 30, align: "center", valign: "bottom", font_size: "", font: "" },
    resolution: { x: 0, y: 0, align: "center", valign: "top", mode: "banner", back_color: "#00000099", back_radius: 15, back_width: 245, back_height: 95 },
    languages: { x: 30, y: 35, align: "left", valign: "bottom", font_size: "", font: "" },
    network: { x: 25, y: 25, align: "right", valign: "top" },
    anime: { x: 20, y: 20, align: "left", valign: "top", font_size: "", font: "" },
    age_rating: { x: 255, y: 37, align: "left", valign: "bottom", font_size: "", font: "" },
    audio_codec: { x: 30, y: 70, align: "right", valign: "bottom" },
    video_format: { x: 30, y: 30, align: "right", valign: "top" }
  };
  const defaultLandscapeOffsets = {
    rating: { x: 30, y: 25, align: "right", valign: "bottom" },
    runtime: { x: 140, y: 30, align: "center", valign: "bottom", font_size: 52 },
    status: { x: 0, y: 25, align: "center", valign: "bottom" },
    resolution: { x: 15, y: 15, align: "left", valign: "top", mode: "corner_badge", back_color: "#00000099", back_radius: 15, back_width: 260, back_height: 85 },
    languages: { x: 30, y: 30, align: "left", valign: "bottom" },
    network: { x: 25, y: 25, align: "right", valign: "top" },
    anime: { x: 20, y: 20, align: "left", valign: "top" },
    age_rating: { x: 110, y: 30, align: "left", valign: "bottom" },
    audio_codec: { x: 30, y: 70, align: "right", valign: "bottom" },
    video_format: { x: 30, y: 25, align: "right", valign: "top" }
  };

  const [customLangInput, setCustomLangInput] = useState("");

  const [previewMode, setPreviewMode] = useState("interactive"); // "interactive" or "rendered"
  const [offsets, setOffsets] = useState(defaultPortraitOffsets);
  const [draggingItem, setDraggingItem] = useState(null);
  const [selectedSaveLibrary, setSelectedSaveLibrary] = useState(() => {
    try {
      return localStorage.getItem("posterizarr_selected_visual_lib") || "";
    } catch {
      return "";
    }
  });
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const canvasRef = useRef(null);

  // Apply / Sync Execution State
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [selectedRunMode, setSelectedRunMode] = useState("normal"); // "normal", "plexsync", "syncjelly", "syncemby", "testing"
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [systemRunStatus, setSystemRunStatus] = useState({ running: false, current_mode: null, pid: null });
  const [serverConfig, setServerConfig] = useState(null);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  // Dedicated Dynamic Overlay Sync state
  const [syncScope, setSyncScope] = useState("incremental"); // "incremental" or "all"
  const [syncServer, setSyncServer] = useState("all"); // "all", "plex", "jellyfin", "emby"
  const [syncLibrary, setSyncLibrary] = useState("all"); // "all" or specific
  const [isOverlaySyncRunning, setIsOverlaySyncRunning] = useState(false);
  const [overlaySyncStatus, setOverlaySyncStatus] = useState(null);
  const [autoOverlaySync, setAutoOverlaySync] = useState(true);
  const [isSavingAutoSync, setIsSavingAutoSync] = useState(false);
  const [overlaySyncLogs, setOverlaySyncLogs] = useState([]);
  const [isSyncLogExpanded, setIsSyncLogExpanded] = useState(false);
  const [isAutoScrollLogs, setIsAutoScrollLogs] = useState(true);
  const syncLogsRef = useRef(null);

  useEffect(() => {
    if (isAutoScrollLogs && syncLogsRef.current) {
      syncLogsRef.current.scrollTop = syncLogsRef.current.scrollHeight;
    }
  }, [overlaySyncLogs, isAutoScrollLogs]);

  const fetchOverlaySyncStatus = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/sync/status");
      if (res.ok) {
        const data = await res.json();
        setIsOverlaySyncRunning(Boolean(data.is_running));
        if (data.last_result) setOverlaySyncStatus(data.last_result);
        if (Array.isArray(data.recent_logs)) {
          setOverlaySyncLogs(data.recent_logs);
        }
      }
    } catch (_) {}
  };

  const handleDownloadSyncLog = () => {
    if (!overlaySyncLogs || overlaySyncLogs.length === 0) return;
    const text = overlaySyncLogs.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `posterizarr_sync_${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchWebUISettings = async () => {
    try {
      const res = await fetch("/api/webui-settings");
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          const autoVal = data.settings.auto_overlay_sync !== undefined
            ? data.settings.auto_overlay_sync
            : data.settings.auto_kometa_overlay_sync;
          if (autoVal !== undefined) {
            setAutoOverlaySync(Boolean(autoVal));
          }
        }
      }
    } catch (_) {}
  };

  const handleToggleAutoSync = async () => {
    const nextVal = !autoOverlaySync;
    try {
      setIsSavingAutoSync(true);
      const res = await fetch("/api/webui-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_overlay_sync: nextVal, auto_kometa_overlay_sync: nextVal })
      });
      if (res.ok) {
        setAutoOverlaySync(nextVal);
        showSuccess(nextVal 
          ? "Enabled automated overlay sync on new media creation!" 
          : "Disabled automated overlay sync."
        );
      } else {
        showError("Failed to update auto-sync setting.");
      }
    } catch (err) {
      showError("Error updating setting: " + err.message);
    } finally {
      setIsSavingAutoSync(false);
    }
  };

  const handleTriggerOverlaySync = async (targetScope = syncScope, targetServer = syncServer, targetLib = syncLibrary) => {
    try {
      setIsOverlaySyncRunning(true);
      const res = await fetch("/api/dynamic-overlays/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_server: targetServer,
          scope: targetScope,
          library: targetLib
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Started Dynamic Overlay Sync (${targetScope.toUpperCase()}) for ${targetServer.toUpperCase()}!`);
        setIsApplyModalOpen(false);
        fetchOverlaySyncStatus();
      } else {
        showError(data.error || "Failed to start overlay sync.");
        setIsOverlaySyncRunning(false);
      }
    } catch (err) {
      showError("Error triggering overlay sync: " + err.message);
      setIsOverlaySyncRunning(false);
    }
  };

  const handleStopOverlaySync = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/sync/stop", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess("Dynamic overlay sync cancellation requested.");
        setIsOverlaySyncRunning(false);
        fetchOverlaySyncStatus();
      } else {
        showError(data.error || "Failed to stop overlay sync.");
      }
    } catch (err) {
      showError("Error stopping overlay sync: " + err.message);
    }
  };

  const handleResetOverlaySyncLock = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/sync/reset", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess("Overlay sync lock reset successfully.");
        setIsOverlaySyncRunning(false);
        fetchOverlaySyncStatus();
      } else {
        showError(data.error || "Failed to reset sync lock.");
      }
    } catch (err) {
      showError("Error resetting sync lock: " + err.message);
    }
  };

  const handleDetectChanges = async (targetServer = syncServer, targetLib = syncLibrary) => {
    try {
      setIsDetectingChanges(true);
      const params = new URLSearchParams({
        target_server: targetServer || "all",
        library: targetLib || "all"
      });
      const res = await fetch(`/api/dynamic-overlays/detect-changes?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setChangeDetectionReport(data);
        setIsChangeModalOpen(true);
        if (data.changed_count > 0) {
          showSuccess(`Scan complete: Found ${data.changed_count} media update(s) requiring overlay refresh!`);
        } else {
          showSuccess(`All ${data.total_scanned} media items are completely up to date.`);
        }
      } else {
        showError(data.error || "Failed to scan for media changes.");
      }
    } catch (err) {
      showError("Error detecting media changes: " + err.message);
    } finally {
      setIsDetectingChanges(false);
    }
  };

  const handleSyncChangedOnly = async (targetServer = syncServer, targetLib = syncLibrary) => {
    try {
      setIsSyncingChanged(true);
      const res = await fetch("/api/dynamic-overlays/sync-changed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_server: targetServer || "all",
          library: targetLib || "all"
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Sync started for modified media items (${(targetServer || "all").toUpperCase()})!`);
        setIsChangeModalOpen(false);
        setIsOverlaySyncRunning(true);
        fetchOverlaySyncStatus();
      } else {
        showError(data.error || "Failed to start sync for changed items.");
      }
    } catch (err) {
      showError("Error triggering changed sync: " + err.message);
    } finally {
      setIsSyncingChanged(false);
    }
  };

  // AniMetaFill Classification Browser State & Handlers
  const [animShows, setAnimShows] = useState([]);
  const [animTotalShows, setAnimTotalShows] = useState(0);
  const [animShowsPage, setAnimShowsPage] = useState(1);
  const [animShowsQuery, setAnimShowsQuery] = useState("");
  const [animShowsCategory, setAnimShowsCategory] = useState("all");
  const [isLoadingAnimShows, setIsLoadingAnimShows] = useState(false);
  const [expandedAnimShow, setExpandedAnimShow] = useState(null);
  const [animEpisodes, setAnimEpisodes] = useState([]);
  const [isLoadingAnimEpisodes, setIsLoadingAnimEpisodes] = useState(false);
  const [isAddAnimeModalOpen, setIsAddAnimeModalOpen] = useState(false);
  const [addAnimeForm, setAddAnimeForm] = useState({
    title: "",
    episodeRange: "",
    category: "canon",
    episodeTitle: ""
  });
  const [isSubmittingAnimeItem, setIsSubmittingAnimeItem] = useState(false);

  const fetchAnimShows = async (page = animShowsPage, query = animShowsQuery, category = animShowsCategory) => {
    try {
      setIsLoadingAnimShows(true);
      const params = new URLSearchParams({
        page: String(page),
        page_size: "15"
      });
      if (query?.trim()) params.append("query", query.trim());
      if (category && category !== "all") params.append("category", category);
      const res = await fetch(`/api/animetafill/shows?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAnimShows(data.shows || []);
        setAnimTotalShows(data.total_shows || 0);
        setAnimShowsPage(data.page || 1);
      }
    } catch (err) {
      console.error("Error fetching anime classification shows:", err);
    } finally {
      setIsLoadingAnimShows(false);
    }
  };

  const handleToggleExpandShow = async (showTitle) => {
    if (expandedAnimShow === showTitle) {
      setExpandedAnimShow(null);
      setAnimEpisodes([]);
      return;
    }
    setExpandedAnimShow(showTitle);
    try {
      setIsLoadingAnimEpisodes(true);
      const res = await fetch(`/api/animetafill/shows/${encodeURIComponent(showTitle)}/episodes`);
      if (res.ok) {
        const data = await res.json();
        setAnimEpisodes(data.episodes || []);
      }
    } catch (err) {
      console.error("Error fetching anime episodes:", err);
    } finally {
      setIsLoadingAnimEpisodes(false);
    }
  };

  const handleUpdateEpisodeCategory = async (showTitle, epNumber, newCategory) => {
    try {
      const res = await fetch("/api/animetafill/episodes/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anime_title: showTitle,
          episode_number: epNumber,
          category: newCategory
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Updated Ep ${epNumber} to ${newCategory.toUpperCase()}`);
        setAnimEpisodes(prev => prev.map(e => e.number === epNumber ? { ...e, category: newCategory } : e));
        fetchAnimShows(animShowsPage);
      } else {
        showError(data.error || "Failed to update episode category");
      }
    } catch (err) {
      showError("Error updating episode: " + err.message);
    }
  };

  const handleUpsertAnimeItem = async (e) => {
    e?.preventDefault?.();
    if (!addAnimeForm.title?.trim() || !addAnimeForm.episodeRange?.trim()) {
      showError("Please enter both show title and episode range (e.g. 1-24).");
      return;
    }
    try {
      setIsSubmittingAnimeItem(true);
      const res = await fetch("/api/animetafill/items/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anime_title: addAnimeForm.title.trim(),
          episode_range: addAnimeForm.episodeRange.trim(),
          category: addAnimeForm.category,
          episode_title: addAnimeForm.episodeTitle?.trim() || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(data.message || "Anime classification saved!");
        setIsAddAnimeModalOpen(false);
        setAddAnimeForm({ title: "", episodeRange: "", category: "canon", episodeTitle: "" });
        fetchAnimShows(1);
      } else {
        showError(data.error || "Failed to save classification");
      }
    } catch (err) {
      showError("Error saving classification: " + err.message);
    } finally {
      setIsSubmittingAnimeItem(false);
    }
  };

  const handleDeleteAnimeShow = async (showTitle) => {
    if (!window.confirm(`Are you sure you want to delete '${showTitle}' from AniMetaFill and remove its overlay block?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/animetafill/shows/${encodeURIComponent(showTitle)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Deleted '${showTitle}' successfully.`);
        if (expandedAnimShow === showTitle) {
          setExpandedAnimShow(null);
          setAnimEpisodes([]);
        }
        fetchAnimShows(animShowsPage);
      } else {
        showError(data.error || "Failed to delete show");
      }
    } catch (err) {
      showError("Error deleting show: " + err.message);
    }
  };

  const fetchServerConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setServerConfig(data.config || {});
      }
    } catch (_) {}
  };

  const handleTogglePlexUpload = async (enable = true) => {
    try {
      setIsUpdatingConfig(true);
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            PlexUpload: enable
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(enable ? "Plex Upload enabled successfully!" : "Plex Upload disabled.");
        fetchServerConfig();
      } else {
        showError(data.detail || "Failed to update configuration.");
      }
    } catch (err) {
      showError("Error updating configuration: " + err.message);
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const isPlexUploadEnabled = Boolean(
    serverConfig?.PlexUpload === true || String(serverConfig?.PlexUpload).toLowerCase() === "true"
  );
  const isPlexUploadExistingEnabled = Boolean(
    serverConfig?.PlexUploadExistingAssets === true || String(serverConfig?.PlexUploadExistingAssets).toLowerCase() === "true"
  );

  const fetchRunStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setSystemRunStatus({
          running: Boolean(data.running),
          current_mode: data.current_mode || null,
          pid: data.pid || null
        });
      }
    } catch (_) {}
  };

  const handleStartApplyRun = async (modeToRun = selectedRunMode) => {
    if (systemRunStatus.running) {
      showError(`Posterizarr is already running in ${systemRunStatus.current_mode || "another"} mode.`);
      return;
    }
    try {
      setIsStartingRun(true);
      if (modeToRun === "plexsync") {
        const res = await fetch("/api/plex/sync/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showSuccess("Started Plex Sync in background! Pushing local assets to Plex.");
          setIsApplyModalOpen(false);
          navigate("/logs", { state: { logFile: "PlexSync.log" } });
        } else {
          showError(data.error || data.detail || "Failed to start Plex sync.");
        }
        return;
      }

      const res = await fetch(`/api/run/${modeToRun}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Started Posterizarr in ${modeToRun} mode (PID: ${data.pid})!`);
        fetchRunStatus();
      } else {
        showError(data.detail || data.message || "Failed to start run.");
      }
    } catch (err) {
      console.error(err);
      showError("Error starting run: " + (err.message || String(err)));
    } finally {
      setIsStartingRun(false);
    }
  };

  const BADGE_DIMS = {
    portrait: {
      resolution: { w: 1000, h: 65 },
      rating: { w: 211, h: 65 },
      status: { w: 920, h: 130 },
      runtime: { w: 205, h: 80 },
      languages: { w: 60, h: 65 },
      network: { w: 200, h: 70 },
      anime: { w: 240, h: 80 },
      age_rating: { w: 120, h: 48 },
      audio_codec: { w: 140, h: 42 },
      video_format: { w: 120, h: 36 }
    },
    landscape: {
      resolution: { w: 240, h: 80 },
      rating: { w: 140, h: 65 },
      status: { w: 1400, h: 110 },
      runtime: { w: 180, h: 65 },
      languages: { w: 80, h: 65 },
      network: { w: 260, h: 85 },
      anime: { w: 280, h: 90 },
      age_rating: { w: 140, h: 55 },
      audio_codec: { w: 160, h: 48 },
      video_format: { w: 140, h: 40 }
    }
  };

  const isLandscapeFormat = (fmt) => fmt === "episode_card" || fmt === "backdrop" || fmt === "background" || fmt === "titlecard";

  const getItemStyle = (itemKey, offset) => {
    const isLandscape = isLandscapeFormat(previewTemplate);
    const canvasW = isLandscape ? 1920 : 1000;
    const canvasH = isLandscape ? 1080 : 1500;
    const align = offset?.align || "left";
    const valign = offset?.valign || "top";
    const ho = Number(offset?.x) || 0;
    const vo = Number(offset?.y) || 0;

    const style = { position: "absolute" };
    let tx = "";
    let ty = "";

    if (align === "left") {
      style.left = `${(ho / canvasW) * 100}%`;
    } else if (align === "right") {
      style.right = `${(ho / canvasW) * 100}%`;
    } else {
      style.left = `calc(50% + ${(ho / canvasW) * 100}%)`;
      tx = "-50%";
    }

    if (valign === "top") {
      style.top = `${(vo / canvasH) * 100}%`;
    } else if (valign === "bottom") {
      style.bottom = `${(vo / canvasH) * 100}%`;
    } else {
      style.top = `calc(50% + ${(vo / canvasH) * 100}%)`;
      ty = "-50%";
    }

    if (tx && ty) {
      style.transform = `translate(${tx}, ${ty})`;
    } else if (tx) {
      style.transform = `translateX(${tx})`;
    } else if (ty) {
      style.transform = `translateY(${ty})`;
    }

    return style;
  };

  const getCanvasCoords = (itemKey, offset) => {
    const isLandscape = isLandscapeFormat(previewTemplate);
    const canvasW = isLandscape ? 1920 : 1000;
    const canvasH = isLandscape ? 1080 : 1500;

    if (!offset) {
      return { x: Math.round(canvasW / 2), y: Math.round(canvasH / 2) };
    }

    const dims = (isLandscape ? BADGE_DIMS.landscape : BADGE_DIMS.portrait)[itemKey] || { w: 200, h: 70 };
    const hw = Math.round(dims.w / 2);
    const hh = Math.round(dims.h / 2);

    const ho = Number(offset.x) || 0;
    const vo = Number(offset.y) || 0;
    let cx = Math.round(canvasW / 2);
    let cy = Math.round(canvasH / 2);

    if (offset.align === "left") {
      cx = ho + hw;
    } else if (offset.align === "right") {
      cx = canvasW - ho - hw;
    } else {
      cx = Math.round(canvasW / 2) + ho;
    }

    if (offset.valign === "top") {
      cy = vo + hh;
    } else if (offset.valign === "bottom") {
      cy = canvasH - vo - hh;
    } else {
      cy = Math.round(canvasH / 2) + vo;
    }

    return {
      x: Math.max(hw, Math.min(canvasW - hw, cx)),
      y: Math.max(hh, Math.min(canvasH - hh, cy))
    };
  };

  const BADGE_NAMES = {
    rating: "Audience Rating",
    runtime: "Runtime",
    age_rating: "Age Rating",
    resolution: "Resolution",
    languages: "Audio Languages",
    network: "Network Logo",
    anime: "Anime Tag",
    status: "Show Status",
    audio_codec: "Audio Codec",
    video_format: "Video Format"
  };

  const getActiveBadges = () => {
    const list = [];
    if (previewRating && previewRating !== "Off") list.push("rating");
    if (previewRuntime && previewRuntime !== "Off") list.push("runtime");
    if (previewAgeRating && previewAgeRating !== "Off") list.push("age_rating");
    if (previewResolution && previewResolution !== "None") list.push("resolution");
    if (previewLanguages && previewLanguages !== "Off") list.push("languages");
    if (previewNetwork && previewNetwork !== "Off") list.push("network");
    if (previewAnimeTag && previewAnimeTag !== "Off" && isLandscapeFormat(previewTemplate)) list.push("anime");
    if (previewStatus) list.push("status");
    if (previewAudioCodec && previewAudioCodec !== "Off") list.push("audio_codec");
    if (previewVideoFormat && previewVideoFormat !== "Off") list.push("video_format");
    return list;
  };

  const getBadgeBounds = (key, customCenter = null) => {
    const isLandscape = isLandscapeFormat(previewTemplate);
    const canvasW = isLandscape ? 1920 : 1000;
    const canvasH = isLandscape ? 1080 : 1500;
    const dims = (isLandscape ? BADGE_DIMS.landscape : BADGE_DIMS.portrait)[key] || { w: 200, h: 70 };
    const hw = dims.w / 2;
    const hh = dims.h / 2;

    let cx, cy;
    if (customCenter) {
      cx = customCenter.x;
      cy = customCenter.y;
    } else {
      const center = getCanvasCoords(key, offsets[key]);
      cx = center.x;
      cy = center.y;
    }

    const left = cx - hw;
    const right = cx + hw;
    const top = cy - hh;
    const bottom = cy + hh;

    return {
      key,
      canvasW,
      canvasH,
      cx,
      cy,
      left,
      right,
      top,
      bottom,
      w: dims.w,
      h: dims.h,
      leftPct: (left / canvasW) * 100,
      rightPct: (right / canvasW) * 100,
      topPct: (top / canvasH) * 100,
      bottomPct: (bottom / canvasH) * 100,
      centerXPct: (cx / canvasW) * 100,
      centerYPct: (cy / canvasH) * 100
    };
  };

  // Modals for Rule Management
  const [selectedYamlFile, setSelectedYamlFile] = useState("config.yml");
  const [isRawYamlOpen, setIsRawYamlOpen] = useState(false);
  const [isYamlFullscreen, setIsYamlFullscreen] = useState(false);
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [rawYamlContent, setRawYamlContent] = useState("");
  const [isSavingYaml, setIsSavingYaml] = useState(false);
  const [yamlError, setYamlError] = useState(null);
  const [isDeletingYaml, setIsDeletingYaml] = useState(false);
  const yamlFileInputRef = useRef(null);

  // Add Overlay Modal
  const [addOverlayModal, setAddOverlayModal] = useState(null); // { libraryName: "TV Shows" }
  const [newOverlayType, setNewOverlayType] = useState("default"); // "default" or "file"
  const [newOverlayName, setNewOverlayName] = useState("network");
  const [newOverlayLevel, setNewOverlayLevel] = useState("season");
  const [isAddingOverlay, setIsAddingOverlay] = useState(false);

  // Add Library Modal
  const [isAddLibraryOpen, setIsAddLibraryOpen] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [isAddingLibrary, setIsAddingLibrary] = useState(false);

  // Edit Variables Modal (Dual Visual + JSON mode)
  const [editVariablesModal, setEditVariablesModal] = useState(null); // { libraryName, overlayIndex, overlay }
  const [editVariablesTab, setEditVariablesTab] = useState("visual"); // "visual" or "json"
  const [editVariablesJson, setEditVariablesJson] = useState("{}");
  const [visualLevel, setVisualLevel] = useState("");
  const [visualHAlign, setVisualHAlign] = useState("center");
  const [visualVAlign, setVisualVAlign] = useState("bottom");
  const [visualHOffset, setVisualHOffset] = useState("0");
  const [visualVOffset, setVisualVOffset] = useState("0");
  const [visualBackColor, setVisualBackColor] = useState("#00000000");
  const [visualLanguages, setVisualLanguages] = useState("de, en, ja");
  const [visualStatusText, setVisualStatusText] = useState("");
  const [visualStatusColor, setVisualStatusColor] = useState("#FFA500");
  const [isSavingVariables, setIsSavingVariables] = useState(false);

  const fileInputRef = useRef(null);

  // 1. Feature Settings (OFF by default)
  const fetchFeatureSettings = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/settings");
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setFeatureSettings(data.settings);
          if (data.settings.wizard_dismissed !== undefined) {
            setHasCompletedWizard(Boolean(data.settings.wizard_dismissed));
          }
        }
      }
    } catch (err) {
      console.error("Failed fetching dynamic overlays settings:", err);
    }
  };

  const fetchLastDetectionReport = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/last-detection-report");
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          setChangeDetectionReport(data);
        }
      }
    } catch (err) {
      console.error("Failed fetching last detection report:", err);
    }
  };

  const handleToggleMasterEnabled = async (nextVal) => {
    try {
      setIsUpdatingFeatureSettings(true);
      const res = await fetch("/api/dynamic-overlays/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextVal })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeatureSettings(data.settings);
        if (nextVal) {
          fetchVisualConfig();
          fetchAllData();
          if (!hasCompletedWizard) {
            setWizardStep(1);
            setIsWizardOpen(true);
          }
        }
      } else {
        showError(data.error || "Failed to update master setting.");
      }
    } catch (err) {
      showError("Error: " + err.message);
    } finally {
      setIsUpdatingFeatureSettings(false);
    }
  };

  const fetchRatingsCacheStats = async () => {
    try {
      const res = await fetch("/api/dynamic-overlays/ratings-cache");
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setRatingsCacheStats(data.stats);
      }
    } catch (_) {}
  };

  const handleClearRatingsCache = async () => {
    try {
      setIsClearingRatingsCache(true);
      const res = await fetch("/api/dynamic-overlays/ratings-cache/clear", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess("Media ratings cache cleared! Fresh ratings will be retrieved on next sync.");
        fetchRatingsCacheStats();
      } else {
        showError(data.error || "Failed to clear ratings cache.");
      }
    } catch (err) {
      showError("Error clearing ratings cache: " + err.message);
    } finally {
      setIsClearingRatingsCache(false);
    }
  };

  const handleUpdateDynamicSettings = async (patch) => {
    try {
      setIsUpdatingFeatureSettings(true);
      const res = await fetch("/api/dynamic-overlays/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeatureSettings(data.settings);
        showSuccess("Settings updated.");
      } else {
        showError(data.error || "Failed to update settings.");
      }
    } catch (err) {
      showError("Error: " + err.message);
    } finally {
      setIsUpdatingFeatureSettings(false);
    }
  };

  const handleTestApiKey = async (provider) => {
    const key = (provider === "mdblist" ? featureSettings?.mdblist_api_key : featureSettings?.omdb_api_key) || "";
    if (!key.trim()) {
      showError(`Please enter an API key for ${provider.toUpperCase()} before testing.`);
      return;
    }
    setTestingApiKey(prev => ({ ...prev, [provider]: true }));
    setApiKeyTestResult(prev => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch("/api/dynamic-overlays/test-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: key.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApiKeyTestResult(prev => ({ ...prev, [provider]: { success: true, message: data.message } }));
        showSuccess(data.message || `${provider.toUpperCase()} key verified!`);
        // If successful and settings aren't saved yet, auto-persist the verified key
        if (provider === "mdblist") {
          handleUpdateDynamicSettings({ mdblist_api_key: key.trim() });
        } else if (provider === "omdb") {
          handleUpdateDynamicSettings({ omdb_api_key: key.trim() });
        }
      } else {
        setApiKeyTestResult(prev => ({ ...prev, [provider]: { success: false, error: data.error || "Verification failed." } }));
        showError(data.error || `Invalid ${provider.toUpperCase()} key.`);
      }
    } catch (err) {
      setApiKeyTestResult(prev => ({ ...prev, [provider]: { success: false, error: err.message } }));
      showError(`Test error: ${err.message}`);
    } finally {
      setTestingApiKey(prev => ({ ...prev, [provider]: false }));
    }
  };

  // 1b. Visual Studio / YAML Translator Handlers
  const fetchVisualConfig = async () => {
    try {
      setIsVisualLoading(true);
      const res = await fetch("/api/dynamic-overlays/visual-config");
      if (res.ok) {
        const data = await res.json();
        if (data.config && data.config.libraries) {
          setVisualConfig(data.config);
          const libKeys = Object.keys(data.config.libraries);
          const savedLib = localStorage.getItem("posterizarr_selected_visual_lib");
          const targetLib = (savedLib && data.config.libraries[savedLib]) ? savedLib : (libKeys[0] || "");
          if (targetLib) {
            setSelectedVisualLib(targetLib);
            setSelectedSaveLibrary(targetLib);
            handleSelectPreviewLibrary(targetLib, data.config);
          }
        }
      }
    } catch (err) {
      console.error("Failed fetching visual configuration:", err);
    } finally {
      setIsVisualLoading(false);
    }
  };

  const handleSaveVisualConfig = async () => {
    try {
      setIsVisualSaving(true);
      const res = await fetch("/api/dynamic-overlays/visual-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: visualConfig })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess("Visual configuration saved and compiled! No YAML edits needed.");
        fetchAllData();
      } else {
        showError(data.error || "Failed to save visual configuration.");
      }
    } catch (err) {
      showError("Error saving visual configuration: " + err.message);
    } finally {
      setIsVisualSaving(false);
    }
  };

  const handleQuickStart = async () => {
    try {
      setIsQuickStarting(true);
      const res = await fetch("/api/dynamic-overlays/quick-start", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(data.message || "Turnkey overlays configured successfully!");
        if (data.scan) setScanData(data.scan);
        if (data.config) {
          setVisualConfig(data.config);
          const libKeys = Object.keys(data.config.libraries || {});
          if (libKeys.length > 0) {
            const firstLib = libKeys[0];
            setSelectedVisualLib(firstLib);
            setSelectedSaveLibrary(firstLib);
            try { localStorage.setItem("posterizarr_selected_visual_lib", firstLib); } catch {}
            handleSelectPreviewLibrary(firstLib);
          }
        }
      } else {
        showError(data.detail || data.error || "Failed to configure Quick Start");
      }
    } catch (err) {
      console.error(err);
      showError("Quick Start error: " + (err.message || String(err)));
    } finally {
      setIsQuickStarting(false);
    }
  };

  const handleImportYamlSubmit = async () => {
    if (!importYamlText.trim()) {
      showError("Please paste YAML configuration content to import.");
      return;
    }
    try {
      setIsImportingYaml(true);
      const res = await fetch("/api/dynamic-overlays/import-yaml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml_text: importYamlText })
      });
      const data = await res.json();
      if (res.ok && data.success && data.config) {
        setVisualConfig(data.config);
        if (data.settings) {
          setFeatureSettings(data.settings);
        } else {
          await fetchFeatureSettings();
        }
        const libKeys = Object.keys(data.config.libraries || {});
        if (libKeys.length > 0) {
          const firstLib = libKeys[0];
          setSelectedVisualLib(firstLib);
          setSelectedSaveLibrary(firstLib);
          try { localStorage.setItem("posterizarr_selected_visual_lib", firstLib); } catch {}
          handleSelectPreviewLibrary(firstLib);
        }
        setIsImportModalOpen(false);
        setImportYamlText("");
        const extracted = data.extracted_keys || [];
        const extractedNames = [];
        if (extracted.includes("mdblist_api_key")) extractedNames.push("MDBList");
        if (extracted.includes("omdb_api_key")) extractedNames.push("OMDb");
        const extraNote = extractedNames.length > 0 ? ` (Imported ${extractedNames.join(" & ")} API key${extractedNames.length > 1 ? "s" : ""})` : "";
        showSuccess(`YAML successfully translated and saved into visual controls!${extraNote}`);
      } else {
        showError(data.error || "Failed to parse and translate YAML.");
      }
    } catch (err) {
      showError("Import error: " + err.message);
    } finally {
      setIsImportingYaml(false);
    }
  };

  // Initial Load / Refresh
  const fetchAllData = async (isInitial = false) => {
    try {
      if (isInitial) {
        setLoading(true);
      }
      const [resStatus, resScan, resCache, resSched] = await Promise.all([
        fetch("/api/dynamic-overlays/status"),
        fetch("/api/dynamic-overlays/scan"),
        fetch("/api/dynamic-overlays/cache"),
        fetch("/api/scheduler/config").catch(() => null)
      ]);

      if (resStatus.ok) {
        const s = await resStatus.json();
        setStatusData(s);
      }
      if (resScan.ok) {
        const sc = await resScan.json();
        setScanData(sc);
      }
      if (resCache.ok) {
        const c = await resCache.json();
        setCacheData(c);
      }
      if (resSched && resSched.ok) {
        const sched = await resSched.json();
        setSchedulerConfig(sched);
      }
      await Promise.all([
        fetchFeatureSettings(),
        fetchVisualConfig(),
        fetchRatingsCacheStats(),
        fetchLastDetectionReport()
      ]);
    } catch (err) {
      console.error("Failed fetching dynamic overlays data:", err);
      showToast(t("dynamicOverlays.errorLoad", "Failed to load dynamic overlays status"), "error");
    } finally {
      setLoading(false);
    }
  };

  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const isAnimetafillRunningRef = useRef(isAnimetafillRunning);
  useEffect(() => {
    isAnimetafillRunningRef.current = isAnimetafillRunning;
  }, [isAnimetafillRunning]);

  useEffect(() => {
    fetchAllData(true);
    fetchRunStatus();
    fetchServerConfig();
    fetchWebUISettings();
    fetchOverlaySyncStatus();
    fetchAnimetafillData();
    const interval = setInterval(() => {
      fetchRunStatus();
      fetchOverlaySyncStatus();
      if (activeTabRef.current === "anime" || isAnimetafillRunningRef.current) {
        fetchAnimetafillStatus();
      }
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "anime") {
      fetchAnimShows(1);
    }
  }, [activeTab]);

  const overlaySchedule = schedulerConfig?.schedules?.find(
    (s) => ["overlaydefaults", "overlay_defaults", "kometadefaults", "kometa_defaults"].includes((s.mode || "").toLowerCase())
  );
  const isDefaultsScheduled = Boolean(schedulerConfig?.enabled && overlaySchedule);

  const getScheduleDescription = (sch) => {
    if (!sch) return "";
    if (sch.frequency === "interval") return `Every ${sch.interval_value || 1} ${sch.interval_unit || "hours"}`;
    const time = sch.time || "03:00";
    if (sch.frequency === "weekly") {
      const days = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
      const day = days[sch.day_of_week] || sch.day_of_week || "Sun";
      return `Weekly (${day} @ ${time})`;
    }
    if (sch.frequency === "monthly") return `Monthly (Day ${sch.day || 1} @ ${time})`;
    return `Daily @ ${time}`;
  };

  const handleQuickSchedule = async () => {
    try {
      setIsQuickScheduling(true);
      const schedPayload = {
        time: "03:00",
        description: "Weekly Overlay Defaults Update from GitHub",
        mode: "overlaydefaults",
        frequency: "weekly",
        day_of_week: "sun",
        day: "*",
        month: "*"
      };
      const res = await fetch("/api/scheduler/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedPayload)
      });
      if (res.ok) {
        if (!schedulerConfig?.enabled) {
          await fetch("/api/scheduler/enable", { method: "POST" });
        }
        showSuccess("Scheduled weekly overlay defaults update (Sunday @ 03:00)");
        await fetchAllData();
      } else {
        const err = await res.json().catch(() => ({}));
        showError(err.detail || "Failed to schedule overlay defaults update");
      }
    } catch (err) {
      console.error("Error scheduling defaults update:", err);
      showError("Failed to schedule overlay defaults update");
    } finally {
      setIsQuickScheduling(false);
    }
  };

  // AniMetaFill Handlers
  const fetchMediaServerLibraries = async (serverType, forceRefresh = false) => {
    const srv = (serverType || animetafillConfig?.media_server || "plex").toLowerCase();
    try {
      setIsLoadingAnimLibraries(true);
      const res = await fetch(`/api/libraries/${srv}/cached?refresh=${forceRefresh ? "true" : "false"}`);
      if (res.ok) {
        const data = await res.json();
        if (data.libraries) {
          setAnimetafillLibraries(data.libraries);
          // If no target libraries are configured yet, preselect ONLY libraries whose type is strictly "show"
          setAnimetafillConfig(prev => {
            if (!prev) return prev;
            const currentSelected = prev.target_libraries || prev.plex_libraries || [];
            if (currentSelected.length === 0) {
              const showLibs = data.libraries
                .filter(l => (l.type || "").toLowerCase() === "show")
                .map(l => l.name);
              if (showLibs.length > 0) {
                return { ...prev, target_libraries: showLibs, plex_libraries: showLibs };
              }
            }
            return prev;
          });
        }
      }
    } catch (e) {
      console.debug("Failed fetching server libraries:", e);
    } finally {
      setIsLoadingAnimLibraries(false);
    }
  };

  const fetchAnimetafillStatus = async () => {
    try {
      const resStat = await fetch("/api/animetafill/status");
      if (resStat.ok) {
        const s = await resStat.json();
        setAnimetafillStatus(s);
        setIsAnimetafillRunning(Boolean(s.is_running));
      }
    } catch (e) {
      console.debug("Failed fetching AniMetaFill status:", e);
    }
  };

  const fetchAnimetafillData = async () => {
    try {
      const [resCfg, resStat] = await Promise.all([
        fetch("/api/animetafill/config"),
        fetch("/api/animetafill/status")
      ]);
      if (resCfg.ok) {
        const c = await resCfg.json();
        if (c.config) {
          setAnimetafillConfig(c.config);
          fetchMediaServerLibraries(c.config.media_server || "plex");
        }
      }
      if (resStat.ok) {
        const s = await resStat.json();
        setAnimetafillStatus(s);
        setIsAnimetafillRunning(Boolean(s.is_running));
      }
    } catch (e) {
      console.debug("Failed fetching AniMetaFill data:", e);
    }
  };

  const handleSelectMediaServer = (serverType) => {
    if (!animetafillConfig) return;
    setAnimetafillConfig(prev => ({
      ...prev,
      media_server: serverType
    }));
    fetchMediaServerLibraries(serverType);
  };

  const handleToggleTargetLibrary = (libName) => {
    if (!animetafillConfig) return;
    const current = animetafillConfig.target_libraries || animetafillConfig.plex_libraries || [];
    let updated;
    if (current.includes(libName)) {
      updated = current.filter(l => l !== libName);
    } else {
      updated = [...current, libName];
    }
    setAnimetafillConfig({
      ...animetafillConfig,
      target_libraries: updated,
      plex_libraries: updated
    });
  };

  const handleTestSonarr = async () => {
    if (!animetafillConfig?.sonarr_url?.trim() || !animetafillConfig?.sonarr_api_key?.trim()) {
      showToast("Please enter both Sonarr URL and API Key first to test", "warning");
      return;
    }
    try {
      setIsTestingSonarr(true);
      setSonarrTestResult(null);
      const res = await fetch("/api/animetafill/test-sonarr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: animetafillConfig?.sonarr_url || "",
          api_key: animetafillConfig?.sonarr_api_key || ""
        })
      });
      const data = await res.json();
      setSonarrTestResult(data);
      if (data.success) {
        showToast(data.message || "Connected to Sonarr successfully!", "success");
      } else {
        showToast(data.message || data.error || "Failed to connect to Sonarr", "error");
      }
    } catch (e) {
      setSonarrTestResult({ success: false, message: `Request error: ${e.message}` });
      showToast("Error testing Sonarr connection", "error");
    } finally {
      setIsTestingSonarr(false);
    }
  };

  const handleToggleAnimetafill = async (newVal) => {
    try {
      setAnimetafillConfig(prev => ({ ...(prev || {}), enabled: newVal }));
      const res = await fetch("/api/animetafill/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newVal })
      });
      if (res.ok) {
        showToast(newVal ? "AniMetaFill enabled" : "AniMetaFill disabled", "success");
        fetchAnimetafillData();
      }
    } catch (e) {
      showToast("Error updating AniMetaFill setting", "error");
    }
  };

  const handleSaveAnimetafillConfig = async () => {
    if (!animetafillConfig) return;
    if (!animetafillConfig.simkl_client_id || !animetafillConfig.simkl_client_id.trim()) {
      showToast("SIMKL Client ID is required for AniMetaFill synchronization", "warning");
      return;
    }
    try {
      setIsAnimetafillSaving(true);
      const res = await fetch("/api/animetafill/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(animetafillConfig)
      });
      if (res.ok) {
        showToast("AniMetaFill settings saved to config.db successfully", "success");
        fetchAnimetafillData();
      } else {
        showToast("Failed to save AniMetaFill settings", "error");
      }
    } catch (e) {
      showToast("Error saving AniMetaFill settings", "error");
    } finally {
      setIsAnimetafillSaving(false);
    }
  };

  const handleRunAnimetafill = async () => {
    if (!animetafillConfig?.simkl_client_id || !animetafillConfig.simkl_client_id.trim()) {
      showToast("Cannot start sync: SIMKL Client ID is required. Please enter and save your SIMKL Client ID first.", "warning");
      return;
    }
    try {
      setIsAnimetafillRunning(true);
      const res = await fetch(`/api/animetafill/run?force=${animetafillForce ? "true" : "false"}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        showToast("AniMetaFill synchronization started in background", "success");
      } else {
        showToast(data.error || "Failed starting AniMetaFill sync", "error");
      }
    } catch (e) {
      showToast("Error triggering AniMetaFill sync", "error");
    } finally {
      setTimeout(fetchAnimetafillData, 1500);
    }
  };

  // 2. Scan / Recheck
  const handleScan = async () => {
    try {
      setIsScanning(true);
      const res = await fetch("/api/dynamic-overlays/scan");
      if (res.ok) {
        const sc = await res.json();
        setScanData(sc);
        showToast(t("dynamicOverlays.scanSuccess", "Scan completed successfully"), "success");
      } else {
        showToast(t("dynamicOverlays.scanFailed", "Scan failed"), "error");
      }
    } catch (err) {
      console.error(err);
      showToast(t("dynamicOverlays.scanError", "Error connecting to server"), "error");
    } finally {
      setIsScanning(false);
    }
  };

  // 3. Import Overlay Template Defaults (from repository)
  const handleImport = async (overwrite = true) => {
    try {
      setIsImporting(true);
      const res = await fetch("/api/dynamic-overlays/import-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite })
      });
      const data = await res.json();
      if (data.success) {
        const imp = data.import_result || {};
        const count = imp.count || 0;
        const newCount = imp.new?.length || 0;
        const updatedCount = imp.updated?.length || 0;
        const total = imp.total_available || 25;
        let msg = "";
        if (newCount > 0 && updatedCount > 0) {
          msg = `Overlay Templates: ${newCount} newly added, ${updatedCount} updated (${total} total templates).`;
        } else if (newCount > 0) {
          msg = `Overlay Templates: Downloaded ${newCount} new templates (${total} total).`;
        } else if (updatedCount > 0) {
          msg = `Overlay Templates: Updated ${updatedCount} templates to latest upstream versions (${total} total).`;
        } else if (count > 0) {
          msg = `Imported ${count} official overlay templates into Overlayfiles/dynamic_overlays/defaults/`;
        } else {
          msg = `All ${total} official overlay templates are already downloaded and up to date.`;
        }
        showSuccess(msg);
        await fetchAllData();
      } else {
        showError(data.error || "Import failed");
      }
    } catch (err) {
      console.error(err);
      showError("Error importing overlay templates from repository");
    } finally {
      setIsImporting(false);
    }
  };

  // 4. Fetch Single Asset
  const handleFetchAsset = async (asset) => {
    try {
      setFetchingAsset(asset.name);
      const res = await fetch("/api/dynamic-overlays/fetch-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_name: asset.name,
          category: asset.category,
          custom_url: asset.download_url
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(t("dynamicOverlays.assetFetched", `Ready: ${asset.name}`), "success");
        handleScan();
      } else {
        showToast(data.error || `Failed fetching ${asset.name}`, "error");
      }
    } catch (err) {
      console.error(err);
      showToast(`Error fetching ${asset.name}`, "error");
    } finally {
      setFetchingAsset(null);
    }
  };

  // 5. Batch Fetch All Missing
  const handleBatchFetch = async () => {
    try {
      setIsBatchFetching(true);
      const res = await fetch("/api/dynamic-overlays/fetch-all-missing", {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        showToast(t("dynamicOverlays.batchSuccess", `Downloaded / seeded ${data.downloaded_count || 0} assets!`), "success");
        await fetchAllData();
      } else {
        showToast(data.error || "Batch fetch failed", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error batch fetching assets", "error");
    } finally {
      setIsBatchFetching(false);
    }
  };

  // 6. Custom File Upload (Multi-file enabled)
  const handleFileUpload = async (e, defaultCategory = "image") => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;

    try {
      setIsUploading(true);
      const formData = new FormData();
      fileList.forEach((file) => {
        formData.append("files", file);
      });
      if (defaultCategory) {
        formData.append("category", defaultCategory);
      }

      const res = await fetch("/api/dynamic-overlays/upload-asset", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const count = data.count || fileList.length;
        const extracted = data.extracted_keys || [];
        const extractedNames = [];
        if (extracted.includes("mdblist_api_key")) extractedNames.push("MDBList");
        if (extracted.includes("omdb_api_key")) extractedNames.push("OMDb");
        const extraNote = extractedNames.length > 0 ? ` (Imported ${extractedNames.join(" & ")} API key${extractedNames.length > 1 ? "s" : ""})` : "";
        if (count === 1) {
          const fname = data.saved_files?.[0]?.filename || fileList[0].name;
          const cat = data.saved_files?.[0]?.category || "asset";
          const folderName = cat === "config" ? "configs" : (cat === "font" ? "fonts" : "assets");
          showSuccess(`Uploaded ${fname} to Overlayfiles/dynamic_overlays/${folderName}/${extraNote}`);
        } else {
          showSuccess(`Successfully uploaded ${count} files to Overlayfiles/dynamic_overlays/!${extraNote}`);
        }
        await fetchAllData();
      } else {
        const errorMsg = data.detail || data.error || (data.errors && data.errors.join("; ")) || "Upload failed";
        showError(errorMsg);
      }
    } catch (err) {
      console.error("Error uploading file:", err);
      showError("Error uploading file: " + (err.message || String(err)));
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (yamlFileInputRef.current) yamlFileInputRef.current.value = "";
    }
  };

  // 6a-wizard. Multi-Config Upload Handler for Setup Wizard
  const handleWizardMultiUpload = async (e) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;

    try {
      setIsWizardUploading(true);
      const formData = new FormData();
      fileList.forEach((file) => {
        formData.append("files", file);
      });
      formData.append("category", "config");

      const res = await fetch("/api/dynamic-overlays/upload-asset", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const count = data.count || fileList.length;
        const saved = data.saved_files || [];
        setWizardUploadedFiles(prev => [...prev, ...saved.map(f => f.filename)]);
        const extracted = data.extracted_keys || [];
        if (extracted.length > 0) {
          setWizardExtractedKeys(prev => Array.from(new Set([...prev, ...extracted])));
        }
        showSuccess(`Successfully imported ${count} Kometa configuration file${count > 1 ? "s" : ""}!`);
        await fetchAllData();
      } else {
        const errorMsg = data.detail || data.error || (data.errors && data.errors.join("; ")) || "Upload failed";
        showError(errorMsg);
      }
    } catch (err) {
      console.error("Error uploading wizard files:", err);
      showError("Error uploading files: " + (err.message || String(err)));
    } finally {
      setIsWizardUploading(false);
      if (e.target) e.target.value = "";
      if (wizardFileInputRef.current) wizardFileInputRef.current.value = "";
    }
  };

  // 6b. Delete Config / Overlay YAML file
  const handleDeleteYamlFile = async (filename) => {
    if (filename === "config.yml" || filename === "config.yaml") {
      if (!window.confirm(`Warning: ${filename} is the primary overlay configuration file! Deleting it may reset your library configurations. Are you sure you want to proceed? (A backup will be saved).`)) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to delete ${filename}? (A backup will be saved).`)) {
        return;
      }
    }

    try {
      setIsDeletingYaml(true);
      const res = await fetch(`/api/dynamic-overlays/config-file?filename=${encodeURIComponent(filename)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Deleted ${filename} (backup preserved)`);
        await fetchAllData();
      } else {
        showError(data.error || `Failed to delete ${filename}`);
      }
    } catch (err) {
      console.error("Error deleting config file:", err);
      showError("Error deleting file: " + (err.message || String(err)));
    } finally {
      setIsDeletingYaml(false);
    }
  };

  // 7. Clear Overlay Push Cache
  const handleClearCache = () => {
    setIsClearCacheModalOpen(true);
  };

  const executeClearOverlayCache = async () => {
    try {
      setIsClearingOverlayCache(true);
      const res = await fetch("/api/dynamic-overlays/cache/clear", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Cleared ${data.deleted_count ?? 0} cached dynamic overlay records.`);
        setIsClearCacheModalOpen(false);
        const resCache = await fetch("/api/dynamic-overlays/cache");
        if (resCache.ok) setCacheData(await resCache.json());
        fetchOverlayCacheItems(1);
        fetchAllData();
      } else {
        showError(data.error || "Failed to clear dynamic overlay cache.");
      }
    } catch (err) {
      console.error("Error clearing overlay cache:", err);
      showError("Error clearing cache: " + (err.message || String(err)));
    } finally {
      setIsClearingOverlayCache(false);
    }
  };

  // --- OVERLAY CACHE BROWSER HANDLERS ---
  const fetchOverlayCacheItems = async (
    page = overlayCachePage,
    search = overlayCacheSearch,
    server = overlayCacheServer,
    assetType = overlayCacheAssetType,
    limit = overlayCacheLimit
  ) => {
    try {
      setOverlayCacheLoading(true);
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("limit", limit);
      if (search && search.trim()) params.set("search", search.trim());
      if (server && server !== "all") params.set("server_type", server);
      if (assetType && assetType !== "all") params.set("asset_type", assetType);

      const res = await fetch(`/api/dynamic-overlays/cache/entries?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setOverlayCacheItems(data.entries || []);
        setOverlayCacheTotal(data.total || 0);
        setOverlayCacheTotalPages(data.total_pages || 1);
        setOverlayCachePage(page);
      } else {
        showError(data.error || "Failed to load overlay cache records");
      }
    } catch (err) {
      console.error("Error fetching overlay cache:", err);
      showError("Error loading overlay cache: " + err.message);
    } finally {
      setOverlayCacheLoading(false);
    }
  };

  const handleDeleteOverlayCacheEntry = async (entry) => {
    const title = entry.item_title || entry.item_id || "entry";
    if (!window.confirm(`Remove "${title}" (${entry.asset_type || "poster"}) from the overlay cache?\n\nThis will cause Posterizarr to re-composite and re-upload this artwork on the next sync.`)) {
      return;
    }
    try {
      setDeletingOverlayCacheId(entry.id);
      const res = await fetch(`/api/dynamic-overlays/cache/entry/${entry.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Removed "${title}" from cache.`);
        fetchOverlayCacheItems(overlayCachePage, overlayCacheSearch, overlayCacheServer, overlayCacheAssetType, overlayCacheLimit);
        const resCache = await fetch("/api/dynamic-overlays/cache");
        if (resCache.ok) setCacheData(await resCache.json());
      } else {
        showError(data.error || "Failed to delete cache record.");
      }
    } catch (err) {
      showError("Error removing entry: " + err.message);
    } finally {
      setDeletingOverlayCacheId(null);
    }
  };

  useEffect(() => {
    if (!isOverlayCacheModalOpen) return;
    const timer = setTimeout(() => {
      fetchOverlayCacheItems(1, overlayCacheSearch, overlayCacheServer, overlayCacheAssetType, overlayCacheLimit);
    }, 300);
    return () => clearTimeout(timer);
  }, [overlayCacheSearch, overlayCacheServer, overlayCacheAssetType, overlayCacheLimit, isOverlayCacheModalOpen]);

  // --- RATINGS CACHE BROWSER HANDLERS ---
  const fetchRatingsCacheItems = async (
    page = ratingsCachePage,
    search = ratingsCacheSearch,
    server = ratingsCacheServer,
    mediaType = ratingsCacheMediaType,
    status = ratingsCacheStatus,
    showStatus = ratingsCacheShowStatus,
    limit = ratingsCacheLimit
  ) => {
    try {
      setRatingsCacheLoading(true);
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("limit", limit);
      if (search && search.trim()) params.set("search", search.trim());
      if (server && server !== "all") params.set("server_type", server);
      if (mediaType && mediaType !== "all") params.set("media_type", mediaType);
      if (status && status !== "all") params.set("status", status);
      if (showStatus && showStatus !== "all") params.set("show_status", showStatus);

      const res = await fetch(`/api/dynamic-overlays/ratings-cache/entries?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRatingsCacheItems(data.entries || []);
        setRatingsCacheTotal(data.total || 0);
        setRatingsCacheTotalPages(data.total_pages || 1);
        setRatingsCachePage(page);
        if (data.stats) {
          setRatingsCacheStatsSummary(data.stats);
          setRatingsCacheStats(data.stats);
        }
      } else {
        showError(data.error || "Failed to load ratings cache");
      }
    } catch (err) {
      console.error("Error fetching ratings cache:", err);
      showError("Error loading ratings cache: " + err.message);
    } finally {
      setRatingsCacheLoading(false);
    }
  };

  const handleDeleteRatingsCacheEntry = async (entry) => {
    const title = entry.title || entry.item_id || "item";
    if (!window.confirm(`Remove cached ratings for "${title}"?\n\nPosterizarr will query fresh scores from metadata & APIs on the next sync.`)) {
      return;
    }
    try {
      setActionRatingCacheId(entry.id);
      const res = await fetch(`/api/dynamic-overlays/ratings-cache/entry/${entry.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Deleted cached ratings for "${title}".`);
        fetchRatingsCacheItems(ratingsCachePage, ratingsCacheSearch, ratingsCacheServer, ratingsCacheMediaType, ratingsCacheStatus, ratingsCacheShowStatus, ratingsCacheLimit);
        fetchRatingsCacheStats();
      } else {
        showError(data.error || "Failed to delete rating record.");
      }
    } catch (err) {
      showError("Error deleting rating: " + err.message);
    } finally {
      setActionRatingCacheId(null);
    }
  };

  const handleExpireRatingsCacheEntry = async (entry) => {
    const title = entry.title || entry.item_id || "item";
    try {
      setActionRatingCacheId(entry.id);
      const res = await fetch(`/api/dynamic-overlays/ratings-cache/expire/${entry.id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Marked "${title}" as expired. Fresh ratings will be pulled on next sync.`);
        fetchRatingsCacheItems(ratingsCachePage, ratingsCacheSearch, ratingsCacheServer, ratingsCacheMediaType, ratingsCacheStatus, ratingsCacheShowStatus, ratingsCacheLimit);
        fetchRatingsCacheStats();
      } else {
        showError(data.error || "Failed to expire rating record.");
      }
    } catch (err) {
      showError("Error expiring rating: " + err.message);
    } finally {
      setActionRatingCacheId(null);
    }
  };

  useEffect(() => {
    if (!isRatingsCacheModalOpen) return;
    const timer = setTimeout(() => {
      fetchRatingsCacheItems(1, ratingsCacheSearch, ratingsCacheServer, ratingsCacheMediaType, ratingsCacheStatus, ratingsCacheShowStatus, ratingsCacheLimit);
    }, 300);
    return () => clearTimeout(timer);
  }, [ratingsCacheSearch, ratingsCacheServer, ratingsCacheMediaType, ratingsCacheStatus, ratingsCacheShowStatus, ratingsCacheLimit, isRatingsCacheModalOpen]);


  // 8. Open Raw YAML Editor
  const handleOpenRawYaml = async (filename = "config.yml") => {
    try {
      const targetName = typeof filename === "string" ? filename : "config.yml";
      setSelectedYamlFile(targetName);
      setYamlError(null);
      const res = await fetch(`/api/dynamic-overlays/config-content?filename=${encodeURIComponent(targetName)}`);
      const data = await res.json();
      if (data.success) {
        setRawYamlContent(data.content || "");
        setIsRawYamlOpen(true);
      } else {
        showToast(data.error || `Failed to load ${targetName}`, "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to fetch YAML content", "error");
    }
  };

  // 9. Save Raw YAML
  const handleSaveRawYaml = async () => {
    try {
      setIsSavingYaml(true);
      setYamlError(null);
      const res = await fetch("/api/dynamic-overlays/config-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: selectedYamlFile, content: rawYamlContent })
      });
      const data = await res.json();
      if (data.success) {
        showToast(t("dynamicOverlays.yamlSaved", `${selectedYamlFile} saved successfully! Backup created.`), "success");
        setIsRawYamlOpen(false);
        await fetchAllData();
      } else {
        setYamlError(data.error || "Failed saving YAML");
      }
    } catch (err) {
      console.error(err);
      setYamlError("Network error while saving YAML");
    } finally {
      setIsSavingYaml(false);
    }
  };

  // 10. Remove Rule from Library
  const handleRemoveOverlay = async (libraryName, overlayIndex, overlayName) => {
    if (!window.confirm(`Are you sure you want to remove overlay '${overlayName}' from '${libraryName}'?`)) {
      return;
    }
    try {
      const res = await fetch("/api/dynamic-overlays/rules/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library_name: libraryName, overlay_index: overlayIndex })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Removed overlay from ${libraryName}.`, "success");
        if (data.scan) setScanData(data.scan);
      } else {
        showToast(data.error || "Failed to remove overlay", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error removing overlay rule", "error");
    }
  };

  // 11. Add Rule to Library
  const handleAddOverlay = async () => {
    if (!addOverlayModal?.libraryName) return;
    try {
      setIsAddingOverlay(true);
      const variables = {};
      if (newOverlayLevel) variables.builder_level = newOverlayLevel;

      const res = await fetch("/api/dynamic-overlays/rules/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          library_name: addOverlayModal.libraryName,
          overlay_type: newOverlayType,
          overlay_name: newOverlayName,
          template_variables: variables
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Added ${newOverlayName} to ${addOverlayModal.libraryName}!`, "success");
        setAddOverlayModal(null);
        if (data.scan) setScanData(data.scan);
      } else {
        showToast(data.error || "Failed to add overlay", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adding overlay", "error");
    } finally {
      setIsAddingOverlay(false);
    }
  };

  // 12. Add Library Handler
  const handleAddLibrary = async () => {
    if (!newLibraryName.trim()) return;
    try {
      setIsAddingLibrary(true);
      const res = await fetch("/api/dynamic-overlays/libraries/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library_name: newLibraryName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Added library '${newLibraryName.trim()}' to config.yml!`, "success");
        setIsAddLibraryOpen(false);
        setNewLibraryName("");
        if (data.scan) setScanData(data.scan);
      } else {
        showToast(data.error || "Failed to add library", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adding library", "error");
    } finally {
      setIsAddingLibrary(false);
    }
  };

  // 13. Remove Library Handlers (Themed Modal & Multi-Removal)
  const handleOpenRemoveLibrary = (libraryName) => {
    setRemoveLibraryModal({
      isOpen: true,
      librariesToRemove: [libraryName]
    });
  };

  const handleOpenBatchRemoveLibraries = () => {
    if (!selectedLibraries.length) return;
    setRemoveLibraryModal({
      isOpen: true,
      librariesToRemove: [...selectedLibraries]
    });
  };

  const handleConfirmRemoveLibraries = async () => {
    const toRemove = removeLibraryModal.librariesToRemove || [];
    if (!toRemove.length) return;

    setIsRemovingLibraries(true);
    try {
      const res = await fetch("/api/dynamic-overlays/libraries/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library_names: toRemove })
      });
      const data = await res.json();
      if (data.success) {
        const count = data.removed_count || toRemove.length;
        showToast(
          count === 1
            ? `Removed library section '${toRemove[0]}'.`
            : `Removed ${count} library sections.`,
          "success"
        );
        setSelectedLibraries(prev => prev.filter(name => !toRemove.includes(name)));
        setRemoveLibraryModal({ isOpen: false, librariesToRemove: [] });
        if (data.scan) setScanData(data.scan);
      } else {
        showToast(data.error || "Failed to remove library section(s)", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error removing library section(s)", "error");
    } finally {
      setIsRemovingLibraries(false);
    }
  };

  // 14. Open Edit Variables (prefills visual & json states)
  const handleOpenEditVariables = (libName, oIdx, ov) => {
    setEditVariablesModal({
      libraryName: libName,
      overlayIndex: oIdx,
      overlay: ov
    });
    setEditVariablesTab("visual");
    const vars = ov.variables || {};
    setEditVariablesJson(JSON.stringify(vars, null, 2));
    setVisualLevel(vars.builder_level || "");
    setVisualHAlign(vars.horizontal_align || vars.horizontal_position || "center");
    setVisualVAlign(vars.vertical_align || vars.vertical_position || "bottom");
    setVisualHOffset(vars.horizontal_offset !== undefined ? String(vars.horizontal_offset) : "0");
    setVisualVOffset(vars.vertical_offset !== undefined ? String(vars.vertical_offset) : "0");
    setVisualBackColor(vars.back_color || "#00000000");
    setVisualLanguages(Array.isArray(vars.languages) ? vars.languages.join(", ") : "de, en, ja");
    setVisualStatusText(vars.text || vars.status_label || vars.status || "");
    setVisualStatusColor(vars.font_color || vars.status_color || "#FFA500");
  };

  // 15. Save Edited Variables
  const handleSaveVariables = async () => {
    if (!editVariablesModal) return;
    try {
      let finalVariables = {};
      if (editVariablesTab === "visual") {
        try {
          finalVariables = JSON.parse(editVariablesJson);
        } catch (e) {
          finalVariables = {};
        }
        if (visualLevel) finalVariables.builder_level = visualLevel;
        else delete finalVariables.builder_level;
        finalVariables.horizontal_align = visualHAlign;
        finalVariables.vertical_align = visualVAlign;
        if (visualHOffset !== "") finalVariables.horizontal_offset = Number(visualHOffset) || 0;
        if (visualVOffset !== "") finalVariables.vertical_offset = Number(visualVOffset) || 0;
        if (visualBackColor) finalVariables.back_color = visualBackColor;
        if (editVariablesModal.overlay.name.toLowerCase().includes("lang")) {
          finalVariables.languages = visualLanguages.split(",").map(s => s.trim()).filter(Boolean);
        }
        if (editVariablesModal.overlay.name.toLowerCase().includes("status") || visualStatusText) {
          if (visualStatusText) finalVariables.text = visualStatusText;
          if (visualStatusColor) finalVariables.font_color = visualStatusColor;
        }
      } else {
        try {
          finalVariables = JSON.parse(editVariablesJson);
        } catch (e) {
          showToast("Invalid JSON formatting for variables", "error");
          return;
        }
      }

      setIsSavingVariables(true);
      const res = await fetch("/api/dynamic-overlays/rules/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          library_name: editVariablesModal.libraryName,
          overlay_index: editVariablesModal.overlayIndex,
          template_variables: finalVariables
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Updated template variables!", "success");
        setEditVariablesModal(null);
        if (data.scan) setScanData(data.scan);
      } else {
        showToast(data.error || "Failed updating variables", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error saving variables", "error");
    } finally {
      setIsSavingVariables(false);
    }
  };

  // 16. Drag-and-drop Layout Handlers
  const dragInfo = useRef(null);
  const previewDebounceTimer = useRef(null);

  const triggerPreviewRefresh = (delay = 300) => {
    if (previewDebounceTimer.current) {
      clearTimeout(previewDebounceTimer.current);
    }
    if (delay === 0) {
      setPreviewTimestamp(Date.now());
    } else {
      previewDebounceTimer.current = setTimeout(() => {
        setPreviewTimestamp(Date.now());
      }, delay);
    }
  };

  const handleOffsetChange = (itemKey, updatedOffset, isImmediate = false) => {
    setOffsets(prev => ({
      ...prev,
      [itemKey]: updatedOffset
    }));

    setVisualConfig(prev => {
      const activeLib = selectedSaveLibrary || selectedVisualLib;
      if (!prev?.libraries?.[activeLib]?.badges) return prev;
      const nextLibs = { ...prev.libraries };
      const curLib = { ...nextLibs[activeLib] };
      const curBadges = { ...curLib.badges };
      const badgeKeyMap = {
        rating: "rating",
        runtime: "runtime",
        status: "status",
        resolution: "resolution",
        languages: "audio_languages",
        network: "network",
        anime: "anime",
        age_rating: "age_rating",
        audio_codec: "audio_codec",
        video_format: "video_format"
      };
      const targetBadge = badgeKeyMap[itemKey] || itemKey;
      if (curBadges[targetBadge]) {
        curBadges[targetBadge] = {
          ...curBadges[targetBadge],
          offset_x: updatedOffset.x,
          offset_y: updatedOffset.y,
          position: `${updatedOffset.valign || "bottom"}-${updatedOffset.align || "center"}`,
          ...(itemKey === "resolution" ? {
            mode: updatedOffset.mode || (updatedOffset.banner_4k ? "banner" : "corner_badge"),
            banner_4k: updatedOffset.mode === "banner" || Boolean(updatedOffset.banner_4k),
            back_color: updatedOffset.back_color,
            back_radius: updatedOffset.back_radius,
            back_width: updatedOffset.back_width,
            back_height: updatedOffset.back_height
          } : {}),
          ...(itemKey === "runtime" && updatedOffset.font_size ? {
            font_size: updatedOffset.font_size
          } : {})
        };
        curLib.badges = curBadges;
        nextLibs[activeLib] = curLib;
        return { ...prev, libraries: nextLibs };
      }
      return prev;
    });

    triggerPreviewRefresh(isImmediate ? 0 : 350);
  };

  const handleFormatChange = (newFormat) => {
    syncPreviewWithLibraryAndFormat(selectedSaveLibrary, newFormat, visualConfig);
  };

  const handlePointerDown = (item, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const elemRect = e.currentTarget.getBoundingClientRect();
      const isLandscape = isLandscapeFormat(previewTemplate);
      const canvasW = isLandscape ? 1920 : 1000;
      const canvasH = isLandscape ? 1080 : 1500;

      const elemW = (elemRect.width / canvasRect.width) * canvasW;
      const elemH = (elemRect.height / canvasRect.height) * canvasH;

      const grabX = ((e.clientX - elemRect.left) / canvasRect.width) * canvasW;
      const grabY = ((e.clientY - elemRect.top) / canvasRect.height) * canvasH;

      dragInfo.current = {
        item,
        pointerId: e.pointerId,
        elemW,
        elemH,
        grabX,
        grabY,
        canvasW,
        canvasH
      };
    }
    setDraggingItem(item);
  };

  const handlePointerMove = (e) => {
    if (!draggingItem || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const isLandscape = isLandscapeFormat(previewTemplate);
    const canvasW = isLandscape ? 1920 : 1000;
    const canvasH = isLandscape ? 1080 : 1500;

    const clampClientX = Math.max(rect.left, Math.min(rect.right, e.clientX));
    const clampClientY = Math.max(rect.top, Math.min(rect.bottom, e.clientY));

    const nativeX = ((clampClientX - rect.left) / rect.width) * canvasW;
    const nativeY = ((clampClientY - rect.top) / rect.height) * canvasH;

    let elemW = 200;
    let elemH = 70;
    let grabX = 100;
    let grabY = 35;

    if (dragInfo.current) {
      elemW = dragInfo.current.elemW;
      elemH = dragInfo.current.elemH;
      grabX = dragInfo.current.grabX;
      grabY = dragInfo.current.grabY;
    } else {
      const dims = (isLandscape ? BADGE_DIMS.landscape : BADGE_DIMS.portrait)[draggingItem] || { w: 200, h: 70 };
      elemW = dims.w;
      elemH = dims.h;
      grabX = dims.w / 2;
      grabY = dims.h / 2;
    }

    let elemLeft = nativeX - grabX;
    let elemTop = nativeY - grabY;

    elemLeft = Math.max(0, Math.min(canvasW - elemW, elemLeft));
    elemTop = Math.max(0, Math.min(canvasH - elemH, elemTop));

    let elemCenterX = elemLeft + elemW / 2;
    let elemCenterY = elemTop + elemH / 2;
    const snapIndicators = [];
    if (snapToGuides && guideMode !== "off") {
      const snapThreshold = 14;

      // 1. Collect target snap lines from OTHER active badges
      const otherBadges = getActiveBadges().filter(k => k !== draggingItem);
      const xTargets = [];
      const yTargets = [];

      for (const ok of otherBadges) {
        const ob = getBadgeBounds(ok);
        const oname = BADGE_NAMES[ok] || ok;
        // Y alignments:
        yTargets.push({ pos: ob.bottom, label: `${oname} (Bottom)` });
        yTargets.push({ pos: ob.top, label: `${oname} (Top)` });
        yTargets.push({ pos: ob.cy, label: `${oname} (Center)` });

        // X alignments:
        xTargets.push({ pos: ob.left, label: `${oname} (Left)` });
        xTargets.push({ pos: ob.right, label: `${oname} (Right)` });
        xTargets.push({ pos: ob.cx, label: `${oname} (Center)` });
      }

      // Also snap to Canvas Centerlines
      xTargets.push({ pos: canvasW * 0.5, label: "Canvas Center X" });
      yTargets.push({ pos: canvasH * 0.5, label: "Canvas Center Y" });

      // Check Y snapping (bottom-to-bottom, top-to-top, center-to-center)
      for (const t of yTargets) {
        // Bottom-to-Target snap
        if (Math.abs(elemTop + elemH - t.pos) < snapThreshold) {
          elemTop = t.pos - elemH;
          elemCenterY = elemTop + elemH / 2;
          snapIndicators.push({ type: "y", pos: (t.pos / canvasH) * 100, label: t.label });
          break;
        }
        // Top-to-Target snap
        if (Math.abs(elemTop - t.pos) < snapThreshold) {
          elemTop = t.pos;
          elemCenterY = elemTop + elemH / 2;
          snapIndicators.push({ type: "y", pos: (t.pos / canvasH) * 100, label: t.label });
          break;
        }
        // Center-to-Target snap
        if (Math.abs(elemCenterY - t.pos) < snapThreshold) {
          elemTop = t.pos - elemH / 2;
          elemCenterY = t.pos;
          snapIndicators.push({ type: "y", pos: (t.pos / canvasH) * 100, label: t.label });
          break;
        }
      }

      // Check X snapping (center-to-center, left-to-left, right-to-right)
      for (const t of xTargets) {
        // Center-to-Target snap
        if (Math.abs(elemCenterX - t.pos) < snapThreshold) {
          elemLeft = t.pos - elemW / 2;
          elemCenterX = t.pos;
          snapIndicators.push({ type: "x", pos: (t.pos / canvasW) * 100, label: t.label });
          break;
        }
        // Left-to-Target snap
        if (Math.abs(elemLeft - t.pos) < snapThreshold) {
          elemLeft = t.pos;
          elemCenterX = elemLeft + elemW / 2;
          snapIndicators.push({ type: "x", pos: (t.pos / canvasW) * 100, label: t.label });
          break;
        }
        // Right-to-Target snap
        if (Math.abs(elemLeft + elemW - t.pos) < snapThreshold) {
          elemLeft = t.pos - elemW;
          elemCenterX = elemLeft + elemW / 2;
          snapIndicators.push({ type: "x", pos: (t.pos / canvasW) * 100, label: t.label });
          break;
        }
      }
    }
    setActiveSnapGuides(snapIndicators);;

    let hAlign = "center";
    let ho = 0;
    if (elemCenterX < canvasW * 0.35) {
      hAlign = "left";
      ho = Math.max(0, Math.round(elemLeft));
    } else if (elemCenterX > canvasW * 0.65) {
      hAlign = "right";
      ho = Math.max(0, Math.round(canvasW - elemW - elemLeft));
    } else {
      hAlign = "center";
      ho = Math.round(elemCenterX - canvasW / 2);
    }

    let vAlign = "center";
    let vo = 0;
    if (elemCenterY < canvasH * 0.35) {
      vAlign = "top";
      vo = Math.max(0, Math.round(elemTop));
    } else if (elemCenterY > canvasH * 0.65) {
      vAlign = "bottom";
      vo = Math.max(0, Math.round(canvasH - elemH - elemTop));
    } else {
      vAlign = "center";
      vo = Math.round(elemCenterY - canvasH / 2);
    }

    setOffsets(prev => ({
      ...prev,
      [draggingItem]: {
        x: ho,
        y: vo,
        align: hAlign,
        valign: vAlign
      }
    }));
  };

  const handlePointerUp = (e) => {
    setActiveSnapGuides([]);
    if (draggingItem) {
      if (dragInfo.current?.pointerId !== undefined && e?.currentTarget?.releasePointerCapture) {
        try {
          e.currentTarget.releasePointerCapture(dragInfo.current.pointerId);
        } catch (_) {}
      }
      const draggedKey = draggingItem;
      const currentOffset = offsets[draggedKey];
      if (currentOffset) {
        setVisualConfig(prev => {
          const activeLib = selectedSaveLibrary || selectedVisualLib;
          if (!prev?.libraries?.[activeLib]?.badges) return prev;
          const nextLibs = { ...prev.libraries };
          const curLib = { ...nextLibs[activeLib] };
          const curBadges = { ...curLib.badges };
          const badgeKeyMap = {
            rating: "rating",
            runtime: "runtime",
            status: "status",
            resolution: "resolution",
            languages: "audio_languages",
            network: "network",
            anime: "anime",
            age_rating: "age_rating",
            audio_codec: "audio_codec",
            video_format: "video_format"
          };
          const targetBadge = badgeKeyMap[draggedKey] || draggedKey;
          if (curBadges[targetBadge]) {
            curBadges[targetBadge] = {
              ...curBadges[targetBadge],
              offset_x: currentOffset.x,
              offset_y: currentOffset.y,
              position: `${currentOffset.valign || "bottom"}-${currentOffset.align || "center"}`,
              ...(draggedKey === "resolution" ? {
                mode: currentOffset.mode || (currentOffset.banner_4k ? "banner" : "corner_badge"),
                banner_4k: currentOffset.mode === "banner" || Boolean(currentOffset.banner_4k),
                back_color: currentOffset.back_color,
                back_radius: currentOffset.back_radius,
                back_width: currentOffset.back_width,
                back_height: currentOffset.back_height
              } : {}),
              ...(draggedKey === "runtime" && currentOffset.font_size ? {
                font_size: currentOffset.font_size
              } : {})
            };
            curLib.badges = curBadges;
            nextLibs[activeLib] = curLib;
            return { ...prev, libraries: nextLibs };
          }
          return prev;
        });
      }
      setDraggingItem(null);
      dragInfo.current = null;
      setPreviewTimestamp(Date.now());
    }
  };

  const processUploadedFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      showError("Please upload a valid image file (PNG, JPG, or WebP).");
      return;
    }

    // 1. Instant local preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setCustomImages((prev) => ({
        ...prev,
        [previewTemplate]: {
          ...(prev[previewTemplate] || {}),
          dataUrl,
          filename: file.name
        }
      }));
    };
    reader.readAsDataURL(file);

    // 2. Upload to server so Pillow backend can composite over it
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("template_type", previewTemplate);

      const res = await fetch("/api/dynamic-overlays/upload-preview-image", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCustomImages((prev) => ({
          ...prev,
          [previewTemplate]: {
            dataUrl: prev[previewTemplate]?.dataUrl || data.url,
            filename: data.filename || file.name,
            previewImageId: data.preview_image_id,
            width: data.width,
            height: data.height
          }
        }));
        setPreviewTimestamp(Date.now());
        showSuccess(`Loaded test artwork '${file.name}' for ${previewTemplate.replace('_', ' ')}!`);
      } else {
        showError(data.error || "Failed uploading test image to server.");
      }
    } catch (err) {
      console.error("Upload test image error:", err);
      showError("Error uploading test image: " + (err.message || String(err)));
    }
  };

  const handleRemoveCustomImage = async () => {
    const current = customImages[previewTemplate];
    if (current?.previewImageId) {
      try {
        await fetch(`/api/dynamic-overlays/custom-preview-image/${current.previewImageId}`, {
          method: "DELETE"
        });
      } catch (e) {}
    }
    setCustomImages((prev) => {
      const next = { ...prev };
      delete next[previewTemplate];
      return next;
    });
    setPreviewTimestamp(Date.now());
    showSuccess("Reverted to standard sample artwork.");
  };

  const handleCanvasDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleCanvasDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleCanvasDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processUploadedFile(files[0]);
    }
  };

  const handleSaveLayout = async () => {
    let libName = selectedSaveLibrary || selectedVisualLib;
    if (libName === "__NEW__" || !libName) {
      libName = newLibraryName.trim();
    }
    if (!libName && Object.keys(libraries).length > 0) {
      const isTvFormat = previewTemplate.startsWith("show_") || previewTemplate.startsWith("season_") || previewTemplate === "episode_card";
      const matching = Object.keys(libraries).filter(l => {
        const isTv = l.toLowerCase().includes("tv") || l.toLowerCase().includes("show") || l.toLowerCase().includes("series");
        return isTvFormat ? isTv : !isTv;
      });
      libName = matching[0] || Object.keys(libraries)[0];
    }
    if (!libName) {
      showError("Please enter or select a library name to save layout coordinates.");
      return;
    }
    try {
      setIsSavingLayout(true);
      const layoutPayload = {};
      if (previewRating && previewRating !== "Off") {
        layoutPayload.ratings = {
          horizontal_offset: offsets.rating.x,
          vertical_offset: offsets.rating.y,
          horizontal_align: offsets.rating.align,
          vertical_align: offsets.rating.valign,
          ...(offsets.rating.font_size ? { font_size: offsets.rating.font_size } : {}),
          ...(offsets.rating.font ? { font: offsets.rating.font } : {})
        };
      }
      if (previewRuntime && previewRuntime !== "Off") {
        const isLandscape = isLandscapeFormat(previewTemplate);
        layoutPayload.runtimes = {
          horizontal_offset: offsets.runtime.x,
          vertical_offset: offsets.runtime.y,
          horizontal_align: offsets.runtime.align,
          vertical_align: offsets.runtime.valign,
          font_size: Number(offsets.runtime.font_size) || (isLandscape ? 52 : 40),
          back_width: isLandscape ? 180 : 205,
          back_color: "#00000000",
          text: "",
          ...(offsets.runtime.font ? { font: offsets.runtime.font } : {})
        };
      }
      if (previewStatus && previewStatus !== "Off") {
        layoutPayload.status = {
          horizontal_offset: offsets.status.x,
          vertical_offset: offsets.status.y,
          horizontal_align: offsets.status.align,
          vertical_align: offsets.status.valign,
          text: previewStatus,
          font_color: previewStatusColor,
          ...(offsets.status.font_size ? { font_size: offsets.status.font_size } : {}),
          ...(offsets.status.font ? { font: offsets.status.font } : {})
        };
      }
      if (previewResolution && previewResolution !== "None") {
        const isLandscape = isLandscapeFormat(previewTemplate);
        const isBanner = !isLandscape && (resolutionMode === "banner" || offsets.resolution?.mode === "banner");
        layoutPayload.resolution = {
          mode: isBanner ? "banner" : "corner_badge",
          horizontal_offset: isBanner ? 0 : (offsets.resolution.x ?? 15),
          vertical_offset: isBanner ? 0 : (offsets.resolution.y ?? 15),
          horizontal_align: isBanner ? "center" : (offsets.resolution.align || "left"),
          vertical_align: isBanner ? "top" : (offsets.resolution.valign || "top"),
          banner_4k: isBanner,
          back_color: isBanner ? "#00000000" : (offsets.resolution?.back_color || "#00000099"),
          back_radius: isBanner ? 0 : (offsets.resolution?.back_radius !== undefined ? Number(offsets.resolution.back_radius) : 15),
          back_width: isBanner ? 0 : (offsets.resolution?.back_width ? Number(offsets.resolution.back_width) : (isLandscape ? 260 : 245)),
          back_height: isBanner ? 0 : (offsets.resolution?.back_height ? Number(offsets.resolution.back_height) : (isLandscape ? 85 : 95))
        };
      }
      if (previewLanguages && previewLanguages !== "Off") {
        layoutPayload.languages = {
          horizontal_offset: offsets.languages?.x ?? 30,
          vertical_offset: offsets.languages?.y ?? 35,
          horizontal_align: offsets.languages?.align ?? "left",
          vertical_align: offsets.languages?.valign ?? "bottom",
          ...(offsets.languages?.font_size ? { font_size: offsets.languages.font_size } : {}),
          ...(offsets.languages?.font ? { font: offsets.languages.font } : {})
        };
      }
      if (previewNetwork && previewNetwork !== "Off") {
        layoutPayload.network = {
          horizontal_offset: offsets.network?.x ?? 25,
          vertical_offset: offsets.network?.y ?? 25,
          horizontal_align: offsets.network?.align ?? "right",
          vertical_align: offsets.network?.valign ?? "top"
        };
      }
      if (previewAnimeTag && previewAnimeTag !== "Off") {
        layoutPayload.anime = {
          horizontal_offset: offsets.anime?.x ?? 20,
          vertical_offset: offsets.anime?.y ?? 20,
          horizontal_align: offsets.anime?.align ?? "left",
          vertical_align: offsets.anime?.valign ?? "top",
          ...(offsets.anime?.font_size ? { font_size: offsets.anime.font_size } : {}),
          ...(offsets.anime?.font ? { font: offsets.anime.font } : {})
        };
      }
      if (previewAgeRating && previewAgeRating !== "Off") {
        const sourceName = previewAgeSource || "commonsense";
        layoutPayload[sourceName] = {
          horizontal_offset: offsets.age_rating?.x ?? 255,
          vertical_offset: offsets.age_rating?.y ?? 37,
          horizontal_align: offsets.age_rating?.align || "left",
          vertical_align: offsets.age_rating?.valign || "bottom",
          ...(offsets.age_rating?.font_size ? { font_size: offsets.age_rating.font_size } : {}),
          ...(offsets.age_rating?.font ? { font: offsets.age_rating.font } : {})
        };
      }
      if (previewAudioCodec && previewAudioCodec !== "Off") {
        layoutPayload.audio_codec = {
          horizontal_offset: offsets.audio_codec?.x ?? 30,
          vertical_offset: offsets.audio_codec?.y ?? 70,
          horizontal_align: offsets.audio_codec?.align || "right",
          vertical_align: offsets.audio_codec?.valign || "bottom"
        };
      }
      if (previewVideoFormat && previewVideoFormat !== "Off") {
        layoutPayload.video_format = {
          horizontal_offset: offsets.video_format?.x ?? 30,
          vertical_offset: offsets.video_format?.y ?? 30,
          horizontal_align: offsets.video_format?.align || "right",
          vertical_align: offsets.video_format?.valign || "top"
        };
      }

      const res = await fetch("/api/dynamic-overlays/save-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          library_name: libName,
          layout: layoutPayload,
          target_format: previewTemplate
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(`Saved overlay layout coordinates to '${libName}' in config.yml!`);
        if (data.scan) setScanData(data.scan);
        if (data.config && data.config.libraries) {
          setVisualConfig(data.config);
        } else {
          setVisualConfig(prev => {
            if (!prev?.libraries?.[libName]) return prev;
            const nextLibs = { ...prev.libraries };
            const cur = { ...nextLibs[libName] };
            const curBadges = { ...cur.badges };
            if (curBadges.audio_languages && offsets.languages) {
              curBadges.audio_languages = {
                ...curBadges.audio_languages,
                offset_x: offsets.languages.x,
                offset_y: offsets.languages.y,
                position: `${offsets.languages.valign || "bottom"}-${offsets.languages.align || "left"}`
              };
            }
            if (curBadges.runtime && offsets.runtime) {
              curBadges.runtime = {
                ...curBadges.runtime,
                offset_x: offsets.runtime.x,
                offset_y: offsets.runtime.y,
                position: `${offsets.runtime.valign || "bottom"}-${offsets.runtime.align || "center"}`,
                ...(offsets.runtime.font_size ? { font_size: offsets.runtime.font_size } : {})
              };
            }
            if (curBadges.resolution && offsets.resolution) {
              curBadges.resolution = {
                ...curBadges.resolution,
                offset_x: offsets.resolution.x,
                offset_y: offsets.resolution.y,
                position: `${offsets.resolution.valign || "top"}-${offsets.resolution.align || "left"}`,
                back_color: offsets.resolution.back_color || "#00000099",
                back_radius: offsets.resolution.back_radius !== undefined ? offsets.resolution.back_radius : 15,
                back_width: offsets.resolution.back_width || (isLandscapeFormat(previewTemplate) ? 260 : 245),
                back_height: offsets.resolution.back_height || (isLandscapeFormat(previewTemplate) ? 85 : 95)
              };
            }
            if (curBadges.rating && offsets.rating) {
              curBadges.rating = {
                ...curBadges.rating,
                offset_x: offsets.rating.x,
                offset_y: offsets.rating.y,
                position: `${offsets.rating.valign || "bottom"}-${offsets.rating.align || "right"}`
              };
            }
            if (curBadges.audio_codec && offsets.audio_codec) {
              curBadges.audio_codec = {
                ...curBadges.audio_codec,
                offset_x: offsets.audio_codec.x,
                offset_y: offsets.audio_codec.y,
                position: `${offsets.audio_codec.valign || "bottom"}-${offsets.audio_codec.align || "right"}`
              };
            }
            if (curBadges.video_format && offsets.video_format) {
              curBadges.video_format = {
                ...curBadges.video_format,
                offset_x: offsets.video_format.x,
                offset_y: offsets.video_format.y,
                position: `${offsets.video_format.valign || "top"}-${offsets.video_format.align || "right"}`
              };
            }
            cur.badges = curBadges;
            nextLibs[libName] = cur;
            return { ...prev, libraries: nextLibs };
          });
        }
      } else {
        showError(data.detail || data.error || "Failed saving layout");
      }
    } catch (err) {
      console.error(err);
      showError("Error saving layout: " + (err.message || String(err)));
    } finally {
      setIsSavingLayout(false);
    }
  };

  const getAvailableFormats = (libName = selectedSaveLibrary, configOverride = null) => {
    const activeCfg = configOverride || visualConfig;
    const effectiveLib = libName || selectedSaveLibrary || selectedVisualLib || Object.keys(activeCfg?.libraries || {})[0];
    const curLib = activeCfg?.libraries?.[effectiveLib];
    const isTv = curLib
      ? curLib.media_type === "show"
      : (libraries?.[effectiveLib]?.media_type === "show" || (effectiveLib && (effectiveLib.toLowerCase().includes("tv") || effectiveLib.toLowerCase().includes("show") || effectiveLib.toLowerCase().includes("series"))));

    if (isTv) {
      return [
        { id: "show_poster", label: "Show Poster (2:3)", isLandscape: false, level: "show" },
        { id: "season_poster", label: "Season (2:3)", isLandscape: false, level: "season" },
        { id: "episode_card", label: "Titlecard (16:9)", isLandscape: true, level: "episode" },
        { id: "backdrop", label: "Background (16:9)", isLandscape: true, level: "backdrop" },
      ];
    }

    return [
      { id: "movie_poster", label: "Movie Poster (2:3)", isLandscape: false, level: "movie" },
      { id: "backdrop", label: "Background (16:9)", isLandscape: true, level: "backdrop" },
    ];
  };

  const syncPreviewWithLibraryAndFormat = (libName, targetFormat, configOverride = null) => {
    setSelectedSaveLibrary(libName);
    setPreviewTemplate(targetFormat);

    const isLandscape = isLandscapeFormat(targetFormat);
    const nextOffsets = { ...(isLandscape ? defaultLandscapeOffsets : defaultPortraitOffsets) };

    const activeCfg = configOverride || visualConfig;
    const curLib = activeCfg?.libraries?.[libName];
    if (!curLib) {
      setPreviewResolution("");
      setPreviewStatus("");
      setPreviewLanguages("");
      setPreviewRuntime("");
      setPreviewRating("");
      setPreviewAgeRating("Off");
      setPreviewNetwork("");
      setPreviewAnimeTag("");
      setPreviewAudioCodec("");
      setPreviewVideoFormat("");
      setOffsets(nextOffsets);
      setPreviewTimestamp(Date.now());
      return;
    }

    const badges = curLib.badges || {};
    const isTv = curLib.media_type === "show";

    const parsePos = (posStr, defAlign, defValign) => {
      if (!posStr) return { align: defAlign, valign: defValign };
      const parts = posStr.split("-");
      if (parts.length === 2) return { align: parts[1], valign: parts[0] };
      return { align: defAlign, valign: defValign };
    };

    // 1. RESOLUTION BADGE / 4K BANNER
    // Landscape formats (Titlecards, Backdrops) NEVER use top banner ribbons!
    const isResBanner = !isLandscape && Boolean(
      badges.resolution?.banner_4k || 
      badges.resolution?.mode === "banner" || 
      badges.resolution?.mode === "ribbon" ||
      (!badges.resolution?.offset_y && badges.resolution?.position?.includes("top"))
    );
    setResolutionMode(isLandscape ? "badge" : (isResBanner ? "banner" : "badge"));
    if (badges.resolution?.enabled || badges.resolution?.banner_4k || badges.resolution?.banner_1080p || badges.resolution?.titlecard_enabled) {
      if (targetFormat === "movie_poster" || targetFormat === "show_poster") {
        if (isResBanner) {
          nextOffsets.resolution = { x: 0, y: 0, align: "center", valign: "top", mode: "banner", banner_4k: true };
          setPreviewResolution("4K");
        } else if (badges.resolution.banner_1080p) {
          nextOffsets.resolution = { x: 0, y: 0, align: "center", valign: "top", mode: "banner", banner_4k: true };
          setPreviewResolution("1080p");
        } else {
          const p = parsePos(badges.resolution.position, "left", "top");
          nextOffsets.resolution = {
            x: Number(badges.resolution.offset_x) || 15,
            y: Number(badges.resolution.offset_y) || 15,
            align: p.align,
            valign: p.valign,
            mode: "corner_badge",
            banner_4k: false,
            back_color: badges.resolution.back_color || "#00000099",
            back_radius: badges.resolution.back_radius !== undefined ? Number(badges.resolution.back_radius) : 15,
            back_width: Number(badges.resolution.back_width) || 245,
            back_height: Number(badges.resolution.back_height) || 95
          };
          setPreviewResolution("4K");
        }
      } else if (targetFormat === "episode_card" || targetFormat === "backdrop") {
        const rawPos = badges.resolution.titlecard_position || badges.resolution.position;
        // On Titlecards, ignore top-center (which comes from poster banner defaults) and default to top-left!
        const safePos = (rawPos && rawPos !== "top-center") ? rawPos : "top-left";
        const p = parsePos(safePos, "left", "top");
        const tcX = badges.resolution.titlecard_offset_x ?? badges.resolution.offset_x;
        const tcY = badges.resolution.titlecard_offset_y ?? badges.resolution.offset_y;
        nextOffsets.resolution = {
          x: (tcX !== undefined && tcX !== null && (tcX > 0 || p.align === "left")) ? Number(tcX) : 15,
          y: (tcY !== undefined && tcY !== null && (tcY > 0 || p.valign === "top")) ? Number(tcY) : 15,
          align: p.align,
          valign: p.valign,
          mode: "corner_badge",
          back_color: badges.resolution.back_color || "#00000099",
          back_radius: badges.resolution.back_radius !== undefined ? Number(badges.resolution.back_radius) : 15,
          back_width: Number(badges.resolution.back_width) || 260,
          back_height: Number(badges.resolution.back_height) || 85
        };
        setPreviewResolution(badges.resolution.banner_1080p ? "1080p" : "4K");
      } else {
        setPreviewResolution("");
      }
    } else {
      setPreviewResolution("");
    }

    // 2. STATUS BANNER (SHOW POSTER ONLY)
    if (targetFormat === "show_poster" && badges.status?.enabled) {
      const p = parsePos(badges.status.position, "center", "bottom");
      nextOffsets.status = {
        x: Number(badges.status.offset_x) || 0,
        y: Number(badges.status.offset_y) || 23,
        align: p.align,
        valign: p.valign,
        font_size: badges.status?.font_size ?? "",
        font: badges.status?.font ?? ""
      };
      setPreviewStatus(badges.status.text || "RETURNING SERIES");
      if (badges.status.colors?.returning) {
        setPreviewStatusColor(badges.status.colors.returning);
      }
    } else {
      setPreviewStatus("");
    }

    // 3. AUDIO LANGUAGES (FLAGS)
    const langLevel = (badges.audio_languages?.level || (isTv ? "episode" : "movie")).toLowerCase();
    const shouldShowLanguages = Boolean(badges.audio_languages?.enabled) && (
      (targetFormat === "movie_poster" && (langLevel === "movie" || langLevel === "all")) ||
      (targetFormat === "episode_card" && (langLevel === "episode" || langLevel === "all")) ||
      (targetFormat === "show_poster" && (langLevel === "show" || langLevel === "all")) ||
      (targetFormat === "season_poster" && (langLevel === "season" || langLevel === "all"))
    );

    if (shouldShowLanguages) {
      const p = parsePos(badges.audio_languages.position, "left", "bottom");
      const rawX = badges.audio_languages.offset_x;
      const rawY = badges.audio_languages.offset_y;
      nextOffsets.languages = {
        x: (rawX !== undefined && rawX !== null && Number(rawX) > 0) ? Number(rawX) : 30,
        y: (rawY !== undefined && rawY !== null && Number(rawY) > 0) ? Number(rawY) : (isLandscape ? 30 : 35),
        align: p.align,
        valign: p.valign,
        font_size: badges.audio_languages?.font_size ?? "",
        font: badges.audio_languages?.font ?? ""
      };
      const langs = badges.audio_languages.languages?.length > 0 
        ? badges.audio_languages.languages.join(",") 
        : "de,en";
      setPreviewLanguages(langs);
    } else {
      setPreviewLanguages("");
    }

    // 4. RUNTIME DURATION
    const runtimeLevel = (badges.runtime?.level || (isTv ? "episode" : "movie")).toLowerCase();
    const shouldShowRuntime = Boolean(badges.runtime?.enabled) && (
      (targetFormat === "movie_poster" && (runtimeLevel === "movie" || runtimeLevel === "all")) ||
      (targetFormat === "episode_card" && (runtimeLevel === "episode" || runtimeLevel === "all")) ||
      (targetFormat === "show_poster" && (runtimeLevel === "show" || runtimeLevel === "all"))
    );

    if (shouldShowRuntime) {
      const p = parsePos(badges.runtime.position, isTv ? "right" : "center", "bottom");
      nextOffsets.runtime = {
        x: (badges.runtime?.offset_x !== undefined && badges.runtime?.offset_x !== null)
          ? Number(badges.runtime.offset_x)
          : (isLandscape ? 140 : 116),
        y: (badges.runtime?.offset_y !== undefined && badges.runtime?.offset_y !== null)
          ? Number(badges.runtime.offset_y)
          : (isLandscape ? 30 : (isTv ? 20 : 37)),
        align: p.align,
        valign: p.valign,
        font_size: badges.runtime?.font_size ?? (isLandscape ? 52 : 40),
        font: badges.runtime?.font ?? ""
      };
      setPreviewRuntime(targetFormat === "episode_card" ? "45 min" : "1h 58m");
    } else {
      setPreviewRuntime("");
    }

    // 5. AUDIENCE / CRITIC RATINGS
    const ratingBadge = badges.rating || badges.critic_rating;
    const ratingLevel = (ratingBadge?.level || (isTv ? "show" : "movie")).toLowerCase();
    const shouldShowRating = Boolean(ratingBadge?.enabled) && (
      (targetFormat === "movie_poster" && (ratingLevel === "movie" || ratingLevel === "all")) ||
      (targetFormat === "show_poster" && (ratingLevel === "show" || ratingLevel === "all")) ||
      (targetFormat === "season_poster" && (ratingLevel === "season" || ratingLevel === "all")) ||
      (targetFormat === "episode_card" && (ratingLevel === "episode" || ratingLevel === "all"))
    );

    if (shouldShowRating) {
      const isLandscape = isLandscapeFormat(targetFormat);
      const p = parsePos(ratingBadge.position, isLandscape ? "right" : "center", "bottom");
      nextOffsets.rating = {
        x: (ratingBadge?.offset_x !== undefined && ratingBadge?.offset_x !== null)
          ? Number(ratingBadge.offset_x)
          : (isLandscape ? 30 : 375),
        y: (ratingBadge?.offset_y !== undefined && ratingBadge?.offset_y !== null)
          ? Number(ratingBadge.offset_y)
          : (isLandscape ? 25 : 0),
        align: p.align,
        valign: p.valign,
        font_size: ratingBadge?.font_size ?? "",
        font: ratingBadge?.font ?? ""
      };
      setPreviewRating("8.4");
    } else {
      setPreviewRating("");
    }

    // 6. AGE / CONTENT RATING
    const ageBadge = badges.age_rating;
    const ageLevel = (ageBadge?.level || (isTv ? "show" : "movie")).toLowerCase();
    const shouldShowAge = Boolean(ageBadge?.enabled) && (
      (targetFormat === "movie_poster" && (ageLevel === "movie" || ageLevel === "all")) ||
      (targetFormat === "show_poster" && (ageLevel === "show" || ageLevel === "all")) ||
      (targetFormat === "season_poster" && (ageLevel === "season" || ageLevel === "all")) ||
      (targetFormat === "episode_card" && (ageLevel === "episode" || ageLevel === "all"))
    );

    if (shouldShowAge) {
      const p = parsePos(ageBadge.position, "left", "bottom");
      nextOffsets.age_rating = {
        x: Number(ageBadge.offset_x) || 255,
        y: Number(ageBadge.offset_y) || 37,
        align: p.align,
        valign: p.valign,
        font_size: ageBadge?.font_size ?? "",
        font: ageBadge?.font ?? ""
      };
      const src = ageBadge.source || "commonsense";
      setPreviewAgeSource(src);
      setPreviewAgeRating(src === "content_rating_de" ? "FSK 16" : (src === "content_rating_us_movie" ? "PG-13" : "15+"));
    } else {
      setPreviewAgeRating("Off");
    }

    // 7. NETWORK / STUDIO LOGO
    const netBadge = badges.network;
    const netLevel = (netBadge?.level || "season").toLowerCase();
    const shouldShowNetwork = Boolean(netBadge?.enabled) && (
      (targetFormat === "season_poster" && (netLevel === "season" || netLevel === "all")) ||
      (targetFormat === "show_poster" && (netLevel === "show" || netLevel === "all"))
    );

    if (shouldShowNetwork) {
      const p = parsePos(netBadge.position, "right", "top");
      nextOffsets.network = {
        x: Number(netBadge.offset_x) || 25,
        y: Number(netBadge.offset_y) || 25,
        align: p.align,
        valign: p.valign
      };
      setPreviewNetwork(netBadge.name || "HBO");
    } else {
      setPreviewNetwork("");
    }

    // 8. ANIME TAG
    if (targetFormat === "episode_card" && badges.anime?.enabled) {
      const p = parsePos(badges.anime.position, "left", "top");
      nextOffsets.anime = {
        x: Number(badges.anime.offset_x) || 20,
        y: Number(badges.anime.offset_y) || 20,
        align: p.align,
        valign: p.valign,
        font_size: badges.anime?.font_size ?? "",
        font: badges.anime?.font ?? ""
      };
      setPreviewAnimeTag("Canon");
    } else {
      setPreviewAnimeTag("");
    }

    // 9. AUDIO CODEC BADGES
    if (badges.audio_codec?.enabled) {
      const p = parsePos(badges.audio_codec.position, "right", "bottom");
      nextOffsets.audio_codec = {
        x: Number(badges.audio_codec.offset_x) || 30,
        y: Number(badges.audio_codec.offset_y) || 70,
        align: p.align,
        valign: p.valign
      };
      setPreviewAudioCodecStyle(badges.audio_codec.style || "compact");
      const sampleCodec = badges.audio_codec.codecs?.[0] || "truehd_atmos";
      setPreviewAudioCodec(sampleCodec);
    } else {
      setPreviewAudioCodec("");
    }

    // 10. VIDEO FORMAT / SOURCE BADGES
    if (badges.video_format?.enabled) {
      const p = parsePos(badges.video_format.position, "right", "top");
      nextOffsets.video_format = {
        x: Number(badges.video_format.offset_x) || 30,
        y: Number(badges.video_format.offset_y) || 30,
        align: p.align,
        valign: p.valign
      };
      const sampleFmt = badges.video_format.formats?.[0] || "REMUX";
      setPreviewVideoFormat(sampleFmt);
    } else {
      setPreviewVideoFormat("");
    }

    setOffsets(nextOffsets);
    setPreviewTimestamp(Date.now());
  };

  const handleResetLayout = () => {
    setOffsets(isLandscapeFormat(previewTemplate) ? defaultLandscapeOffsets : defaultPortraitOffsets);
    setPreviewTimestamp(Date.now());
    showInfo("Reset layout coordinates to default template positions.");
  };

  const handleSelectPreviewLibrary = (libName, configOverride = null) => {
    if (!libName || libName === "__NEW__") {
      setSelectedSaveLibrary(libName);
      return;
    }
    const activeCfg = configOverride || visualConfig;
    const curLib = activeCfg?.libraries?.[libName];
    const isTv = curLib
      ? curLib.media_type === "show"
      : (libraries?.[libName]?.media_type === "show" || (libName && (libName.toLowerCase().includes("tv") || libName.toLowerCase().includes("show") || libName.toLowerCase().includes("series"))));
    const available = getAvailableFormats(libName, configOverride);
    let targetFormat = previewTemplate;
    if (!available.some(f => f.id === targetFormat)) {
      targetFormat = isTv ? "show_poster" : "movie_poster";
    }
    setSelectedVisualLib(libName);
    setSelectedSaveLibrary(libName);
    try { localStorage.setItem("posterizarr_selected_visual_lib", libName); } catch {}
    syncPreviewWithLibraryAndFormat(libName, targetFormat, configOverride);
  };

  useEffect(() => {
    if (visualConfig?.libraries) {
      const keys = Object.keys(visualConfig.libraries);
      if (keys.length > 0) {
        let savedLib = "";
        try { savedLib = localStorage.getItem("posterizarr_selected_visual_lib"); } catch {}
        const currentActive = (selectedSaveLibrary && visualConfig.libraries[selectedSaveLibrary])
          ? selectedSaveLibrary
          : ((selectedVisualLib && visualConfig.libraries[selectedVisualLib]) ? selectedVisualLib : null);

        const targetLib = currentActive || ((savedLib && visualConfig.libraries[savedLib]) ? savedLib : keys[0]);

        if (selectedVisualLib !== targetLib) {
          setSelectedVisualLib(targetLib);
        }
        if (selectedSaveLibrary !== targetLib) {
          setSelectedSaveLibrary(targetLib);
        }
        try { localStorage.setItem("posterizarr_selected_visual_lib", targetLib); } catch {}

        if (!currentActive) {
          handleSelectPreviewLibrary(targetLib, visualConfig);
        }
      }
    }
  }, [visualConfig]);

  useEffect(() => {
    if (activeTab === "preview" && selectedVisualLib && visualConfig?.libraries?.[selectedVisualLib]) {
      handleSelectPreviewLibrary(selectedVisualLib, visualConfig);
    }
  }, [activeTab]);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatFileDate = (timestamp) => {
    if (!timestamp) return "-";
    try {
      return new Date(timestamp * 1000).toLocaleString();
    } catch {
      return "-";
    }
  };

  const getYamlFileBadge = (fileName) => {
    const lower = (fileName || "").toLowerCase();
    if (lower === "config.yml" || lower === "config.yaml") {
      return { label: "Main Config", className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" };
    }
    if (lower.includes("tv")) {
      return { label: "TV Overlays", className: "bg-blue-500/10 border-blue-500/30 text-blue-400" };
    }
    if (lower.includes("movie")) {
      return { label: "Movie Overlays", className: "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" };
    }
    if (lower.includes("anime")) {
      return { label: "Anime Overlays", className: "bg-purple-500/10 border-purple-500/30 text-purple-400" };
    }
    return { label: "Overlay Rules", className: "bg-amber-500/10 border-amber-500/30 text-amber-400" };
  };

  const readiness = scanData?.readiness || { total: 0, ready: 0, fetchable: 0, missing: 0, assets: [] };
  const libraries = scanData?.libraries || {};
  const yamlFiles = statusData?.yaml_files || scanData?.yaml_files || [];

  const activeCustomImageId = customImages[previewTemplate]?.previewImageId;
  const customImgParam = activeCustomImageId ? `&custom_image_id=${encodeURIComponent(activeCustomImageId)}` : "";

  const fontParams = [
    offsets.runtime?.font_size ? `&runtime_font_size=${offsets.runtime.font_size}` : (isLandscapeFormat(previewTemplate) ? `&runtime_font_size=52` : `&runtime_font_size=40`),
    offsets.runtime?.font ? `&runtime_font=${encodeURIComponent(offsets.runtime.font)}` : "",
    offsets.rating?.font_size ? `&rating_font_size=${offsets.rating.font_size}` : "",
    offsets.rating?.font ? `&rating_font=${encodeURIComponent(offsets.rating.font)}` : "",
    offsets.age_rating?.font_size ? `&age_rating_font_size=${offsets.age_rating.font_size}` : "",
    offsets.age_rating?.font ? `&age_rating_font=${encodeURIComponent(offsets.age_rating.font)}` : "",
    offsets.status?.font_size ? `&status_font_size=${offsets.status.font_size}` : "",
    offsets.status?.font ? `&status_font=${encodeURIComponent(offsets.status.font)}` : "",
    `&resolution_mode=${encodeURIComponent(resolutionMode || (offsets.resolution?.mode || "banner"))}`,
    offsets.resolution?.back_color !== undefined ? `&resolution_back_color=${encodeURIComponent(offsets.resolution.back_color)}` : "",
    offsets.resolution?.back_radius !== undefined ? `&resolution_back_radius=${offsets.resolution.back_radius}` : "",
    offsets.resolution?.back_width ? `&resolution_back_width=${offsets.resolution.back_width}` : "",
    offsets.resolution?.back_height ? `&resolution_back_height=${offsets.resolution.back_height}` : ""
  ].join("");

  const previewUrl = `/api/dynamic-overlays/preview?template_type=${previewTemplate}&rating=${encodeURIComponent(previewRating)}&runtime=${encodeURIComponent(previewRuntime)}&status_label=${encodeURIComponent(previewStatus)}&status_color=${encodeURIComponent(previewStatusColor)}&resolution=${encodeURIComponent(previewResolution)}&audio_codec=${encodeURIComponent(previewAudioCodec || "")}&audio_codec_style=${encodeURIComponent(previewAudioCodecStyle || "compact")}&video_format=${encodeURIComponent(previewVideoFormat || "")}&languages=${encodeURIComponent(previewLanguages)}&network=${encodeURIComponent(previewNetwork)}&anime_tag=${encodeURIComponent(previewAnimeTag)}&age_rating=${encodeURIComponent(previewAgeRating || "")}&age_rating_source=${encodeURIComponent(previewAgeSource || "commonsense")}&age_rating_x=${offsets.age_rating?.x ?? 255}&age_rating_y=${offsets.age_rating?.y ?? 37}&age_rating_align=${offsets.age_rating?.align || "left"}&age_rating_valign=${offsets.age_rating?.valign || "bottom"}&rating_x=${offsets.rating?.x ?? 30}&rating_y=${offsets.rating?.y ?? 25}&rating_align=${offsets.rating?.align || "right"}&rating_valign=${offsets.rating?.valign || "bottom"}&runtime_x=${offsets.runtime?.x ?? 140}&runtime_y=${offsets.runtime?.y ?? 37}&runtime_align=${offsets.runtime?.align || "center"}&runtime_valign=${offsets.runtime?.valign || "bottom"}&status_x=${offsets.status?.x ?? 0}&status_y=${offsets.status?.y ?? 30}&status_align=${offsets.status?.align || "center"}&status_valign=${offsets.status?.valign || "bottom"}&res_x=${offsets.resolution?.x ?? 0}&res_y=${offsets.resolution?.y ?? 0}&res_align=${offsets.resolution?.align || "center"}&res_valign=${offsets.resolution?.valign || "top"}&audio_codec_x=${offsets.audio_codec?.x ?? 30}&audio_codec_y=${offsets.audio_codec?.y ?? 70}&audio_codec_align=${offsets.audio_codec?.align || "right"}&audio_codec_valign=${offsets.audio_codec?.valign || "bottom"}&video_format_x=${offsets.video_format?.x ?? 30}&video_format_y=${offsets.video_format?.y ?? 30}&video_format_align=${offsets.video_format?.align || "right"}&video_format_valign=${offsets.video_format?.valign || "top"}&anime_x=${offsets.anime?.x ?? 20}&anime_y=${offsets.anime?.y ?? 20}&anime_align=${offsets.anime?.align || "left"}&anime_valign=${offsets.anime?.valign || "top"}&lang_x=${offsets.languages?.x ?? 30}&lang_y=${offsets.languages?.y ?? 35}&lang_align=${offsets.languages?.align ?? "left"}&lang_valign=${offsets.languages?.valign ?? "bottom"}&network_x=${offsets.network?.x ?? 25}&network_y=${offsets.network?.y ?? 25}&network_align=${offsets.network?.align ?? "right"}&network_valign=${offsets.network?.valign ?? "top"}${customImgParam}${fontParams}&t=${previewTimestamp}`;

  const renderGuidelinesOverlay = (isLandscape) => {
    if (guideMode === "off") return null;

    const activeKeys = getActiveBadges();
    if (activeKeys.length === 0) return null;

    // Badges to display helper lines for:
    // If "all": all active badges
    // If "active": currently draggingItem, hoveredBadge, selectedBadge, or first active badge
    let targetKeys = [];
    if (guideMode === "all") {
      targetKeys = activeKeys;
    } else {
      const target = draggingItem || hoveredBadge || selectedBadge || activeKeys[0];
      if (target && activeKeys.includes(target)) {
        targetKeys = [target];
      } else if (activeKeys.length > 0) {
        targetKeys = [activeKeys[0]];
      }
    }

    return (
      <div className="absolute inset-0 pointer-events-none select-none z-15 overflow-hidden">
        {targetKeys.map((key) => {
          const bounds = getBadgeBounds(key);
          const name = BADGE_NAMES[key] || key;
          const isPrimary = (key === (draggingItem || hoveredBadge || selectedBadge));

          return (
            <React.Fragment key={`badge-guide-${key}`}>
              {/* Vertical Left Helper Line (Top to Bottom across whole image) */}
              <div
                className={`absolute top-0 bottom-0 border-l ${
                  isPrimary
                    ? "border-amber-400/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    : "border-amber-400/60 shadow-[0_0_2px_rgba(0,0,0,0.8)]"
                }`}
                style={{ left: `${bounds.leftPct}%` }}
              >
                <span className="absolute top-1 -translate-x-full pr-1 text-[8px] font-mono font-bold text-amber-300 bg-black/85 px-1 py-0.5 rounded shadow whitespace-nowrap">
                  {name} L
                </span>
              </div>

              {/* Vertical Right Helper Line (Top to Bottom across whole image) */}
              <div
                className={`absolute top-0 bottom-0 border-l ${
                  isPrimary
                    ? "border-amber-400/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    : "border-amber-400/60 shadow-[0_0_2px_rgba(0,0,0,0.8)]"
                }`}
                style={{ left: `${bounds.rightPct}%` }}
              >
                <span className="absolute top-1 pl-1 text-[8px] font-mono font-bold text-amber-300 bg-black/85 px-1 py-0.5 rounded shadow whitespace-nowrap">
                  {name} R
                </span>
              </div>

              {/* Horizontal Top Helper Line (Left to Right across whole image) */}
              <div
                className={`absolute left-0 right-0 border-t ${
                  isPrimary
                    ? "border-amber-400/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    : "border-amber-400/60 shadow-[0_0_2px_rgba(0,0,0,0.8)]"
                }`}
                style={{ top: `${bounds.topPct}%` }}
              >
                <span className="absolute left-2 -translate-y-full pb-0.5 text-[8px] font-mono font-bold text-amber-300 bg-black/85 px-1 py-0.5 rounded shadow whitespace-nowrap">
                  {name} Top
                </span>
              </div>

              {/* Horizontal Bottom Helper Line (Left to Right across whole image) */}
              <div
                className={`absolute left-0 right-0 border-t ${
                  isPrimary
                    ? "border-amber-400/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    : "border-amber-400/60 shadow-[0_0_2px_rgba(0,0,0,0.8)]"
                }`}
                style={{ top: `${bounds.bottomPct}%` }}
              >
                <span className="absolute left-2 pt-0.5 text-[8px] font-mono font-bold text-amber-300 bg-black/85 px-1 py-0.5 rounded shadow whitespace-nowrap">
                  {name} Bottom
                </span>
              </div>

              {/* Bounding Box Frame around the badge */}
              <div
                className={`absolute border rounded-[3px] pointer-events-none transition-all ${
                  isPrimary
                    ? "border-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                    : "border-amber-400/50"
                }`}
                style={{
                  left: `${bounds.leftPct}%`,
                  top: `${bounds.topPct}%`,
                  width: `${(bounds.w / bounds.canvasW) * 100}%`,
                  height: `${(bounds.h / bounds.canvasH) * 100}%`
                }}
              >
                {/* Center marker inside the badge */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400 shadow" />
              </div>
            </React.Fragment>
          );
        })}

        {/* Active Smart Snapping Lines during Drag */}
        {activeSnapGuides.map((g, idx) => (
          g.type === "x" ? (
            <div
              key={`snap-x-${idx}`}
              className="absolute top-0 bottom-0 border-l-2 border-emerald-400 shadow-[0_0_8px_#10b981] z-30 animate-pulse"
              style={{ left: `${g.pos}%` }}
            >
              <span className="absolute top-8 left-1 text-[9px] font-mono font-black text-emerald-300 bg-black/90 px-1.5 py-0.5 rounded border border-emerald-500/50 shadow whitespace-nowrap">
                SNAP {g.label}
              </span>
            </div>
          ) : (
            <div
              key={`snap-y-${idx}`}
              className="absolute left-0 right-0 border-t-2 border-emerald-400 shadow-[0_0_8px_#10b981] z-30 animate-pulse"
              style={{ top: `${g.pos}%` }}
            >
              <span className="absolute top-1 right-8 text-[9px] font-mono font-black text-emerald-300 bg-black/90 px-1.5 py-0.5 rounded border border-emerald-500/50 shadow whitespace-nowrap">
                SNAP {g.label}
              </span>
            </div>
          )
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-theme-primary" />
        <p className="text-theme-muted font-medium">Loading Dynamic Overlays...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      {/* HEADER WITH TITLE & MASTER SWITCH */}
      <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-theme-primary/10 border border-theme-primary/20 rounded-lg text-theme-primary shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-theme-text">
                  {t("dynamicOverlays.title", "Dynamic Overlays")}
                </h1>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                  featureSettings?.enabled
                    ? "bg-theme-primary/10 border-theme-primary/30 text-theme-primary"
                    : "bg-theme-hover border-theme text-theme-muted"
                }`}>
                  {featureSettings?.enabled ? "Active" : "Disabled (Off by Default)"}
                </span>
              </div>
              <p className="text-xs text-theme-muted mt-1">
                Add ratings, audio flags, and resolution badges to your posters and backdrops. Your original files stay untouched.
              </p>
            </div>
          </div>

          {/* MASTER FEATURE TOGGLE & QUICK STATS */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2.5 bg-theme-bg border border-theme px-3 py-1.5 rounded-lg">
              <span className="text-xs font-semibold text-theme-muted">Master Switch:</span>
              <button
                type="button"
                onClick={() => handleToggleMasterEnabled(!featureSettings?.enabled)}
                disabled={isUpdatingFeatureSettings}
                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  featureSettings?.enabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                }`}
                title="Toggle Dynamic Overlays on or off"
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    featureSettings?.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {featureSettings?.enabled && (
              <>
                <div className="px-3 py-1.5 rounded-lg bg-theme-bg border border-theme text-xs flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-theme-primary" />
                  <span className="text-theme-muted">Configs:</span>
                  <span className="font-semibold text-theme-text">{yamlFiles.length}</span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-theme-bg border border-theme text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-theme-primary" />
                  <span className="text-theme-muted">Ready:</span>
                  <span className="font-semibold text-theme-text">{readiness.ready}/{readiness.total}</span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-theme-bg border border-theme text-xs flex items-center gap-2">
                  <Database className="w-4 h-4 text-theme-primary" />
                  <span className="text-theme-muted">Cached:</span>
                  <span className="font-semibold text-theme-text">{cacheData?.stats?.total_cached || 0}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setWizardStep(1);
                    setIsWizardOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-theme-bg hover:bg-theme-hover border border-theme text-xs font-semibold text-theme-text flex items-center gap-1.5 transition-all shadow-sm"
                  title="Interactive Setup & Onboarding Wizard"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Setup Wizard</span>
                </button>

                <button
                  onClick={() => {
                    fetchRunStatus();
                    setIsApplyModalOpen(true);
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm transition-all ${
                    systemRunStatus.running
                      ? "bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                      : "bg-theme-primary hover:bg-theme-primary/90 text-white"
                  }`}
                >
                  {systemRunStatus.running ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span>Running {systemRunStatus.current_mode || "Sync"}...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Apply Overlays / Sync</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* WELCOME ONBOARDING BANNER (NEW USER COMPANION) */}
        {featureSettings?.enabled && !hasCompletedWizard && (
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-theme-primary/15 via-theme-card to-amber-500/10 border border-theme-primary/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-theme-primary/20 text-theme-primary border border-theme-primary/30 shrink-0">
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="font-bold text-theme-text text-sm flex items-center gap-2">
                  <span>Getting Started with Dynamic Overlays</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-theme-primary/20 text-theme-primary font-semibold">Quick Guide</span>
                </div>
                <p className="text-theme-muted mt-0.5 leading-relaxed">
                  Take a quick tour to see how badges work, choose recommended presets, and preview your artwork.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setWizardStep(1);
                  setIsWizardOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white font-semibold flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Open Guide</span>
              </button>
              <button
                type="button"
                onClick={dismissWizardInDb}
                className="p-1.5 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-hover transition-colors"
                title="Dismiss banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* NAVIGATION TABS (ACTIVE WHEN ENABLED) */}
        {featureSettings?.enabled && (
          <div className="flex flex-wrap items-center gap-2 mt-5 border-t border-theme pt-4">
            {[
              { id: "rules", label: "Libraries & Rules", icon: Layers, badge: Object.keys(libraries || {}).length },
              { id: "importer", label: "Config & YAML Files", icon: FileCode, badge: yamlFiles.length },
              { id: "config", label: "Visual Badges", icon: Sliders },
              { id: "preview", label: "Live Preview", icon: Eye },
              { id: "sync", label: "Sync & Cache", icon: RefreshCw },
              { id: "anime", label: "AniMetaFill", icon: Sparkles }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive =
                activeTab === tab.id ||
                (tab.id === "config" && activeTab === "visual") ||
                (tab.id === "sync" && activeTab === "cache");
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-theme-primary text-white shadow-sm"
                      : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-muted hover:text-theme-text shadow-sm"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      isActive ? "bg-white/20 text-white" : "bg-theme-bg text-theme-muted border border-theme"
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ACTIVATION SCREEN WHEN DISABLED */}
      {!featureSettings?.enabled && (
        <div className="bg-theme-card border border-theme rounded-2xl p-8 sm:p-10 shadow-sm text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex p-3 rounded-2xl bg-theme-hover border border-theme text-theme-primary">
            <Sliders className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-theme-hover border border-theme text-xs font-medium text-theme-muted">
              Overlays Currently Off
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-theme-text">
              Dynamic Overlays
            </h2>
            <p className="text-sm text-theme-muted leading-relaxed max-w-xl mx-auto">
              Add badges like ratings, audio language flags, resolution, and duration to your posters and backdrops. Your original artwork files are never modified.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                handleToggleMasterEnabled(true);
                setWizardStep(1);
                setIsWizardOpen(true);
              }}
              disabled={isUpdatingFeatureSettings}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50"
            >
              {isUpdatingFeatureSettings ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-300" />
              )}
              <span>Turn On & Launch Setup Wizard</span>
            </button>
            <button
              type="button"
              onClick={() => handleToggleMasterEnabled(true)}
              disabled={isUpdatingFeatureSettings}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text font-semibold text-sm shadow-sm transition-all disabled:opacity-50"
            >
              <span>Turn On Only</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 text-left border-t border-theme/60">
            <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme space-y-1">
              <span className="font-semibold text-xs text-theme-text block">Visual Editor</span>
              <p className="text-[11px] text-theme-muted">
                Turn badges on or off and reposition them directly on the artwork.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme space-y-1">
              <span className="font-semibold text-xs text-theme-text block">Easy Setup</span>
              <p className="text-[11px] text-theme-muted">
                Import your existing configuration to manage everything visually.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme space-y-1">
              <span className="font-semibold text-xs text-theme-text block">Safe & Clean</span>
              <p className="text-[11px] text-theme-muted">
                Badges are applied only when sending to your server. Your original files stay untouched.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 0: VISUAL CONFIGURATOR STUDIO (100% UI, ZERO YAML EDITING) */}
      {/* ========================================================================= */}
      {featureSettings?.enabled && (activeTab === "config" || activeTab === "visual") && (
        <div className="space-y-5">
          {/* TOP TOOLBAR: LIBRARY SELECTOR & ACTIONS */}
          <div className="bg-theme-card border border-theme rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider mr-1">Library:</span>
              {Object.keys(visualConfig.libraries || {}).map((libKey) => {
                const lib = visualConfig.libraries[libKey];
                const isSel = selectedVisualLib === libKey;
                const isTv = lib?.media_type === "show";
                const activeCount = Object.values(lib?.badges || {}).filter(b => b?.enabled).length;
                return (
                  <button
                    key={libKey}
                    type="button"
                    onClick={() => {
                      setSelectedVisualLib(libKey);
                      try { localStorage.setItem("posterizarr_selected_visual_lib", libKey); } catch {}
                      handleSelectPreviewLibrary(libKey);
                      const libObj = visualConfig.libraries?.[libKey];
                      if (libObj && libObj.media_type === "movie" && (activeAssetTarget === "season" || activeAssetTarget === "titlecard")) {
                        setActiveAssetTarget("poster");
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isSel
                        ? "bg-theme-primary text-white shadow-sm ring-1 ring-theme-primary"
                        : "bg-theme-hover border border-theme text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    {isTv ? <Tv className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                    <span>{libKey}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSel ? "bg-white/20 text-white" : "bg-theme-hover text-theme-muted"
                    }`}>
                      {activeCount}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setNewLibForm({ name: "", media_type: "movie" });
                  setIsAddLibModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all"
                title="Add new media library"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Library</span>
              </button>

              <button
                type="button"
                onClick={handleQuickStart}
                disabled={isQuickStarting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all disabled:opacity-50"
                title="Auto-configure detected media libraries with recommended overlay presets"
              >
                <Zap className={`w-3.5 h-3.5 text-theme-primary ${isQuickStarting ? "animate-spin" : ""}`} />
                <span>{isQuickStarting ? "Configuring..." : "Quick Start"}</span>
              </button>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all"
                title="Paste or import existing YAML configuration once"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import YAML</span>
              </button>

              <button
                type="button"
                onClick={fetchVisualConfig}
                disabled={isVisualLoading}
                className="p-2 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-muted hover:text-theme-text text-xs transition-all disabled:opacity-50"
                title="Reload configuration"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isVisualLoading ? "animate-spin text-theme-primary" : ""}`} />
              </button>

              <button
                type="button"
                onClick={handleSaveVisualConfig}
                disabled={isVisualSaving}
                className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                {isVisualSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save Configuration</span>
              </button>
            </div>
          </div>

          {/* ACTIVE LIBRARY CONFIGURATION PANELS */}
          {(() => {
            const curLib = visualConfig.libraries?.[selectedVisualLib];
            if (!curLib) {
              return (
                <div className="bg-theme-card border border-theme rounded-2xl p-10 text-center space-y-3">
                  <div className="p-3 w-fit mx-auto rounded-2xl bg-theme-hover text-theme-muted border border-theme">
                    <Sliders className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-theme-text">No Library Selected</h3>
                    <p className="text-xs text-theme-muted mt-0.5">
                      Choose an existing library above or click "Add Library" to configure overlays.
                    </p>
                  </div>
                </div>
              );
            }

            const badges = curLib.badges || {};
            const isTv = curLib.media_type === "show";

            const updateBadge = (badgeKey, patch) => {
              setVisualConfig((prev) => {
                const nextLibs = { ...prev.libraries };
                const targetLib = { ...nextLibs[selectedVisualLib] };
                const targetBadges = { ...targetLib.badges };
                targetBadges[badgeKey] = {
                  ...(targetBadges[badgeKey] || {}),
                  ...patch
                };
                targetLib.badges = targetBadges;
                nextLibs[selectedVisualLib] = targetLib;
                return { ...prev, libraries: nextLibs };
              });
              if (badgeKey === "resolution") {
                setOffsets(prev => ({
                  ...prev,
                  resolution: {
                    ...(prev.resolution || {}),
                    ...(patch.position ? {
                      align: patch.position.split("-")[1] || "center",
                      valign: patch.position.split("-")[0] || "top"
                    } : {}),
                    ...(patch.offset_x !== undefined ? { x: patch.offset_x } : {}),
                    ...(patch.offset_y !== undefined ? { y: patch.offset_y } : {}),
                    ...(patch.back_color !== undefined ? { back_color: patch.back_color } : {}),
                    ...(patch.back_radius !== undefined ? { back_radius: patch.back_radius } : {}),
                    ...(patch.back_width !== undefined ? { back_width: patch.back_width } : {}),
                    ...(patch.back_height !== undefined ? { back_height: patch.back_height } : {}),
                    ...(patch.mode !== undefined ? { mode: patch.mode } : {})
                  }
                }));
                setPreviewTimestamp(Date.now());
              } else if (badgeKey === "runtime") {
                setOffsets(prev => ({
                  ...prev,
                  runtime: {
                    ...(prev.runtime || {}),
                    ...(patch.position ? {
                      align: patch.position.split("-")[1] || "center",
                      valign: patch.position.split("-")[0] || "bottom"
                    } : {}),
                    ...(patch.offset_x !== undefined ? { x: patch.offset_x } : {}),
                    ...(patch.offset_y !== undefined ? { y: patch.offset_y } : {}),
                    ...(patch.font_size !== undefined ? { font_size: patch.font_size } : {})
                  }
                }));
                setPreviewTimestamp(Date.now());
              }
            };

            const toggleBadgeEnabled = (badgeKey) => {
              const curEnabled = Boolean(badges[badgeKey]?.enabled);
              updateBadge(badgeKey, { enabled: !curEnabled });
            };

            const POPULAR_LANGUAGES = [
              { code: "de", label: "DE" },
              { code: "en", label: "EN" },
              { code: "ja", label: "JA" },
              { code: "fr", label: "FR" },
              { code: "es", label: "ES" },
              { code: "it", label: "IT" },
              { code: "ko", label: "KO" },
              { code: "zh", label: "ZH" },
              { code: "pt", label: "PT" },
              { code: "ru", label: "RU" },
              { code: "pl", label: "PL" },
              { code: "nl", label: "NL" },
              { code: "tr", label: "TR" },
              { code: "sv", label: "SV" }
            ];

            const activeLangs = badges.audio_languages?.languages || [];

            const handleAddCustomLang = () => {
              const code = customLangInput.trim().toLowerCase();
              if (!code) return;
              if (!activeLangs.includes(code)) {
                updateBadge("audio_languages", { languages: [...activeLangs, code] });
              }
              setCustomLangInput("");
            };

                        // =========================================================================
            // REUSABLE BADGE CARD RENDERERS (USED UNIFORMLY ACROSS POSTERS, BACKDROPS, SEASONS & TITLECARDS)
            // =========================================================================

            // 1. Critic & Multi-Rating Scores Card
            const renderCriticRatingCard = (isBackdrop = false) => {
              const criticBadge = badges.critic_rating || (badges.rating?.source === "ratings" ? badges.rating : null) || {};
              const isCriticEnabled = Boolean(criticBadge.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isCriticEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Critic & Audience Scores</h4>
                        <p className="text-[10px] text-theme-muted">
                          {isBackdrop ? "Multi-rating on Backdrops" : "IMDb / TMDb / RT / Metacritic"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextVal = !isCriticEnabled;
                        updateBadge("critic_rating", { ...criticBadge, enabled: nextVal, source: "ratings" });
                        if (isBackdrop && nextVal && !featureSettings?.backdrop_overlays_enabled) {
                          handleUpdateDynamicSettings({ backdrop_overlays_enabled: true });
                        }
                      }}
                      title={isCriticEnabled ? "Disable Critic Scores" : "Enable Critic Scores"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isCriticEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isCriticEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isCriticEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      {isTv && !isBackdrop && (
                        <div className="space-y-0.5">
                          <label className="text-[9px] font-semibold text-theme-muted uppercase flex items-center justify-between">
                            <span>Target Scope</span>
                            <span className="text-[9px] text-theme-primary font-mono">{criticBadge.level || "show"}</span>
                          </label>
                          <select
                            value={criticBadge.level || "show"}
                            onChange={(e) => updateBadge("critic_rating", { level: e.target.value })}
                            className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                          >
                            <option value="show">Show Main Poster (2:3)</option>
                            <option value="season">Season Posters (2:3)</option>
                            <option value="episode">Episode Titlecards (16:9)</option>
                          </select>
                        </div>
                      )}

                      {/* Position & Offsets */}
                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={criticBadge.position || (isBackdrop ? (featureSettings?.rating_position || "top-right") : "top-right")}
                          onChange={(p) => {
                            updateBadge("critic_rating", { position: p });
                            if (isBackdrop) handleUpdateDynamicSettings({ rating_position: p });
                          }}
                        />
                        <div className="grid grid-cols-2 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X (px)</label>
                            <input
                              type="number"
                              value={criticBadge.offset_x ?? (isBackdrop ? 30 : 0)}
                              onChange={(e) => updateBadge("critic_rating", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y (px)</label>
                            <input
                              type="number"
                              value={criticBadge.offset_y ?? (isBackdrop ? 30 : 0)}
                              onChange={(e) => updateBadge("critic_rating", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Active Rating Sources Selection */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Active Rating Sources</label>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { id: "imdb", label: "IMDb" },
                            { id: "tomatoes", label: "RT Critics" },
                            { id: "tomatoesaudience", label: "RT Audience" },
                            { id: "tmdb", label: "TMDb" },
                            { id: "trakt", label: "Trakt" },
                            { id: "metacritic", label: "Metacritic" },
                            { id: "letterboxd", label: "Letterboxd" }
                          ].map((src) => {
                            const curSources = criticBadge.sources || featureSettings?.rating_sources || ["imdb", "tomatoes", "tmdb"];
                            const isSel = curSources.includes(src.id);
                            return (
                              <button
                                key={src.id}
                                type="button"
                                onClick={() => {
                                  const next = isSel
                                    ? curSources.filter(s => s !== src.id)
                                    : [...curSources, src.id];
                                  updateBadge("critic_rating", { sources: next });
                                  if (isBackdrop) handleUpdateDynamicSettings({ rating_sources: next });
                                }}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                                  isSel
                                    ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                    : "bg-theme-hover/60 border-theme text-theme-muted hover:text-theme-text"
                                }`}
                              >
                                {isSel ? "✓ " : "+ "}{src.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Orientation & Contrast Box */}
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <div className="space-y-0.5">
                          <label className="text-[9px] font-semibold text-theme-muted uppercase">Layout Direction</label>
                          <select
                            value={criticBadge.orientation || (isBackdrop ? (featureSettings?.rating_alignment || "vertical") : "horizontal")}
                            onChange={(e) => {
                              updateBadge("critic_rating", { orientation: e.target.value });
                              if (isBackdrop) handleUpdateDynamicSettings({ rating_alignment: e.target.value });
                            }}
                            className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                          >
                            <option value="horizontal">Horizontal (Row)</option>
                            <option value="vertical">Vertical (Stacked)</option>
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] font-semibold text-theme-muted uppercase">Contrast Box</label>
                          <label className="flex items-center gap-1.5 p-1 rounded-lg bg-theme-hover border border-theme cursor-pointer">
                            <input
                              type="checkbox"
                              checked={criticBadge.contrast_box !== false}
                              onChange={(e) => {
                                updateBadge("critic_rating", { contrast_box: e.target.checked });
                                if (isBackdrop) handleUpdateDynamicSettings({ rating_contrast_box: e.target.checked });
                              }}
                              className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0 w-3.5 h-3.5"
                            />
                            <span className="text-[11px] text-theme-text font-medium">Dark Pill Box</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 2. Resolution & Quality Badges / Banners Card
            const renderResolutionCard = () => {
              const resBadge = badges.resolution || {};
              const isResEnabled = Boolean(resBadge.enabled);
              const resMode = resBadge.mode || "badge";
              const activeTiers = resBadge.tiers || ["4k", "1080p", "720p", "576p", "480p"];

              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isResEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Resolution & Quality Badges</h4>
                        <p className="text-[10px] text-theme-muted">4K, 1080p, 720p, 576p, 480p + HDR/DV</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("resolution")}
                      title={isResEnabled ? "Disable Resolution Badges" : "Enable Resolution Badges"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isResEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isResEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isResEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      {/* Mode Switch: Corner Badges vs Ribbon Banner */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Overlay Display Style</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateBadge("resolution", { mode: "badge" })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              resMode === "badge"
                                ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Corner Badges (default)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateBadge("resolution", { mode: "ribbon" })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              resMode === "ribbon"
                                ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Top Ribbon Banner
                          </button>
                        </div>
                      </div>

                      {resMode === "badge" ? (
                        <>
                          {/* Position & Offsets for Corner Badges */}
                          <div className="flex items-start gap-2.5">
                            <PositionPicker
                              value={resBadge.position || "top-left"}
                              onChange={(p) => updateBadge("resolution", { position: p })}
                            />
                            <div className="grid grid-cols-2 gap-1.5 flex-1">
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X (px)</label>
                                <input
                                  type="number"
                                  value={resBadge.offset_x ?? 0}
                                  onChange={(e) => updateBadge("resolution", { offset_x: parseInt(e.target.value) || 0 })}
                                  className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y (px)</label>
                                <input
                                  type="number"
                                  value={resBadge.offset_y ?? 0}
                                  onChange={(e) => updateBadge("resolution", { offset_y: parseInt(e.target.value) || 0 })}
                                  className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Contrast Background Pill Controls */}
                          <div className="p-2.5 rounded-lg bg-theme-hover/40 border border-theme/50 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-semibold text-theme-text flex items-center gap-1.5">
                                <Palette className="w-3 h-3 text-theme-primary" />
                                <span>Contrast Pill Background</span>
                              </label>
                              <span className="text-[9px] font-mono text-theme-muted">
                                {resBadge.back_color || "#00000099"}
                              </span>
                            </div>

                            {/* Preset Buttons */}
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
                              {[
                                { label: "Dark Glass", val: "#00000099" },
                                { label: "Solid Dark", val: "#000000E6" },
                                { label: "Light Glass", val: "#FFFFFF99" },
                                { label: "Solid Light", val: "#FFFFFFAA" },
                                { label: "Transparent", val: "#00000000" }
                              ].map((preset) => {
                                const isCurrent = (resBadge.back_color || "#00000099").toLowerCase() === preset.val.toLowerCase();
                                return (
                                  <button
                                    key={preset.val}
                                    type="button"
                                    onClick={() => updateBadge("resolution", { back_color: preset.val })}
                                    className={`px-1.5 py-1 rounded text-[10px] font-semibold border transition-all truncate ${
                                      isCurrent
                                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text"
                                    }`}
                                    title={preset.val}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Fine-tuning row: Hex, Radius, Width, Height */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1 border-t border-theme/30">
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Color Hex</label>
                                <input
                                  type="text"
                                  value={resBadge.back_color ?? "#00000099"}
                                  onChange={(e) => updateBadge("resolution", { back_color: e.target.value })}
                                  placeholder="#00000099"
                                  className="w-full bg-theme-card border border-theme rounded-md px-1.5 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Radius (px)</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="50"
                                  value={resBadge.back_radius ?? 15}
                                  onChange={(e) => updateBadge("resolution", { back_radius: parseInt(e.target.value) || 0 })}
                                  className="w-full bg-theme-card border border-theme rounded-md px-1.5 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Width (px)</label>
                                <input
                                  type="number"
                                  value={resBadge.back_width ?? (isTv ? 260 : 245)}
                                  onChange={(e) => updateBadge("resolution", { back_width: parseInt(e.target.value) || 0 })}
                                  className="w-full bg-theme-card border border-theme rounded-md px-1.5 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] font-semibold text-theme-muted uppercase">Height (px)</label>
                                <input
                                  type="number"
                                  value={resBadge.back_height ?? (isTv ? 85 : 95)}
                                  onChange={(e) => updateBadge("resolution", { back_height: parseInt(e.target.value) || 0 })}
                                  className="w-full bg-theme-card border border-theme rounded-md px-1.5 py-1 text-xs text-theme-text font-mono"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Resolution Tiers Checkboxes */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Enabled Resolution Tiers</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                              {[
                                { id: "4k", label: "4K UHD (HDR/DV)" },
                                { id: "1080p", label: "1080p Full HD" },
                                { id: "720p", label: "720p HD" },
                                { id: "576p", label: "576p SD / PAL" },
                                { id: "480p", label: "480p SD / NTSC" }
                              ].map((t) => {
                                const isChecked = activeTiers.includes(t.id);
                                return (
                                  <label key={t.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-theme-hover/40 border border-theme/40 cursor-pointer hover:bg-theme-hover">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...activeTiers, t.id]
                                          : activeTiers.filter(x => x !== t.id);
                                        updateBadge("resolution", { tiers: next });
                                      }}
                                      className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0 w-3.5 h-3.5"
                                    />
                                    <span className="font-semibold text-xs text-theme-text truncate">{t.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Ribbon Banner Checkboxes */
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-theme-muted">Select ribbons to composite at the top:</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            {[
                              { key: "banner_4k", label: "4K UHD Ribbon" },
                              { key: "banner_1080p", label: "1080p Full HD" },
                              { key: "banner_720p", label: "720p HD" }
                            ].map((b) => (
                              <label key={b.key} className="flex items-center gap-2 p-1.5 rounded-lg bg-theme-hover/40 border border-theme/40 cursor-pointer hover:bg-theme-hover">
                                <input
                                  type="checkbox"
                                  checked={Boolean(resBadge[b.key])}
                                  onChange={(e) => updateBadge("resolution", { [b.key]: e.target.checked })}
                                  className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0 w-3.5 h-3.5"
                                />
                                <span className="font-semibold text-xs text-theme-text truncate">{b.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            // 2b. Audio Codec Badges Card
            const renderAudioCodecCard = () => {
              const audioBadge = badges.audio_codec || {};
              const isAudioEnabled = Boolean(audioBadge.enabled);
              const codecStyle = audioBadge.style || "compact";
              const activeCodecs = audioBadge.codecs || [
                "truehd_atmos", "dtsx", "plus_atmos", "truehd", "ma", "flac", "pcm", "plus", "dts", "digital", "aac", "opus"
              ];

              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isAudioEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Volume2 className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Audio Codec Badges</h4>
                        <p className="text-[10px] text-theme-muted">Dolby Atmos, TrueHD, DTS:X, DTS-HD MA, EAC3, AAC</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("audio_codec")}
                      title={isAudioEnabled ? "Disable Audio Codec Badges" : "Enable Audio Codec Badges"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isAudioEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isAudioEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isAudioEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      {/* Badge Style: Compact vs Standard */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Badge Style</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateBadge("audio_codec", { style: "compact" })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              codecStyle === "compact"
                                ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Compact (Pill)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateBadge("audio_codec", { style: "standard" })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              codecStyle === "standard"
                                ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Standard (Square)
                          </button>
                        </div>
                      </div>

                      {/* Position & Offsets */}
                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={audioBadge.position || "bottom-right"}
                          onChange={(p) => updateBadge("audio_codec", { position: p })}
                        />
                        <div className="grid grid-cols-2 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X (px)</label>
                            <input
                              type="number"
                              value={audioBadge.offset_x ?? 30}
                              onChange={(e) => updateBadge("audio_codec", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y (px)</label>
                            <input
                              type="number"
                              value={audioBadge.offset_y ?? 70}
                              onChange={(e) => updateBadge("audio_codec", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Codecs Filter Grid */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Supported Audio Formats</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {[
                            { id: "truehd_atmos", label: "Dolby Atmos" },
                            { id: "dtsx", label: "DTS:X" },
                            { id: "truehd", label: "Dolby TrueHD" },
                            { id: "ma", label: "DTS-HD MA" },
                            { id: "flac", label: "FLAC" },
                            { id: "pcm", label: "PCM / LPCM" },
                            { id: "plus", label: "Dolby Digital+ (EAC3)" },
                            { id: "dts", label: "DTS 5.1" },
                            { id: "digital", label: "Dolby Digital (AC3)" },
                            { id: "aac", label: "AAC" },
                            { id: "opus", label: "Opus" }
                          ].map((c) => {
                            const isChecked = activeCodecs.includes(c.id);
                            return (
                              <label key={c.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-theme-hover/40 border border-theme/40 cursor-pointer hover:bg-theme-hover">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...activeCodecs, c.id]
                                      : activeCodecs.filter(x => x !== c.id);
                                    updateBadge("audio_codec", { codecs: next });
                                  }}
                                  className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0 w-3.5 h-3.5"
                                />
                                <span className="font-semibold text-xs text-theme-text truncate">{c.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 2c. Video Format & Source Badges Card
            const renderVideoFormatCard = () => {
              const fmtBadge = badges.video_format || {};
              const isFmtEnabled = Boolean(fmtBadge.enabled);
              const activeFormats = fmtBadge.formats || ["REMUX", "BLU-RAY", "WEB", "HDTV", "DVD", "TELESYNC", "CAM"];

              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isFmtEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Clapperboard className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Video Format & Source Badges</h4>
                        <p className="text-[10px] text-theme-muted">Remux, Blu-ray, Web-DL, Telesync, CAM</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("video_format")}
                      title={isFmtEnabled ? "Disable Video Format Badges" : "Enable Video Format Badges"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isFmtEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isFmtEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isFmtEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      {/* Position & Offsets */}
                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={fmtBadge.position || "top-right"}
                          onChange={(p) => updateBadge("video_format", { position: p })}
                        />
                        <div className="grid grid-cols-2 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X (px)</label>
                            <input
                              type="number"
                              value={fmtBadge.offset_x ?? 30}
                              onChange={(e) => updateBadge("video_format", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y (px)</label>
                            <input
                              type="number"
                              value={fmtBadge.offset_y ?? 30}
                              onChange={(e) => updateBadge("video_format", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Format Badges Grid */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Enabled Source Formats</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {[
                            { id: "REMUX", label: "Remux" },
                            { id: "BLU-RAY", label: "Blu-ray" },
                            { id: "WEB", label: "Web-DL" },
                            { id: "HDTV", label: "HDTV" },
                            { id: "DVD", label: "DVD / SDTV" },
                            { id: "TELESYNC", label: "Telesync / TS" },
                            { id: "CAM", label: "Cam / HD-CAM" }
                          ].map((f) => {
                            const isChecked = activeFormats.includes(f.id);
                            return (
                              <label key={f.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-theme-hover/40 border border-theme/40 cursor-pointer hover:bg-theme-hover">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...activeFormats, f.id]
                                      : activeFormats.filter(x => x !== f.id);
                                    updateBadge("video_format", { formats: next });
                                  }}
                                  className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0 w-3.5 h-3.5"
                                />
                                <span className="font-semibold text-xs text-theme-text truncate">{f.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 3. Age & Content Ratings Card
            const renderAgeRatingCard = () => {
              const ageBadge = badges.age_rating || (badges.rating?.source !== "ratings" ? badges.rating : null) || {};
              const isAgeEnabled = Boolean(ageBadge.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isAgeEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Age & Content Ratings</h4>
                        <p className="text-[10px] text-theme-muted">Common Sense Media / FSK / MPAA</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextVal = !isAgeEnabled;
                        updateBadge("age_rating", { ...ageBadge, enabled: nextVal });
                        updateBadge("rating", { ...ageBadge, enabled: nextVal });
                      }}
                      title={isAgeEnabled ? "Disable Age Ratings" : "Enable Age Ratings"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isAgeEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isAgeEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isAgeEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Rating Authority</label>
                        <select
                          value={ageBadge.source || "commonsense"}
                          onChange={(e) => {
                            updateBadge("age_rating", { source: e.target.value });
                            updateBadge("rating", { source: e.target.value });
                          }}
                          className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                        >
                          <option value="commonsense">Common Sense Media (10+, 14+, etc.)</option>
                          <option value="content_rating_de">German FSK Rating (FSK 0, 6, 12, 16, 18)</option>
                          <option value="content_rating_us_movie">US Content Rating (MPAA: PG, PG-13, R)</option>
                          <option value="content_rating_uk">UK BBFC Rating (U, PG, 12A, 15, 18)</option>
                        </select>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={ageBadge.position || "bottom-left"}
                          onChange={(p) => {
                            updateBadge("age_rating", { position: p });
                            updateBadge("rating", { position: p });
                          }}
                        />
                        <div className="grid grid-cols-3 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X</label>
                            <input
                              type="number"
                              value={ageBadge.offset_x ?? 255}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                updateBadge("age_rating", { offset_x: val });
                                updateBadge("rating", { offset_x: val });
                              }}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y</label>
                            <input
                              type="number"
                              value={ageBadge.offset_y ?? 37}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                updateBadge("age_rating", { offset_y: val });
                                updateBadge("rating", { offset_y: val });
                              }}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Box Width</label>
                            <input
                              type="number"
                              value={ageBadge.back_width ?? 230}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 230;
                                updateBadge("age_rating", { back_width: val });
                                updateBadge("rating", { back_width: val });
                              }}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 4. Audio Languages Flags Card
            const renderAudioLanguagesCard = (contextDesc = "Badges for audio tracks (DE, EN, JA, etc.)") => {
              const activeLangs = badges.audio_languages?.languages || [];
              const isLangEnabled = Boolean(badges.audio_languages?.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isLangEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Audio Languages Flags</h4>
                        <p className="text-[10px] text-theme-muted">{contextDesc}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("audio_languages")}
                      title={isLangEnabled ? "Disable Languages" : "Enable Languages"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isLangEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isLangEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isLangEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      {/* Active Languages Chips + Add Inline */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-semibold text-theme-muted uppercase tracking-wider">
                            Active Flags ({activeLangs.length})
                          </label>
                          {activeLangs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => updateBadge("audio_languages", { languages: [] })}
                              className="text-[10px] text-rose-400 hover:underline"
                            >
                              Clear All
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 p-1.5 bg-theme-hover/40 border border-theme rounded-lg min-h-[30px] items-center">
                          {activeLangs.map((lang) => (
                            <span
                              key={lang}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-theme-primary text-white text-[10px] font-bold shadow-sm"
                            >
                              <span>{lang.toUpperCase()}</span>
                              <button
                                type="button"
                                onClick={() => updateBadge("audio_languages", {
                                  languages: activeLangs.filter(l => l !== lang)
                                })}
                                className="hover:opacity-75"
                                title={`Remove ${lang.toUpperCase()}`}
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                          {activeLangs.length === 0 && (
                            <span className="text-[11px] text-theme-muted px-1">None selected</span>
                          )}
                        </div>
                      </div>

                      {/* Add Custom + Presets Inline */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={customLangInput}
                            onChange={(e) => setCustomLangInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomLang();
                              }
                            }}
                            placeholder="Add code (e.g. TR, NO)..."
                            maxLength={6}
                            className="flex-1 bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono uppercase focus:outline-none focus:border-theme-primary"
                          />
                          <button
                            type="button"
                            onClick={handleAddCustomLang}
                            disabled={!customLangInput.trim()}
                            className="px-2.5 py-1 rounded-lg bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold disabled:opacity-40 transition-all shrink-0"
                          >
                            + Add
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {POPULAR_LANGUAGES.map((lang) => {
                            const isSel = activeLangs.includes(lang.code);
                            return (
                              <button
                                key={lang.code}
                                type="button"
                                onClick={() => {
                                  const next = isSel
                                    ? activeLangs.filter(c => c !== lang.code)
                                    : [...activeLangs, lang.code];
                                  updateBadge("audio_languages", { languages: next });
                                }}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                                  isSel
                                    ? "bg-theme-primary text-white border-theme-primary"
                                    : "bg-theme-hover/60 border-theme text-theme-muted hover:text-theme-text"
                                }`}
                              >
                                {isSel ? "✓ " : "+ "}{lang.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Position & Offsets */}
                      <div className="flex items-start gap-2.5 pt-1 border-t border-theme/40">
                        <PositionPicker
                          value={badges.audio_languages?.position || "bottom-left"}
                          onChange={(p) => updateBadge("audio_languages", { position: p })}
                        />
                        <div className="grid grid-cols-3 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X</label>
                            <input
                              type="number"
                              value={badges.audio_languages?.offset_x !== undefined && badges.audio_languages?.offset_x !== null && badges.audio_languages?.offset_x !== 0 ? badges.audio_languages.offset_x : 30}
                              onChange={(e) => updateBadge("audio_languages", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y</label>
                            <input
                              type="number"
                              value={badges.audio_languages?.offset_y !== undefined && badges.audio_languages?.offset_y !== null && badges.audio_languages?.offset_y !== 0 ? badges.audio_languages.offset_y : (curLib?.media_type === "show" ? 30 : 35)}
                              onChange={(e) => updateBadge("audio_languages", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Max Limit</label>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={badges.audio_languages?.limit ?? 5}
                              onChange={(e) => updateBadge("audio_languages", { limit: parseInt(e.target.value) || 5 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 5. Media Runtime Duration Card
            const renderRuntimeCard = (contextDesc = "Duration badge (e.g. 24 min / 124 min)") => {
              const isRtEnabled = Boolean(badges.runtime?.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isRtEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Clock className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Media Runtime Duration</h4>
                        <p className="text-[10px] text-theme-muted">{contextDesc}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("runtime")}
                      title={isRtEnabled ? "Disable Runtime" : "Enable Runtime"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isRtEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isRtEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isRtEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase flex items-center justify-between">
                          <span>Overlay Scope</span>
                          <span className="text-[9px] text-theme-primary font-mono">{badges.runtime?.level || (isTv ? "episode" : "movie")}</span>
                        </label>
                        <select
                          value={badges.runtime?.level || (isTv ? "episode" : "movie")}
                          onChange={(e) => updateBadge("runtime", { level: e.target.value })}
                          className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                        >
                          {isTv ? (
                            <>
                              <option value="episode">Episode Titlecards & Backdrops (16:9)</option>
                              <option value="season">Season Posters (2:3)</option>
                              <option value="show">Show Main Poster (2:3)</option>
                            </>
                          ) : (
                            <>
                              <option value="movie">Movie Posters (2:3) & Backdrops (16:9)</option>
                            </>
                          )}
                        </select>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={badges.runtime?.position || "bottom-right"}
                          onChange={(p) => updateBadge("runtime", { position: p })}
                        />
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X</label>
                            <input
                              type="number"
                              value={badges.runtime?.offset_x ?? (isTv ? 18 : 140)}
                              onChange={(e) => updateBadge("runtime", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y</label>
                            <input
                              type="number"
                              value={badges.runtime?.offset_y ?? (isTv ? 20 : 37)}
                              onChange={(e) => updateBadge("runtime", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Width</label>
                            <input
                              type="number"
                              value={badges.runtime?.back_width ?? 205}
                              onChange={(e) => updateBadge("runtime", { back_width: parseInt(e.target.value) || 205 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Height</label>
                            <input
                              type="number"
                              value={badges.runtime?.back_height ?? 80}
                              onChange={(e) => updateBadge("runtime", { back_height: parseInt(e.target.value) || 80 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Runtime Text Size & Font Styling */}
                      <div className="p-2.5 rounded-lg bg-theme-hover/40 border border-theme/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-semibold text-theme-text flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-theme-primary" />
                            <span>Text Font Size (px)</span>
                          </label>
                          <span className="text-[9px] font-mono text-theme-primary font-bold">
                            {(badges.runtime?.font_size ?? (isTv ? 52 : 40))}px
                            {isTv && (badges.runtime?.font_size ?? 52) >= 50 && " (Crisp on 4K/Emby)"}
                          </span>
                        </div>

                        {/* Size Presets */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
                          {[
                            { label: "Compact 36px", size: 36 },
                            { label: "Normal 44px", size: 44 },
                            { label: "Titlecard 52px", size: 52 },
                            { label: "Large 60px", size: 60 },
                            { label: "Extra Large 70px", size: 70 }
                          ].map((preset) => {
                            const curSize = badges.runtime?.font_size ?? (isTv ? 52 : 40);
                            const isCurrent = Number(curSize) === preset.size;
                            return (
                              <button
                                key={preset.size}
                                type="button"
                                onClick={() => updateBadge("runtime", { font_size: preset.size })}
                                className={`px-1.5 py-1 rounded text-[10px] font-semibold border transition-all truncate ${
                                  isCurrent
                                    ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                                    : "bg-theme-card border-theme text-theme-muted hover:text-theme-text"
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Custom px input with explanatory note */}
                        <div className="flex items-center gap-2 pt-1 border-t border-theme/30">
                          <div className="flex-1 space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Custom Font Size (px)</label>
                            <input
                              type="number"
                              min="20"
                              max="120"
                              value={badges.runtime?.font_size ?? (isTv ? 52 : 40)}
                              onChange={(e) => updateBadge("runtime", { font_size: parseInt(e.target.value) || (isTv ? 52 : 40) })}
                              className="w-full bg-theme-card border border-theme rounded-md px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <p className="flex-1 text-[10px] text-theme-muted leading-tight">
                            Default for titlecards is <span className="font-semibold text-theme-text">52px</span> so numbers stay sharp and legible in small Emby/Jellyfin thumbnails.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 6. Series Status Banner Card (Show only)
            const renderStatusCard = () => {
              const isStatusEnabled = Boolean(badges.status?.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isStatusEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Activity className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Series Status Banner</h4>
                        <p className="text-[10px] text-theme-muted">Airing, Returning, Ended, Canceled</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("status")}
                      title={isStatusEnabled ? "Disable Status Banner" : "Enable Status Banner"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isStatusEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isStatusEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isStatusEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={badges.status?.position || "bottom-center"}
                          onChange={(p) => updateBadge("status", { position: p })}
                        />
                        <div className="grid grid-cols-3 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X</label>
                            <input
                              type="number"
                              value={badges.status?.offset_x ?? 0}
                              onChange={(e) => updateBadge("status", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y</label>
                            <input
                              type="number"
                              value={badges.status?.offset_y ?? 23}
                              onChange={(e) => updateBadge("status", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Font Size</label>
                            <input
                              type="number"
                              value={badges.status?.font_size ?? 80}
                              onChange={(e) => updateBadge("status", { font_size: parseInt(e.target.value) || 80 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 7. Streaming Network & Studio Logos Card (Show only)
            const renderNetworkCard = () => {
              const isNetEnabled = Boolean(badges.network?.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isNetEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Tv className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">Network / Studio Logos</h4>
                        <p className="text-[10px] text-theme-muted">Netflix, HBO, Disney+, etc.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("network")}
                      title={isNetEnabled ? "Disable Network Logo" : "Enable Network Logo"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isNetEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isNetEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isNetEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2.5">
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-semibold text-theme-muted uppercase">Placement Target</label>
                        <select
                          value={badges.network?.level || "season"}
                          onChange={(e) => updateBadge("network", { level: e.target.value })}
                          className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                        >
                          <option value="season">Season Posters (Recommended)</option>
                          <option value="show">Show Poster</option>
                          <option value="backdrop">Backdrop (16:9)</option>
                        </select>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <PositionPicker
                          value={badges.network?.position || "bottom-center"}
                          onChange={(p) => updateBadge("network", { position: p })}
                        />
                        <div className="grid grid-cols-2 gap-1.5 flex-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset X</label>
                            <input
                              type="number"
                              value={badges.network?.offset_x ?? 30}
                              onChange={(e) => updateBadge("network", { offset_x: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Offset Y</label>
                            <input
                              type="number"
                              value={badges.network?.offset_y ?? 50}
                              onChange={(e) => updateBadge("network", { offset_y: parseInt(e.target.value) || 0 })}
                              className="w-full bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            // 8. AniMetaFill Anime Badges Card (Titlecard only)
            const renderAnimeCard = () => {
              const isAnimeEnabled = Boolean(badges.anime?.enabled);
              return (
                <div className={`p-3.5 sm:p-4 rounded-xl bg-theme-card border transition-all ${
                  isAnimeEnabled ? "border-theme shadow-sm" : "border-theme/60 opacity-80"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-theme-hover text-theme-primary border border-theme">
                        <Zap className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-theme-text">AniMetaFill Anime Badges</h4>
                        <p className="text-[10px] text-theme-muted">Canon & Filler on Titlecards</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBadgeEnabled("anime")}
                      title={isAnimeEnabled ? "Disable Anime Badges" : "Enable Anime Badges"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isAnimeEnabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isAnimeEnabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {isAnimeEnabled && (
                    <div className="pt-3 mt-2.5 border-t border-theme/50 space-y-2">
                      <p className="text-[11px] text-theme-muted">
                        Automatically reads episode canon/filler status from AniMetaFill cache and composites badges onto title cards.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleTabChange("anime")}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-theme-hover border border-theme text-theme-text text-xs font-semibold hover:bg-theme-hover/80 transition-all"
                      >
                        <Sparkles className="w-3 h-3 text-theme-primary" />
                        <span>Configure AniMetaFill Library Rules</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            };

            const posterActiveCount = [
              badges.critic_rating?.enabled,
              badges.resolution?.enabled,
              badges.audio_codec?.enabled,
              badges.video_format?.enabled,
              badges.age_rating?.enabled || badges.rating?.enabled,
              badges.audio_languages?.enabled,
              badges.runtime?.enabled,
              isTv && badges.status?.enabled,
              isTv && badges.network?.enabled
            ].filter(Boolean).length;

            const backdropActiveCount = [
              featureSettings?.backdrop_overlays_enabled && (
                badges.critic_rating?.enabled ||
                badges.resolution?.enabled ||
                badges.audio_codec?.enabled ||
                badges.video_format?.enabled ||
                badges.age_rating?.enabled || badges.rating?.enabled ||
                badges.audio_languages?.enabled ||
                badges.runtime?.enabled ||
                (isTv && badges.status?.enabled) ||
                (isTv && badges.network?.enabled)
              ),
              badges.critic_rating?.enabled,
              badges.resolution?.enabled,
              badges.audio_codec?.enabled,
              badges.video_format?.enabled,
              badges.age_rating?.enabled || badges.rating?.enabled,
              badges.audio_languages?.enabled,
              badges.runtime?.enabled,
              isTv && badges.status?.enabled,
              isTv && badges.network?.enabled
            ].filter(Boolean).length;

            const seasonActiveCount = [
              badges.network?.enabled,
              badges.critic_rating?.enabled,
              badges.age_rating?.enabled || badges.rating?.enabled
            ].filter(Boolean).length;

            const titlecardActiveCount = [
              badges.runtime?.enabled,
              badges.audio_languages?.enabled,
              badges.anime?.enabled,
              badges.critic_rating?.enabled
            ].filter(Boolean).length;

            return (
              <div className="space-y-5">
                {/* LIBRARY HEADER INFO & CONTROLS */}
                <div className="p-3.5 rounded-2xl bg-theme-hover/30 border border-theme flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-theme-hover border border-theme text-theme-primary">
                      {isTv ? <Tv className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-theme-text">{selectedVisualLib}</h3>
                        <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-theme-hover border border-theme text-theme-muted">
                          {isTv ? "Series & Episodes" : "Movies"}
                        </span>
                      </div>
                      <p className="text-xs text-theme-muted mt-0.5">
                        Overlays are rendered dynamically in RAM. Clean asset files remain untouched.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to remove the library '${selectedVisualLib}' from overlay configuration?`)) {
                          setVisualConfig((prev) => {
                            const next = { ...prev.libraries };
                            delete next[selectedVisualLib];
                            const remaining = Object.keys(next);
                            if (remaining.length > 0) setSelectedVisualLib(remaining[0]);
                            else setSelectedVisualLib("");
                            return { ...prev, libraries: next };
                          });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Library</span>
                    </button>
                  </div>
                </div>

                
                {/* ASSET TARGET SELECTOR (POSTERS / BACKDROPS / SEASONS / TITLE CARDS) */}
                {(() => {
                  const effectiveAssetTarget = (!isTv && (activeAssetTarget === "season" || activeAssetTarget === "titlecard"))
                    ? "poster"
                    : activeAssetTarget;

                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-theme-hover/40 border border-theme rounded-2xl">
                        {/* 1. Posters Target */}
                        <button
                          type="button"
                          onClick={() => setActiveAssetTarget("poster")}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                            effectiveAssetTarget === "poster"
                              ? "bg-theme-primary text-white shadow-md shadow-theme-primary/30"
                              : "text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                          }`}
                        >
                          <Film className="w-4 h-4" />
                          <span>{isTv ? "Show Posters (2:3)" : "Movie Posters (2:3)"}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 font-mono">
                            {posterActiveCount}
                          </span>
                        </button>

                        {/* 2. Backdrops Target */}
                        <button
                          type="button"
                          onClick={() => setActiveAssetTarget("backdrop")}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                            effectiveAssetTarget === "backdrop"
                              ? "bg-theme-primary text-white shadow-md shadow-theme-primary/30"
                              : "text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                          }`}
                        >
                          <Layers className="w-4 h-4" />
                          <span>Backdrops (16:9)</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 font-mono">
                            {backdropActiveCount}
                          </span>
                        </button>

                        {/* 3. Season Posters Target (TV only) */}
                        {isTv && (
                          <button
                            type="button"
                            onClick={() => setActiveAssetTarget("season")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                              effectiveAssetTarget === "season"
                                ? "bg-theme-primary text-white shadow-md shadow-theme-primary/30"
                              : "text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                            }`}
                          >
                            <Tv className="w-4 h-4" />
                            <span>Season Posters (2:3)</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 font-mono">
                              {seasonActiveCount}
                            </span>
                          </button>
                        )}

                        {/* 4. Title Cards Target (TV only) */}
                        {isTv && (
                          <button
                            type="button"
                            onClick={() => setActiveAssetTarget("titlecard")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                              effectiveAssetTarget === "titlecard"
                                ? "bg-theme-primary text-white shadow-md shadow-theme-primary/30"
                                : "text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                            }`}
                          >
                            <Sparkles className="w-4 h-4" />
                            <span>Title Cards (16:9)</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/30 font-mono">
                              {titlecardActiveCount}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* 16:9 Backdrop Overlays Master Banner (When on Backdrops) */}
                      {effectiveAssetTarget === "backdrop" && (
                        <div className="p-3.5 sm:p-4 rounded-xl bg-theme-hover/30 border border-theme flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <Layers className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-xs text-theme-text">16:9 Movie & Show Backdrop Overlays</h4>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  featureSettings?.backdrop_overlays_enabled
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-theme-hover text-theme-muted border-theme"
                                }`}>
                                  {featureSettings?.backdrop_overlays_enabled ? "Active" : "Disabled"}
                                </span>
                              </div>
                              <p className="text-[11px] text-theme-muted mt-0.5">
                                Adds ratings, quality ribbons, audio flags, and runtime directly onto your 16:9 backdrops.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUpdateDynamicSettings({ backdrop_overlays_enabled: !featureSettings?.backdrop_overlays_enabled })}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shrink-0 ${
                              featureSettings?.backdrop_overlays_enabled ? "bg-emerald-500" : "bg-theme-card border border-theme"
                            }`}
                            title="Toggle Backdrop Overlays"
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                featureSettings?.backdrop_overlays_enabled ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      )}

                      {/* BALANCED 2-COLUMN MASONRY-STYLE LAYOUT (ZERO EMPTY VERTICAL GAPS) */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
                        {/* LEFT COLUMN */}
                        <div className="flex flex-col gap-3.5">
                          {effectiveAssetTarget === "poster" && (
                            <>
                              {renderCriticRatingCard(false)}
                              {renderAgeRatingCard()}
                              {renderRuntimeCard(isTv ? "Duration on Show posters (e.g. 124 min)" : "Duration on Movie posters (e.g. 124 min)")}
                            </>
                          )}
                          {effectiveAssetTarget === "backdrop" && (
                            <>
                              {renderCriticRatingCard(true)}
                              {renderAgeRatingCard()}
                              {renderRuntimeCard("Duration on 16:9 Backdrops (e.g. 124 min)")}
                            </>
                          )}
                          {effectiveAssetTarget === "season" && isTv && (
                            <>
                              {renderNetworkCard()}
                              {renderCriticRatingCard(false)}
                            </>
                          )}
                          {effectiveAssetTarget === "titlecard" && isTv && (
                            <>
                              {renderRuntimeCard("Duration on Episode titlecards (e.g. 24 min)")}
                              {renderAnimeCard()}
                            </>
                          )}
                        </div>

                        {/* RIGHT COLUMN */}
                        <div className="flex flex-col gap-3.5">
                          {effectiveAssetTarget === "poster" && (
                            <>
                              {renderResolutionCard()}
                              {renderVideoFormatCard()}
                              {renderAudioCodecCard()}
                              {renderAudioLanguagesCard(isTv ? "Audio tracks on Show posters" : "Audio tracks on Movie posters")}
                              {isTv && renderStatusCard()}
                              {isTv && renderNetworkCard()}
                            </>
                          )}
                          {effectiveAssetTarget === "backdrop" && (
                            <>
                              {renderResolutionCard()}
                              {renderVideoFormatCard()}
                              {renderAudioCodecCard()}
                              {renderAudioLanguagesCard("Audio tracks on 16:9 Backdrops")}
                              {isTv && renderStatusCard()}
                              {isTv && renderNetworkCard()}
                            </>
                          )}
                          {effectiveAssetTarget === "season" && isTv && (
                            <>
                              {renderAgeRatingCard()}
                            </>
                          )}
                          {effectiveAssetTarget === "titlecard" && isTv && (
                            <>
                              {renderAudioCodecCard()}
                              {renderAudioLanguagesCard("Audio tracks on Episode titlecards")}
                              {renderCriticRatingCard(false)}
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
                
                {/* CENTRAL ENGINE SETTINGS & PROVIDER KEYS (ACCORDION CARD) */}
                {/* RATINGS PROVIDERS & AUTO-REFRESH (ACCORDION CARD) */}
                <div className="bg-theme-card border border-theme rounded-2xl shadow-sm overflow-hidden transition-all mt-6">
                  <div className="p-4 sm:p-5 flex items-center justify-between gap-4 bg-theme-hover/20 border-b border-theme/60">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                        <Sliders className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-theme-text">Overlay Engine, Concurrency & Provider Settings</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            featureSettings?.debug_logging
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-theme-hover text-theme-muted border-theme"
                          }`}>
                            Debug: {featureSettings?.debug_logging ? "Active" : "Off"}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                            {featureSettings?.concurrency || 4} Workers
                          </span>
                        </div>
                        <p className="text-xs text-theme-muted mt-0.5">
                          Configure parallel RAM workers, debug pixel log, API keys (MDBList, OMDb), and auto-refresh schedule.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsGlobalSettingsOpen(!isGlobalSettingsOpen)}
                      className="p-1.5 rounded-lg bg-theme-hover text-theme-muted hover:text-theme-text transition-all"
                      title={isGlobalSettingsOpen ? "Collapse" : "Expand"}
                    >
                      {isGlobalSettingsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>

                  {isGlobalSettingsOpen && (
                    <div className="p-5 space-y-4">
                      {/* Auto-Sync Toggle */}
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-theme-hover/30 border border-theme">
                        <div>
                          <span className="text-xs font-bold text-theme-text block">Auto-Sync on New Artwork</span>
                          <span className="text-[11px] text-theme-muted">
                            Automatically add overlays whenever Posterizarr creates new artwork in scheduled runs.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUpdateDynamicSettings({ auto_sync_on_startup: !featureSettings?.auto_sync_on_startup })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            featureSettings?.auto_sync_on_startup ? "bg-emerald-500" : "bg-theme-card border border-theme"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              featureSettings?.auto_sync_on_startup ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {/* Optional API Keys */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        {/* MDBList */}
                        <div className="space-y-1.5 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-theme-text uppercase tracking-wider flex items-center gap-1.5">
                              <Key className="w-3 h-3 text-amber-400" />
                              MDBList API Key <span className="text-theme-muted font-normal">(Optional)</span>
                            </label>
                            <span className="text-[10px] text-theme-muted">Trakt, Letterboxd, IMDb, RT</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showMdblistKey ? "text" : "password"}
                                placeholder="Optional MDBList API key..."
                                value={featureSettings?.mdblist_api_key || ""}
                                onChange={(e) => setFeatureSettings(prev => ({ ...prev, mdblist_api_key: e.target.value }))}
                                onBlur={() => handleUpdateDynamicSettings({ mdblist_api_key: featureSettings?.mdblist_api_key })}
                                className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 pr-9 text-xs text-theme-text font-mono focus:ring-1 focus:ring-theme-primary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => setShowMdblistKey(!showMdblistKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                                title={showMdblistKey ? "Hide key" : "Show key"}
                              >
                                {showMdblistKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTestApiKey("mdblist")}
                              disabled={testingApiKey.mdblist || !featureSettings?.mdblist_api_key}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-theme-hover hover:bg-theme-primary/20 border border-theme hover:border-theme-primary/40 text-xs font-semibold text-theme-text transition-all disabled:opacity-40"
                              title="Test MDBList API Key against benchmark item"
                            >
                              {testingApiKey.mdblist ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-primary" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 text-amber-400" />
                              )}
                              <span>Test</span>
                            </button>
                          </div>
                          {apiKeyTestResult.mdblist && (
                            <div className={`p-2 rounded-lg text-xs flex items-start gap-1.5 ${
                              apiKeyTestResult.mdblist.success
                                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                : "bg-red-500/10 border border-red-500/20 text-red-400"
                            }`}>
                              {apiKeyTestResult.mdblist.success ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              )}
                              <span className="font-mono text-[11px] leading-tight">
                                {apiKeyTestResult.mdblist.message || apiKeyTestResult.mdblist.error}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* OMDb */}
                        <div className="space-y-1.5 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-theme-text uppercase tracking-wider flex items-center gap-1.5">
                              <Key className="w-3 h-3 text-cyan-400" />
                              OMDb API Key <span className="text-theme-muted font-normal">(Optional)</span>
                            </label>
                            <span className="text-[10px] text-theme-muted">IMDb, Rotten Tomatoes, Metacritic</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showOmdbKey ? "text" : "password"}
                                placeholder="Optional OMDb API key..."
                                value={featureSettings?.omdb_api_key || ""}
                                onChange={(e) => setFeatureSettings(prev => ({ ...prev, omdb_api_key: e.target.value }))}
                                onBlur={() => handleUpdateDynamicSettings({ omdb_api_key: featureSettings?.omdb_api_key })}
                                className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 pr-9 text-xs text-theme-text font-mono focus:ring-1 focus:ring-theme-primary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => setShowOmdbKey(!showOmdbKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                                title={showOmdbKey ? "Hide key" : "Show key"}
                              >
                                {showOmdbKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTestApiKey("omdb")}
                              disabled={testingApiKey.omdb || !featureSettings?.omdb_api_key}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-theme-hover hover:bg-theme-primary/20 border border-theme hover:border-theme-primary/40 text-xs font-semibold text-theme-text transition-all disabled:opacity-40"
                              title="Test OMDb API Key against benchmark item"
                            >
                              {testingApiKey.omdb ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-primary" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                              )}
                              <span>Test</span>
                            </button>
                          </div>
                          {apiKeyTestResult.omdb && (
                            <div className={`p-2 rounded-lg text-xs flex items-start gap-1.5 ${
                              apiKeyTestResult.omdb.success
                                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                : "bg-red-500/10 border border-red-500/20 text-red-400"
                            }`}>
                              {apiKeyTestResult.omdb.success ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              )}
                              <span className="font-mono text-[11px] leading-tight">
                                {apiKeyTestResult.omdb.message || apiKeyTestResult.omdb.error}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Tiered TTL Summary & Clear Ratings Cache */}
                      <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme/60 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-xs text-theme-text flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              Saved Ratings & Refresh Rules
                            </div>
                            <div className="text-[11px] text-theme-muted mt-0.5">
                              Ratings are saved on your computer so external websites aren't spammed with requests. Newer movies refresh more often:
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearRatingsCache}
                            disabled={isClearingRatingsCache}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all self-start sm:self-auto disabled:opacity-50"
                            title="Purge cached ratings so next run re-queries all media with your latest keys"
                          >
                            {isClearingRatingsCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            <span>Clear Ratings Cache</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-theme/40 text-[11px] text-theme-muted">
                          <div>• <strong className="text-theme-text">New releases (&lt; 6 months):</strong> Refreshes every 3 days</div>
                          <div>• <strong className="text-theme-text">Recent (&lt; 2 years):</strong> Refreshes every 14 days</div>
                          <div>• <strong className="text-theme-text">Older (&gt; 2 years):</strong> Refreshes every 30 days</div>
                        </div>
                      </div>

                      {/* Debug Coordinates Logging Toggle */}
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-theme-hover/30 border border-theme">
                        <div className="space-y-0.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-theme-text">Debug Pixel Coordinates Logging</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              featureSettings?.debug_logging
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-theme-hover text-theme-muted border-theme"
                            }`}>
                              {featureSettings?.debug_logging ? "Active" : "Off"}
                            </span>
                          </div>
                          <span className="text-[11px] text-theme-muted block">
                            Prints exact per-poster pixel coordinates (px), resolution scale factors (e.g. 2000x3000 = 2.0x), and container bounding boxes into DynamicOverlaysSync.log.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUpdateDynamicSettings({ debug_logging: !featureSettings?.debug_logging })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            featureSettings?.debug_logging ? "bg-amber-500" : "bg-theme-card border border-theme"
                          }`}
                          title="Toggle Debug Coordinates Logging"
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              featureSettings?.debug_logging ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {/* Parallel In-Memory Processing Concurrency */}
                      <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-theme-text block">Parallel In-Memory Processing</span>
                            <span className="text-[11px] text-theme-muted">
                              Number of artwork items composited and synchronized simultaneously in RAM.
                            </span>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary font-bold font-mono text-xs">
                            {featureSettings?.concurrency || 4} parallel items
                          </span>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                          <input
                            type="range"
                            min="1"
                            max="8"
                            step="1"
                            value={featureSettings?.concurrency || 4}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setFeatureSettings(prev => ({ ...prev, concurrency: val }));
                            }}
                            onMouseUp={() => handleUpdateDynamicSettings({ concurrency: featureSettings?.concurrency || 4 })}
                            onTouchEnd={() => handleUpdateDynamicSettings({ concurrency: featureSettings?.concurrency || 4 })}
                            className="flex-1 accent-theme-primary cursor-pointer"
                          />
                          <div className="flex gap-1 text-[10px] text-theme-muted font-mono">
                            <span>1 (Serial)</span>
                            <span className="mx-1">•</span>
                            <span>4 (Default)</span>
                            <span className="mx-1">•</span>
                            <span>8 (Turbo)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: IMPORTER & PRE-FLIGHT VALIDATOR */}
      {/* ========================================================================= */}
      {featureSettings?.enabled && activeTab === "importer" && (
        <div className="space-y-6">
          <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary shrink-0">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-theme-text">
                  Config Folder & Readiness Checklist
                </h2>
                <p className="text-xs text-theme-muted mt-0.5 font-mono">
                  Storage: Overlayfiles/dynamic_overlays/configs/
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin text-theme-primary" : ""}`} />
                {isScanning ? "Checking..." : "Recheck Dependencies"}
              </button>

              <button
                onClick={() => handleImport(true)}
                disabled={isImporting}
                title="Download and update official overlay templates from repository"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm disabled:opacity-50"
              >
                <Download className={`w-4 h-4 text-theme-primary ${isImporting ? "animate-bounce" : ""}`} />
                {isImporting ? "Importing Defaults..." : "Import Overlay Defaults"}
              </button>

              {isDefaultsScheduled ? (
                <button
                  onClick={() => navigate("/scheduler", { state: { prefillMode: "overlaydefaults" } })}
                  title="Overlay Defaults auto-update is scheduled. Click to view or adjust schedule in Scheduler."
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm"
                >
                  <Clock className="w-3.5 h-3.5 text-theme-primary" />
                  <span>Auto-Update: {getScheduleDescription(overlaySchedule)}</span>
                </button>
              ) : (
                <button
                  onClick={handleQuickSchedule}
                  disabled={isQuickScheduling}
                  title="Schedule automatic weekly updates from GitHub (Sundays @ 03:00)"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-muted hover:text-theme-text transition-all shadow-sm disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5 text-theme-muted" />
                  <span>{isQuickScheduling ? "Scheduling..." : "Schedule Auto-Update"}</span>
                </button>
              )}

              {readiness.fetchable > 0 && (
                <button
                  onClick={handleBatchFetch}
                  disabled={isBatchFetching}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  <Download className={`w-4 h-4 ${isBatchFetching ? "animate-bounce" : ""}`} />
                  {isBatchFetching ? "Downloading..." : `Download All Available (${readiness.fetchable})`}
                </button>
              )}

              <label className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm cursor-pointer">
                <Upload className="w-4 h-4 text-theme-primary" />
                <span>Browse & Upload Asset...</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.ttf,.otf,.yml,.yaml"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, "image")}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-theme-card border border-theme rounded-xl p-5 flex items-center gap-3.5 shadow-sm">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-theme-text">{readiness.ready}</div>
                <div className="text-xs text-theme-muted">Assets Ready & Verified</div>
              </div>
            </div>

            <div className="bg-theme-card border border-theme rounded-xl p-5 flex items-center gap-3.5 shadow-sm">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-theme-text">{readiness.fetchable}</div>
                <div className="text-xs text-theme-muted">Available from GitHub / Seed</div>
              </div>
            </div>

            <div className="bg-theme-card border border-theme rounded-xl p-5 flex items-center gap-3.5 shadow-sm">
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-theme-text">{readiness.missing}</div>
                <div className="text-xs text-theme-muted">Custom Files Needed</div>
              </div>
            </div>
          </div>

          {/* YAML CONFIGURATION & OVERLAY FILES CARD */}
          <div className="bg-theme-card border border-theme rounded-xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-theme flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-theme-text text-sm">YAML Configuration & Overlay Files</h3>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-theme-bg border border-theme text-theme-muted font-mono">
                      {yamlFiles.length} {yamlFiles.length === 1 ? "file" : "files"}
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted font-mono mt-0.5">
                    Overlayfiles/dynamic_overlays/configs/
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm cursor-pointer">
                  <FolderOpen className="w-3.5 h-3.5 text-theme-primary" />
                  <span>Browse & Upload YAML...</span>
                  <input
                    ref={yamlFileInputRef}
                    type="file"
                    multiple
                    accept=".yml,.yaml"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, "config")}
                  />
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-theme-bg text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme">
                  <tr>
                    <th className="py-3 px-4">File Name</th>
                    <th className="py-3 px-4">Role / Type</th>
                    <th className="py-3 px-4">Size</th>
                    <th className="py-3 px-4">Last Modified</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme/40 text-theme-text">
                  {yamlFiles.map((file, idx) => {
                    const badge = getYamlFileBadge(file.name);
                    const isMain = file.name.toLowerCase() === "config.yml" || file.name.toLowerCase() === "config.yaml";
                    return (
                      <tr key={idx} className="hover:bg-theme-hover/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 font-mono font-medium">
                            <FileCode className={`w-4 h-4 shrink-0 ${isMain ? "text-theme-primary" : "text-theme-muted"}`} />
                            <span
                              className="text-theme-text hover:text-theme-primary transition-colors cursor-pointer"
                              onClick={() => handleOpenRawYaml(file.name)}
                              title="Click to edit raw YAML"
                            >
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-theme-muted">
                          {formatFileSize(file.size_bytes)}
                        </td>
                        <td className="py-3 px-4 text-theme-muted">
                          {formatFileDate(file.modified_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => handleOpenRawYaml(file.name)}
                              title={`Edit raw ${file.name}`}
                              className="px-2.5 py-1 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text font-medium transition-all inline-flex items-center gap-1 shadow-sm"
                            >
                              <Code className="w-3 h-3 text-theme-primary" />
                              Edit Raw
                            </button>
                            <button
                              onClick={() => handleDeleteYamlFile(file.name)}
                              disabled={isDeletingYaml}
                              title={`Delete ${file.name}`}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/30 text-theme-muted hover:text-red-400 transition-all disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {yamlFiles.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-theme-muted">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <FileCode className="w-8 h-8 text-theme-muted/50" />
                          <p>No YAML configuration files uploaded yet.</p>
                          <p className="text-[11px] text-theme-muted/80">
                            Upload <code className="text-theme-primary font-mono">config.yml</code> or overlay YAMLs (<code className="text-theme-primary font-mono">overlays_tv.yml</code>, <code className="text-theme-primary font-mono">anime_overlays.yml</code>, <code className="text-theme-primary font-mono">overlays_movies.yml</code>) above.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-theme-card border border-theme rounded-xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-theme flex items-center justify-between">
              <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-theme-primary" />
                Asset Dependency Checklist
              </h3>
              <span className="text-xs text-theme-muted">
                {readiness.assets.length} total required assets found in YAMLs
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-theme-bg text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme">
                  <tr>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Resource Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Source / Location</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme/40 text-theme-text">
                  {readiness.assets.map((asset, idx) => {
                    const isReady = asset.status === "ready";
                    const isFetchable = asset.status === "fetchable";
                    return (
                      <tr key={idx} className="hover:bg-theme-hover/30 transition-colors">
                        <td className="py-3 px-4">
                          {isReady ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-theme-primary/10 border border-theme-primary/30 text-theme-primary font-medium">
                              <Check className="w-3 h-3" /> Ready
                            </span>
                          ) : isFetchable ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-theme-card border border-theme text-theme-text font-medium">
                              <Download className="w-3 h-3 text-theme-primary" /> Fetchable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium">
                              <AlertTriangle className="w-3 h-3" /> Missing
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-medium">{asset.name}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-theme-bg border border-theme text-[10px] uppercase font-semibold">
                            {asset.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-theme-muted max-w-xs truncate">
                          {isReady ? (
                            <span className="text-theme-text/80 font-mono text-[11px]">
                              {asset.resolved_path?.split("Overlayfiles")?.[1] || asset.resolved_path}
                            </span>
                          ) : isFetchable ? (
                            <span>
                              {asset.source_type === "local_seed" ? "Local Seed Cache" : "Remote Template Repository"}
                            </span>
                          ) : (
                            <span className="text-amber-400/90">
                              Place in Overlayfiles/dynamic_overlays/assets/
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isFetchable && (
                            <button
                              onClick={() => handleFetchAsset(asset)}
                              disabled={fetchingAsset === asset.name}
                              className="px-2.5 py-1 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text font-medium transition-all inline-flex items-center gap-1 shadow-sm"
                            >
                              {fetchingAsset === asset.name ? (
                                <Loader2 className="w-3 h-3 animate-spin text-theme-primary" />
                              ) : (
                                <Download className="w-3 h-3 text-theme-primary" />
                              )}
                              Download
                            </button>
                          )}
                          {!isReady && !isFetchable && (
                            <label className="px-2.5 py-1 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text font-medium transition-all inline-flex items-center gap-1 cursor-pointer shadow-sm">
                              <Upload className="w-3 h-3 text-theme-primary" />
                              Browse & Upload
                              <input
                                type="file"
                                multiple
                                accept=".png,.jpg,.jpeg,.webp,.ttf,.otf,.yml,.yaml"
                                className="hidden"
                                onChange={(e) => handleFileUpload(e, asset.category)}
                              />
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {readiness.assets.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-theme-muted">
                        No overlay asset dependencies detected. Click "Import Overlay Defaults" or upload a config.yaml to Overlayfiles/dynamic_overlays/configs/.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ACTIVE LIBRARIES & RULES (INTERACTIVE EDITING & REMOVAL) */}
      {/* ========================================================================= */}
      {featureSettings?.enabled && activeTab === "rules" && (
        <div className="space-y-6">
          {/* TOOLBAR */}
          <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-theme-text">
                  Active Libraries & Rules
                </h2>
                <p className="text-xs text-theme-muted mt-0.5">
                  Customize, add, or remove overlay rules per library. Automatic backup created upon changes.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setNewLibraryName(""); setIsAddLibraryOpen(true); }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                Add Library
              </button>
              <div className="flex items-center gap-1.5 bg-theme-bg border border-theme rounded-lg px-2.5 py-1.5">
                <Code className="w-4 h-4 text-theme-muted" />
                <span className="text-xs font-semibold text-theme-muted">Edit YAML:</span>
                <select
                  className="bg-transparent text-xs font-mono text-theme-text outline-none cursor-pointer pr-1"
                  value={selectedYamlFile}
                  onChange={(e) => handleOpenRawYaml(e.target.value)}
                >
                  {yamlFiles.length > 0 ? (
                    yamlFiles.map((yf) => (
                      <option key={yf.name} value={yf.name} className="bg-theme-card text-theme-text font-mono">
                        {yf.name}
                      </option>
                    ))
                  ) : (
                    <option value="config.yml" className="bg-theme-card text-theme-text font-mono">config.yml</option>
                  )}
                </select>
                <button
                  onClick={() => handleOpenRawYaml(selectedYamlFile)}
                  className="px-2.5 py-1 rounded-md bg-theme-card hover:bg-theme-hover text-xs font-semibold text-theme-text border border-theme transition-colors shadow-sm"
                >
                  Open
                </button>
              </div>
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? "animate-spin text-theme-primary" : ""}`} />
                Re-scan
              </button>
            </div>
          </div>

          {/* LIBRARIES MULTI-SELECT TOOLBAR */}
          {Object.keys(libraries).length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-theme-hover/20 border border-theme">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-theme-text select-none">
                  <input
                    type="checkbox"
                    checked={
                      Object.keys(libraries).length > 0 &&
                      selectedLibraries.length === Object.keys(libraries).length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedLibraries(Object.keys(libraries));
                      } else {
                        setSelectedLibraries([]);
                      }
                    }}
                    className="w-4 h-4 rounded border-theme text-theme-primary focus:ring-theme-primary/30 cursor-pointer"
                  />
                  <span>Select All ({Object.keys(libraries).length} libraries)</span>
                </label>
                {selectedLibraries.length > 0 && (
                  <span className="text-xs text-theme-primary font-bold">
                    {selectedLibraries.length} selected
                  </span>
                )}
              </div>

              {selectedLibraries.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedLibraries([])}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-theme-muted hover:text-theme-text transition-colors"
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenBatchRemoveLibraries}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-bold transition-all shadow-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Selected ({selectedLibraries.length})</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* LIBRARIES GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(libraries).map(([libName, libInfo]) => (
              <div key={libName} className={`bg-theme-card border rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between transition-all ${
                selectedLibraries.includes(libName) ? "border-theme-primary ring-1 ring-theme-primary/30" : "border-theme"
              }`}>
                {/* Library Header */}
                <div className="flex items-center justify-between border-b border-theme pb-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedLibraries.includes(libName)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedLibraries(prev => [...prev, libName]);
                        } else {
                          setSelectedLibraries(prev => prev.filter(n => n !== libName));
                        }
                      }}
                      className="w-4 h-4 rounded border-theme text-theme-primary focus:ring-theme-primary/30 cursor-pointer"
                      title={`Select '${libName}'`}
                    />
                    <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                      {libName.toLowerCase().includes("tv") || libName.toLowerCase().includes("show") ? (
                        <Tv className="w-5 h-5" />
                      ) : (
                        <Film className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-theme-text text-base">{libName}</h3>
                      <p className="text-xs text-theme-muted">{libInfo.overlays_count || 0} active overlay rules</p>
                    </div>
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setAddOverlayModal({ libraryName: libName });
                        setNewOverlayType("default");
                        setNewOverlayName("runtimes");
                        setNewOverlayLevel("episode");
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium transition-all shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5 text-theme-primary" />
                      Add Overlay
                    </button>
                    <button
                      onClick={() => handleOpenRemoveLibrary(libName)}
                      title={`Remove entire library '${libName}'`}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400 border border-transparent hover:border-red-500/30 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Overlays list */}
                <div className="space-y-2.5 flex-1">
                  {(libInfo.overlays || []).map((ov, oIdx) => {
                    const presetMatch = DEFAULT_OVERLAY_PRESETS.find(p => p.id === ov.name);
                    return (
                      <div key={oIdx} className="p-3.5 rounded-xl bg-theme-hover/40 border border-theme/60 flex items-center justify-between gap-3 text-xs group hover:border-theme transition-all">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <span className="p-1.5 rounded-lg bg-theme-card border border-theme text-theme-primary">
                            <Sparkles className="w-3.5 h-3.5" />
                          </span>
                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-theme-text capitalize truncate">{ov.name}</span>
                              {presetMatch && (
                                <span className="text-[10px] text-theme-muted px-1.5 py-0.2 rounded bg-theme-card border border-theme/40 hidden sm:inline">
                                  {presetMatch.label}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-theme-muted mt-0.5">
                              <span className="uppercase font-mono px-1.5 py-0.2 rounded bg-theme-card border border-theme/60">
                                {ov.type}
                              </span>
                              {ov.variables?.builder_level && (
                                <span className="text-emerald-400 font-mono">level: {ov.variables.builder_level}</span>
                              )}
                              {ov.variables?.horizontal_align && (
                                <span className="text-theme-muted font-mono">{ov.variables.horizontal_align}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Rule Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Edit Variables */}
                          <button
                            onClick={() => handleOpenEditVariables(libName, oIdx, ov)}
                            title="Edit template variables & level"
                            className="p-1.5 rounded-lg bg-theme-hover border border-theme hover:bg-theme-primary/10 hover:text-theme-primary hover:border-theme-primary/30 transition-all text-theme-muted"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>

                          {/* Remove Rule */}
                          <button
                            onClick={() => handleRemoveOverlay(libName, oIdx, ov.name)}
                            title="Remove overlay from library"
                            className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {(libInfo.overlays || []).length === 0 && (
                    <div className="p-6 text-center text-theme-muted text-xs border border-dashed border-theme rounded-xl">
                      No overlays configured for this library yet. Click "+ Add Overlay" above.
                    </div>
                  )}
                </div>
              </div>
            ))}

            {Object.keys(libraries).length === 0 && (
              <div className="col-span-2 bg-theme-card border border-theme rounded-2xl p-10 flex flex-col items-center justify-center text-center space-y-4 shadow-md">
                <div className="p-4 rounded-2xl bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <FolderOpen className="w-10 h-10" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-base font-bold text-theme-text">No Overlay Configuration Loaded Yet</h3>
                  <p className="text-xs text-theme-muted mt-1 leading-relaxed">
                    Posterizarr leaves your clean asset folders untouched. Import official overlay template defaults, upload a custom <span className="font-mono text-theme-text">config.yaml</span>, or create a new library visually.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={handleQuickStart}
                    disabled={isQuickStarting}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    <Zap className={`w-4 h-4 ${isQuickStarting ? "animate-spin" : ""}`} />
                    <span>{isQuickStarting ? "Configuring..." : "Quick Start: Auto-Configure Overlays"}</span>
                  </button>
                  <button
                    onClick={() => handleImport(true)}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    <Download className={`w-4 h-4 ${isImporting ? "animate-bounce" : ""}`} />
                    <span>{isImporting ? "Importing Defaults..." : "Import Overlay Defaults"}</span>
                  </button>
                  {!isDefaultsScheduled ? (
                    <button
                      onClick={handleQuickSchedule}
                      disabled={isQuickScheduling}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      <Clock className="w-4 h-4 text-theme-primary" />
                      <span>{isQuickScheduling ? "Scheduling..." : "Schedule Weekly Auto-Update"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => navigate("/scheduler", { state: { prefillMode: "overlaydefaults" } })}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all"
                    >
                      <Clock className="w-4 h-4 text-theme-primary" />
                      <span>Scheduled: {getScheduleDescription(overlaySchedule)}</span>
                    </button>
                  )}
                  <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-theme-hover border border-theme text-xs font-semibold text-theme-text hover:bg-theme-hover/80 transition-all cursor-pointer">
                    <Upload className="w-4 h-4 text-theme-primary" />
                    Upload config.yaml
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.ttf,.otf,.yml,.yaml"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, "config")}
                    />
                  </label>
                  <button
                    onClick={() => { setNewLibraryName(""); setIsAddLibraryOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Create New Library
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: LIVE PREVIEW & DRAG-AND-DROP LAYOUT EDITOR */}
      {/* ========================================================================= */}
      {featureSettings?.enabled && activeTab === "preview" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* CONTROLS COLUMN */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-4">
            {/* Card 1: Canvas Format & Quick Refresh */}
            <div className="bg-theme-card border border-theme rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-theme/60 pb-3">
                <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-theme-primary" />
                  Preview Format
                </h3>
                <button
                  type="button"
                  onClick={() => setPreviewTimestamp(Date.now())}
                  className="text-xs text-theme-primary hover:underline flex items-center gap-1 font-semibold"
                  title="Reload preview image"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {getAvailableFormats(selectedSaveLibrary).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleFormatChange(t.id)}
                    className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all text-center flex flex-col items-center justify-center gap-0.5 ${
                      previewTemplate === t.id
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Card 2: Badges & Ratings */}
            <div className="bg-theme-card border border-theme rounded-2xl p-5 shadow-sm space-y-4">
              <div className="border-b border-theme/60 pb-3">
                <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Ratings & Quality Badges
                </h3>
                <p className="text-[11px] text-theme-muted mt-0.5">
                  Test badge alignment and layouts on this preview canvas. Live sync dynamically evaluates actual media streams.
                </p>
              </div>

              {/* Resolution Badge */}
              <div className="space-y-1.5 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text flex items-center gap-1.5">
                    <span>Resolution Badge</span>
                  </label>
                  <span className="text-[11px] font-mono text-theme-muted">{previewResolution || "None"}</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                  {["4K", "1080p", "720p", "576p", "480p", "None"].map((res) => (
                    <button
                      key={res}
                      onClick={() => { setPreviewResolution(res === "None" ? "" : res); setPreviewTimestamp(Date.now()); }}
                      className={`py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                        previewResolution === res || (res === "None" && !previewResolution)
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
                {previewResolution && (
                  <>
                    {!isLandscapeFormat(previewTemplate) && (
                      <div className="pt-2 flex items-center justify-between border-t border-theme/40">
                        <span className="text-[11px] text-theme-muted font-medium">Style</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setResolutionMode("banner");
                              handleOffsetChange("resolution", { x: 0, y: 0, align: "center", valign: "top", mode: "banner", banner_4k: true }, true);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                              resolutionMode === "banner" || offsets.resolution?.mode === "banner"
                                ? "bg-theme-primary text-white border-theme-primary"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Top Banner Ribbon
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResolutionMode("badge");
                              handleOffsetChange("resolution", { x: 15, y: 15, align: "left", valign: "top", mode: "corner_badge", banner_4k: false }, true);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                              resolutionMode === "badge" || offsets.resolution?.mode === "corner_badge"
                                ? "bg-theme-primary text-white border-theme-primary"
                                : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                            }`}
                          >
                            Corner Badge
                          </button>
                        </div>
                      </div>
                    )}
                    {(isLandscapeFormat(previewTemplate) || resolutionMode === "badge" || offsets.resolution?.mode === "corner_badge") && (
                      <div className="pt-2 border-t border-theme/40 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-theme-muted font-medium flex items-center gap-1">
                            <Palette className="w-3 h-3 text-theme-primary" />
                            <span>Contrast Pill Background</span>
                          </span>
                          <span className="text-[10px] font-mono text-theme-text bg-theme-hover px-1.5 py-0.5 rounded border border-theme">
                            {offsets.resolution?.back_color || "#00000099"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                          {[
                            { label: "Dark Glass", val: "#00000099" },
                            { label: "Solid Dark", val: "#000000E6" },
                            { label: "Light Glass", val: "#FFFFFF99" },
                            { label: "Solid Light", val: "#FFFFFFAA" },
                            { label: "None", val: "#00000000" }
                          ].map((p) => {
                            const isCur = (offsets.resolution?.back_color || "#00000099").toLowerCase() === p.val.toLowerCase();
                            return (
                              <button
                                key={p.val}
                                type="button"
                                onClick={() => handleOffsetChange("resolution", {
                                  ...(offsets.resolution || {}),
                                  back_color: p.val
                                }, true)}
                                className={`px-1.5 py-1 rounded text-[10px] font-semibold border transition-all truncate ${
                                  isCur
                                    ? "bg-theme-primary text-white border-theme-primary"
                                    : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                                }`}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Color Hex</label>
                            <input
                              type="text"
                              value={offsets.resolution?.back_color ?? "#00000099"}
                              onChange={(e) => handleOffsetChange("resolution", {
                                ...(offsets.resolution || {}),
                                back_color: e.target.value
                              }, true)}
                              className="w-full bg-theme-hover border border-theme rounded px-1.5 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] font-semibold text-theme-muted uppercase">Radius (px)</label>
                            <input
                              type="number"
                              min="0"
                              max="50"
                              value={offsets.resolution?.back_radius ?? 15}
                              onChange={(e) => handleOffsetChange("resolution", {
                                ...(offsets.resolution || {}),
                                back_radius: parseInt(e.target.value) || 0
                              }, true)}
                              className="w-full bg-theme-hover border border-theme rounded px-1.5 py-1 text-xs text-theme-text font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    <BadgeOffsetControls
                      itemKey="resolution"
                      offset={offsets.resolution}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  </>
                )}
              </div>

              {/* Rating Badge */}
              <div className="space-y-2 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-theme-text">Audience Rating Badge</label>
                    {previewTemplate === "episode_card" && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 rounded">
                        Titlecard
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      previewRating && previewRating !== "Off"
                        ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/30"
                        : "bg-theme-hover text-theme-muted border border-theme"
                    }`}>
                      {previewRating && previewRating !== "Off" ? previewRating : "Off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const isCurrentlyOn = previewRating && previewRating !== "Off";
                        setPreviewRating(isCurrentlyOn ? "Off" : "8.4");
                        setPreviewTimestamp(Date.now());
                      }}
                      title={previewRating && previewRating !== "Off" ? "Disable Rating Badge" : "Enable Rating Badge"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        previewRating && previewRating !== "Off" ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          previewRating && previewRating !== "Off" ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-1.5 pt-1">
                  {["Off", "8.4", "7.5", "6.2", "4.0"].map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => {
                        setPreviewRating(score === "Off" ? "" : score);
                        setPreviewTimestamp(Date.now());
                      }}
                      className={`py-1 rounded-lg text-xs font-semibold border transition-all ${
                        (previewRating === score) || (score === "Off" && (!previewRating || previewRating === "Off"))
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="10.0"
                  step="0.1"
                  value={previewRating && previewRating !== "Off" ? previewRating : 0}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPreviewRating(val === "0" || val === "0.0" ? "" : val);
                    setPreviewTimestamp(Date.now());
                  }}
                  className="w-full accent-theme-primary"
                />
                {previewRating && previewRating !== "Off" && (
                  <BadgeOffsetControls
                    itemKey="rating"
                    offset={offsets.rating}
                    onChange={handleOffsetChange}
                    fonts={availableFonts}
                  />
                )}
              </div>

              {/* Age & Content Ratings Badge */}
              <div className="space-y-2 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text">Age Rating Badge</label>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      previewAgeRating && previewAgeRating !== "Off"
                        ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/30"
                        : "bg-theme-hover text-theme-muted border border-theme"
                    }`}>
                      {previewAgeRating && previewAgeRating !== "Off" ? previewAgeRating : "Off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const isCurrentlyOn = previewAgeRating && previewAgeRating !== "Off";
                        setPreviewAgeRating(isCurrentlyOn ? "Off" : (previewAgeSource === "content_rating_de" ? "FSK 16" : (previewAgeSource === "content_rating_us_movie" ? "PG-13" : "14+")));
                        setPreviewTimestamp(Date.now());
                      }}
                      title={previewAgeRating && previewAgeRating !== "Off" ? "Disable Age Rating" : "Enable Age Rating"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        previewAgeRating && previewAgeRating !== "Off" ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          previewAgeRating && previewAgeRating !== "Off" ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Source Selector */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-theme-muted uppercase">Rating System</label>
                  <select
                    value={previewAgeSource}
                    onChange={(e) => {
                      const newSrc = e.target.value;
                      setPreviewAgeSource(newSrc);
                      if (previewAgeRating && previewAgeRating !== "Off") {
                        if (newSrc === "content_rating_de") setPreviewAgeRating("FSK 16");
                        else if (newSrc === "content_rating_us_movie") setPreviewAgeRating("PG-13");
                        else if (newSrc === "content_rating_uk") setPreviewAgeRating("15");
                        else setPreviewAgeRating("14+");
                      }
                      setPreviewTimestamp(Date.now());
                    }}
                    className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-medium"
                  >
                    <option value="commonsense">Common Sense Media (10+, 14+, 16+, 18+)</option>
                    <option value="content_rating_de">German FSK (FSK 0, 6, 12, 16, 18)</option>
                    <option value="content_rating_us_movie">US MPAA (G, PG, PG-13, R, NC-17)</option>
                    <option value="content_rating_uk">UK BBFC (U, PG, 12A, 15, 18)</option>
                  </select>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(
                    previewAgeSource === "content_rating_de"
                      ? ["Off", "FSK 0", "FSK 6", "FSK 12", "FSK 16", "FSK 18"]
                      : previewAgeSource === "content_rating_us_movie"
                      ? ["Off", "G", "PG", "PG-13", "R", "NC-17"]
                      : previewAgeSource === "content_rating_uk"
                      ? ["Off", "U", "PG", "12A", "15", "18"]
                      : ["Off", "10+", "12+", "14+", "16+", "18+"]
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setPreviewAgeRating(preset === "Off" ? "Off" : preset);
                        setPreviewTimestamp(Date.now());
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                        (previewAgeRating === preset) || (preset === "Off" && (!previewAgeRating || previewAgeRating === "Off"))
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {/* Custom Value Input */}
                <input
                  type="text"
                  value={previewAgeRating && previewAgeRating !== "Off" ? previewAgeRating : ""}
                  onChange={(e) => {
                    setPreviewAgeRating(e.target.value || "Off");
                    setPreviewTimestamp(Date.now());
                  }}
                  placeholder="Custom rating value (e.g. 14+, TV-MA, PG-13)"
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-1.5 text-xs text-theme-text font-medium"
                />

                {/* Offset Controls */}
                {previewAgeRating && previewAgeRating !== "Off" && (
                  <BadgeOffsetControls
                    itemKey="age_rating"
                    offset={offsets.age_rating}
                    onChange={handleOffsetChange}
                    fonts={availableFonts}
                  />
                )}
              </div>

              {/* Audio Codec Badge */}
              <div className="space-y-2 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3.5 h-3.5 text-theme-primary" />
                    <label className="text-xs font-semibold text-theme-text flex items-center gap-1.5">
                      <span>Audio Codec Badge</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      previewAudioCodec && previewAudioCodec !== "Off"
                        ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/30"
                        : "bg-theme-hover text-theme-muted border border-theme"
                    }`}>
                      {previewAudioCodec && previewAudioCodec !== "Off" ? previewAudioCodec.toUpperCase() : "Off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const isCurrentlyOn = previewAudioCodec && previewAudioCodec !== "Off";
                        setPreviewAudioCodec(isCurrentlyOn ? "Off" : "truehd_atmos");
                        setPreviewTimestamp(Date.now());
                      }}
                      title={previewAudioCodec && previewAudioCodec !== "Off" ? "Disable Audio Codec Badge" : "Enable Audio Codec Badge"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        previewAudioCodec && previewAudioCodec !== "Off" ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          previewAudioCodec && previewAudioCodec !== "Off" ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {previewAudioCodec && previewAudioCodec !== "Off" && (
                  <div className="space-y-2 pt-1 border-t border-theme/40">
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={previewAudioCodec}
                        onChange={(e) => {
                          setPreviewAudioCodec(e.target.value);
                          setPreviewTimestamp(Date.now());
                        }}
                        className="bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                      >
                        <option value="truehd_atmos">Dolby Atmos (TrueHD)</option>
                        <option value="dtsx">DTS:X</option>
                        <option value="truehd">Dolby TrueHD</option>
                        <option value="ma">DTS-HD Master Audio</option>
                        <option value="flac">FLAC Lossless</option>
                        <option value="pcm">PCM / LPCM</option>
                        <option value="plus">Dolby Digital Plus (EAC3)</option>
                        <option value="dts">DTS 5.1</option>
                        <option value="digital">Dolby Digital (AC3)</option>
                        <option value="aac">AAC</option>
                        <option value="opus">Opus</option>
                      </select>
                      <select
                        value={previewAudioCodecStyle}
                        onChange={(e) => {
                          setPreviewAudioCodecStyle(e.target.value);
                          setPreviewTimestamp(Date.now());
                        }}
                        className="bg-theme-hover border border-theme rounded-lg px-2 py-1 text-xs text-theme-text font-medium"
                      >
                        <option value="compact">Compact (Pill)</option>
                        <option value="standard">Standard (Box)</option>
                      </select>
                    </div>
                    <BadgeOffsetControls
                      itemKey="audio_codec"
                      offset={offsets.audio_codec}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  </div>
                )}
              </div>

              {/* Video Format Badge */}
              <div className="space-y-2 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clapperboard className="w-3.5 h-3.5 text-theme-primary" />
                    <label className="text-xs font-semibold text-theme-text flex items-center gap-1.5">
                      <span>Video Source Format</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      previewVideoFormat && previewVideoFormat !== "Off"
                        ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/30"
                        : "bg-theme-hover text-theme-muted border border-theme"
                    }`}>
                      {previewVideoFormat && previewVideoFormat !== "Off" ? previewVideoFormat : "Off"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const isCurrentlyOn = previewVideoFormat && previewVideoFormat !== "Off";
                        setPreviewVideoFormat(isCurrentlyOn ? "Off" : "REMUX");
                        setPreviewTimestamp(Date.now());
                      }}
                      title={previewVideoFormat && previewVideoFormat !== "Off" ? "Disable Video Format Badge" : "Enable Video Format Badge"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        previewVideoFormat && previewVideoFormat !== "Off" ? "bg-theme-primary" : "bg-theme-card border border-theme"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          previewVideoFormat && previewVideoFormat !== "Off" ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {previewVideoFormat && previewVideoFormat !== "Off" && (
                  <div className="space-y-2 pt-1 border-t border-theme/40">
                    <div className="grid grid-cols-4 gap-1">
                      {["REMUX", "BLU-RAY", "WEB", "HDTV", "DVD", "TELESYNC", "CAM"].map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => {
                            setPreviewVideoFormat(fmt);
                            setPreviewTimestamp(Date.now());
                          }}
                          className={`py-1 rounded text-[10px] font-mono font-bold border transition-all ${
                            previewVideoFormat === fmt
                              ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                              : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                    <BadgeOffsetControls
                      itemKey="video_format"
                      offset={offsets.video_format}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Media & Show Details */}
            <div className="bg-theme-card border border-theme rounded-2xl p-5 shadow-sm space-y-4">
              <div className="border-b border-theme/60 pb-3">
                <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-theme-primary" />
                  Media & Show Details
                </h3>
                <p className="text-[11px] text-theme-muted mt-0.5">
                  Flags, runtime duration, series status, and network logos.
                </p>
              </div>

              {/* Audio Languages (Flags / Badges) */}
              <div className="space-y-1.5 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text">Audio Language Flags</label>
                  <span className="text-[11px] font-mono text-theme-muted">{previewLanguages || "Off"}</span>
                </div>
                <input
                  type="text"
                  value={previewLanguages}
                  onChange={(e) => { setPreviewLanguages(e.target.value); setPreviewTimestamp(Date.now()); }}
                  placeholder="e.g. de, en, ja (leave empty to disable)"
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                />
                <div className="flex flex-wrap gap-1.5">
                  {["Off", "de, en", "en", "de", "ja, en"].map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        setPreviewLanguages(lang === "Off" ? "" : lang);
                        setPreviewTimestamp(Date.now());
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                        (previewLanguages === lang) || (lang === "Off" && !previewLanguages)
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                {previewLanguages && (
                  <BadgeOffsetControls
                    itemKey="languages"
                    offset={offsets.languages}
                    onChange={handleOffsetChange}
                    fonts={availableFonts}
                  />
                )}
              </div>

              {/* Runtime Duration */}
              <div className="space-y-2 p-3.5 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text">Runtime Duration</label>
                  <span className="text-[11px] font-mono text-theme-muted">{previewRuntime || "Off"}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {["Off", "24 min", "45 min", "1h 45m", "2h 10m"].map((rt) => (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => {
                        setPreviewRuntime(rt === "Off" ? "" : rt);
                        setPreviewTimestamp(Date.now());
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                        (previewRuntime === rt) || (rt === "Off" && !previewRuntime)
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {rt}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={previewRuntime}
                  onChange={(e) => { setPreviewRuntime(e.target.value); setPreviewTimestamp(Date.now()); }}
                  placeholder="Custom runtime (e.g. 124 min)"
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-1.5 text-xs text-theme-text font-medium"
                />
                {previewRuntime && (
                  <>
                    <div className="pt-2 border-t border-theme/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-theme-muted font-medium">Text Size Presets</span>
                        <span className="text-[10px] font-mono text-theme-primary font-bold">
                          {(offsets.runtime?.font_size ?? (isLandscapeFormat(previewTemplate) ? 52 : 40))}px
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {[
                          { label: "36px", size: 36 },
                          { label: "44px", size: 44 },
                          { label: "52px", size: 52 },
                          { label: "60px", size: 60 },
                          { label: "70px", size: 70 }
                        ].map((p) => {
                          const curSize = offsets.runtime?.font_size ?? (isLandscapeFormat(previewTemplate) ? 52 : 40);
                          const isCur = Number(curSize) === p.size;
                          return (
                            <button
                              key={p.size}
                              type="button"
                              onClick={() => handleOffsetChange("runtime", {
                                ...(offsets.runtime || {}),
                                font_size: p.size
                              }, true)}
                              className={`py-1 rounded text-[10px] font-semibold border transition-all text-center ${
                                isCur
                                  ? "bg-theme-primary text-white border-theme-primary"
                                  : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <BadgeOffsetControls
                      itemKey="runtime"
                      offset={offsets.runtime}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  </>
                )}
              </div>

              {/* Series Status Banner (TV Show Poster only) */}
              {previewTemplate === "show_poster" && (
                <div className="space-y-2.5 p-3.5 rounded-xl bg-theme-hover/20 border border-theme">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-theme-text">Show Status Banner</label>
                    <span className="text-[11px] font-mono text-theme-muted">{previewStatus || "Off"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["Off", "AIRING", "RETURNING SERIES", "ENDED", "CANCELED"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          if (st === "Off") {
                            setPreviewStatus("");
                          } else {
                            setPreviewStatus(st);
                            if (st === "AIRING") setPreviewStatusColor("#27C24C");
                            else if (st === "RETURNING SERIES") setPreviewStatusColor("#FFA500");
                            else setPreviewStatusColor("#ED1F1F");
                          }
                          setPreviewTimestamp(Date.now());
                        }}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                          (previewStatus === st) || (st === "Off" && !previewStatus)
                            ? "bg-theme-primary text-white border-theme-primary"
                            : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={previewStatus}
                    onChange={(e) => { setPreviewStatus(e.target.value); setPreviewTimestamp(Date.now()); }}
                    placeholder="Custom banner text (e.g. FINAL SEASON)"
                    className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-1.5 text-xs text-theme-text font-medium"
                  />

                  {/* Status Color Picker */}
                  {previewStatus && (
                    <div className="flex items-center gap-2.5 pt-1">
                      <span className="text-[11px] text-theme-muted">Color:</span>
                      {[
                        { color: "#FFA500", label: "Orange" },
                        { color: "#27C24C", label: "Green" },
                        { color: "#ED1F1F", label: "Red" },
                        { color: "#3B82F6", label: "Blue" },
                        { color: "#A855F7", label: "Purple" }
                      ].map((c) => (
                        <button
                          key={c.color}
                          type="button"
                          onClick={() => { setPreviewStatusColor(c.color); setPreviewTimestamp(Date.now()); }}
                          className={`w-5 h-5 rounded-full border-2 transition-transform ${
                            previewStatusColor === c.color ? "scale-125 border-white shadow-md" : "border-transparent"
                          }`}
                          style={{ backgroundColor: c.color }}
                          title={c.label}
                        />
                      ))}
                      <input
                        type="text"
                        value={previewStatusColor}
                        onChange={(e) => { setPreviewStatusColor(e.target.value); setPreviewTimestamp(Date.now()); }}
                        className="w-20 bg-theme-hover border border-theme rounded-lg px-2 py-0.5 text-[11px] text-theme-text font-mono"
                      />
                    </div>
                  )}

                  {previewStatus && (
                    <BadgeOffsetControls
                      itemKey="status"
                      offset={offsets.status}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  )}
                </div>
              )}

              {/* Network Logo */}
              <div className="space-y-2 p-3.5 rounded-xl bg-theme-hover/20 border border-theme">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text">Network Logo</label>
                  <span className="text-[11px] font-mono text-theme-muted">{previewNetwork || "Off"}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {["Off", "HBO", "Netflix", "Apple TV+", "Disney+", "Amazon"].map((net) => (
                    <button
                      key={net}
                      type="button"
                      onClick={() => {
                        setPreviewNetwork(net === "Off" ? "" : net);
                        setPreviewTimestamp(Date.now());
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                        (previewNetwork === net) || (net === "Off" && !previewNetwork)
                          ? "bg-theme-primary text-white border-theme-primary"
                          : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {net}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={previewNetwork}
                  onChange={(e) => { setPreviewNetwork(e.target.value); setPreviewTimestamp(Date.now()); }}
                  placeholder="Custom network name (e.g. Hulu, Paramount+)"
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-1.5 text-xs text-theme-text font-medium"
                />
                {previewNetwork && previewNetwork !== "Off" && (
                  <BadgeOffsetControls
                    itemKey="network"
                    offset={offsets.network}
                    onChange={handleOffsetChange}
                    fonts={availableFonts}
                  />
                )}
              </div>

              {/* Anime Episode Tag (on titlecards) */}
              {previewTemplate === "episode_card" && (
                <div className="space-y-1.5 p-3 rounded-xl bg-theme-hover/20 border border-theme">
                  <label className="text-xs font-semibold text-theme-text">Anime Episode Tag</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {["Canon", "Filler", "Mixed", "Off"].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => { setPreviewAnimeTag(tag === "Off" ? "" : tag); setPreviewTimestamp(Date.now()); }}
                        className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          previewAnimeTag === tag || (tag === "Off" && !previewAnimeTag)
                            ? "bg-theme-primary text-white border-theme-primary"
                            : "bg-theme-hover border-theme text-theme-muted"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  {previewAnimeTag && (
                    <BadgeOffsetControls
                      itemKey="anime"
                      offset={offsets.anime}
                      onChange={handleOffsetChange}
                      fonts={availableFonts}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PREVIEW & DRAG-AND-DROP CANVAS COLUMN */}
          <div className="lg:col-span-7 xl:col-span-8 lg:sticky lg:top-6 bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col space-y-4">
            {/* CANVAS TOOLBAR */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-theme pb-4">
              {/* Left group: Mode switch, Guidelines, and Custom Image Upload */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Mode switch */}
                <div className="flex rounded-xl bg-theme-hover/60 p-1 border border-theme">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("interactive")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      previewMode === "interactive"
                        ? "bg-theme-primary text-white shadow-sm"
                        : "text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    <Move className="w-3.5 h-3.5" />
                    Drag & Drop
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("rendered")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      previewMode === "rendered"
                        ? "bg-theme-primary text-white shadow-sm"
                        : "text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Final Render
                  </button>
                </div>

                {/* Badge Alignment Lines Button & Magnetic Snap Toggle */}
                <div className="flex items-center rounded-xl bg-theme-hover/60 p-1 border border-theme gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const modes = ["active", "all", "off"];
                      const next = modes[(modes.indexOf(guideMode) + 1) % modes.length];
                      setGuideMode(next);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      guideMode !== "off"
                        ? "bg-amber-500 text-black shadow-sm font-bold"
                        : "text-theme-muted hover:text-theme-text"
                    }`}
                    title="Toggle Photoshop-style badge alignment helper lines"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>
                      {guideMode === "off" ? "Badge Lines: Off" : (guideMode === "active" ? "Badge Lines: Active" : "Badge Lines: All Badges")}
                    </span>
                  </button>
                  {guideMode !== "off" && (
                    <button
                      type="button"
                      onClick={() => setSnapToGuides(!snapToGuides)}
                      className={`p-1.5 rounded-lg text-xs transition-all ${
                        snapToGuides
                          ? "bg-amber-400/20 text-amber-300 border border-amber-400/30"
                          : "text-theme-muted hover:text-theme-text"
                      }`}
                      title={snapToGuides ? "Magnetic snap to badge edges: ON (click to disable)" : "Magnetic snap to badge edges: OFF (click to enable)"}
                    >
                      <Magnet className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Custom Test Image Upload Button */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => previewFileInputRef.current?.click()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      customImages[previewTemplate]
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 shadow-sm"
                        : "bg-theme-hover border-theme text-theme-muted hover:text-theme-text"
                    }`}
                    title="Upload a custom poster, season card, or title card image to test overlays"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{customImages[previewTemplate] ? "Change Image" : "Upload Test Image"}</span>
                  </button>
                  <input
                    ref={previewFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      if (e.target.files?.[0]) processUploadedFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  {customImages[previewTemplate] && (
                    <button
                      type="button"
                      onClick={handleRemoveCustomImage}
                      className="p-1.5 rounded-xl bg-theme-hover border border-theme text-theme-muted hover:text-red-400 transition-all"
                      title="Remove custom image and return to default sample artwork"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Right group: Save layout controls */}
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const availablePreviewLibs = Array.from(new Set([
                    ...Object.keys(visualConfig?.libraries || {}),
                    ...Object.keys(libraries || {})
                  ])).filter(Boolean);

                  return availablePreviewLibs.length > 0 ? (
                    <select
                      value={selectedSaveLibrary || availablePreviewLibs[0] || ""}
                      onChange={(e) => handleSelectPreviewLibrary(e.target.value)}
                      className="bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-medium max-w-[150px] truncate"
                      title="Library to apply layout coordinates"
                    >
                      {availablePreviewLibs.map(lib => (
                        <option key={lib} value={lib}>{lib}</option>
                      ))}
                      <option value="__NEW__">+ New Library...</option>
                    </select>
                  ) : null;
                })()}

                {(Object.keys(libraries).length === 0 || selectedSaveLibrary === "__NEW__") && (
                  <input
                    type="text"
                    value={newLibraryName}
                    onChange={(e) => setNewLibraryName(e.target.value)}
                    placeholder="Library name (e.g. Movies)"
                    className="w-36 bg-theme-bg border border-theme rounded-lg px-2.5 py-1.5 text-xs text-theme-text font-medium"
                  />
                )}

                <button
                  onClick={handleSaveLayout}
                  disabled={isSavingLayout}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm disabled:opacity-50 transition-all"
                  title="Save current badge coordinates"
                >
                  {isSavingLayout ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save Layout
                </button>

                <button
                  onClick={() => {
                    fetchRunStatus();
                    setIsApplyModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium shadow-sm transition-all"
                  title="Apply overlays and push to media server"
                >
                  <Play className="w-3.5 h-3.5 text-theme-primary fill-current" />
                  Apply to Server
                </button>

                <button
                  onClick={handleResetLayout}
                  className="p-1.5 rounded-xl bg-theme-hover border border-theme text-theme-muted hover:text-theme-text transition-all"
                  title="Reset positions to default"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* CANVAS STAGE */}
            <div className="flex flex-col items-center justify-center py-2">
              {previewMode === "interactive" ? (
                /* INTERACTIVE DRAG & DROP STAGE */
                <div className="flex flex-col items-center w-full">
                  <div
                    ref={canvasRef}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onDragOver={handleCanvasDragOver}
                    onDragLeave={handleCanvasDragLeave}
                    onDrop={handleCanvasDrop}
                    className={`relative select-none border border-theme rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-b from-[#181c24] to-[#0f1117] ${
                      isLandscapeFormat(previewTemplate) ? "w-full max-w-[680px] aspect-[16/9]" : "w-[360px] aspect-[2/3]"
                    }`}
                  >
                    {/* Realistic Sample Artwork Backdrop or Custom Uploaded Image */}
                    {(() => {
                      const curCustom = customImages[previewTemplate];
                      const imgSrc = curCustom?.dataUrl || `/api/dynamic-overlays/sample-image?template_type=${previewTemplate}${curCustom?.previewImageId ? `&custom_image_id=${encodeURIComponent(curCustom.previewImageId)}` : ""}&t=${previewTimestamp}`;
                      return (
                        <img
                          src={imgSrc}
                          alt="Sample backdrop"
                          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none opacity-90"
                        />
                      );
                    })()}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none select-none" />

                    {/* Active Custom Image Indicator Badge */}
                    {customImages[previewTemplate] && (
                      <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/80 backdrop-blur-md border border-white/20 text-[11px] text-white shadow-lg pointer-events-auto">
                        <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-semibold max-w-[130px] truncate">{customImages[previewTemplate].filename}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveCustomImage(); }}
                          className="ml-1 p-0.5 hover:bg-white/20 rounded text-white/70 hover:text-white transition-colors"
                          title="Revert to default sample artwork"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Drag-and-drop file dropzone overlay */}
                    {isDraggingFile && (
                      <div className="absolute inset-0 z-40 bg-theme-primary/85 backdrop-blur-sm border-2 border-dashed border-white rounded-2xl flex flex-col items-center justify-center text-white gap-2 pointer-events-none animate-in fade-in">
                        <Upload className="w-10 h-10 animate-bounce" />
                        <span className="font-bold text-base">Drop custom artwork here</span>
                        <span className="text-xs text-white/80">Replaces preview background for this format</span>
                      </div>
                    )}

                    {/* Background watermark */}
                    <div className="absolute inset-0 flex items-center justify-center text-white/20 text-xs font-mono uppercase tracking-widest pointer-events-none">
                      {isLandscapeFormat(previewTemplate)
                        ? (previewTemplate === "backdrop" ? "1920 × 1080 Background Stage" : "1920 × 1080 Titlecard Stage")
                        : (previewTemplate === "season_poster" ? "1000 × 1500 Season Stage" : (previewTemplate === "show_poster" ? "1000 × 1500 Show Poster Stage" : "1000 × 1500 Movie Poster Stage"))}
                    </div>

                    {/* Guidelines Overlay (Rule of Thirds, Center Crosshair, Snap Guides) */}
                    {renderGuidelinesOverlay(isLandscapeFormat(previewTemplate))}

                    {/* Draggable: 4K / Resolution Badge or Banner */}
                    {previewResolution && previewResolution !== "None" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      const isTopBanner = !isLandscape && (previewResolution === "4K" || previewResolution === "4K UHD") && (resolutionMode === "banner" || offsets.resolution?.mode === "banner" || (offsets.resolution?.y === 0 && offsets.resolution?.valign === "top"));

                      if (isTopBanner) {
                        return (
                          <div
                            onPointerDown={(e) => { setSelectedBadge("resolution"); handlePointerDown("resolution", e); }}
                            onPointerEnter={() => setHoveredBadge("resolution")}
                            onPointerLeave={() => setHoveredBadge(null)}
                            onClick={() => setSelectedBadge("resolution")}
                            className={`cursor-move absolute top-0 left-0 right-0 h-10 sm:h-11 bg-black border-b border-white/20 text-white font-bold shadow-2xl flex items-center justify-center gap-2 select-none z-20 ${
                              draggingItem === "resolution" ? "ring-2 ring-emerald-400 scale-102" : ""
                            }`}
                            style={{ position: "absolute", top: 0, left: 0, right: 0 }}
                            title="Top 4K Ultra HD Banner (Drag to reposition)"
                          >
                            <div className="px-3.5 py-0.5 rounded-full border border-zinc-400/90 bg-gradient-to-b from-zinc-800 to-black text-[11px] font-black tracking-wider text-zinc-100 shadow flex items-center gap-1.5">
                              <span className="text-white font-extrabold">4K</span>
                              <span className="w-px h-2.5 bg-zinc-500" />
                              <span className="tracking-widest text-[9px] text-zinc-300">ULTRA HD</span>
                            </div>
                            <Move className="w-3 h-3 text-emerald-400 opacity-60" />
                          </div>
                        );
                      }

                      const resBColor = offsets.resolution?.back_color ?? "#00000099";
                      const resBRadius = offsets.resolution?.back_radius ?? 15;
                      const hasResBg = resBColor && !["transparent", "none", "#00000000"].includes(resBColor.toLowerCase());

                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("resolution"); handlePointerDown("resolution", e); }}
                          onPointerEnter={() => setHoveredBadge("resolution")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("resolution")}
                          className={`cursor-move text-white font-bold shadow-xl flex items-center gap-1.5 backdrop-blur-sm ${
                            isLandscape ? "px-3.5 py-2 text-xs sm:text-sm" : "px-3 py-1.5 text-xs"
                          } ${draggingItem === "resolution" ? "ring-2 ring-emerald-400 scale-105 z-30" : "z-10"}`}
                          style={{
                            ...getItemStyle("resolution", offsets.resolution),
                            backgroundColor: hasResBg ? resBColor : "transparent",
                            borderRadius: `${resBRadius}px`,
                            border: hasResBg ? "1px solid rgba(255,255,255,0.2)" : "1px dashed rgba(255,255,255,0.4)"
                          }}
                        >
                          <Move className="w-3.5 h-3.5 text-emerald-400 opacity-70" />
                          <span>{previewResolution}</span>
                          <span className="text-[10px] text-emerald-300/80 font-mono hidden sm:inline">
                            ({offsets.resolution?.align || "left"} {offsets.resolution?.x ?? 0}px, {offsets.resolution?.valign || "top"} {offsets.resolution?.y ?? 0}px)
                          </span>
                        </div>
                      );
                    })()}

                    {/* Draggable: Audience Rating Badge (Sleek Green Pill matching Rating_High) */}
                    {previewRating && previewRating !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("rating"); handlePointerDown("rating", e); }}
                          onPointerEnter={() => setHoveredBadge("rating")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("rating")}
                          className={`cursor-move rounded-2xl bg-[#27C24C] hover:bg-[#23ad44] border border-white/30 text-white font-black shadow-xl flex items-center justify-center gap-1.5 select-none ${
                            isLandscape ? "px-3.5 py-1.5 text-xs sm:text-sm" : "px-3 py-1 text-xs"
                          } ${draggingItem === "rating" ? "ring-2 ring-white scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("rating", offsets.rating)}
                        >
                          <span className="text-sm font-black tracking-tight">{previewRating}</span>
                          <Move className="w-3 h-3 text-white/70" />
                        </div>
                      );
                    })()}

                    {/* Draggable: Status Banner */}
                    {previewStatus && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("status"); handlePointerDown("status", e); }}
                          onPointerEnter={() => setHoveredBadge("status")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("status")}
                          className={`cursor-move rounded-xl bg-black/85 border border-white/30 font-bold uppercase tracking-wider shadow-2xl flex items-center justify-center gap-2 backdrop-blur-md ${
                            isLandscape ? "w-[78%] px-5 py-2.5 text-xs sm:text-sm" : "w-[88%] px-4 py-2 text-xs"
                          } ${draggingItem === "status" ? "ring-2 ring-white scale-102 z-30" : "z-10"}`}
                          style={{
                            ...getItemStyle("status", offsets.status),
                            color: previewStatusColor
                          }}
                        >
                          <Move className="w-3.5 h-3.5 opacity-60" />
                          <span className="truncate">{previewStatus}</span>
                          <span className="text-[10px] opacity-75 font-mono hidden sm:inline">
                            ({offsets.status?.align || "center"} {offsets.status?.x ?? 0}px, {offsets.status?.valign || "bottom"} {offsets.status?.y ?? 30}px)
                          </span>
                        </div>
                      );
                    })()}

                    {/* Draggable: Runtime Badge (Kometa Container Box with transparent outline) */}
                    {previewRuntime && previewRuntime !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      const effectiveFontSize = offsets.runtime?.font_size ?? (isLandscape ? 52 : 40);
                      const scaledFontSizePx = Math.max(10, Math.round(effectiveFontSize * (isLandscape ? 0.32 : 0.36)));
                      const dims = (isLandscape ? BADGE_DIMS.landscape : BADGE_DIMS.portrait).runtime;
                      const canvasW = isLandscape ? 1920 : 1000;
                      const canvasH = isLandscape ? 1080 : 1500;

                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("runtime"); handlePointerDown("runtime", e); }}
                          onPointerEnter={() => setHoveredBadge("runtime")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("runtime")}
                          className={`cursor-move select-none rounded-xl border-2 border-dashed transition-all flex items-center justify-center gap-1.5 ${
                            draggingItem === "runtime"
                              ? "border-blue-400 bg-blue-500/25 ring-2 ring-blue-400/80 scale-105 z-30 shadow-lg"
                              : hoveredBadge === "runtime" || selectedBadge === "runtime"
                              ? "border-blue-400/90 bg-blue-500/20 z-20 shadow-sm"
                              : "border-blue-400/40 bg-blue-500/10 hover:border-blue-400/70 hover:bg-blue-500/20 z-10"
                          }`}
                          style={{
                            ...getItemStyle("runtime", offsets.runtime),
                            width: `${(dims.w / canvasW) * 100}%`,
                            height: `${(dims.h / canvasH) * 100}%`,
                            fontSize: `${scaledFontSizePx}px`
                          }}
                          title={`Runtime Container Box: ${dims.w}x${dims.h}px (${offsets.runtime?.align || "center"} ${offsets.runtime?.x ?? 140}px, ${offsets.runtime?.valign || "bottom"} ${offsets.runtime?.y ?? 37}px)`}
                        >
                          <span className="text-white font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] tracking-wide">{previewRuntime}</span>
                          <Move className="w-3 h-3 text-blue-200/70" />
                        </div>
                      );
                    })()}

                    {/* Draggable: Audio Languages Badge (Stacked Flags like Alien image) */}
                    {previewLanguages && previewLanguages !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("languages"); handlePointerDown("languages", e); }}
                          onPointerEnter={() => setHoveredBadge("languages")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("languages")}
                          className={`cursor-move flex flex-col gap-1 shadow-xl select-none ${
                            draggingItem === "languages" ? "ring-2 ring-purple-400 scale-105 z-30" : "z-10"
                          }`}
                          style={getItemStyle("languages", offsets.languages)}
                          title={`Audio Language Flags: ${previewLanguages}`}
                        >
                          {/* German Flag */}
                          <div className="w-8 h-4.5 rounded-[2px] overflow-hidden border border-black/80 flex flex-col shadow">
                            <div className="h-1.5 bg-black" />
                            <div className="h-1.5 bg-red-600" />
                            <div className="h-1.5 bg-amber-400" />
                          </div>
                          {/* US Flag */}
                          <div className="w-8 h-4.5 rounded-[2px] overflow-hidden border border-black/80 bg-red-600 flex flex-col justify-between shadow relative">
                            <div className="absolute top-0 left-0 w-3.5 h-2.5 bg-blue-800" />
                            <div className="h-0.5 bg-white ml-3.5" />
                            <div className="h-0.5 bg-white ml-3.5" />
                            <div className="h-0.5 bg-white" />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Draggable: Network Logo Badge */}
                    {previewNetwork && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("network"); handlePointerDown("network", e); }}
                          onPointerEnter={() => setHoveredBadge("network")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("network")}
                          className={`cursor-move rounded-xl bg-black/85 border border-red-500/80 text-white font-bold uppercase tracking-wider shadow-xl flex items-center gap-1.5 backdrop-blur-sm ${
                            isLandscape ? "px-4 py-2 text-xs sm:text-sm" : "px-3.5 py-1.5 text-xs"
                          } ${draggingItem === "network" ? "ring-2 ring-red-400 scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("network", offsets.network)}
                        >
                          <Move className="w-3.5 h-3.5 text-red-400 opacity-70" />
                          <span>{previewNetwork}</span>
                          <span className="text-[10px] text-red-300/80 font-mono hidden sm:inline">
                            ({offsets.network?.align || "right"} {offsets.network?.x ?? 25}px, {offsets.network?.valign || "top"} {offsets.network?.y ?? 25}px)
                          </span>
                        </div>
                      );
                    })()}

                    {/* Draggable: Anime Episode Tag */}
                    {previewAnimeTag && isLandscapeFormat(previewTemplate) && (() => {
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("anime"); handlePointerDown("anime", e); }}
                          onPointerEnter={() => setHoveredBadge("anime")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("anime")}
                          className={`cursor-move px-4 py-2 rounded-xl text-xs sm:text-sm font-bold uppercase shadow-xl flex items-center gap-2 ${
                            previewAnimeTag.toLowerCase() === "canon" ? "bg-emerald-600 text-white" : (previewAnimeTag.toLowerCase() === "filler" ? "bg-red-600 text-white" : "bg-amber-600 text-white")
                          } ${draggingItem === "anime" ? "ring-2 ring-white scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("anime", offsets.anime)}
                        >
                          <Move className="w-3.5 h-3.5 opacity-70" />
                          <span>{previewAnimeTag}</span>
                          <span className="text-[10px] opacity-80 font-mono hidden sm:inline">
                            ({offsets.anime?.align || "left"} {offsets.anime?.x ?? 20}px, {offsets.anime?.valign || "top"} {offsets.anime?.y ?? 20}px)
                          </span>
                        </div>
                      );
                    })()}

                    {/* Draggable: Age & Content Ratings Badge (Common Sense Checkmark or Authority Pill) */}
                    {previewAgeRating && previewAgeRating !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      const sourceLabel = previewAgeSource === "content_rating_de" ? "FSK" : (previewAgeSource === "content_rating_us_movie" ? "MPAA" : (previewAgeSource === "content_rating_uk" ? "BBFC" : "CS"));

                      if (previewAgeSource === "commonsense") {
                        return (
                          <div
                            onPointerDown={(e) => { setSelectedBadge("age_rating"); handlePointerDown("age_rating", e); }}
                            onPointerEnter={() => setHoveredBadge("age_rating")}
                            onPointerLeave={() => setHoveredBadge(null)}
                            onClick={() => setSelectedBadge("age_rating")}
                            className={`cursor-move flex items-center gap-1.5 text-white font-extrabold select-none ${
                              draggingItem === "age_rating" ? "ring-2 ring-emerald-400 scale-105 z-30" : "z-10"
                            }`}
                            style={getItemStyle("age_rating", offsets.age_rating)}
                            title="Common Sense Media Age Rating"
                          >
                            <div className="w-6 h-6 rounded-full border-2 border-emerald-400 flex items-center justify-center bg-black/70 shadow">
                              <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                            </div>
                            <span className="text-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] font-bold text-white">{previewAgeRating}</span>
                            <Move className="w-3 h-3 text-white/50" />
                          </div>
                        );
                      }

                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("age_rating"); handlePointerDown("age_rating", e); }}
                          onPointerEnter={() => setHoveredBadge("age_rating")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("age_rating")}
                          className={`cursor-move rounded-xl bg-black/85 border border-amber-500/80 text-white font-bold shadow-xl flex items-center gap-1.5 backdrop-blur-sm select-none ${
                            isLandscape ? "px-3.5 py-2 text-xs sm:text-sm" : "px-3 py-1.5 text-xs"
                          } ${draggingItem === "age_rating" ? "ring-2 ring-amber-400 scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("age_rating", offsets.age_rating)}
                        >
                          <Move className="w-3.5 h-3.5 text-amber-400 opacity-70" />
                          <span className="text-amber-400 font-black text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/20">
                            {sourceLabel}
                          </span>
                          <span>{previewAgeRating}</span>
                          <span className="text-[10px] text-amber-300/80 font-mono hidden sm:inline">
                            ({offsets.age_rating?.align || "left"} {offsets.age_rating?.x ?? 255}px, {offsets.age_rating?.valign || "bottom"} {offsets.age_rating?.y ?? 37}px)
                          </span>
                        </div>
                      );
                    })()}

                    {/* Draggable Audio Codec Badge */}
                    {previewAudioCodec && previewAudioCodec !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("audio_codec"); handlePointerDown("audio_codec", e); }}
                          onPointerEnter={() => setHoveredBadge("audio_codec")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("audio_codec")}
                          className={`cursor-move rounded-xl bg-black/85 border border-indigo-500/80 text-white font-bold shadow-xl flex items-center gap-1.5 backdrop-blur-sm select-none ${
                            isLandscape ? "px-3.5 py-1.5 text-xs sm:text-sm" : "px-3 py-1 text-xs"
                          } ${draggingItem === "audio_codec" ? "ring-2 ring-indigo-400 scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("audio_codec", offsets.audio_codec)}
                          title={`Audio Codec: ${previewAudioCodec}`}
                        >
                          <Volume2 className="w-3.5 h-3.5 text-indigo-400 opacity-80" />
                          <span className="font-mono text-xs font-black tracking-tight text-indigo-300">
                            {previewAudioCodec.toUpperCase()}
                          </span>
                          <Move className="w-3 h-3 text-white/50" />
                        </div>
                      );
                    })()}

                    {/* Draggable Video Format Badge */}
                    {previewVideoFormat && previewVideoFormat !== "Off" && (() => {
                      const isLandscape = isLandscapeFormat(previewTemplate);
                      return (
                        <div
                          onPointerDown={(e) => { setSelectedBadge("video_format"); handlePointerDown("video_format", e); }}
                          onPointerEnter={() => setHoveredBadge("video_format")}
                          onPointerLeave={() => setHoveredBadge(null)}
                          onClick={() => setSelectedBadge("video_format")}
                          className={`cursor-move rounded-xl bg-black/85 border border-cyan-500/80 text-white font-bold shadow-xl flex items-center gap-1.5 backdrop-blur-sm select-none ${
                            isLandscape ? "px-3.5 py-1.5 text-xs sm:text-sm" : "px-3 py-1 text-xs"
                          } ${draggingItem === "video_format" ? "ring-2 ring-cyan-400 scale-105 z-30" : "z-10"}`}
                          style={getItemStyle("video_format", offsets.video_format)}
                          title={`Video Format: ${previewVideoFormat}`}
                        >
                          <Clapperboard className="w-3.5 h-3.5 text-cyan-400 opacity-80" />
                          <span className="font-mono text-xs font-black tracking-tight text-cyan-300">
                            {previewVideoFormat}
                          </span>
                          <Move className="w-3 h-3 text-white/50" />
                        </div>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-theme-muted mt-3 text-center flex items-center justify-center gap-1.5">
                    <Move className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                    <span><strong>Drag any badge</strong> on the artwork to reposition it. Click <strong>Save Layout</strong> when done.</span>
                  </p>
                </div>
              ) : (
                /* RENDERED OUTPUT STAGE (PILLOW) */
                <div className="flex flex-col items-center w-full">
                  <div
                    onDragOver={handleCanvasDragOver}
                    onDragLeave={handleCanvasDragLeave}
                    onDrop={handleCanvasDrop}
                    className="relative border border-theme rounded-2xl overflow-hidden shadow-2xl bg-black/40 flex items-center justify-center p-1"
                  >
                    <div className="relative inline-block leading-none rounded-xl overflow-hidden">
                      <img
                        src={previewUrl}
                        alt="Dynamic Overlay Preview"
                        onLoad={() => setPreviewLoading(false)}
                        className={`max-h-[540px] w-auto block object-contain transition-opacity duration-300 ${
                          previewLoading ? "opacity-30" : "opacity-100"
                        }`}
                      />
                      {/* Alignment Guidelines in Rendered Mode */}
                      {renderGuidelinesOverlay(isLandscapeFormat(previewTemplate))}
                    </div>

                    {/* Active Custom Image Indicator Badge in Rendered Mode */}
                    {customImages[previewTemplate] && (
                      <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/80 backdrop-blur-md border border-white/20 text-[11px] text-white shadow-lg pointer-events-auto">
                        <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-semibold max-w-[130px] truncate">{customImages[previewTemplate].filename}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveCustomImage(); }}
                          className="ml-1 p-0.5 hover:bg-white/20 rounded text-white/70 hover:text-white transition-colors"
                          title="Revert to default sample artwork"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Drag-and-drop file dropzone overlay in Rendered mode */}
                    {isDraggingFile && (
                      <div className="absolute inset-0 z-40 bg-theme-primary/85 backdrop-blur-sm border-2 border-dashed border-white rounded-2xl flex flex-col items-center justify-center text-white gap-2 pointer-events-none animate-in fade-in">
                        <Upload className="w-10 h-10 animate-bounce" />
                        <span className="font-bold text-base">Drop custom artwork here</span>
                        <span className="text-xs text-white/80">Replaces preview background for this format</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-theme-muted mt-3 text-center">
                    ⚡ <strong>Live Rendered Artwork:</strong> Badges are added in memory. Your original local artwork is never modified.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CACHE & SYNC */}
      {/* ========================================================================= */}
      {(activeTab === "sync" || activeTab === "cache") && (
        <div className="space-y-6">
          {/* AUTOMATED RUN ON NEW MEDIA CARD */}
          <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20 shrink-0 mt-0.5">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-theme-text flex items-center gap-2">
                  Automatically Apply Overlays to New Media
                  {autoOverlaySync ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-theme-primary/10 text-theme-primary border border-theme-primary/30">
                      Enabled
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-theme-bg text-theme-muted border border-theme">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-theme-muted mt-1 leading-relaxed">
                  Whenever Posterizarr finishes generating new artwork (scheduled runs, manual runs, or webhooks), automatically add overlays and send them to your media server in the background.
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleAutoSync}
              disabled={isSavingAutoSync}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none self-start sm:self-center ${
                autoOverlaySync ? "bg-theme-primary" : "bg-theme-card border border-theme"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  autoOverlaySync ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* SYNC OVERLAYS TO MEDIA SERVER CARD */}
          <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-theme/60">
              <div>
                <h3 className="font-bold text-theme-text text-base flex items-center gap-2">
                  <Play className="w-5 h-5 text-theme-primary fill-current" />
                  Sync Overlays Now
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  Choose what to update and send overlaid artwork directly to your media server. Original assets stay clean and untouched.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDetectChanges()}
                  disabled={isDetectingChanges || isOverlaySyncRunning}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium transition-all shadow-sm disabled:opacity-50"
                  title="Quick bulk check for audio language updates, edition cuts, runtime changes, and show status"
                >
                  {isDetectingChanges ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-theme-primary" />
                  )}
                  {isDetectingChanges ? "Scanning Media..." : "Fast Scan for Updates"}
                </button>
                <button
                  onClick={() => setIsApplyModalOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium transition-all shadow-sm"
                >
                  <Sliders className="w-3.5 h-3.5 text-theme-primary" />
                  Sync Wizard
                </button>
                <button
                  onClick={() => handleTriggerOverlaySync()}
                  disabled={isOverlaySyncRunning}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {isOverlaySyncRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  {isOverlaySyncRunning ? "Sync in Progress..." : `Run Sync (${syncScope === "all" ? "Full" : "Changes Only"})`}
                </button>
              </div>
            </div>

            {/* Scope, Server, and Library Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Scope Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-theme-primary" />
                  What to Sync:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSyncScope("incremental")}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                      syncScope === "incremental"
                        ? "bg-theme-primary/15 border-theme-primary text-theme-text ring-1 ring-theme-primary"
                        : "bg-theme-hover/40 border-theme text-theme-muted hover:bg-theme-hover/70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Changes Only</span>
                      {syncScope === "incremental" && <Check className="w-3.5 h-3.5 text-theme-primary" />}
                    </div>
                    <div className="text-[10px] text-theme-muted font-normal mt-0.5">New or updated only</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncScope("all")}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                      syncScope === "all"
                        ? "bg-amber-500/15 border-amber-500 text-theme-text ring-1 ring-amber-500"
                        : "bg-theme-hover/40 border-theme text-theme-muted hover:bg-theme-hover/70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>All Items</span>
                      {syncScope === "all" && <Check className="w-3.5 h-3.5 text-amber-500" />}
                    </div>
                    <div className="text-[10px] text-theme-muted font-normal mt-0.5">Re-apply everything</div>
                  </button>
                </div>
              </div>

              {/* Target Server Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-purple-400" />
                  Media Server:
                </label>
                <select
                  value={syncServer}
                  onChange={(e) => setSyncServer(e.target.value)}
                  className="w-full bg-theme-hover/60 border border-theme rounded-xl px-3 py-2.5 text-xs text-theme-text font-medium"
                >
                  <option value="all">All Configured Servers (Plex, Jellyfin, Emby)</option>
                  <option value="plex">Plex Media Server</option>
                  <option value="jellyfin">Jellyfin</option>
                  <option value="emby">Emby</option>
                </select>
              </div>

              {/* Target Library Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-emerald-400" />
                  Library:
                </label>
                <select
                  value={syncLibrary}
                  onChange={(e) => setSyncLibrary(e.target.value)}
                  className="w-full bg-theme-hover/60 border border-theme rounded-xl px-3 py-2.5 text-xs text-theme-text font-medium"
                >
                  <option value="all">All Included Libraries</option>
                  {Object.keys(scanData?.libraries || {}).map((libName) => (
                    <option key={libName} value={libName}>{libName}</option>
                  ))}
                  {/* Fallback default library options */}
                  {!scanData?.libraries?.PosterizarrTestMovies && (
                    <option value="PosterizarrTestMovies">PosterizarrTestMovies</option>
                  )}
                  {!scanData?.libraries?.PosterizarrTestShows && (
                    <option value="PosterizarrTestShows">PosterizarrTestShows</option>
                  )}
                </select>
              </div>
            </div>

            {/* Sync Engine & Performance Settings (Workers & Debug Pixel Log) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-xl bg-theme-hover/20 border border-theme/60">
              {/* Parallel Concurrency Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-theme-primary" />
                    <span className="text-xs font-bold text-theme-text">Parallel Processing</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-theme-primary/10 border border-theme-primary/20 text-theme-primary font-bold font-mono text-[11px]">
                    {featureSettings?.concurrency || 4} workers
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-theme-muted font-mono">1</span>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="1"
                    value={featureSettings?.concurrency || 4}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 4;
                      setFeatureSettings(prev => ({ ...prev, concurrency: val }));
                    }}
                    onMouseUp={() => handleUpdateDynamicSettings({ concurrency: featureSettings?.concurrency || 4 })}
                    onTouchEnd={() => handleUpdateDynamicSettings({ concurrency: featureSettings?.concurrency || 4 })}
                    className="flex-1 h-1.5 bg-theme-hover rounded-lg appearance-none cursor-pointer accent-theme-primary"
                  />
                  <span className="text-[10px] text-theme-muted font-mono">8</span>
                </div>
                <div className="text-[10px] text-theme-muted">
                  Simultaneous artwork items composited in RAM & uploaded to media server.
                </div>
              </div>

              {/* Debug Coordinates Logging Toggle */}
              <div className="flex items-center justify-between gap-3 sm:border-l sm:border-theme/60 sm:pl-4">
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Terminal className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-theme-text">Debug Pixel Coordinates</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
                      featureSettings?.debug_logging
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-theme-hover text-theme-muted border-theme"
                    }`}>
                      {featureSettings?.debug_logging ? "Active" : "Off"}
                    </span>
                  </div>
                  <span className="text-[10px] text-theme-muted block leading-tight">
                    Logs per-poster pixel dimensions, scale factors (e.g. 2000x3000 = 2.0x), and layer box bounds to DynamicOverlaysSync.log.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateDynamicSettings({ debug_logging: !featureSettings?.debug_logging })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    featureSettings?.debug_logging ? "bg-amber-500" : "bg-theme-card border border-theme"
                  }`}
                  title="Toggle Debug Pixel Coordinates Logging"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      featureSettings?.debug_logging ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Quick Action Buttons Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-theme">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleTriggerOverlaySync("incremental")}
                  disabled={isOverlaySyncRunning}
                  className="px-3.5 py-1.5 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  Sync Changes Only
                </button>
                <button
                  onClick={() => handleSyncChangedOnly()}
                  disabled={isOverlaySyncRunning || isSyncingChanged}
                  className="px-3.5 py-1.5 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium transition-all shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                  title="Bulk resync only items with detected language, cut, runtime, or status changes"
                >
                  {isSyncingChanged ? <Loader2 className="w-3 h-3 animate-spin text-theme-primary" /> : <Zap className="w-3 h-3 text-theme-primary" />}
                  Sync Changed Items
                </button>
                <button
                  onClick={() => handleTriggerOverlaySync("all")}
                  disabled={isOverlaySyncRunning}
                  className="px-3.5 py-1.5 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text text-xs font-medium transition-all shadow-sm disabled:opacity-50"
                >
                  Force Sync All Items
                </button>
              </div>

              <div className="flex items-center gap-3">
                {isOverlaySyncRunning ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Syncing overlays...
                    </div>
                    <button
                      type="button"
                      onClick={handleStopOverlaySync}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                      title="Stop running dynamic overlays sync"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      Stop Sync
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetOverlaySyncLock}
                    title="Force reset sync lock if state got stuck"
                    className="text-[11px] text-theme-muted hover:text-theme-text transition-colors flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-theme-hover"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset Lock
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsClearCacheModalOpen(true)}
                  disabled={isClearingOverlayCache}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50"
                  title="Clear overlay push cache to force full re-composite on next sync"
                >
                  {isClearingOverlayCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Reset Cache</span>
                </button>
              </div>
            </div>

            {/* Live Sync Progress / Results Summary */}
            {overlaySyncStatus && (
              <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold text-theme-text">Last Sync Result:</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                    +{overlaySyncStatus.total_synced || 0} Synced
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30 font-bold">
                    ={overlaySyncStatus.total_skipped || 0} Up to Date
                  </span>
                  {Boolean(overlaySyncStatus.total_failed) && (
                    <span className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 font-bold">
                      !{overlaySyncStatus.total_failed} Failed
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Live Terminal Log Viewer */}
            {overlaySyncLogs.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-theme-muted uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-theme-text font-bold">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                      Sync Log (Live)
                    </span>
                    <span className="font-mono text-[10px] text-theme-muted font-normal lowercase">
                      ({overlaySyncLogs.length} lines)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDownloadSyncLog}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-theme-hover border border-theme text-theme-text hover:border-theme-primary/40 text-[11px] font-semibold transition-all shadow-sm"
                      title="Download sync log (.log)"
                    >
                      <Download className="w-3 h-3 text-emerald-400" />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSyncLogExpanded(!isSyncLogExpanded)}
                      className="p-1 rounded-lg bg-theme-hover border border-theme hover:bg-theme-hover/80 text-theme-muted hover:text-theme-text transition-all shadow-sm"
                      title={isSyncLogExpanded ? "Collapse log window" : "Make log window bigger"}
                    >
                      {isSyncLogExpanded ? (
                        <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={fetchOverlaySyncStatus}
                      className="p-1 rounded-lg bg-theme-hover border border-theme hover:bg-theme-hover/80 text-theme-muted hover:text-theme-text transition-all shadow-sm"
                      title="Refresh logs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <div
                    ref={syncLogsRef}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 35;
                      setIsAutoScrollLogs(isAtBottom);
                    }}
                    className={`bg-slate-950 border border-theme rounded-xl p-3.5 font-mono text-[11px] text-emerald-400/90 overflow-y-auto space-y-1 shadow-inner transition-all duration-300 ${
                      isSyncLogExpanded ? "max-h-[650px] min-h-[380px]" : "max-h-56 min-h-[160px]"
                    }`}
                  >
                    {overlaySyncLogs.map((logLine, idx) => (
                      <div key={idx} className="whitespace-pre-wrap leading-relaxed selection:bg-emerald-500/30">
                        {logLine}
                      </div>
                    ))}
                  </div>

                  {/* Smart Floating "Jump to Latest" Button when User Scrolls Up */}
                  {!isAutoScrollLogs && (
                    <div className="absolute bottom-3 right-4 z-20 pointer-events-none">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAutoScrollLogs(true);
                          if (syncLogsRef.current) {
                            syncLogsRef.current.scrollTop = syncLogsRef.current.scrollHeight;
                          }
                        }}
                        className="pointer-events-auto px-3 py-1.5 rounded-full bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xl border border-white/20 transition-all"
                        title="Resume automatic scrolling"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Jump to Latest</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MEDIA CHANGE DETECTION CARD */}
          <div className="bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-theme/60">
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-theme-hover border border-theme text-theme-text shrink-0 mt-0.5">
                  <RefreshCw className="w-5 h-5 text-theme-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-theme-text text-base">
                    Media Change Detection
                  </h3>
                  <p className="text-xs text-theme-muted mt-1 leading-relaxed max-w-2xl">
                    Checks media servers for modified audio tracks, editions, or runtimes and keeps overlays up to date.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleDetectChanges()}
                  disabled={isDetectingChanges || isOverlaySyncRunning}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {isDetectingChanges ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  {isDetectingChanges ? "Checking..." : "Check for Changes"}
                </button>
                {(changeDetectionReport || featureSettings?.last_change_detection_summary) && (
                  <button
                    type="button"
                    onClick={() => {
                      setChangeFilterType("all");
                      setIsChangeModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-theme-hover border border-theme text-theme-text text-xs font-semibold hover:border-theme-primary/40 transition-all shadow-sm"
                    title="View detected updates"
                  >
                    <Eye className="w-3.5 h-3.5 text-theme-muted" />
                    View Changes ({changeDetectionReport?.changed_count ?? (
                      (featureSettings?.last_change_detection_summary?.languages || 0) +
                      (featureSettings?.last_change_detection_summary?.editions || 0) +
                      (featureSettings?.last_change_detection_summary?.runtimes || 0) +
                      (featureSettings?.last_change_detection_summary?.status || 0) +
                      (featureSettings?.last_change_detection_summary?.new || 0)
                    )})
                  </button>
                )}
              </div>
            </div>

            {/* Change Detection Settings: 2 Clean, Practical Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Setting 1: Background Monitoring */}
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme flex flex-col justify-between gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-theme-muted" />
                      Background Checking
                    </div>
                    <div className="text-[11px] text-theme-muted mt-1 leading-relaxed">
                      Periodically checks media servers in the background for new tracks, editions, and runtimes.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateDynamicSettings({
                      change_detection_enabled: featureSettings?.change_detection_enabled === false ? true : false
                    })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      featureSettings?.change_detection_enabled !== false ? "bg-theme-primary" : "bg-theme-hover border-theme"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        featureSettings?.change_detection_enabled !== false ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-theme/40 flex items-center justify-between text-[11px]">
                  <span className="text-theme-muted">Check interval:</span>
                  <select
                    value={featureSettings?.change_detection_interval_minutes || 60}
                    onChange={(e) => handleUpdateDynamicSettings({
                      change_detection_interval_minutes: parseInt(e.target.value, 10)
                    })}
                    className="bg-theme-card border border-theme rounded-lg px-2 py-1 text-[11px] text-theme-text font-medium"
                  >
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every 1 hour</option>
                    <option value={120}>Every 2 hours</option>
                    <option value={240}>Every 4 hours</option>
                    <option value={360}>Every 6 hours</option>
                    <option value={720}>Every 12 hours</option>
                    <option value={1440}>Every 24 hours</option>
                  </select>
                </div>
              </div>

              {/* Setting 2: Auto-Resync */}
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme flex flex-col justify-between gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-theme-text flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-theme-muted" />
                      Automatic Overlay Resync
                    </div>
                    <div className="text-[11px] text-theme-muted mt-1 leading-relaxed">
                      Re-renders and updates overlays automatically as soon as changes are detected.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateDynamicSettings({
                      auto_resync_on_change: featureSettings?.auto_resync_on_change === false ? true : false
                    })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      featureSettings?.auto_resync_on_change !== false ? "bg-theme-primary" : "bg-theme-hover border-theme"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        featureSettings?.auto_resync_on_change !== false ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-theme/40 text-[11px] text-theme-muted flex items-center justify-between">
                  <span>Status:</span>
                  <span className="font-medium text-theme-text">
                    {featureSettings?.auto_resync_on_change !== false ? "Active on changes" : "Manual sync only"}
                  </span>
                </div>
              </div>
            </div>

            {/* Last Scan Summary Banner & Counter Badges */}
            <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="text-theme-muted text-[11px]">
                Last check:{" "}
                <strong className="text-theme-text font-semibold">
                  {featureSettings?.last_change_detection_at
                    ? new Date(featureSettings.last_change_detection_at).toLocaleString()
                    : "Never run"}
                </strong>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setChangeFilterType("languages");
                    setIsChangeModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme text-theme-text text-[11px] font-medium hover:border-theme-primary/40 transition-colors flex items-center gap-1"
                  title="Audio languages modified"
                >
                  <span className="text-theme-muted">Audio:</span>
                  <span className="font-semibold">{featureSettings?.last_change_detection_summary?.languages ?? changeDetectionReport?.summary?.languages ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChangeFilterType("edition");
                    setIsChangeModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme text-theme-text text-[11px] font-medium hover:border-theme-primary/40 transition-colors flex items-center gap-1"
                  title="Edition or Cut upgrades"
                >
                  <span className="text-theme-muted">Editions:</span>
                  <span className="font-semibold">{featureSettings?.last_change_detection_summary?.editions ?? changeDetectionReport?.summary?.editions ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChangeFilterType("runtime");
                    setIsChangeModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme text-theme-text text-[11px] font-medium hover:border-theme-primary/40 transition-colors flex items-center gap-1"
                  title="Runtime modifications"
                >
                  <span className="text-theme-muted">Runtimes:</span>
                  <span className="font-semibold">{featureSettings?.last_change_detection_summary?.runtimes ?? changeDetectionReport?.summary?.runtimes ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChangeFilterType("status");
                    setIsChangeModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme text-theme-text text-[11px] font-medium hover:border-theme-primary/40 transition-colors flex items-center gap-1"
                  title="Show status changes"
                >
                  <span className="text-theme-muted">Status:</span>
                  <span className="font-semibold">{featureSettings?.last_change_detection_summary?.status ?? changeDetectionReport?.summary?.status ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChangeFilterType("new");
                    setIsChangeModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme text-theme-text text-[11px] font-medium hover:border-theme-primary/40 transition-colors flex items-center gap-1"
                  title="Newly added media"
                >
                  <span className="text-theme-muted">New:</span>
                  <span className="font-semibold">{featureSettings?.last_change_detection_summary?.new ?? changeDetectionReport?.summary?.new ?? 0}</span>
                </button>
              </div>
            </div>
          </div>

          {/* OVERLAY CACHE CARD */}
          <div className="bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-theme-text text-base flex items-center gap-2">
                  <Database className="w-5 h-5 text-theme-primary" />
                  Overlay Cache
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  Keeps track of which artwork has already been overlaid so only new or updated items need to be uploaded.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setIsOverlayCacheModalOpen(true);
                    fetchOverlayCacheItems(1);
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-theme-primary/10 hover:bg-theme-primary/20 border border-theme-primary/30 text-theme-primary text-xs font-semibold transition-all shadow-sm"
                  title="Browse, search, and manage individual cached overlay artwork"
                >
                  <Eye className="w-4 h-4" />
                  Browse Cache
                  {Boolean(cacheData?.stats?.total_cached) && (
                    <span className="px-1.5 py-0.5 rounded-md bg-theme-primary/20 text-[10px] font-bold ml-0.5">
                      {cacheData.stats.total_cached}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsClearCacheModalOpen(true)}
                  disabled={isClearingOverlayCache}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Wipe entire overlay cache"
                >
                  {isClearingOverlayCache ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span>Clear Cache</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-theme/60">
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Total Cached Items</div>
                <div className="text-2xl font-bold text-theme-text mt-1">{cacheData?.stats?.total_cached || 0}</div>
              </div>
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Media Server</div>
                <div className="text-xs font-mono text-theme-text mt-1">
                  {Object.entries(cacheData?.stats?.by_server || {}).map(([s, c]) => `${s}: ${c}`).join(", ") || "None"}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Last Synced</div>
                <div className="text-xs text-theme-text mt-1 truncate">
                  {cacheData?.stats?.last_pushed_at ? new Date(cacheData.stats.last_pushed_at).toLocaleString() : "Never"}
                </div>
              </div>
            </div>
          </div>

          {/* RATINGS CACHE & AUTO-REFRESH CARD */}
          <div className="bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-theme-text text-base flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  Ratings Cache & Auto-Refresh
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  Saves ratings from IMDb, Rotten Tomatoes, TMDb, Trakt, and Letterboxd locally to keep sync fast and avoid API limits.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setIsRatingsCacheModalOpen(true);
                    fetchRatingsCacheItems(1);
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold transition-all shadow-sm"
                  title="Browse, search, and inspect individual cached movie/show ratings"
                >
                  <Eye className="w-4 h-4" />
                  Browse Ratings
                  {Boolean(ratingsCacheStats?.total) && (
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-[10px] font-bold ml-0.5">
                      {ratingsCacheStats.total}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleClearRatingsCache}
                  disabled={isClearingRatingsCache}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Wipe entire ratings cache"
                >
                  {isClearingRatingsCache ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Clear Ratings Cache
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-theme/60">
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Total Cached Ratings</div>
                <div className="text-2xl font-bold text-theme-text mt-1">{ratingsCacheStats?.total || 0}</div>
                <div className="text-[11px] text-theme-muted mt-0.5">{ratingsCacheStats?.valid || 0} valid / {ratingsCacheStats?.expired || 0} expired</div>
              </div>
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Auto-Refresh Schedule</div>
                <div className="text-xs text-theme-text mt-1 space-y-0.5">
                  <div>• New releases (&lt; 6 months): 3-day refresh</div>
                  <div>• Recent (&lt; 2 years): 14-day refresh</div>
                  <div>• Older (&gt; 2 years): 30-day refresh</div>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <div className="text-xs text-theme-muted">Server Updates</div>
                <div className="text-xs text-emerald-400 font-semibold mt-1">
                  Active
                </div>
                <p className="text-[11px] text-theme-muted mt-0.5">
                  When ratings change during scheduled runs, updated backdrops and posters are automatically sent to your media server.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-theme-card border border-theme rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-theme/60 font-bold text-theme-text text-sm">
              Recently Updated Items
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-theme-hover/50 text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme">
                  <tr>
                    <th className="py-3 px-4">Server</th>
                    <th className="py-3 px-4">Item ID</th>
                    <th className="py-3 px-4">Title / Library</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Synced At</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme/40 text-theme-text">
                  {(cacheData?.recent || []).map((entry, idx) => (
                    <tr key={idx} className="hover:bg-theme-hover/30">
                      <td className="py-3 px-4 uppercase font-semibold text-theme-primary">{entry.server_type}</td>
                      <td className="py-3 px-4 font-mono">{entry.item_id}</td>
                      <td className="py-3 px-4 font-medium">{entry.item_title || entry.library_name || "—"}</td>
                      <td className="py-3 px-4 capitalize">{entry.asset_type}</td>
                      <td className="py-3 px-4 text-theme-muted">{entry.last_pushed_at ? new Date(entry.last_pushed_at).toLocaleString() : "—"}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium text-[10px]">
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(cacheData?.recent || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-theme-muted">
                        No cached push records found. Overlays will be recorded here when pushed to your media servers.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: ANIMETAFILL (ANIME OVERLAYS) */}
      {/* ========================================================================= */}
      {activeTab === "anime" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* HEADER HERO */}
          <div className="p-5 rounded-xl bg-theme-card border border-theme flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-theme-text">Anime Episode Badges</h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    animetafillConfig?.enabled
                      ? "bg-theme-primary/10 text-theme-primary border-theme-primary/30"
                      : "bg-theme-bg text-theme-muted border-theme"
                  }`}>
                    {animetafillConfig?.enabled ? "Active & Synced" : "Disabled (Off by default)"}
                  </span>
                </div>
                <p className="text-xs text-theme-muted max-w-2xl leading-relaxed">
                  Mark your Anime episodes as <strong>Canon</strong>, <strong>Filler</strong>, or <strong>Mixed</strong> on episode title cards using SIMKL and Sonarr.
                </p>
              </div>
            </div>

            {/* MASTER TOGGLE SWITCH */}
            <div className="flex items-center gap-2.5 bg-theme-bg px-3 py-1.5 rounded-lg border border-theme shrink-0">
              <span className="text-xs font-semibold text-theme-muted">Enable Overlays:</span>
              <button
                type="button"
                onClick={() => handleToggleAnimetafill(!animetafillConfig?.enabled)}
                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  animetafillConfig?.enabled ? "bg-theme-primary" : "bg-theme-card border border-theme"
                }`}
                title="Toggle AniMetaFill Integration"
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    animetafillConfig?.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* METRIC PILLS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-theme-card border border-theme shadow-sm flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-theme-muted">Mapped Anime Shows</p>
                <p className="text-xl font-bold text-theme-text">{animetafillStatus?.shows_mapped || 0}</p>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-theme-card border border-theme shadow-sm flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-theme-muted">Episode Classifications</p>
                <p className="text-xl font-bold text-theme-text">{animetafillStatus?.episodes_mapped || 0}</p>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-theme-card border border-theme shadow-sm flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-theme-muted">Overlay Recipe File</p>
                <p className="text-sm font-bold text-theme-text">
                  {animetafillStatus?.yaml_exists ? "anime_overlays.yml Ready" : "Not Generated Yet"}
                </p>
                <p className="text-[11px] text-theme-muted">{animetafillStatus?.yaml_last_updated || "Never"}</p>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-theme-card border border-theme shadow-sm flex items-center gap-3.5">
              <div className="p-2.5 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-theme-muted">Sync Status</p>
                <p className="text-sm font-bold text-theme-text capitalize">
                  {animetafillStatus?.is_running ? "Syncing..." : (animetafillStatus?.last_status || "Idle")}
                </p>
                <p className="text-[11px] text-theme-muted">{animetafillStatus?.last_sync || "No runs yet"}</p>
              </div>
            </div>
          </div>

          {/* VISUAL BADGES SHOWCASE */}
          <div className="p-6 rounded-2xl bg-theme-card border border-theme shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
              <Eye className="w-4 h-4 text-theme-primary" />
              <span>Titlecard Overlay Preview & Legend</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-black/40 border border-theme flex items-center justify-between">
                <div>
                  <span className="px-3 py-1 rounded bg-[#000000BF] text-[#27C24C] font-bold text-sm tracking-wide">
                    CANON
                  </span>
                  <p className="text-xs text-theme-muted mt-2">Manga canonical story episodes</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-[#27C24C] shadow-lg shadow-[#27C24C]/40" />
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-theme flex items-center justify-between">
                <div>
                  <span className="px-3 py-1 rounded bg-[#000000BF] text-[#FF0000] font-bold text-sm tracking-wide">
                    FILLER
                  </span>
                  <p className="text-xs text-theme-muted mt-2">Anime original non-manga filler episodes</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-[#FF0000] shadow-lg shadow-[#FF0000]/40" />
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-theme flex items-center justify-between">
                <div>
                  <span className="px-3 py-1 rounded bg-[#000000BF] text-[#FFA500] font-bold text-sm tracking-wide">
                    MIXED
                  </span>
                  <p className="text-xs text-theme-muted mt-2">Canon story with filler elements</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-[#FFA500] shadow-lg shadow-[#FFA500]/40" />
              </div>
            </div>
          </div>

          {/* CONFIGURATION & SYNC ACTIONS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* CONFIGURATION FORM */}
            <div className="p-6 rounded-2xl bg-theme-card border border-theme shadow-xl space-y-6">
              <div className="flex items-center justify-between border-b border-theme pb-3">
                <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-theme-primary" />
                  <span>Media Server & Integration Settings</span>
                </h3>
                <span className="text-[11px] text-theme-muted flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Synchronized with config.json
                </span>
              </div>

              {/* 1. MEDIA SERVER SELECTION (PLEX / JELLYFIN / EMBY) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-theme-text flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-theme-primary" />
                    <span>Select Media Server Source</span>
                  </label>
                  <span className="text-[11px] text-theme-muted">
                    Active: <strong className="capitalize text-theme-text">{animetafillConfig?.media_server || "plex"}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { id: "plex", name: "Plex", icon: Tv },
                    { id: "jellyfin", name: "Jellyfin", icon: Film },
                    { id: "emby", name: "Emby", icon: HardDrive }
                  ].map(srv => {
                    const isSelected = (animetafillConfig?.media_server || "plex") === srv.id;
                    const SrvIcon = srv.icon;
                    const serverObj = (animetafillConfig?.available_servers || []).find(s => s.id === srv.id);
                    const isConfigured = serverObj ? serverObj.configured : Boolean(animetafillConfig?.server_url);

                    return (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => handleSelectMediaServer(srv.id)}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-xs ${
                          isSelected
                            ? "border-theme-primary bg-theme-primary/10 text-theme-primary font-bold shadow-sm"
                            : "border-theme bg-theme-hover/40 text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                        }`}
                      >
                        <SrvIcon className={`w-5 h-5 mb-1.5 ${isSelected ? "text-theme-primary" : "text-theme-muted"}`} />
                        <span>{srv.name}</span>
                        <span className={`text-[10px] mt-1 px-1.5 py-0.2 rounded-full border ${
                          isConfigured
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-theme-card text-theme-muted border-theme"
                        }`}>
                          {isConfigured ? "Connected" : "Unconfigured"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {animetafillConfig?.server_url && (
                  <p className="text-[11px] text-theme-muted flex items-center gap-1 pt-1 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>Server URL: <code className="text-theme-text">{animetafillConfig.server_url}</code> (from config.json)</span>
                  </p>
                )}
              </div>

              {/* 2. SELECTABLE TARGET LIBRARIES */}
              <div className="space-y-2 pt-2 border-t border-theme">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-theme-text flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
                      <span>Target Anime Libraries</span>
                    </label>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                      {(animetafillConfig?.target_libraries || animetafillConfig?.plex_libraries || []).length} Selected
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const showNames = animetafillLibraries
                          .filter(l => (l.type || "").toLowerCase() === "show")
                          .map(l => l.name);
                        setAnimetafillConfig({ ...animetafillConfig, target_libraries: showNames, plex_libraries: showNames });
                      }}
                      className="px-2 py-1 rounded-lg bg-theme-hover border border-theme text-[10px] text-theme-muted hover:text-theme-text"
                      title="Select all TV / Show libraries (Anime Shows)"
                    >
                      Select All Shows
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnimetafillConfig({ ...animetafillConfig, target_libraries: [], plex_libraries: [] })}
                      className="px-2 py-1 rounded-lg bg-theme-hover border border-theme text-[10px] text-theme-muted hover:text-theme-text"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => fetchMediaServerLibraries(animetafillConfig?.media_server || "plex", true)}
                      disabled={isLoadingAnimLibraries}
                      title="Reload libraries from media server"
                      className="p-1 rounded-lg bg-theme-hover border border-theme text-theme-muted hover:text-theme-primary transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAnimLibraries ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                {/* SEARCH INPUT */}
                {animetafillLibraries.length > 5 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                    <input
                      type="text"
                      value={animLibraryFilter}
                      onChange={(e) => setAnimLibraryFilter(e.target.value)}
                      placeholder="Filter libraries..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-theme-hover border border-theme text-xs text-theme-text focus:outline-none focus:border-theme-primary"
                    />
                  </div>
                )}

                {/* LIBRARY PILLS LIST */}
                <div className="p-3 rounded-xl bg-theme-hover/30 border border-theme min-h-[100px] max-h-52 overflow-y-auto space-y-1.5">
                  {isLoadingAnimLibraries ? (
                    <div className="flex items-center justify-center py-6 text-xs text-theme-muted gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-theme-primary" />
                      <span>Fetching libraries from {animetafillConfig?.media_server || "Plex"}...</span>
                    </div>
                  ) : animetafillLibraries.length === 0 ? (
                    <div className="text-center py-5 space-y-2">
                      <p className="text-xs text-theme-muted">No libraries cached for {animetafillConfig?.media_server || "Plex"}.</p>
                      <button
                        type="button"
                        onClick={() => fetchMediaServerLibraries(animetafillConfig?.media_server || "plex", true)}
                        className="px-3 py-1.5 rounded-lg bg-theme-primary text-white text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" /> Fetch Libraries Now
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {animetafillLibraries
                        .filter(lib => !animLibraryFilter || lib.name.toLowerCase().includes(animLibraryFilter.toLowerCase()))
                        .map(lib => {
                          const currentSelected = animetafillConfig?.target_libraries || animetafillConfig?.plex_libraries || [];
                          const isChecked = currentSelected.includes(lib.name);
                          const isShowType = (lib.type || "").toLowerCase() === "show";

                          return (
                            <button
                              key={lib.name}
                              type="button"
                              onClick={() => handleToggleTargetLibrary(lib.name)}
                              className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all text-xs ${
                                isChecked
                                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 font-semibold"
                                  : "border-theme bg-theme-card/60 text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                {isChecked ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 text-theme-muted shrink-0" />
                                )}
                                <span className="truncate">{lib.name}</span>
                              </div>
                              {lib.type && (
                                <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border shrink-0 ml-1 ${
                                  isShowType
                                    ? "bg-purple-500/15 text-purple-300 border-purple-500/30 font-semibold"
                                    : "bg-black/30 text-theme-muted border-theme"
                                }`}>
                                  {lib.type}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. SONARR CREDENTIALS & TEST BUTTON (OPTIONAL) */}
              <div className="space-y-3 pt-2 border-t border-theme">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-theme-text">Sonarr Connection</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">Optional</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSonarr}
                    disabled={isTestingSonarr}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    {isTestingSonarr ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Testing...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>Test Connection</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  Optional: If Sonarr is not configured or not running, AniMetaFill directly maps season episodes from your selected media server ({animetafillConfig?.media_server ? animetafillConfig.media_server.toUpperCase() : "Plex"}).
                </p>

                {sonarrTestResult && (
                  <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    sonarrTestResult.success
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                  }`}>
                    {sonarrTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <p className="font-semibold">{sonarrTestResult.message}</p>
                      {sonarrTestResult.version && (
                        <p className="text-[11px] opacity-80">Version: {sonarrTestResult.version}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-theme-muted font-medium mb-1">Sonarr URL</label>
                    <input
                      type="text"
                      value={animetafillConfig?.sonarr_url || ""}
                      onChange={(e) => setAnimetafillConfig({ ...animetafillConfig, sonarr_url: e.target.value })}
                      placeholder="http://192.168.1.93:8989"
                      className="w-full px-3.5 py-2 rounded-xl bg-theme-hover border border-theme text-theme-text focus:outline-none focus:border-theme-primary font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-theme-muted font-medium">Sonarr API Key</label>
                      <button
                        type="button"
                        onClick={() => setShowSonarrKey(!showSonarrKey)}
                        className="text-theme-muted hover:text-theme-text flex items-center gap-1 text-[11px]"
                      >
                        {showSonarrKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        <span>{showSonarrKey ? "Hide" : "Show"}</span>
                      </button>
                    </div>
                    <input
                      type={showSonarrKey ? "text" : "password"}
                      value={animetafillConfig?.sonarr_api_key || ""}
                      onChange={(e) => setAnimetafillConfig({ ...animetafillConfig, sonarr_api_key: e.target.value })}
                      placeholder="Enter Sonarr API Key"
                      className="w-full px-3.5 py-2 rounded-xl bg-theme-hover border border-theme text-theme-text focus:outline-none focus:border-theme-primary font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* 4. SIMKL CLIENT ID (REQUIRED) */}
              <div className="space-y-2 pt-2 border-t border-theme text-xs">
                <div className="flex items-center justify-between">
                  <label className="text-theme-text font-semibold flex items-center gap-1.5">
                    <span>SIMKL Client ID</span>
                    <span className="text-rose-400 font-bold">*</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">Required</span>
                  </label>
                  <a
                    href="https://simkl.com/settings/developer/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-theme-primary hover:underline flex items-center gap-1 text-[11px]"
                  >
                    Get Free ID <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <input
                  type="text"
                  required
                  value={animetafillConfig?.simkl_client_id || ""}
                  onChange={(e) => setAnimetafillConfig({ ...animetafillConfig, simkl_client_id: e.target.value })}
                  placeholder="Enter your SIMKL Client ID (Required)"
                  className={`w-full px-3.5 py-2 rounded-xl bg-theme-hover border text-theme-text focus:outline-none font-mono ${
                    !animetafillConfig?.simkl_client_id?.trim() ? "border-amber-500/60 focus:border-amber-500" : "border-theme focus:border-theme-primary"
                  }`}
                />
                {!animetafillConfig?.simkl_client_id?.trim() && (
                  <p className="text-[11px] text-amber-400/90 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> SIMKL Client ID is required for anime episode classification & filler detection.
                  </p>
                )}
              </div>

              {/* 5. MYANIMELIST (MAL) JIKAN INTEGRATION */}
              <div className="p-3.5 rounded-xl bg-theme-hover/30 border border-theme space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-black text-[11px] shrink-0">
                      MAL
                    </div>
                    <div>
                      <div className="font-semibold text-theme-text flex items-center gap-1.5">
                        <span>MyAnimeList (MAL) via Jikan API</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">Free / Open API</span>
                      </div>
                      <p className="text-[11px] text-theme-muted">
                        Supplementary tier-3 fallback for anime filler metadata & episode classifications.
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                    <input
                      type="checkbox"
                      checked={animetafillConfig?.mal_enabled !== false}
                      onChange={(e) => setAnimetafillConfig({ ...animetafillConfig, mal_enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-theme-primary"></div>
                  </label>
                </div>
              </div>

              {/* SAVE BUTTON */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleSaveAnimetafillConfig}
                  disabled={isAnimetafillSaving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-theme-primary hover:opacity-90 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
                >
                  {isAnimetafillSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Save Settings to config.db</span>
                </button>
              </div>
            </div>

            {/* SYNC TRIGGER CARD */}
            <div className="p-5 sm:p-6 rounded-2xl bg-theme-card border border-theme shadow-xl space-y-4 self-start">
              <div>
                <h3 className="text-sm font-bold text-theme-text flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-purple-400" />
                  <span>Scan & Update Anime Badges</span>
                </h3>
                <p className="text-xs text-theme-muted leading-relaxed mb-4">
                  Checks your episodes against Sonarr and SIMKL to identify which episodes are canon or filler, then saves the overlay badges.
                </p>

                <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme space-y-3 mb-4">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-theme-text">
                    <input
                      type="checkbox"
                      checked={animetafillForce}
                      onChange={(e) => setAnimetafillForce(e.target.checked)}
                      className="rounded bg-theme-card border-theme text-theme-primary focus:ring-0"
                    />
                    <span><strong>Force Full Re-check</strong> (Re-checks all episodes instead of only new ones)</span>
                  </label>
                  <p className="text-[11px] text-theme-muted">
                    Leave unchecked for fast updates that only check new episodes.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleRunAnimetafill}
                  disabled={isAnimetafillRunning}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white font-bold text-xs shadow-sm disabled:opacity-50 transition-all"
                >
                  {isAnimetafillRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Checking Anime Episodes...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Scan Anime Episodes Now</span>
                    </>
                  )}
                </button>

                <p className="text-[11px] text-theme-muted text-center">
                  Output path: <code className="text-purple-400">Overlayfiles/dynamic_overlays/configs/anime_overlays.yml</code>
                </p>
              </div>
            </div>
          </div>

          {/* AESTHETIC & ALIGNMENT STYLING CARD (AnimeBar) */}
          <div className="p-6 rounded-2xl bg-theme-card border border-theme shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-theme gap-3">
              <div>
                <h3 className="text-base font-bold text-theme-text flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-purple-400" />
                  <span>Titlecard Overlay Styling & Alignment (AnimeBar)</span>
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  Customizes how the Canon / Filler badge looks on your episode titlecards. Saved into <code className="text-purple-400 font-mono">anime_overlays.yml</code>.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSaveAnimetafillConfig}
                disabled={isAnimetafillSaving}
                className="px-4 py-2 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 shrink-0"
              >
                {isAnimetafillSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save Styling</span>
              </button>
            </div>

            {(() => {
              const aesthetic = animetafillConfig?.aesthetic || {};
              const updateAesthetic = (patch) => {
                setAnimetafillConfig((prev) => ({
                  ...prev,
                  aesthetic: {
                    ...(prev?.aesthetic || {}),
                    ...patch
                  }
                }));
              };

              const hAlign = aesthetic.horizontal_align || "left";
              const vAlign = aesthetic.vertical_align || "top";
              const unifiedPos = `${vAlign}-${hAlign}`;

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Controls */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="flex items-start gap-4">
                      <div>
                        <label className="text-[10px] font-semibold text-theme-muted uppercase block mb-1.5">Preset Anchor</label>
                        <PositionPicker
                          value={unifiedPos}
                          onChange={(pos) => {
                            const parts = (pos || "top-left").split("-");
                            const v = parts[0] || "top";
                            const h = parts[1] || (parts[0] === "center" ? "center" : "left");
                            updateAesthetic({ horizontal_align: h, vertical_align: v });
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3 flex-1">
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-theme-muted uppercase">Horizontal Align</label>
                          <select
                            value={hAlign}
                            onChange={(e) => updateAesthetic({ horizontal_align: e.target.value })}
                            className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-medium"
                          >
                            <option value="left">Left Corner</option>
                            <option value="center">Center</option>
                            <option value="right">Right Corner</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-theme-muted uppercase">Vertical Align</label>
                          <select
                            value={vAlign}
                            onChange={(e) => updateAesthetic({ vertical_align: e.target.value })}
                            className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-medium"
                          >
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-theme-muted uppercase">Horizontal Offset (px)</label>
                          <input
                            type="number"
                            value={aesthetic.horizontal_offset ?? 0}
                            onChange={(e) => updateAesthetic({ horizontal_offset: parseInt(e.target.value) || 0 })}
                            className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-theme-muted uppercase">Vertical Offset (px)</label>
                          <input
                            type="number"
                            value={aesthetic.vertical_offset ?? 15}
                            onChange={(e) => updateAesthetic({ vertical_offset: parseInt(e.target.value) || 0 })}
                            className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-theme/60">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-theme-muted uppercase">Badge Width (px)</label>
                        <input
                          type="number"
                          value={aesthetic.back_width ?? 300}
                          onChange={(e) => updateAesthetic({ back_width: parseInt(e.target.value) || 300 })}
                          className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-theme-muted uppercase">Badge Height (px)</label>
                        <input
                          type="number"
                          value={aesthetic.back_height ?? 100}
                          onChange={(e) => updateAesthetic({ back_height: parseInt(e.target.value) || 100 })}
                          className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-theme-muted uppercase">Font Size (px)</label>
                        <input
                          type="number"
                          value={aesthetic.font_size ?? 70}
                          onChange={(e) => updateAesthetic({ font_size: parseInt(e.target.value) || 70 })}
                          className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-theme-muted uppercase">Background Color</label>
                        <input
                          type="text"
                          value={aesthetic.back_color || "#000000BF"}
                          onChange={(e) => updateAesthetic({ back_color: e.target.value })}
                          className="w-full bg-theme-hover border border-theme rounded-xl px-2.5 py-1.5 text-xs text-theme-text font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Preview Box with Live Artwork Backdrop */}
                  <div className="lg:col-span-5 bg-black/60 border border-theme rounded-xl p-4 flex flex-col items-center justify-center space-y-2.5">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                        <span>Titlecard Stage Preview (16:9)</span>
                      </span>

                      {/* Tag Switcher (Canon, Filler, Mixed) */}
                      <div className="flex items-center gap-1 bg-black/50 p-0.5 rounded-lg border border-theme">
                        {[
                          { tag: "CANON", color: "text-emerald-400 hover:text-emerald-300" },
                          { tag: "FILLER", color: "text-red-400 hover:text-red-300" },
                          { tag: "MIXED", color: "text-amber-400 hover:text-amber-300" }
                        ].map((t) => (
                          <button
                            key={t.tag}
                            type="button"
                            onClick={() => setAnimetafillPreviewTag(t.tag)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider transition-all ${
                              animetafillPreviewTag === t.tag
                                ? "bg-white/20 text-white shadow-xs"
                                : `${t.color} opacity-75 hover:opacity-100`
                            }`}
                          >
                            {t.tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 16:9 Canvas Stage with Sample Artwork */}
                    {(() => {
                      const curCustomTitlecard = customImages?.titlecard || customImages?.episode_card || customImages?.backdrop;
                      const titlecardSampleSrc = curCustomTitlecard?.dataUrl
                        || `/api/dynamic-overlays/sample-image?template_type=titlecard${curCustomTitlecard?.previewImageId ? `&custom_image_id=${encodeURIComponent(curCustomTitlecard.previewImageId)}` : ""}&t=${previewTimestamp}`;

                      const ho = Number(aesthetic.horizontal_offset) || 0;
                      const vo = Number(aesthetic.vertical_offset) || 0;
                      const badgeW = Number(aesthetic.back_width) || 300;
                      const badgeH = Number(aesthetic.back_height) || 100;
                      const fontSize = Number(aesthetic.font_size) || 70;

                      const TAG_STYLES = {
                        CANON: { text: "#27C24C", border: "rgba(39, 194, 76, 0.6)" },
                        FILLER: { text: "#EF4444", border: "rgba(239, 68, 68, 0.6)" },
                        MIXED: { text: "#F59E0B", border: "rgba(245, 158, 11, 0.6)" }
                      };
                      const activeStyle = TAG_STYLES[animetafillPreviewTag] || TAG_STYLES.CANON;

                      return (
                        <div className="w-full aspect-video bg-zinc-900 rounded-lg relative overflow-hidden border border-zinc-800 shadow-2xl flex items-center justify-center">
                          {/* Sample Titlecard Backdrop Artwork */}
                          <img
                            src={titlecardSampleSrc}
                            alt="Sample 16:9 episode titlecard"
                            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none opacity-90"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none select-none" />

                          {/* Subtle Stage Watermark */}
                          <span className="absolute bottom-1.5 right-2 text-[9px] font-mono text-white/50 bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
                            1920 × 1080 Titlecard
                          </span>

                          {/* Active Custom Artwork Indicator */}
                          {curCustomTitlecard && (
                            <span className="absolute top-1.5 right-2 text-[9px] font-mono text-emerald-300 bg-black/75 px-1.5 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Custom: {curCustomTitlecard.filename}
                            </span>
                          )}

                          {/* Styled Anime Canon / Filler Badge */}
                          <div
                            className="absolute flex items-center justify-center font-bold font-mono tracking-wider shadow-2xl transition-all select-none"
                            style={{
                              backgroundColor: aesthetic.back_color || "#000000BF",
                              color: activeStyle.text,
                              border: `1.5px solid ${activeStyle.border}`,
                              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.7)",
                              top: vAlign === "top" ? `${(vo / 1080) * 100}%` : "auto",
                              bottom: vAlign === "bottom" ? `${(vo / 1080) * 100}%` : "auto",
                              left: hAlign === "left" ? `${(ho / 1920) * 100}%` : (hAlign === "center" ? "50%" : "auto"),
                              right: hAlign === "right" ? `${(ho / 1920) * 100}%` : "auto",
                              transform: hAlign === "center" ? "translateX(-50%)" : "none",
                              width: `${Math.min(65, Math.max(12, (badgeW / 1920) * 100))}%`,
                              height: `${Math.min(40, Math.max(8, (badgeH / 1080) * 100))}%`,
                              borderRadius: `${Math.min(20, Math.max(4, Math.round(((aesthetic.back_radius ?? 15) / 1080) * 100 * 2)))}px`,
                              fontSize: `${Math.max(10, Math.round((fontSize / 1080) * 150))}px`,
                              padding: "2px 6px"
                            }}
                          >
                            {animetafillPreviewTag}
                          </div>
                        </div>
                      );
                    })()}

                    <span className="text-[10px] text-theme-muted text-center">
                      Badge is positioned in {hAlign.toUpperCase()} {vAlign.toUpperCase()} with {aesthetic.horizontal_offset ?? 0}px H / {aesthetic.vertical_offset ?? 15}px V offset.
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ANIME DATABASE & CLASSIFICATION BROWSER */}
          <div className="p-5 rounded-xl bg-theme-card border border-theme shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-theme">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20 shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-theme-text">Anime Classification Database</h3>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-theme-bg border border-theme text-theme-muted font-mono font-medium">
                      {animTotalShows} Shows Indexed
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted mt-0.5">
                    Browse cached episode classifications, inspect canon/filler ratios, or manually adjust classifications.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddAnimeModalOpen(true)}
                  className="px-3.5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add / Override Show</span>
                </button>
                <button
                  type="button"
                  onClick={() => fetchAnimShows(animShowsPage)}
                  disabled={isLoadingAnimShows}
                  className="p-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-muted hover:text-theme-text transition-all disabled:opacity-50 shadow-sm"
                  title="Refresh list"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingAnimShows ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                <input
                  type="text"
                  value={animShowsQuery}
                  onChange={(e) => setAnimShowsQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") fetchAnimShows(1, animShowsQuery, animShowsCategory);
                  }}
                  placeholder="Search 400+ anime titles..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-theme-hover border border-theme text-xs text-theme-text focus:outline-none focus:border-theme-primary"
                />
                {animShowsQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setAnimShowsQuery("");
                      fetchAnimShows(1, "", animShowsCategory);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {[
                  { id: "all", label: "All Shows" },
                  { id: "has_filler", label: "Has Filler" },
                  { id: "canon_only", label: "100% Canon" },
                  { id: "mixed", label: "Has Mixed" }
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setAnimShowsCategory(f.id);
                      fetchAnimShows(1, animShowsQuery, f.id);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                      animShowsCategory === f.id
                        ? "bg-purple-500/15 border-purple-500/40 text-purple-400"
                        : "bg-theme-hover/60 border-theme text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Shows List */}
            {isLoadingAnimShows ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                <span className="text-xs text-theme-muted font-medium">Loading anime classification index...</span>
              </div>
            ) : animShows.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-theme-hover/30 border border-theme space-y-2">
                <AlertCircle className="w-6 h-6 text-theme-muted mx-auto" />
                <p className="text-xs text-theme-muted font-semibold">No anime shows match your filter criteria.</p>
                <button
                  type="button"
                  onClick={() => {
                    setAnimShowsQuery("");
                    setAnimShowsCategory("all");
                    fetchAnimShows(1, "", "all");
                  }}
                  className="px-3 py-1.5 rounded-lg bg-theme-primary text-white text-xs font-semibold hover:opacity-90 inline-block mt-2"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="border border-theme rounded-xl overflow-hidden divide-y divide-theme">
                {animShows.map((show) => {
                  const isExpanded = expandedAnimShow === show.title;
                  return (
                    <div key={show.title} className="bg-theme-hover/10 hover:bg-theme-hover/20 transition-colors">
                      <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div
                          className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                          onClick={() => handleToggleExpandShow(show.title)}
                        >
                          <div className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted">
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-purple-400" /> : <ChevronRight className="w-4 h-4" />}
                          </div>
                          <div className="truncate">
                            <h4 className="text-xs font-bold text-theme-text truncate">{show.title}</h4>
                            <span className="text-[11px] text-theme-muted font-mono">{show.total_episodes} Total Episodes</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold">
                            {show.canon_count} Canon
                          </span>
                          {show.filler_count > 0 && (
                            <span className="px-2 py-0.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-bold">
                              {show.filler_count} Filler
                            </span>
                          )}
                          {show.mixed_count > 0 && (
                            <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-bold">
                              {show.mixed_count} Mixed
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleToggleExpandShow(show.title)}
                            className="px-2.5 py-1 rounded-lg bg-theme-hover border border-theme text-[11px] text-theme-muted hover:text-theme-text font-semibold ml-1"
                          >
                            {isExpanded ? "Hide" : "Inspect"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAnimeShow(show.title)}
                            title={`Delete '${show.title}'`}
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-theme-muted hover:red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Episode Drawer */}
                      {isExpanded && (
                        <div className="p-4 bg-black/40 border-t border-theme space-y-3">
                          <div className="flex items-center justify-between text-xs text-theme-muted pb-2 border-b border-theme/60">
                            <span className="font-semibold text-theme-text">Episode Breakdown for {show.title}:</span>
                            <span className="text-[11px]">Click pill to cycle category</span>
                          </div>

                          {isLoadingAnimEpisodes ? (
                            <div className="py-6 flex items-center justify-center gap-2 text-xs text-theme-muted">
                              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                              <span>Loading episodes...</span>
                            </div>
                          ) : animEpisodes.length === 0 ? (
                            <div className="text-center py-4 text-xs text-theme-muted">No episodes found.</div>
                          ) : (
                            <div className="max-h-64 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                              {animEpisodes.map((ep) => {
                                const cat = (ep.category || "canon").toLowerCase();
                                const badgeColor =
                                  cat === "canon"
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                    : (cat === "filler"
                                        ? "bg-red-500/20 text-red-300 border-red-500/40"
                                        : "bg-amber-500/20 text-amber-300 border-amber-500/40");

                                const nextCat = cat === "canon" ? "filler" : (cat === "filler" ? "mixed" : "canon");

                                return (
                                  <div
                                    key={ep.number}
                                    className="p-2 rounded-xl bg-theme-hover/40 border border-theme/60 flex items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="truncate">
                                      <span className="font-bold font-mono text-theme-text mr-1.5">Ep {ep.number}</span>
                                      <span className="text-theme-muted text-[11px] truncate">{ep.title || ""}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateEpisodeCategory(show.title, ep.number, nextCat)}
                                      title={`Click to set as ${nextCat.toUpperCase()}`}
                                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase transition-all hover:scale-105 shrink-0 ${badgeColor}`}
                                    >
                                      {cat}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            {animTotalShows > 15 && (
              <div className="flex items-center justify-between pt-3 border-t border-theme text-xs">
                <span className="text-theme-muted font-medium">
                  Page {animShowsPage} of {Math.ceil(animTotalShows / 15)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchAnimShows(animShowsPage - 1)}
                    disabled={animShowsPage <= 1 || isLoadingAnimShows}
                    className="px-3 py-1.5 rounded-lg bg-theme-hover border border-theme text-theme-text font-semibold disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchAnimShows(animShowsPage + 1)}
                    disabled={animShowsPage >= Math.ceil(animTotalShows / 15) || isLoadingAnimShows}
                    className="px-3 py-1.5 rounded-lg bg-theme-hover border border-theme text-theme-text font-semibold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RECENT LOGS VIEWER */}
          <div className="p-6 rounded-2xl bg-theme-card border border-theme shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
                <FileText className="w-4 h-4 text-theme-primary" />
                <span>Recent AniMetaFill Logs</span>
              </h3>
              <button
                type="button"
                onClick={fetchAnimetafillData}
                className="text-xs text-theme-primary hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Refresh Logs
              </button>
            </div>

            <div className="p-4 rounded-xl bg-black/80 border border-theme font-mono text-xs text-gray-300 max-h-64 overflow-y-auto space-y-1">
              {animetafillStatus?.recent_logs && animetafillStatus.recent_logs.length > 0 ? (
                animetafillStatus.recent_logs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-theme-muted italic">No logs recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: RAW YAML EDITOR */}
      {/* ========================================================================= */}
      {isRawYamlOpen && (
        <div className={`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center ${isYamlFullscreen ? "p-0" : "p-3 sm:p-6"} animate-in fade-in duration-200`}>
          <div className={`bg-theme-card border border-theme flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ${
            isYamlFullscreen
              ? "w-full h-full rounded-none"
              : "w-full max-w-5xl h-[85vh] min-h-[550px] rounded-2xl"
          }`}>
            <div className="p-4 sm:p-5 border-b border-theme flex items-center justify-between bg-theme-hover/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-theme-primary/10 text-theme-primary">
                  <Code className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-theme-text text-base sm:text-lg">Raw {selectedYamlFile} Editor</h3>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-theme-hover border border-theme text-theme-muted">
                      {(rawYamlContent || "").split("\n").length} lines
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted font-mono mt-0.5">Overlayfiles/dynamic_overlays/configs/{selectedYamlFile}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(rawYamlContent || "");
                    setCopiedYaml(true);
                    setTimeout(() => setCopiedYaml(false), 2000);
                  }}
                  className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
                  title="Copy YAML to clipboard"
                >
                  {copiedYaml ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsYamlFullscreen(!isYamlFullscreen)}
                  className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
                  title={isYamlFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isYamlFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRawYamlOpen(false);
                    setIsYamlFullscreen(false);
                  }}
                  className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {yamlError && (
              <div className="p-3 mx-4 sm:mx-6 mt-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-mono">{yamlError}</span>
              </div>
            )}

            <div className="p-4 sm:p-6 flex-1 min-h-0 flex flex-col">
              <div className="relative flex-1 w-full min-h-0 flex flex-col rounded-xl overflow-hidden border border-theme bg-black/70 focus-within:border-theme-primary transition-colors">
                <textarea
                  value={rawYamlContent}
                  onChange={(e) => setRawYamlContent(e.target.value)}
                  className="w-full h-full flex-1 bg-transparent p-4 font-mono text-xs sm:text-sm text-theme-text focus:outline-none resize-none leading-relaxed overflow-y-auto selection:bg-theme-primary/30"
                  spellCheck="false"
                  placeholder={`Enter your ${selectedYamlFile} content here...`}
                />
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-theme flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-theme-card">
              <span className="text-xs text-theme-muted flex items-center gap-1.5">
                <span>🛡️</span>
                <span>Automatic backup (<span className="font-mono text-theme-text">{selectedYamlFile}.bak</span>) created upon save.</span>
              </span>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRawYamlOpen(false);
                    setIsYamlFullscreen(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveRawYaml}
                  disabled={isSavingYaml}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {isSavingYaml ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save & Validate YAML
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD OVERLAY TO LIBRARY */}
      {/* ========================================================================= */}
      {addOverlayModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden space-y-5 p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-theme-text text-base">Add Overlay to {addOverlayModal.libraryName}</h3>
              </div>
              <button
                onClick={() => setAddOverlayModal(null)}
                className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Type selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Overlay Source</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setNewOverlayType("default"); setNewOverlayName("network"); }}
                  className={`py-2 rounded-xl text-xs font-semibold border ${
                    newOverlayType === "default" ? "bg-theme-primary text-white border-theme-primary" : "bg-theme-hover border-theme text-theme-muted"
                  }`}
                >
                  Overlay Default Presets
                </button>
                <button
                  type="button"
                  onClick={() => { setNewOverlayType("file"); setNewOverlayName("config/overlays_movies.yml"); }}
                  className={`py-2 rounded-xl text-xs font-semibold border ${
                    newOverlayType === "file" ? "bg-theme-primary text-white border-theme-primary" : "bg-theme-hover border-theme text-theme-muted"
                  }`}
                >
                  Custom File Reference
                </button>
              </div>
            </div>

            {/* Name / Preset Selector */}
            {newOverlayType === "default" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Choose Preset</label>
                <select
                  value={newOverlayName}
                  onChange={(e) => {
                    setNewOverlayName(e.target.value);
                    const preset = DEFAULT_OVERLAY_PRESETS.find(p => p.id === e.target.value);
                    if (preset?.level) setNewOverlayLevel(preset.level);
                  }}
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                >
                  {DEFAULT_OVERLAY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label} ({p.id})</option>
                  ))}
                </select>
                <p className="text-[11px] text-theme-muted mt-1">
                  {DEFAULT_OVERLAY_PRESETS.find(p => p.id === newOverlayName)?.desc}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Select Detected Config File</label>
                  <select
                    value={scanData?.available_config_files?.some(cf => `config/${cf}` === newOverlayName || cf === newOverlayName) ? (newOverlayName.startsWith("config/") ? newOverlayName.slice(7) : newOverlayName) : ""}
                    onChange={(e) => {
                      if (e.target.value) setNewOverlayName(`config/${e.target.value}`);
                    }}
                    className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                  >
                    <option value="">-- Choose from detected configs --</option>
                    {(scanData?.available_config_files || []).map((cf) => (
                      <option key={cf} value={cf}>{cf}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Or Custom File Path</label>
                  <input
                    type="text"
                    value={newOverlayName}
                    onChange={(e) => setNewOverlayName(e.target.value)}
                    placeholder="e.g. config/overlays_movies.yml"
                    className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-mono"
                  />
                </div>
              </div>
            )}

            {/* Builder Level */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Builder Level</label>
              <select
                value={newOverlayLevel}
                onChange={(e) => setNewOverlayLevel(e.target.value)}
                className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
              >
                <option value="season">Season Posters (e.g. for Network logos)</option>
                <option value="episode">Episode Titlecards (e.g. for Languages, Runtime, Anime)</option>
                <option value="movie">Movie Posters (e.g. for 4K banners, Ratings)</option>
                <option value="show">Show Posters (e.g. for Status banners)</option>
                <option value="">Default / Inherit</option>
              </select>
            </div>

            <div className="pt-3 border-t border-theme flex justify-end gap-2">
              <button
                onClick={() => setAddOverlayModal(null)}
                className="px-4 py-2 rounded-xl bg-theme-hover border border-theme text-xs font-semibold text-theme-text"
              >
                Cancel
              </button>
              <button
                onClick={handleAddOverlay}
                disabled={isAddingOverlay}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {isAddingOverlay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add Rule to Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: EDIT TEMPLATE VARIABLES (DUAL VISUAL + JSON) */}
      {/* ========================================================================= */}
      {editVariablesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-theme-primary" />
                <div>
                  <h3 className="font-bold text-theme-text text-base">Edit Template Variables</h3>
                  <p className="text-xs text-theme-muted font-mono">{editVariablesModal.overlay.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditVariablesModal(null)}
                className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Toggle Tabs */}
            <div className="flex rounded-xl bg-theme-hover/60 p-1 border border-theme">
              <button
                type="button"
                onClick={() => setEditVariablesTab("visual")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  editVariablesTab === "visual"
                    ? "bg-theme-primary text-white shadow-sm"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                Visual Settings
              </button>
              <button
                type="button"
                onClick={() => setEditVariablesTab("json")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  editVariablesTab === "json"
                    ? "bg-theme-primary text-white shadow-sm"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                Raw JSON Editor
              </button>
            </div>

            {/* TAB CONTENT: VISUAL */}
            {editVariablesTab === "visual" ? (
              <div className="space-y-3.5 max-h-[55vh] overflow-y-auto pr-1">
                {/* Builder Level */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Builder Level</label>
                  <select
                    value={visualLevel}
                    onChange={(e) => setVisualLevel(e.target.value)}
                    className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                  >
                    <option value="">Default / Inherit</option>
                    <option value="season">Season Posters (e.g. for Network logos)</option>
                    <option value="episode">Episode Titlecards (e.g. for Languages, Runtime, Anime)</option>
                    <option value="movie">Movie Posters (e.g. for 4K banners, Ratings)</option>
                    <option value="show">Show Posters (e.g. for Status banners)</option>
                  </select>
                </div>

                {/* Alignment */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Horizontal Position</label>
                    <select
                      value={visualHAlign}
                      onChange={(e) => setVisualHAlign(e.target.value)}
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Vertical Position</label>
                    <select
                      value={visualVAlign}
                      onChange={(e) => setVisualVAlign(e.target.value)}
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                    >
                      <option value="top">Top</option>
                      <option value="center">Center</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                </div>

                {/* Offsets */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">H-Offset (px)</label>
                    <input
                      type="number"
                      value={visualHOffset}
                      onChange={(e) => setVisualHOffset(e.target.value)}
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">V-Offset (px)</label>
                    <input
                      type="number"
                      value={visualVOffset}
                      onChange={(e) => setVisualVOffset(e.target.value)}
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-mono"
                    />
                  </div>
                </div>

                {/* Back Color */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Background Color (Hex / Alpha)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={visualBackColor}
                      onChange={(e) => setVisualBackColor(e.target.value)}
                      placeholder="#00000000"
                      className="flex-1 bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-mono"
                    />
                    <div
                      className="w-8 h-8 rounded-xl border border-theme shrink-0"
                      style={{ backgroundColor: visualBackColor.length === 9 ? visualBackColor.slice(0, 7) : visualBackColor }}
                      title="Color preview"
                    />
                  </div>
                </div>

                {/* Optional Status text & color input */}
                {(editVariablesModal.overlay.name.toLowerCase().includes("status") || visualStatusText) && (
                  <div className="space-y-2 p-3 rounded-xl bg-theme-hover/40 border border-theme">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Status Banner Text</label>
                    <input
                      type="text"
                      value={visualStatusText}
                      onChange={(e) => setVisualStatusText(e.target.value)}
                      placeholder="e.g. RETURNING SERIES, AIRING, ENDED, CANCELED"
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {["AIRING", "RETURNING SERIES", "ENDED", "CANCELED"].map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => {
                            setVisualStatusText(st);
                            if (st === "AIRING") setVisualStatusColor("#27C24C");
                            else if (st === "RETURNING SERIES") setVisualStatusColor("#FFA500");
                            else setVisualStatusColor("#ED1F1F");
                          }}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${
                            visualStatusText === st ? "bg-theme-primary text-white border-theme-primary" : "bg-theme-hover border-theme text-theme-muted"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] text-theme-muted">Font Color:</span>
                      <input
                        type="text"
                        value={visualStatusColor}
                        onChange={(e) => setVisualStatusColor(e.target.value)}
                        className="w-24 bg-theme-hover border border-theme rounded-lg px-2 py-0.5 text-xs text-theme-text font-mono"
                      />
                      <div
                        className="w-6 h-6 rounded-lg border border-theme shrink-0"
                        style={{ backgroundColor: visualStatusColor }}
                        title="Status Font Color Preview"
                      />
                    </div>
                  </div>
                )}

                {/* Optional Languages input */}
                {(editVariablesModal.overlay.name.toLowerCase().includes("lang") || visualLanguages) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Languages (comma-separated)</label>
                    <input
                      type="text"
                      value={visualLanguages}
                      onChange={(e) => setVisualLanguages(e.target.value)}
                      placeholder="de, en, ja, zh, ko"
                      className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-mono"
                    />
                  </div>
                )}
              </div>
            ) : (
              /* TAB CONTENT: RAW JSON */
              <div className="space-y-2">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider flex justify-between">
                  <span>Variables JSON</span>
                  <span className="text-[11px] text-theme-muted font-normal">All overlay template keys supported</span>
                </label>
                <textarea
                  value={editVariablesJson}
                  onChange={(e) => setEditVariablesJson(e.target.value)}
                  rows={9}
                  className="w-full bg-black/60 border border-theme rounded-xl p-3 font-mono text-xs text-theme-text focus:outline-none focus:border-theme-primary"
                  spellCheck="false"
                />
              </div>
            )}

            <div className="pt-2 border-t border-theme flex justify-end gap-2">
              <button
                onClick={() => setEditVariablesModal(null)}
                className="px-4 py-2 rounded-xl bg-theme-hover border border-theme text-xs font-semibold text-theme-text"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVariables}
                disabled={isSavingVariables}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-lg shadow-theme-primary/20 disabled:opacity-50"
              >
                {isSavingVariables ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Variables
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: ADD NEW LIBRARY */}
      {/* ========================================================================= */}
      {isAddLibraryOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-md shadow-2xl overflow-hidden space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-theme-text text-base">Add New Library</h3>
              </div>
              <button
                onClick={() => setIsAddLibraryOpen(false)}
                className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Library Name</label>
              <input
                type="text"
                value={newLibraryName}
                onChange={(e) => setNewLibraryName(e.target.value)}
                placeholder="e.g. Anime Shows, 4K Movies, Kids Movies"
                className="w-full bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-medium"
                autoFocus
              />
              <p className="text-[11px] text-theme-muted">
                Must match your Plex / Jellyfin / Emby library name to apply overlays automatically.
              </p>
            </div>

            <div className="pt-2 border-t border-theme flex justify-end gap-2">
              <button
                onClick={() => setIsAddLibraryOpen(false)}
                className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLibrary}
                disabled={isAddingLibrary || !newLibraryName.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm disabled:opacity-50 transition-all"
              >
                {isAddingLibrary ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REMOVE LIBRARY SECTION MODAL (MATCHING UI THEME & MULTI-REMOVE) */}
      {/* ========================================================================= */}
      {removeLibraryModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-2xl w-full max-w-md shadow-2xl overflow-hidden space-y-5 p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3.5">
              <div className="p-3 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-theme-text text-base">
                  {removeLibraryModal.librariesToRemove.length === 1
                    ? "Remove Library Section"
                    : `Remove ${removeLibraryModal.librariesToRemove.length} Library Sections`}
                </h3>
                <p className="text-xs text-theme-muted leading-relaxed">
                  {removeLibraryModal.librariesToRemove.length === 1
                    ? `Are you sure you want to remove the library section '${removeLibraryModal.librariesToRemove[0]}' from config.yml?`
                    : `Are you sure you want to remove the following ${removeLibraryModal.librariesToRemove.length} library sections from config.yml?`}
                </p>
              </div>
            </div>

            {removeLibraryModal.librariesToRemove.length > 0 && (
              <div className="p-3 rounded-xl bg-theme-hover/30 border border-theme/60 space-y-1.5 max-h-40 overflow-y-auto">
                <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider block">
                  Sections to be deleted:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {removeLibraryModal.librariesToRemove.map((name) => (
                    <span
                      key={name}
                      className="px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold font-mono"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-theme-muted bg-theme-hover/20 p-3 rounded-xl border border-theme/40">
              <strong className="text-theme-text font-semibold">Note:</strong> A backup of config.yml (config.yml.bak) will be created automatically. Clean original assets on disk remain untouched.
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-theme/60">
              <button
                type="button"
                onClick={() => setRemoveLibraryModal({ isOpen: false, librariesToRemove: [] })}
                disabled={isRemovingLibraries}
                className="px-4 py-2 rounded-xl bg-theme-card hover:bg-theme-hover border border-theme text-theme-text text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveLibraries}
                disabled={isRemovingLibraries}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-lg shadow-red-500/20 disabled:opacity-50"
              >
                {isRemovingLibraries ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>
                  {isRemovingLibraries
                    ? "Removing..."
                    : removeLibraryModal.librariesToRemove.length === 1
                    ? "Remove Library"
                    : `Remove (${removeLibraryModal.librariesToRemove.length}) Libraries`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORT EXISTING YAML ONCE */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-2xl shadow-xl overflow-hidden space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-theme-text text-base">Import YAML to Visual Configurator</h3>
                  <p className="text-xs text-theme-muted">Import existing YAML configs once and translate them into visual UI controls</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">
                  Paste or Browse Config YAML
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-xs font-medium text-theme-text transition-all shadow-sm"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-theme-primary" />
                    <span>Browse File...</span>
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".yml,.yaml,.txt"
                    className="hidden"
                    onChange={handleImportFileSelect}
                  />
                </div>
              </div>

              <textarea
                value={importYamlText}
                onChange={(e) => setImportYamlText(e.target.value)}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      if (typeof ev.target?.result === "string") {
                        setImportYamlText(ev.target.result);
                        showSuccess(`Loaded ${file.name}`);
                      }
                    };
                    reader.readAsText(file);
                  }
                }}
                placeholder={`libraries:
  Movies:
    overlay_files:
      - default: languages
        template_variables:
          languages: [de, en]`}
                className="w-full h-64 bg-theme-bg border border-theme rounded-lg p-3 text-xs font-mono text-theme-text placeholder:text-theme-muted/50 focus:outline-none focus:ring-1 focus:ring-theme-primary resize-none leading-relaxed"
              />
              <p className="text-[11px] text-theme-muted">
                Our translation engine reads your libraries and rules, turning them into visual toggles and position pickers. You won't need to edit YAML ever again!
              </p>
            </div>

            <div className="pt-3 border-t border-theme flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportYamlSubmit}
                disabled={isImportingYaml}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                {isImportingYaml ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Translate into Visual Controls
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD MEDIA LIBRARY */}
      {isAddLibModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-md shadow-2xl overflow-hidden space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-theme-text text-base">Add Media Library</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddLibModalOpen(false)}
                className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Library Name</label>
                <input
                  type="text"
                  value={newLibForm.name}
                  onChange={(e) => setNewLibForm({ ...newLibForm, name: e.target.value })}
                  placeholder="e.g. Movies, TV Shows, Anime"
                  className="w-full bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-medium"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Media Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewLibForm({ ...newLibForm, media_type: "movie" })}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                      newLibForm.media_type === "movie"
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card hover:bg-theme-hover border-theme text-theme-muted"
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Movie Library</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewLibForm({ ...newLibForm, media_type: "show" })}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                      newLibForm.media_type === "show"
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card hover:bg-theme-hover border-theme text-theme-muted"
                    }`}
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>TV Show Library</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-theme flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddLibModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const cleanName = newLibForm.name.trim();
                  if (!cleanName) {
                    showError("Please enter a library name.");
                    return;
                  }
                  setVisualConfig((prev) => {
                    const next = { ...prev.libraries };
                    next[cleanName] = {
                      name: cleanName,
                      media_type: newLibForm.media_type,
                      enabled: true,
                      badges: {
                        resolution: { enabled: false, banner_4k: true, banner_1080p: false, banner_720p: false },
                        audio_languages: { enabled: true, languages: ["de", "en"], position: "bottom-left", offset_x: 30, offset_y: newLibForm.media_type === "show" ? 30 : 35, limit: 5 },
                        runtime: { enabled: true, position: "bottom-right", offset_x: 18, offset_y: 20, back_width: 205, back_height: 80 },
                        status: { enabled: newLibForm.media_type === "show", position: "bottom-center", offset_x: 0, offset_y: 23, font_size: 80, colors: { airing: "#27C24C", returning: "#FFA500", ended: "#FF0000", canceled: "#ED1F1F" } },
                        network: { enabled: false, level: "season", position: "bottom-center", offset_x: 30, offset_y: 50 },
                        rating: { enabled: false, source: "commonsense", position: "bottom-left", offset_x: 255, offset_y: 37, back_width: 230 },
                        anime: { enabled: false, level: "episode" }
                      }
                    };
                    return { ...prev, libraries: next };
                  });
                  setSelectedVisualLib(cleanName);
                  setIsAddLibModalOpen(false);
                  showSuccess(`Added '${cleanName}' to visual configuration!`);
                }}
                className="px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all"
              >
                Create Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: DYNAMIC OVERLAYS SYNC WIZARD */}
      {/* ========================================================================= */}
      {isApplyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme w-full max-w-xl rounded-xl p-6 shadow-2xl flex flex-col space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-theme/60">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <Play className="w-5 h-5 text-theme-primary fill-current" />
                </div>
                <div>
                  <h3 className="font-bold text-theme-text text-base">Apply Overlays to Media Server</h3>
                  <p className="text-xs text-theme-muted mt-0.5">Send overlaid artwork directly to Plex, Jellyfin, or Emby</p>
                </div>
              </div>
              <button
                onClick={() => setIsApplyModalOpen(false)}
                className="p-1 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation banner */}
            <div className="p-3.5 rounded-lg bg-theme-bg border border-theme text-xs text-theme-text space-y-1">
              <div className="font-semibold flex items-center gap-1.5 text-theme-primary">
                <ShieldCheck className="w-3.5 h-3.5 text-theme-primary" />
                Safe & Reversible
              </div>
              <p className="text-theme-muted leading-relaxed">
                Your original artwork files stay clean and untouched in your folders. Overlays are placed on top only when uploading to your media server.
              </p>
            </div>

            {/* Execution Scope Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-theme-primary" />
                What to Sync:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSyncScope("incremental")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    syncScope === "incremental"
                      ? "bg-theme-primary/15 border-theme-primary ring-1 ring-theme-primary text-theme-text"
                      : "bg-theme-hover/40 border-theme hover:bg-theme-hover/70 text-theme-muted"
                  }`}
                >
                  <div className="font-semibold text-xs text-theme-text flex items-center justify-between">
                    <span>Changes Only</span>
                    {syncScope === "incremental" && <Check className="w-3.5 h-3.5 text-theme-primary" />}
                  </div>
                  <div className="text-[11px] text-theme-muted mt-1 leading-relaxed">
                    Only updates new items or items with changed ratings (fastest).
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSyncScope("all")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    syncScope === "all"
                      ? "bg-amber-500/15 border-amber-500 ring-1 ring-amber-500 text-theme-text"
                      : "bg-theme-hover/40 border-theme hover:bg-theme-hover/70 text-theme-muted"
                  }`}
                >
                  <div className="font-semibold text-xs text-theme-text flex items-center justify-between">
                    <span>All Artwork</span>
                    {syncScope === "all" && <Check className="w-3.5 h-3.5 text-amber-500" />}
                  </div>
                  <div className="text-[11px] text-theme-muted mt-1 leading-relaxed">
                    Re-applies and re-uploads overlays to every item in the library.
                  </div>
                </button>
              </div>
            </div>

            {/* Target Server and Library Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider">
                  Target Server
                </label>
                <select
                  value={syncServer}
                  onChange={(e) => setSyncServer(e.target.value)}
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                >
                  <option value="all">All Configured Servers</option>
                  <option value="plex">Plex Media Server</option>
                  <option value="jellyfin">Jellyfin</option>
                  <option value="emby">Emby</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider">
                  Target Library
                </label>
                <select
                  value={syncLibrary}
                  onChange={(e) => setSyncLibrary(e.target.value)}
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3 py-2 text-xs text-theme-text font-medium"
                >
                  <option value="all">All Configured Libraries</option>
                  {Object.keys(scanData?.libraries || {}).map((libName) => (
                    <option key={libName} value={libName}>{libName}</option>
                  ))}
                  {!scanData?.libraries?.PosterizarrTestMovies && (
                    <option value="PosterizarrTestMovies">PosterizarrTestMovies</option>
                  )}
                  {!scanData?.libraries?.PosterizarrTestShows && (
                    <option value="PosterizarrTestShows">PosterizarrTestShows</option>
                  )}
                </select>
              </div>
            </div>

            {/* Running Indicator */}
            {isOverlaySyncRunning && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Dynamic Overlay Sync is currently executing in background...</span>
                </div>
                <button
                  type="button"
                  onClick={handleStopOverlaySync}
                  className="px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 font-bold transition-all flex items-center gap-1.5"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  Stop
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-theme flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-theme-muted font-mono">
                Logs: UILogs/DynamicOverlaysSync.log
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsApplyModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerOverlaySync(syncScope, syncServer, syncLibrary)}
                  disabled={isOverlaySyncRunning}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm disabled:opacity-50 transition-all"
                >
                  {isOverlaySyncRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  {isOverlaySyncRunning ? "Sync in Progress" : "Start Dynamic Overlay Sync Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: ADD / OVERRIDE ANIME CLASSIFICATION */}
      {/* ========================================================================= */}
      {isAddAnimeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-md shadow-2xl overflow-hidden space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-theme pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-theme-primary/10 text-theme-primary border border-theme-primary/20">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-theme-text text-base">Add / Override Anime Classification</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddAnimeModalOpen(false)}
                className="p-1 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpsertAnimeItem} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Anime Show Title</label>
                <input
                  type="text"
                  value={addAnimeForm.title}
                  onChange={(e) => setAddAnimeForm({ ...addAnimeForm, title: e.target.value })}
                  placeholder="e.g. Naruto, Bleach, Attack on Titan"
                  className="w-full bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-medium"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Episode Range</label>
                <input
                  type="text"
                  value={addAnimeForm.episodeRange}
                  onChange={(e) => setAddAnimeForm({ ...addAnimeForm, episodeRange: e.target.value })}
                  placeholder="e.g. 1-24, or 136-220, or 42"
                  className="w-full bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-mono"
                  required
                />
                <p className="text-[10px] text-theme-muted">
                  Use hyphen for range (e.g. <span className="font-mono">1-24</span>) or single number for one episode.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Classification</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "canon", label: "Canon", color: "bg-theme-primary/15 text-theme-primary border-theme-primary/30" },
                    { id: "filler", label: "Filler", color: "bg-red-500/20 text-red-400 border-red-500/40" },
                    { id: "mixed", label: "Mixed", color: "bg-amber-500/20 text-amber-400 border-amber-500/40" }
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAddAnimeForm({ ...addAnimeForm, category: c.id })}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                        addAnimeForm.category === c.id
                          ? `${c.color} ring-1 ring-current`
                          : "bg-theme-card border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-theme-muted uppercase tracking-wider">Episode Title (Optional)</label>
                <input
                  type="text"
                  value={addAnimeForm.episodeTitle}
                  onChange={(e) => setAddAnimeForm({ ...addAnimeForm, episodeTitle: e.target.value })}
                  placeholder="e.g. The Departure"
                  className="w-full bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-medium"
                />
              </div>

              <div className="pt-3 border-t border-theme flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddAnimeModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-xs font-medium text-theme-text transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAnimeItem || !addAnimeForm.title.trim() || !addAnimeForm.episodeRange.trim()}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {isSubmittingAnimeItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Classification
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CLEAR / RESET OVERLAY CACHE CONFIRMATION */}
      {/* ========================================================================= */}
      {isClearCacheModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0 mt-0.5">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-theme-text text-base">Clear Dynamic Overlay Cache?</h3>
                <p className="text-xs text-theme-muted leading-relaxed">
                  This will reset all <strong className="text-theme-text font-semibold">{cacheData?.stats?.total_cached || 0}</strong> recorded overlay pushes across all media servers.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-theme-hover/40 border border-theme text-xs text-theme-muted space-y-1.5">
              <div className="flex items-center gap-1.5 text-theme-text font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Original Assets Are Safe</span>
              </div>
              <p className="leading-relaxed">
                Your clean original artwork files in your library folders remain completely untouched. On the next sync run, Posterizarr will re-composite and re-push fresh overlays to your media servers.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-theme/60">
              <button
                type="button"
                onClick={() => setIsClearCacheModalOpen(false)}
                disabled={isClearingOverlayCache}
                className="px-4 py-2 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeClearOverlayCache}
                disabled={isClearingOverlayCache}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                {isClearingOverlayCache ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {isClearingOverlayCache ? "Clearing Cache..." : "Yes, Clear Cache"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: OVERLAY CACHE BROWSER */}
      {/* ========================================================================= */}
      {isOverlayCacheModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-theme flex items-start sm:items-center justify-between gap-4 bg-theme-card">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-theme-text">Overlay Cache Browser</h2>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-theme-primary/10 text-theme-primary border border-theme-primary/30">
                      {overlayCacheTotal} Cached Items
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted mt-0.5">
                    Browse all overlaid assets pushed to your media servers. Delete an item to force re-rendering on next sync.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsClearCacheModalOpen(true)}
                  disabled={isClearingOverlayCache || overlayCacheTotal === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all disabled:opacity-40"
                  title="Clear all cached overlay records"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsOverlayCacheModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-all shrink-0"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="p-4 bg-theme-bg/60 border-b border-theme flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
              <div className="flex-1 flex items-center gap-2 relative">
                <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={overlayCacheSearch}
                  onChange={(e) => setOverlayCacheSearch(e.target.value)}
                  placeholder="Search by title, item ID, library, or file path..."
                  className="w-full bg-theme-bg border border-theme rounded-lg pl-9 pr-8 py-2 text-xs text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-primary transition-all font-medium"
                />
                {overlayCacheSearch && (
                  <button
                    type="button"
                    onClick={() => setOverlayCacheSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Server Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Server:</span>
                {["all", "plex", "emby", "jellyfin"].map((srv) => (
                  <button
                    key={srv}
                    type="button"
                    onClick={() => {
                      setOverlayCacheServer(srv);
                      setOverlayCachePage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize border transition-all ${
                      overlayCacheServer === srv
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {srv}
                  </button>
                ))}
              </div>

              {/* Asset Type Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Type:</span>
                {[
                  { id: "all", label: "All" },
                  { id: "poster", label: "Posters" },
                  { id: "backdrop", label: "Backdrops" },
                  { id: "season", label: "Seasons" },
                  { id: "titlecard", label: "Titlecards" }
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setOverlayCacheAssetType(t.id);
                      setOverlayCachePage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      overlayCacheAssetType === t.id
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => fetchOverlayCacheItems(overlayCachePage)}
                  disabled={overlayCacheLoading}
                  className="p-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-all ml-1 disabled:opacity-50 shadow-sm"
                  title="Refresh list"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${overlayCacheLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto bg-theme-bg/20">
              {overlayCacheLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-theme-muted">
                  <Loader2 className="w-8 h-8 animate-spin text-theme-primary" />
                  <span className="text-xs">Loading overlay cache records...</span>
                </div>
              ) : overlayCacheItems.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2 text-center text-theme-muted px-4">
                  <Database className="w-10 h-10 text-theme-muted/50 mb-1" />
                  <span className="text-sm font-semibold text-theme-text">No cached overlay records found</span>
                  <p className="text-xs text-theme-muted max-w-sm">
                    {overlayCacheSearch || overlayCacheServer !== "all" || overlayCacheAssetType !== "all"
                      ? "Try adjusting your search query or filter pills."
                      : "Items will appear here automatically when dynamic overlays are rendered and pushed to your media server."}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-theme-bg text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme sticky top-0 z-10 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Server</th>
                      <th className="py-3 px-4">Item & Library</th>
                      <th className="py-3 px-4">Asset Type</th>
                      <th className="py-3 px-4">Source Asset & Recipe</th>
                      <th className="py-3 px-4">Detected Stream Meta</th>
                      <th className="py-3 px-4">Last Pushed</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme/40 text-theme-text">
                    {overlayCacheItems.map((entry) => {
                      const serverLower = (entry.server_type || "").toLowerCase();
                      const serverPill =
                        serverLower === "plex"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : serverLower === "emby"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : serverLower === "jellyfin"
                          ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                          : "bg-blue-500/15 text-blue-400 border-blue-500/30";

                      const assetLower = (entry.asset_type || "poster").toLowerCase();
                      const assetPill =
                        assetLower === "poster"
                          ? "bg-theme-primary/10 text-theme-primary border-theme-primary/20"
                          : assetLower === "backdrop" || assetLower === "background"
                          ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/20"
                          : assetLower === "season"
                          ? "bg-teal-500/10 text-teal-300 border-teal-500/20"
                          : "bg-pink-500/10 text-pink-300 border-pink-500/20";

                      const isDeleting = deletingOverlayCacheId === entry.id;

                      return (
                        <tr key={entry.id} className="hover:bg-theme-hover/30 transition-colors">
                          <td className="py-3 px-4 align-middle">
                            <span className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] border tracking-wider ${serverPill}`}>
                              {entry.server_type}
                            </span>
                          </td>
                          <td className="py-3 px-4 align-middle">
                            <div className="font-semibold text-theme-text text-xs max-w-xs truncate" title={entry.item_title || entry.item_id}>
                              {entry.item_title || `Item ${entry.item_id}`}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-theme-muted">
                              {entry.library_name && (
                                <span className="px-1.5 py-0.2 rounded bg-theme-bg border border-theme text-theme-text text-[10px]">
                                  {entry.library_name}
                                </span>
                              )}
                              <span className="font-mono text-theme-muted text-[10px]">ID: {entry.item_id}</span>
                              {entry.media_type && (
                                <span className="capitalize text-theme-muted text-[10px]">• {entry.media_type}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 align-middle">
                            <span className={`px-2 py-0.5 rounded-md font-semibold text-[11px] border capitalize ${assetPill}`}>
                              {entry.asset_type}
                            </span>
                          </td>
                          <td className="py-3 px-4 align-middle text-theme-muted">
                            {entry.clean_asset_path ? (
                              <div
                                className="font-mono text-[11px] text-theme-text max-w-xs truncate hover:text-theme-primary transition-colors"
                                title={entry.clean_asset_path}
                              >
                                {entry.clean_asset_path.split(/[\\/]/).pop()}
                              </div>
                            ) : (
                              <span className="text-theme-muted italic text-[11px]">Server original</span>
                            )}
                            <div className="text-[10px] text-theme-muted font-mono mt-0.5">
                              Recipe: {entry.overlay_recipe_hash ? entry.overlay_recipe_hash.substring(0, 10) : "default"}
                            </div>
                          </td>
                          <td className="py-3 px-4 align-middle text-theme-text">
                            <div className="flex flex-wrap items-center gap-1.5 max-w-xs">
                              {entry.detected_languages ? (
                                <span className="px-1.5 py-0.5 rounded bg-theme-bg border border-theme text-theme-text font-mono text-[10px]" title="Detected Audio Languages">
                                  {entry.detected_languages.toUpperCase()}
                                </span>
                              ) : null}
                              {entry.edition ? (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-semibold" title="Detected Edition / Cut">
                                  {entry.edition}
                                </span>
                              ) : null}
                              {entry.runtime_mins ? (
                                <span className="px-1.5 py-0.5 rounded bg-theme-bg border border-theme text-theme-muted font-mono text-[10px]" title="Runtime">
                                  {entry.runtime_mins}m
                                </span>
                              ) : null}
                              {entry.show_status ? (
                                <span className="px-1.5 py-0.5 rounded bg-theme-primary/10 border border-theme-primary/30 text-theme-primary capitalize text-[10px]" title="Show Status">
                                  {entry.show_status}
                                </span>
                              ) : null}
                              {!entry.detected_languages && !entry.edition && !entry.runtime_mins && !entry.show_status && (
                                <span className="text-theme-muted text-[10px] italic">Standard (clean)</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 align-middle text-theme-muted text-xs">
                            {entry.last_pushed_at ? (
                              <div>
                                <div className="text-theme-text">{new Date(entry.last_pushed_at).toLocaleDateString()}</div>
                                <div className="text-[10px] text-theme-muted">{new Date(entry.last_pushed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-3 px-4 align-middle text-center">
                            <span className="px-2 py-0.5 rounded-full bg-theme-primary/10 text-theme-primary border border-theme-primary/30 font-semibold text-[10px]">
                              {entry.status || "synced"}
                            </span>
                          </td>
                          <td className="py-3 px-4 align-middle text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteOverlayCacheEntry(entry)}
                              disabled={isDeleting}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400 transition-all border border-transparent hover:border-red-500/30 disabled:opacity-50"
                              title="Delete from cache (forces re-composite on next sync)"
                            >
                              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin text-red-400" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Footer */}
            <div className="p-3.5 bg-theme-card border-t border-theme flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-theme-muted">
              <div className="flex items-center gap-2">
                <span>
                  Showing{" "}
                  <strong className="text-theme-text">
                    {overlayCacheTotal === 0 ? 0 : (overlayCachePage - 1) * overlayCacheLimit + 1}
                  </strong>{" "}
                  to{" "}
                  <strong className="text-theme-text">
                    {Math.min(overlayCachePage * overlayCacheLimit, overlayCacheTotal)}
                  </strong>{" "}
                  of <strong className="text-theme-text">{overlayCacheTotal}</strong> items
                </span>

                <div className="flex items-center gap-1 ml-3 border-l border-theme pl-3">
                  <span className="text-theme-muted text-[11px]">Rows:</span>
                  {[25, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setOverlayCacheLimit(num);
                        setOverlayCachePage(1);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                        overlayCacheLimit === num
                          ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                          : "bg-theme-bg border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchOverlayCacheItems(overlayCachePage - 1)}
                  disabled={overlayCachePage <= 1 || overlayCacheLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-text disabled:opacity-40 disabled:pointer-events-none transition-all font-medium text-xs shadow-sm"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <span className="px-2 text-theme-muted font-medium">
                  Page <strong className="text-theme-text">{overlayCachePage}</strong> of{" "}
                  <strong className="text-theme-text">{overlayCacheTotalPages}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => fetchOverlayCacheItems(overlayCachePage + 1)}
                  disabled={overlayCachePage >= overlayCacheTotalPages || overlayCacheLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-text disabled:opacity-40 disabled:pointer-events-none transition-all font-medium text-xs shadow-sm"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: RATINGS CACHE & AUTO-REFRESH BROWSER */}
      {/* ========================================================================= */}
      {isRatingsCacheModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-theme flex items-start sm:items-center justify-between gap-4 bg-theme-card">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-theme-text">Ratings Cache & Auto-Refresh Browser</h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-theme-primary/10 text-theme-primary border border-theme-primary/30">
                      {ratingsCacheStatsSummary.total || ratingsCacheTotal} Total
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-theme-bg border border-theme text-theme-text">
                      {ratingsCacheStatsSummary.valid} Valid
                    </span>
                    {Boolean(ratingsCacheStatsSummary.expired) && (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                        {ratingsCacheStatsSummary.expired} Expired
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-theme-muted mt-0.5">
                    Multi-source ratings cache for IMDb, TMDb, Rotten Tomatoes, Trakt, and Letterboxd with automatic TTL refresh.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRatingsCacheModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-all shrink-0"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="p-4 bg-theme-bg/60 border-b border-theme flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
              <div className="flex-1 flex items-center gap-2 relative">
                <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={ratingsCacheSearch}
                  onChange={(e) => setRatingsCacheSearch(e.target.value)}
                  placeholder="Search by title, year, IMDb ID (tt...), or TMDb ID..."
                  className="w-full bg-theme-bg border border-theme rounded-lg pl-9 pr-8 py-2 text-xs text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-primary transition-all font-medium"
                />
                {ratingsCacheSearch && (
                  <button
                    type="button"
                    onClick={() => setRatingsCacheSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Status:</span>
                {[
                  { id: "all", label: "All" },
                  { id: "valid", label: "Valid Only" },
                  { id: "expired", label: "Expired" }
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setRatingsCacheStatus(s.id);
                      setRatingsCachePage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      ratingsCacheStatus === s.id
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Server Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Server:</span>
                {["all", "plex", "emby", "jellyfin"].map((srv) => (
                  <button
                    key={srv}
                    type="button"
                    onClick={() => {
                      setRatingsCacheServer(srv);
                      setRatingsCachePage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize border transition-all ${
                      ratingsCacheServer === srv
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {srv}
                  </button>
                ))}
              </div>

              {/* Media Type Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Type:</span>
                {[
                  { id: "all", label: "All" },
                  { id: "movie", label: "Movies" },
                  { id: "show", label: "Shows" }
                ].map((mt) => (
                  <button
                    key={mt.id}
                    type="button"
                    onClick={() => {
                      setRatingsCacheMediaType(mt.id);
                      setRatingsCachePage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      ratingsCacheMediaType === mt.id
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {mt.label}
                  </button>
                ))}
              </div>

              {/* Series Status Filter */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mr-1">Show Status:</span>
                {[
                  { id: "all", label: "All" },
                  { id: "ended", label: "Ended" },
                  { id: "returning", label: "Returning" },
                  { id: "canceled", label: "Canceled" },
                  { id: "airing", label: "Airing" }
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      setRatingsCacheShowStatus(st.id);
                      setRatingsCachePage(1);
                    }}
                    className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      ratingsCacheShowStatus === st.id
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                        : "bg-theme-card border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => fetchRatingsCacheItems(ratingsCachePage)}
                  disabled={ratingsCacheLoading}
                  className="p-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-all ml-1 disabled:opacity-50 shadow-sm"
                  title="Refresh list"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ratingsCacheLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto bg-theme-bg/20">
              {ratingsCacheLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-theme-muted">
                  <Loader2 className="w-8 h-8 animate-spin text-theme-primary" />
                  <span className="text-xs">Loading ratings cache entries...</span>
                </div>
              ) : ratingsCacheItems.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2 text-center text-theme-muted px-4">
                  <Sparkles className="w-10 h-10 text-theme-muted/50 mb-1" />
                  <span className="text-sm font-semibold text-theme-text">No cached ratings found</span>
                  <p className="text-xs text-theme-muted max-w-sm">
                    {ratingsCacheSearch || ratingsCacheServer !== "all" || ratingsCacheStatus !== "all" || ratingsCacheShowStatus !== "all" || ratingsCacheMediaType !== "all"
                      ? "Try adjusting your search query or filters."
                      : "Ratings will be cached here automatically from Plex, TMDb, or MDBList as overlays are synchronized."}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-theme-bg text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme sticky top-0 z-10 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Title & Identifiers</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Cached Rating Scores</th>
                      <th className="py-3 px-4">Source</th>
                      <th className="py-3 px-4">Cache Expiration</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme/40 text-theme-text">
                    {ratingsCacheItems.map((entry) => {
                      const serverLower = (entry.server_type || "").toLowerCase();
                      const serverPill =
                        serverLower === "plex"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : serverLower === "emby"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : serverLower === "jellyfin"
                          ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                          : "bg-blue-500/15 text-blue-400 border-blue-500/30";

                      const isActing = actionRatingCacheId === entry.id;

                      const hasAnyRating =
                        entry.imdb_rating !== null ||
                        entry.tmdb_rating !== null ||
                        entry.rt_critic_rating !== null ||
                        entry.rt_audience_rating !== null ||
                        entry.trakt_rating !== null ||
                        entry.metacritic_rating !== null ||
                        entry.letterboxd_rating !== null;

                      return (
                        <tr key={entry.id} className="hover:bg-theme-hover/30 transition-colors">
                          <td className="py-3 px-4 align-middle">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-theme-text text-xs">
                                {entry.title || `Item ${entry.item_id}`}
                              </span>
                              {entry.year && (
                                <span className="text-theme-muted text-xs font-normal">({entry.year})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-theme-muted flex-wrap">
                              <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] border tracking-wider ${serverPill}`}>
                                {entry.server_type}
                              </span>
                              <span className="font-mono text-theme-muted text-[10px]">ID: {entry.item_id}</span>
                              {entry.imdb_id && (
                                <a
                                  href={`https://www.imdb.com/title/${entry.imdb_id}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-mono hover:bg-amber-500/20 transition-colors"
                                >
                                  {entry.imdb_id}
                                  <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                                </a>
                              )}
                              {entry.tmdb_id && (
                                <span className="px-1.5 py-0.2 rounded bg-theme-bg border border-theme text-theme-muted text-[10px] font-mono">
                                  TMDb: {entry.tmdb_id}
                                </span>
                              )}
                              {entry.content_rating && (
                                <span className="px-1.5 py-0.2 rounded bg-theme-bg border border-theme text-theme-text text-[10px] font-semibold tracking-wide">
                                  {entry.content_rating}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 align-middle">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="px-2 py-0.5 rounded-md font-semibold text-[11px] border capitalize bg-theme-bg text-theme-text border-theme">
                                {entry.media_type || "movie"}
                              </span>
                              {entry.show_status && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                                    entry.show_status === "ended"
                                      ? "bg-theme-bg text-theme-muted border-theme"
                                      : entry.show_status === "returning"
                                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                      : entry.show_status === "canceled"
                                      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                      : entry.show_status === "airing"
                                      ? "bg-theme-primary/10 text-theme-primary border-theme-primary/30"
                                      : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                  }`}
                                >
                                  {entry.show_status}
                                </span>
                              )}
                              {entry.network && (
                                <span className="text-[10px] text-theme-muted font-medium truncate max-w-[120px]" title={entry.network}>
                                  {entry.network}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 align-middle">
                            {hasAnyRating ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {entry.imdb_rating !== null && entry.imdb_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/10 text-amber-300 border border-amber-400/30 text-[11px] font-bold">
                                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                    {Number(entry.imdb_rating).toFixed(1)}
                                  </span>
                                )}
                                {entry.tmdb_rating !== null && entry.tmdb_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-400/10 text-emerald-300 border border-emerald-400/30 text-[11px] font-bold">
                                    <span className="text-[10px]">TMDb</span>
                                    {Number(entry.tmdb_rating).toFixed(1)}
                                  </span>
                                )}
                                {entry.rt_critic_rating !== null && entry.rt_critic_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[11px] font-bold" title="Rotten Tomatoes Critic">
                                    <span>🍅</span>
                                    {entry.rt_critic_rating}%
                                  </span>
                                )}
                                {entry.rt_audience_rating !== null && entry.rt_audience_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-400/10 text-orange-300 border border-orange-400/30 text-[11px] font-bold" title="Rotten Tomatoes Audience">
                                    <span>🍿</span>
                                    {entry.rt_audience_rating}%
                                  </span>
                                )}
                                {entry.trakt_rating !== null && entry.trakt_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-[11px] font-bold" title="Trakt">
                                    <span className="text-[10px]">Trakt</span>
                                    {Number(entry.trakt_rating).toFixed(1)}
                                  </span>
                                )}
                                {entry.metacritic_rating !== null && entry.metacritic_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-400/10 text-yellow-300 border border-yellow-400/30 text-[11px] font-bold" title="Metacritic">
                                    <span className="text-[10px]">MC</span>
                                    {entry.metacritic_rating}
                                  </span>
                                )}
                                {entry.letterboxd_rating !== null && entry.letterboxd_rating !== undefined && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 text-green-300 border border-green-500/30 text-[11px] font-bold" title="Letterboxd">
                                    <span className="text-[10px]">LB</span>
                                    {Number(entry.letterboxd_rating).toFixed(1)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-theme-muted italic text-[11px]">No scores recorded</span>
                            )}
                          </td>

                          <td className="py-3 px-4 align-middle">
                            <span className="px-2 py-0.5 rounded-md font-mono text-[10px] uppercase bg-theme-bg text-theme-muted border border-theme">
                              {entry.source || "plex"}
                            </span>
                          </td>

                          <td className="py-3 px-4 align-middle">
                            {entry.is_expired ? (
                              <div className="flex items-center gap-1 text-red-400 font-semibold text-[11px]">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>Expired (Refresh Due)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-theme-primary font-semibold text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Valid</span>
                              </div>
                            )}
                            <div className="text-[10px] text-theme-muted mt-0.5">
                              Expires: {entry.expires_at ? new Date(entry.expires_at).toLocaleDateString() : "—"}
                            </div>
                          </td>

                          <td className="py-3 px-4 align-middle text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleExpireRatingsCacheEntry(entry)}
                                disabled={isActing}
                                className="p-1.5 rounded-lg hover:bg-amber-500/10 text-theme-muted hover:text-amber-400 transition-all border border-transparent hover:border-amber-500/30 disabled:opacity-50"
                                title="Expire rating now (Forces fresh API query on next sync)"
                              >
                                {isActing ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> : <RotateCcw className="w-4 h-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRatingsCacheEntry(entry)}
                                disabled={isActing}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400 transition-all border border-transparent hover:border-red-500/30 disabled:opacity-50"
                                title="Delete rating from cache completely"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Footer */}
            <div className="p-3.5 bg-theme-card border-t border-theme flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-theme-muted">
              <div className="flex items-center gap-2">
                <span>
                  Showing{" "}
                  <strong className="text-theme-text">
                    {ratingsCacheTotal === 0 ? 0 : (ratingsCachePage - 1) * ratingsCacheLimit + 1}
                  </strong>{" "}
                  to{" "}
                  <strong className="text-theme-text">
                    {Math.min(ratingsCachePage * ratingsCacheLimit, ratingsCacheTotal)}
                  </strong>{" "}
                  of <strong className="text-theme-text">{ratingsCacheTotal}</strong> ratings
                </span>

                <div className="flex items-center gap-1 ml-3 border-l border-theme pl-3">
                  <span className="text-theme-muted text-[11px]">Rows:</span>
                  {[25, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setRatingsCacheLimit(num);
                        setRatingsCachePage(1);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                        ratingsCacheLimit === num
                          ? "bg-theme-primary text-white border-theme-primary shadow-sm"
                          : "bg-theme-bg border-theme text-theme-muted hover:text-theme-text"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchRatingsCacheItems(ratingsCachePage - 1)}
                  disabled={ratingsCachePage <= 1 || ratingsCacheLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-text disabled:opacity-40 disabled:pointer-events-none transition-all font-medium text-xs shadow-sm"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <span className="px-2 text-theme-muted font-medium">
                  Page <strong className="text-theme-text">{ratingsCachePage}</strong> of{" "}
                  <strong className="text-theme-text">{ratingsCacheTotalPages}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => fetchRatingsCacheItems(ratingsCachePage + 1)}
                  disabled={ratingsCachePage >= ratingsCacheTotalPages || ratingsCacheLoading}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover text-theme-text disabled:opacity-40 disabled:pointer-events-none transition-all font-medium text-xs shadow-sm"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: FAST MEDIA CHANGE AUTODETECTION RESULTS */}
      {/* ========================================================================= */}
      {isChangeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-theme flex items-start sm:items-center justify-between gap-4 bg-theme-card">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-theme-text">
                      Detected Changes
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-theme-primary/10 text-theme-primary border border-theme-primary/30">
                      {changeDetectionReport?.changed_count ?? 0} Changed
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-theme-bg text-theme-muted border border-theme">
                      {changeDetectionReport?.unchanged_count ?? 0} Up to Date
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-theme-bg text-theme-muted border border-theme">
                      {changeDetectionReport?.total_scanned ?? 0} Scanned
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted mt-0.5">
                    Media items with updated audio streams, cuts, runtimes, or newly added files.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsChangeModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-all shrink-0"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="p-4 bg-theme-bg/60 border-b border-theme flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
              <div className="flex-1 flex items-center gap-2 relative">
                <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={changeSearchQuery}
                  onChange={(e) => setChangeSearchQuery(e.target.value)}
                  placeholder="Filter by title, library, server, or change details..."
                  className="w-full bg-theme-bg border border-theme rounded-lg pl-9 pr-8 py-2 text-xs text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-primary transition-all font-medium"
                />
                {changeSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setChangeSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={changeFilterType}
                  onChange={(e) => setChangeFilterType(e.target.value)}
                  className="bg-theme-bg border border-theme rounded-lg px-3 py-2 text-xs text-theme-text font-medium focus:outline-none cursor-pointer"
                >
                  <option value="all">All Change Types</option>
                  <option value="languages">Audio Languages (Flag/Stream)</option>
                  <option value="edition">Cut / Edition Upgrades</option>
                  <option value="runtime">Runtime / Duration</option>
                  <option value="status">TV Show Status</option>
                  <option value="new">Newly Added Media</option>
                  <option value="asset_modified">Base Artwork Modified</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleDetectChanges()}
                  disabled={isDetectingChanges}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-theme-card hover:bg-theme-hover text-theme-text border border-theme hover:border-theme-primary/50 text-xs font-medium transition-all shadow-sm disabled:opacity-50"
                  title="Re-run bulk scan"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDetectingChanges ? "animate-spin text-theme-primary" : ""}`} />
                  Re-Scan
                </button>
              </div>
            </div>

            {/* Change List Table */}
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const changes = (changeDetectionReport?.changes || []).filter((item) => {
                  const q = changeSearchQuery.trim().toLowerCase();
                  const matchesQuery = !q || (
                    (item.title && item.title.toLowerCase().includes(q)) ||
                    (item.library && item.library.toLowerCase().includes(q)) ||
                    (item.server_type && item.server_type.toLowerCase().includes(q)) ||
                    (item.details && item.details.toLowerCase().includes(q))
                  );
                  const matchesType = changeFilterType === "all" || (item.change_types || []).includes(changeFilterType);
                  return matchesQuery && matchesType;
                });

                if (changes.length === 0) {
                  return (
                    <div className="p-12 text-center text-slate-400 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <div className="font-bold text-white text-sm">
                        {changeDetectionReport?.changed_count === 0
                          ? "All media items are completely current!"
                          : "No items match your active search filters."}
                      </div>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        {changeDetectionReport?.changed_count === 0
                          ? `All ${changeDetectionReport?.total_scanned ?? 0} items match the active dynamic overlay cache. No audio language updates, cuts, or runtime shifts were detected.`
                          : "Try clearing your search query or changing the filter type."}
                      </p>
                    </div>
                  );
                }

                return (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-theme-bg sticky top-0 text-theme-muted uppercase tracking-wider text-[11px] border-b border-theme font-semibold">
                      <tr>
                        <th className="py-3 px-4">Server</th>
                        <th className="py-3 px-4">Media Item / Library</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Detected Updates</th>
                        <th className="py-3 px-4">Detailed Differences</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme/40 text-theme-text">
                      {changes.map((item, idx) => (
                        <tr key={idx} className="hover:bg-theme-hover/30 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold uppercase text-[11px] text-theme-primary">
                            {item.server_type}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-theme-text text-xs">{item.title}</div>
                            <div className="text-[11px] text-theme-muted mt-0.5">{item.library}</div>
                          </td>
                          <td className="py-3 px-4 capitalize text-theme-muted font-medium">
                            {item.media_type}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(item.change_types || []).map((ct, cIdx) => {
                                let badgeClass = "bg-theme-bg text-theme-muted border-theme";
                                let label = ct;
                                if (ct === "languages") {
                                  badgeClass = "bg-theme-primary/10 text-theme-primary border-theme-primary/30";
                                  label = "Audio Languages";
                                } else if (ct === "edition") {
                                  badgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/40";
                                  label = "Cut / Edition";
                                } else if (ct === "runtime") {
                                  badgeClass = "bg-blue-500/20 text-blue-300 border-blue-500/40";
                                  label = "Runtime";
                                } else if (ct === "status") {
                                  badgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
                                  label = "Show Status";
                                } else if (ct === "new") {
                                  badgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
                                  label = "New Item";
                                } else if (ct === "asset_modified") {
                                  badgeClass = "bg-orange-500/20 text-orange-300 border-orange-500/40";
                                  label = "Base Art Changed";
                                }
                                return (
                                  <span key={cIdx} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeClass}`}>
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-theme-text max-w-md">
                            <div className="leading-relaxed whitespace-pre-wrap">{item.details}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-theme-card border-t border-theme flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="text-theme-muted">
                Found <strong className="text-theme-text">{changeDetectionReport?.changed_count ?? 0}</strong> modified items across libraries.
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsChangeModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-theme-card hover:bg-theme-hover border border-theme text-theme-text text-xs font-medium transition-all shadow-sm"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleSyncChangedOnly()}
                  disabled={isSyncingChanged || isOverlaySyncRunning || (changeDetectionReport?.changed_count || 0) === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {isSyncingChanged ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {isSyncingChanged
                    ? "Starting Sync..."
                    : `Sync Changed Items (${changeDetectionReport?.changed_count ?? 0})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ONBOARDING SETUP WIZARD */}
      {/* ========================================================================= */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-theme-card border border-theme w-full max-w-2xl rounded-2xl p-5 sm:p-6 shadow-2xl flex flex-col space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-theme/60">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-theme-primary/20 to-amber-500/20 border border-theme-primary/30 text-theme-primary">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-theme-text text-base sm:text-lg">Dynamic Overlays Setup Guide</h3>
                  <p className="text-xs text-theme-muted">
                    {wizardStep === 1 && "Step 1 of 4: How it works"}
                    {wizardStep === 2 && "Step 2 of 4: Choose your setup"}
                    {wizardStep === 3 && "Step 3 of 4: Customizing your badges"}
                    {wizardStep === 4 && "Step 4 of 4: Sending to your server"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWizardOpen(false)}
                className="p-1.5 rounded-xl text-theme-muted hover:text-theme-text hover:bg-theme-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step Progress Indicator */}
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
              {[
                { step: 1, label: "How It Works", icon: ShieldCheck },
                { step: 2, label: "Setup", icon: Zap },
                { step: 3, label: "Customize", icon: Eye },
                { step: 4, label: "Send to Server", icon: RefreshCw }
              ].map((s) => {
                const StepIcon = s.icon;
                const isCurrent = wizardStep === s.step;
                const isDone = wizardStep > s.step;
                return (
                  <button
                    key={s.step}
                    type="button"
                    onClick={() => setWizardStep(s.step)}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border ${
                      isCurrent
                        ? "bg-theme-primary text-white border-theme-primary shadow-sm ring-1 ring-theme-primary"
                        : isDone
                        ? "bg-theme-primary/10 text-theme-primary border-theme-primary/30 hover:bg-theme-primary/20"
                        : "bg-theme-hover/40 border-theme text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-3.5 h-3.5 text-theme-primary" />
                    ) : (
                      <StepIcon className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden font-mono">{s.step}</span>
                  </button>
                );
              })}
            </div>

            {/* STEP 1: How it works */}
            {wizardStep === 1 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-gradient-to-r from-theme-primary/10 via-theme-bg to-theme-hover/20 border border-theme space-y-1.5">
                  <span className="text-xs font-bold text-theme-primary uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    Safe & Non-Destructive
                  </span>
                  <h4 className="text-sm font-bold text-theme-text">
                    Your original posters and files on disk are never changed
                  </h4>
                  <p className="text-xs text-theme-muted leading-relaxed">
                    Posterizarr adds badges (such as 4K resolution, ratings, languages, or runtime) directly when sending artwork to your media server. Your original downloaded posters, titlecards, and backgrounds remain completely clean.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <div className="p-1 rounded bg-theme-primary/20 text-theme-primary">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <span>Easy to Turn Off</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      You can turn badges on or off anytime. If you decide you do not want an overlay anymore, your artwork remains untouched.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <div className="p-1 rounded bg-amber-500/20 text-amber-400">
                        <Zap className="w-3.5 h-3.5" />
                      </div>
                      <span>All in One Tool</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Everything runs directly inside Posterizarr. You do not need to install or run separate software like Kometa.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <div className="p-1 rounded bg-blue-500/20 text-blue-400">
                        <Server className="w-3.5 h-3.5" />
                      </div>
                      <span>Works with Your Server</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Sends artwork directly to Plex, Jellyfin, or Emby using the server connection you already set up.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <div className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                        <Database className="w-3.5 h-3.5" />
                      </div>
                      <span>Fast Updates</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Posterizarr remembers what was already updated, so future updates only take a few seconds.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Presets OR Direct Kometa Multi-Upload */}
            {wizardStep === 2 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Mode Selector Tabs */}
                <div className="flex p-1 rounded-xl bg-theme-hover/40 border border-theme text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setWizardConfigMode("presets")}
                    className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all ${
                      wizardConfigMode === "presets"
                        ? "bg-theme-card text-theme-text font-bold shadow-sm border border-theme"
                        : "text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Recommended Presets</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardConfigMode("upload")}
                    className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all ${
                      wizardConfigMode === "upload"
                        ? "bg-theme-card text-theme-text font-bold shadow-sm border border-theme"
                        : "text-theme-muted hover:text-theme-text"
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-theme-primary" />
                    <span>Import Existing Files</span>
                  </button>
                </div>

                {/* Sub-Mode A: Presets */}
                {wizardConfigMode === "presets" && (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div className="p-4 rounded-xl bg-theme-hover/20 border border-theme space-y-1">
                      <h4 className="text-sm font-bold text-theme-text">Start with popular badge layouts</h4>
                      <p className="text-xs text-theme-muted leading-relaxed">
                        If you are starting fresh, you can apply our recommended badges for your libraries below. You can customize, move, or disable any badge at any time.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="p-3.5 rounded-xl bg-theme-card border border-theme space-y-2">
                        <div className="flex items-center gap-2 font-bold text-theme-text">
                          <Film className="w-4 h-4 text-theme-primary" />
                          <span>Movie Libraries</span>
                        </div>
                        <ul className="text-theme-muted space-y-1 text-[11px]">
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>4K resolution badge in the corner</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Ratings (IMDb, TMDb, Rotten Tomatoes)</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Movie runtime (e.g. 1h 58m)</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Age rating (e.g. PG-13, FSK 16)</span>
                          </li>
                        </ul>
                      </div>

                      <div className="p-3.5 rounded-xl bg-theme-card border border-theme space-y-2">
                        <div className="flex items-center gap-2 font-bold text-theme-text">
                          <Tv className="w-4 h-4 text-theme-primary" />
                          <span>TV Show Libraries</span>
                        </div>
                        <ul className="text-theme-muted space-y-1 text-[11px]">
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Show status (Airing, Returning, Ended)</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>TV Network logo (HBO, Netflix, etc.)</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Episode runtime on titlecards</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>4K badge on titlecards</span>
                          </li>
                        </ul>
                      </div>

                      <div className="p-3.5 rounded-xl bg-theme-card border border-theme space-y-2">
                        <div className="flex items-center gap-2 font-bold text-theme-text">
                          <ImageIcon className="w-4 h-4 text-theme-primary" />
                          <span>Background Art (16:9)</span>
                        </div>
                        <ul className="text-theme-muted space-y-1 text-[11px]">
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Rating scores with source logos</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>IMDb, Rotten Tomatoes, and TMDb</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Dark contrast box for clear text</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Uses your media server ratings</span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-theme-hover/30 border border-theme flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div>
                        <span className="font-semibold text-xs text-theme-text block">Apply Recommended Presets</span>
                        <span className="text-[11px] text-theme-muted">Sets up popular badges for your media libraries in one click.</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await handleQuickStart();
                          setWizardQuickStartDone(true);
                        }}
                        disabled={isQuickStarting}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm ${
                          wizardQuickStartDone
                            ? "bg-emerald-600 text-white"
                            : "bg-theme-primary hover:bg-theme-primary/90 text-white"
                        } disabled:opacity-50`}
                      >
                        {isQuickStarting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Applying Presets...</span>
                          </>
                        ) : wizardQuickStartDone ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Presets Applied!</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            <span>Apply Presets</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-Mode B: Direct Multi-Config Upload */}
                {wizardConfigMode === "upload" && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="p-4 rounded-xl bg-theme-hover/20 border border-theme space-y-1">
                      <h4 className="text-sm font-bold text-theme-text flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-theme-primary" />
                        <span>Import existing Kometa or PMM files</span>
                      </h4>
                      <p className="text-xs text-theme-muted leading-relaxed">
                        Already have YAML configuration files from Kometa or Plex Meta Manager? Drop them here (such as <code className="text-theme-primary font-mono font-semibold">config.yml</code> or <code className="text-theme-primary font-mono font-semibold">overlays_movies.yml</code>) to load them into the visual editor.
                      </p>
                    </div>

                    <div
                      className="border-2 border-dashed border-theme hover:border-theme-primary/60 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-theme-card hover:bg-theme-hover/20 group"
                      onClick={() => wizardFileInputRef.current && wizardFileInputRef.current.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          handleWizardMultiUpload({ target: { files: e.dataTransfer.files } });
                        }
                      }}
                    >
                      <input
                        ref={wizardFileInputRef}
                        type="file"
                        multiple
                        accept=".yml,.yaml"
                        className="hidden"
                        onChange={handleWizardMultiUpload}
                      />
                      <div className="p-3.5 rounded-2xl bg-theme-primary/10 text-theme-primary group-hover:scale-110 transition-transform mb-3">
                        {isWizardUploading ? (
                          <Loader2 className="w-6 h-6 animate-spin text-theme-primary" />
                        ) : (
                          <Upload className="w-6 h-6 text-theme-primary" />
                        )}
                      </div>
                      <span className="text-sm font-bold text-theme-text group-hover:text-theme-primary transition-colors">
                        {isWizardUploading ? "Reading and loading files..." : "Select or Drop YAML Files Here"}
                      </span>
                      <span className="text-xs text-theme-muted mt-1 max-w-sm">
                        You can select one or multiple <span className="font-mono text-theme-text">.yml</span> / <span className="font-mono text-theme-text">.yaml</span> files.
                      </span>
                      <button
                        type="button"
                        className="mt-4 px-4 py-2 rounded-xl bg-theme-primary text-white text-xs font-semibold shadow hover:bg-theme-primary/90 flex items-center gap-2 pointer-events-none"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Browse Files</span>
                      </button>
                    </div>

                    {/* Uploaded Files Status Badge List */}
                    {wizardUploadedFiles.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span>{wizardUploadedFiles.length} file{wizardUploadedFiles.length > 1 ? "s" : ""} imported successfully</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setWizardStep(3)}
                            className="text-[11px] underline text-emerald-300 hover:text-white"
                          >
                            Proceed to Customize &rarr;
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {wizardUploadedFiles.map((fn, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-emerald-900/40 border border-emerald-500/40 text-[11px] font-mono text-emerald-200 flex items-center gap-1">
                              <Check className="w-3 h-3 text-emerald-400" />
                              {fn}
                            </span>
                          ))}
                        </div>
                        {wizardExtractedKeys.length > 0 && (
                          <p className="text-[11px] text-emerald-300">
                            Found API keys: <span className="font-semibold text-white">{wizardExtractedKeys.join(", ")}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Customize */}
            {wizardStep === 3 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-theme-hover/20 border border-theme space-y-1">
                  <h4 className="text-sm font-bold text-theme-text">Visual Editor & Live Preview</h4>
                  <p className="text-xs text-theme-muted leading-relaxed">
                    You can easily customize badge positions and appearance visually without writing any code.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <Move className="w-4 h-4 text-theme-primary" />
                      <span>Drag and Drop</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Click directly on any badge on the preview poster (ratings, 4K logo, duration) and drag it to where you want it to appear.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <Magnet className="w-4 h-4 text-theme-primary" />
                      <span>Grid & Alignment Guides</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Turn on alignment guides and grid lines to snap badges neatly into corners or center them.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <Sliders className="w-4 h-4 text-theme-primary" />
                      <span>Simple Sliders</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Adjust badge distances, text size, and background boxes using straightforward sliders on the side.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <LayoutGrid className="w-4 h-4 text-theme-primary" />
                      <span>All Artwork Types</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Easily switch between Movie Posters (2:3), TV Shows, Season Posters, Episode Titlecards, and Backgrounds.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Send to server */}
            {wizardStep === 4 && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-theme-hover/20 border border-theme space-y-1">
                  <h4 className="text-sm font-bold text-theme-text">Sending Artwork to Your Media Server</h4>
                  <p className="text-xs text-theme-muted leading-relaxed">
                    When you are happy with your badges, sending them to your server is quick and straightforward.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <Play className="w-4 h-4 text-theme-primary fill-current" />
                      <span>Manual Update</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Click <strong className="text-theme-text">Apply Overlays</strong> in the top bar anytime. Choose <strong className="text-theme-text">Changes Only</strong> for a quick update of new items, or Full Sync.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-theme-hover/20 border border-theme space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-theme-text">
                      <Clock className="w-4 h-4 text-theme-primary" />
                      <span>Automatic Schedule</span>
                    </div>
                    <p className="text-theme-muted leading-relaxed">
                      Turn on scheduled updates in the Scheduler tab (daily or weekly). Newly added movies and episodes are badged automatically in the background.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    You are all set!
                  </span>
                  <p className="text-theme-muted leading-relaxed">
                    You can reopen this guide anytime by clicking the <strong className="text-theme-text">Setup Wizard</strong> button at the top of the Dynamic Overlays page.
                  </p>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="pt-3 border-t border-theme/60 flex flex-col sm:flex-row items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-theme-muted cursor-pointer self-start sm:self-auto select-none">
                <input
                  type="checkbox"
                  checked={dontShowWizardAgain}
                  onChange={(e) => setDontShowWizardAgain(e.target.checked)}
                  className="rounded border-theme bg-theme-hover text-theme-primary focus:ring-0"
                />
                <span>Do not show this welcome guide automatically</span>
              </label>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev - 1)}
                    className="px-3.5 py-1.5 rounded-xl bg-theme-hover hover:bg-theme-hover/80 border border-theme text-theme-text text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                )}

                {wizardStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev + 1)}
                    className="px-4 py-1.5 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      dismissWizardInDb();
                      setIsWizardOpen(false);
                      handleTabChange("preview");
                    }}
                    className="px-4 py-1.5 rounded-xl bg-theme-primary hover:bg-theme-primary/90 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Finish & Open Live Preview</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER: GRATITUDE & ATTRIBUTION */}
      <footer className="pt-6 mt-12 border-t border-theme/40 text-xs text-theme-muted flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-theme-primary fill-theme-primary/20 shrink-0" />
          <span>
            Dynamic Overlays is built with gratitude to <strong className="text-theme-text font-medium">meisnate12</strong> and the <strong className="text-theme-text font-medium">Kometa Team</strong> (formerly Plex Meta Manager) under the <strong className="text-theme-text font-medium">MIT License</strong>.
          </span>
        </div>
        <a
          href="https://github.com/Kometa-Team/Kometa"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-theme-muted hover:text-theme-primary transition-colors text-xs shrink-0"
          title="Visit Kometa repository on GitHub"
        >
          <span>Kometa on GitHub</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </footer>
    </div>
  );
}
