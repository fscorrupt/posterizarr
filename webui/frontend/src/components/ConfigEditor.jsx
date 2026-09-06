import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Save,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Settings,
  Database,
  Palette,
  Type,
  Bell,
  Check,
  X,
  Lock,
  Loader2,
  Search,
  HelpCircle,
  Upload,
  Image,
  Library,
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  ArrowRight,
  Maximize2,
  Folder,
  Zap,
  Sliders,
  Trash2,
  Plus,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ValidateButton from "./ValidateButton";
import LanguageOrderSelector from "./LanguageOrderSelector";
import ProviderOrderSelector from "./ProviderOrderSelector";
import LibraryExclusionSelector from "./LibraryExclusionSelector";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import PlexOAuthButton from "./PlexOAuthButton";

const API_URL = "/api";

// Icon Mapping Helper
const IconMap = {
  Lock, Settings, Server: Database, Database, Palette, Type, Bell,
  Image, Library, Key
};

const DynamicIcon = ({ name, className }) => {
  if (typeof name !== 'string') {
      const Comp = name || Settings;
      return <Comp className={className} />;
  }
  const Icon = IconMap[name] || Settings;
  return <Icon className={className} />;
};

// Mapping from groups to README sections
const README_LINKS = {
  "WebUI Settings": "https://fscorrupt.github.io/posterizarr/configuration/#webui",
  "System Settings": "https://fscorrupt.github.io/posterizarr/configuration/#prerequisitepart",
  "Provider Settings": "https://fscorrupt.github.io/posterizarr/configuration/#apipart",
  "Media Servers": "https://fscorrupt.github.io/posterizarr/configuration/#plexpart",
  "Language & Notifications": "https://fscorrupt.github.io/posterizarr/configuration/#notification",
  "Global Visuals": "https://fscorrupt.github.io/posterizarr/configuration/#overlaypart",
  "Poster Settings": "https://fscorrupt.github.io/posterizarr/configuration/#posteroverlaypart",
  "Poster Overlays": "https://fscorrupt.github.io/posterizarr/configuration/#posteroverlaypart",
  "Season Settings": "https://fscorrupt.github.io/posterizarr/configuration/#seasonposteroverlaypart",
  "Season Overlays": "https://fscorrupt.github.io/posterizarr/configuration/#seasonposteroverlaypart",
  "Season Show Title": "https://fscorrupt.github.io/posterizarr/configuration/#showtitleonseasonposterpart",
  "Background Settings": "https://fscorrupt.github.io/posterizarr/configuration/#backgroundoverlaypart",
  "Background Overlays": "https://fscorrupt.github.io/posterizarr/configuration/#backgroundoverlaypart",
  "Title Card Settings": "https://fscorrupt.github.io/posterizarr/configuration/#titlecardoverlaypart",
  "Title Card Overlay": "https://fscorrupt.github.io/posterizarr/configuration/#titlecardoverlaypart",
  "Title Card Title Text": "https://fscorrupt.github.io/posterizarr/configuration/#titlecardtitletextpart",
  "Title Card Episode Text": "https://fscorrupt.github.io/posterizarr/configuration/#titlecardepisodetextpart",
  "Collection Settings": "https://fscorrupt.github.io/posterizarr/configuration/#collectionposteroverlaypart",
  "Collection Poster": "https://fscorrupt.github.io/posterizarr/configuration/#collectionposteroverlaypart",
  "Collection Title": "https://fscorrupt.github.io/posterizarr/configuration/#collectiontitleposterpart",
};

