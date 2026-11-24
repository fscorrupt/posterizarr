import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  Folder,
  ImageIcon,
  Loader2,
  Search,
  ChevronRight,
  Home,
  ChevronDown,
  RefreshCw,
  Trash2,
  Check,
  CheckSquare,
  Square,
  Eye,
  ArrowUpDown,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import CompactImageSizeSlider from "./CompactImageSizeSlider";
import ConfirmDialog from "./ConfirmDialog";
import ImagePreviewModal from "./ImagePreviewModal";
import ScrollToButtons from "./ScrollToButtons";
import AssetReplacer from "./AssetReplacer";
import { buildResponsiveGridClass } from "../utils/gridClass";

const API_URL = "/api";

function FolderView() {
  const { t } = useTranslation();
  const location = useLocation();
  const { showSuccess, showError } = useToast();
  const lastGlobalSearchTsRef = useRef(null);

  // Navigation and data state
  const [currentPath, setCurrentPath] = useState(""); // e.g., "Collections/Movies"
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [cacheBuster, setCacheBuster] = useState(Date.now());

  // Search history to preserve filters per folder
  const searchHistoryRef = useRef({});

  // --- SORTING STATE ---
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem("folder-sort-order") || "name_asc";
  });
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef(null);

  // Helper to encode path segments but keep slashes
  const safeEncodePath = (path) => {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  };

  useEffect(() => {
    localStorage.setItem("folder-sort-order", sortOrder);
  }, [sortOrder]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target)
      ) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sorting Helper
  const sortItems = (itemsToSort) => {
    const sorted = [...itemsToSort];
    sorted.sort((a, b) => {
      if (sortOrder === "name_asc") return a.name.localeCompare(b.name);
      if (sortOrder === "name_desc") return b.name.localeCompare(a.name);

      // Folder items might not have modified dates, handle gracefully
      const dateA = a.modified || a.created || 0;
      const dateB = b.modified || b.created || 0;

      if (sortOrder === "date_newest") return dateB - dateA;
      if (sortOrder === "date_oldest") return dateA - dateB;

      return 0;
    });
    return sorted;
  };

  // Bulk delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Asset replacer state
  const [replacerOpen, setReplacerOpen] = useState(false);
  const [assetToReplace, setAssetToReplace] = useState(null);

  // Image size state
  const [imageSize, setImageSize] = useState(() => {
    const saved = localStorage.getItem("gallery-folder-size");
    const parsed = saved ? parseInt(saved) : 5;
    return Math.min(Math.max(parsed, 2), 20);
  });

  useEffect(() => {
    localStorage.setItem("gallery-folder-size", imageSize);
  }, [imageSize]);

  // Fetch data from the new recursive API
  const fetchData = async (
    path,
    showToast = false,
    keepScrollPosition = false
  ) => {
    if (!keepScrollPosition) {
      setLoading(true);
      // ONLY clear selection if this is a "hard" load (new folder/view)
      // If we are keeping scroll position (silent refresh), we keep selection too.
      setSelectMode(false);
      setSelectedAssets(new Set());
    }
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/folder-view/browse?path=${encodeURIComponent(path)}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setItems(data.items || []);
        setCurrentPath(data.path || "");
        if (showToast) {
          showSuccess(`Loaded content for ${data.path || "root"}`);
        }
      } else {
        throw new Error(data.error || "Failed to load folder items");
      }
    } catch (err) {
      console.error("Error fetching folder items:", err);
      setError(err.message);
      showError(err.message);
    } finally {
      if (!keepScrollPosition) {
        setLoading(false);
      }
    }
  };

  // Initial load
  useEffect(() => {
    const initialFolder = location.state?.globalSearchFolder || "";
    const initialTerm = location.state?.globalSearchTerm;
    if (initialFolder || initialTerm !== undefined) {
      lastGlobalSearchTsRef.current = location.state?.ts || `${initialFolder}:${initialTerm || ""}`;
    }
    if (typeof initialTerm === "string") {
      setSearchTerm(initialTerm);
    }
    fetchData(initialFolder);
  }, []);

  useEffect(() => {
    const stateTerm = location.state?.globalSearchTerm;
    const stateFolder = location.state?.globalSearchFolder;
    if (stateTerm === undefined && stateFolder === undefined) return;
    const jumpTs = location.state?.ts || `${stateFolder || ""}:${stateTerm || ""}`;
    if (lastGlobalSearchTsRef.current === jumpTs) return;
    lastGlobalSearchTsRef.current = jumpTs;
    if (typeof stateTerm === "string") {
      setSearchTerm(stateTerm);
    }
    if (typeof stateFolder === "string") {
      fetchData(stateFolder);
    }
  }, [location.state]);

  // Enhanced navigation that handles search term persistence
  const handleNavigation = (path) => {
    // Save current search term for the current path before we move away
    searchHistoryRef.current[currentPath] = searchTerm;

    // Determine the search term for the new path
    // If we've been there before (e.g. going back), restore it.
    // If it's a new folder, default to empty "" (clear filter).
    const nextSearchTerm = searchHistoryRef.current[path] || "";

    // Update search state immediately
    setSearchTerm(nextSearchTerm);

    // Fetch data for the new path
    fetchData(path);
  };

  // Handle navigation (Updated to use handleNavigation)
  const navigateTo = (path) => {
    handleNavigation(path);
  };

  // Handle breadcrumb navigation (Updated to use handleNavigation)
  const navigateToBreadcrumb = (index) => {
    if (index < 0) {
      handleNavigation(""); // Go home
      return;
    }
    const pathParts = currentPath.split("/");
    const newPath = pathParts.slice(0, index + 1).join("/");
    handleNavigation(newPath);
  };

  // Bulk delete actions
  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedAssets(new Set());
  };

  const toggleAssetSelection = (assetPath) => {
    setSelectedAssets((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assetPath)) {
        newSet.delete(assetPath);
      } else {
        newSet.add(assetPath);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const allAssetPaths = filteredItems
      .filter((item) => item.type === "asset")
      .map((item) => item.path);
    if (selectedAssets.size === allAssetPaths.length) {
      setSelectedAssets(new Set());
    } else {
      setSelectedAssets(new Set(allAssetPaths));
    }
  };

  const bulkDeleteAssets = async () => {
    if (selectedAssets.size === 0) return;
    setDeleteConfirm({
      bulk: true,
      count: selectedAssets.size,
      onConfirm: async () => {
        try {
          const response = await fetch(`${API_URL}/gallery/bulk-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: Array.from(selectedAssets) }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.detail || "Bulk delete failed");
          if (data.failed?.length > 0) {
            showError(
              `Deleted ${data.deleted.length}, but ${data.failed.length} failed.`
            );
          } else {
            showSuccess(`Successfully deleted ${data.deleted.length} asset(s)`);
          }
          fetchData(currentPath); // Refresh
        } catch (error) {
          showError(`Bulk delete failed: ${error.message}`);
        }
      },
    });
  };

  // Single asset delete
  const deleteAsset = (asset) => {
    setDeleteConfirm({
      bulk: false,
      name: asset.name,
      onConfirm: async () => {
        try {
          // FIX: Use safeEncodePath instead of encodeURIComponent
          const response = await fetch(
            `${API_URL}/gallery/${safeEncodePath(asset.path)}`,
            {
              method: "DELETE",
            }
          );

          if (!response.ok) {
            // Fix: Check for JSON content type before parsing to avoid syntax errors
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const data = await response.json();
              throw new Error(data.detail || "Failed to delete asset");
            } else {
              throw new Error(`Server returned status ${response.status}`);
            }
          }

          showSuccess(`Deleted "${asset.name}"`);

          // Refresh the data
          if (currentPath) {
            fetchData(currentPath);
          }
        } catch (error) {
          console.error(error);
          showError(`Failed to delete: ${error.message}`);
        }
      },
    });
  };

  // Get asset type badge color
  const getAssetTypeBadgeColor = (type) => {
    switch (type) {
      case "poster":
        return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "background":
        return "bg-pink-500/20 text-pink-400 border-pink-500/50";
      case "season":
        return "bg-indigo-500/20 text-indigo-400 border-indigo-500/50";
      case "titlecard":
        return "bg-cyan-500/20 text-cyan-400 border-cyan-500/50";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  // Get asset aspect ratio
  const getAssetAspectRatio = (type) => {
    switch (type) {
      case "background":
      case "titlecard":
        return "aspect-[16/9]";
      case "poster":
      case "season":
      default:
        return "aspect-[2/3]";
    }
  };

  const getGridClass = (size) => buildResponsiveGridClass(size);

  // Filter items based on search
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Split AND Sort
  const folderItems = sortItems(
    filteredItems.filter((item) => item.type === "folder")
  );
  const assetItems = sortItems(
    filteredItems.filter((item) => item.type === "asset")
  );

  return (
    <div className="space-y-6">
      <ScrollToButtons />

      {/* Navigation and Controls */}
      <div className="bg-theme-card border border-theme rounded-lg p-4 space-y-4">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigateToBreadcrumb(-1)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
              currentPath === ""
                ? "bg-theme-primary text-white scale-105"
                : "bg-theme-hover hover:bg-theme-primary/70 border border-theme text-theme-text"
            }`}
          >
            <Home className="w-4 h-4" />
            <span>{t("galleryHub.assetsRoot")}</span>
          </button>
          {currentPath.split("/").map(
            (part, index) =>
              part && (
                <React.Fragment key={index}>
                  <ChevronRight className="w-4 h-4 text-theme-muted" />
                  <button
                    onClick={() => navigateToBreadcrumb(index)}
                    className={`px-3 py-2 rounded-lg transition-all text-sm font-medium ${
                      index === currentPath.split("/").length - 1
                        ? "bg-theme-primary text-white scale-105"
                        : "bg-theme-hover hover:bg-theme-primary/70 border border-theme text-theme-text"
                    }`}
                  >
                    {part}
                  </button>
                </React.Fragment>
              )
          )}
        </div>

        {/* Search and Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="relative flex-1 w-full min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted" />
            <input
              type="text"
              placeholder={t("galleryHub.searchCurrentFolder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2 bg-theme-bg border border-theme rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary text-sm text-theme-text"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-theme-muted hover:text-theme-text"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-col items-center mr-2 relative group">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
                  {t("imageSizeSlider.imageSize")}
                </span>
                <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-theme-primary text-white text-[10px] font-black shadow-sm shadow-theme-primary/20">
                  {imageSize}
                </span>
              </div>
              <CompactImageSizeSlider
                value={imageSize}
                onChange={setImageSize}
                storageKey="gallery-folder-size"
              />
            </div>
            {assetItems.length > 0 && (
              <button
                onClick={toggleSelectMode}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                  selectMode
                    ? "bg-orange-600 hover:bg-orange-700 text-white"
                    : "bg-theme-primary hover:bg-theme-primary/90 text-white"
                }`}
              >
                {selectMode ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <CheckSquare className="w-4 h-4" />
                )}
                <span>
                  {selectMode ? t("folderView.cancelSelect") : t("folderView.select")}
                </span>
              </button>
            )}

            {/* Sorting Dropdown */}
            <div className="relative" ref={sortDropdownRef}>
              <button
                onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                title={t("common.sorting.title")}
              >
                <ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-theme-primary" />
                <span className="hidden sm:inline">
                  {sortOrder.includes("date")
                    ? t("common.date")
                    : t("common.name")}
                </span>
              </button>

              {sortDropdownOpen && (
                <div className="absolute z-50 right-0 top-full mt-2 w-48 bg-theme-card border border-theme-primary/50 rounded-lg shadow-xl overflow-hidden">
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setSortOrder("name_asc");
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        sortOrder === "name_asc"
                          ? "bg-theme-primary/20 text-theme-primary"
                          : "text-theme-text hover:bg-theme-hover"
                      }`}
                    >
                      {t("common.sorting.nameAsc")}
                    </button>
                    <button
                      onClick={() => {
                        setSortOrder("name_desc");
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        sortOrder === "name_desc"
                          ? "bg-theme-primary/20 text-theme-primary"
                          : "text-theme-text hover:bg-theme-hover"
                      }`}
                    >
                      {t("common.sorting.nameDesc")}
                    </button>
                    <div className="border-t border-theme-border my-1"></div>
                    <button
                      onClick={() => {
                        setSortOrder("date_newest");
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        sortOrder === "date_newest"
                          ? "bg-theme-primary/20 text-theme-primary"
                          : "text-theme-text hover:bg-theme-hover"
                      }`}
                    >
                      {t("common.sorting.dateNewest")}
                    </button>
                    <button
                      onClick={() => {
                        setSortOrder("date_oldest");
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        sortOrder === "date_oldest"
                          ? "bg-theme-primary/20 text-theme-primary"
                          : "text-theme-text hover:bg-theme-hover"
                      }`}
                    >
                      {t("common.sorting.dateOldest")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => fetchData(currentPath, true)}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
            >
              <RefreshCw
                className={`w-4 h-4 text-theme-primary ${
                  loading ? "animate-spin" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectMode && (
          <div className="pt-4 border-t border-theme flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-3 py-2 bg-theme-hover hover:bg-theme-primary/20 border border-theme rounded-lg transition-all font-medium text-sm"
              >
                {selectedAssets.size === assetItems.length ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <CheckSquare className="w-4 h-4" />
                )}
                <span>
                  {selectedAssets.size === assetItems.length
                    ? t("gallery.deselectAll")
                    : t("gallery.selectAll")}
                </span>
              </button>
              <span className="text-sm text-theme-text">
                {t("gallery.selected", { count: selectedAssets.size })}
              </span>
            </div>
            <button
              onClick={bulkDeleteAssets}
              disabled={selectedAssets.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all font-medium shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              {t("gallery.deleteSelected", { count: selectedAssets.size })}
            </button>
          </div>
        )}
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-20 bg-theme-card border border-red-500/30 rounded-lg">
          <div className="flex justify-center mb-4">
            {/* Using standard lucide icon here if AlertCircle isn't imported, but assuming standard imports */}
            <Trash2 className="w-12 h-12 text-red-400" />
          </div>
          <p className="text-red-400">{error}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20 bg-theme-card border border-theme rounded-lg">
          <Search className="w-12 h-12 text-theme-muted mx-auto mb-4" />
          <p className="text-theme-muted">{t("galleryHub.noItemsFound")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Folders */}
          {folderItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-theme-text px-1">
                {t("galleryHub.folders")} ({folderItems.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {folderItems.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigateTo(item.path)}
                    className="group relative bg-theme-card border border-theme rounded-lg p-4 transition-all text-left shadow-sm hover:shadow-md hover:border-theme-primary"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg border border-theme group-hover:bg-theme-primary group-hover:border-theme-primary transition-colors">
                        <Folder className="w-6 h-6 text-theme-muted group-hover:text-white transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-theme-text truncate mb-1">
                          {item.name}
                        </h3>
                        <span className="text-xs text-theme-muted">
                          {item.item_count} {t("galleryHub.items")}
                        </span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-theme-muted flex-shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assets */}
          {assetItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-theme-text px-1">
                {t("galleryHub.assets")} ({assetItems.length})
              </h3>
              <div className={`grid ${getGridClass(imageSize)} gap-4`}>
                {assetItems.map((asset) => (
                  <div
                    key={asset.path}
                    className={`relative group bg-theme-card border rounded-lg overflow-hidden transition-all shadow-sm ${
                      selectMode && selectedAssets.has(asset.path)
                        ? "ring-2 ring-theme-primary border-theme-primary"
                        : "border-theme hover:border-theme-primary/50"
                    }`}
                  >
                    {/* Select Checkbox */}
                    {selectMode && (
                      <div
                        className="absolute top-2 left-2 z-10 cursor-pointer"
                        onClick={() => toggleAssetSelection(asset.path)}
                      >
                        <div
                          className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-all ${
                            selectedAssets.has(asset.path)
                              ? "bg-theme-primary border-theme-primary"
                              : "bg-white/90 border-gray-300"
                          }`}
                        >
                          {selectedAssets.has(asset.path) && (
                            <Check className="w-4 h-4 text-white" />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Image */}
                    <div
                      className={`${getAssetAspectRatio(
                        asset.asset_type
                      )} bg-theme-bg-dark relative cursor-pointer overflow-hidden`}
                      onClick={() => {
                        if (selectMode) {
                          toggleAssetSelection(asset.path);
                        } else {
                          setSelectedImage(asset);
                        }
                      }}
                    >
                      <img
                        src={`/api/thumbnail?path=${encodeURIComponent(asset.url)}&t=${cacheBuster}`}
                        alt={asset.name}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Eye className="w-6 h-6 text-white drop-shadow-lg" />
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p
                        className="text-xs text-theme-text font-semibold truncate mb-1"
                        title={asset.name}
                      >
                        {asset.name}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-theme-muted">
                          {(asset.size / 1024).toFixed(0)} KB
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${getAssetTypeBadgeColor(
                            asset.asset_type
                          )}`}
                        >
                          {asset.asset_type.charAt(0).toUpperCase() +
                            asset.asset_type.slice(1)}
                        </span>
                      </div>
                      {!selectMode && (
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => setSelectedImage(asset)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-theme-bg hover:bg-theme-hover border border-theme rounded text-xs transition-all"
                          >
                            <Eye className="w-3 h-3" />
                            {t("common.view")}
                          </button>
                          <button
                            onClick={() => deleteAsset(asset)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded text-xs transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            {t("common.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog and Modals (unchanged) */}
      {deleteConfirm && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => {
            deleteConfirm.onConfirm();
            setDeleteConfirm(null);
          }}
          title={
            deleteConfirm.bulk
              ? t("gallery.deleteMultipleTitle")
              : t("gallery.deletePosterTitle")
          }
          message={
            deleteConfirm.bulk
              ? t("gallery.deleteMultipleMessage", {
                  count: deleteConfirm.count,
                })
              : t("gallery.deletePosterMessage")
          }
          itemName={deleteConfirm.bulk ? undefined : deleteConfirm.name}
          confirmText={t("common.delete")}
          type="danger"
        />
      )}

      {selectedImage && (
        <ImagePreviewModal
          selectedImage={selectedImage}
          onClose={() => setSelectedImage(null)}
          onDelete={deleteAsset}
          onReplace={(image) => {
            setAssetToReplace(image);
            setReplacerOpen(true);
          }}
          isDeleting={false}
          cacheBuster={cacheBuster}
          formatDisplayPath={(p) => p}
          formatTimestamp={() => new Date().toLocaleString("sv-SE")}
          getMediaType={(p, n) => selectedImage.full_type}
          getTypeColor={(t) => getAssetTypeBadgeColor(selectedImage.asset_type)}
        />
      )}

      {replacerOpen && assetToReplace && (
        <AssetReplacer
          asset={assetToReplace}
          onClose={() => {
            setReplacerOpen(false);
            setAssetToReplace(null);
          }}
          onSuccess={() => {
            setCacheBuster(Date.now());
            setReplacerOpen(false);
            setAssetToReplace(null);
            setSelectedImage(null);
            showSuccess(
              t("gallery.assetReplaced") || "Asset replaced successfully."
            );
            setTimeout(() => {
              fetchData(currentPath, false, true);
            }, 500);
          }}
        />
      )}
    </div>
  );
}

export default FolderView;
