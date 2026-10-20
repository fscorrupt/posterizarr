import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Clock, RefreshCw, Loader2, Image, AlertTriangle, Database,
  BarChart2, List as ListIcon, ChevronDown, X, Globe,
  PieChart, HardDrive, Cpu, Layers, FileType, FileImage, ExternalLink,
  ChevronRight, Folder, File, Box, Activity, CheckCircle2, AlertCircle,
  ArrowUpRight, TrendingUp, Calendar, Filter, Trash2, Download, Eye,
  Copy, Check, Search, SlidersHorizontal, Sparkles, ShieldCheck, Terminal,
  Share2, ArrowUpDown
} from "lucide-react";
import { useToast } from "../context/ToastContext";

const API_URL = "/api";

// --- TRACEARR DESIGN CONSTANTS & THEMES ---
const THEME = {
  gold: '#f59e0b',       // Primary / Focus
  green: '#10b981',      // Success / Operational
  red: '#f43f5e',        // Error / Alert
  blue: '#0ea5e9',       // Analytics / Posters
  purple: '#8b5cf6',     // Scheduled / Titlecards
  teal: '#14b8a6',       // Seasons
  gray: '#6b7280',       // Backgrounds / Muted

  // Metadata Providers
  tmdb: '#01b4e4',
  tvdb: '#22c55e',
  fanart: '#38bdf8',
  other: '#a855f7',
};

