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
  X
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import LogoSearchModal from "./LogoSearchModal";
import CompactImageSizeSlider from "./CompactImageSizeSlider";
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

const LogoBrowser = () => {
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

  const [selectedItemForLogo, setSelectedItemForLogo] = useState(null);
  const [showLogoSearch, setShowLogoSearch] = useState(false);
  const [updatedLogos, setUpdatedLogos] = useState({});

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
            body: JSON.stringify({ url: activeServer.url, token: activeServer.token })
        });
        const data = await res.json();
        if (data.success && data.libraries) {
            const matched = data.libraries.find(l => l.name === activeLibrary.name);
            if (matched) libId = matched.key || matched.id;
        }
      } catch(e) { }
    }
    
    try {
      const res = await fetch(`${API_URL}/media-server/items`, {
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

  const handleUploadLogo = async (logoUrl) => {
    setShowLogoSearch(false);
    showInfo(`Uploading logo for ${selectedItemForLogo.title}...`, 3000);
    
    try {
      const res = await fetch(`${API_URL}/media-server/upload-logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_type: activeServer.id,
          url: activeServer.url,
          token: activeServer.token,
          item_id: selectedItemForLogo.ratingKey,
          logo_url: logoUrl
        })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Successfully updated logo for ${selectedItemForLogo.title}`);
        setUpdatedLogos(prev => ({ ...prev, [selectedItemForLogo.ratingKey]: Date.now() }));
        fetchItems(true); // Refresh items to show new logo, but preserve search and pagination
      } else {
        showError(data.error || "Failed to upload logo");
      }
    } catch (e) {
      showError("Error uploading logo");
    }
  };

  // Reset page to 1 when search or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortOrder, showMissingOnly]);

  // Derive Displayed Items
  const filteredItems = items.filter(item => {
    if (showMissingOnly && item.hasLogo && item.logoUrl) return false;
    return item.title.toLowerCase().includes(searchTerm.toLowerCase());
  });
  
  const sortedItems = [...filteredItems].sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    if (sortOrder === "name_asc") return titleA.localeCompare(titleB);
    if (sortOrder === "name_desc") return titleB.localeCompare(titleA);
    
    // Sort by Year as a pseudo-date fallback
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    if (sortOrder === "date_newest") return yearB - yearA;
    if (sortOrder === "date_oldest") return yearA - yearB;
    return 0;
  });

  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedItems = sortedItems.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      
      {/* LEFT SIDEBAR (Mimicking Gallery Folders list) */}
      <div className="w-72 bg-theme-bg border-r border-theme flex flex-col flex-shrink-0">
        
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
            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-theme-primary to-theme-secondary flex items-center gap-2">
              <ImageIcon className="w-6 h-6 text-theme-primary" />
              {activeLibrary ? activeLibrary.name : "Logo Browser"}
              {activeLibrary && !loadingItems && (
                 <span className="text-sm text-theme-muted font-normal ml-2">
                   ({sortedItems.length} items)
                 </span>
              )}
            </h2>
            
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

                <button
                  onClick={fetchItems}
                  disabled={loadingItems}
                  className="flex items-center gap-2 px-3 py-2 bg-theme-bg hover:bg-theme-hover border border-theme hover:border-theme-primary/50 disabled:opacity-50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                >
                  <RefreshCw className={`w-4 h-4 text-theme-primary ${loadingItems ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            )}
          </div>

          {/* Search Bar & Filters */}
          {activeLibrary && (
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-theme-muted" />
                  <input
                    type="text"
                    placeholder="Search logos..."
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
                    Missing Only
                </button>
            </div>
          )}
        </div>

        {/* Scrollable Grid Area */}
        <div ref={gridContainerRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {!activeServer || !activeLibrary ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <ImageIcon className="w-16 h-16 opacity-20 mb-4" />
              <p>Select a server and library to view logos.</p>
            </div>
          ) : loadingItems ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <Loader2 className="w-10 h-10 animate-spin text-theme-primary mb-4" />
              <p>Loading items from {activeLibrary.name}...</p>
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-theme-muted">
              <Film className="w-16 h-16 opacity-20 mb-4" />
              <p>{searchTerm ? "No matching items found." : "No items found in this library."}</p>
            </div>
          ) : (
            <>
              <div className={`grid gap-4 ${buildResponsiveGridClass(imageSize)}`}>
                {displayedItems.map((item) => (
                  <div
                    key={item.ratingKey}
                    className="group bg-theme-card rounded-xl overflow-hidden border border-theme hover:border-theme-primary/50 transition-all hover:shadow-lg hover:shadow-theme-primary/10 flex flex-col relative"
                  >
                    <div className="aspect-[16/9] bg-theme-bg/50 relative flex items-center justify-center p-2">
                        {item.hasLogo && item.logoUrl && (
                            <img 
                                src={updatedLogos[item.ratingKey] ? `${item.logoUrl}&t=${updatedLogos[item.ratingKey]}` : item.logoUrl} 
                                alt={item.title} 
                                className="w-full h-full object-contain filter drop-shadow-md" 
                                loading="lazy" 
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    if (e.target.nextSibling) {
                                        e.target.nextSibling.style.display = 'block';
                                    }
                                }}
                            />
                        )}
                        
                        <div className="text-center text-theme-muted opacity-30" style={{ display: (!item.hasLogo || !item.logoUrl) ? 'block' : 'none' }}>
                            <ImageIcon className="w-8 h-8 mx-auto mb-1" />
                            <span className="text-[10px] uppercase font-bold tracking-wider">No Logo</span>
                        </div>
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                            <button
                                onClick={() => {
                                    setSelectedItemForLogo(item);
                                    setShowLogoSearch(true);
                                }}
                                className="px-3 py-1.5 bg-theme-primary hover:bg-theme-primary-hover text-white text-sm rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center gap-1.5"
                            >
                                <Search className="w-3.5 h-3.5" />
                                Replace
                            </button>
                        </div>
                    </div>
                    
                    <div className="p-2.5 bg-theme-card border-t border-theme">
                      <p className="font-semibold text-xs truncate text-theme-text" title={item.title}>
                        {item.title}
                      </p>
                      <p className="text-[10px] text-theme-muted mt-0.5 opacity-70">
                        {item.year || "Unknown"}
                      </p>
                    </div>
                  </div>
                ))}
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

      {showLogoSearch && selectedItemForLogo && (
        <LogoSearchModal
          isOpen={showLogoSearch}
          onClose={() => setShowLogoSearch(false)}
          query={selectedItemForLogo.title}
          mediaType={selectedItemForLogo.type === "movie" ? "movie" : "tv"}
          favProvider={appConfig?.using_flat_structure ? appConfig?.FavProvider : appConfig?.ApiPart?.FavProvider}
          onSelectLogo={handleUploadLogo}
        />
      )}
    </div>
  );
};

export default LogoBrowser;
