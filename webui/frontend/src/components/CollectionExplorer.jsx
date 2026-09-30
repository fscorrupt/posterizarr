import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  Film,
  Tv,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  ArrowUpDown,
  Square,
  CheckSquare,
  Server,
  Loader2,
  X,
  Menu,
  UploadCloud,
  Layers,
  Eye,
  CheckCircle2,
  Check
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import CollectionLiveEditor from "./CollectionLiveEditor";
import CompactImageSizeSlider from "./CompactImageSizeSlider";
import ImagePreviewModal from "./ImagePreviewModal";
import { buildResponsiveGridClass } from "../utils/gridClass";

const API_URL = "/api";

const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) onPageChange(page);
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;
    const half = Math.floor(maxPagesToShow / 2);

    if (totalPages <= maxPagesToShow + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > half + 2) pages.push("...");
      let start = Math.max(2, currentPage - half);
      let end = Math.min(totalPages - 1, currentPage + half);
      if (currentPage <= half + 2) end = maxPagesToShow - 1;
      if (currentPage >= totalPages - half - 1) start = totalPages - maxPagesToShow + 2;
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - half - 1) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-8 pb-8">
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <ChevronLeft className="w-4 h-4" />
        {t("pagination.previous", "Previous")}
      </button>

      {getPageNumbers().map((page, index) =>
        typeof page === "number" ? (
          <button
            key={index}
            onClick={() => handlePageChange(page)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm font-semibold transition-all shadow-sm ${
              currentPage === page
                ? "bg-theme-primary text-white"
                : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text"
            }`}
          >
            {page}
          </button>
        ) : (
          <span key={`ellipsis-${index}`} className="w-10 h-10 flex items-center justify-center text-theme-muted">
            ...
          </span>
        )
      )}

      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {t("pagination.next", "Next")}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};

const CollectionExplorer = () => {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();

  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  
  const [libraries, setLibraries] = useState([]);
  const [activeLibrary, setActiveLibrary] = useState(null);
  
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  
  // Filtering & Pagination State
  const [searchTerm, setSearchTerm] = useState("");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [knownPlexLogos, setKnownPlexLogos] = useState({});
  const [checkingPlexLogos, setCheckingPlexLogos] = useState(false);
  const [plexLogosChecked, setPlexLogosChecked] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Sorting State
  const [sortOrder, setSortOrder] = useState("name_asc");
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef(null);
  const gridContainerRef = useRef(null);

  // Image Size Slider
  const [imageSize, setImageSize] = useState(() => {
    const saved = localStorage.getItem("logo-browser-image-size");
    const parsed = saved ? parseInt(saved) : 5;
    return Math.min(Math.max(parsed, 2), 20);
  });

  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showLiveEditor, setShowLiveEditor] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [updatedPosters, setUpdatedPosters] = useState({});
  const [cacheBuster, setCacheBuster] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Plex Diff & Push State
  const [syncFilter, setSyncFilter] = useState("all"); // "all" | "needs_push" | "synced" | "missing_local"
  const [pushingRatingKey, setPushingRatingKey] = useState(null);
  const [isBatchPushing, setIsBatchPushing] = useState(false);
  const [diffPreviewMode, setDiffPreviewMode] = useState({}); // { [ratingKey]: 'local' | 'server' }

  // Setup click outside for sort dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target)) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    localStorage.setItem("logo-browser-image-size", imageSize.toString());
  }, [imageSize]);

  const [appConfig, setAppConfig] = useState(null);

  // Fetch servers from config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_URL}/config`);
      const data = await res.json();
      
      const availableServers = [];
      const config = data.config || {};
      setAppConfig({ ...config, using_flat_structure: data.using_flat_structure });
      
      const usePlex = data.using_flat_structure ? config.UsePlex : config.PlexPart?.UsePlex;
      const useJellyfin = data.using_flat_structure ? config.UseJellyfin : config.JellyfinPart?.UseJellyfin;
      const useEmby = data.using_flat_structure ? config.UseEmby : config.EmbyPart?.UseEmby;
      
      const plexUrl = data.using_flat_structure ? config.PlexUrl : config.PlexPart?.PlexUrl;
      const jellyfinUrl = data.using_flat_structure ? config.JellyfinUrl : config.JellyfinPart?.JellyfinUrl;
      const embyUrl = data.using_flat_structure ? config.EmbyUrl : config.EmbyPart?.EmbyUrl;
      
      const plexToken = data.using_flat_structure ? config.PlexToken : config.ApiPart?.PlexToken;
      const jellyfinToken = data.using_flat_structure ? config.JellyfinAPIKey : config.ApiPart?.JellyfinAPIKey;
      const embyToken = data.using_flat_structure ? config.EmbyAPIKey : config.ApiPart?.EmbyAPIKey;

      if (String(usePlex) === "true") availableServers.push({ id: "plex", name: "Plex", url: plexUrl, token: plexToken });
      if (String(useJellyfin) === "true") availableServers.push({ id: "jellyfin", name: "Jellyfin", url: jellyfinUrl, token: jellyfinToken });
      if (String(useEmby) === "true") availableServers.push({ id: "emby", name: "Emby", url: embyUrl, token: embyToken });
      
      setServers(availableServers);
      if (availableServers.length > 0) {
        setActiveServer(availableServers[0]);
      }
    } catch (e) {
      showError("Failed to load configuration");
    }
  };

  // Fetch libraries when active server changes
  useEffect(() => {
    if (activeServer && appConfig) {
      fetchLibraries(activeServer);
    }
  }, [activeServer, appConfig]);

  const fetchLibraries = async (server) => {
    try {
      setLibraries([]);
      setActiveLibrary(null);
      setItems([]);
      
      let exclusions = [];
      if (appConfig) {
        if (server.id === "plex") exclusions = appConfig.using_flat_structure ? (appConfig.PlexLibstoExclude || []) : (appConfig.PlexPart?.LibstoExclude || []);
        if (server.id === "jellyfin") exclusions = appConfig.using_flat_structure ? (appConfig.JellyfinLibstoExclude || []) : (appConfig.JellyfinPart?.LibstoExclude || []);
        if (server.id === "emby") exclusions = appConfig.using_flat_structure ? (appConfig.EmbyLibstoExclude || []) : (appConfig.EmbyPart?.LibstoExclude || []);
      }
      
      const res = await fetch(`${API_URL}/libraries/${server.id}/cached`);
      const data = await res.json();
      if (data.success && data.libraries) {
        // Prefer config exclusions if available, otherwise fallback to database
        const finalExclusions = exclusions.length > 0 ? exclusions : (data.excluded || []);
        const filteredLibs = data.libraries.filter(lib => !finalExclusions.includes(lib.name));
        
        if (filteredLibs.length > 0) {
          setLibraries(filteredLibs);
          setActiveLibrary(filteredLibs[0]);
        } else {
            // Fallback to all if everything is excluded somehow
            if (data.libraries.length > 0) {
                setLibraries(data.libraries);
                setActiveLibrary(data.libraries[0]);
            }
        }
      }
    } catch (e) {
      showError(`Failed to load libraries for ${server.name}`);
    }
  };

  // Fetch items when library changes
  useEffect(() => {
    if (activeServer && activeLibrary) {
      setPlexLogosChecked(false);
      setKnownPlexLogos({});
      fetchItems();
    }
  }, [activeLibrary]);

  const fetchItems = async (preserveState = false) => {
    setLoadingItems(true);
    if (!preserveState) {
        setSearchTerm("");
        setCurrentPage(1);
    }
    
    // Attempting to resolve the live library ID if it's not present (needed by backend)
    let libId = activeLibrary.key || activeLibrary.id;
    if (!libId) {
      try {
        const res = await fetch(`${API_URL}/libraries/${activeServer.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
                activeServer.id === "plex" 
                ? { url: activeServer.url, token: activeServer.token }
                : { url: activeServer.url, api_key: activeServer.token }
            )
        });
        const data = await res.json();
        if (data.success && data.libraries) {
            const matched = data.libraries.find(l => l.name === activeLibrary.name);
            if (matched) libId = matched.key || matched.id;
        }
      } catch(e) { }
    }
    
    try {
      const res = await fetch(`${API_URL}/media-server/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_type: activeServer.id,
          url: activeServer.url,
          token: activeServer.token,
          library_id: libId || activeLibrary.name, // Fallback to name if key fails
          start: 0,
          limit: 99999 // Fetch all to allow local searching and sorting like Gallery.jsx
        })
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
      } else {
        showError(data.error || "Failed to load items");
      }
    } catch (e) {
      showError("Failed to fetch items");
    } finally {
      setLoadingItems(false);
    }
  };

  const handleEditorClose = () => {
    setShowLiveEditor(false);
    if (selectedCollection?.ratingKey) {
      setUpdatedPosters((prev) => ({ ...prev, [selectedCollection.ratingKey]: Date.now() }));
    }
    setCacheBuster(Date.now());
    setTimeout(() => {
      fetchItems(true);
    }, 600);
  };

  const handleForceRefresh = () => {
    setCacheBuster(Date.now());
    setUpdatedPosters({});
    fetchItems(true);
  };
  // Removing handleUploadLogo body since CollectionLiveEditor handles saving

  // Reset page to 1 when search or sort or syncFilter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortOrder, showMissingOnly, syncFilter]);

  const isPlex = activeServer?.id === "plex";

  // Derive counts for Plex diff badges
  const needsPushItems = items.filter(
    (i) => (i.syncStatus === "update_available" || i.syncStatus === "missing_server") && i.hasLocalAsset
  );
  const syncedItems = items.filter((i) => i.syncStatus === "synced");
  const missingLocalItems = items.filter((i) => i.syncStatus === "missing_local" || !i.hasLocalAsset);

  const toggleDiffPreview = (ratingKey, currentlyLocal) => {
    setDiffPreviewMode((prev) => {
      const isLocal = prev[ratingKey] !== undefined ? prev[ratingKey] === "local" : currentlyLocal;
      return {
        ...prev,
        [ratingKey]: isLocal ? "server" : "local",
      };
    });
  };

  const handlePushSingle = async (item, e) => {
    if (e) e.stopPropagation();
    if (pushingRatingKey) return;
    setPushingRatingKey(item.ratingKey);
    try {
      const res = await fetch(`${API_URL}/plex/collections/push-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating_key: item.ratingKey,
          collection_name: item.title,
          local_path: item.localAssetPath,
          server_url: activeServer.url,
          server_token: activeServer.token,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Pushed artwork for "${item.title}" to Plex!`);
        const now = Date.now();
        setUpdatedPosters((prev) => ({ ...prev, [item.ratingKey]: now }));
        setItems((prev) =>
          prev.map((it) =>
            it.ratingKey === item.ratingKey
              ? { ...it, syncStatus: "synced", hasPoster: true }
              : it
          )
        );
        setTimeout(() => {
          fetchItems(true);
        }, 800);
      } else {
        showError(data.error || "Failed to push poster to Plex");
      }
    } catch (err) {
      showError("Error pushing poster to Plex");
    } finally {
      setPushingRatingKey(null);
    }
  };

  const handleMarkSynced = async (item, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${API_URL}/plex/collections/mark-synced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating_key: item.ratingKey,
          collection_name: item.title,
          local_path: item.localAssetPath,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Marked "${item.title}" as In-Sync!`);
        setItems((prev) =>
          prev.map((it) =>
            it.ratingKey === item.ratingKey
              ? { ...it, syncStatus: "synced" }
              : it
          )
        );
        setUpdatedPosters((prev) => ({ ...prev, [item.ratingKey]: Date.now() }));
      } else {
        showError(data.error || "Failed to mark as in-sync");
      }
    } catch (err) {
      showError("Error marking collection as in-sync");
    }
  };

  const handleOpenPreview = (item) => {
    const isPreviewingLocal = diffPreviewMode[item.ratingKey] !== undefined
      ? diffPreviewMode[item.ratingKey] === "local"
      : Boolean(item.hasLocalAsset && item.localPosterUrl);
    const activeUrl = isPreviewingLocal
      ? (item.localPosterUrl || item.posterUrl)
      : (item.posterUrl || item.localPosterUrl);
    const libraryTitle = activeLibrary?.name || "Collections";
    const displayPath = item.localAssetPath || `Collections\\${libraryTitle}\\${item.title}\\${item.localFilename || 'poster.png'}`;

    setPreviewImage({
      url: activeUrl,
      name: item.localFilename || "poster.png",
      title: item.title,
      show_name: item.title,
      collection_name: item.title,
      path: displayPath,
      type: "Collection",
      library: activeLibrary?.name || "",
      created: item.localCreated || null,
      modified: item.localMtime || null,
      size: item.localSize || null,
      summary: item.summary || "",
      itemCount: item.itemCount !== undefined && item.itemCount !== null ? item.itemCount : item.childCount,
      year: item.year || "",
      ratingKey: item.ratingKey,
      plexWebUrl: item.plexWebUrl,
      plexLocalUrl: item.plexLocalUrl,
      webUrl: item.webUrl || item.plexWebUrl,
      serverType: activeServer?.id,
      serverUrl: activeServer?.url,
      machineIdentifier: item.machineIdentifier,
      _originalItem: item,
    });
  };

  const handleDeleteAsset = async (image) => {
    if (!image || !image.path) return;
    if (!window.confirm(`Are you sure you want to delete the local artwork for "${image.title || 'this collection'}"?`)) {
      return;
    }
    setIsDeletingAsset(true);
    try {
      const encodedPath = encodeURIComponent(image.path.replace(/\\/g, '/'));
      const res = await fetch(`${API_URL}/gallery/${encodedPath}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(t("gallery.posterDeleted", { name: image.name || "Collection poster" }));
        const targetRatingKey = image._originalItem?.ratingKey;
        if (targetRatingKey) {
          setItems(prev => prev.map(it => {
            if (it.ratingKey === targetRatingKey) {
              return {
                ...it,
                hasLocalAsset: false,
                localPosterUrl: null,
                localAssetPath: null,
                syncStatus: "missing_local"
              };
            }
            return it;
          }));
        }
        setPreviewImage(null);
      } else {
        throw new Error(data.detail || data.message || "Failed to delete poster");
      }
    } catch (err) {
      console.error("Error deleting collection poster:", err);
      showError(err.message || "Failed to delete collection poster");
    } finally {
      setIsDeletingAsset(false);
    }
  };

  const handlePushBatch = async () => {
    if (isBatchPushing || needsPushItems.length === 0) return;
    setIsBatchPushing(true);
    try {
      const res = await fetch(`${API_URL}/plex/collections/push-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: needsPushItems,
          server_url: activeServer.url,
          server_token: activeServer.token,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Successfully pushed ${data.pushed} collection(s) to Plex!`);
        if (data.failed > 0) {
          showInfo(`${data.failed} collection(s) failed. Check server logs.`);
        }
        const now = Date.now();
        const batchBust = {};
        needsPushItems.forEach((it) => {
          batchBust[it.ratingKey] = now;
        });
        setUpdatedPosters((prev) => ({ ...prev, ...batchBust }));
        setCacheBuster(now);
        setTimeout(() => {
          fetchItems(true);
        }, 1000);
      } else {
        showError(data.error || "Failed to batch push collections");
      }
    } catch (err) {
      showError("Error during batch push to Plex");
    } finally {
      setIsBatchPushing(false);
    }
  };

  // Derive Displayed Items
  const filteredItems = (items || []).filter((item) => {
    if (!item) return false;
    if (showMissingOnly) {
      let hasPoster = item.hasPoster;
      if (hasPoster && item.posterUrl) return false;
    }
    if (isPlex && syncFilter !== "all") {
      if (syncFilter === "needs_push") {
        if (!(item.syncStatus === "update_available" || item.syncStatus === "missing_server") || !item.hasLocalAsset)
          return false;
      } else if (syncFilter === "synced") {
        if (item.syncStatus !== "synced") return false;
      } else if (syncFilter === "missing_local") {
        if (item.syncStatus !== "missing_local" && item.hasLocalAsset) return false;
      }
    }
    const itemTitle = (item.title || "").toLowerCase();
    const query = (searchTerm || "").toLowerCase();
    return itemTitle.includes(query);
  });
  
  const sortedItems = [...filteredItems].sort((a, b) => {
    const titleA = (a?.title || "").toLowerCase();
    const titleB = (b?.title || "").toLowerCase();
    if (sortOrder === "name_asc") return titleA.localeCompare(titleB);
    if (sortOrder === "name_desc") return titleB.localeCompare(titleA);
    
    // Sort by Year as a pseudo-date fallback
    const yearA = parseInt(a?.year, 10) || 0;
    const yearB = parseInt(b?.year, 10) || 0;
    if (sortOrder === "date_newest") return yearB - yearA;
    if (sortOrder === "date_oldest") return yearA - yearB;
    return 0;
  });

  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedItems = sortedItems.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] overflow-hidden">
      
      {/* LEFT SIDEBAR (Mimicking Gallery Folders list) */}
      <div className={`w-full md:w-72 bg-theme-bg border-b md:border-b-0 md:border-r border-theme flex-col flex-shrink-0 md:h-full max-h-[45vh] md:max-h-none overflow-y-auto z-20 ${isSidebarOpen ? 'flex' : 'hidden md:flex'}`}>
        
        {/* Server Selector Top Block */}
        <div className="p-4 border-b border-theme bg-theme-card">
          <h2 className="text-lg font-bold flex items-center gap-2 text-theme-text mb-3">
            <Server className="w-5 h-5 text-theme-primary" />
            Media Servers
          </h2>
          {servers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {servers.map((server) => (
                <button
                  key={server.id}
                  onClick={() => setActiveServer(server)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                    activeServer?.id === server.id
                      ? "bg-theme-primary text-white"
                      : "bg-theme-bg text-theme-text hover:bg-theme-hover border border-theme"
                  }`}
                >
                  <Server className="w-4 h-4" />
                  {server.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-theme-muted">No servers configured.</p>
          )}
        </div>

        {/* Libraries List */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <h3 className="text-xs font-bold text-theme-muted uppercase tracking-wider mb-2 ml-1">
            Libraries
          </h3>
          <div className="flex flex-col gap-1">
            {libraries.map((lib) => (
              <button
                key={lib.name}
                onClick={() => setActiveLibrary(lib)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left shadow-sm ${
                  activeLibrary?.name === lib.name
                    ? "bg-theme-secondary text-white border border-theme-secondary"
                    : "bg-theme-card text-theme-text hover:bg-theme-hover border border-transparent"
                }`}
              >
                <Folder className="w-4 h-4 flex-shrink-0 opacity-70" />
                <span className="truncate">{lib.name}</span>
              </button>
            ))}
            {libraries.length === 0 && activeServer && (
              <p className="text-sm text-theme-muted p-2">No libraries found.</p>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT MAIN PANEL */}
      <div className="flex-1 flex flex-col overflow-hidden bg-theme-bg">
        {/* Top Controls Header */}
        <div className="p-4 border-b border-theme bg-theme-card shadow-sm z-10 flex flex-col gap-3">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="md:hidden p-2 bg-theme-card hover:bg-theme-hover border border-theme rounded-lg text-theme-text transition-colors shadow-sm"
                title="Toggle Sidebar"
              >
                <Menu className="w-5 h-5 text-theme-primary" />
              </button>
              <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-theme-primary to-theme-secondary flex items-center gap-2">
                <Layers className="w-6 h-6 text-theme-primary" />
                {activeLibrary ? activeLibrary.name : "Collection Explorer"}
                {activeLibrary && !loadingItems && (
                   <span className="text-sm text-theme-muted font-normal ml-2">
                     ({sortedItems.length} collections)
                   </span>
                )}
              </h2>
            </div>
            
            {/* Actions / Sorting / Sizing */}
            {activeLibrary && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Size Slider */}
                <div className="flex flex-col items-center mr-2 relative group">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
                      Size
                    </span>
                    <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-theme-primary text-white text-[10px] font-black shadow-sm">
                      {imageSize}
                    </span>
                  </div>
                  <CompactImageSizeSlider
                    value={imageSize}
                    onChange={setImageSize}
                    storageKey="logo-browser-image-size"
                  />
                </div>

                {/* Sorting */}
                <div className="relative" ref={sortDropdownRef}>
                  <button
                    onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                    className="flex items-center gap-2 px-3 py-2 bg-theme-bg hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                  >
                    <ArrowUpDown className="w-4 h-4 text-theme-primary" />
                    <span>Sort</span>
                  </button>

                  {sortDropdownOpen && (
                    <div className="absolute z-50 right-0 top-full mt-2 w-48 bg-theme-card border border-theme-primary/50 rounded-lg shadow-xl overflow-hidden">
                      <div className="py-1">
                        <button
                          onClick={() => { setSortOrder("name_asc"); setSortDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortOrder === "name_asc" ? "bg-theme-primary/20 text-theme-primary" : "text-theme-text hover:bg-theme-hover"}`}
                        >
                          Name (A-Z)
                        </button>
                        <button
                          onClick={() => { setSortOrder("name_desc"); setSortDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortOrder === "name_desc" ? "bg-theme-primary/20 text-theme-primary" : "text-theme-text hover:bg-theme-hover"}`}
                        >
                          Name (Z-A)
                        </button>
                        <div className="border-t border-theme-border my-1"></div>
                        <button
                          onClick={() => { setSortOrder("date_newest"); setSortDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortOrder === "date_newest" ? "bg-theme-primary/20 text-theme-primary" : "text-theme-text hover:bg-theme-hover"}`}
                        >
                          Newest Year
                        </button>
                        <button
                          onClick={() => { setSortOrder("date_oldest"); setSortDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortOrder === "date_oldest" ? "bg-theme-primary/20 text-theme-primary" : "text-theme-text hover:bg-theme-hover"}`}
                        >
                          Oldest Year
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {isPlex && needsPushItems.length > 0 && (
                  <button
                    onClick={handlePushBatch}
                    disabled={isBatchPushing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Push all collections that have new or updated local artwork to Plex"
                  >
                    {isBatchPushing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UploadCloud className="w-4 h-4" />
                    )}
                    Push All Out-of-Sync ({needsPushItems.length})
                  </button>
                )}

                <button
                  onClick={handleForceRefresh}
                  disabled={loadingItems}
                  className="flex items-center gap-2 px-3 py-2 bg-theme-bg hover:bg-theme-hover border border-theme hover:border-theme-primary/50 disabled:opacity-50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                  title="Reload collections and bypass cached images"
                >
                  <RefreshCw className={`w-4 h-4 text-theme-primary ${loadingItems ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            )}
          </div>

          {/* Search Bar & Filters */}
          {activeLibrary && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-theme-muted" />
                  <input
                    type="text"
                    placeholder="Search collections..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-primary transition-colors text-sm"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                    onClick={() => setShowMissingOnly(!showMissingOnly)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
                        showMissingOnly 
                        ? 'bg-theme-primary border-theme-primary text-white' 
                        : 'bg-theme-bg border-theme text-theme-text hover:bg-theme-hover'
                    }`}
                >
                    <Square className={`w-4 h-4 ${showMissingOnly ? 'hidden' : 'block'}`} />
                    <CheckSquare className={`w-4 h-4 ${showMissingOnly ? 'block' : 'hidden'}`} />
                    Missing Poster
                </button>
              </div>

              {/* Plex Sync Filter Tabs */}
              {isPlex && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-theme/40 text-xs">
                  <span className="text-theme-muted font-medium mr-1 text-[11px]">Sync Filter:</span>
                  <button
                    type="button"
                    onClick={() => setSyncFilter("all")}
                    className={`px-2.5 py-1 rounded-full font-medium transition-all ${
                      syncFilter === "all"
                        ? "bg-theme-primary text-white shadow-sm"
                        : "bg-theme-bg text-theme-muted hover:text-theme-text border border-theme"
                    }`}
                  >
                    All ({items.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncFilter("needs_push")}
                    className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1.5 ${
                      syncFilter === "needs_push"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-theme-bg text-amber-400 hover:bg-amber-500/10 border border-amber-500/30"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Needs Push ({needsPushItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncFilter("synced")}
                    className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1.5 ${
                      syncFilter === "synced"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-theme-bg text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    In Sync ({syncedItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncFilter("missing_local")}
                    className={`px-2.5 py-1 rounded-full font-medium transition-all ${
                      syncFilter === "missing_local"
                        ? "bg-neutral-600 text-white shadow-sm"
                        : "bg-theme-bg text-neutral-400 hover:text-theme-text border border-theme"
                    }`}
                  >
                    No Local Asset ({missingLocalItems.length})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scrollable Grid Area */}
        <div ref={gridContainerRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {checkingPlexLogos ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <Loader2 className="w-12 h-12 animate-spin mb-4 text-theme-primary" />
              <p className="text-lg font-medium text-theme-text">Scanning library for missing logos...</p>
              <p className="text-sm opacity-70 mt-1">This may take a few seconds.</p>
            </div>
          ) : !activeServer || !activeLibrary ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <ImageIcon className="w-16 h-16 opacity-20 mb-4" />
              <p>Select a server and library to view collections.</p>
            </div>
          ) : loadingItems ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <Loader2 className="w-10 h-10 animate-spin text-theme-primary mb-4" />
              <p>Loading collections from {activeLibrary.name}...</p>
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <Film className="w-16 h-16 opacity-20 mb-4" />
              <p>{searchTerm ? "No matching collections found." : "No collections found in this library."}</p>
            </div>
          ) : (
            <>
              <div className={`grid gap-4 ${buildResponsiveGridClass(imageSize)}`}>
                {displayedItems.map((item) => {
                  if (!item) return null;
                  const isExplicitLocal = diffPreviewMode[item.ratingKey] === "local";
                  const isExplicitServer = diffPreviewMode[item.ratingKey] === "server";
                  // When synced, default to the local asset to completely bypass media server requests and load instantly
                  const isPreviewingLocal = isExplicitLocal || (!isExplicitServer && item.syncStatus === "synced" && item.hasLocalAsset);
                  const rawPosterUrl = isPreviewingLocal && item.localPosterUrl ? item.localPosterUrl : item.posterUrl;
                  const buster = updatedPosters[item.ratingKey] || cacheBuster;
                  const currentPosterUrl = rawPosterUrl
                    ? (buster ? `${rawPosterUrl}${rawPosterUrl.includes("?") ? "&" : "?"}_cb=${buster}` : rawPosterUrl)
                    : rawPosterUrl;

                  return (
                    <div
                      key={item.ratingKey}
                      className="group bg-theme-card rounded-xl overflow-hidden border border-theme hover:border-theme-primary/50 transition-all hover:shadow-lg hover:shadow-theme-primary/10 flex flex-col relative"
                    >
                      <div className="aspect-[2/3] bg-theme-bg/50 relative flex items-center justify-center p-2">
                          {/* Sync Status Badge (Plex only) */}
                          {isPlex && (
                            <div className="absolute top-2 left-2 z-20 pointer-events-none">
                              {item.syncStatus === "synced" && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-950/90 text-green-300 border border-green-500/50 backdrop-blur-sm flex items-center gap-1 shadow">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                                  In Sync
                                </span>
                              )}
                              {item.syncStatus === "update_available" && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-950/90 text-yellow-300 border border-yellow-500/50 backdrop-blur-sm flex items-center gap-1 shadow">
                                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                                  Update Ready
                                </span>
                              )}
                              {item.syncStatus === "missing_server" && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-500/50 backdrop-blur-sm flex items-center gap-1 shadow">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                  Missing on Plex
                                </span>
                              )}
                              {(!item.hasLocalAsset || item.syncStatus === "missing_local") && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-900/90 text-neutral-400 border border-neutral-700/50 backdrop-blur-sm shadow">
                                  No Local Asset
                                </span>
                              )}
                            </div>
                          )}

                          {/* Diff Preview Switcher in top-right */}
                          {isPlex && item.hasLocalAsset && item.localPosterUrl && item.hasPoster && item.posterUrl && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDiffPreview(item.ratingKey, isPreviewingLocal);
                              }}
                              className={`absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded text-[9px] font-bold border backdrop-blur-md transition-all shadow ${
                                isPreviewingLocal
                                  ? "bg-theme-primary text-white border-theme-primary"
                                  : "bg-black/70 text-theme-muted border-white/20 hover:text-white"
                              }`}
                              title={`Currently viewing ${isPreviewingLocal ? "Local Asset" : "Plex Server Artwork"}. Click to toggle.`}
                            >
                              {isPreviewingLocal ? "LOCAL" : "SERVER"}
                            </button>
                          )}

                          {currentPosterUrl ? (
                              <img 
                                  src={currentPosterUrl} 
                                  alt={item.title} 
                                  className="w-full h-full object-cover filter drop-shadow-md rounded" 
                                  loading="lazy" 
                                  onError={(e) => {
                                      e.target.style.display = 'none';
                                      if (e.target.nextSibling) {
                                          e.target.nextSibling.style.display = 'block';
                                      }
                                  }}
                              />
                          ) : null}
                          
                          <div className="text-center text-theme-muted opacity-30" style={{ display: !currentPosterUrl ? 'block' : 'none' }}>
                              <ImageIcon className="w-8 h-8 mx-auto mb-1" />
                              <span className="text-[10px] uppercase font-bold tracking-wider">No Poster</span>
                          </div>
                          
                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-10 p-3">
                              <button
                                  onClick={() => {
                                      setSelectedCollection(item);
                                      setShowLiveEditor(true);
                                  }}
                                  className="w-full py-1.5 bg-theme-primary hover:bg-theme-primary-hover text-white text-xs rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center justify-center gap-1.5"
                              >
                                  <Search className="w-3.5 h-3.5" />
                                  Edit Poster
                              </button>
                              <button
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenPreview(item);
                                  }}
                                  className="w-full py-1.5 bg-theme-card/90 hover:bg-theme-card border border-theme text-theme-text text-xs rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center justify-center gap-1.5"
                                  title="View full artwork preview and details"
                              >
                                  <Eye className="w-3.5 h-3.5 text-theme-primary" />
                                  Asset Details
                              </button>
                              {isPlex && item.hasLocalAsset && (item.syncStatus === "update_available" || item.syncStatus === "missing_server") && (
                                  <div className="flex gap-1.5 w-full">
                                    <button
                                        onClick={(e) => handlePushSingle(item, e)}
                                        disabled={pushingRatingKey === item.ratingKey}
                                        className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                        {pushingRatingKey === item.ratingKey ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <UploadCloud className="w-3.5 h-3.5" />
                                        )}
                                        Push to Plex
                                    </button>
                                    <button
                                        onClick={(e) => handleMarkSynced(item, e)}
                                        className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center justify-center gap-1"
                                        title="Already matches Plex? Mark as In-Sync without re-uploading"
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                        In-Sync
                                    </button>
                                  </div>
                              )}
                          </div>
                      </div>
                      
                      <div className="p-2.5 bg-theme-card border-t border-theme flex flex-col justify-between flex-1">
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-semibold text-xs truncate text-theme-text flex-1" title={item.title}>
                              {item.title}
                            </p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenPreview(item);
                              }}
                              className="text-theme-muted hover:text-theme-primary p-0.5 rounded hover:bg-theme-bg/60 transition-colors shrink-0"
                              title="Asset Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-theme-muted opacity-80 truncate" title={item.summary || undefined}>
                              {item.itemCount !== undefined && item.itemCount !== null ? `${item.itemCount} ${item.itemCount === 1 ? 'item' : 'items'}` : ""}
                              {item.itemCount !== undefined && item.itemCount !== null && item.year ? " • " : ""}
                              {item.year || (item.itemCount === undefined || item.itemCount === null ? "Collection" : "")}
                            </span>
                            {isPlex && item.hasLocalAsset && (
                              <span className="text-[9px] text-theme-primary font-medium truncate max-w-[120px]" title={item.localAssetPath}>
                                Local ready
                              </span>
                            )}
                          </div>
                        </div>

                        {isPlex && item.hasLocalAsset && (item.syncStatus === "update_available" || item.syncStatus === "missing_server") && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              onClick={(e) => handlePushSingle(item, e)}
                              disabled={pushingRatingKey === item.ratingKey}
                              className="flex-1 py-1 px-2 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                              title="Push local collection poster to Plex"
                            >
                              {pushingRatingKey === item.ratingKey ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <UploadCloud className="w-3 h-3" />
                              )}
                              Push
                            </button>
                            <button
                              onClick={(e) => handleMarkSynced(item, e)}
                              className="py-1 px-2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                              title="Already matches Plex? Mark as in-sync without re-uploading"
                            >
                              <Check className="w-3 h-3" />
                              In-Sync
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  if (gridContainerRef.current) {
                    gridContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              />
            </>
          )}
        </div>
      </div>

      {showLiveEditor && selectedCollection && (
        <CollectionLiveEditor
          isOpen={showLiveEditor}
          onClose={handleEditorClose}
          collection={selectedCollection}
          libraryName={activeLibrary?.name}
          activeServer={activeServer}
        />
      )}

      {/* Asset Preview / Details Modal */}
      {previewImage && (
        <ImagePreviewModal
          selectedImage={previewImage}
          onClose={() => setPreviewImage(null)}
          onReplace={(img) => {
            const origItem = img._originalItem || items.find(c => c.ratingKey === img.ratingKey || c.title === img.title);
            setPreviewImage(null);
            if (origItem) {
              setSelectedCollection(origItem);
              setShowLiveEditor(true);
            }
          }}
          onDelete={previewImage._originalItem?.hasLocalAsset ? handleDeleteAsset : undefined}
          isDeleting={isDeletingAsset}
          cacheBuster={cacheBuster || Date.now()}
          formatDisplayPath={(p) => p}
          formatTimestamp={(p) => "Unknown"}
        />
      )}
    </div>
  );
};

export default CollectionExplorer;