// Reusable Password Input Component
const PasswordInput = ({ value, onChange, disabled, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full h-[42px] px-4 py-2.5 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary transition-all font-mono pr-10 disabled:opacity-50 disabled:cursor-not-allowed"
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        disabled={disabled}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-primary focus:outline-none disabled:opacity-50"
        tabIndex="-1"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};

function ConfigEditor() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  // State
  const [config, setConfig] = useState(null);
  const [tooltips, setTooltips] = useState({});
  const [uiGroups, setUiGroups] = useState(null);
  const [displayNames, setDisplayNames] = useState({});
  const [usingFlatStructure, setUsingFlatStructure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [overlayFiles, setOverlayFiles] = useState([]);
  const [uploadingOverlay, setUploadingOverlay] = useState(false);
  const [previewOverlay, setPreviewOverlay] = useState(null);
  const [fontFiles, setFontFiles] = useState([]);
  const [uploadingFont, setUploadingFont] = useState(false);
  const [previewFont, setPreviewFont] = useState(null);
  const hasInitializedGroups = useRef(false);
  const initialAuthStatus = useRef(null);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hideProviderBanner, setHideProviderBanner] = useState(() => localStorage.getItem('hideProviderBanner') === 'true');
  const lastSavedConfigRef = useRef(null);

  const [useJellySync, setUseJellySync] = useState(false);
  const [useEmbySync, setUseEmbySync] = useState(false);

  // Validation State
  const [validationErrors, setValidationErrors] = useState({});

  // WebUI Log Level
  const [webuiLogLevel, setWebuiLogLevel] = useState("INFO");

  // File Field Definitions
  const OVERLAY_FILE_FIELDS = [
    "overlayfile", "showoverlayfile", "seasonoverlayfile", "backgroundoverlayfile", "showbackgroundoverlayfile", "titlecardoverlayfile", "collectionoverlayfile",
    "poster4k", "Poster1080p", "Background4k", "Background1080p", "TC4k", "TC1080p",
    "4KDoVi", "4KHDR10", "4KDoViHDR10", "4KDoViBackground", "4KHDR10Background",
    "4KDoViHDR10Background", "4KDoViTC", "4KHDR10TC", "4KDoViHDR10TC",
  ];
  const FONT_FILE_FIELDS = ["font", "RTLFont", "backgroundfont", "titlecardfont", "collectionfont"];

  // Tab Structure
  const tabs = {
    System: { groups: ["WebUI Settings", "System Settings", "Language & Notifications"], icon: Settings, path: "/config/system" },
    Providers: { groups: ["Provider Settings"], icon: Key, path: "/config/providers" },
    "Media Servers": { groups: ["Media Servers"], icon: Database, path: "/config/services" },
    "Global Visuals": { groups: ["Global Visuals"], icon: Palette, path: "/config/visuals" },
    Posters: { groups: ["Poster Settings", "Poster Overlays"], icon: Image, path: "/config/posters" },
    Seasons: { groups: ["Season Settings", "Season Overlays", "Season Show Title"], icon: Library, path: "/config/seasons" },
    Backgrounds: { groups: ["Background Settings", "Background Overlays"], icon: Image, path: "/config/backgrounds" },
    "Title Cards": { groups: ["Title Card Settings", "Title Card Overlay", "Title Card Title Text", "Title Card Episode Text"], icon: Type, path: "/config/titlecards" },
    Collections: { groups: ["Collection Settings", "Collection Poster", "Collection Title"], icon: Library, path: "/config/collections" },
  };

  const getActiveTabFromPath = () => {
    const path = location.pathname;
    if (path.includes("/config/system")) return "System";
    if (path.includes("/config/providers")) return "Providers";
    if (path.includes("/config/services")) return "Media Servers";
    if (path.includes("/config/visuals")) return "Global Visuals";
    if (path.includes("/config/posters")) return "Posters";
    if (path.includes("/config/seasons")) return "Seasons";
    if (path.includes("/config/backgrounds")) return "Backgrounds";
    if (path.includes("/config/titlecards")) return "Title Cards";
    if (path.includes("/config/collections")) return "Collections";
    return "System";
  };
  const activeTab = getActiveTabFromPath();
  const commonInputClass = "w-full bg-theme-bg border border-theme rounded-lg p-2.5 text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  // Subgroup Mapping Function for Visual Grouping
  const getSettingCategory = (key) => {
    const k = key.toLowerCase();

    // EXCEPTION: Disable visual grouping for Media Server settings
    if (k.includes("plex") || k.includes("jellyfin") || k.includes("emby")) return "Settings";

    // General Settings
    if (["assetpath", "backuppath", "manualassetpath", "libraryfolders"].some(s => k === s)) return "Paths & Storage";
    if (["posters", "seasonposters", "backgroundposters", "titlecards"].some(s => k === s)) return "Generators";
    if (["assetcleanup", "followsymlink", "disablehashvalidation", "disableonlineassetfetch", "force_running_deletion"].some(s => k.includes(s))) return "Logic & System";
    if (k.startsWith("skip") || k === "titlecardskipwords") return "Skipping Logic";

    // WebUI
    if (k.includes("auth")) return "Authentication";
    if (k.includes("loglevel")) return "Logging";

    // APIs
    if (k.includes("provider") || k.includes("sorting")) return "Preferences";
    if (k.includes("languageorder") || k.includes("tmdblanguagemappings")) return "Lang Preferences";


    // Notifications
    const notificationKeys = ["sendnotification", "discord", "appriseurl", "discordusername", "useuptimekuma", "uptimekumaurl", "agregarrtriggerenabled", "agregarrurl", "agregarrapikey", "agregarrretrytimeout"];
    if (notificationKeys.includes(k)) return "Notifications";

    // Library Overrides
    if (k === "librarylanguageoverrides") return "Library Overrides";

    // Visuals
    if (k.includes("font") && !k.includes("size")) return "Fonts";
    if (k.includes("overlay") && !k.includes("add")) return "Overlay Files";
    if (k.includes("color") || k.includes("caps") || k.includes("stroke")) return "Styling";
    if (k.includes("size") || k.includes("width") || k.includes("height") || k.includes("spacing")) return "Dimensions";

    return "Settings"; // Default fallback
  };

  const groupFieldsByCategory = (fields) => {
    const grouped = {};
    fields.forEach(field => {
        const category = getSettingCategory(field);
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(field);
    });
    return grouped;
  };

  // Initialization
  useEffect(() => {
    fetchConfig();
    fetchOverlayFiles();
    fetchFontFiles();
    fetchWebuiLogLevel();
  }, []);

  // Keyboard shortcut for saving
  useEffect(() => {
    const handleKeyPress = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!saving && hasUnsavedChanges) saveConfig();
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [saving, hasUnsavedChanges]);

  // Initial group expansion
  useEffect(() => {
    if (config && !hasInitializedGroups.current) {
      const groups = getGroupsByTab(activeTab);
      if (groups.length === 1) setExpandedGroups({ [groups[0]]: true });
      hasInitializedGroups.current = true;
    }
  }, [config, activeTab]);

  useEffect(() => {
    if (activeTab && config && hasInitializedGroups.current) {
      const groups = getGroupsByTab(activeTab);
      if (groups.length === 1) setExpandedGroups(prev => ({ ...prev, [groups[0]]: true }));
    }
  }, [activeTab]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  // Data Fetching & Saving
  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/config`);
      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        setTooltips(data.tooltips || {});
        setUiGroups(data.ui_groups || null);
        setDisplayNames(data.display_names || {});
        setUsingFlatStructure(data.using_flat_structure || false);
        lastSavedConfigRef.current = JSON.stringify(data.config);
        setHasUnsavedChanges(false);
        if (initialAuthStatus.current === null) {
          const authEnabled = data.using_flat_structure ? data.config?.basicAuthEnabled : data.config?.WebUI?.basicAuthEnabled;
          initialAuthStatus.current = Boolean(authEnabled);
        }
      } else {
        setError("Failed to load config");
        showError("Failed to load config");
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err.message}`);
      showError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchOverlayFiles = async () => {
    try {
      const response = await fetch(`${API_URL}/overlayfiles`);
      const data = await response.json();
      if (data.success) {
        const imageFiles = (data.files || []).filter(file => file.type === "image");
        setOverlayFiles(imageFiles);
      }
    } catch (err) { console.error("Failed to load overlay files:", err); }
  };

  const handleOverlayFileUpload = async (file) => {
    if (!file) return;
    setUploadingOverlay(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_URL}/overlayfiles/upload`, { method: "POST", body: formData });
      const data = await response.json();
      if (data.success) {
        showSuccess(`File "${data.filename}" uploaded successfully!`);
        await fetchOverlayFiles();
      } else { showError(data.detail || "Upload failed"); }
    } catch (err) { showError("Failed to upload file"); } finally { setUploadingOverlay(false); }
  };

  const fetchFontFiles = async () => {
    try {
      const response = await fetch(`${API_URL}/fonts`);
      const data = await response.json();
      if (data.success) setFontFiles(data.files || []);
    } catch (err) { console.error("Failed to load font files:", err); }
  };

  const handleFontFileUpload = async (file) => {
    if (!file) return;
    setUploadingFont(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_URL}/fonts/upload`, { method: "POST", body: formData });
      const data = await response.json();
      if (data.success) {
        showSuccess(`Font "${data.filename}" uploaded successfully!`);
        await fetchFontFiles();
      } else { showError(data.detail || "Upload failed"); }
    } catch (err) { showError("Failed to upload file"); } finally { setUploadingFont(false); }
  };

  const fetchWebuiLogLevel = async () => {
    try {
      const response = await fetch(`${API_URL}/webui-settings`);
      const data = await response.json();
      if (data.success && data.settings.log_level) setWebuiLogLevel(data.settings.log_level);
    } catch (err) { console.error("Failed to load WebUI log level:", err); }
  };

  const updateWebuiLogLevel = async (level) => {
    try {
      const response = await fetch(`${API_URL}/webui-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { log_level: level } }),
      });
      const data = await response.json();
      if (data.success) {
        setWebuiLogLevel(level);
        showSuccess(`WebUI Backend Log Level set to ${level}`);
      } else { showError(data.detail || "Failed to update log level"); }
    } catch (err) { showError("Failed to update log level"); }
  };

  const saveConfig = async () => {
    if (Object.keys(validationErrors).length > 0) {
      showError(`Cannot save: ${Object.keys(validationErrors).length} validation errors found.`);
      return;
    }

    setSaving(true);
    setError(null);
    const oldAuthEnabled = initialAuthStatus.current;
    const newAuthEnabled = usingFlatStructure ? config?.basicAuthEnabled : config?.WebUI?.basicAuthEnabled;
    const authChanging = oldAuthEnabled !== Boolean(newAuthEnabled);

    try {
      const response = await fetch(`${API_URL}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await response.json();
      if (data.success) {
        lastSavedConfigRef.current = JSON.stringify(config);
        setHasUnsavedChanges(false);
        if (authChanging) {
          sessionStorage.removeItem("auth_credentials");
          window.location.replace(window.location.href);
          return;
        }
        initialAuthStatus.current = Boolean(newAuthEnabled);
        showSuccess(t("configEditor.savedSuccessfully", { count: data.changes_count || 0 }));
      } else {
        showError("Failed to save configuration");
      }
    } catch (err) {
      showError(`Error: ${err.message}`);
    } finally {
      if (!authChanging) setSaving(false);
    }
  };

  // Helper Functions
  const toggleGroup = (groupName) => setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));

  const updateValue = (key, value) => {
    let updatedConfig;
    if (usingFlatStructure) {
      updatedConfig = { ...config, [key]: value };
      setConfig(updatedConfig);
    } else {
      const [section, field] = key.includes(".") ? key.split(".") : [null, key];
      if (section) {
        updatedConfig = { ...config, [section]: { ...config[section], [field]: value } };
        setConfig(updatedConfig);
      }
    }
    setHasUnsavedChanges(true);
  };

  const getDisplayName = (key) => displayNames[key] ? displayNames[key] : key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();

  // Filtering & Search Logic

  const getGroupsByTab = (tabName) => {
    if (!config) return [];
    const tabGroups = tabs[tabName]?.groups || [];
    if (usingFlatStructure && uiGroups) {
      return tabGroups.filter(groupName => {
        const groupKeys = uiGroups[groupName] || [];
        return groupKeys.some(key => key in config);
      });
    } else {
      return tabGroups.filter(groupName => config[groupName]);
    }
  };

  const getFieldsForGroup = (groupName) => {
    if (!config) return [];
    if (usingFlatStructure && uiGroups) {
      const groupKeys = uiGroups[groupName] || [];
      return groupKeys.filter(key => key in config);
    } else {
      return Object.keys(config[groupName] || {});
    }
  };

  const formatGroupName = (groupName) => groupName.includes(" ") ? groupName : groupName.replace(/Part$/, "").replace(/([A-Z])/g, " $1").trim();

  const matchesSearch = (text) => !searchQuery.trim() ? true : text.toLowerCase().includes(searchQuery.toLowerCase());

  const getFilteredFieldsForGroup = (groupName) => {
    const allFields = getFieldsForGroup(groupName);
    if (!searchQuery.trim()) return allFields;

    return allFields.filter((key) => {
      const displayName = getDisplayName(key);
      const value = usingFlatStructure ? config[key] : config[groupName]?.[key];
      const stringValue = value === null || value === undefined ? "" : String(value);
      return matchesSearch(key) || matchesSearch(displayName) || matchesSearch(stringValue);
    });
  };

  const getVisibleGroups = () => {
    if (searchQuery.trim()) {
      const allGroupNames = new Set();
      Object.values(tabs).forEach(tab => {
        tab.groups.forEach(g => allGroupNames.add(g));
      });

      const result = [];
      Array.from(allGroupNames).forEach(groupName => {
        const fields = getFilteredFieldsForGroup(groupName);
        if (fields.length > 0) result.push(groupName);
      });
      return result;
    }
    return getFilteredGroupsByTab(activeTab);
  };

  const getFilteredGroupsByTab = (tabName) => {
    const groups = getGroupsByTab(tabName);
    return groups;
  };

  const getTabNameForGroup = (groupName) => {
    for (const [tab, data] of Object.entries(tabs)) {
        if (data.groups.includes(groupName)) return tab;
    }
    return "Settings";
  };

  // Search Navigation Logic
  const handleJumpToSetting = (groupName, key) => {
    let targetTab = null;
    for (const [tabName, tabData] of Object.entries(tabs)) {
      if (tabData.groups.includes(groupName)) {
        targetTab = tabName;
        break;
      }
    }
    if (targetTab) {
      setSearchQuery("");
      if (targetTab !== activeTab) navigate(tabs[targetTab].path);

      // Wait for rendering to complete (increased timeout to ensure DOM is ready)
      setTimeout(() => {
        setExpandedGroups(prev => ({ ...prev, [groupName]: true }));
        // Second timeout to allow expansion animation
        setTimeout(() => {
          const element = document.getElementById(`setting-${groupName}-${key}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Add high-visibility classes
            element.classList.add('!border-theme-primary', '!ring-2', '!ring-theme-primary', 'bg-theme-primary/10', 'transition-all', 'duration-500');

            // Remove highlight after delay
            setTimeout(() => {
                element.classList.remove('!border-theme-primary', '!ring-2', '!ring-theme-primary', 'bg-theme-primary/10');
            }, 2500);
          }
        }, 300);
      }, 100);
    }
  };

  // Conditional Disabling Logic
  const isFieldDisabled = (key, groupName) => {
    if (!config) return false;

    // Helper to get boolean values safely
    const getValue = (fieldKey) => {
        let val;
        if (usingFlatStructure) {
            val = config[fieldKey];
        } else {
             if (config[fieldKey]) val = config[fieldKey]; // if flat key exists
             else {
                 for(const grp of Object.values(config)) {
                     if (grp[fieldKey] !== undefined) { val = grp[fieldKey]; break; }
                 }
             }
        }
        return val === "true" || val === true;
    };

    // Get value relative to the current group
    const getGroupValue = (group, field) => {
        if (usingFlatStructure) {
            const prefixes = {
                "Poster Settings": "Poster",
                "Poster Overlays": "Poster",
                "Season Settings": "SeasonPoster",
                "Season Overlays": "SeasonPoster",
                "Season Show Title": "ShowTitle",
                "Background Settings": "Background",
                "Background Overlays": "Background",
                "Title Card Settings": "TitleCard",
                "Title Card Overlay": "TitleCard",
                "Title Card Title Text": "TitleCardTitle",
                "Title Card Episode Text": "TitleCardEP",
                "Collection Settings": "CollectionTitle",
                "Collection Poster": "CollectionPoster",
                "Collection Title": "CollectionTitle"
            };
            const prefix = prefixes[group] || "";
            const flatKey = prefix + field;
            return config[flatKey] === "true" || config[flatKey] === true;
        } else {
            const val = config[group]?.[field];
            return val === "true" || val === true;
        }
    };

    const plexEnabled = getValue("UsePlex");
    const jellyfinEnabled = getValue("UseJellyfin");
    const embyEnabled = getValue("UseEmby");

    // Media Server Dependencies
    if (["PlexUrl", "PlexToken", "PlexLibstoExclude", "PlexUploadExistingAssets", "PlexUpload"].includes(key) && !plexEnabled) return true;
    if (["JellyfinUrl", "JellyfinAPIKey", "JellyfinLibstoExclude"].includes(key) && !jellyfinEnabled && !useJellySync) return true;
    if (["JellyfinUploadExistingAssets", "JellyfinReplaceThumbwithBackdrop"].includes(key) && !jellyfinEnabled) return true;
    if (key === "JellyfinReplaceThumbwithBackdropExclusively" && (!jellyfinEnabled || !getValue("JellyfinReplaceThumbwithBackdrop"))) return true;
    if (["EmbyUrl", "EmbyAPIKey", "EmbyLibstoExclude"].includes(key) && !embyEnabled && !useEmbySync) return true;
    if (["EmbyUploadExistingAssets", "EmbyReplaceThumbwithBackdrop"].includes(key) && !embyEnabled) return true;
    if (key === "EmbyReplaceThumbwithBackdropExclusively" && (!embyEnabled || !getValue("EmbyReplaceThumbwithBackdrop"))) return true;

    // Text Formatting & Skip Logic
    if (key === "SymbolsToKeepOnNewLine" && !getValue("NewLineOnSpecificSymbols")) return true;
    if (key === "NewLineSymbols" && !getValue("NewLineOnSpecificSymbols")) return true;
    if (key === "NewLineWords" && !getValue("NewLineOnSpecificWords")) return true;
    if (key === "TmdbLanguageMappings") return false; // Show it unconditionally or based on TMDB provider
    if (key === "TitleCardSkipWords" && !getValue("SkipTBA")) return true;

    // Logo Logic
    if (["UseClearlogo", "UseClearart", "LogoTextFallback", "ConvertLogoColor"].includes(key)) {
        const useLogo = getValue("UseLogo");
        const useBGLogo = getValue("UseBGLogo");
        if (!useLogo && !useBGLogo) return true;
    }

    if (key === "LogoFlatColor") {
        const useLogo = getValue("UseLogo");
        const useBGLogo = getValue("UseBGLogo");
        const convert = getValue("ConvertLogoColor");
        if ((!useLogo && !useBGLogo) || !convert) return true;
    }

    // Visual Settings Groups
    const keyLower = key.toLowerCase();

    // Border dependencies
    if ((keyLower.includes("bordercolor") || keyLower.includes("borderwidth")) && !getGroupValue(groupName, "AddBorder")) return true;

    // Text dependencies (AddText)
    const textFields = ["addtextstroke", "strokecolor", "strokewidth", "minpointsize", "maxpointsize", "maxwidth", "maxheight", "text_offset", "linespacing", "textgravity", "fontallcaps", "fontcolor"];
    // Specific exclusions for things that look like text but aren't governed by generic AddText
    if (groupName !== "Title Card Title Text" && groupName !== "Title Card Episode Text" && groupName !== "Season Show Title" && groupName !== "Collection Title") {
         if (textFields.some(suffix => keyLower.endsWith(suffix)) && !getGroupValue(groupName, "AddText")) return true;
    }

    // Stroke dependencies
    if ((keyLower.includes("strokecolor") || keyLower.includes("strokewidth")) && !getGroupValue(groupName, "AddTextStroke")) return true;

    // Specific Group Toggles
    if (groupName === "Season Show Title" && textFields.some(suffix => keyLower.endsWith(suffix)) && !getGroupValue(groupName, "AddShowTitletoSeason")) return true;
    if (groupName === "Title Card Title Text" && textFields.some(suffix => keyLower.endsWith(suffix)) && !getGroupValue(groupName, "AddEPTitleText")) return true;
    if (groupName === "Title Card Episode Text" && textFields.some(suffix => keyLower.endsWith(suffix)) && !getGroupValue(groupName, "AddEPText")) return true;
    if (groupName === "Collection Title" && textFields.some(suffix => keyLower.endsWith(suffix)) && !getGroupValue(groupName, "AddCollectionTitle")) return true;

    return false;
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-theme-primary" /></div>;

  if (error) return (
      <div className="bg-red-950/40 rounded-xl p-6 border-2 border-red-600/50 text-center mx-auto max-w-2xl mt-10">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-300 text-lg font-semibold mb-2">{t("configEditor.errorLoadingConfig")}</p>
        <p className="text-red-200 mb-4">{error}</p>
        <button onClick={fetchConfig} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-all shadow-lg hover:scale-105"><RefreshCw className="w-5 h-5 inline mr-2" />{t("configEditor.retry")}</button>
      </div>
  );

  const displayedGroups = getVisibleGroups();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="sticky top-[85px] z-30 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between bg-theme-card/95 backdrop-blur-md border border-theme rounded-xl p-4 shadow-md">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted" />
          <input
            type="text"
            placeholder={t("configEditor.searchPlaceholder") || "Search settings..."}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-theme-bg border border-theme rounded-lg pl-10 py-2 text-sm text-theme-text focus:border-theme-primary focus:outline-none focus:ring-1 focus:ring-theme-primary transition-all"
          />
          {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-theme-hover rounded-full"><X className="w-4 h-4 text-theme-muted" /></button>}
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          {Object.keys(validationErrors).length > 0 && <span className="text-red-500 text-sm font-medium flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Errors</span>}

          <button
            onClick={() => saveConfig()}
            disabled={saving || Object.keys(validationErrors).length > 0}
            className={`flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-medium transition-all shadow-sm flex-1 md:flex-none
              ${hasUnsavedChanges
                ? "bg-yellow-500 hover:bg-yellow-600 text-black animate-pulse"
                : "bg-theme-bg border border-theme text-theme-muted hover:bg-theme-hover"
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:animate-none`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{hasUnsavedChanges ? "Save Changes (Unsaved)" : t("configEditor.saveChanges")}</span>
          </button>
        </div>
      </div>

      <div className="flex gap-6">
         {!searchQuery && (
            <div className="w-64 flex-shrink-0 bg-theme-card rounded-xl border border-theme p-2 overflow-y-auto hidden lg:block h-fit sticky top-6">
                <div className="mb-2 px-3 py-2 text-xs font-semibold text-theme-muted uppercase tracking-wider">Config Groups</div>
                {Object.entries(tabs).map(([tabName, tabData]) => (
                    <button key={tabName} onClick={() => navigate(tabData.path)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-all text-left ${activeTab === tabName ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/30" : "text-theme-text hover:bg-theme-hover"}`}>
                        <DynamicIcon name={tabData.icon} className={`w-5 h-5 ${activeTab === tabName ? "text-theme-primary" : "text-theme-muted"}`} />
                        <span className="font-medium text-sm">{tabName}</span>
                    </button>
                ))}
            </div>
         )}

         <div className="flex-1 flex flex-col gap-6">
            {!searchQuery && (
                <div className="lg:hidden relative">
                    <select value={tabs[activeTab]?.path || ""} onChange={(e) => navigate(e.target.value)} className="w-full bg-theme-card border border-theme rounded-lg p-3 text-theme-text font-medium shadow-sm appearance-none pr-10">
                        {Object.entries(tabs).map(([name, data]) => (
                            <option key={name} value={data.path}>{name}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-muted pointer-events-none" />
                </div>
            )}

            <div className="bg-theme-card border border-theme rounded-xl p-6 shadow-sm min-h-[600px]">
                {!searchQuery && (
                   <div className="flex items-center justify-between mb-6 pb-4 border-b border-theme">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-theme-primary/10 rounded-lg"><DynamicIcon name={tabs[activeTab]?.icon} className="w-6 h-6 text-theme-primary" /></div>
                            <h2 className="text-xl font-bold text-theme-text">{activeTab}</h2>
                        </div>
                   </div>
                )}
                {searchQuery && (
                   <div className="flex items-center justify-between mb-6 pb-4 border-b border-theme">
                        <div className="flex items-center gap-3">
                            <Search className="w-6 h-6 text-theme-primary" />
                            <h2 className="text-xl font-bold text-theme-text">Search Results for "{searchQuery}"</h2>
                        </div>
                   </div>
                )}

                <div className="space-y-4">
                    {displayedGroups.map(groupName => {
                        const isExpanded = searchQuery ? true : expandedGroups[groupName];
                        const readmeLink = README_LINKS[groupName];
                        const fields = getFilteredFieldsForGroup(groupName);

                        // Group fields by visual category
                        const categorizedFields = groupFieldsByCategory(fields);
                        // Sort categories - put "Settings" last, "Paths" first usually looks good
                        const categories = Object.keys(categorizedFields).sort((a,b) => {
                             if(a === "Paths & Storage") return -1;
                             if(b === "Paths & Storage") return 1;
                             if(a === "Settings") return 1;
                             if(b === "Settings") return -1;
                             return a.localeCompare(b);
                        });

                        if (fields.length === 0) return null;

                        // Tab Name for Search Context
                        const parentTab = getTabNameForGroup(groupName);

                        return (
                            <div key={groupName} className="border border-theme rounded-lg bg-theme-bg/10">
                                <button onClick={() => toggleGroup(groupName)} className="w-full flex items-center justify-between p-4 bg-theme-card hover:bg-theme-hover transition-colors rounded-t-lg">
                                    <div className="flex items-center gap-3">
                                        <span className={`p-1.5 rounded-md ${isExpanded ? 'bg-theme-primary/20 text-theme-primary' : 'bg-theme-bg text-theme-muted'}`}>
                                            {isExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
                                        </span>
                                        <div>
                                            <span className="font-semibold text-theme-text flex items-center gap-2">
                                                {formatGroupName(groupName)}
                                                {searchQuery && <span className="text-[10px] bg-theme-primary/20 text-theme-primary px-2 py-0.5 rounded-full">{parentTab}</span>}
                                            </span>
                                        </div>
                                        {searchQuery && <span className="text-xs text-theme-muted ml-2">({fields.length} matches)</span>}
                                    </div>
                                    {readmeLink && !searchQuery && (
                                        <a href={readmeLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-theme-primary hover:underline flex items-center gap-1">SETTINGS WIKI <ExternalLink className="w-3 h-3" /></a>
                                    )}
                                </button>

                                {isExpanded && (
                                    <div className="p-4 border-t border-theme bg-theme-bg/20 rounded-b-lg">
                                        {groupName === "Provider Settings" && !hideProviderBanner && !searchQuery && (
                                            <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg flex gap-4">
                                                <AlertCircle className="w-6 h-6 text-blue-400 shrink-0" />
                                                <div className="flex-1">
                                                    <h3 className="text-sm font-semibold text-blue-400 mb-1">Provider Settings Overhauled</h3>
                                                    <p className="text-sm text-theme-muted mb-2">Legacy provider override switches have been removed in favor of a single unified Priority Strategy. If you previously used overrides, they have been reset and you must select your preferred mode below.</p>
                                                    <button onClick={() => { setHideProviderBanner(true); localStorage.setItem('hideProviderBanner', 'true'); }} className="text-xs font-semibold text-blue-400 hover:text-blue-300">Dismiss</button>
                                                </div>
                                            </div>
                                        )}
                                        {/* If Searching: Flat List */}
                                        {searchQuery ? (
                                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                                {fields.map(key => <SettingCard key={key} settingKey={key} groupName={groupName} config={config} usingFlatStructure={usingFlatStructure} webuiLogLevel={webuiLogLevel} updateWebuiLogLevel={updateWebuiLogLevel} useJellySync={useJellySync} setUseJellySync={setUseJellySync} useEmbySync={useEmbySync} setUseEmbySync={setUseEmbySync} updateValue={updateValue} getDisplayName={getDisplayName} tooltips={tooltips} commonInputClass={commonInputClass} handleJumpToSetting={handleJumpToSetting} searchQuery={searchQuery} isFieldDisabled={isFieldDisabled} overlayFiles={overlayFiles} fontFiles={fontFiles} uploadingOverlay={uploadingOverlay} uploadingFont={uploadingFont} handleOverlayFileUpload={handleOverlayFileUpload} handleFontFileUpload={handleFontFileUpload} setPreviewOverlay={setPreviewOverlay} setPreviewFont={setPreviewFont} showSuccess={showSuccess} showError={showError} setConfig={setConfig} setHasUnsavedChanges={setHasUnsavedChanges} />)}

                                                {/* API Key Manager (In Search) */}
                                                {groupName === "WebUI Settings" && (
                                                    <div className="col-span-1 xl:col-span-2">
                                                        <ApiKeyManager />
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            /* If Not Searching: Visual Groups */
                                            <div className="space-y-6">
                                                {categories.map(category => (
                                                    <div key={category} className="relative">
                                                        {category !== "Settings" && (
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <div className="h-px bg-theme-primary/20 flex-1"></div>
                                                                <span className="text-xs font-bold text-theme-primary uppercase tracking-widest">{category}</span>
                                                                <div className="h-px bg-theme-primary/20 flex-1"></div>
                                                            </div>
                                                        )}
                                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                                            {categorizedFields[category].map(key => <SettingCard key={key} settingKey={key} groupName={groupName} config={config} usingFlatStructure={usingFlatStructure} webuiLogLevel={webuiLogLevel} updateWebuiLogLevel={updateWebuiLogLevel} useJellySync={useJellySync} setUseJellySync={setUseJellySync} useEmbySync={useEmbySync} setUseEmbySync={setUseEmbySync} updateValue={updateValue} getDisplayName={getDisplayName} tooltips={tooltips} commonInputClass={commonInputClass} handleJumpToSetting={handleJumpToSetting} searchQuery={searchQuery} isFieldDisabled={isFieldDisabled} overlayFiles={overlayFiles} fontFiles={fontFiles} uploadingOverlay={uploadingOverlay} uploadingFont={uploadingFont} handleOverlayFileUpload={handleOverlayFileUpload} handleFontFileUpload={handleFontFileUpload} setPreviewOverlay={setPreviewOverlay} setPreviewFont={setPreviewFont} showSuccess={showSuccess} showError={showError} setConfig={setConfig} setHasUnsavedChanges={setHasUnsavedChanges} />)}
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* API Key Manager (Standard View) */}
                                                {groupName === "WebUI Settings" && (
                                                    <ApiKeyManager />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {displayedGroups.length === 0 && (
                        <div className="text-center py-12 text-theme-muted">
                            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>No settings found matching "{searchQuery}".</p>
                            <button onClick={() => setSearchQuery("")} className="mt-2 text-theme-primary hover:underline">Clear Search</button>
                        </div>
                    )}
                </div>
            </div>
         </div>
      </div>

      {/* Previews */}
      {previewOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setPreviewOverlay(null)}>
          <div className="bg-theme-card border border-theme rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-theme flex justify-between items-center"><h3 className="font-bold text-theme-text">Preview: {previewOverlay}</h3><button onClick={() => setPreviewOverlay(null)}><X className="w-5 h-5 text-theme-muted hover:text-theme-text" /></button></div>
            <div className="p-8 bg-gray-900 flex justify-center relative">
               <div className="absolute inset-0 opacity-20" style={{backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
               <img src={`${API_URL}/overlayfiles/preview/${previewOverlay}`} alt="Preview" className="max-h-[60vh] object-contain relative z-10" />
            </div>
          </div>
        </div>
      )}

      {previewFont && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setPreviewFont(null)}>
          <div className="bg-theme-card border border-theme rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-theme flex justify-between items-center"><h3 className="font-bold text-theme-text">Font Preview: {previewFont}</h3><button onClick={() => setPreviewFont(null)}><X className="w-5 h-5 text-theme-muted hover:text-theme-text" /></button></div>
            <div className="p-6 bg-white text-black space-y-4 max-h-[60vh] overflow-y-auto">
                {["The Quick Brown Fox", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789"].map((text, i) => (
                    <div key={i} className="border-b pb-2">
                        <p className="text-xs text-gray-500 mb-1">{text}</p>
                        <img src={`${API_URL}/fonts/preview/${encodeURIComponent(previewFont)}?text=${encodeURIComponent(text)}`} alt="Font Preview" className="h-12 object-contain" />
                    </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Extracted Setting Card Component for cleaner main loop
const SettingCard = ({ settingKey, groupName, config, usingFlatStructure, webuiLogLevel, updateWebuiLogLevel, useJellySync, setUseJellySync, useEmbySync, setUseEmbySync, updateValue, getDisplayName, tooltips, commonInputClass, handleJumpToSetting, searchQuery, isFieldDisabled, overlayFiles, fontFiles, uploadingOverlay, uploadingFont, handleOverlayFileUpload, handleFontFileUpload, setPreviewOverlay, setPreviewFont, showSuccess, showError, setConfig, setHasUnsavedChanges }) => {
    const value = usingFlatStructure ? config[settingKey] : config[groupName]?.[settingKey];
    const isWide = (settingKey === "NewLineOnSpecificSymbols" && groupName === "Text Formatting") || settingKey.includes("ResolutionOverlays") || settingKey.includes("LibstoExclude");
    const uniqueId = `setting-${groupName}-${settingKey}`;
    const fieldKey = usingFlatStructure ? settingKey : `${groupName}.${settingKey}`;
    const disabled = isFieldDisabled(settingKey, groupName);
    const stringValue = value === null || value === undefined ? "" : String(value);

    const providerPriorityMode = usingFlatStructure ? config.ProviderPriorityMode : config.ApiPart?.ProviderPriorityMode;
    const isSimple = !providerPriorityMode || providerPriorityMode === "Simple";
    const isGlobal = providerPriorityMode === "Global";
    const isPerMediaType = providerPriorityMode === "PerMediaType";

    if (settingKey === "FavProvider" && !isSimple) return null;
    if (settingKey === "ProviderOrder" && !isGlobal) return null;
    if ((settingKey === "MovieProviderOrder" || settingKey === "ShowProviderOrder") && !isPerMediaType) return null;

    // Render Input Logic
    const renderInput = () => {
        // Validation Fields (Tokens/Keys) - Use PasswordInput for secrecy + Validate Button
        const renderValidate = (type, placeholder) => (
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <PasswordInput value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} placeholder={placeholder} />
                </div>
                <ValidateButton type={type} config={config} label="Validate" onSuccess={showSuccess} onError={showError} disabled={disabled} />
            </div>
        );

        if (settingKey === "PlexToken") return (
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <PasswordInput value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} placeholder={disabled ? "Enable Plex first" : "Enter Plex Token"} />
                </div>
                <PlexOAuthButton onTokenReceived={(token) => updateValue(fieldKey, token)} disabled={disabled} className="shrink-0" />
                <ValidateButton type="plex" config={config} label="Validate" onSuccess={showSuccess} onError={showError} disabled={disabled} />
            </div>
        );
        if (settingKey === "JellyfinAPIKey") return renderValidate("jellyfin", disabled ? "Enable Jellyfin first" : "Enter Jellyfin API Key");
        if (settingKey === "EmbyAPIKey") return renderValidate("emby", disabled ? "Enable Emby first" : "Enter Emby API Key");
        if (settingKey === "tmdbtoken") return renderValidate("tmdb", "Enter TMDB Token");
        if (settingKey === "tvdbapi") return renderValidate("tvdb", "Enter TVDB API Key");
        if (settingKey === "FanartTvAPIKey") return renderValidate("fanart", "Enter Fanart API Key");
        if (settingKey === "NewLineSymbols" || settingKey === "SymbolsToKeepOnNewLine" || settingKey === "SkipWords" || settingKey === "TitleCardSkipWords") {
            const symbols = Array.isArray(value)
                ? value
                : (typeof value === "string" && value ? value.split(",") : []);
            const isSkipWord = settingKey === "SkipWords" || settingKey === "TitleCardSkipWords";

            const handleUpdateSymbol = (index, newValue) => {
                const newSymbols = [...symbols];
                newSymbols[index] = newValue;
                updateValue(fieldKey, newSymbols);
            };

            const handleRemoveSymbol = (index) => {
                const newSymbols = symbols.filter((_, i) => i !== index);
                updateValue(fieldKey, newSymbols);
            };

            const handleAddSymbol = () => {
                updateValue(fieldKey, [...symbols, ""]);
            };

            return (
                <div className="space-y-3">
                    <div className={`flex flex-wrap gap-2 p-3 bg-theme-bg/50 rounded-lg border border-theme min-h-[52px] ${disabled ? "opacity-50" : ""}`}>
                        {symbols.map((symbol, idx) => (
                            <div key={idx} className="flex items-center gap-1 bg-theme-card border border-theme-primary/30 rounded px-2 py-1 group focus-within:border-theme-primary transition-all">
                                <input
                                    type="text"
                                    value={symbol}
                                    onChange={(e) => handleUpdateSymbol(idx, e.target.value)}
                                    disabled={disabled}
                                    className="bg-transparent border-none focus:ring-0 p-0 text-xs font-mono text-theme-primary min-w-[20px]"
                                    style={{ width: `${Math.max(symbol.length, 1) + 0.5}ch` }}
                                    placeholder={isSkipWord ? "Word" : "⎵"}
                                />
                                {!disabled && (
                                    <button
                                        onClick={() => handleRemoveSymbol(idx)}
                                        className="text-theme-muted hover:text-red-500 transition-colors ml-1"
                                        title="Remove"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {symbols.length === 0 && <span className="text-xs text-theme-muted italic py-1">{isSkipWord ? "No words defined" : "No symbols defined"}</span>}
                    </div>
                    {!disabled && (
                        <button
                            onClick={handleAddSymbol}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-theme-primary/10 text-theme-primary border border-theme-primary/20 rounded-lg hover:bg-theme-primary/20 transition-all"
                        >
                            <Plus className="w-3 h-3" /> {isSkipWord ? "Add Word" : "Add Symbol"}
                        </button>
                    )}
                    <p className="text-[10px] text-theme-muted italic">
                        {isSkipWord ? "Words are preserved exactly as typed. Wrap in slashes to use Regex (e.g. /pattern/)" : "Spaces are preserved exactly as typed inside the boxes."}
                    </p>
                </div>
            );
        }
        if (settingKey === "LibraryLanguageOverrides") {
            // One language order per library, applied to posters/seasons/backgrounds
            // for that library (title cards keep their own textless-first lead).
            // A single field per library instead of one per asset type, since the
            // real intent is "this library is German/French/etc", not four
            // settings to keep in sync.
            const dictValue = value && typeof value === 'object' ? value : {};

            const handleUpdateKey = (oldKey, newKey) => {
                const newDict = { ...dictValue };
                if (oldKey !== newKey) {
                    delete newDict[oldKey];
                }
                newDict[newKey] = dictValue[oldKey] || { PreferredLanguageOrder: [] };
                updateValue(fieldKey, newDict);
            };

            const handleUpdateOrder = (key, newOrder) => {
                const newDict = { ...dictValue };
                newDict[key] = { ...(dictValue[key] || {}), PreferredLanguageOrder: newOrder };
                updateValue(fieldKey, newDict);
            };

            const handleRemovePair = (keyToRemove) => {
                const newDict = { ...dictValue };
                delete newDict[keyToRemove];
                updateValue(fieldKey, newDict);
            };

            const handleAddPair = () => {
                const newDict = { ...dictValue, "Library Name": { PreferredLanguageOrder: ["en"], ApplyToPoster: true, ApplyToSeason: true, ApplyToBackground: true, ApplyToLogo: true } };
                updateValue(fieldKey, newDict);
            };

            const handleToggleApplyTo = (key, type, value) => {
                const newDict = { ...dictValue };
                newDict[key] = { ...(dictValue[key] || {}), [`ApplyTo${type}`]: value };
                updateValue(fieldKey, newDict);
            };

            return (
                <div className="space-y-4">
                    {Object.entries(dictValue).map(([k, v], idx) => (
                        <div key={idx} className="flex flex-col gap-3 p-4 bg-theme-bg/30 border border-theme rounded-lg relative group transition-all">
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-theme-muted mb-1">Library Name</label>
                                    <input
                                        className={`${commonInputClass} font-mono text-sm`}
                                        value={k}
                                        placeholder="Library Name"
                                        onChange={(e) => handleUpdateKey(k, e.target.value)}
                                        disabled={disabled}
                                    />
                                </div>
                                <button
                                    onClick={() => handleRemovePair(k)}
                                    className="p-2.5 mt-5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 flex-shrink-0 transition-colors"
                                    disabled={disabled}
                                    title="Remove Library Override"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="pt-3 border-t border-theme/50">
                                <LanguageOrderSelector
                                    value={v?.PreferredLanguageOrder || []}
                                    onChange={(newOrder) => handleUpdateOrder(k, newOrder)}
                                    helpText="Select which asset types this override applies to (title cards keep their textless-first preference automatically):"
                                />
                                <div className="flex gap-4 mt-3 pl-1">
                                    {["Poster", "Season", "Background", "Logo"].map((type) => {
                                        const isChecked = v?.[`ApplyTo${type}`] ?? true;
                                        return (
                                            <label key={type} className="flex items-center gap-2 text-sm text-theme-muted hover:text-theme-text cursor-pointer transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={(e) => handleToggleApplyTo(k, type, e.target.checked)}
                                                    disabled={disabled}
                                                    className="w-4 h-4 rounded border-theme text-theme-primary focus:ring-theme-primary/50 bg-theme-bg/50 cursor-pointer"
                                                />
                                                {type}
                                            </label>
                                        );
                                    })}
                                </div>
                                <div className="mt-4 pt-3 border-t border-theme/50">
                                    <label className="flex items-center gap-2 text-sm text-theme hover:text-theme-primary cursor-pointer transition-colors mb-3">
                                        <input
                                            type="checkbox"
                                            checked={v?.EnableProviderOrderOverride ?? false}
                                            onChange={(e) => {
                                                const newDict = { ...dictValue };
                                                newDict[k] = { ...(dictValue[k] || {}), EnableProviderOrderOverride: e.target.checked };
                                                updateValue(fieldKey, newDict);
                                            }}
                                            disabled={disabled}
                                            className="w-4 h-4 rounded border-theme text-theme-primary focus:ring-theme-primary/50 bg-theme-bg/50 cursor-pointer"
                                        />
                                        Enable Provider Order Override
                                    </label>
                                    
                                    {(v?.EnableProviderOrderOverride) && (
                                        <div className="pl-6">
                                            <ProviderOrderSelector 
                                                value={v?.ProviderOrder || ["TMDB", "TVDB", "Fanart", "Plex"]} 
                                                onChange={(newOrder) => {
                                                    const newDict = { ...dictValue };
                                                    newDict[k] = { ...(dictValue[k] || {}), ProviderOrder: newOrder };
                                                    updateValue(fieldKey, newDict);
                                                }}
                                                helpText="Select the specific provider priority for this library."
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    <button
                        onClick={handleAddPair}
                        className="w-full py-3 border-2 border-dashed border-theme rounded-lg text-theme-muted hover:text-theme-primary hover:border-theme-primary transition-all flex items-center justify-center gap-2 text-sm font-medium"
                        disabled={disabled}
                    >
                        <Plus className="w-5 h-5" /> Add Library Override
                    </button>
                    {Object.keys(dictValue).length === 0 && (
                        <p className="text-[10px] text-theme-muted italic">
                            Language order for specific libraries. Applies to posters, seasons and backgrounds for this library; title cards keep their textless-first preference automatically.
                        </p>
                    )}
                </div>
            );
        }
        if (settingKey === "NewLineWords" || settingKey === "TmdbLanguageMappings") {
            const dictValue = value && typeof value === 'object' ? value : {};

            const handleUpdatePair = (oldKey, newKey, newVal) => {
                const newDict = { ...dictValue };
                if (oldKey !== newKey) {
                    delete newDict[oldKey];
                }
                newDict[newKey] = newVal;
                updateValue(fieldKey, newDict);
            };

            const handleRemovePair = (keyToRemove) => {
                const newDict = { ...dictValue };
                delete newDict[keyToRemove];
                updateValue(fieldKey, newDict);
            };

            const handleAddPair = () => {
                const defaultKey = settingKey === "TmdbLanguageMappings" ? "fr" : "NEW_WORD";
                const defaultValue = settingKey === "TmdbLanguageMappings" ? "fr-FR" : "NEW-\\nWORD";
                const newDict = { ...dictValue, [defaultKey]: defaultValue };
                updateValue(fieldKey, newDict);
            };

            const placeholderKey = settingKey === "TmdbLanguageMappings" ? "fr" : "Word";
            const placeholderValue = settingKey === "TmdbLanguageMappings" ? "fr-FR" : "Replacement";
            const buttonText = settingKey === "TmdbLanguageMappings" ? "Add Language Mapping" : "Add Word Mapping";

            return (
                <div className="space-y-2">
                    {Object.entries(dictValue).map(([k, v], idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                            <input
                                className={`${commonInputClass} font-mono text-xs`}
                                value={k}
                                placeholder={placeholderKey}
                                onChange={(e) => handleUpdatePair(k, e.target.value, v)}
                                disabled={disabled}
                            />
                            <ArrowRight className="w-8 h-8 text-theme-muted mt-1 flex-shrink-0" />
                            <textarea
                                className={`${commonInputClass} font-mono text-xs h-[42px] min-h-[42px] resize-none`}
                                value={v}
                                placeholder={placeholderValue}
                                onChange={(e) => handleUpdatePair(k, k, e.target.value)}
                                disabled={disabled}
                            />
                            <button
                                onClick={() => handleRemovePair(k)}
                                className="p-2.5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20"
                                disabled={disabled}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    <button
                        onClick={handleAddPair}
                        className="w-full py-2 border-2 border-dashed border-theme rounded-lg text-theme-muted hover:text-theme-primary hover:border-theme-primary transition-all flex items-center justify-center gap-2 text-sm"
                        disabled={disabled}
                    >
                        <Plus className="w-4 h-4" /> {buttonText}
                    </button>
                </div>
            );
        }

        // Passwords & Other Secrets (No validate button, just PasswordInput)
        if (settingKey.toLowerCase().includes("password") || settingKey.toLowerCase().includes("secret") || settingKey.toLowerCase().endsWith("apikey")) {
             return <PasswordInput value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} placeholder="Enter value" />;
        }

        // Webhooks (Standard Input + Validate Button, generally not masked but can be long)
        if (["Discord", "AppriseUrl", "UptimeKumaUrl", "AgregarrUrl"].includes(settingKey)) {
             const type = settingKey === "Discord" ? "discord" : settingKey === "AppriseUrl" ? "apprise" : settingKey === "UptimeKumaUrl" ? "uptimekuma" : "agregarr";
             return (
                <div className="flex gap-2">
                    <input type="text" value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={commonInputClass} placeholder="Enter URL" />
                    <ValidateButton type={type} config={config} label="Test" onSuccess={showSuccess} onError={showError} disabled={disabled} />
                </div>
             );
        }

        // Standard File/Select/Bool rendering
        // File Uploads
        if (["overlayfile", "showoverlayfile", "seasonoverlayfile", "backgroundoverlayfile", "showbackgroundoverlayfile", "titlecardoverlayfile", "collectionoverlayfile", "poster4k", "Poster1080p", "Background4k", "Background1080p", "TC4k", "TC1080p", "4KDoVi", "4KHDR10", "4KDoViHDR10", "4KDoViBackground", "4KHDR10Background", "4KDoViHDR10Background", "4KDoViTC", "4KHDR10TC", "4KDoViHDR10TC"].includes(settingKey)) {
             return (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                        <select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}>
                            <option value="">-- Select Overlay File --</option>
                            {overlayFiles.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" />
                    </div>
                    <label className={`flex items-center justify-center px-3 bg-theme-card border border-theme rounded-lg cursor-pointer hover:bg-theme-hover transition-colors ${disabled || uploadingOverlay ? 'opacity-50 pointer-events-none' : ''}`}>
                      <input type="file" className="hidden" accept=".png,.jpg,.jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleOverlayFileUpload(file); }} disabled={uploadingOverlay} />
                      {uploadingOverlay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </label>
                    {stringValue && <button onClick={() => setPreviewOverlay(stringValue)} className="flex items-center justify-center px-3 bg-theme-card border border-theme rounded-lg hover:bg-theme-hover transition-colors"><Eye className="w-4 h-4" /></button>}
                  </div>
                </div>
            );
        }
        if (["font", "RTLFont", "backgroundfont", "titlecardfont", "collectionfont"].includes(settingKey)) {
             return (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                        <select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}>
                            <option value="">-- Select Font File --</option>
                            {fontFiles.map((file) => <option key={file} value={file}>{file}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" />
                    </div>
                    <label className={`flex items-center justify-center px-3 bg-theme-card border border-theme rounded-lg cursor-pointer hover:bg-theme-hover transition-colors ${disabled || uploadingFont ? 'opacity-50 pointer-events-none' : ''}`}>
                      <input type="file" className="hidden" accept=".ttf,.otf,.woff,.woff2" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFontFileUpload(file); }} disabled={uploadingFont} />
                      {uploadingFont ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </label>
                    {stringValue && <button onClick={() => setPreviewFont(stringValue)} className="flex items-center justify-center px-3 bg-theme-card border border-theme rounded-lg hover:bg-theme-hover transition-colors"><Eye className="w-4 h-4" /></button>}
                  </div>
                </div>
            );
        }

        // Selectors
        if (settingKey.includes("ProviderOrder") && settingKey !== "OverrideProviderOrder") return <ProviderOrderSelector value={Array.isArray(value) ? value : []} onChange={(newValue) => updateValue(fieldKey, newValue)} label={getDisplayName(settingKey)} helpText={tooltips[settingKey]} />;
        if (settingKey.includes("LanguageOrder")) return <LanguageOrderSelector value={Array.isArray(value) ? value : []} onChange={(newValue) => updateValue(fieldKey, newValue)} label={getDisplayName(settingKey)} helpText={tooltips[settingKey]} />;
        if (settingKey.includes("LibstoExclude")) {
            const type = settingKey.includes("Plex") ? "plex" : settingKey.includes("Jellyfin") ? "jellyfin" : "emby";
            return <LibraryExclusionSelector value={Array.isArray(value) ? value : []} onChange={(newValue) => updateValue(fieldKey, newValue)} helpText={tooltips[settingKey]} mediaServerType={type} config={config} disabled={disabled} showIncluded={true} />;
        }
        if (settingKey === "FavProvider") return (<div className="relative"><select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none uppercase`}><option value="tmdb">TMDB</option><option value="tvdb">TVDB</option><option value="fanart">FANART</option></select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" /></div>);
        if (settingKey === "ProviderPriorityMode") return (<div className="relative"><select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}><option value="Simple">Simple (Favorite Provider)</option><option value="Global">Global Custom Order</option><option value="PerMediaType">Per-Media Type Custom Order</option></select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" /></div>);
        if (settingKey === "tmdb_vote_sorting") return (<div className="relative"><select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}><option value="vote_average">Vote Average</option><option value="vote_count">Vote Count</option><option value="primary">Primary (Default TMDB View)</option></select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" /></div>);
        if (settingKey === "logLevel") return (<div className="relative"><select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}><option value="1">1 - Warning/Error</option><option value="2">2 - Info/Warning/Error (Default)</option><option value="3">3 - Debug/Info/Warning/Error</option></select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" /></div>);
        if (settingKey.toLowerCase().includes("gravity")) return (<div className="relative"><select value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={`${commonInputClass} appearance-none`}>{["NorthWest", "North", "NorthEast", "West", "Center", "East", "SouthWest", "South", "SouthEast"].map(opt => (<option key={opt} value={opt.toLowerCase()}>{opt}</option>))}</select><ChevronDown className="absolute right-3 top-3 w-4 h-4 text-theme-muted pointer-events-none" /></div>);

        // Color
        if (settingKey.toLowerCase().includes("color") && settingKey !== "ConvertLogoColor") return (<div className="flex gap-2"><div className="relative w-12 h-10 flex-shrink-0"><input type="color" value={stringValue.startsWith("#") ? stringValue : "#FFFFFF"} disabled={disabled} onChange={(e) => updateValue(fieldKey, e.target.value.toUpperCase())} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" /><div className={`w-full h-full rounded-lg border border-theme ${disabled ? 'opacity-50' : ''}`} style={{ backgroundColor: stringValue.startsWith("#") ? stringValue : "#FFFFFF" }} /></div><input type="text" value={stringValue} disabled={disabled} onChange={(e) => updateValue(fieldKey, e.target.value)} className={`${commonInputClass} font-mono uppercase`} placeholder="#FFFFFF" /></div>);

        // Booleans
        if (typeof value === "boolean" || ["true", "false", "True", "False"].includes(stringValue)) {
            const isEnabled = value === "true" || value === true || value === "True" || value === 1;
            const handleChange = (checked) => {
                 if ((settingKey === "UseClearlogo" || settingKey === "UseClearart") && checked) {
                     if (usingFlatStructure) {
                          setConfig({ ...config, UseClearlogo: "false", UseClearart: "false", [settingKey]: "true" });
                     } else {
                          const newConfig = { ...config };
                          if(newConfig.PrerequisitePart) { newConfig.PrerequisitePart.UseClearlogo = "false"; newConfig.PrerequisitePart.UseClearart = "false"; newConfig.PrerequisitePart[settingKey] = "true"; }
                          setConfig(newConfig);
                     }
                     setHasUnsavedChanges(true);
                     return;
                 }
                 if (["UsePlex", "UseJellyfin", "UseEmby"].includes(settingKey) && checked) {
                     const updates = {};
                     const target = settingKey === "UsePlex" ? "Plex" : settingKey === "UseJellyfin" ? "Jellyfin" : "Emby";
                     if (usingFlatStructure) {
                         updates.UsePlex = target==="Plex"?"true":"false"; updates.UseJellyfin = target==="Jellyfin"?"true":"false"; updates.UseEmby = target==="Emby"?"true":"false";
                         setConfig({ ...config, ...updates });
                     } else {
                         const newConfig = { ...config };
                         if(newConfig.PlexPart) newConfig.PlexPart.UsePlex = target==="Plex"?"true":"false";
                         if(newConfig.JellyfinPart) newConfig.JellyfinPart.UseJellyfin = target==="Jellyfin"?"true":"false";
                         if(newConfig.EmbyPart) newConfig.EmbyPart.UseEmby = target==="Emby"?"true":"false";
                         setConfig(newConfig);
                     }
                     setHasUnsavedChanges(true);
                     return;
                 }
                 updateValue(fieldKey, checked);
            };
            return (
                <div className={`flex items-center justify-between h-[42px] px-4 bg-theme-bg rounded-lg border border-theme transition-all ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <div className="text-sm font-medium text-theme-text">{getDisplayName(settingKey)} {disabled && <span className="text-xs text-theme-muted ml-2">(Disabled)</span>}</div>
                    <label className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="checkbox" checked={isEnabled} disabled={disabled} onChange={(e) => handleChange(e.target.checked)} className="sr-only peer" />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-theme-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                    </label>
                </div>
            );
        }

        // Arrays
        if (Array.isArray(value)) {
            return (
                <div className="space-y-3">
                    <input defaultValue={value.join(", ")} onBlur={(e) => updateValue(fieldKey, e.target.value.split(",").filter(i => i !== ""))} disabled={disabled} className={commonInputClass} placeholder="Enter comma-separated values" />
                    {value.length > 0 && <div className="flex flex-wrap gap-2 p-3 bg-theme-bg rounded-lg border border-theme">{value.map((item, idx) => <span key={idx} className="px-3 py-1 bg-theme-primary/20 text-theme-primary rounded-full text-sm border border-theme-primary/30 font-mono">{item}</span>)}</div>}
                </div>
            );
        }

        // Default
        return <input type="text" value={stringValue} onChange={(e) => updateValue(fieldKey, e.target.value)} disabled={disabled} className={commonInputClass} />;
    };

    return (
        <div id={uniqueId} className={`border border-theme rounded-xl p-4 bg-theme-card/50 shadow-sm ${isWide ? 'xl:col-span-2' : ''}`}>
            <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0"> {/* FIX: Removed overflow-hidden, added min-w-0 */}
                        <label className="text-sm font-semibold text-theme-text truncate" title={getDisplayName(settingKey)}>{getDisplayName(settingKey)}</label>
                        {tooltips[settingKey] && (
                            <Tooltip text={tooltips[settingKey]}>
                                <HelpCircle className="w-3.5 h-3.5 text-theme-muted hover:text-theme-primary cursor-help flex-shrink-0 transition-colors" />
                            </Tooltip>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-bg px-1.5 py-0.5 rounded border border-theme/50 select-all">{settingKey}</span>
                        {/* JUMP BUTTON */}
                        {searchQuery && (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleJumpToSetting(groupName, settingKey); }}
                                className="text-theme-primary hover:text-theme-text hover:bg-theme-hover p-1 rounded-full transition-all"
                                title="Show in context"
                            >
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
                {renderInput()}

                {/* Injected Fields */}
                {settingKey === "basicAuthPassword" && groupName === "WebUI Settings" && (
                    <div className="mt-4 pt-4 border-t border-theme/30">
                        <label className="text-sm font-medium text-theme-text block mb-2">WebUI Log Level</label>
                        <select value={webuiLogLevel} onChange={(e) => updateWebuiLogLevel(e.target.value)} className={commonInputClass}>
                            {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                )}
                {settingKey === "UseJellyfin" && (groupName.includes("Jellyfin")) && (
                    <div className="mt-4 pt-4 border-t border-theme/30 flex items-center justify-between">
                        <div><span className="text-sm font-medium text-theme-text block">Use JellySync</span><span className="text-xs text-theme-muted">UI Only (Disabled when Jellyfin is active)</span></div>
                        <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={useJellySync} onChange={(e) => setUseJellySync(e.target.checked)} disabled={value === "true" || value === true} className="sr-only peer" /><div className="w-9 h-5 bg-gray-600 rounded-full peer-checked:bg-theme-primary peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div></label>
                    </div>
                )}
                {settingKey === "UseEmby" && (groupName.includes("Emby")) && (
                    <div className="mt-4 pt-4 border-t border-theme/30 flex items-center justify-between">
                        <div><span className="text-sm font-medium text-theme-text block">Use EmbySync</span><span className="text-xs text-theme-muted">UI Only (Disabled when Emby is active)</span></div>
                        <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={useEmbySync} onChange={(e) => setUseEmbySync(e.target.checked)} disabled={value === "true" || value === true} className="sr-only peer" /><div className="w-9 h-5 bg-gray-600 rounded-full peer-checked:bg-theme-primary peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div></label>
                    </div>
                )}
            </div>
        </div>
    );
};

// Tooltip Component
const Tooltip = ({ text, children }) => {
    if (!text) return children;
    return (
      <div className="group relative inline-flex items-center">
        {children}
        <div className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[100] w-64">
          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-gray-700 relative text-center">
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45"></div>
            {text}
          </div>
        </div>
      </div>
    );
};

const ApiKeyManager = () => {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newKeyName, setNewKeyName] = useState("");
    const [generatedKey, setGeneratedKey] = useState(null);

    const [deleteId, setDeleteId] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const { showSuccess, showError } = useToast();
    const { t } = useTranslation();

    // Get current origin (e.g., http://192.168.1.50:8000)
    const origin = window.location.origin;
    const displayKey = generatedKey || "YOUR_KEY";

    const fetchKeys = async () => {
        try {
            const res = await fetch("/api/auth/keys");
            if (res.ok) {
                const data = await res.json();
                setKeys(data.keys || []);
            }
        } catch (e) { console.error(e); }
    };

    useEffect(() => { fetchKeys(); }, []);

    // Robust Copy Function with Fallback for HTTP
    const handleCopy = async (text, label) => {
        try {
            // Try modern API first
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                showSuccess(`${label} copied to clipboard!`);
            } else {
                throw new Error("Clipboard API unavailable");
            }
        } catch (err) {
            // Fallback for HTTP/Non-secure contexts
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;

                // Ensure it's not visible but part of the DOM
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    showSuccess(`${label} copied to clipboard!`);
                } else {
                    showError("Failed to copy text manually.");
                }
            } catch (fallbackErr) {
                showError("Could not copy text. Browser restrictions may apply.");
            }
        }
    };

    const handleCreate = async () => {
        if (!newKeyName) return;
        setLoading(true);
        try {
            const res = await fetch("/api/auth/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newKeyName })
            });
            const data = await res.json();
            if (data.success) {
                setGeneratedKey(data.key);
                setNewKeyName("");
                fetchKeys();
                showSuccess(t("apiKeys.toastGenerated"));
            }
        } catch (e) { showError(t("apiKeys.toastFailed")); }
        setLoading(false);
    };

    const requestDelete = (id) => {
        setDeleteId(id);
        setShowDeleteConfirm(true);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            await fetch(`/api/auth/keys/${deleteId}`, { method: "DELETE" });
            fetchKeys();
            showSuccess(t("apiKeys.toastRevoked"));
        } catch (e) {
            showError(t("apiKeys.toastRevokeError"));
        } finally {
            setShowDeleteConfirm(false);
            setDeleteId(null);
        }
    };

    return (
        <div className="mt-8 pt-6 border-t border-theme/30">
            <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2 mb-4">
                <Key className="w-5 h-5 text-theme-primary" /> {t("apiKeys.title")}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Generator Section */}
                <div className="bg-theme-bg/50 p-4 rounded-xl border border-theme/50">
                    <h4 className="text-sm font-medium text-theme-text mb-3">{t("apiKeys.generateTitle")}</h4>
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            placeholder={t("apiKeys.namePlaceholder")}
                            className="bg-theme-card border border-theme/50 text-theme-text rounded-lg px-3 py-2 flex-1 text-sm focus:outline-none focus:border-theme-primary focus:ring-1 focus:ring-theme-primary"
                        />
                        <button
                            onClick={handleCreate}
                            disabled={!newKeyName || loading}
                            className="bg-theme-primary hover:bg-theme-primary/90 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 className="animate-spin w-4 h-4"/> : <Plus className="w-4 h-4"/>} {t("apiKeys.generateButton")}
                        </button>
                    </div>

                    {generatedKey && (
                        <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg animate-in fade-in slide-in-from-top-2 mb-4">
                            <p className="text-green-400 text-xs font-bold mb-2">{t("apiKeys.generatedSuccess")}</p>
                            <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-green-500/20">
                                <code className="flex-1 text-green-300 font-mono text-sm break-all">{generatedKey}</code>
                                <button
                                    onClick={() => handleCopy(generatedKey, "API Key")}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title="Copy Key"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Dynamic URL Helpers */}
                    <div className="space-y-3 pt-2 border-t border-theme/20">
                        <div>
                            <span className="text-[10px] text-theme-muted uppercase tracking-wider font-bold block mb-1">Radarr / Sonarr Webhook</span>
                            <div className="flex items-center gap-2 bg-theme-bg/50 p-1.5 rounded border border-theme/30">
                                <code className="flex-1 text-[10px] text-theme-text font-mono truncate">
                                    {origin}/api/webhook/arr?api_key={displayKey}
                                </code>
                                <button
                                    onClick={() => handleCopy(`${origin}/api/webhook/arr?api_key=${displayKey}`, "Webhook URL")}
                                    className="text-theme-muted hover:text-theme-primary transition-colors"
                                >
                                    <Copy className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        <div>
                            <span className="text-[10px] text-theme-muted uppercase tracking-wider font-bold block mb-1">Tautulli Webhook</span>
                            <div className="flex items-center gap-2 bg-theme-bg/50 p-1.5 rounded border border-theme/30">
                                <code className="flex-1 text-[10px] text-theme-text font-mono truncate">
                                    {origin}/api/webhook/tautulli?api_key={displayKey}
                                </code>
                                <button
                                    onClick={() => handleCopy(`${origin}/api/webhook/tautulli?api_key=${displayKey}`, "Webhook URL")}
                                    className="text-theme-muted hover:text-theme-primary transition-colors"
                                >
                                    <Copy className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* List Section */}
                <div className="bg-theme-bg/30 p-4 rounded-xl border border-theme/30 flex flex-col">
                    <h4 className="text-sm font-medium text-theme-text mb-3">{t("apiKeys.activeKeys")}</h4>
                    <div className="space-y-2 flex-1 overflow-y-auto max-h-[200px] pr-1 custom-scrollbar">
                        {keys.map(k => (
                            <div key={k.id} className="flex items-center justify-between bg-theme-card p-3 rounded-lg border border-theme/50 hover:border-theme-primary/30 transition-colors group">
                                <div className="min-w-0">
                                    <div className="font-medium text-theme-text text-sm truncate flex items-center gap-2">
                                        {k.name}
                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-theme-bg border border-theme/30 font-mono text-theme-muted">{k.prefix}***</span>
                                    </div>
                                    <div className="text-[11px] text-theme-muted mt-0.5">
                                        {t("apiKeys.lastUsed")}: {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : t("apiKeys.never")}
                                    </div>
                                </div>
                                <button onClick={() => requestDelete(k.id)} className="text-theme-muted hover:text-red-400 p-2 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                        {keys.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-theme-muted py-4">
                                <Key className="w-8 h-8 mb-2 opacity-20" />
                                <span className="text-xs italic">{t("apiKeys.noKeys")}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ConfirmDialog
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={confirmDelete}
                title={t("apiKeys.revokeTitle")}
                message={t("apiKeys.revokeMessage")}
                confirmText={t("apiKeys.revokeConfirm")}
                type="danger"
            />
        </div>
    );
};
export default ConfigEditor;
