import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import {
  RefreshCw,
  Loader2,
  Film,
  Tv,
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar,
  Info,
  X,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreVertical,
  Image as ImageIcon
} from "lucide-react";
import {
  formatDateToLocale,
} from "../utils/timeUtils";
import ScrollToButtons from "./ScrollToButtons"; // Added Import

const API_URL = "/api";
const API_PREFIX = "other-media-export";

// Sub-components defined OUTSIDE

const SortIcon = ({ sortConfig, columnKey }) => {
  if (sortConfig.key !== columnKey) return <ArrowUpDown className="w-3 h-3 text-theme-muted opacity-30" />;
  return sortConfig.direction === "asc"
    ? <ArrowUp className="w-3 h-3 text-theme-primary" />
    : <ArrowDown className="w-3 h-3 text-theme-primary" />;
};

const HeaderCell = ({
  label,
  columnKey,
  className = "",
  sortConfig,
  columnFilters,
  onSort,
  onFilterChange,
  t // Pass t
}) => (
  <th className={`py-3 px-4 text-left align-top ${className}`}>
    <div className="flex flex-col gap-2">
      <button
        onClick={() => onSort(columnKey)}
        className="flex items-center gap-1 text-xs font-bold text-theme-text hover:text-theme-primary transition-colors uppercase tracking-wider"
      >
        {label}
        <SortIcon sortConfig={sortConfig} columnKey={columnKey} />
      </button>
      <div className="relative">
        <input
          type="text"
          placeholder={t("common.filter", "Filter") + "..."}
          value={columnFilters[columnKey] || ""}
          onChange={(e) => onFilterChange(columnKey, e.target.value)}
          className="w-full px-2 py-1 text-xs bg-theme-bg border border-theme-border rounded focus:border-theme-primary focus:outline-none text-theme-text"
        />
        {columnFilters[columnKey] && (
          <button
            onClick={() => onFilterChange(columnKey, "")}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-theme-muted hover:text-red-400"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  </th>
);

// Custom Header for External IDs
const ExternalIdsHeader = ({ columnFilters, onFilterChange, className="", t }) => (
  <th className={`py-3 px-4 text-left align-top ${className}`}>
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold text-theme-text uppercase tracking-wider flex items-center gap-1 h-[18px]">
        {t("plexExport.externalIds", "External IDs")}
      </div>
      <div className="relative">
        <input
          type="text"
          placeholder="tmdb/imdb/tvdb..."
          value={columnFilters["external_ids"] || ""}
          onChange={(e) => onFilterChange("external_ids", e.target.value)}
          className="w-full px-2 py-1 text-xs bg-theme-bg border border-theme-border rounded focus:border-theme-primary focus:outline-none text-theme-text"
        />
        {columnFilters["external_ids"] && (
          <button
            onClick={() => onFilterChange("external_ids", "")}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-theme-muted hover:text-red-400"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  </th>
);

// Action Menu Component
const ActionMenu = ({ item, onAction, t }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1.5 rounded-md hover:bg-theme-primary/20 text-theme-muted hover:text-theme-primary transition-colors"
        title="Actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-theme-card border border-theme-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="py-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                onAction("refresh_item", item);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-theme-text hover:bg-theme-hover flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("jellyfinActions.refreshMetadata", "Refresh Metadata")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                onAction("refresh_images", item);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-theme-text hover:bg-theme-hover flex items-center gap-2"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              {t("jellyfinActions.refreshImages", "Scan for Images")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Badge = ({ children, color = "primary", className = "" }) => {
    const colors = {
        primary: "bg-theme-primary/15 text-theme-primary border-theme-primary/30",
        blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        green: "bg-green-500/15 text-green-400 border-green-500/30",
        yellow: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    };
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${colors[color] || colors.primary} ${className}`}>
            {children}
        </span>
    );
};

function DetailRow({ label, value, multiline = false, monospace = false, nested = false }) {
  if (!value) return null;
  return (
    <div className={`flex flex-col ${!nested && "sm:flex-row sm:items-start"} gap-1 sm:gap-2`}>
      <span className={`text-xs font-semibold text-theme-muted uppercase tracking-wider ${!nested && "sm:min-w-[120px] sm:pt-0.5"}`}>
        {label}:
      </span>
      <span
        className={`text-sm text-theme-text flex-1 break-words ${
          multiline ? "whitespace-pre-wrap" : ""
        } ${
          monospace ? "font-mono text-xs bg-theme-hover/50 px-2 py-1 rounded border border-theme/30" : ""
        }`}
      >
        {multiline ? value.replace(/;/g, "\n") : value}
      </span>
    </div>
  );
}

// Main Component

function JellyfinEmbyExport() {
  const { t } = useTranslation();
  const { showSuccess, showInfo } = useToast();

  // Data State
  const [statistics, setStatistics] = useState(null);
  const [libraryData, setLibraryData] = useState([]);
  const [episodeData, setEpisodeData] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);

  // UI State
  const [activeTab, setActiveTab] = useState("library");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);

  // RESTORED: Library specific filters
  const [libraryTypeFilter, setLibraryTypeFilter] = useState("all"); // 'all', 'movie', 'show'
  const [libraryNameFilter, setLibraryNameFilter] = useState("all"); // 'all' or specific library name

  // Filter/Sort/Pagination State
  const [globalSearch, setGlobalSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: "title", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Modal State
  const [selectedItem, setSelectedItem] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // -- Actions --

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedItem(null);
  };

  const handleJellyfinAction = async (action, item) => {
    showInfo(t("jellyfinActions.actionStarted", "Sending command..."), 2000);

    try {
      const response = await fetch(`${API_URL}/jellyfin-emby/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action,
          media_id: item.media_id,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showSuccess(data.message, 3000);
      } else {
        showInfo(`Error: ${data.detail || "Action failed"}`, 4000);
      }
    } catch (error) {
      console.error("Action error:", error);
      showInfo("Failed to connect to backend", 3000);
    }
  };

  const fetchStatistics = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/${API_PREFIX}/statistics`);
      const data = await response.json();
      if (data.success) setStatistics(data.statistics);
    } catch (error) {
      console.error("Error fetching statistics:", error);
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  const fetchRuns = async (autoSelectLatest = false) => {
    try {
      const response = await fetch(`${API_URL}/${API_PREFIX}/runs`);
      const data = await response.json();
      if (data.success) {
        setRuns(data.runs);
        if (data.runs.length > 0) {
          const latestRun = data.runs[0];
          if (!selectedRun || autoSelectLatest || selectedRun !== latestRun) {
            setSelectedRun(latestRun);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching runs:", error);
    }
  };

  const fetchData = async (endpoint, runTimestamp, setter) => {
    try {
      const url = runTimestamp
        ? `${API_URL}/${API_PREFIX}/${endpoint}?run_timestamp=${encodeURIComponent(runTimestamp)}`
        : `${API_URL}/${API_PREFIX}/${endpoint}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) setter(data.data);
    } catch (error) {
      console.error(`Error fetching ${endpoint} data:`, error);
    }
  };

  const importCSVs = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const response = await fetch(`${API_URL}/${API_PREFIX}/import`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        if (data.already_imported) {
          showInfo(t("plexExport.alreadyImported", "Data already imported"), 3000);
        } else {
          showSuccess(t("plexExport.importSuccess", "Import successful"), 3000);
        }
        await fetchStatistics(true);
        await fetchRuns();
      }
    } catch (error) {
      console.error("Error importing CSVs:", error);
    } finally {
      setTimeout(() => setImporting(false), 500);
    }
  };

  // -- Effects --

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      await Promise.all([fetchStatistics(true), fetchRuns()]);
      setLoading(false);
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedRun) {
      fetchData("library", selectedRun, setLibraryData);
      fetchData("episodes", selectedRun, setEpisodeData);
    }
  }, [selectedRun]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await fetchStatistics(true);
      await fetchRuns(true);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // -- Logic --

  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const handleColumnFilterChange = (key, value) => {
    setColumnFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setCurrentPage(0);
  };

  // RESTORED: Helper to get unique library names for the filter pills
  const getUniqueLibraryNames = () => {
    const data = activeTab === "library" ? libraryData : episodeData;
    let filteredForLibraryNames = data;

    if (activeTab === "library" && libraryTypeFilter !== "all") {
      filteredForLibraryNames = data.filter(
        (item) => (item.library_type || "").toLowerCase() === libraryTypeFilter
      );
    }

    const names = [
      ...new Set(filteredForLibraryNames.map((item) => item.library_name)),
    ].filter(Boolean);
    return names.sort();
  };

  const processedData = useMemo(() => {
    let data = activeTab === "library" ? libraryData : episodeData;

    // 0. RESTORED: Apply high-level Library Filters (Pills) first
    if (activeTab === "library" && libraryTypeFilter !== "all") {
      data = data.filter((item) => (item.library_type || "").toLowerCase() === libraryTypeFilter);
    }
    if (libraryNameFilter !== "all") {
      data = data.filter((item) => item.library_name === libraryNameFilter);
    }

    // 1. Global Search
    if (globalSearch) {
      const lowerSearch = globalSearch.toLowerCase();
      data = data.filter((item) =>
        Object.values(item).some(
          (val) => val && String(val).toLowerCase().includes(lowerSearch)
        )
      );
    }

    // 2. Column Filters
    Object.keys(columnFilters).forEach((key) => {
      const filterValue = columnFilters[key].toLowerCase();
      if (filterValue) {
        data = data.filter((item) => {
          // Special handling for External IDs
          if (key === "external_ids") {
            const combinedIds = [
              item.tmdbid ? `tmdb:${item.tmdbid}` : "",
              item.tmdbid ? `${item.tmdbid}` : "",
              item.imdbid ? `imdb:${item.imdbid}` : "",
              item.imdbid ? `${item.imdbid}` : "",
              item.tvdbid ? `tvdb:${item.tvdbid}` : "",
              item.tvdbid ? `${item.tvdbid}` : "",
            ].join(" ").toLowerCase();
            return combinedIds.includes(filterValue);
          }
          // Special handling for Season Number
          if (key === "season_number") {
            const displayValue = `s${item.season_number}`;
            return displayValue.toLowerCase().includes(filterValue);
          }
          // Special handling for Episodes Count
          if (key === "episodes") {
            const count = item.episodes ? String(item.episodes.split(",").length) : "0";
            return count.includes(filterValue);
          }

          const itemValue = item[key];
          return itemValue && String(itemValue).toLowerCase().includes(filterValue);
        });
      }
    });

    // 3. Sorting
    if (sortConfig.key) {
      data = [...data].sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        // Specific handling for NUMERIC IDs
        if (["rating_key", "season_number", "year", "media_id"].includes(sortConfig.key)) {
             const numA = parseFloat(aValue) || 0;
             const numB = parseFloat(bValue) || 0;
             if (numA !== numB) {
                 return sortConfig.direction === "asc" ? numA - numB : numB - numA;
             }
        }

        // Fallback to string comparison
        const strA = String(aValue || "").toLowerCase();
        const strB = String(bValue || "").toLowerCase();

        // Check if string is actually numeric (e.g. "123")
        const aNum = parseFloat(strA);
        const bNum = parseFloat(strB);

        if (!isNaN(aNum) && !isNaN(bNum) && !strA.includes(" ") && !strB.includes(" ")) {
            return sortConfig.direction === "asc" ? aNum - bNum : bNum - aNum;
        }

        if (strA < strB) return sortConfig.direction === "asc" ? -1 : 1;
        if (strA > strB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return data;
  }, [activeTab, libraryData, episodeData, globalSearch, columnFilters, sortConfig, libraryTypeFilter, libraryNameFilter]);

  const totalItems = processedData.length;
  const totalPages = itemsPerPage === "all" ? 1 : Math.ceil(totalItems / itemsPerPage);
  const paginatedData = itemsPerPage === "all"
    ? processedData
    : processedData.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage);

  const handlePageChange = (newPage) => {
    if (newPage >= 0 && newPage < totalPages) setCurrentPage(newPage);
  };

  const getTotalEpisodeCount = () => {
    return episodeData.reduce((total, item) => {
      const episodeCount = item.episodes?.split(",").length || 0;
      return total + episodeCount;
    }, 0);
  };

  // Helper props
  const headerProps = (label, key, className) => ({
    label,
    columnKey: key,
    className,
    sortConfig,
    columnFilters,
    onSort: handleSort,
    onFilterChange: handleColumnFilterChange,
    t // Pass t
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary mx-auto mb-4" />
          <p className="text-theme-muted">{t("mediaServerExport.loading", "Loading export history...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScrollToButtons />
      {/* Top Actions */}
      <div className="flex justify-end items-start gap-2">
        <button
          onClick={async () => {
            setRefreshing(true);
            await fetchStatistics(true);
            await fetchRuns();
            setTimeout(() => setRefreshing(false), 500);
          }}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 text-theme-primary ${refreshing ? "animate-spin" : ""}`} />
          <span className="text-theme-text">{t("plexExport.refresh", "Refresh")}</span>
        </button>

        <button
          onClick={importCSVs}
          disabled={importing}
          className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
        >
          <Download className={`w-4 h-4 text-theme-primary ${importing ? "animate-bounce" : ""}`} />
          <span className="text-theme-text">
            {importing ? t("plexExport.importing", "Importing...") : t("plexExport.import", "Import")}
          </span>
        </button>
      </div>

      {/* Stats Cards */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-theme-card rounded-xl p-6 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-theme-muted">{t("plexExport.libraryRecords", "Library Records")}</p>
                <p className="text-2xl font-bold text-theme-text mt-1">{statistics.latest_run_library_count || 0}</p>
              </div>
              <Film className="w-8 h-8 text-theme-primary" />
            </div>
          </div>
          <div className="bg-theme-card rounded-xl p-6 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-theme-muted">{t("plexExport.episodeRecords", "Episode Records")}</p>
                <p className="text-2xl font-bold text-theme-text mt-1">{statistics.latest_run_total_episodes || 0}</p>
              </div>
              <Tv className="w-8 h-8 text-theme-primary" />
            </div>
          </div>
          <div className="bg-theme-card rounded-xl p-6 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-theme-muted">{t("plexExport.latestRun", "Latest Run")}</p>
                <p className="text-sm font-medium text-theme-text mt-1">
                  {statistics.latest_run ? formatDateToLocale(statistics.latest_run) : t("plexExport.noData", "No data")}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-theme-primary" />
            </div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-theme-card rounded-lg shadow-md">
        {/* Controls */}
        <div className="p-4 border-b border-theme flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="flex gap-2">
            <button
              onClick={() => { setActiveTab("library"); setCurrentPage(0); setColumnFilters({}); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                activeTab === "library"
                  ? "bg-theme-primary text-white scale-105"
                  : "bg-theme-hover hover:bg-theme-primary/70 border border-theme-border text-theme-text"
              }`}
            >
              <Film className="w-4 h-4" />
              {t("plexExport.library", "Library")} ({libraryData.length})
            </button>
            <button
              onClick={() => { setActiveTab("episodes"); setCurrentPage(0); setColumnFilters({}); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                activeTab === "episodes"
                  ? "bg-theme-primary text-white scale-105"
                  : "bg-theme-hover hover:bg-theme-primary/70 border border-theme-border text-theme-text"
              }`}
            >
              <Tv className="w-4 h-4" />
              {t("plexExport.episodes", "Episodes")} ({getTotalEpisodeCount()})
            </button>
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-theme-muted w-4 h-4" />
            <input
              type="text"
              placeholder={t("plexExport.searchPlaceholder", "Search all columns...")}
              value={globalSearch}
              onChange={(e) => { setGlobalSearch(e.target.value); setCurrentPage(0); }}
              className="w-full pl-10 pr-10 py-2 bg-theme-hover border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-primary"
            />
             {globalSearch && (
              <button
                onClick={() => { setGlobalSearch(""); setCurrentPage(0); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* RESTORED: Library Filters (Pills) */}
        <div className="px-4 pb-4 border-b border-theme">
          {/* Type Filter */}
          {activeTab === "library" && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => { setLibraryTypeFilter("all"); setCurrentPage(0); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  libraryTypeFilter === "all" ? "bg-theme-primary text-white" : "bg-theme-hover hover:bg-theme-primary/70 text-theme-text"
                }`}
              >
                All ({libraryData.length})
              </button>
              <button
                onClick={() => { setLibraryTypeFilter("movie"); setCurrentPage(0); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  libraryTypeFilter === "movie" ? "bg-theme-primary text-white" : "bg-theme-hover hover:bg-theme-primary/70 text-theme-text"
                }`}
              >
                Movies ({libraryData.filter((item) => (item.library_type || "").toLowerCase() === "movie").length})
              </button>
              <button
                onClick={() => { setLibraryTypeFilter("show"); setCurrentPage(0); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  libraryTypeFilter === "show" ? "bg-theme-primary text-white" : "bg-theme-hover hover:bg-theme-primary/70 text-theme-text"
                }`}
              >
                Shows ({libraryData.filter((item) => (item.library_type || "").toLowerCase() === "show").length})
              </button>
            </div>
          )}

          {/* Library Name Filter */}
          {getUniqueLibraryNames().length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setLibraryNameFilter("all"); setCurrentPage(0); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  libraryNameFilter === "all" ? "bg-theme-primary text-white" : "bg-theme-hover hover:bg-theme-primary/70 text-theme-text"
                }`}
              >
                All Libraries
              </button>
              {getUniqueLibraryNames().map((libraryName) => {
                const count = (activeTab === "library" ? libraryData : episodeData).filter((item) => {
                  let match = item.library_name === libraryName;
                  if (activeTab === "library" && libraryTypeFilter !== "all") {
                    match = match && (item.library_type || "").toLowerCase() === libraryTypeFilter;
                  }
                  return match;
                }).length;

                return (
                  <button
                    key={libraryName}
                    onClick={() => { setLibraryNameFilter(libraryName); setCurrentPage(0); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      libraryNameFilter === libraryName ? "bg-theme-primary text-white" : "bg-theme-hover hover:bg-theme-primary/70 text-theme-text"
                    }`}
                  >
                    {libraryName} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-theme-hover/30 border-b border-theme">
              <tr>
                {activeTab === "library" ? (
                  <>
                    <HeaderCell {...headerProps(t("plexExport.title", "Title"), "title", "min-w-[200px]")} />
                    <HeaderCell {...headerProps(t("plexExport.year", "Year"), "year", "w-24")} />
                    <HeaderCell {...headerProps(t("plexExport.library", "Library"), "library_name", "w-32")} />
                    <HeaderCell {...headerProps(t("plexExport.resolution", "Resolution"), "resolution", "w-28")} />
                    <HeaderCell {...headerProps(t("plexExport.ratingKey", "ID"), "media_id", "w-32")} />
                    <HeaderCell {...headerProps(t("plexExport.labels", "Labels"), "labels", "w-32")} />

                    {/* External IDs */}
                    <ExternalIdsHeader columnFilters={columnFilters} onFilterChange={handleColumnFilterChange} className="w-40" t={t} />

                    <th className="py-3 px-4 text-left align-middle text-xs font-bold text-theme-text uppercase tracking-wider">
                      {t("common.actions", "Actions")}
                    </th>
                  </>
                ) : (
                  <>
                    <HeaderCell {...headerProps(t("plexExport.show", "Show"), "show_name", "min-w-[200px]")} />
                    <HeaderCell {...headerProps(t("plexExport.season", "Season"), "season_number", "w-20")} />
                    <HeaderCell {...headerProps(t("plexExport.episodes", "Episodes"), "episodes", "w-20")} />
                    <HeaderCell {...headerProps(t("plexExport.library", "Library"), "library_name", "w-32")} />
                    <HeaderCell {...headerProps("IDs", "tvdbid", "w-32")} />

                    <th className="py-3 px-4 text-left align-middle text-xs font-bold text-theme-text uppercase tracking-wider">
                      {t("common.actions", "Actions")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-theme">
              {paginatedData.length > 0 ? (
                paginatedData.map((item, index) => (
                  <tr
                    key={item.id || index}
                    className="border-b border-theme hover:bg-theme-hover transition-colors cursor-pointer group"
                    onClick={() => { setSelectedItem(item); setShowDetailModal(true); }}
                  >
                    {activeTab === "library" ? (
                      <>
                        <td className="py-3 px-4">
                          <div className="text-sm font-medium text-theme-text">{item.title}</div>
                          {item.original_title && item.original_title !== item.title && (
                            <div className="text-xs text-theme-muted">{item.original_title}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-theme-text">{item.year || "-"}</td>
                        <td className="py-3 px-4 text-sm text-theme-text">{item.library_name}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {item.resolution || "N/A"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-theme-muted break-all">
                          {item.media_id || item.rating_key || "-"}
                        </td>
                        <td className="py-3 px-4 text-xs text-theme-muted">
                          {item.labels ? (
                            <div className="flex flex-wrap gap-1 items-center">
                              {(() => {
                                const labelList = item.labels.split(",").map(l => l.trim()).filter(Boolean);
                                const maxLabels = 2;
                                return (
                                  <>
                                    {labelList.slice(0, maxLabels).map((label, i) => (
                                      <Badge key={i} color="primary">{label}</Badge>
                                    ))}
                                    {labelList.length > maxLabels && (
                                       <Badge color="primary" className="opacity-70">+{labelList.length - maxLabels}</Badge>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <div className="flex flex-col gap-1">
                            {item.tmdbid && <span className="text-blue-400">TMDB: {item.tmdbid}</span>}
                            {item.imdbid && <span className="text-yellow-500">IMDB: {item.imdbid}</span>}
                            {item.tvdbid && <span className="text-green-500">TVDB: {item.tvdbid}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <ActionMenu item={item} onAction={handleJellyfinAction} t={t} />
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-4 text-sm font-medium text-theme-text">{item.show_name}</td>
                        <td className="py-3 px-4 text-sm text-theme-text">S{item.season_number}</td>
                        <td className="py-3 px-4 text-sm text-theme-text">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                            {item.episodes?.split(",").length || 0}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-theme-text">{item.library_name}</td>
                        <td className="py-3 px-4 text-xs">
                          <div className="flex flex-col gap-1">
                            {item.tmdbid && <span className="text-blue-400">TMDB: {item.tmdbid}</span>}
                            {item.tvdbid && <span className="text-green-500">TVDB: {item.tvdbid}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <ActionMenu item={item} onAction={handleJellyfinAction} t={t} />
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={activeTab === "library" ? 8 : 6} className="px-4 py-12 text-center text-theme-muted">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="w-8 h-8 opacity-20" />
                      <p>{t("plexExport.noResults", "No matching results found")}</p>
                      <button
                        onClick={() => { setGlobalSearch(""); setColumnFilters({}); }}
                        className="text-xs text-theme-primary hover:underline mt-2"
                      >
                        {t("common.clear", "Clear")}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-theme flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-theme-text">
            <span>
              {t("plexExport.showing", "Showing")} {paginatedData.length > 0 ? currentPage * (itemsPerPage === 'all' ? totalItems : itemsPerPage) + 1 : 0} -{" "}
              {itemsPerPage === 'all' ? totalItems : Math.min((currentPage + 1) * itemsPerPage, totalItems)} {t("plexExport.of", "of")} {totalItems}
            </span>

            <div className="flex items-center gap-2 ml-4">
              <span className="text-theme-muted text-xs">Rows per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  const val = e.target.value;
                  setItemsPerPage(val === "all" ? "all" : Number(val));
                  setCurrentPage(0);
                }}
                className="bg-theme-bg border border-theme rounded px-2 py-1 text-xs focus:border-theme-primary outline-none"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          {itemsPerPage !== "all" && totalPages > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 0}
                className="p-1 rounded bg-theme-card border border-theme disabled:opacity-50 hover:border-theme-primary transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="flex items-center px-2 text-sm font-medium">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="p-1 rounded bg-theme-card border border-theme disabled:opacity-50 hover:border-theme-primary transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showDetailModal && selectedItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-theme shadow-2xl">
            <div className="sticky top-0 bg-theme-card/95 backdrop-blur border-b border-theme px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-xl font-bold text-theme-text truncate pr-4">
                {activeTab === "library"
                  ? selectedItem.title
                  : `${selectedItem.show_name} - Season ${selectedItem.season_number}`}
              </h3>
              <button
                onClick={closeDetailModal}
                className="p-1 hover:bg-theme-hover rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-theme-muted hover:text-theme-primary" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {activeTab === "library" ? (
                <>
                  <div className="flex items-start gap-4 pb-6 border-b border-theme/50">
                    <div className="p-3 bg-theme-primary/10 rounded-lg">
                        <Film className="w-8 h-8 text-theme-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xl font-bold text-theme-text break-words">
                        {selectedItem.title}
                      </h4>
                      {selectedItem.original_title &&
                        selectedItem.original_title !== selectedItem.title && (
                          <p className="text-sm text-theme-muted mt-1 italic">
                            {selectedItem.original_title}
                          </p>
                        )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {selectedItem.year && (
                          <Badge color="primary">{selectedItem.year}</Badge>
                        )}
                        {selectedItem.resolution && (
                          <Badge color="blue">{selectedItem.resolution}</Badge>
                        )}
                        {selectedItem.library_type && (
                          <Badge color="purple" className="capitalize">{selectedItem.library_type}</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <DetailRow label={t("plexExport.library", "Library")} value={selectedItem.library_name} />

                    {(selectedItem.tmdbid || selectedItem.imdbid || selectedItem.tvdbid) && (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider">{t("plexExport.externalIds", "External IDs")}</span>
                        <div className="flex flex-wrap gap-2">
                          {selectedItem.tmdbid && <Badge color="blue">TMDB: {selectedItem.tmdbid}</Badge>}
                          {selectedItem.imdbid && <Badge color="yellow">IMDB: {selectedItem.imdbid}</Badge>}
                          {selectedItem.tvdbid && <Badge color="green">TVDB: {selectedItem.tvdbid}</Badge>}
                        </div>
                      </div>
                    )}

                    <div>
                        <DetailRow label="ID" value={selectedItem.media_id} monospace />
                    </div>

                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider">File Information</span>
                        <div className="bg-theme-bg/50 rounded-lg p-3 space-y-2 border border-theme/50">
                            <DetailRow label={t("plexExport.path", "Path")} value={selectedItem.path} monospace nested />
                            <DetailRow label={t("plexExport.folder", "Root Folder")} value={selectedItem.root_foldername} monospace nested />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider">{t("plexExport.labels", "Labels")}</span>
                        <div className="bg-theme-bg/50 rounded-lg p-3 border border-theme/50 flex flex-wrap gap-1">
                            {selectedItem.labels ? (
                                selectedItem.labels.split(",").map((label, i) => (
                                    <Badge key={i} color="primary">{label.trim()}</Badge>
                                ))
                            ) : (
                                <span className="text-sm text-theme-text">None</span>
                            )}
                        </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-4 pb-6 border-b border-theme/50">
                    <div className="p-3 bg-theme-primary/10 rounded-lg">
                        <Tv className="w-8 h-8 text-theme-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xl font-bold text-theme-text">
                        {selectedItem.show_name}
                      </h4>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Badge color="primary">{t("plexExport.season", "Season")} {selectedItem.season_number}</Badge>
                        <Badge color="green">{selectedItem.episodes?.split(",").length || 0} {t("plexExport.episodes", "Episodes")}</Badge>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <DetailRow label={t("plexExport.library", "Library")} value={selectedItem.library_name} />

                    {(selectedItem.tmdbid || selectedItem.tvdbid) && (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider">{t("plexExport.externalIds", "External IDs")}</span>
                        <div className="flex flex-wrap gap-2">
                          {selectedItem.tmdbid && <Badge color="blue">TMDB: {selectedItem.tmdbid}</Badge>}
                          {selectedItem.tvdbid && <Badge color="green">TVDB: {selectedItem.tvdbid}</Badge>}
                        </div>
                      </div>
                    )}

                    {selectedItem.episodes && (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider">
                          {t("plexExport.episodes", "Episodes List")}
                        </span>
                        <div className="bg-theme-bg/50 rounded-lg border border-theme/50 max-h-60 overflow-y-auto divide-y divide-theme/30">
                          {selectedItem.episodes.split(",").map((episodeNum, index) => {
                            const titles = selectedItem.title?.split(";") || [];
                            const resolutions = selectedItem.resolutions?.split(",") || [];
                            const title = titles[index]?.trim() || "Unknown";
                            const resolution = resolutions[index]?.trim();

                            return (
                              <div key={index} className="flex items-center gap-3 p-2 hover:bg-theme-hover/50 transition-colors">
                                <span className="font-mono text-sm text-theme-primary min-w-[2rem] text-right">
                                  {episodeNum.trim()}
                                </span>
                                <span className="flex-1 text-sm text-theme-text truncate">
                                  {title}
                                </span>
                                {resolution && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-card border border-theme text-theme-muted">
                                    {resolution}p
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="pt-4 border-t border-theme/50 flex justify-between items-center text-xs text-theme-muted">
                <span className="font-mono">{t("plexExport.importedAt", "Imported")}: {new Date(selectedItem.created_at).toLocaleString("sv-SE").replace("T", " ")}</span>
                <span className="font-mono">ID: {selectedItem.id}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JellyfinEmbyExport;