// Mode Color & Styling mapping
const MODE_STYLES = {
  normal: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  scheduled: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30' },
  manual: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  testing: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  dynamic_overlays: { bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-400', border: 'border-fuchsia-500/30' },
  replacer: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  default: { bg: 'bg-gray-500/15', text: 'text-gray-300', border: 'border-gray-500/30' },
};

// --- UTILITIES ---
const getSafeValue = (data, key) => {
  if (!data) return 0;
  return data[key] || data[key.toLowerCase()] || data[key.toUpperCase()] || 0;
};

const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatDuration = (seconds) => {
  if (seconds === undefined || seconds === null) return '0s';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const formatRelativeTime = (dateInput) => {
  if (!dateInput) return '-';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '-';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Realistic mock run telemetry generator (shown if database has 0 historical entries or if user toggles demo preview)
const generateMockRuns = (count = 28) => {
  const modes = ['scheduled', 'normal', 'manual', 'dynamic_overlays'];
  const now = Date.now();
  const runs = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now - (count - i) * 86400000 * 0.95 + (i * 3600000)).toISOString();
    const mode = i % 7 === 0 ? 'manual' : (i % 5 === 0 ? 'dynamic_overlays' : 'scheduled');
    const runtime_seconds = 45 + Math.floor(Math.sin(i * 0.8) * 40) + (i % 4) * 55;
    const posters = 10 + (i % 8) * 12 + Math.floor(Math.random() * 8);
    const titlecards = 8 + (i % 5) * 16;
    const seasons = 2 + (i % 4) * 4;
    const backgrounds = 1 + (i % 3) * 3;
    const total_images = posters + titlecards + seasons + backgrounds;
    const errors = (i === 12 || i === 23) ? 1 : 0;
    const fallbacks = (i % 6 === 0) ? 2 : 0;
    const textless = (i % 4 === 0) ? 3 : 1;
    const space_saved = `${(total_images * 0.38).toFixed(1)} MB`;

    runs.push({
      id: 100 + i,
      timestamp,
      start_time: timestamp,
      end_time: new Date(new Date(timestamp).getTime() + runtime_seconds * 1000).toISOString(),
      mode,
      runtime_seconds,
      runtime_formatted: formatDuration(runtime_seconds),
      total_images,
      posters,
      titlecards,
      seasons,
      backgrounds,
      collections: 0,
      errors,
      fallbacks,
      textless,
      truncated: 0,
      text: 0,
      tba_skipped: i % 3 === 0 ? 2 : 0,
      jap_chines_skipped: 0,
      notification_sent: 1,
      uptime_kuma: 1,
      images_cleared: 0,
      folders_cleared: 0,
      space_saved,
      script_version: '2.1.0',
      im_version: 'ImageMagick 7.1.1-29',
      log_file: `posterizarr_${timestamp.slice(0, 10)}.log`,
      status: errors > 0 ? 'warning' : 'completed',
    });
  }
  return runs.reverse();
};

export default function RuntimeHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  // Core Data
  const [history, setHistory] = useState([]);
  const [providerStats, setProviderStats] = useState([]);
  const [assetOverview, setAssetOverview] = useState(null);
  const [assetStats, setAssetStats] = useState(null);
  const [exportStats, setExportStats] = useState(null);
  const [overlayStats, setOverlayStats] = useState([]);

  // UI & Filter States
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState("30d"); // 24h, 7d, 30d, 90d, 1y, all
  const [viewTab, setViewTab] = useState("overview"); // 'overview', 'charts', 'table'
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [isLivePolling, setIsLivePolling] = useState(false);
  const [copiedLogId, setCopiedLogId] = useState(null);
  const [useDemoData, setUseDemoData] = useState(false);

  // Inspector & Modal States
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState("telemetry"); // 'telemetry' | 'assets'
  const [runAssets, setRunAssets] = useState([]);
  const [loadingRunAssets, setLoadingRunAssets] = useState(false);

  // Prune/Cleanup Dialog
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [pruneDays, setPruneDays] = useState(90);
  const [isPruning, setIsPruning] = useState(false);

  // Map timeRange string to days
  const rangeDays = useMemo(() => {
    switch (timeRange) {
      case "24h": return 1;
      case "7d": return 7;
      case "30d": return 30;
      case "90d": return 90;
      case "1y": return 365;
      case "all": return 9999;
      default: return 30;
    }
  }, [timeRange]);

  // --- DATA FETCHING ---
  const fetchAllData = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const configRes = await fetch(`${API_URL}/config`).catch(() => null);
      const configData = configRes ? await configRes.json().catch(() => ({})) : {};
      const usePlex = configData?.success && configData?.config?.UsePlex === "true";

      const requests = [
        fetch(`${API_URL}/runtime-history?limit=500&offset=0`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`${API_URL}/analytics/providers?days=${Math.min(rangeDays, 365)}`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`${API_URL}/assets/overview`).then(r => r.json()).catch(() => null),
        fetch(`${API_URL}/assets/stats`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`${API_URL}/overlayfiles`).then(r => r.json()).catch(() => ({ success: false })),
        fetch(usePlex ? `${API_URL}/plex-export/statistics` : `${API_URL}/other-media-export/statistics`).then(r => r.json()).catch(() => ({ success: false }))
      ];

      const [histData, provData, overData, statsData, overlayData, expData] = await Promise.all(requests);

      if (histData?.success && Array.isArray(histData.history)) {
        setHistory(histData.history);
        // If DB has 0 real entries, offer demo data seamlessly
        if (histData.history.length === 0) {
          setUseDemoData(true);
        }
      }
      if (provData?.success && Array.isArray(provData.stats)) {
        setProviderStats(provData.stats);
      }
      if (overData) setAssetOverview(overData);
      if (statsData?.success) setAssetStats(statsData);

      if (overlayData?.success && Array.isArray(overlayData.files)) {
        const fonts = overlayData.files.filter(f => f.type === 'font');
        const images = overlayData.files.filter(f => f.type === 'image');
        setOverlayStats([
          { label: 'Installed Fonts', value: fonts.length, size: fonts.reduce((acc, f) => acc + (f.size || 0), 0), type: 'font' },
          { label: 'Dynamic Overlays', value: images.length, size: images.reduce((acc, f) => acc + (f.size || 0), 0), type: 'image' }
        ]);
      }

      if (expData?.success && expData.statistics) {
        setExportStats(expData.statistics);
      }
    } catch (err) {
      console.error("Failed to load runtime telemetry:", err);
    } finally {
      setLoading(false);
      if (!silent) setTimeout(() => setRefreshing(false), 400);
    }
  };

  useEffect(() => {
    fetchAllData(false);
  }, [rangeDays]);

  // Live Auto-Refresh polling
  useEffect(() => {
    if (!isLivePolling) return;
    const interval = setInterval(() => {
      fetchAllData(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [isLivePolling, rangeDays]);

  // Active dataset: Real or Sample
  const rawDataset = useMemo(() => {
    if (useDemoData) {
      return generateMockRuns(Math.min(rangeDays === 1 ? 8 : (rangeDays <= 7 ? 14 : 32), 40));
    }
    return history;
  }, [history, useDemoData, rangeDays]);

  // Filtered by Time Range
  const timeFilteredHistory = useMemo(() => {
    if (!rawDataset.length) return [];
    if (rangeDays >= 9999) return rawDataset;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays);
    return rawDataset.filter(entry => {
      const d = new Date(entry.start_time || entry.timestamp);
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }, [rawDataset, rangeDays]);

  // KPI Calculations across current filtered time window
  const kpis = useMemo(() => {
    const totalRuns = timeFilteredHistory.length;
    if (totalRuns === 0) {
      return {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        successRate: 100,
        totalAssets: 0,
        avgDurationSec: 0,
        avgDurationFormatted: "0s",
        minDurationSec: 0,
        maxDurationSec: 0,
        totalErrors: 0,
        totalSpaceSaved: "0 MB",
        posters: 0,
        titlecards: 0,
        seasons: 0,
        backgrounds: 0
      };
    }

    let successCount = 0;
    let errorCount = 0;
    let totalImages = 0;
    let totalDuration = 0;
    let minDur = Infinity;
    let maxDur = 0;
    let posters = 0;
    let titlecards = 0;
    let seasons = 0;
    let backgrounds = 0;

    timeFilteredHistory.forEach(r => {
      const err = r.errors || 0;
      if (err === 0) successCount++;
      else errorCount += err;

      const dur = r.runtime_seconds || 0;
      totalDuration += dur;
      if (dur > 0 && dur < minDur) minDur = dur;
      if (dur > maxDur) maxDur = dur;

      totalImages += (r.total_images || 0);
      posters += (r.posters || 0);
      titlecards += (r.titlecards || 0);
      seasons += (r.seasons || 0);
      backgrounds += (r.backgrounds || 0);
    });

    const avgDur = Math.round(totalDuration / totalRuns);
    const successRate = totalRuns > 0 ? ((successCount / totalRuns) * 100).toFixed(1) : "100.0";

    return {
      totalRuns,
      successRuns: successCount,
      failedRuns: totalRuns - successCount,
      successRate: parseFloat(successRate),
      totalAssets: totalImages,
      avgDurationSec: avgDur,
      avgDurationFormatted: formatDuration(avgDur),
      minDurationSec: minDur === Infinity ? 0 : minDur,
      maxDurationSec: maxDur,
      totalErrors: errorCount,
      totalSpaceSaved: formatBytes(totalImages * 350 * 1024),
      posters,
      titlecards,
      seasons,
      backgrounds
    };
  }, [timeFilteredHistory]);

  // Chart-ready Chronological Trend Data
  const chartTrends = useMemo(() => {
    const sorted = [...timeFilteredHistory].sort((a, b) => new Date(a.start_time || a.timestamp) - new Date(b.start_time || b.timestamp));
    return sorted.map(run => {
      const dateObj = new Date(run.start_time || run.timestamp);
      return {
        id: run.id,
        shortDate: dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullDate: dateObj.toLocaleString(),
        runtimeSec: run.runtime_seconds || 0,
        runtimeFormatted: run.runtime_formatted || formatDuration(run.runtime_seconds),
        assets: run.total_images || 0,
        errors: run.errors || 0,
        mode: run.mode || 'normal',
        raw: run
      };
    });
  }, [timeFilteredHistory]);

  // Search & Filter for Table
  const tableEntries = useMemo(() => {
    let result = [...timeFilteredHistory];

    if (modeFilter !== "all") {
      result = result.filter(r => (r.mode || "").toLowerCase() === modeFilter.toLowerCase());
    }

    if (statusFilter === "success") {
      result = result.filter(r => (r.errors || 0) === 0);
    } else if (statusFilter === "errors") {
      result = result.filter(r => (r.errors || 0) > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        String(r.id).includes(q) ||
        (r.mode || "").toLowerCase().includes(q) ||
        (r.log_file || "").toLowerCase().includes(q) ||
        (r.start_time || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [timeFilteredHistory, modeFilter, statusFilter, searchQuery]);

  // Paginated Rows
  const paginatedEntries = useMemo(() => {
    const start = currentPage * pageSize;
    return tableEntries.slice(start, start + pageSize);
  }, [tableEntries, currentPage, pageSize]);

  // Handlers
  const handleOpenDetail = async (entry) => {
    setSelectedEntry(entry);
    setShowDetailModal(true);
    setActiveModalTab("telemetry");
    setRunAssets([]);
    setLoadingRunAssets(true);

    try {
      const res = await fetch(`${API_URL}/runtime-history/${entry.id}/assets`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.assets)) {
        setRunAssets(data.assets);
      }
    } catch {
      setRunAssets([]);
    } finally {
      setLoadingRunAssets(false);
    }
  };

  const handleCopyLog = (logPath, e) => {
    if (e) e.stopPropagation();
    if (!logPath) return;
    navigator.clipboard.writeText(logPath);
    setCopiedLogId(logPath);
    showSuccess("Log path copied to clipboard");
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const handlePruneHistory = async () => {
    setIsPruning(true);
    try {
      const res = await fetch(`${API_URL}/runtime-history/cleanup?days=${pruneDays}`, { method: 'DELETE' });
      const data = await res.json();
      if (data?.success) {
        showSuccess(`Cleaned up ${data.deleted_count || 0} older runtime records`);
        setShowPruneModal(false);
        fetchAllData(false);
      } else {
        showError(data?.message || "Failed to cleanup runtime records");
      }
    } catch (e) {
      showError("Server error executing history cleanup");
    } finally {
      setIsPruning(false);
    }
  };

  // Export handlers
  const exportToCsv = () => {
    if (!timeFilteredHistory.length) {
      showInfo("No records available to export");
      return;
    }
    const headers = ["ID", "Timestamp", "Mode", "Duration_Seconds", "Duration_Formatted", "Total_Images", "Posters", "Seasons", "Backgrounds", "Titlecards", "Errors", "Space_Saved", "Script_Version", "Log_File", "Status"];
    const rows = timeFilteredHistory.map(r => [
      r.id,
      r.start_time || r.timestamp,
      r.mode,
      r.runtime_seconds,
      `"${r.runtime_formatted || ''}"`,
      r.total_images || 0,
      r.posters || 0,
      r.seasons || 0,
      r.backgrounds || 0,
      r.titlecards || 0,
      r.errors || 0,
      `"${r.space_saved || ''}"`,
      `"${r.script_version || ''}"`,
      `"${r.log_file || ''}"`,
      r.status || 'completed'
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `posterizarr_runtime_history_${timeRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess("Exported runtime history CSV");
  };

  const exportToJson = () => {
    if (!timeFilteredHistory.length) {
      showInfo("No records available to export");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(timeFilteredHistory, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `posterizarr_runtime_history_${timeRange}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess("Exported runtime history JSON");
  };

  // Format folder storage for horizontal bars
  const folderData = useMemo(() => {
    if (!assetStats?.stats?.folders) return [];
    return [...assetStats.stats.folders]
      .sort((a, b) => b.size - a.size)
      .map(f => ({
        label: f.name,
        size: f.size,
        files: f.files,
        displayValue: `${formatBytes(f.size)} (${f.files.toLocaleString()} items)`
      }));
  }, [assetStats]);

  return (
    <div className="space-y-6 pb-12 select-none animate-fadeIn text-theme-text font-sans">

      {/* TOP HERO BAR */}
      <div className="bg-theme-card/85 backdrop-blur-md rounded-2xl border border-white/[0.08] p-5 shadow-xl relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-1/4 w-96 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -z-0"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          {/* Title & Live Status Indicator */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 text-amber-400 shadow-inner">
                <Activity size={22} className="animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                  {t('runtime_history.title', 'Runtime Analytics & Telemetry')}
                </h1>
                <div className="flex items-center gap-2.5 text-xs text-theme-text-muted mt-0.5">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 -ml-3"></span>
                    Live Engine
                  </span>
                  <span>•</span>
                  <span>
                    {kpis.totalRuns} execution{kpis.totalRuns === 1 ? '' : 's'} recorded
                  </span>
                  {useDemoData && (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium text-[11px]">
                        <Sparkles size={11} /> Sample Preview Active
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Time Range Selector & Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Time range segmented pills */}
            <div className="inline-flex items-center bg-black/40 p-1 rounded-xl border border-white/[0.08] shadow-inner">
              {[
                { id: '24h', label: '24H' },
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: '1y', label: '1Y' },
                { id: 'all', label: 'ALL' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setTimeRange(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    timeRange === tab.id
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/25 scale-[1.02]'
                      : 'text-theme-text-muted hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* View Mode Selector */}
            <div className="inline-flex items-center bg-black/40 p-1 rounded-xl border border-white/[0.08]">
              <button
                onClick={() => setViewTab("overview")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all ${
                  viewTab === "overview" ? 'bg-white/15 text-white shadow' : 'text-theme-text-muted hover:text-white'
                }`}
                title="Unified Dashboard"
              >
                <SlidersHorizontal size={13} />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
              <button
                onClick={() => setViewTab("charts")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all ${
                  viewTab === "charts" ? 'bg-white/15 text-white shadow' : 'text-theme-text-muted hover:text-white'
                }`}
                title="Charts Only"
              >
                <BarChart2 size={13} />
                <span className="hidden sm:inline">Analytics</span>
              </button>
              <button
                onClick={() => setViewTab("table")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all ${
                  viewTab === "table" ? 'bg-white/15 text-white shadow' : 'text-theme-text-muted hover:text-white'
                }`}
                title="Execution Log Table"
              >
                <ListIcon size={13} />
                <span className="hidden sm:inline">Logs</span>
              </button>
            </div>

            {/* Live Auto-Refresh Toggle */}
            <button
              onClick={() => {
                setIsLivePolling(!isLivePolling);
                if (!isLivePolling) showSuccess("Live auto-refresh enabled (30s)");
                else showInfo("Live auto-refresh paused");
              }}
              className={`p-2 rounded-xl border transition-all text-xs flex items-center gap-1.5 ${
                isLivePolling
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-black/30 border-white/[0.08] text-theme-text-muted hover:text-white hover:border-white/20'
              }`}
              title={isLivePolling ? "Auto-refreshing every 30s" : "Enable Live Auto-refresh"}
            >
              <RefreshCw size={15} className={isLivePolling ? "animate-spin text-emerald-400" : ""} style={{ animationDuration: '3s' }} />
              <span className="hidden xl:inline text-[11px] font-medium">Live</span>
            </button>

            {/* Manual Refresh */}
            <button
              onClick={() => fetchAllData(false)}
              disabled={refreshing}
              className="p-2 rounded-xl bg-black/30 border border-white/[0.08] text-theme-text-muted hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
              title="Refresh Data"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin text-amber-400" : ""} />
            </button>

            {/* Export Dropdown / Buttons */}
            <div className="relative group">
              <button
                className="px-3 py-2 rounded-xl bg-black/30 border border-white/[0.08] text-theme-text-muted hover:text-white hover:border-white/20 transition-all text-xs font-medium flex items-center gap-1.5"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>
              <div className="absolute right-0 mt-1 w-36 bg-[#1a1c23] border border-white/10 rounded-xl shadow-2xl p-1 hidden group-hover:block z-50 animate-fadeIn">
                <button
                  onClick={exportToCsv}
                  className="w-full text-left px-3 py-1.5 text-xs text-theme-text hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <File size={13} className="text-amber-400" /> CSV Table
                </button>
                <button
                  onClick={exportToJson}
                  className="w-full text-left px-3 py-1.5 text-xs text-theme-text hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Terminal size={13} className="text-sky-400" /> JSON Dump
                </button>
              </div>
            </div>

            {/* Prune / Maintenance Button */}
            <button
              onClick={() => setShowPruneModal(true)}
              className="p-2 rounded-xl bg-black/30 border border-white/[0.08] text-theme-text-muted hover:text-red-400 hover:border-red-500/30 transition-all"
              title="Clean Up Old History Entries"
            >
              <Trash2 size={15} />
            </button>

            {/* Demo Data Toggle (for previewing full dashboard anytime) */}
            <button
              onClick={() => {
                const nextState = !useDemoData;
                setUseDemoData(nextState);
                if (nextState) showInfo("Sample preview enabled: Showing realistic mock telemetry");
                else showSuccess("Switched to live database telemetry");
              }}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                useDemoData
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-black/20 border-white/[0.06] text-theme-text-muted/70 hover:text-theme-text'
              }`}
              title="Toggle realistic sample runs"
            >
              <Sparkles size={12} />
              <span>{useDemoData ? "Sample On" : "Demo"}</span>
            </button>
          </div>
        </div>

        {/* Demo Data Banner when active */}
        {useDemoData && (
          <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-amber-300/90 bg-amber-500/[0.06] -mx-5 -mb-5 px-5 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400 shrink-0" />
              <span>
                <strong>Sample Telemetry Preview:</strong> Displaying simulated execution runs so you can explore all interactive charts, tooltips, and analytics before your scheduler completes its first syncs.
              </span>
            </div>
            <button
              onClick={() => setUseDemoData(false)}
              className="underline hover:text-white font-medium shrink-0 ml-4"
            >
              Use Real DB ({history.length} runs)
            </button>
          </div>
        )}
      </div>

      {/* 6 TRACEARR KPI HERO CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Card 1: Total Runs */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-amber-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Total Runs</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
              <Activity size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className="text-2xl lg:text-3xl font-bold tracking-tight text-white">{kpis.totalRuns.toLocaleString()}</div>
            <div className="text-[11px] text-theme-text-muted mt-0.5 flex items-center gap-1.5">
              <span className="text-emerald-400 font-medium">{kpis.successRuns} ok</span>
              <span>•</span>
              <span className={kpis.failedRuns > 0 ? "text-rose-400 font-medium" : "text-theme-text-muted"}>
                {kpis.failedRuns} err
              </span>
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
            <div
              className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${kpis.totalRuns > 0 ? Math.min(100, (kpis.successRuns / kpis.totalRuns) * 100) : 0}%` }}
            ></div>
          </div>
        </div>

        {/* Card 2: Success Rate */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-emerald-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Success Rate</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <ShieldCheck size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className="text-2xl lg:text-3xl font-bold tracking-tight text-white flex items-baseline gap-1">
              {kpis.successRate}%
            </div>
            <div className="text-[11px] mt-0.5 font-medium flex items-center gap-1">
              <span className={kpis.successRate >= 95 ? "text-emerald-400" : (kpis.successRate >= 80 ? "text-amber-400" : "text-rose-400")}>
                {kpis.successRate >= 95 ? "Optimal Health" : (kpis.successRate >= 80 ? "Attention Needed" : "Degraded")}
              </span>
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${kpis.successRate >= 95 ? 'bg-emerald-400' : (kpis.successRate >= 80 ? 'bg-amber-400' : 'bg-rose-400')}`}
              style={{ width: `${kpis.successRate}%` }}
            ></div>
          </div>
        </div>

        {/* Card 3: Total Assets Created */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-blue-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Assets Created</span>
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
              <Image size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className="text-2xl lg:text-3xl font-bold tracking-tight text-white">{kpis.totalAssets.toLocaleString()}</div>
            <div className="text-[11px] text-theme-text-muted mt-0.5 truncate">
              {kpis.posters}P · {kpis.titlecards}T · {kpis.seasons}S · {kpis.backgrounds}B
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2 flex">
            <div style={{ width: `${(kpis.posters / Math.max(kpis.totalAssets, 1)) * 100}%` }} className="bg-blue-400 h-full"></div>
            <div style={{ width: `${(kpis.titlecards / Math.max(kpis.totalAssets, 1)) * 100}%` }} className="bg-purple-400 h-full"></div>
            <div style={{ width: `${(kpis.seasons / Math.max(kpis.totalAssets, 1)) * 100}%` }} className="bg-emerald-400 h-full"></div>
            <div style={{ width: `${(kpis.backgrounds / Math.max(kpis.totalAssets, 1)) * 100}%` }} className="bg-gray-400 h-full"></div>
          </div>
        </div>

        {/* Card 4: Avg Run Duration */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-purple-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Avg Duration</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
              <Clock size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className="text-2xl lg:text-3xl font-bold tracking-tight text-white font-mono">{kpis.avgDurationFormatted}</div>
            <div className="text-[11px] text-theme-text-muted mt-0.5">
              Min {formatDuration(kpis.minDurationSec)} • Max {formatDuration(kpis.maxDurationSec)}
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
            <div
              className="bg-purple-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(15, (kpis.avgDurationSec / Math.max(kpis.maxDurationSec, 1)) * 100))}%` }}
            ></div>
          </div>
        </div>

        {/* Card 5: Space Saved / Storage Footprint */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-cyan-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Storage Footprint</span>
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform">
              <HardDrive size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
              {assetStats?.stats?.total_size ? formatBytes(assetStats.stats.total_size) : kpis.totalSpaceSaved}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-0.5 flex items-center justify-between">
              <span>Saved ~{kpis.totalSpaceSaved}</span>
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
            <div className="bg-cyan-400 h-full rounded-full w-3/4"></div>
          </div>
        </div>

        {/* Card 6: System Errors */}
        <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-4 flex flex-col justify-between hover:border-rose-500/40 transition-all group shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider">Errors & Alerts</span>
            <div className={`p-1.5 rounded-lg ${kpis.totalErrors > 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'} group-hover:scale-110 transition-transform`}>
              <AlertTriangle size={15} />
            </div>
          </div>
          <div className="my-1">
            <div className={`text-2xl lg:text-3xl font-bold tracking-tight ${kpis.totalErrors > 0 ? 'text-rose-400' : 'text-white'}`}>
              {kpis.totalErrors}
            </div>
            <div className="text-[11px] text-theme-text-muted mt-0.5 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${kpis.totalErrors > 0 ? 'bg-rose-500' : 'bg-emerald-400'}`}></span>
              <span>{kpis.totalErrors === 0 ? "Clean executions" : "Exceptions caught"}</span>
            </div>
          </div>
          <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${kpis.totalErrors > 0 ? 'bg-rose-500' : 'bg-emerald-400'}`}
              style={{ width: `${kpis.totalErrors > 0 ? Math.min(100, kpis.totalErrors * 10) : 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* CHARTS GRID (Visible in 'overview' and 'charts' tabs) */}
      {(viewTab === "overview" || viewTab === "charts") && (
        <div className="space-y-6">

          {/* MAIN ROW: EXECUTION TIME BENCHMARK + ASSET GENERATION VELOCITY */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* CHART 1: EXECUTION DURATION TREND */}
            <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg relative flex flex-col justify-between">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/[0.06]">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Clock size={17} className="text-amber-400" />
                    <span>Run Duration & Performance Trend</span>
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Execution times over time with average benchmark line.</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono text-[11px]">
                    Avg: {kpis.avgDurationFormatted}
                  </span>
                </div>
              </div>

              {/* Interactive SVG Chart for Duration */}
              <div className="h-64 w-full relative">
                {chartTrends.length > 0 ? (
                  <PerformanceAreaChart
                    data={chartTrends}
                    avgSec={kpis.avgDurationSec}
                    onSelectRun={handleOpenDetail}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-theme-text-muted italic gap-2">
                    <Clock size={28} className="opacity-30" />
                    <span>No run telemetry available for this period</span>
                  </div>
                )}
              </div>
            </div>

            {/* CHART 2: ASSET GENERATION THROUGHPUT */}
            <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg relative flex flex-col justify-between">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/[0.06]">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <TrendingUp size={17} className="text-emerald-400" />
                    <span>Asset Creation Velocity</span>
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Total media images composited and generated per run.</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono text-[11px]">
                    {kpis.totalAssets.toLocaleString()} Total
                  </span>
                </div>
              </div>

              {/* Interactive SVG Bar Chart for Assets */}
              <div className="h-64 w-full relative">
                {chartTrends.length > 0 ? (
                  <AssetVolumeBarChart
                    data={chartTrends}
                    onSelectRun={handleOpenDetail}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-theme-text-muted italic gap-2">
                    <Image size={28} className="opacity-30" />
                    <span>No asset creation data recorded for this period</span>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* SECOND ROW: ASSET TYPES DONUT + METADATA SOURCES + STORAGE METERS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* CHART 3: ASSET CATEGORY DONUT */}
            <div
              className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg flex flex-col justify-between hover:border-blue-500/30 transition-all cursor-pointer group"
              onClick={() => navigate("/gallery")}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2 group-hover:text-blue-400 transition-colors">
                    <PieChart size={17} className="text-blue-400" />
                    <span>Asset Composition</span>
                    <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Breakdown of generated items by format.</p>
                </div>
              </div>

              <div className="my-auto py-2">
                <AssetDonutChart
                  posters={kpis.posters}
                  titlecards={kpis.titlecards}
                  seasons={kpis.seasons}
                  backgrounds={kpis.backgrounds}
                  total={kpis.totalAssets}
                />
              </div>

              <div className="pt-3 border-t border-white/[0.06] text-center">
                <span className="text-[11px] text-theme-text-muted group-hover:text-white transition-colors">
                  Click to open Gallery & Assets view →
                </span>
              </div>
            </div>

            {/* CHART 4: PROVIDER METADATA REQUESTS */}
            <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg flex flex-col justify-between">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Globe size={17} className="text-sky-400" />
                    <span>Metadata Providers</span>
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Source distribution for fetched graphics.</p>
                </div>
              </div>

              <div className="h-52 w-full my-auto">
                <ProviderStackVisualizer data={providerStats} />
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-theme-text-muted px-1">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: THEME.tmdb }}></span>TMDB</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: THEME.tvdb }}></span>TVDB</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: THEME.fanart }}></span>Fanart</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: THEME.other }}></span>Other</span>
              </div>
            </div>

            {/* CHART 5: LIBRARY STORAGE FOOTPRINT */}
            <div
              className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg flex flex-col justify-between hover:border-cyan-500/30 transition-all cursor-pointer group"
              onClick={() => navigate("/asset-overview")}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2 group-hover:text-cyan-400 transition-colors">
                    <HardDrive size={17} className="text-cyan-400" />
                    <span>Library Storage</span>
                    <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Asset disk allocation across media libraries.</p>
                </div>
              </div>

              <div className="h-52 overflow-y-auto pr-1 my-auto custom-scrollbar space-y-3">
                {folderData.length > 0 ? (
                  folderData.map((f, i) => {
                    const maxFolderSize = folderData[0]?.size || 1;
                    const pct = Math.max(5, Math.min(100, (f.size / maxFolderSize) * 100));
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-white truncate max-w-[150px]">{f.label}</span>
                          <span className="font-mono text-[11px] text-theme-text-muted">{f.displayValue}</span>
                        </div>
                        <div className="w-full bg-white/[0.06] h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-theme-text-muted italic gap-1">
                    <HardDrive size={24} className="opacity-30" />
                    <span>No library storage statistics available</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/[0.06] text-center">
                <span className="text-[11px] text-theme-text-muted group-hover:text-white transition-colors">
                  Inspect Asset Overview & Health →
                </span>
              </div>
            </div>

          </div>

          {/* THIRD ROW: OVERLAY ENGINE & MEDIA EXPORTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Overlay Cache Resources */}
            <div
              className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg flex flex-col justify-between hover:border-amber-500/30 transition-all cursor-pointer group"
              onClick={() => navigate("/assets-manager")}
            >
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2 group-hover:text-amber-400 transition-colors">
                    <FileType size={17} className="text-amber-400" />
                    <span>Overlay Engine Assets</span>
                    <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Installed badge overlays, ribbons & typography fonts.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 my-2">
                {overlayStats.map((stat, i) => (
                  <div key={i} className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                        {stat.type === 'font' ? <FileType size={18} /> : <FileImage size={18} />}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">{stat.label}</div>
                        <div className="text-[10px] text-theme-text-muted">{formatBytes(stat.size)}</div>
                      </div>
                    </div>
                    <div className="text-xl font-bold font-mono text-white">{stat.value}</div>
                  </div>
                ))}
                {overlayStats.length === 0 && (
                  <div className="col-span-2 text-center text-xs text-theme-text-muted py-4">No overlay assets found</div>
                )}
              </div>

              <div className="pt-2 text-center">
                <span className="text-[11px] text-theme-text-muted group-hover:text-white transition-colors">
                  Manage overlay graphic files in Asset Manager →
                </span>
              </div>
            </div>

            {/* Media Server Export Telemetry */}
            <div className="bg-theme-card/80 backdrop-blur-md rounded-2xl border border-white/[0.07] p-5 shadow-lg flex flex-col justify-between">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Database size={17} className="text-emerald-400" />
                    <span>Media Server Export Telemetry</span>
                  </h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">Metadata synchronizations with Plex, Jellyfin, or Emby.</p>
                </div>
              </div>

              {exportStats ? (
                <div className="grid grid-cols-3 gap-3 my-2">
                  <div className="bg-black/30 p-3 rounded-xl border border-white/[0.06] text-center">
                    <div className="text-lg font-bold font-mono text-amber-400">{exportStats.total_runs || 0}</div>
                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider mt-0.5">Total Exports</div>
                  </div>
                  <div className="bg-black/30 p-3 rounded-xl border border-white/[0.06] text-center">
                    <div className="text-lg font-bold font-mono text-blue-400">{(exportStats.total_library_records || 0).toLocaleString()}</div>
                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider mt-0.5">Library Records</div>
                  </div>
                  <div className="bg-black/30 p-3 rounded-xl border border-white/[0.06] text-center">
                    <div className="text-lg font-bold font-mono text-emerald-400">{(exportStats.total_episode_records || 0).toLocaleString()}</div>
                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider mt-0.5">Episodes</div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-xs text-theme-text-muted py-6">
                  No media server export statistics found
                </div>
              )}

              <div className="pt-2 text-center">
                <span className="text-[11px] text-theme-text-muted">
                  Latest Export: {exportStats?.latest_run ? new Date(exportStats.latest_run).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* EXECUTION LOG TABLE (Visible in 'overview' and 'table' tabs) */}
      {(viewTab === "overview" || viewTab === "table") && (
        <div className="bg-theme-card/85 backdrop-blur-md rounded-2xl border border-white/[0.08] shadow-xl overflow-hidden space-y-0">

          {/* Table Header Controls */}
          <div className="p-4 border-b border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3 bg-black/20">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <ListIcon size={17} className="text-amber-400" />
                <span>Execution Records</span>
              </h3>
              <span className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white font-mono font-medium">
                {tableEntries.length}
              </span>
            </div>

            {/* Search & Mode Filters */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search Bar */}
              <div className="relative min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search run ID, mode, log..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(0);
                  }}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-theme-text-muted focus:outline-none focus:border-amber-500/50 transition-colors"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-white">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Mode Filter */}
              <select
                value={modeFilter}
                onChange={(e) => {
                  setModeFilter(e.target.value);
                  setCurrentPage(0);
                }}
                className="bg-black/40 border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
              >
                <option value="all">All Modes</option>
                <option value="scheduled">Scheduled</option>
                <option value="normal">Normal</option>
                <option value="manual">Manual</option>
                <option value="testing">Testing</option>
                <option value="dynamic_overlays">Dynamic Overlays</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(0);
                }}
                className="bg-black/40 border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success Only</option>
                <option value="errors">With Errors</option>
              </select>

              {/* Page size */}
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(0);
                }}
                className="bg-black/40 border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-theme-text-muted focus:outline-none"
              >
                <option value={10}>10 / page</option>
                <option value={15}>15 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-black/30 border-b border-white/[0.06] text-theme-text-muted uppercase tracking-wider text-[10px] font-semibold">
                  <th className="px-4 py-3 w-10 text-center">Status</th>
                  <th className="px-4 py-3">Run ID & Mode</th>
                  <th className="px-4 py-3">Start Time</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3 text-right">Assets Created</th>
                  <th className="px-4 py-3 text-center">Breakdown</th>
                  <th className="px-4 py-3 text-center">Errors</th>
                  <th className="px-4 py-3">Log File</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {paginatedEntries.length > 0 ? (
                  paginatedEntries.map((entry) => {
                    const hasError = (entry.errors || 0) > 0;
                    const modeStyle = MODE_STYLES[entry.mode?.toLowerCase()] || MODE_STYLES.default;
                    const relativeTime = formatRelativeTime(entry.start_time || entry.timestamp);
                    const formattedDate = new Date(entry.start_time || entry.timestamp).toLocaleString();

                    return (
                      <tr
                        key={entry.id}
                        onClick={() => handleOpenDetail(entry)}
                        className="hover:bg-white/[0.04] transition-colors cursor-pointer group"
                      >
                        {/* Status Icon */}
                        <td className="px-4 py-3 text-center">
                          {hasError ? (
                            <span className="inline-flex p-1 rounded-full bg-rose-500/15 text-rose-400" title={`${entry.errors} error(s)`}>
                              <AlertCircle size={14} />
                            </span>
                          ) : (
                            <span className="inline-flex p-1 rounded-full bg-emerald-500/15 text-emerald-400" title="Completed Cleanly">
                              <CheckCircle2 size={14} />
                            </span>
                          )}
                        </td>

                        {/* Run ID & Mode */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white font-bold text-xs">#{entry.id}</span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-semibold border ${modeStyle.bg} ${modeStyle.text} ${modeStyle.border}`}>
                              {entry.mode || 'normal'}
                            </span>
                          </div>
                        </td>

                        {/* Start Time */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-medium text-white">{relativeTime}</div>
                          <div className="text-[10px] text-theme-text-muted font-mono">{formattedDate}</div>
                        </td>

                        {/* Duration */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-mono text-white font-medium">
                            <Clock size={12} className="text-theme-text-muted" />
                            {entry.runtime_formatted || formatDuration(entry.runtime_seconds)}
                          </div>
                        </td>

                        {/* Assets Created */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={`font-mono font-bold text-sm ${entry.total_images > 0 ? 'text-emerald-400' : 'text-theme-text-muted'}`}>
                            {entry.total_images || 0}
                          </span>
                        </td>

                        {/* Breakdown preview */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-[10px] font-mono text-theme-text-muted bg-black/25 px-2 py-0.5 rounded-md border border-white/[0.04]">
                            {entry.posters || 0}P · {entry.titlecards || 0}T · {entry.seasons || 0}S
                          </span>
                        </td>

                        {/* Errors */}
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {hasError ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              {entry.errors}
                            </span>
                          ) : (
                            <span className="text-emerald-400/80 font-mono text-xs">0</span>
                          )}
                        </td>

                        {/* Log File */}
                        <td className="px-4 py-3 max-w-[180px] truncate" title={entry.log_file}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-theme-text-muted truncate">
                              {entry.log_file ? entry.log_file.split(/[\/\\]/).pop() : '-'}
                            </span>
                            {entry.log_file && (
                              <button
                                onClick={(e) => handleCopyLog(entry.log_file, e)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-white transition-opacity text-theme-text-muted"
                                title="Copy Log Path"
                              >
                                {copiedLogId === entry.log_file ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Action: Inspect */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDetail(entry);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-amber-500 hover:text-black transition-all text-xs font-medium inline-flex items-center gap-1 text-white border border-white/[0.08]"
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-theme-text-muted italic">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <ListIcon size={28} className="opacity-30" />
                        <span>No execution records match your current filters</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination */}
          <div className="p-3.5 bg-black/25 border-t border-white/[0.06] flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-theme-text-muted">
            <div>
              Showing {tableEntries.length === 0 ? 0 : currentPage * pageSize + 1} to {Math.min((currentPage + 1) * pageSize, tableEntries.length)} of {tableEntries.length} runs
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-white transition-colors"
              >
                Previous
              </button>
              <span className="font-mono px-2 text-white">
                Page {currentPage + 1} of {Math.max(1, Math.ceil(tableEntries.length / pageSize))}
              </span>
              <button
                disabled={(currentPage + 1) * pageSize >= tableEntries.length}
                onClick={() => setCurrentPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-white transition-colors"
              >
                Next
              </button>
            </div>
          </div>

        </div>
      )}

      {/* TRACEARR RUN DETAIL INSPECTOR MODAL */}
      {showDetailModal && selectedEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
          onClick={() => setShowDetailModal(false)}
        >
          <div
            className="bg-[#181a20] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/[0.08] bg-black/30 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${(selectedEntry.errors || 0) > 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {(selectedEntry.errors || 0) > 0 ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-lg font-bold text-white">Execution #{selectedEntry.id}</h2>
                    <span className="px-2 py-0.5 rounded-md text-[10px] uppercase font-bold border bg-amber-500/15 border-amber-500/30 text-amber-400">
                      {selectedEntry.mode || 'normal'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-bold border ${(selectedEntry.errors || 0) > 0 ? 'bg-rose-500/15 border-rose-500/30 text-rose-400' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'}`}>
                      {(selectedEntry.errors || 0) > 0 ? `${selectedEntry.errors} Errors` : 'Success'}
                    </span>
                  </div>
                  <div className="text-xs text-theme-text-muted mt-0.5 font-mono">
                    {new Date(selectedEntry.start_time || selectedEntry.timestamp).toLocaleString()} • Duration: {selectedEntry.runtime_formatted || formatDuration(selectedEntry.runtime_seconds)}
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-2 rounded-xl text-theme-text-muted hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-6 border-b border-white/[0.08] bg-black/15 flex gap-4 text-xs">
              <button
                onClick={() => setActiveModalTab("telemetry")}
                className={`py-3 font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                  activeModalTab === "telemetry"
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-theme-text-muted hover:text-white'
                }`}
              >
                <Activity size={14} /> Telemetry & Diagnostics
              </button>
              <button
                onClick={() => setActiveModalTab("assets")}
                className={`py-3 font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                  activeModalTab === "assets"
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-theme-text-muted hover:text-white'
                }`}
              >
                <Image size={14} /> Created Assets ({selectedEntry.total_images || 0})
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">

              {activeModalTab === "telemetry" && (
                <>
                  {/* Top 4 stat tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                    <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
                      <div className="text-[11px] text-theme-text-muted uppercase font-semibold">Total Runtime</div>
                      <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                        {selectedEntry.runtime_formatted || formatDuration(selectedEntry.runtime_seconds)}
                      </div>
                      <div className="text-[10px] text-theme-text-muted mt-0.5">{selectedEntry.runtime_seconds || 0} seconds total</div>
                    </div>

                    <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
                      <div className="text-[11px] text-theme-text-muted uppercase font-semibold">Images Created</div>
                      <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        {selectedEntry.total_images || 0}
                      </div>
                      <div className="text-[10px] text-theme-text-muted mt-0.5">Posters, cards & seasons</div>
                    </div>

                    <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
                      <div className="text-[11px] text-theme-text-muted uppercase font-semibold">Exceptions</div>
                      <div className={`text-xl font-bold font-mono mt-1 ${(selectedEntry.errors || 0) > 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                        {selectedEntry.errors || 0}
                      </div>
                      <div className="text-[10px] text-theme-text-muted mt-0.5">Reported error count</div>
                    </div>

                    <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
                      <div className="text-[11px] text-theme-text-muted uppercase font-semibold">Space Saved</div>
                      <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                        {selectedEntry.space_saved || "0 KB"}
                      </div>
                      <div className="text-[10px] text-theme-text-muted mt-0.5">Image compression gains</div>
                    </div>
                  </div>

                  {/* Asset Format Breakdown Grid */}
                  <div>
                    <h4 className="text-xs font-bold text-theme-text-muted uppercase tracking-wider mb-3">Asset Format Breakdown</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { label: 'Posters', value: selectedEntry.posters || 0, color: 'text-blue-400', icon: Image },
                        { label: 'Title Cards', value: selectedEntry.titlecards || 0, color: 'text-purple-400', icon: Layers },
                        { label: 'Seasons', value: selectedEntry.seasons || 0, color: 'text-emerald-400', icon: Folder },
                        { label: 'Backgrounds', value: selectedEntry.backgrounds || 0, color: 'text-gray-300', icon: Box },
                        { label: 'Collections', value: selectedEntry.collections || 0, color: 'text-amber-400', icon: FileImage },
                      ].map((item, i) => (
                        <div key={i} className="bg-black/30 p-3 rounded-xl border border-white/[0.06] flex items-center justify-between">
                          <div>
                            <div className="text-[10px] text-theme-text-muted uppercase font-semibold">{item.label}</div>
                            <div className={`text-lg font-bold font-mono mt-0.5 ${item.color}`}>{item.value}</div>
                          </div>
                          <item.icon size={18} className="opacity-30" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Telemetry Tags */}
                  <div>
                    <h4 className="text-xs font-bold text-theme-text-muted uppercase tracking-wider mb-3">Advanced Engine Telemetry</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      <div className="bg-black/30 p-2.5 rounded-xl border border-white/[0.06] flex justify-between">
                        <span className="text-theme-text-muted">Fallbacks Triggered:</span>
                        <span className="font-mono font-bold text-white">{selectedEntry.fallbacks || 0}</span>
                      </div>
                      <div className="bg-black/30 p-2.5 rounded-xl border border-white/[0.06] flex justify-between">
                        <span className="text-theme-text-muted">Textless Posters:</span>
                        <span className="font-mono font-bold text-white">{selectedEntry.textless || 0}</span>
                      </div>
                      <div className="bg-black/30 p-2.5 rounded-xl border border-white/[0.06] flex justify-between">
                        <span className="text-theme-text-muted">TBA Episodes Skipped:</span>
                        <span className="font-mono font-bold text-white">{selectedEntry.tba_skipped || 0}</span>
                      </div>
                      <div className="bg-black/30 p-2.5 rounded-xl border border-white/[0.06] flex justify-between">
                        <span className="text-theme-text-muted">Cleared Items:</span>
                        <span className="font-mono font-bold text-white">{selectedEntry.images_cleared || 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* System & Logs */}
                  <div className="bg-black/30 rounded-xl border border-white/[0.06] p-4 space-y-2 text-xs">
                    <h4 className="font-bold text-theme-text-muted uppercase tracking-wider text-[11px] mb-2">Environment & Log Details</h4>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                        <span className="text-theme-text-muted">Posterizarr Engine Version:</span>
                        <span className="font-mono text-white font-medium">{selectedEntry.script_version || "v2.1.0"}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                        <span className="text-theme-text-muted">ImageMagick Library:</span>
                        <span className="font-mono text-white font-medium">{selectedEntry.im_version || "ImageMagick 7.x"}</span>
                      </div>
                      <div className="flex items-center justify-between py-1">
                        <span className="text-theme-text-muted">Execution Log File:</span>
                        <div className="flex items-center gap-2 max-w-[450px]">
                          <span className="font-mono text-white truncate text-[11px]">{selectedEntry.log_file || "Unknown"}</span>
                          {selectedEntry.log_file && (
                            <button
                              onClick={() => handleCopyLog(selectedEntry.log_file)}
                              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors text-[10px] flex items-center gap-1 shrink-0"
                            >
                              <Copy size={11} /> Copy
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeModalTab === "assets" && (
                <div>
                  {loadingRunAssets ? (
                    <div className="flex justify-center p-12">
                      <Loader2 size={28} className="animate-spin text-amber-400" />
                    </div>
                  ) : runAssets.length > 0 ? (
                    <div className="space-y-2.5">
                      <div className="text-xs text-theme-text-muted mb-2">
                        Displaying {runAssets.length} image choice records captured during this run:
                      </div>
                      <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl overflow-hidden bg-black/30">
                        {runAssets.map((asset, idx) => (
                          <div key={idx} className="p-3 flex items-center justify-between hover:bg-white/[0.03] transition-colors text-xs">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                                <Image size={16} />
                              </div>
                              <div>
                                <div className="font-bold text-white text-sm">{asset.Title || "Untitled"}</div>
                                <div className="text-[11px] text-theme-text-muted flex items-center gap-2 mt-0.5">
                                  <span>{asset.LibraryName || asset.Rootfolder}</span>
                                  <span>•</span>
                                  <span className="capitalize">{asset.Type || "poster"}</span>
                                  {asset.DownloadSource && (
                                    <>
                                      <span>•</span>
                                      <span className="text-amber-400 font-medium">{asset.DownloadSource}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-mono text-[10px] text-theme-text-muted">{asset.created_at || asset.updated_at}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-theme-text-muted italic space-y-2">
                      <Image size={32} className="mx-auto opacity-30" />
                      <div>No individual image records linked to this run ID in the database choices table.</div>
                      <div className="text-xs text-theme-text-muted/70">
                        (Total images generated: {selectedEntry.total_images || 0})
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* PRUNE / HISTORY CLEANUP MODAL */}
      {showPruneModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
          onClick={() => setShowPruneModal(false)}
        >
          <div
            className="bg-[#181a20] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30">
                <Trash2 size={20} />
              </div>
              <h3 className="text-base font-bold text-white">Clean Runtime History</h3>
            </div>

            <p className="text-xs text-theme-text-muted leading-relaxed">
              Prune execution records older than a selected threshold to reduce database footprint. Your actual generated posters, title cards, and libraries will <strong>not</strong> be affected.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white">Retention Period</label>
              <select
                value={pruneDays}
                onChange={(e) => setPruneDays(Number(e.target.value))}
                className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50"
              >
                <option value={30}>Keep last 30 days (delete older)</option>
                <option value={60}>Keep last 60 days (delete older)</option>
                <option value={90}>Keep last 90 days (delete older)</option>
                <option value={180}>Keep last 180 days (delete older)</option>
                <option value={365}>Keep last 1 year (delete older)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-white/[0.06]">
              <button
                onClick={() => setShowPruneModal(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={isPruning}
                onClick={handlePruneHistory}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold shadow-lg shadow-rose-500/25 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isPruning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Prune Records</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// --- SUB-COMPONENTS: HIGH-PERFORMANCE SVG VISUALIZERS ---

/**
 * Interactive SVG Area / Column Performance Chart
 */
const PerformanceAreaChart = ({ data, avgSec, onSelectRun }) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const containerRef = useRef(null);

  if (!data || data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.runtimeSec), avgSec, 60);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative select-none flex flex-col justify-between"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      {/* Background Grid Lines & Average Benchmark Line */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between pb-6 pl-8">
        {[1, 0.75, 0.5, 0.25, 0].map((ratio, i) => (
          <div key={i} className="w-full border-b border-white/[0.04] relative">
            <span className="absolute -left-8 -top-2 text-[9px] font-mono text-theme-text-muted/60">
              {formatDuration(Math.round(maxVal * ratio))}
            </span>
          </div>
        ))}

        {/* Benchmark Dashed Line for Average */}
        {avgSec > 0 && (
          <div
            className="absolute left-8 right-0 border-b border-dashed border-amber-500/60 pointer-events-none z-10"
            style={{ bottom: `${Math.max(10, Math.min(95, (avgSec / maxVal) * 100))}%` }}
          >
            <span className="absolute -top-3.5 right-2 text-[9px] font-mono text-amber-400 bg-black/60 px-1 rounded">
              Avg: {formatDuration(avgSec)}
            </span>
          </div>
        )}
      </div>

      {/* Columns Container */}
      <div className="flex items-end gap-1 w-full h-full pb-6 pl-8 pt-2 z-20">
        {data.map((d, i) => {
          const heightPct = Math.max(4, (d.runtimeSec / maxVal) * 100);
          const isHovered = hoveredIdx === i;
          const isError = (d.errors || 0) > 0;
          const barColor = isError ? THEME.red : THEME.gold;

          return (
            <div
              key={i}
              className="flex-1 h-full flex flex-col justify-end group relative cursor-pointer transition-opacity duration-150"
              style={{ opacity: hoveredIdx !== null && !isHovered ? 0.35 : 1 }}
              onMouseEnter={() => setHoveredIdx(i)}
              onClick={() => onSelectRun(d.raw)}
            >
              <div className="w-full flex items-end justify-center h-full">
                <div
                  className="w-full rounded-t-sm transition-all duration-300"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: barColor,
                    boxShadow: isHovered ? `0 0 12px ${barColor}` : 'none'
                  }}
                ></div>
              </div>

              {/* Floating Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none whitespace-nowrap bg-[#12141a] border border-white/20 p-2.5 rounded-xl shadow-2xl text-[11px]">
                  <div className="font-bold text-white flex items-center justify-between gap-3 border-b border-white/10 pb-1 mb-1.5">
                    <span>Run #{d.id}</span>
                    <span className="text-[10px] text-theme-text-muted">{d.shortDate}</span>
                  </div>
                  <div className="space-y-1 font-mono">
                    <div className="flex justify-between gap-3">
                      <span className="text-theme-text-muted">Duration:</span>
                      <span className="text-amber-400 font-bold">{d.runtimeFormatted}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-theme-text-muted">Assets:</span>
                      <span className="text-emerald-400 font-bold">{d.assets}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-theme-text-muted">Mode:</span>
                      <span className="text-white capitalize">{d.mode}</span>
                    </div>
                    {d.errors > 0 && (
                      <div className="flex justify-between gap-3 text-rose-400 font-bold">
                        <span>Errors:</span>
                        <span>{d.errors}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-[9px] text-theme-text-muted mt-1 text-center italic">Click to inspect</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Date Labels */}
      <div className="absolute bottom-1 left-8 right-0 flex justify-between text-[9px] font-mono text-theme-text-muted px-1 pointer-events-none">
        <span>{data[0]?.shortDate}</span>
        <span>{data[Math.floor(data.length / 2)]?.shortDate}</span>
        <span>{data[data.length - 1]?.shortDate}</span>
      </div>
    </div>
  );
};

/**
 * Interactive SVG Bar Chart for Asset Volume
 */
const AssetVolumeBarChart = ({ data, onSelectRun }) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  if (!data || data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.assets), 10);

  return (
    <div
      className="w-full h-full relative select-none flex flex-col justify-between"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between pb-6 pl-8">
        {[1, 0.75, 0.5, 0.25, 0].map((ratio, i) => (
          <div key={i} className="w-full border-b border-white/[0.04] relative">
            <span className="absolute -left-8 -top-2 text-[9px] font-mono text-theme-text-muted/60">
              {Math.round(maxVal * ratio)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-1 w-full h-full pb-6 pl-8 pt-2 z-20">
        {data.map((d, i) => {
          const heightPct = Math.max(4, (d.assets / maxVal) * 100);
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              className="flex-1 h-full flex flex-col justify-end group relative cursor-pointer transition-opacity duration-150"
              style={{ opacity: hoveredIdx !== null && !isHovered ? 0.35 : 1 }}
              onMouseEnter={() => setHoveredIdx(i)}
              onClick={() => onSelectRun(d.raw)}
            >
              <div className="w-full flex items-end justify-center h-full">
                <div
                  className="w-full rounded-t-sm transition-all duration-300 bg-gradient-to-t from-emerald-500/60 to-emerald-400"
                  style={{
                    height: `${heightPct}%`,
                    boxShadow: isHovered ? `0 0 12px ${THEME.green}` : 'none'
                  }}
                ></div>
              </div>

              {/* Floating Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none whitespace-nowrap bg-[#12141a] border border-white/20 p-2.5 rounded-xl shadow-2xl text-[11px]">
                  <div className="font-bold text-white flex items-center justify-between gap-3 border-b border-white/10 pb-1 mb-1.5">
                    <span>Run #{d.id}</span>
                    <span className="text-[10px] text-theme-text-muted">{d.shortDate}</span>
                  </div>
                  <div className="space-y-1 font-mono">
                    <div className="flex justify-between gap-3">
                      <span className="text-theme-text-muted">Total Generated:</span>
                      <span className="text-emerald-400 font-bold">{d.assets} images</span>
                    </div>
                    <div className="flex justify-between gap-3 text-theme-text-muted">
                      <span>Posters:</span>
                      <span>{d.raw?.posters || 0}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-theme-text-muted">
                      <span>Title Cards:</span>
                      <span>{d.raw?.titlecards || 0}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-1 left-8 right-0 flex justify-between text-[9px] font-mono text-theme-text-muted px-1 pointer-events-none">
        <span>{data[0]?.shortDate}</span>
        <span>{data[Math.floor(data.length / 2)]?.shortDate}</span>
        <span>{data[data.length - 1]?.shortDate}</span>
      </div>
    </div>
  );
};

/**
 * Circular SVG Donut Chart for Asset Distribution
 */
const AssetDonutChart = ({ posters = 0, titlecards = 0, seasons = 0, backgrounds = 0, total = 0 }) => {
  const slices = [
    { label: 'Posters', count: posters, color: THEME.blue },
    { label: 'Title Cards', count: titlecards, color: THEME.purple },
    { label: 'Seasons', count: seasons, color: THEME.teal },
    { label: 'Backgrounds', count: backgrounds, color: THEME.gray },
  ];

  const grandTotal = Math.max(total, 1);
  let cumulative = 0;

  // Arc path generator
  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  return (
    <div className="flex items-center justify-between gap-4 w-full">
      {/* SVG Donut */}
      <div className="relative w-36 h-36 shrink-0">
        <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-full h-full -rotate-90 transform">
          {slices.map((slice, i) => {
            if (slice.count <= 0) return null;
            const slicePercent = slice.count / grandTotal;
            const startPercent = cumulative;
            cumulative += slicePercent;
            const endPercent = cumulative;

            const [startX, startY] = getCoordinatesForPercent(startPercent);
            const [endX, endY] = getCoordinatesForPercent(endPercent);
            const largeArcFlag = slicePercent > 0.5 ? 1 : 0;

            const pathData = [
              `M ${startX} ${startY}`,
              `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
              `L ${endX * 0.65} ${endY * 0.65}`,
              `A 0.65 0.65 0 ${largeArcFlag} 0 ${startX * 0.65} ${startY * 0.65}`,
              'Z'
            ].join(' ');

            return (
              <path
                key={i}
                d={pathData}
                fill={slice.color}
                className="hover:opacity-85 transition-opacity cursor-pointer"
              />
            );
          })}
        </svg>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold font-mono text-white">{total.toLocaleString()}</span>
          <span className="text-[9px] uppercase tracking-wider text-theme-text-muted">Total</span>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-1.5 flex-1 text-xs">
        {slices.map((slice, i) => {
          const pct = ((slice.count / grandTotal) * 100).toFixed(0);
          return (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: slice.color }}></span>
                <span className="text-theme-text-muted">{slice.label}</span>
              </div>
              <div className="font-mono text-white font-medium">
                {slice.count} <span className="text-[10px] text-theme-text-muted font-normal">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Metadata Provider Request Visualizer
 */
const ProviderStackVisualizer = ({ data }) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-theme-text-muted italic gap-1">
        <Globe size={24} className="opacity-30" />
        <span>No provider telemetry logged</span>
      </div>
    );
  }

  const maxTotal = Math.max(...data.map(d => (
    getSafeValue(d, "TMDB") + getSafeValue(d, "TVDB") + getSafeValue(d, "Fanart") + getSafeValue(d, "Other")
  )), 1);

  return (
    <div
      className="w-full h-full relative select-none flex flex-col justify-between"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between pb-6 pl-8">
        {[1, 0.5, 0].map((ratio, i) => (
          <div key={i} className="w-full border-b border-white/[0.04] relative">
            <span className="absolute -left-8 -top-2 text-[9px] font-mono text-theme-text-muted/60">
              {Math.round(maxTotal * ratio)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-1 w-full h-full pb-6 pl-8 pt-2 z-20">
        {data.map((d, i) => {
          const valTmdb = getSafeValue(d, "TMDB");
          const valTvdb = getSafeValue(d, "TVDB");
          const valFanart = getSafeValue(d, "Fanart");
          const valOther = getSafeValue(d, "Other");
          const total = valTmdb + valTvdb + valFanart + valOther;
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              className="flex-1 h-full flex flex-col justify-end group relative transition-opacity duration-150"
              style={{ opacity: hoveredIdx !== null && !isHovered ? 0.35 : 1 }}
              onMouseEnter={() => setHoveredIdx(i)}
            >
              <div className="w-full h-full flex flex-col-reverse relative z-10">
                {valTmdb > 0 && <div style={{ height: `${(valTmdb / maxTotal) * 100}%`, backgroundColor: THEME.tmdb }} className="w-full"></div>}
                {valTvdb > 0 && <div style={{ height: `${(valTvdb / maxTotal) * 100}%`, backgroundColor: THEME.tvdb }} className="w-full"></div>}
                {valFanart > 0 && <div style={{ height: `${(valFanart / maxTotal) * 100}%`, backgroundColor: THEME.fanart }} className="w-full"></div>}
                {valOther > 0 && <div style={{ height: `${(valOther / maxTotal) * 100}%`, backgroundColor: THEME.other }} className="w-full"></div>}
              </div>

              {isHovered && total > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none whitespace-nowrap bg-[#12141a] border border-white/20 p-2.5 rounded-xl shadow-2xl text-[11px]">
                  <div className="font-bold text-white border-b border-white/10 pb-1 mb-1.5">{d.date || 'Daily'}</div>
                  <div className="space-y-1 font-mono">
                    <div className="flex justify-between gap-3 text-cyan-400"><span>TMDB:</span><span>{valTmdb}</span></div>
                    <div className="flex justify-between gap-3 text-emerald-400"><span>TVDB:</span><span>{valTvdb}</span></div>
                    <div className="flex justify-between gap-3 text-sky-400"><span>Fanart:</span><span>{valFanart}</span></div>
                    <div className="flex justify-between gap-3 text-purple-400"><span>Other:</span><span>{valOther}</span></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-1 left-8 right-0 flex justify-between text-[9px] font-mono text-theme-text-muted px-1 pointer-events-none">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
};