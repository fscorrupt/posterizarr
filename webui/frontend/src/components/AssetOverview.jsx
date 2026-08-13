import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Globe,
  Database,
  Type,
  Edit,
  FileQuestion,
  RefreshCw,
  Loader2,
  Search,
  Replace,
  ChevronDown,
  CheckIcon,
  Star,
  ExternalLink,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  CheckCheck,
  X,
  Trash2,
  Tag,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import AssetReplacer from "./AssetReplacer";
import ScrollToButtons from "./ScrollToButtons";

// Helper function to detect provider from URL and return badge styling
const getProviderBadge = (url) => {
  if (!url || url === "false" || url === false) {
    return {
      name: "Missing",
      color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
      logo: null,
    };
  }

  const urlLower = url.toLowerCase();

  if (urlLower.includes("tmdb") || urlLower.includes("themoviedb")) {
    return {
      name: "TMDB",
      color:
        "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30",
      logo: "/tmdb.png",
    };
  } else if (urlLower.includes("tvdb") || urlLower.includes("thetvdb")) {
    return {
      name: "TVDB",
      color:
        "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30",
      logo: "/tvdb.png",
    };
  } else if (urlLower.includes("fanart")) {
    return {
      name: "Fanart.tv",
      color:
        "bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30",
      logo: "/fanart.png",
    };
  } else if (urlLower.includes("plex")) {
    return {
      name: "Plex",
      color:
        "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30",
      logo: "/plex.png",
    };
  } else if (urlLower.includes("imdb")) {
    return {
      name: "IMDb",
      color:
        "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30",
      logo: "/imdb.png",
    };
  } else {
    return {
      name: "Other",
      color:
        "bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-gray-500/30",
      logo: null,
    };
  }
};

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++ PAGINATION COMPONENT
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
  const { t } = useTranslation();

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5; // Max 5 page buttons (e.g., 1 ... 4 5 6 ... 10)
    const half = Math.floor(maxPagesToShow / 2);

    if (totalPages <= maxPagesToShow + 2) {
      // Show all pages if 7 or less
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      // Ellipsis after first page?
      if (currentPage > half + 2) {
        pages.push("...");
      }

      // Middle pages
      let start = Math.max(2, currentPage - half);
      let end = Math.min(totalPages - 1, currentPage + half);

      if (currentPage <= half + 2) {
        end = maxPagesToShow - 1;
      }
      if (currentPage >= totalPages - half - 1) {
        start = totalPages - maxPagesToShow + 2;
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      // Ellipsis before last page?
      if (currentPage < totalPages - half - 1) {
        pages.push("...");
      }

      // Show last page
      pages.push(totalPages);
    }

    return pages;
  };

  if (totalPages <= 1) {
    return null; // Don't show pagination if only one page
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <ChevronLeft className="w-4 h-4" />
        {t("pagination.previous")}
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
        {t("pagination.next")}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Asset Row Component - Memoized to prevent unnecessary re-renders
const AssetRow = React.memo(
  ({
    asset,
    tags,
    showName,
    onNoEditsNeeded,
    onUnresolve,
    onReplace,
    onDelete,
    onSkipMediaServer,
    onUnskip,
    onRefreshMetadata,
    isSkippedView,
    isSelected,
    onToggleSelection,
    showCheckbox,
    usePlex,
    useJellyfin,
    useEmby,
  }) => {
    const { t } = useTranslation();
    const [logoError, setLogoError] = useState(false);
    const [favLogoError, setFavLogoError] = useState(false);

    // Memoize badge computation based on DownloadSource
    const downloadBadge = useMemo(
      () => getProviderBadge(asset.DownloadSource),
      [asset.DownloadSource]
    );

    // Memoize badge for FavProviderLink
    const favProviderBadge = useMemo(
      () => getProviderBadge(asset.FavProviderLink),
      [asset.FavProviderLink]
    );

    // Check if asset is resolved (Manual = "Yes" or "true" for legacy)
    const isResolved =
      asset.Manual === "Yes" ||
      asset.Manual === "true" ||
      asset.Manual === true;

    return (
      <div className="bg-theme-bg border border-theme rounded-lg p-4 hover:border-theme-primary/50 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Checkbox Column */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {showCheckbox && (
              <div className="flex items-center pt-1">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelection(asset.id)}
                  className="w-4 h-4 rounded border-theme-muted bg-theme-bg text-theme-primary focus:ring-2 focus:ring-theme-primary focus:ring-offset-0 cursor-pointer"
                  title={t("assetOverview.selectAsset")}
                />
              </div>
            )}

            {/* Poster Thumbnail for Skipped View */}
            {isSkippedView && asset.server_type && asset.item_id && (
              <div className="hidden sm:block w-20 h-28 shrink-0 rounded overflow-hidden bg-theme-card border border-theme relative flex items-center justify-center">
                <img
                  src={`/api/proxy/poster?server_type=${asset.server_type}&item_id=${asset.item_id}`}
                  alt={asset.Title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-lg font-semibold text-theme-text break-words">
                  {showName ? (
                    <>
                      <span className="text-theme-primary">{showName}</span>
                      <span className="text-theme-muted mx-2">|</span>
                      <span>{asset.Title} {asset.year ? `(${asset.year})` : ''}</span>
                    </>
                  ) : (
                    <>{asset.Title} {asset.year ? `(${asset.year})` : ''}</>
                  )}
                </h3>
                {isSkippedView && asset.media_url && (
                  <a
                    href={asset.media_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1.5 text-theme-muted hover:text-theme-primary hover:bg-theme-primary/10 rounded transition-colors"
                    title={t("assetOverview.viewInMediaServer", { defaultValue: "View in Media Server" })}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-sm text-theme-muted">
                {/* Type */}
                <span className="font-medium">{t("assetOverview.type")}:</span>
                <span className="bg-theme-card px-2 py-0.5 rounded">
                  {asset.Type || "Unknown"}
                </span>
                {/* Language, Source, Fav Provider */}
                {!isSkippedView && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    {/* Language */}
                    {!(!asset.DownloadSource || asset.DownloadSource === "false" || asset.DownloadSource === false) && (
                      <>
                        <span className="font-medium">
                          {t("assetOverview.language")}:
                        </span>
                        <span className="bg-theme-card px-2 py-0.5 rounded">
                          {asset.Language &&
                          asset.Language !== "false" &&
                          asset.Language !== false
                            ? asset.Language
                            : "Unknown"}
                        </span>
                        <span className="hidden sm:inline">•</span>
                      </>
                    )}
                    {/* Source */}
                    <span className="font-medium">
                      {t("assetOverview.source")}:
                    </span>
                    {asset.DownloadSource &&
                    asset.DownloadSource !== "false" &&
                    asset.DownloadSource !== false ? (
                      <a
                        href={asset.DownloadSource}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                        title={asset.DownloadSource}
                      >
                        {downloadBadge.logo && !logoError ? (
                          <img
                            src={downloadBadge.logo}
                            alt={downloadBadge.name}
                            className="h-[35px] object-contain"
                            onError={() => setLogoError(true)}
                          />
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${downloadBadge.color}`}
                          >
                            {downloadBadge.name}
                          </span>
                        )}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${downloadBadge.color}`}
                      >
                        {downloadBadge.name}
                      </span>
                    )}
                    {/* Fav Provider */}
                    <span className="hidden sm:inline">•</span>
                    <span className="font-medium">
                      {t("assetOverview.favProvider")}:
                    </span>
                    {favProviderBadge.name === "Missing" ? (
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${favProviderBadge.color}`}
                      >
                        {favProviderBadge.name}
                      </span>
                    ) : (
                      <a
                        href={asset.FavProviderLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                        title={asset.FavProviderLink}
                      >
                        {favProviderBadge.logo && !favLogoError ? (
                          <img
                            src={favProviderBadge.logo}
                            alt={favProviderBadge.name}
                            className="h-[35px] object-contain"
                            onError={() => setFavLogoError(true)}
                          />
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${favProviderBadge.color}`}
                          >
                            {favProviderBadge.name}
                          </span>
                        )}
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    )}
                  </>
                )}
                {/* Timestamp */}
                {asset.created_at && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    <span className="font-medium">
                      {t("assetOverview.addedOn")}:
                    </span>
                    <span
                      className="bg-theme-card px-2 py-0.5 rounded"
                      title={asset.created_at}
                    >
                      {new Date(asset.created_at)
                        .toLocaleString("sv-SE")
                        .replace("T", " ")}
                    </span>
                  </>
                )}
              </div>
              {/* Description for Skipped View */}
              {isSkippedView && asset.overview && (
                <p className="mt-3 text-sm text-theme-text/80 line-clamp-2">
                  {asset.overview}
                </p>
              )}
              {/* Tags */}
              {!isSkippedView && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {tags.map((tag, index) => (
                    <span
                      key={index}
                      className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${tag.color}`}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-start gap-2">
            {isSkippedView ? (
              <>
                <button
                  onClick={() => onRefreshMetadata(asset.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 border border-theme-primary hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.refreshMetadataTooltip", { defaultValue: "Refresh Metadata" })}
                >
                  <RefreshCw className="w-4 h-4 text-theme-primary" />
                  {t("assetOverview.refreshMetadata", { defaultValue: "Refresh Metadata" })}
                </button>
                <button
                  onClick={() => onUnskip(asset)}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.unskipTooltip", { defaultValue: "Remove skip label from media server and restore item" })}
                >
                  <RefreshCw className="w-4 h-4 text-theme-primary" />
                  {t("assetOverview.unskipConfirm", { defaultValue: "Unskip" })}
                </button>
              </>
            ) : isResolved ? (
              // Resolved Asset Actions
              <>
                <button
                  onClick={() => onUnresolve(asset)}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.unresolveTooltip")}
                >
                  <Edit className="w-4 h-4 text-theme-primary" />
                  {t("assetOverview.unresolve")}
                </button>
                {(usePlex || useJellyfin || useEmby) && (
                  <button
                    onClick={() => onSkipMediaServer(asset)}
                    className="flex items-center justify-center p-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                    title={t("assetOverview.skipMediaServerTooltip")}
                  >
                    <Tag className="w-4 h-4 text-theme-primary" />
                  </button>
                )}
                {/* <-- UPDATED: Delete button for resolved assets --> */}
                <button
                  onClick={() => onDelete(asset)}
                  className="flex items-center justify-center p-2 bg-red-900/50 hover:bg-red-900/80 border border-red-500/30 hover:border-red-500/50 rounded-lg text-red-400 transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.deleteAssetTooltip")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              // Unresolved Asset Actions
              <>
                <button
                  onClick={() => onNoEditsNeeded(asset)}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.noEditsNeededTooltip")}
                >
                  <CheckIcon className="w-4 h-4 text-theme-primary" />
                  {t("assetOverview.noEditsNeeded")}
                </button>
                <button
                  onClick={() => onReplace(asset)}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.replaceTooltip")}
                >
                  <Replace className="w-4 h-4 text-theme-primary" />
                  {t("assetOverview.replace")}
                </button>
                {(usePlex || useJellyfin || useEmby) && (
                  <button
                    onClick={() => onSkipMediaServer(asset)}
                    className="flex items-center justify-center p-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all whitespace-nowrap shadow-sm"
                    title={t("assetOverview.skipMediaServerTooltip")}
                  >
                    <Tag className="w-4 h-4 text-theme-primary" />
                  </button>
                )}
                {/* <-- UPDATED: Delete button for unresolved assets --> */}
                <button
                  onClick={() => onDelete(asset)}
                  className="flex items-center justify-center p-2 bg-red-900/50 hover:bg-red-900/80 border border-red-500/30 hover:border-red-500/50 rounded-lg text-red-400 transition-all whitespace-nowrap shadow-sm"
                  title={t("assetOverview.deleteAssetTooltip")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

AssetRow.displayName = "AssetRow";

const AssetOverview = () => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("All Types");
  const [selectedLibrary, setSelectedLibrary] = useState("All Libraries");
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [selectedStatus, setSelectedStatus] = useState("Unresolved");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [showReplacer, setShowReplacer] = useState(false);

  // PAGINATION STATE
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    const saved = localStorage.getItem("asset-overview-items-per-page");
    return saved ? parseInt(saved) : 25;
  });

  // Selection state for bulk actions
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ Generic Confirmation Modal State
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const [confirmModalState, setConfirmModalState] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "",
    confirmColor: "primary", // "primary" or "danger"
    onConfirm: () => {},
  });
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // Dropdown states
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [libraryDropdownOpen, setLibraryDropdownOpen] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [itemsPerPageDropdownOpen, setItemsPerPageDropdownOpen] =
    useState(false);

  // Dropdown position states
  const [typeDropdownUp, setTypeDropdownUp] = useState(false);
  const [libraryDropdownUp, setLibraryDropdownUp] = useState(false);
  const [categoryDropdownUp, setCategoryDropdownUp] = useState(false);
  const [statusDropdownUp, setStatusDropdownUp] = useState(false);
  const [itemsPerPageDropdownUp, setItemsPerPageDropdownUp] = useState(false);

  // Refs for click outside detection
  const typeDropdownRef = useRef(null);
  const libraryDropdownRef = useRef(null);
  const categoryDropdownRef = useRef(null);
  const statusDropdownRef = useRef(null);
  const itemsPerPageDropdownRef = useRef(null);

  // Fetch data from API
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "active") {
        const response = await fetch("/api/assets/overview");
        if (!response.ok) throw new Error(t("assetOverview.fetchError"));
        const result = await response.json();
        setData(result);
      } else {
        const response = await fetch("/api/assets/skipped");
        if (!response.ok) throw new Error(t("assetOverview.fetchError"));
        const result = await response.json();
        setData({
          categories: {
            skipped: {
              count: result.length,
              assets: result,
            }
          }
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [t, activeTab]); // Added t and activeTab dependencies

  // Clear selection and reset page when filters change
  useEffect(() => {
    setSelectedAssetIds(new Set());
    setCurrentPage(1);
  }, [
    searchQuery,
    selectedType,
    selectedLibrary,
    selectedCategory,
    selectedStatus,
    itemsPerPage,
  ]);

  // Helper function to parse clean show name from Rootfolder
  const parseShowName = (rootfolder) => {
    if (!rootfolder) return null;
    const cleanName = rootfolder
      .replace(/\s*\[tvdb-[^\]]+\]/gi, "")
      .replace(/\s*\[tmdb-[^\]]+\]/gi, "")
      .replace(/\s*\[imdb-[^\]]+\]/gi, "")
      .trim();
    return cleanName;
  };

  // Function to calculate dropdown position
  const calculateDropdownPosition = (ref) => {
    if (!ref.current) return false;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    return spaceAbove > spaceBelow;
  };

  // Click outside detection for dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(event.target)
      ) {
        setTypeDropdownOpen(false);
      }
      if (
        libraryDropdownRef.current &&
        !libraryDropdownRef.current.contains(event.target)
      ) {
        setLibraryDropdownOpen(false);
      }
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target)
      ) {
        setCategoryDropdownOpen(false);
      }
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(event.target)
      ) {
        setStatusDropdownOpen(false);
      }
      if (
        itemsPerPageDropdownRef.current &&
        !itemsPerPageDropdownRef.current.contains(event.target)
      ) {
        setItemsPerPageDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle opening the replacer
  const handleReplace = async (asset) => {
    try {
      const response = await fetch(`/api/imagechoices/${asset.id}/find-asset`);
      if (!response.ok) {
        console.error("Failed to find asset file:", await response.text());
        constructAssetManually(asset);
        return;
      }
      const data = await response.json();
      if (data.success && data.asset) {
        const assetTypeRaw = (asset.Type || "").toLowerCase();
        let mediaType = "movie";
        if (
          assetTypeRaw.includes("show") ||
          assetTypeRaw.includes("series") ||
          assetTypeRaw.includes("episode") ||
          assetTypeRaw.includes("season") ||
          assetTypeRaw.includes("titlecard") ||
          assetTypeRaw.includes("tv")
        ) {
          mediaType = "tv";
        }
        const assetForReplacer = {
          id: asset.id,
          title: asset.Title,
          name: data.asset.name,
          path: data.asset.path,
          type: mediaType,
          library: data.asset.library,
          url: data.asset.url,
          _dbData: asset,
          _originalType: asset.Type,
        };
        setSelectedAsset(assetForReplacer);
        setShowReplacer(true);
      } else {
        console.error("Backend found no asset file");
        constructAssetManually(asset);
      }
    } catch (error) {
      console.error("Error finding asset:", error);
      constructAssetManually(asset);
    }
  };

  // Fallback: Manual path construction
  const constructAssetManually = (asset) => {
    console.warn("Using manual path construction as fallback");
    let fullPath;
    if (asset.Rootfolder) {
      const assetType = (asset.Type || "").toLowerCase();
      const title = asset.Title || "";
      let filename = "poster.jpg";
      if (assetType.includes("background")) {
        filename = "background.jpg";
      } else if (assetType.includes("season")) {
        const seasonMatch = title.match(/season\s*(\d+)/i);
        if (seasonMatch) {
          const seasonNum = seasonMatch[1].padStart(2, "0");
          filename = `Season${seasonNum}.jpg`;
        } else {
          filename = "Season01.jpg";
        }
      } else if (
        assetType.includes("titlecard") ||
        assetType.includes("episode")
      ) {
        const episodeMatch = title.match(/(S\d+E\d+)/i);
        if (episodeMatch) {
          const episodeCode = episodeMatch[1].toUpperCase();
          filename = `${episodeCode}.jpg`;
        } else {
          filename = "S01E01.jpg";
        }
      }
      fullPath = `${asset.LibraryName}/${asset.Rootfolder}/${filename}`;
    } else if (asset.Title) {
      const assetType = (asset.Type || "").toLowerCase();
      const filename = assetType.includes("background")
        ? "background.jpg"
        : "poster.jpg";
      fullPath = `${asset.LibraryName || "4K"}/${asset.Title}/${filename}`;
    } else {
      fullPath = `${asset.LibraryName || "4K"}/unknown.jpg`;
    }
    const assetTypeRaw = (asset.Type || "").toLowerCase();
    let mediaType = "movie";
    if (
      assetTypeRaw.includes("show") ||
      assetTypeRaw.includes("series") ||
      assetTypeRaw.includes("episode") ||
      assetTypeRaw.includes("season") ||
      assetTypeRaw.includes("titlecard") ||
      assetTypeRaw.includes("tv")
    ) {
      mediaType = "tv";
    }
    const assetForReplacer = {
      id: asset.id,
      title: asset.Title,
      name: fullPath.split("/").pop(),
      path: fullPath,
      type: mediaType,
      library: asset.LibraryName || "",
      url: `/poster_assets/${fullPath}`,
      _dbData: asset,
      _originalType: asset.Type,
    };
    setSelectedAsset(assetForReplacer);
    setShowReplacer(true);
  };

  // Handle successful replacement
  const handleReplaceSuccess = async (shouldRefresh = true) => {
    try {
      const response = await fetch(`/api/imagechoices/${selectedAsset.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        if (shouldRefresh) {
          await fetchData();
          window.dispatchEvent(new Event("assetReplaced"));
        }
      } else {
        console.error("Failed to delete DB entry:", response.status, await response.text());
      }
    } catch (error) {
      console.error("Error deleting DB entry:", error);
    }
    setShowReplacer(false);
    setSelectedAsset(null);
  };

  // Handle closing the replacer
  const handleCloseReplacer = () => {
    setShowReplacer(false);
    setSelectedAsset(null);
  };

  // Handle marking asset as "No Edits Needed"
  const handleNoEditsNeeded = async (asset) => {
    try {
      const updateRecord = {
        Title: asset.Title,
        Type: asset.Type || null,
        Rootfolder: asset.Rootfolder || null,
        LibraryName: asset.LibraryName || null,
        Language: asset.Language || null,
        Fallback: asset.Fallback || null,
        TextTruncated: asset.TextTruncated || null,
        DownloadSource: asset.DownloadSource || null,
        FavProviderLink: asset.FavProviderLink || null,
        Manual: "Yes",
      };
      const response = await fetch(`/api/imagechoices/${asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateRecord),
      });
      if (response.ok) {
        showSuccess(
          t("assetOverview.markedAsReviewed", { title: asset.Title })
        );
        await fetchData();
        window.dispatchEvent(new Event("assetReplaced"));
      } else {
        showError(t("assetOverview.updateFailed", { title: asset.Title }));
      }
    } catch (error) {
      showError(t("assetOverview.updateError", { error: error.message }));
    }
  };

  // Handle marking asset as "Unresolve"
  const handleUnresolve = async (asset) => {
    try {
      const updateRecord = {
        Title: asset.Title,
        Type: asset.Type || null,
        Rootfolder: asset.Rootfolder || null,
        LibraryName: asset.LibraryName || null,
        Language: asset.Language || null,
        Fallback: asset.Fallback || null,
        TextTruncated: asset.TextTruncated || null,
        DownloadSource: asset.DownloadSource || null,
        FavProviderLink: asset.FavProviderLink || null,
        Manual: "No",
      };
      const response = await fetch(`/api/imagechoices/${asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateRecord),
      });
      if (response.ok) {
        showSuccess(
          t("assetOverview.markedAsUnresolved", { title: asset.Title })
        );
        await fetchData();
        window.dispatchEvent(new Event("assetReplaced"));
      } else {
        showError(t("assetOverview.unresolveFailed", { title: asset.Title }));
      }
    } catch (error) {
      showError(t("assetOverview.unresolveError", { error: error.message }));
    }
  };

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ UPDATED: Single Asset Delete
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleDeleteAsset = (asset) => {
    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.deleteAssetTitle"),
      message: t("assetOverview.deleteAssetConfirm", { title: asset.Title }),
      confirmText: t("assetOverview.delete"),
      confirmColor: "danger",
      onConfirm: () => runDeleteAsset(asset.id),
    });
  };

  const handleSkipMediaServer = async (asset) => {
    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.skipTitle", { defaultValue: "Skip Asset" }),
      message: t("assetOverview.skipMessage", {
        defaultValue: `Are you sure you want to skip "${asset.Title}"? It will be ignored in future Posterizarr runs.`,
      }),
      confirmText: t("assetOverview.skipConfirm", { defaultValue: "Skip" }),
      confirmColor: "warning",
      onConfirm: async () => {
        setIsBulkProcessing(true);
        try {
          const response = await fetch(`/api/assets/skip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset_id: asset.id }),
          });

          if (!response.ok) throw new Error("Failed to skip asset");

          showSuccess(t("assetOverview.skipPlexSuccess"));
          await fetchData();
        } catch (error) {
          showError(
            t("assetOverview.skipPlexError", { error: error.message })
          );
        } finally {
          setIsBulkProcessing(false);
        }
      },
    });
  };

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ Handle Unskip Asset
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleUnskipAsset = async (asset) => {
    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.unskipTitle", { defaultValue: "Unskip Asset" }),
      message: t("assetOverview.unskipMessage", {
        defaultValue: `Are you sure you want to unskip "${asset.Title}"? It will be restored in Posterizarr on the next run.`,
      }),
      confirmText: t("assetOverview.unskipConfirm", { defaultValue: "Unskip" }),
      confirmColor: "primary",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/assets/unskip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              id: asset.id,
              item_id: asset.item_id,
              server_type: asset.server_type
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || "Failed to unskip asset");
          }
          
          showSuccess(t("assetOverview.unskipSuccess", { title: asset.Title }));
          await fetchData();
        } catch (error) {
          showError(
            t("assetOverview.unskipError", { error: error.message })
          );
        } finally {
          setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const runDeleteAsset = async (assetId) => {
    setIsBulkProcessing(true); // Use same processing flag
    try {
      const response = await fetch(`/api/assets/delete-asset/${assetId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        showSuccess(t("assetOverview.deleteSuccess"));
        await fetchData();
        window.dispatchEvent(new Event("assetReplaced")); // Update sidebar
      } else {
        const errorData = await response.json();
        showError(
          t("assetOverview.deleteFailed", {
            error: errorData.detail || "Unknown error",
          })
        );
      }
    } catch (error) {
      showError(
        t("assetOverview.deleteError", {
          error: error.message,
        })
      );
    } finally {
      setIsBulkProcessing(false);
      setConfirmModalState({ isOpen: false }); // Close modal
    }
  };
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // Items per page handler
  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value);
    localStorage.setItem("asset-overview-items-per-page", value.toString());
    setCurrentPage(1);
  };

  // Handle toggling selection of a single asset
  const handleToggleSelection = (assetId) => {
    setSelectedAssetIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assetId)) {
        newSet.delete(assetId);
      } else {
        newSet.add(assetId);
      }
      return newSet;
    });
  };

  // Handle selecting/deselecting all displayed assets
  const handleSelectAll = () => {
    if (
      selectedAssetIds.size === displayedAssets.length &&
      displayedAssets.length > 0
    ) {
      setSelectedAssetIds(new Set());
    } else {
      setSelectedAssetIds(new Set(displayedAssets.map((asset) => asset.id)));
    }
  };

  // Handle bulk mark as resolved (for selected items)
  const handleBulkMarkAsResolved = async () => {
    if (selectedAssetIds.size === 0) return;
    setIsBulkProcessing(true);
    const selectedAssets = allAssets.filter((asset) =>
      selectedAssetIds.has(asset.id)
    );

    try {
      let successCount = 0;
      let failCount = 0;
      for (const asset of selectedAssets) {
        try {
          const updateRecord = {
            Title: asset.Title,
            Type: asset.Type || null,
            Rootfolder: asset.Rootfolder || null,
            LibraryName: asset.LibraryName || null,
            Language: asset.Language || null,
            Fallback: asset.Fallback || null,
            TextTruncated: asset.TextTruncated || null,
            DownloadSource: asset.DownloadSource || null,
            FavProviderLink: asset.FavProviderLink || null,
            Manual: "Yes",
          };
          const response = await fetch(`/api/imagechoices/${asset.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateRecord),
          });
          if (response.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
        }
      }
      setSelectedAssetIds(new Set());
      await fetchData();
      window.dispatchEvent(new Event("assetReplaced"));

      if (successCount > 0 && failCount === 0) {
        showSuccess(
          t("assetOverview.bulkMarkSuccess", { count: successCount })
        );
      } else if (successCount > 0 && failCount > 0) {
        showSuccess(
          t("assetOverview.bulkMarkPartial", {
            success: successCount,
            failed: failCount,
          })
        );
      } else {
        showError(t("assetOverview.bulkMarkFailed"));
      }
    } catch (error) {
      showError(t("assetOverview.bulkMarkError", { error: error.message }));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ UPDATED: Bulk Delete (for selected items)
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleBulkDelete = () => {
    if (selectedAssetIds.size === 0) return;

    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.bulkDeleteTitle"),
      message: t("assetOverview.bulkDeleteConfirm", {
        count: selectedAssetIds.size,
      }),
      confirmText: t("assetOverview.deleteCount", {
        count: selectedAssetIds.size,
      }),
      confirmColor: "danger",
      onConfirm: runBulkDelete,
    });
  };

  const runBulkDelete = async () => {
    setIsBulkProcessing(true);
    setConfirmModalState({ isOpen: false }); // Close modal

    try {
      const response = await fetch("/api/assets/bulk-delete-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_ids: Array.from(selectedAssetIds) }),
      });

      const result = await response.json();

      if (response.ok) {
        if (result.failed_count > 0) {
          showError(
            t("assetOverview.bulkDeletePartial", {
              success: result.deleted_count,
              failed: result.failed_count,
            })
          );
        } else {
          showSuccess(
            t("assetOverview.bulkDeleteSuccess", {
              count: result.deleted_count,
            })
          );
        }
      } else {
        showError(
          t("assetOverview.bulkDeleteFailed", {
            error: result.detail || "Server error",
          })
        );
      }
    } catch (error) {
      showError(
        t("assetOverview.bulkDeleteError", {
          error: error.message,
        })
      );
    } finally {
      setSelectedAssetIds(new Set());
      await fetchData();
      window.dispatchEvent(new Event("assetReplaced")); // Update sidebar
      setIsBulkProcessing(false);
    }
  };
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ NEW: Bulk Refresh Metadata (for skipped items)
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleBulkRefreshMetadata = async (ids = Array.from(selectedAssetIds)) => {
    if (ids.length === 0) return;
    setIsBulkProcessing(true);

    try {
      const response = await fetch("/api/assets/skipped/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      if (response.ok) {
        showSuccess(t("assetOverview.refreshMetadataStarted", { defaultValue: "Metadata refresh started in background" }));
        setSelectedAssetIds(new Set());
      } else {
        showError(t("assetOverview.refreshMetadataFailed", { defaultValue: "Failed to start metadata refresh" }));
      }
    } catch (error) {
      showError(t("assetOverview.refreshMetadataError", { defaultValue: `Error: ${error.message}` }));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleRefreshAllMetadata = async () => {
    setIsBulkProcessing(true);
    try {
      const response = await fetch("/api/assets/skipped/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });

      if (response.ok) {
        showSuccess(t("assetOverview.refreshAllMetadataStarted", { defaultValue: "Refresh of all metadata started in background" }));
      } else {
        showError(t("assetOverview.refreshMetadataFailed", { defaultValue: "Failed to start metadata refresh" }));
      }
    } catch (error) {
      showError(t("assetOverview.refreshMetadataError", { defaultValue: `Error: ${error.message}` }));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ REFACTORED: Bulk Mark All Filtered (to use new modal)
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleBulkMarkAllFilteredAsResolved = () => {
    const assetsToProcess = filteredAssets;
    if (assetsToProcess.length === 0) {
      showError(t("assetOverview.noAssetsToMark"));
      return;
    }

    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.bulkMarkAllFilteredTitle"),
      message: t("assetOverview.bulkMarkAllFilteredConfirm", {
        count: assetsToProcess.length,
      }),
      confirmText: t("assetOverview.confirmMarkAll", {
        count: assetsToProcess.length,
      }),
      confirmColor: "primary",
      onConfirm: runBulkMarkAllFilteredResolved,
    });
  };

  const runBulkMarkAllFilteredResolved = async () => {
    setConfirmModalState({ isOpen: false });
    const assetsToProcess = filteredAssets;
    setIsBulkProcessing(true);

    try {
      let successCount = 0;
      let failCount = 0;

      for (const asset of assetsToProcess) {
        const isResolved =
          asset.Manual === "Yes" ||
          asset.Manual === "true" ||
          asset.Manual === true;
        if (isResolved) {
          successCount++;
          continue;
        }
        try {
          const updateRecord = {
            Title: asset.Title,
            Type: asset.Type || null,
            Rootfolder: asset.Rootfolder || null,
            LibraryName: asset.LibraryName || null,
            Language: asset.Language || null,
            Fallback: asset.Fallback || null,
            TextTruncated: asset.TextTruncated || null,
            DownloadSource: asset.DownloadSource || null,
            FavProviderLink: asset.FavProviderLink || null,
            Manual: "Yes",
          };
          const response = await fetch(`/api/imagechoices/${asset.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateRecord),
          });
          if (response.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
        }
      }

      setSelectedAssetIds(new Set());
      await fetchData();
      window.dispatchEvent(new Event("assetReplaced"));

      if (successCount > 0 && failCount === 0) {
        showSuccess(
          t("assetOverview.bulkMarkSuccess", { count: successCount })
        );
      } else if (successCount > 0 && failCount > 0) {
        showSuccess(
          t("assetOverview.bulkMarkPartial", {
            success: successCount,
            failed: failCount,
          })
        );
      } else {
        showError(t("assetOverview.bulkMarkFailed"));
      }
    } catch (error) {
      showError(t("assetOverview.bulkMarkError", { error: error.message }));
    } finally {
      setIsBulkProcessing(false);
    }
  };
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ NEW: Bulk Delete All Filtered (for all filtered items)
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const handleBulkDeleteAllFiltered = () => {
    const assetsToProcess = filteredAssets;
    if (assetsToProcess.length === 0) {
      showError(t("assetOverview.noAssetsToDelete"));
      return;
    }

    setConfirmModalState({
      isOpen: true,
      title: t("assetOverview.bulkDeleteAllFilteredTitle"),
      message: t("assetOverview.bulkDeleteAllFilteredConfirm", {
        count: assetsToProcess.length,
      }),
      confirmText: t("assetOverview.confirmDeleteAll", {
        count: assetsToProcess.length,
      }),
      confirmColor: "danger",
      onConfirm: runBulkDeleteAllFiltered,
    });
  };

  const runBulkDeleteAllFiltered = async () => {
    const assetsToProcess = filteredAssets;
    const recordIds = assetsToProcess.map(asset => asset.id);

    setConfirmModalState({ isOpen: false });
    setIsBulkProcessing(true);

    try {
      const response = await fetch("/api/assets/bulk-delete-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_ids: recordIds }),
      });

      const result = await response.json();

      if (response.ok) {
        if (result.failed_count > 0) {
          showError(
            t("assetOverview.bulkDeletePartial", {
              success: result.deleted_count,
              failed: result.failed_count,
            })
          );
        } else {
          showSuccess(
            t("assetOverview.bulkDeleteSuccess", {
              count: result.deleted_count,
            })
          );
        }
      } else {
        showError(
          t("assetOverview.bulkDeleteFailed", {
            error: result.detail || "Server error",
          })
        );
      }
    } catch (error) {
      showError(
        t("assetOverview.bulkDeleteError", {
          error: error.message,
        })
      );
    } finally {
      setSelectedAssetIds(new Set());
      await fetchData();
      window.dispatchEvent(new Event("assetReplaced")); // Update sidebar
      setIsBulkProcessing(false);
    }
  };
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // Get all assets from all categories
  const allAssets = useMemo(() => {
    if (!data) return [];
    const assets = new Map();
    Object.values(data.categories).forEach((category) => {
      category.assets.forEach((asset) => {
        if (!assets.has(asset.id)) {
          assets.set(asset.id, asset);
        }
      });
    });
    return Array.from(assets.values());
  }, [data]);

  // Get unique types and libraries for filters
  const types = useMemo(() => {
    let assetsToFilter = allAssets;
    if (selectedStatus === "Resolved") {
      assetsToFilter = assetsToFilter.filter(
        (asset) =>
          asset.Manual === "Yes" ||
          asset.Manual === "true" ||
          asset.Manual === true
      );
    } else if (selectedStatus === "Unresolved") {
      assetsToFilter = assetsToFilter.filter(
        (asset) =>
          !asset.Manual ||
          (asset.Manual !== "Yes" &&
            asset.Manual !== "true" &&
            asset.Manual !== true)
      );
    }
    const uniqueTypes = new Set(
      assetsToFilter.map((a) => a.Type).filter(Boolean)
    );
    return ["All Types", ...Array.from(uniqueTypes).sort()];
  }, [allAssets, selectedStatus]);

  const libraries = useMemo(() => {
    let assetsToFilter = allAssets;
    if (selectedStatus === "Resolved") {
      assetsToFilter = assetsToFilter.filter(
        (asset) =>
          asset.Manual === "Yes" ||
          asset.Manual === "true" ||
          asset.Manual === true
      );
    } else if (selectedStatus === "Unresolved") {
      assetsToFilter = assetsToFilter.filter(
        (asset) =>
          !asset.Manual ||
          (asset.Manual !== "Yes" &&
            asset.Manual !== "true" &&
            asset.Manual !== true)
      );
    }
    const uniqueLibs = new Set(
      assetsToFilter.map((a) => a.LibraryName).filter(Boolean)
    );
    return ["All Libraries", ...Array.from(uniqueLibs).sort()];
  }, [allAssets, selectedStatus]);

  // Category cards configuration
  const categoryCards = useMemo(() => {
    if (!data || activeTab === "skipped") return [];
    return [
      {
        key: "assets_with_issues",
        label: t("assetOverview.assetsWithIssues"),
        count: data.categories.assets_with_issues.count,
        icon: AlertTriangle,
        color: "text-yellow-400",
        bgColor: "bg-gradient-to-br from-yellow-900/30 to-yellow-950/20",
        borderColor: "border-yellow-900/40",
        hoverBorderColor: "hover:border-yellow-500/50",
      },
      {
        key: "missing_assets",
        label: t("assetOverview.missingAssets"),
        count: data.categories.missing_assets.count,
        icon: FileQuestion,
        color: "text-red-400",
        bgColor: "bg-gradient-to-br from-red-900/30 to-red-950/20",
        borderColor: "border-red-900/40",
        hoverBorderColor: "hover:border-red-500/50",
      },
      {
        key: "missing_assets_fav_provider",
        label: t("assetOverview.missingAssetsAtFavProvider"),
        count: data.categories.missing_assets_fav_provider.count,
        icon: Star,
        color: "text-orange-400",
        bgColor: "bg-gradient-to-br from-orange-900/30 to-orange-950/20",
        borderColor: "border-orange-900/40",
        hoverBorderColor: "hover:border-orange-500/50",
      },
      {
        key: "non_primary_lang",
        label: t("assetOverview.nonPrimaryLang"),
        count: data.categories.non_primary_lang.count,
        icon: Globe,
        color: "text-sky-400",
        bgColor: "bg-gradient-to-br from-sky-900/30 to-sky-950/20",
        borderColor: "border-sky-900/40",
        hoverBorderColor: "hover:border-sky-500/50",
      },
      {
        key: "non_primary_provider",
        label: t("assetOverview.nonPrimaryProvider"),
        count: data.categories.non_primary_provider.count,
        icon: Database,
        color: "text-emerald-400",
        bgColor: "bg-gradient-to-br from-emerald-900/30 to-emerald-950/20",
        borderColor: "border-emerald-900/40",
        hoverBorderColor: "hover:border-emerald-500/50",
      },
      {
        key: "truncated_text",
        label: t("assetOverview.truncatedTextCategory"),
        count: data.categories.truncated_text.count,
        icon: Type,
        color: "text-purple-400",
        bgColor: "bg-gradient-to-br from-purple-900/30 to-purple-950/20",
        borderColor: "border-purple-900/40",
        hoverBorderColor: "hover:border-purple-500/50",
      },
    ];
  }, [data, t]);

  // Filter assets based on selected category and filters
  const filteredAssets = useMemo(() => {
    if (!data) return [];
    let assets = [];
    if (selectedCategory === "All Categories") {
      assets = allAssets;
    } else {
      const categoryCard = categoryCards.find(
        (card) => card.label === selectedCategory
      );
      const categoryKey = categoryCard?.key;
      assets = categoryKey ? data.categories[categoryKey]?.assets || [] : [];
    }
    if (selectedStatus === "Resolved") {
      assets = assets.filter(
        (asset) =>
          asset.Manual === "Yes" ||
          asset.Manual === "true" ||
          asset.Manual === true
      );
    } else if (selectedStatus === "Unresolved") {
      assets = assets.filter(
        (asset) =>
          !asset.Manual ||
          (asset.Manual !== "Yes" &&
            asset.Manual !== "true" &&
            asset.Manual !== true)
      );
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      assets = assets.filter(
        (asset) =>
          asset.Title?.toLowerCase().includes(query) ||
          asset.Rootfolder?.toLowerCase().includes(query)
      );
    }
    if (selectedType !== "All Types") {
      assets = assets.filter((asset) => asset.Type === selectedType);
    }
    if (selectedLibrary !== "All Libraries") {
      assets = assets.filter((asset) => asset.LibraryName === selectedLibrary);
    }
    return assets;
  }, [
    data,
    selectedCategory,
    selectedStatus,
    searchQuery,
    selectedType,
    selectedLibrary,
    allAssets,
    categoryCards,
  ]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredAssets.length / itemsPerPage);
  const displayedAssets = filteredAssets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Get tags for an asset
  const getAssetTags = (asset) => {
    const tags = [];
    const downloadSource = asset.DownloadSource;
    const providerLink = asset.FavProviderLink;

    // --- Config Values ---
    // Safely access config values, handling potential snake_case from backend
    const logoLangOrder = data?.config?.logo_language_order || data?.config?.LogoLanguageOrder || [];
    const primaryProvider = (data?.config?.primary_provider || data?.config?.FavProvider || "").toLowerCase();

    // -------------------------------------------------------
    // 1. MISSING ASSET TAGS
    // -------------------------------------------------------
    // Check if asset is completely missing
    if (!downloadSource || downloadSource === "false" || downloadSource === false) {
      tags.push({
        label: t("assetOverview.missingAsset"), // "Missing Asset"
        color: "bg-red-500/20 text-red-400 border-red-500/30",
      });
    }

    // Check if link to favorite provider is missing
    if (!providerLink || providerLink === "false" || providerLink === false) {
      tags.push({
        label: t("assetOverview.missingLink"), // "Missing Link"
        color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      });
    }

    // -------------------------------------------------------
    // 2. POSTER PROVIDER LOGIC
    // -------------------------------------------------------
    if (downloadSource && downloadSource !== "false" && primaryProvider) {
      const providerPatterns = {
        tmdb: ["tmdb", "themoviedb"],
        tvdb: ["tvdb", "thetvdb"],
        fanart: ["fanart"],
        plex: ["plex"],
      };

      const patterns = providerPatterns[primaryProvider] || [primaryProvider];
      const isFromPrimary = patterns.some((pattern) =>
        downloadSource.toLowerCase().includes(pattern)
      );

      if (!isFromPrimary) {
        tags.push({
          label: t("assetOverview.notPrimaryProvider"), // "Not Primary Provider"
          color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
        });
      }
    }

    // -------------------------------------------------------
    // 3. LOGO TAGGING LOGIC (NEW)
    // -------------------------------------------------------
    const logoSource = asset.LogoSource;
    const logoLanguage = asset.LogoLanguage;
    const logoTextFallback = asset.LogoTextFallback;

    // A. Check if Logo is from Primary Provider
    if (logoSource && logoSource !== "false" && logoSource !== false && primaryProvider) {
      const providerPatterns = {
        tmdb: ["tmdb", "themoviedb"],
        tvdb: ["tvdb", "thetvdb"],
        fanart: ["fanart"],
        plex: ["plex"],
      };
      const patterns = providerPatterns[primaryProvider] || [primaryProvider];
      const isLogoFromPrimary = patterns.some((pattern) =>
        logoSource.toLowerCase().includes(pattern)
      );

      if (!isLogoFromPrimary) {
        tags.push({
          label: "Logo: Not Primary Provider",
          color: "bg-pink-500/20 text-pink-400 border-pink-500/30",
        });
      }
    }

    // B. Check if Logo is Primary Language
    if (logoLanguage && logoLanguage !== "false" && logoLanguage !== false && logoLangOrder.length > 0) {
        const primaryLogoLang = logoLangOrder[0].toLowerCase();
        const currentLogoLang = logoLanguage.toLowerCase();

        // If languages don't match (and it's not a special case like 'false')
        if (currentLogoLang !== primaryLogoLang) {
             tags.push({
                label: `Logo: ${logoLanguage.toUpperCase()}`,
                color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
             });
        }
    }

    // C. Check for Text Fallback (Applied Text instead of Logo)
    if (logoTextFallback && (logoTextFallback === "true" || logoTextFallback === true)) {
        tags.push({
            label: "Logo: Text Fallback",
            color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
        });
    }

    // -------------------------------------------------------
    // 4. POSTER LANGUAGE LOGIC
    // -------------------------------------------------------
    const posterLang = asset.Language;
    const assetTypeLower = (asset.Type || "").toLowerCase();

    let primaryLang = null;
    if (assetTypeLower.includes("background")) {
      primaryLang = data?.config?.primary_language_background;
    } else if (assetTypeLower.includes("season")) {
      primaryLang = data?.config?.primary_language_season;
    } else if (assetTypeLower.includes("titlecard") || assetTypeLower.includes("episode")) {
      primaryLang = data?.config?.primary_language_titlecard;
    }

    if (!primaryLang) {
      primaryLang = data?.config?.primary_language;
    }

    if (posterLang && primaryLang) {
        const primaryLangLower = primaryLang.toLowerCase();
        const currentLang = String(posterLang).toLowerCase();

        if (currentLang === 'false' || currentLang === 'unknown') {
            // Only push UNKNOWN LANG if the asset actually exists
            if (downloadSource && downloadSource !== "false" && downloadSource !== false) {
                tags.push({
                    label: "UNKNOWN LANG",
                    color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
                });
            }
        } else {
            // Handle "xx" / "textless" equivalence if necessary
            const isPrimary = currentLang === primaryLangLower ||
                             (primaryLangLower === 'xx' && currentLang === 'textless') ||
                             (primaryLangLower === 'textless' && currentLang === 'xx');

            if (!isPrimary) {
                 tags.push({
                    label: posterLang.toUpperCase(),
                    color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
                 });
            }
        }
    }

    // -------------------------------------------------------
    // 5. TRUNCATED TEXT LOGIC
    // -------------------------------------------------------
    if (asset.TextTruncated === true || asset.TextTruncated === "true") {
      tags.push({
        label: t("runtimeStats.truncated"), // "Truncated"
        color: "bg-red-500/20 text-red-400 border-red-500/30",
      });
    }

    return tags;
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary mx-auto mb-4" />
          <p className="text-theme-muted">{t("assetOverview.loading")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          <div>
            <h3 className="text-lg font-semibold text-red-400">
              {t("assetOverview.errorLoadingData")}
            </h3>
            <p className="text-red-300/80">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Main Render
  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-theme-muted/30">
        <button
          onClick={() => setActiveTab("active")}
          className={`px-6 py-3 font-semibold text-sm transition-colors relative ${
            activeTab === "active"
              ? "text-theme-primary"
              : "text-theme-muted hover:text-theme-text"
          }`}
        >
          {t("assetOverview.tabActive", { defaultValue: "Active Actions" })}
          {activeTab === "active" && (
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-theme-primary shadow-[0_0_8px_rgba(var(--theme-primary-rgb),0.5)]"></div>
          )}
        </button>
        <button
          onClick={() => setActiveTab("skipped")}
          className={`px-6 py-3 font-semibold text-sm transition-colors relative ${
            activeTab === "skipped"
              ? "text-theme-primary"
              : "text-theme-muted hover:text-theme-text"
          }`}
        >
          {t("assetOverview.tabSkipped", { defaultValue: "Skipped Items" })}
          {activeTab === "skipped" && (
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-theme-primary shadow-[0_0_8px_rgba(var(--theme-primary-rgb),0.5)]"></div>
          )}
        </button>
      </div>

      {/* Category Cards */}
      {activeTab === "active" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {categoryCards.map((card) => {
            const Icon = card.icon;
            const isSelected = selectedCategory === card.label;
            return (
              <button
                key={card.key}
                onClick={() =>
                  setSelectedCategory(isSelected ? "All Categories" : card.label)
                }
                className={`relative p-5 rounded-xl border-2 transition-all duration-200 bg-black/60 ${
                  card.borderColor
                } ${card.hoverBorderColor} ${
                  isSelected
                    ? "ring-2 ring-theme-primary/50 scale-105 shadow-lg"
                    : "hover:scale-102 shadow-md"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <Icon className={`w-6 h-6 ${card.color}`} />
                  <span className={`text-3xl font-bold ${card.color}`}>
                    {card.count}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-300 text-left">
                  {card.label}
                </div>
                {isSelected && (
                  <div className="absolute inset-0 bg-theme-primary/5 rounded-xl pointer-events-none" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="bg-theme-card border border-theme rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {activeTab === "active" && (
            <>
              {/* Status Filter */}
              <div className="relative" ref={statusDropdownRef}>
                <button
                  onClick={() => {
                    const shouldOpenUp =
                      calculateDropdownPosition(statusDropdownRef);
                    setStatusDropdownUp(shouldOpenUp);
                    setStatusDropdownOpen(!statusDropdownOpen);
                  }}
                  className="w-full px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
                >
                  <span className="font-medium">
                    {selectedStatus === "All"
                      ? t("assetOverview.allStatuses")
                      : selectedStatus === "Resolved"
                      ? t("assetOverview.resolved")
                      : t("assetOverview.unresolved")}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      statusDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {statusDropdownOpen && (
                  <div
                    className={`absolute z-50 w-full ${
                      statusDropdownUp ? "bottom-full mb-2" : "top-full mt-2"
                    } bg-theme-card border border-theme-primary rounded-lg shadow-xl`}
                  >
                    {["All", "Resolved", "Unresolved"].map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setSelectedStatus(status);
                          setStatusDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm transition-all ${
                          selectedStatus === status
                            ? "bg-theme-primary text-white"
                            : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                        }`}
                      >
                        {status === "All"
                          ? t("assetOverview.allStatuses")
                          : status === "Resolved"
                          ? t("assetOverview.resolved")
                          : t("assetOverview.unresolved")}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Category Filter */}
              <div className="relative" ref={categoryDropdownRef}>
                <button
                  onClick={() => {
                    const shouldOpenUp =
                      calculateDropdownPosition(categoryDropdownRef);
                    setCategoryDropdownUp(shouldOpenUp);
                    setCategoryDropdownOpen(!categoryDropdownOpen);
                  }}
                  className="w-full px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
                >
                  <span className="font-medium truncate pr-2">
                    {selectedCategory === "All Categories"
                      ? t("assetOverview.allCategories")
                      : selectedCategory}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      categoryDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {categoryDropdownOpen && (
                  <div
                    className={`absolute z-50 w-full ${
                      categoryDropdownUp ? "bottom-full mb-2" : "top-full mt-2"
                    } bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-[300px] overflow-y-auto custom-scrollbar`}
                  >
                    {["All Categories", ...categoryCards.map((c) => c.label)].map(
                      (category) => (
                        <button
                          key={category}
                          onClick={() => {
                            setSelectedCategory(category);
                            setCategoryDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-sm transition-all truncate ${
                            selectedCategory === category
                              ? "bg-theme-primary text-white"
                              : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                          }`}
                        >
                          {category === "All Categories"
                            ? t("assetOverview.allCategories")
                            : category}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {/* Type Filter */}
          <div className="relative" ref={typeDropdownRef}>
            <button
              onClick={() => {
                const shouldOpenUp = calculateDropdownPosition(typeDropdownRef);
                setTypeDropdownUp(shouldOpenUp);
                setTypeDropdownOpen(!typeDropdownOpen);
              }}
              className="w-full px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
            >
              <span className="font-medium">
                {selectedType === "All Types"
                  ? t("assetOverview.allTypes")
                  : selectedType}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  typeDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {typeDropdownOpen && (
              <div
                className={`absolute z-50 w-full ${
                  typeDropdownUp ? "bottom-full mb-2" : "top-full mt-2"
                } bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}
              >
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedType(type);
                      setTypeDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-3 text-left text-sm transition-all ${
                      selectedType === type
                        ? "bg-theme-primary text-white"
                        : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                    }`}
                  >
                    {type === "All Types" ? t("assetOverview.allTypes") : type}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Library Filter */}
          <div className="relative" ref={libraryDropdownRef}>
            <button
              onClick={() => {
                const shouldOpenUp =
                  calculateDropdownPosition(libraryDropdownRef);
                setLibraryDropdownUp(shouldOpenUp);
                setLibraryDropdownOpen(!libraryDropdownOpen);
              }}
              className="w-full px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
            >
              <span className="font-medium">
                {selectedLibrary === "All Libraries"
                  ? t("assetOverview.allLibraries")
                  : selectedLibrary}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  libraryDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {libraryDropdownOpen && (
              <div
                className={`absolute z-50 w-full ${
                  libraryDropdownUp ? "bottom-full mb-2" : "top-full mt-2"
                } bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}
              >
                {libraries.map((lib) => (
                  <button
                    key={lib}
                    onClick={() => {
                      setSelectedLibrary(lib);
                      setLibraryDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-3 text-left text-sm transition-all ${
                      selectedLibrary === lib
                        ? "bg-theme-primary text-white"
                        : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                    }`}
                  >
                    {lib === "All Libraries"
                      ? t("assetOverview.allLibraries")
                      : lib}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Category Filter */}
          <div className="relative" ref={categoryDropdownRef}>
            <button
              onClick={() => {
                const shouldOpenUp =
                  calculateDropdownPosition(categoryDropdownRef);
                setCategoryDropdownUp(shouldOpenUp);
                setCategoryDropdownOpen(!categoryDropdownOpen);
              }}
              className="w-full px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
            >
              <span className="font-medium">
                {selectedCategory === "All Categories"
                  ? t("assetOverview.allCategories")
                  : selectedCategory}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  categoryDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {categoryDropdownOpen && (
              <div
                className={`absolute z-50 w-full ${
                  categoryDropdownUp ? "bottom-full mb-2" : "top-full mt-2"
                } bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}
              >
                <button
                  onClick={() => {
                    setSelectedCategory("All Categories");
                    setCategoryDropdownOpen(false);
                  }}
                  className={`w-full px-4 py-3 text-left text-sm transition-all ${
                    selectedCategory === "All Categories"
                      ? "bg-theme-primary text-white"
                      : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                  }`}
                >
                  {t("assetOverview.allCategories")}
                </button>
                {categoryCards.map((card) => (
                  <button
                    key={card.key}
                    onClick={() => {
                      setSelectedCategory(card.label);
                      setCategoryDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-3 text-left text-sm transition-all ${
                      selectedCategory === card.label
                        ? "bg-theme-primary text-white"
                        : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                    }`}
                  >
                    {card.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted" />
          <input
            type="text"
            placeholder={t("assetOverview.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-theme-muted hover:text-theme-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Assets Grid */}
      {activeTab === "skipped" && (
        <div className="mb-4 bg-theme-card border-l-4 border-l-theme-primary border-t border-r border-b border-theme rounded-r-lg p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-theme-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-theme-text mb-1">
                {t("assetOverview.skippedInfoTitle")}
              </p>
              <p className="text-theme-muted text-sm leading-relaxed">
                {t("assetOverview.skippedInfoDesc")}
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="bg-theme-card border border-theme rounded-lg p-6">
        {/* Bulk Action Toolbar */}
        {selectedAssetIds.size > 0 && (
          <div className="mb-4 p-4 bg-theme-primary/10 border border-theme-primary rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckIcon className="w-5 h-5 text-theme-primary" />
              <span className="text-theme-text font-medium">
                {t("assetOverview.selectedCount", {
                  count: selectedAssetIds.size,
                })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeTab !== "skipped" && (
                <>
                  <button
                    onClick={handleBulkMarkAsResolved}
                    disabled={isBulkProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 disabled:bg-theme-primary/50 rounded-lg text-white font-medium transition-all shadow-sm disabled:cursor-not-allowed"
                  >
                    {isBulkProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckIcon className="w-4 h-4" />
                    )}
                    {t("assetOverview.markSelectedAsResolved")}
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={isBulkProcessing}
                    className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-700/50 rounded-lg text-white font-medium transition-all shadow-sm disabled:cursor-not-allowed"
                  >
                    {isBulkProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {t("assetOverview.deleteSelected")}
                  </button>
                </>
              )}
              {activeTab === "skipped" && (
                <button
                  onClick={() => handleBulkRefreshMetadata()}
                  disabled={isBulkProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 disabled:bg-theme-primary/50 rounded-lg text-white font-medium transition-all shadow-sm disabled:cursor-not-allowed"
                >
                  {isBulkProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {t("assetOverview.refreshMetadata", { defaultValue: "Refresh Metadata" })}
                </button>
              )}
              <button
                onClick={() => setSelectedAssetIds(new Set())}
                disabled={isBulkProcessing}
                className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("assetOverview.clearSelection")}
              </button>
            </div>
          </div>
        )}

        {/* Grid Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-theme-text">
            {selectedCategory === "All Categories"
              ? t("assetOverview.allAssets")
              : selectedCategory}
            <span className="text-theme-muted ml-2">
              ({filteredAssets.length})
            </span>
          </h2>

          <div className="flex items-center gap-2">
            {/* Select All Button */}
            {displayedAssets.length > 0 && (
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 rounded-lg text-sm font-medium transition-all shadow-sm"
                title={t(
                  selectedAssetIds.size === displayedAssets.length
                    ? "gallery.deselectPage"
                    : "gallery.selectPage"
                )}
              >
                {selectedAssetIds.size === displayedAssets.length ? (
                  <Square className="w-4 h-4 text-white" />
                ) : (
                  <CheckSquare className="w-4 h-4 text-white" />
                )}
                <span className="text-white">
                  {selectedAssetIds.size === displayedAssets.length
                    ? t("gallery.deselectPage")
                    : t("gallery.selectPage")}
                </span>
              </button>
            )}

            {/* Mark All Filtered as Resolved (Refactored) */}
            {filteredAssets.length > 0 && selectedStatus !== "Resolved" && activeTab !== "skipped" && (
              <button
                onClick={handleBulkMarkAllFilteredAsResolved}
                disabled={isBulkProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-theme-primary/80 hover:bg-theme-primary disabled:bg-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm text-white"
                title={t("assetOverview.markAllFilteredTooltip")}
              >
                {isBulkProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCheck className="w-4 h-4 text-white" />
                )}
                <span className="text-white">
                  {t("assetOverview.markAllFiltered", {
                    count: filteredAssets.length,
                  })}
                </span>
              </button>
            )}

            {/* <-- ADDED: Bulk Delete All Filtered Button --> */}
            {filteredAssets.length > 0 && activeTab !== "skipped" && (
              <button
                onClick={handleBulkDeleteAllFiltered}
                disabled={isBulkProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-700/50 rounded-lg text-sm font-medium transition-all shadow-sm text-white"
                title={t("assetOverview.deleteAllFilteredTooltip")}
              >
                {isBulkProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 text-white" />
                )}
                <span className="text-white">
                  {t("assetOverview.deleteAllFiltered", {
                    count: filteredAssets.length,
                  })}
                </span>
              </button>
            )}



            {activeTab === "skipped" && (
              <button
                onClick={handleRefreshAllMetadata}
                disabled={isBulkProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 disabled:bg-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm text-white"
              >
                {isBulkProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-white" />
                )}
                <span className="text-white">{t("assetOverview.refreshAllMetadata", { defaultValue: "Refresh All Metadata" })}</span>
              </button>
            )}

            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
            >
              <RefreshCw className="w-4 h-4 text-theme-primary" />
              <span className="text-theme-text">{t("common.refresh")}</span>
            </button>
          </div>
        </div>

        {/* Asset List */}
        {filteredAssets.length === 0 ? (
          <div className="text-center py-12">
            <FileQuestion className="w-16 h-16 text-theme-muted mx-auto mb-4" />
            <p className="text-theme-muted">
              {activeTab === "skipped" ? t("assetOverview.noSkippedItems", { defaultValue: "No skipped items found." }) : t("assetOverview.noAssetsFound")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayedAssets.map((asset) => {
              const tags = getAssetTags(asset);
              const assetType = (asset.Type || "").toLowerCase();
              const isEpisodeType =
                assetType.includes("episode") ||
                assetType.includes("titlecard");
              const showName = isEpisodeType
                ? parseShowName(asset.Rootfolder)
                : null;
              const usePlex = data?.config?.use_plex ?? false;
              const useJellyfin = data?.config?.use_jellyfin ?? false;
              const useEmby = data?.config?.use_emby ?? false;

              return (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  tags={tags}
                  showName={showName}
                  onNoEditsNeeded={handleNoEditsNeeded}
                  onReplace={handleReplace}
                  onUnresolve={handleUnresolve}
                  onDelete={handleDeleteAsset}
                  onSkipMediaServer={handleSkipMediaServer}
                  onUnskip={handleUnskipAsset}
                  onRefreshMetadata={(id) => handleBulkRefreshMetadata([String(id)])}
                  isSkippedView={activeTab === "skipped"}
                  isSelected={selectedAssetIds.has(asset.id)}
                  onToggleSelection={handleToggleSelection}
                  showCheckbox={activeTab !== "skipped" && (selectedAssetIds.size > 0 || isBulkProcessing)}
                  usePlex={usePlex}
                  useJellyfin={useJellyfin}
                  useEmby={useEmby}
                />
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {(totalPages > 1 || filteredAssets.length > itemsPerPage) && (
          <div className="mt-8 space-y-6">
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-3 px-6 py-3 bg-theme-bg border border-theme-border rounded-xl shadow-md">
                <label className="text-sm font-medium text-theme-text">
                  {t("gallery.itemsPerPage")}:
                </label>
                <div className="relative" ref={itemsPerPageDropdownRef}>
                  <button
                    onClick={() => {
                      const shouldOpenUp = calculateDropdownPosition(
                        itemsPerPageDropdownRef
                      );
                      setItemsPerPageDropdownUp(shouldOpenUp);
                      setItemsPerPageDropdownOpen(!itemsPerPageDropdownOpen);
                    }}
                    className="px-4 py-2 bg-theme-card text-theme-text border border-theme rounded-lg text-sm font-semibold hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary transition-all cursor-pointer shadow-sm flex items-center gap-2"
                  >
                    <span>{itemsPerPage}</span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${
                        itemsPerPageDropdownOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {itemsPerPageDropdownOpen && (
                    <div
                      className={`absolute z-50 right-0 ${
                        itemsPerPageDropdownUp
                          ? "bottom-full mb-2"
                          : "top-full mt-2"
                      } bg-theme-card border border-theme-primary rounded-lg shadow-xl overflow-hidden min-w-[80px] max-h-60 overflow-y-auto`}
                    >
                      {[25, 50, 100, 200, 500].map((value) => (
                        <button
                          key={value}
                          onClick={() => {
                            handleItemsPerPageChange(value);
                            setItemsPerPageDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2 text-sm transition-all text-center ${
                            itemsPerPage === value
                              ? "bg-theme-primary text-white"
                              : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/*
        +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        ++ UPDATED: Generic Confirmation Modal
        +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      */}
      {confirmModalState.isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => !isBulkProcessing && setConfirmModalState({ isOpen: false })}
        >
          <div
            className="relative w-full max-w-lg p-6 bg-theme-card border border-theme rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full ${
                  confirmModalState.confirmColor === "danger"
                    ? "bg-red-500/10 border border-red-500/20"
                    : "bg-theme-primary/10 border border-theme-primary/20"
                }`}
              >
                <AlertTriangle
                  className={`w-6 h-6 ${
                    confirmModalState.confirmColor === "danger"
                      ? "text-red-400"
                      : "text-theme-primary"
                  }`}
                />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-theme-text">
                  {confirmModalState.title}
                </h3>
                <p className="mt-2 text-theme-muted whitespace-pre-wrap">
                  {confirmModalState.message}
                </p>
              </div>
              <button
                onClick={() => !isBulkProcessing && setConfirmModalState({ isOpen: false })}
                className="absolute top-4 right-4 text-theme-muted hover:text-theme-text transition-colors"
                disabled={isBulkProcessing}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmModalState({ isOpen: false })}
                disabled={isBulkProcessing}
                className="px-4 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm font-medium hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm disabled:opacity-50"
              >
                {t("assetOverview.cancel")}
              </button>
              <button
                onClick={confirmModalState.onConfirm}
                disabled={isBulkProcessing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-all shadow-sm disabled:cursor-not-allowed ${
                  confirmModalState.confirmColor === "danger"
                    ? "bg-red-700 hover:bg-red-800 disabled:bg-red-700/50"
                    : "bg-theme-primary hover:bg-theme-primary/80 disabled:bg-theme-primary/50"
                }`}
              >
                {isBulkProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("assetOverview.processing")}
                  </>
                ) : (
                  <>
                    {confirmModalState.confirmColor === "danger" ? (
                      <Trash2 className="w-4 h-4" />
                    ) : (
                      <CheckCheck className="w-4 h-4" />
                    )}
                    {confirmModalState.confirmText}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/*
        +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        ++ END: Generic Confirmation Modal
        +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      */}

      {/* Asset Replacer Modal */}
      {showReplacer && selectedAsset && (
        <AssetReplacer
          asset={selectedAsset}
          onClose={handleCloseReplacer}
          onSuccess={handleReplaceSuccess}
        />
      )}

      {/* Scroll To Buttons */}
      <ScrollToButtons />
    </div>
  );
};

export default AssetOverview;