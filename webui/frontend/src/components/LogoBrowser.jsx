import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Film,
  Tv,
  RefreshCw,
  Search,
  Upload,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import LogoSearchModal from "./LogoSearchModal";
import { buildResponsiveGridClass } from "../utils/gridClass";

const API_URL = "/api";

const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
  const { t } = useTranslation();

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;
    const half = Math.floor(maxPagesToShow / 2);

    if (totalPages <= maxPagesToShow + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
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

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
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
          <span
            key={`ellipsis-${index}`}
            className="w-10 h-10 flex items-center justify-center text-theme-muted"
          >
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
  const { showSuccess, showError, showWarning } = useToast();

  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  
  const [libraries, setLibraries] = useState([]);
  const [activeLibrary, setActiveLibrary] = useState(null);
  
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  
  const [page, setPage] = useState(1);
  const limit = 50;

  const [selectedItemForLogo, setSelectedItemForLogo] = useState(null);
  const [showLogoSearch, setShowLogoSearch] = useState(false);

  // Fetch servers from config
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_URL}/config`);
      const data = await res.json();
      
      const availableServers = [];
      const root = data._root || {};
      
      if (root.use_plex) availableServers.push({ id: "plex", name: "Plex", url: root.plexurl, token: root.plextoken });
      if (root.use_jellyfin) availableServers.push({ id: "jellyfin", name: "Jellyfin", url: root.jellyfinurl, token: root.jellyfintoken });
      if (root.use_emby) availableServers.push({ id: "emby", name: "Emby", url: root.embyurl, token: root.embytoken });
      
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
    if (activeServer) {
      fetchLibraries(activeServer);
    }
  }, [activeServer]);

  const fetchLibraries = async (server) => {
    try {
      setLibraries([]);
      setActiveLibrary(null);
      setItems([]);
      
      const res = await fetch(`${API_URL}/libraries/${server.id}/cached`);
      const data = await res.json();
      if (data.success && data.libraries) {
        setLibraries(data.libraries);
      }
    } catch (e) {
      showError(`Failed to load libraries for ${server.name}`);
    }
  };

  // Fetch items when library or page changes
  useEffect(() => {
    if (activeServer && activeLibrary) {
      fetchItems();
    }
  }, [activeLibrary, page]);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const res = await fetch(`${API_URL}/media-server/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_type: activeServer.id,
          url: activeServer.url,
          token: activeServer.token,
          library_id: activeLibrary.key || activeLibrary.id || activeLibrary.name, // Fallbacks
          start: (page - 1) * limit,
          limit: limit
        })
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        if (data.total !== undefined) {
            setTotalItems(data.total);
        } else {
            setTotalItems(data.items.length === limit ? page * limit + 1 : (page - 1) * limit + data.items.length);
        }
      } else {
        showError(data.error || "Failed to load items");
      }
    } catch (e) {
      showError("Failed to fetch items");
    } finally {
      setLoadingItems(false);
    }
  };

  const handleLibraryClick = (lib) => {
    fetchLiveLibraries(activeServer, lib);
  };
  
  const fetchLiveLibraries = async (server, targetLib) => {
      try {
          const res = await fetch(`${API_URL}/libraries/${server.id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: server.url, token: server.token })
          });
          const data = await res.json();
          if (data.success && data.libraries) {
              const matched = data.libraries.find(l => l.name === targetLib.name);
              if (matched) {
                  setActiveLibrary(matched);
                  setPage(1);
              } else {
                  showWarning("Library not found on server");
              }
          }
      } catch (e) {
          showError("Failed to fetch live libraries");
      }
  };

  const handleUploadLogo = async (logoUrl) => {
    setShowLogoSearch(false);
    const loadingToastId = showWarning(`Uploading logo for ${selectedItemForLogo.title}...`, { autoClose: false });
    
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
        fetchItems(); // Refresh items to show new logo
      } else {
        showError(data.error || "Failed to upload logo");
      }
    } catch (e) {
      showError("Error uploading logo");
    }
  };

  const totalPages = Math.ceil(totalItems / limit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-theme-primary to-theme-secondary flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-theme-primary" />
            Media Server Logo Browser
          </h2>
          <p className="text-theme-muted mt-1">
            Browse and replace logos directly on your media servers.
          </p>
        </div>
      </div>

      {/* Server Picker */}
      {servers.length > 1 && (
        <div className="flex gap-2">
          {servers.map((server) => (
            <button
              key={server.id}
              onClick={() => setActiveServer(server)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeServer?.id === server.id
                  ? "bg-theme-primary text-white"
                  : "bg-theme-card text-theme-text hover:bg-theme-hover"
              }`}
            >
              {server.name}
            </button>
          ))}
        </div>
      )}
      
      {/* Library Picker */}
      {libraries.length > 0 && (
        <div className="bg-theme-bg p-4 rounded-xl border border-theme">
            <h3 className="text-sm font-semibold mb-3 text-theme-muted">Select Library</h3>
            <div className="flex flex-wrap gap-2">
            {libraries.map((lib) => (
                <button
                key={lib.name}
                onClick={() => handleLibraryClick(lib)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeLibrary?.name === lib.name
                    ? "bg-theme-secondary text-white"
                    : "bg-theme-card text-theme-text hover:bg-theme-hover border border-theme"
                }`}
                >
                <FolderOpen className="w-4 h-4" />
                {lib.name}
                </button>
            ))}
            </div>
        </div>
      )}

      {/* Items Grid */}
      {activeLibrary && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-theme-primary" />
              {activeLibrary.name}
              <span className="text-sm text-theme-muted font-normal bg-theme-bg px-2 py-0.5 rounded-full border border-theme">
                {totalItems} items
              </span>
            </h3>
            
            <button
              onClick={fetchItems}
              disabled={loadingItems}
              className="p-2 bg-theme-card hover:bg-theme-hover border border-theme rounded-lg text-theme-text transition-colors"
              title="Refresh Items"
            >
              <RefreshCw className={`w-4 h-4 ${loadingItems ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loadingItems ? (
            <div className="py-12 flex flex-col items-center justify-center text-theme-muted">
              <Loader2 className="w-8 h-8 animate-spin text-theme-primary mb-4" />
              <p>Loading items from {activeServer?.name}...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-theme-muted bg-theme-bg/50 rounded-xl border border-theme border-dashed">
              <Film className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No items found in this library.</p>
            </div>
          ) : (
            <>
              <div className={buildResponsiveGridClass({ size: 100 })}>
                {items.map((item) => (
                  <div
                    key={item.ratingKey}
                    className="group bg-theme-card rounded-xl overflow-hidden border border-theme hover:border-theme-primary/50 transition-all hover:shadow-lg hover:shadow-theme-primary/10 flex flex-col"
                  >
                    <div className="aspect-[16/9] bg-theme-bg relative flex items-center justify-center p-4">
                        {item.hasLogo && item.logoUrl ? (
                            <img src={item.logoUrl} alt={item.title} className="w-full h-full object-contain filter drop-shadow-md" />
                        ) : (
                            <div className="text-center text-theme-muted opacity-50">
                                <ImageIcon className="w-8 h-8 mx-auto mb-2" />
                                <span className="text-xs">No Logo</span>
                            </div>
                        )}
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-theme-bg/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                                onClick={() => {
                                    setSelectedItemForLogo(item);
                                    setShowLogoSearch(true);
                                }}
                                className="px-4 py-2 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg font-medium shadow-lg transition-transform transform scale-95 group-hover:scale-100 flex items-center gap-2"
                            >
                                <Search className="w-4 h-4" />
                                Replace Logo
                            </button>
                        </div>
                    </div>
                    
                    <div className="p-3 bg-theme-card border-t border-theme flex-1 flex flex-col justify-between">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate text-theme-text" title={item.title}>
                            {item.title}
                          </p>
                          <p className="text-xs text-theme-muted mt-0.5 flex items-center gap-1">
                            {item.year && <span>{item.year}</span>}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <PaginationControls
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}

      {showLogoSearch && selectedItemForLogo && (
        <LogoSearchModal
          isOpen={showLogoSearch}
          onClose={() => setShowLogoSearch(false)}
          query={selectedItemForLogo.title}
          mediaType={selectedItemForLogo.type === "movie" ? "movie" : "tv"}
          onSelectLogo={handleUploadLogo}
        />
      )}
    </div>
  );
};

export default LogoBrowser;
