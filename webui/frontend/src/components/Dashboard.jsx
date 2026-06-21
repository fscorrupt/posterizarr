import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  Square,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Trash2,
  AlertTriangle,
  Zap,
  Activity,
  ExternalLink,
  FileText,
  Settings,
  Wifi,
  Eye,
  EyeOff,
  Edit3,
  X,
  GripVertical,
  Cpu,
  HardDrive,
  Server,
  Globe,
  Terminal,
  ArrowRight,
  Monitor,
  CalendarClock,
  Code2
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDashboardLoading } from "../context/DashboardLoadingContext";
import RuntimeStats from "./RuntimeStats";
import DangerZone from "./DangerZone";
import RecentAssets from "./RecentAssets";
import Notification from "./Notification";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import { formatDateTimeInTimezone } from "../utils/timeUtils";
import { getLogFileForMode } from "../utils/logUtils";

const API_URL = "/api";
const isDev = import.meta.env.DEV;

const getWebSocketURL = (logFile) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseURL = isDev
    ? `ws://localhost:3000/ws/logs`
    : `${protocol}//${window.location.host}/ws/logs`;
  return `${baseURL}?log_file=${encodeURIComponent(logFile)}`;
};

let cachedStatus = null;
let cachedVersion = null;

function Dashboard() {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();
  const { startLoading, finishLoading } = useDashboardLoading();
  const [status, setStatus] = useState(
    cachedStatus || {
      running: false,
      last_logs: [],
      script_exists: false,
      config_exists: false,
      pid: null,
      current_mode: null,
      active_log: null,
      already_running_detected: false,
      running_file_exists: false,
      start_time: null,
    }
  );
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [version, setVersion] = useState(
    cachedVersion || { local: null, remote: null }
  );
  const [schedulerStatus, setSchedulerStatus] = useState({
    enabled: false,
    running: false,
    is_executing: false,
    schedules: [],
    next_run: null,
    timezone: null,
  });
  const [systemInfo, setSystemInfo] = useState({
    platform: "...",
    os_version: "...",
    cpu_model: "...",
    cpu_cores: 0,
    memory_percent: 0,
    total_memory: "...",
    used_memory: "...",
    free_memory: "...",
    is_docker: false,
  });

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [allLogs, setAllLogs] = useState([]);
  const [runtimeStatsRefreshTrigger, setRuntimeStatsRefreshTrigger] = useState(0);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const logContainerRef = useRef(null);
  const userHasScrolled = useRef(false);
  const lastScrollTop = useRef(0);
  const previousRunningState = useRef(null);

  const [showCardsModal, setShowCardsModal] = useState(false);
  const [visibleCards, setVisibleCards] = useState(() => {
    const saved = localStorage.getItem("dashboard_visible_cards");
    return saved
      ? JSON.parse(saved)
      : {
          statusCards: true,
          runtimeStats: true,
          recentAssets: true,
          logViewer: true,
        };
  });

  const [hideScrollbars, setHideScrollbars] = useState(() => {
    const saved = localStorage.getItem("hide_scrollbars");
    return saved ? JSON.parse(saved) : false;
  });

  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem("dashboard_card_order");
    return saved
      ? JSON.parse(saved)
      : ["statusCards", "recentAssets", "runtimeStats", "logViewer"];
  });

  const [draggedItem, setDraggedItem] = useState(null);
  const hasInitiallyLoaded = useRef(false);

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/dashboard/all`);
      const data = await response.json();
      if (data.success) {
        if (data.status) {
          cachedStatus = data.status;
          setStatus(data.status);
          if (data.status.last_logs?.length > 0) setAllLogs(data.status.last_logs);
        }
        if (data.version) {
          cachedVersion = data.version;
          setVersion(data.version);
        }
        if (data.scheduler_status?.success) {
          setSchedulerStatus({
            enabled: data.scheduler_status.enabled || false,
            running: data.scheduler_status.running || false,
            is_executing: data.scheduler_status.is_executing || false,
            schedules: data.scheduler_status.schedules || [],
            next_run: data.scheduler_status.next_run || null,
            timezone: data.scheduler_status.timezone || null,
          });
        }
        if (data.system_info) {
          setSystemInfo({
            platform: data.system_info.platform || "Unknown",
            os_version: data.system_info.os_version || "Unknown",
            cpu_model: data.system_info.cpu_model || "Unknown",
            cpu_cores: data.system_info.cpu_cores || 0,
            memory_percent: data.system_info.memory_percent || 0,
            total_memory: data.system_info.total_memory || "Unknown",
            used_memory: data.system_info.used_memory || "Unknown",
            free_memory: data.system_info.free_memory || "Unknown",
            is_docker: data.system_info.is_docker || false,
          });
        }
      }
      if (!hasInitiallyLoaded.current) {
        hasInitiallyLoaded.current = true;
        finishLoading("dashboard");
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      if (!hasInitiallyLoaded.current) {
        hasInitiallyLoaded.current = true;
        finishLoading("dashboard");
      }
    } finally {
      if (!silent) setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const fetchStatus = async (silent = false) => {
      try {
        const response = await fetch(`${API_URL}/status`);
        const data = await response.json();
        cachedStatus = data;
        setStatus(data);
        if (data.last_logs?.length > 0) setAllLogs(data.last_logs);
      } catch (error) { console.error(error); }
  };
  const fetchSchedulerStatus = async () => {
      try {
          const res = await fetch(`${API_URL}/scheduler/status`);
          const data = await res.json();
          if (data.success) setSchedulerStatus(data);
      } catch(e) {}
  };
  const fetchSystemInfo = async () => {
      try {
          const res = await fetch(`${API_URL}/system-info`);
          const data = await res.json();
          setSystemInfo(data);
      } catch(e){}
  };
  const fetchVersion = async (silent, force) => {
    try {
        const res = await fetch(`${API_URL}/version`);
        if(res.ok) {
            const data = await res.json();
            setVersion({ local: data.local, remote: data.remote, is_update_available: data.is_update_available });
        }
    } catch(e){}
  }

  const connectDashboardWebSocket = () => {
    if (wsRef.current) return;
    try {
      const logFile = status.current_mode ? getLogFileForMode(status.current_mode) : "Scriptlog.log";
      const ws = new WebSocket(getWebSocketURL(logFile));
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            setAllLogs((prev) => [...prev, data.content]);
            setStatus((prev) => ({ ...prev, last_logs: [...prev.last_logs.slice(-24), data.content] }));
          } else if (data.type === "log_file_changed") {
            setAllLogs([]);
            disconnectDashboardWebSocket();
            setTimeout(() => connectDashboardWebSocket(), 300);
          }
        } catch (e) {}
      };
      ws.onerror = () => setWsConnected(false);
      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (status.running && !document.hidden) connectDashboardWebSocket();
        }, 3000);
      };
    } catch (e) { setWsConnected(false); wsRef.current = null; }
  };

  const disconnectDashboardWebSocket = () => {
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; setWsConnected(false); }
  };

  useEffect(() => {
    startLoading("dashboard");
    fetchDashboardData(false);
    const statusInterval = setInterval(() => { fetchStatus(true); fetchSchedulerStatus(true); fetchSystemInfo(true); }, 3000);
    const versionInterval = setInterval(() => fetchVersion(true, true), 24 * 60 * 60 * 1000);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setRuntimeStatsRefreshTrigger((prev) => prev + 1);
        fetchStatus(true); fetchSchedulerStatus(true); fetchSystemInfo(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(statusInterval); clearInterval(versionInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disconnectDashboardWebSocket();
    };
  }, [startLoading]);

  useEffect(() => {
    if (document.hidden) return;
    if (status.running && !wsRef.current) connectDashboardWebSocket();
    else if (!status.running && wsRef.current) disconnectDashboardWebSocket();
    if (previousRunningState.current === true && status.running === false) setRuntimeStatsRefreshTrigger((prev) => prev + 1);
    previousRunningState.current = status.running;
  }, [status.running]);

  useEffect(() => {
    if (document.hidden || !status.running || !status.current_mode) return;
    if (wsRef.current) {
      disconnectDashboardWebSocket();
      setTimeout(() => { if (!document.hidden && status.running) connectDashboardWebSocket(); }, 300);
    }
  }, [status.current_mode]);

  useEffect(() => {
    if (!autoScroll || !logContainerRef.current) return;
    requestAnimationFrame(() => {
        if(logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    });
  }, [allLogs, autoScroll]);

  useEffect(() => {
    const logContainer = logContainerRef.current;
    if (!logContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = logContainer;
      const currentScrollTop = scrollTop;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;

      if (currentScrollTop < lastScrollTop.current - 5) {
        userHasScrolled.current = true;
        if (autoScroll) setAutoScroll(false);
      }
      if (isAtBottom && !autoScroll) {
        setAutoScroll(true);
        userHasScrolled.current = false;
      }
      lastScrollTop.current = currentScrollTop;
    };

    logContainer.addEventListener("scroll", handleScroll);
    return () => logContainer.removeEventListener("scroll", handleScroll);
  }, [autoScroll]);

  const deleteRunningFile = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/running-file`, { method: "DELETE" });
      const data = await response.json();
      if (data.success) showSuccess(data.message);
      else showError(data.message);
      fetchStatus();
    } catch (error) { showError(error.message); } finally { setLoading(false); }
  };

  const saveVisibilitySettings = (settings) => {
    setVisibleCards(settings);
    localStorage.setItem("dashboard_visible_cards", JSON.stringify(settings));
  };
  const toggleCardVisibility = (cardKey) => saveVisibilitySettings({ ...visibleCards, [cardKey]: !visibleCards[cardKey] });
  const toggleScrollbarVisibility = () => {
    const newValue = !hideScrollbars;
    setHideScrollbars(newValue);
    localStorage.setItem("hide_scrollbars", JSON.stringify(newValue));
    window.dispatchEvent(new Event("scrollbarToggle"));
  };
  const saveCardOrder = (order) => {
    setCardOrder(order);
    localStorage.setItem("dashboard_card_order", JSON.stringify(order));
  };
  const handleDragStart = (e, index) => { setDraggedItem(index); e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === index) return;
    const newOrder = [...cardOrder];
    const draggedCard = newOrder[draggedItem];
    newOrder.splice(draggedItem, 1);
    newOrder.splice(index, 0, draggedCard);
    setDraggedItem(index);
    setCardOrder(newOrder);
  };
  const handleDragEnd = () => setDraggedItem(null);

  const cardLabels = {
    statusCards: t("dashboard.cards.systemControlDeck"),
    runtimeStats: t("dashboard.runtimeStats"),
    recentAssets: t("dashboard.recentAssets"),
    logViewer: t("dashboard.liveLogFeed"),
  };

  const parseLogLine = (line) => {
    const cleanedLine = line.replace(/\x00/g, "").trim();
    if (!cleanedLine) return { raw: null };
    const logPattern = /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*\|L\.(\d+)\s*\|\s*(.*)$/;
    const match = cleanedLine.match(logPattern);
    if (match) return { timestamp: match[1], level: match[2].trim(), lineNum: match[3], message: match[4] };
    return { raw: cleanedLine };
  };

  const LogLevel = ({ level }) => {
    const levelLower = (level || "").toLowerCase().trim();
    const colors = {
      error: "#f87171",
      warning: "#fbbf24",
      warn: "#fbbf24",
      info: "#22d3ee",
      success: "#4ade80",
      debug: "#c084fc",
      default: "#9ca3af",
    };
    const color = colors[levelLower] || colors.default;
    return <span style={{ color: color, fontWeight: "bold" }}>[{level}]</span>;
  };

  const getLogColor = (level) => {
    const levelLower = (level || "").toLowerCase().trim();
    const colors = {
      error: "#f87171",
      warning: "#fbbf24",
      warn: "#fbbf24",
      info: "#22d3ee",
      success: "#4ade80",
      debug: "#c084fc",
      default: "#d1d5db",
    };
    return colors[levelLower] || colors.default;
  };

  const UnifiedControlDeck = () => {
    if (!visibleCards.statusCards) return null;

    return (
      <div className="bg-theme-card rounded-3xl border border-theme shadow-lg overflow-hidden flex flex-col md:flex-row md:divide-x divide-theme">

        {/* SECTION 1: SCRIPT ENGINE */}
        <div className="flex-1 p-6 relative group hover:bg-theme-hover/20 transition-colors">
          <div className="flex items-start justify-between mb-4">
             <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted mb-1">{t("dashboard.controlDeck.engineStatus")}</span>
                <span className={`text-2xl font-black tracking-tight ${status.running ? "text-green-400" : "text-theme-text"}`}>
                  {status.running ? t("dashboard.controlDeck.running") : t("dashboard.controlDeck.stopped")}
                </span>
             </div>
             <div className={`p-2 rounded-xl ${status.running ? "bg-green-500/10" : "bg-theme-hover"}`}>
                {status.running ? (
                    <Activity className="w-6 h-6 text-green-400 animate-pulse" />
                ) : (
                    <Square className="w-6 h-6 text-theme-muted" />
                )}
             </div>
          </div>
          <div className="space-y-2">
             <div className="flex items-center justify-between text-xs">
                 <span className="text-theme-muted">{t("dashboard.controlDeck.mode")}</span>
                 <span className={`font-mono px-2 py-0.5 rounded border ${status.running ? "bg-green-500/10 border-green-500/30 text-green-300" : "bg-theme-hover border-theme text-theme-muted"} capitalize`}>
                    {status.running ? status.current_mode : t("dashboard.controlDeck.idle")}
                 </span>
             </div>
             <div className="flex items-center justify-between text-xs">
                 <span className="text-theme-muted">{t("dashboard.controlDeck.pid")}</span>
                 <span className="font-mono text-theme-text opacity-70">{status.pid || "-"}</span>
             </div>
          </div>
        </div>

        {/* SECTION 2: SCHEDULER */}
        <div className="flex-1 p-6 relative group hover:bg-theme-hover/20 transition-colors border-t md:border-t-0 border-theme">
          <div className="flex items-start justify-between mb-4">
              {/* Clickable Header for Redirection */}
              <Link to="/scheduler" className="flex flex-col group/link">
                <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted mb-1 group-hover/link:text-theme-primary transition-colors">
                    {t("dashboard.controlDeck.scheduler")}
                </span>
                <div className="flex items-center gap-1">
                    <span className={`text-xl font-bold tracking-tight ${schedulerStatus.enabled ? "text-blue-400" : "text-theme-muted"}`}>
                        {schedulerStatus.enabled ? (schedulerStatus.running ? t("dashboard.controlDeck.active") : t("dashboard.controlDeck.standby")) : t("dashboard.controlDeck.disabled")}
                    </span>
                    <ExternalLink className="w-3 h-3 text-theme-muted opacity-0 group-hover/link:opacity-100 transition-opacity" />
                </div>
              </Link>
              <div className={`p-2 rounded-xl ${schedulerStatus.enabled ? "bg-blue-500/10" : "bg-theme-hover"}`}>
                <CalendarClock className={`w-6 h-6 ${schedulerStatus.enabled ? "text-blue-400" : "text-theme-muted"}`} />
              </div>
          </div>

          <div className="mt-auto">
              {schedulerStatus.enabled && schedulerStatus.schedules?.length > 0 ? (() => {
                const now = new Date();
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const totalMinutesInDay = 24 * 60;
                const progressPercent = (currentMinutes / totalMinutesInDay) * 100;

                return (
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs font-medium">
                          <span className="text-theme-muted">{t("dashboard.controlDeck.nextRun")}</span>
                          <span className="text-blue-300 font-bold">
                            {schedulerStatus.next_run ? new Date(schedulerStatus.next_run).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                          </span>
                      </div>

                      {/* Timeline Container */}
                      <div className="relative h-3 w-full bg-theme-hover rounded-full flex items-center">
                          {/* Background Progress (Current Time) */}
                          <div
                            className="absolute h-full bg-blue-500/20 rounded-full transition-all duration-1000"
                            style={{ width: `${progressPercent}%` }}
                          />

                          {/* Current Time Indicator Line */}
                          <div
                            className="absolute h-4 w-0.5 bg-blue-400 z-10 shadow-[0_0_8px_rgba(96,165,250,0.8)]"
                            style={{ left: `${progressPercent}%` }}
                          />

                          {/* Schedule Ticks */}
                          {schedulerStatus.schedules.map((s, idx) => {
                            const [hours, minutes] = s.time.split(':').map(Number);
                            const scheduleMinutes = hours * 60 + minutes;
                            const position = (scheduleMinutes / totalMinutesInDay) * 100;
                            const isPast = scheduleMinutes < currentMinutes;

                            // Determine style class based on status
                            let tickClass = "bg-theme-card border-theme-muted hover:border-blue-400";
                            let dotColorClass = "bg-gray-500";
                            let statusText = t("dashboard.controlDeck.upcoming") || 'Upcoming';
                            let statusTextColor = "text-gray-500";

                            if (s.status === "success") {
                              tickClass = "bg-green-500 border-green-400 shadow-[0_0_5px_rgba(74,222,128,0.3)]";
                              dotColorClass = "bg-green-400";
                              statusText = t("dashboard.controlDeck.completed") || 'Completed';
                              statusTextColor = "text-green-400 font-semibold";
                            } else if (s.status === "failed") {
                              tickClass = "bg-red-500 border-red-400 shadow-[0_0_5px_rgba(239,68,68,0.3)] animate-pulse";
                              dotColorClass = "bg-red-400";
                              statusText = t("dashboard.controlDeck.failed") || 'Failed';
                              statusTextColor = "text-red-400 font-semibold";
                            } else if (s.status === "retrying") {
                              tickClass = "bg-yellow-500 border-yellow-400 shadow-[0_0_5px_rgba(234,179,8,0.3)] animate-pulse";
                              dotColorClass = "bg-yellow-400";
                              statusText = t("dashboard.controlDeck.retrying") || 'Retrying';
                              statusTextColor = "text-yellow-400 font-semibold";
                            } else if (isPast) {
                              tickClass = "bg-blue-500 border-blue-400 shadow-[0_0_5px_rgba(59,130,246,0.3)]";
                              dotColorClass = "bg-blue-400";
                              statusText = t("dashboard.controlDeck.completed") || 'Completed';
                            }

                            return (
                              <div
                                key={idx}
                                className={`group/tick absolute w-2 h-2 rounded-full border-2 transform -translate-x-1/2 z-20 transition-all cursor-pointer ${tickClass}`}
                                style={{ left: `${position}%` }}
                              >
                                {/* Custom Hover Tooltip - Removed the help cursor logic */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 px-2.5 py-1.5 bg-gray-900 text-white text-[10px] rounded-lg pointer-events-none opacity-0 group-hover/tick:opacity-100 transition-all duration-200 whitespace-nowrap z-30 border border-theme shadow-2xl scale-95 group-hover/tick:scale-100">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <div className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`}></div>
                                        <span className="font-bold text-blue-400">{s.time}</span>
                                    </div>
                                    <div className="text-gray-300 text-[9px]">{s.description}</div>
                                    <div className={`text-[7px] mt-1 uppercase tracking-tighter ${statusTextColor}`}>
                                        {statusText}
                                    </div>
                                    {/* Small Arrow */}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-gray-900"></div>
                                </div>
                              </div>
                            );
                          })}
                      </div>

                      <div className="flex justify-between items-center mt-1">
                          <span className="text-[9px] text-theme-muted font-mono opacity-50 uppercase">Start</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-theme-primary font-bold">{Math.round(progressPercent)}%</span>
                            <span className="text-[8px] text-theme-muted uppercase tracking-tighter font-medium">{t("dashboard.controlDeck.ofDay") || 'of Day'}</span>
                          </div>
                          <span className="text-[9px] text-theme-muted font-mono opacity-50 uppercase">End</span>
                      </div>
                    </div>
                );
              })() : (
                <div className="flex items-center gap-2 text-xs text-theme-muted h-full opacity-60">
                    <AlertCircle className="w-3 h-3" /> {t("dashboard.controlDeck.noSchedules")}
                </div>
              )}
          </div>
        </div>

        {/* SECTION 3: SYSTEM */}
        <div className="flex-[1.8] p-6 relative group hover:bg-theme-hover/20 transition-colors border-t md:border-t-0 border-theme">
           <div className="flex items-start justify-between mb-3">
              <div className="flex flex-col gap-1">
                 <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted">{t("dashboard.controlDeck.systemInfo")}</span>
                 <div>
                    <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-theme-text">{systemInfo.platform}</span>
                        {systemInfo.is_docker && (
                           <span className="px-1.5 py-[1px] rounded-[3px] text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">{t("dashboard.controlDeck.docker")}</span>
                        )}
                    </div>
                    {systemInfo.os_version && systemInfo.os_version !== "Unknown" && (
                       <div className="text-[10px] text-theme-muted truncate max-w-[180px]" title={systemInfo.os_version}>
                          {systemInfo.os_version}
                       </div>
                    )}
                 </div>
              </div>
              <Server className="w-6 h-6 text-purple-400 opacity-60" />
           </div>
           <div className="space-y-3 mt-4">
              <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[10px] text-theme-muted uppercase tracking-wider font-semibold">
                      <span>{t("dashboard.controlDeck.cpu")}</span>
                      <span>{systemInfo.cpu_cores} {t("dashboard.controlDeck.cores")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-theme-text/90">
                      <Cpu className="w-3.5 h-3.5 text-purple-400" />
                      <span className="truncate" title={systemInfo.cpu_model}>{systemInfo.cpu_model || t("dashboard.controlDeck.genericCpu")}</span>
                  </div>
              </div>
              <div className="pt-2 border-t border-theme/50">
                  <div className="flex justify-between items-end text-[10px] mb-1.5">
                      <div className="flex flex-col">
                          <span className="text-[10px] text-theme-muted uppercase tracking-wider font-semibold mb-0.5">{t("dashboard.controlDeck.memory")}</span>
                          <span className="font-mono text-theme-text opacity-90">
                              {systemInfo.used_memory} / {systemInfo.total_memory}
                          </span>
                      </div>
                      <div className="flex flex-col items-end">
                         <span className={systemInfo.memory_percent > 80 ? "text-red-400 font-bold" : "text-theme-primary font-bold"}>{systemInfo.memory_percent.toFixed(1)}%</span>
                         <span className="text-[9px] text-theme-muted">{systemInfo.free_memory} {t("dashboard.controlDeck.free")}</span>
                      </div>
                  </div>
                  <div className="h-1.5 w-full bg-theme-hover rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${systemInfo.memory_percent > 90 ? "bg-red-500" : systemInfo.memory_percent > 75 ? "bg-orange-500" : "bg-purple-500"}`}
                        style={{width: `${systemInfo.memory_percent}%`}}
                      ></div>
                  </div>
              </div>
           </div>
        </div>

        {/* SECTION 4: CONFIG */}
        <div className="flex-1 p-6 relative group hover:bg-theme-hover/20 transition-colors border-t lg:border-t-0 border-theme">
           <div className="flex items-start justify-between mb-4">
              <div className="flex flex-col">
                 <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted mb-1">{t("dashboard.controlDeck.config")}</span>
                 <div className="flex items-center gap-2">
                    {status.config_exists ? (
                        <div className="flex items-center gap-1.5 text-green-400">
                           <CheckCircle className="w-4 h-4" />
                           <span className="font-bold text-sm">{t("dashboard.controlDeck.loaded")}</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-red-400">
                           <AlertCircle className="w-4 h-4" />
                           <span className="font-bold text-sm">{t("dashboard.controlDeck.missing")}</span>
                        </div>
                    )}
                 </div>
              </div>
              <div className="p-2 rounded-xl bg-theme-hover">
                 <FileText className="w-6 h-6 text-theme-muted" />
              </div>
           </div>
           <div className="mt-auto space-y-3">
              {(version.local || version.remote) && (
                  <div className="flex items-center justify-between p-2 rounded bg-theme-hover/50 border border-theme">
                     <span className="text-xs text-theme-muted">{t("dashboard.controlDeck.versionAbbr")}</span>
                     <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-theme-primary">v{version.local || version.remote}</span>
                        {version.is_update_available && (
                           <span className="flex h-2 w-2 rounded-full bg-green-400 animate-pulse" title="Update Available"></span>
                        )}
                     </div>
                  </div>
              )}
              {status.config_exists ? (
                  <Link to="/config" className="flex items-center justify-center w-full gap-2 py-1.5 rounded text-xs font-bold text-theme-primary hover:bg-theme-primary/10 transition-colors border border-transparent hover:border-theme-primary/20">
                     {t("dashboard.controlDeck.editConfig")} <ArrowRight className="w-3 h-3" />
                  </Link>
              ) : (
                  <Link to="/config" className="flex items-center justify-center w-full gap-2 py-1.5 rounded text-xs font-bold text-white bg-theme-primary hover:bg-theme-primary/90 transition-colors">
                     {t("dashboard.controlDeck.createConfig")}
                  </Link>
              )}
           </div>
        </div>
      </div>
    );
  };

  const renderDashboardCards = () => {
    const cardComponents = {
      statusCards: <UnifiedControlDeck />,
      runtimeStats: visibleCards.runtimeStats && (
        <RuntimeStats key="runtimeStats" refreshTrigger={runtimeStatsRefreshTrigger} />
      ),
      recentAssets: visibleCards.recentAssets && (
        <RecentAssets key="recentAssets" refreshTrigger={runtimeStatsRefreshTrigger} />
      ),
      logViewer: visibleCards.logViewer && (
        <div
          key="logViewer"
          className="bg-theme-card rounded-xl p-6 border border-theme hover:border-theme-primary/50 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-theme-text flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-theme-primary/10">
                    <FileText className="w-5 h-5 text-theme-primary" />
                  </div>
                  {t("dashboard.liveLogFeed")}
                </h2>
                {wsConnected && (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <Wifi className="w-3 h-3" />
                    Live
                  </span>
                )}
              </div>
              {status.running && status.active_log && allLogs.length > 0 && (
                <p
                  className="text-xs text-theme-muted mt-2"
                  style={{ marginLeft: "calc(2.25rem + 0.75rem)" }}
                >
                  {t("dashboard.readingFrom")}:{" "}
                  <span className="font-mono text-theme-primary">
                    {status.current_mode
                      ? getLogFileForMode(status.current_mode)
                      : status.active_log}
                  </span>
                  <span className="ml-3 text-xs text-theme-muted/70">
                    ({allLogs.length} {t("dashboard.linesLoaded")})
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm font-medium text-theme-text">
                  {t("dashboard.autoScroll")}
                </span>
                <button
                  onClick={() => {
                    const newAutoScrollState = !autoScroll;
                    setAutoScroll(newAutoScrollState);
                    userHasScrolled.current = false;
                    if (newAutoScrollState && logContainerRef.current) {
                      setTimeout(() => {
                        if (logContainerRef.current) {
                          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                        }
                      }, 100);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    autoScroll ? "bg-theme-primary" : "bg-theme-hover"
                  }`}
                  title={autoScroll ? t("dashboard.autoScrollEnabled") : t("dashboard.autoScrollDisabled")}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoScroll ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </label>
            </div>
          </div>
          <div className="bg-black rounded-lg overflow-hidden border-2 border-theme shadow-sm">
            {status.running && allLogs && allLogs.length > 0 ? (
              <div
                ref={logContainerRef}
                className="font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto"
              >
                {allLogs.map((line, index) => {
                  const parsed = parseLogLine(line);
                  if (parsed.raw === null) return null;
                  if (parsed.raw) {
                    return (
                      <div
                        key={`log-${index}`}
                        className="px-3 py-1.5 hover:bg-gray-900/50 transition-colors border-l-2 border-transparent hover:border-theme-primary/50"
                        style={{ color: "#9ca3af" }}
                      >
                        {parsed.raw}
                      </div>
                    );
                  }
                  const logColor = getLogColor(parsed.level);
                  return (
                    <div
                      key={`log-${index}`}
                      className="px-3 py-1.5 hover:bg-gray-900/50 transition-colors flex items-center gap-2 border-l-2 border-transparent hover:border-theme-primary/50"
                    >
                      <span style={{ color: "#6b7280" }} className="text-[10px]">[{parsed.timestamp}]</span>
                      <LogLevel level={parsed.level} />
                      <span style={{ color: "#4b5563" }} className="text-[10px]">|L.{parsed.lineNum}|</span>
                      <span style={{ color: logColor }}>{parsed.message}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-12 text-center">
                <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-sm font-medium">{t("dashboard.noLogs")}</p>
                <p className="text-gray-600 text-xs mt-1">
                  {status.running ? t("dashboard.waitingForLogs") : t("dashboard.startRunToSeeLogs")}
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
            <span className="flex items-center gap-2">
              <Clock className="w-3 h-3" />
              {t("dashboard.autoRefresh")}: {wsConnected ? t("dashboard.live") : "1.5s"}
            </span>
            <span className="text-gray-500">
              {t("dashboard.lastEntries", { count: 25 })} • {status.current_mode ? getLogFileForMode(status.current_mode) : status.active_log || t("dashboard.noActiveLog")}
            </span>
          </div>
        </div>
      )
    };

    return cardOrder.map((key) => {
        const component = cardComponents[key];
        if (key === "statusCards" && status.running) {
           return (
             <React.Fragment key={key}>
                {component}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 p-6 flex items-center justify-between animate-in slide-in-from-top-4 duration-500">
                   <div className="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                   <div className="flex items-center gap-4 relative z-10">
                      <div className="p-3 bg-orange-500/20 rounded-xl animate-pulse"><Zap className="w-6 h-6 text-orange-400" /></div>
                      <div>
                         <h3 className="text-lg font-bold text-orange-100">{t("dashboard.banners.executionInProgress")}</h3>
                         <p className="text-orange-200/70 text-sm">{t("dashboard.banners.reviewLogs")}</p>
                      </div>
                   </div>
                </div>
             </React.Fragment>
           )
        }
        return component;
    }).filter(Boolean);
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="relative overflow-hidden rounded-3xl bg-theme-card border border-theme p-8 shadow-2xl">
         <div className="absolute top-0 right-0 -mt-20 -mr-20 w-80 h-80 bg-theme-primary/5 rounded-full blur-3xl"></div>
         <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-64 h-64 bg-theme-primary/5 rounded-full blur-3xl"></div>
         <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
             <div className="flex flex-col gap-2">
                 <h1 className="text-3xl md:text-4xl font-black text-theme-primary tracking-tight">{t("dashboard.title")}</h1>
                 <p className="text-theme-muted font-medium text-sm md:text-base max-w-xl">
                    {t("dashboard.welcome")}. {t("dashboard.status")}: <span className={`font-bold ${status.running ? "text-green-400" : "text-theme-text"}`}>{status.running ? t("dashboard.controlDeck.active").toLowerCase() : t("dashboard.controlDeck.idle").toLowerCase()}</span>.
                 </p>
             </div>
             <div className="flex items-center gap-3 w-full md:w-auto">
                {!status.running && (
                   <Link to="/run-modes" className="flex-1 md:flex-none group flex items-center justify-center gap-2 px-6 py-3 bg-theme-primary hover:bg-theme-primary/90 text-white rounded-xl font-bold shadow-lg shadow-theme-primary/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
                      <Play className="w-5 h-5 fill-current" />
                      <span>{t("dashboard.runScript")}</span>
                   </Link>
                )}
                <button onClick={() => setShowCardsModal(true)} className="px-4 py-3 bg-theme-hover border border-theme text-theme-text hover:text-theme-primary hover:border-theme-primary/30 rounded-xl transition-all" title={t("dashboard.customize")}>
                   <Edit3 className="w-5 h-5" />
                </button>
             </div>
         </div>
      </div>
      {status.already_running_detected && (
        <div className="rounded-2xl bg-yellow-900/20 border border-yellow-500/30 p-5 flex items-start gap-4 backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
           <AlertTriangle className="w-6 h-6 text-yellow-500 flex-shrink-0" />
           <div className="flex-1">
              <h3 className="text-base font-bold text-yellow-400 mb-1">{t("dashboard.alreadyRunning")}</h3>
              <p className="text-sm text-yellow-200/80 mb-3">{t("dashboard.alreadyRunningDesc")}</p>
              <button onClick={() => setDeleteConfirm(true)} disabled={loading} className="px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border border-yellow-600/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                 <Trash2 className="w-4 h-4" /> {t("dashboard.deleteRunningFile")}
              </button>
           </div>
        </div>
      )}
      {renderDashboardCards()}
      <DangerZone status={status} loading={loading} onStatusUpdate={fetchStatus} onSuccess={showSuccess} onError={showError} />
      <ConfirmDialog isOpen={deleteConfirm} onClose={() => setDeleteConfirm(false)} onConfirm={deleteRunningFile} title={t("dashboard.deleteConfirmTitle")} message={t("dashboard.deleteConfirmMessage")} confirmText={t("common.delete")} type="warning" />
      {showCardsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-theme-card rounded-2xl border border-theme shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-5 border-b border-theme flex justify-between items-center bg-theme-hover/30">
               <h3 className="font-bold text-theme-text flex items-center gap-2"><Eye className="w-5 h-5 text-theme-primary" /> {t("dashboard.customize")}</h3>
               <button onClick={() => setShowCardsModal(false)}><X className="w-5 h-5 text-theme-muted hover:text-theme-text" /></button>
            </div>
            <div className="p-5 space-y-2">
               {cardOrder.map((key, idx) => (
                  <div key={key} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd} className={`p-3 rounded-xl border border-theme bg-theme-card flex items-center justify-between hover:border-theme-primary/50 transition-all cursor-move ${draggedItem === idx ? "opacity-50" : ""}`}>
                     <div className="flex items-center gap-3"><GripVertical className="w-5 h-5 text-theme-muted" /><span className="font-medium text-theme-text">{cardLabels[key]}</span></div>
                     <input type="checkbox" checked={visibleCards[key]} onChange={() => toggleCardVisibility(key)} className="w-5 h-5 accent-theme-primary rounded cursor-pointer" />
                  </div>
               ))}
            </div>
            <div className="p-5 border-t border-theme bg-theme-hover/30 flex justify-end">
               <button onClick={() => setShowCardsModal(false)} className="px-5 py-2 bg-theme-primary text-white rounded-lg font-medium hover:bg-theme-primary/90 transition-colors">{t("common.done")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default Dashboard;
