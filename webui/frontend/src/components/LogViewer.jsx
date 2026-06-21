import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  RefreshCw,
  Download,
  Trash2,
  FileText,
  CheckCircle,
  Wifi,
  WifiOff,
  ChevronDown,
  Activity,
  Square,
  Search,
  Filter,
  Database,
  Loader2,
  LifeBuoy,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import Notification from "./Notification";
import { useToast } from "../context/ToastContext";

const API_URL = "/api";
const isDev = import.meta.env.DEV;

const getWebSocketURL = (logFile) => {
  // Check if the page is loaded via HTTPS or HTTP
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  const baseURL = isDev
    ? `ws://localhost:3000/ws/logs`
    : `${protocol}//${window.location.host}/ws/logs`; // Use the correct protocol

  // Add log_file as query parameter
  return `${baseURL}?log_file=${encodeURIComponent(logFile)}`;
};

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++ LOG LEVEL FILTER COMPONENT
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const LogLevelFilter = ({ levelFilters, setLevelFilters }) => {
  const { t } = useTranslation();
  const filters = [
    { key: "DEBUG", color: "text-purple-400", border: "border-purple-500/50" },
    { key: "INFO", color: "text-blue-400", border: "border-blue-500/50" },
    { key: "WARNING", color: "text-yellow-400", border: "border-yellow-500/50" },
    { key: "ERROR", color: "text-red-400", border: "border-red-500/50" },
  ];

  const toggleFilter = (key) => {
    setLevelFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const allOn = Object.values(levelFilters).every((v) => v);
  const allOff = Object.values(levelFilters).every((v) => !v);

  const toggleAll = () => {
    const newState = !allOn;
    setLevelFilters({
      INFO: newState,
      WARNING: newState,
      ERROR: newState,
      DEBUG: newState,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={toggleAll}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border ${
          allOn
            ? "bg-theme-primary/10 text-theme-primary border-theme-primary/50"
            : "bg-theme-bg text-theme-muted border-theme hover:bg-theme-hover"
        }`}
      >
        <Filter className="w-3.5 h-3.5" />
        {allOn ? t("logViewer.allLevels") : t("logViewer.allLevels")}
      </button>

      {filters.map(({ key, color, border }) => (
        <button
          key={key}
          onClick={() => toggleFilter(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border ${
            levelFilters[key]
              ? `bg-theme-primary/10 ${color} ${border}`
              : `bg-theme-bg text-theme-muted border-theme opacity-50 hover:opacity-100`
          }`}
        >
          <span className={`font-bold ${levelFilters[key] ? color : ""}`}>
            [{key}]
          </span>
        </button>
      ))}
    </div>
  );
};
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++ END OF COMPONENT
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

function LogViewer() {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();
  const location = useLocation();
  const [logs, setLogs] = useState([]);
  const [availableLogs, setAvailableLogs] = useState([]);

  const [selectedLog, setSelectedLog] = useState(null); // Set to null initially

  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoadingFullLog, setIsLoadingFullLog] = useState(false);
  const [isGatheringSupportZip, setIsGatheringSupportZip] = useState(false); // Added

  // --- NEW FILTER STATE ---
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilters, setLevelFilters] = useState({
    INFO: true,
    WARNING: true,
    ERROR: true,
    DEBUG: true,
  });
  // --- END NEW FILTER STATE ---

  const [status, setStatus] = useState({
    running: false,
    current_mode: null,
  });
  const logContainerRef = useRef(null);
  const wsRef = useRef(null);
  const dropdownRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const currentLogFileRef = useRef(null); // Set to null initially
  const isInitialLoad = useRef(true); // Prevent useEffect [selectedLog] from firing on init
  const logBufferRef = useRef([]);
  const parseLogLine = (line) => {
    const cleanedLine = line.replace(/\x00/g, "").trim();
    if (!cleanedLine) return { raw: null, level: null };

    // Regex 1: New Backend/UI Log Format
    // [2025-11-04 10:44:39] [INFO    ] [BACKEND:backend.main:lifespan:1894] - Scheduler initialized and started
    const backendLogPattern =
      /^\[([^\]]+)\]\s*\[([^\]\s]+)\s*\]\s+\[([^\]]+)\]\s+-\s+(.*)$/;
    let match = cleanedLine.match(backendLogPattern);
    if (match) {
      return {
        level: match[2].trim(), // e.g., "INFO"
        raw: line, // Return the original line
      };
    }

    // Regex 2: Old Scriptlog Format
    // [timestamp] [INFO] |L.123| message
    const scriptLogPattern =
      /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*\|L\.(\d+)\s*\|\s*(.*)$/;
    match = cleanedLine.match(scriptLogPattern);
    if (match) {
      return {
        level: match[2].trim(), // e.g., "INFO"
        raw: line, // Return the original line
      };
    }

    // Return as raw if no match
    return { raw: line, level: null }; // level is null
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/status`);
      const data = await response.json();
      setStatus({
        running: data.running || false,
        current_mode: data.current_mode || null,
      });
    } catch (error) {
      console.error("Error fetching status:", error);
    }
  };

  const stopScript = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/stop`, {
        method: "POST",
      });
      const data = await response.json();
      if (data.success) {
        showSuccess(t("logViewer.scriptStopped"));
        fetchStatus();
      } else {
        showError(t("logViewer.error", { message: data.message }));
      }
    } catch (error) {
      showError(t("logViewer.error", { message: error.message }));
    } finally {
      setLoading(false);
    }
  };

  // This is only used to get the color, not for rendering
  const LogLevel = ({ level }) => {
    const levelLower = (level || "").toLowerCase().trim();
    const colors = {
      error: "#f87171",
      warning: "#fbbf24",
      warn: "#fbbf24",
      info: "#42A5F5",
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
      info: "#42A5F5",
      success: "#4ade80",
      debug: "#c084fc",
      default: "#d1d5db", // Default color for raw/unknown
    };
    // Use default color if level is null/undefined
    return colors[levelLower] || colors.default;
  };

  useEffect(() => {
    const flushBuffer = () => {
      // Read the logs to flush into a local constant FIRST.
      const logsToFlush = logBufferRef.current;

      // If there's nothing to flush, do nothing.
      if (logsToFlush.length === 0) {
        return;
      }

      // Clear the ref so new logs can start buffering.
      logBufferRef.current = [];

      // Pass the updater function to setLogs.
      setLogs((prevLogs) => [...prevLogs, ...logsToFlush]);
    };

    // Flush the buffer every 500ms
    const flushInterval = setInterval(flushBuffer, 500);

    return () => {
      clearInterval(flushInterval);
      flushBuffer(); // Flush any remaining logs on unmount
    };
  }, []);

  const fetchAvailableLogs = async (showToast = false) => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/logs`);
      const data = await response.json();
      setAvailableLogs(data.logs);
      if (showToast) {
        showSuccess(t("logViewer.logsRefreshed"));
      }
      return data.logs; // Return logs for initial load check
    } catch (error) {
      console.error("Error fetching log files:", error);
      if (showToast) {
        showError(t("logViewer.refreshFailed"));
      }
      return []; // Return empty on error
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // NEW function to load the *entire* log
  const fetchFullLogFile = async (logName) => {
    if (!logName) {
      showError(t("logViewer.noLogSelected"));
      return;
    }
    setIsLoadingFullLog(true);
    showInfo(t("logViewer.loadingFullLog", { name: logName }));
    setAutoScroll(false); // Disable auto-scroll when loading full log
    try {
      // Validate log file name exists in available logs
      if (!availableLogs.some(log => log.name === logName)) {
        showError("Invalid log file selected");
        setIsLoadingFullLog(false);
        return;
      }
      
      const response = await fetch(`${API_URL}/logs/${encodeURIComponent(logName)}?tail=0`); // tail=0
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const strippedContent = data.content.map((line) => line.trim());
      // Parse all lines at once
      const parsedLogs = strippedContent
        .map(parseLogLine)
        .filter((p) => p.raw !== null); // Filter out empty/invalid lines
      setLogs(parsedLogs);
      showSuccess(
        t("logViewer.loadedFullLog", {
          count: parsedLogs.length,
          name: logName,
        })
      );
    } catch (error) {
      console.error("Error fetching full log:", error);
      showError(t("logViewer.loadFailed", { name: logName }));
    } finally {
      setIsLoadingFullLog(false);
    }
  };

  const gatherSupportZip = async () => {
    setIsGatheringSupportZip(true);
    showInfo(t("logViewer.gatheringSupport", "Gathering support files... This may take a moment."));
    try {
      const response = await fetch(`${API_URL}/admin/support-zip`, {
        method: "POST",
      });

      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.detail || errorMsg;
        } catch (e) {
          // Response was not JSON
        }
        throw new Error(errorMsg);
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      let downloadFilename = "posterizarr_support.zip"; // Default
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
        if (filenameMatch && filenameMatch[1]) {
          downloadFilename = filenameMatch[1];
        }
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFilename; //  Use dynamic filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showSuccess(t("logViewer.gatheringSupportSuccess", "Support files downloaded."));

    } catch (error) {
      console.error("Error gathering support zip:", error);
      showError(t("logViewer.gatheringSupportFailed", "Failed to gather support files: {{message}}", { message: error.message }));
    } finally {
      setIsGatheringSupportZip(false);
    }
  };

  const disconnectWebSocket = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setConnected(false);
    setIsReconnecting(false);
  };

  const connectWebSocket = (logFile) => {
    if (!logFile) {
      return;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      if (currentLogFileRef.current === logFile) {
        return;
      }
    }

    disconnectWebSocket();

    try {
      const wsURL = getWebSocketURL(logFile);
      const ws = new WebSocket(wsURL);
      currentLogFileRef.current = logFile;

      ws.onopen = () => {
        setLogs([]); // <-- FIX: Clear logs on new connection
        setConnected(true);
        setIsReconnecting(false);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            const parsedLine = parseLogLine(data.content);
            if (parsedLine.raw) {
              logBufferRef.current.push(parsedLine);
            }
          } else if (data.type === "log_file_changed") {
            if (selectedLog === currentLogFileRef.current) {
              setSelectedLog(data.log_file);
              currentLogFileRef.current = data.log_file;
              showInfo(t("logViewer.switchedTo", { file: data.log_file }));
            }
          } else if (data.type === "error") {
            console.error("WebSocket error message:", data.message);
            showError(data.message);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        setConnected(false);
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (!event.wasClean) {
          setIsReconnecting(true);
          showError(t("logViewer.disconnected"));
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(currentLogFileRef.current);
          }, 2000);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      setConnected(false);
      setIsReconnecting(true);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket(logFile);
      }, 3000);
    }
  };

  // Initial load effect
  useEffect(() => {
    const initialize = async () => {
      // 1. Fetch logs and get the returned array directly
      const logsData = await fetchAvailableLogs(false);

      const priorityLogs = ["Scriptlog.log", "Manuallog.log", "Testinglog.log"];
      const backendLog = "FrontendUI.log";

      let logToLoad = null;

      // 2. Check Navigation State
      const requestedLogFile = location.state?.logFile;
      const requestedExists = requestedLogFile && logsData.some(l => l.name === requestedLogFile);

      if (requestedExists) {
        logToLoad = requestedLogFile;
      } else {
        // 3. Automated Search Logic
        // Find the first available script log from priority list
        logToLoad = priorityLogs.find(priorityName =>
          logsData.some(available => available.name === priorityName)
        );

        // 4. Final Fallback: if no script logs exist, load the backend log
        if (!logToLoad) {
          const backendExists = logsData.some(l => l.name === backendLog);
          // If FrontendUI exists, use it. Otherwise, take the first file in the list or null.
          logToLoad = backendExists ? backendLog : (logsData[0]?.name || null);

          if (logToLoad === backendLog) {
            showInfo(t("logViewer.fallbackToBackend", "Script logs not found, showing backend log."));
          }
        }
      }

      // 5. Connect to the determined log
      if (logToLoad) {
        setSelectedLog(logToLoad);
        currentLogFileRef.current = logToLoad;
        connectWebSocket(logToLoad);
      } else {
        showInfo(t("logViewer.noLogsFound"));
        setLogs([]);
      }

      isInitialLoad.current = false;
    };

    initialize();
    fetchStatus();

    const statusInterval = setInterval(fetchStatus, 3000);

    return () => {
      clearInterval(statusInterval);
      disconnectWebSocket();
    };
  }, []); // Empty dependency array, runs only once on mount

  // Effect to handle manual log selection changes
  useEffect(() => {
    if (isInitialLoad.current) {
      // Don't run this on the very first load
      return;
    }

    if (selectedLog && selectedLog !== currentLogFileRef.current) {
      // fetchLogFile(selectedLog); // <-- REMOVED
      // Reconnect websocket to the new log file
      disconnectWebSocket();
      setTimeout(() => {
        connectWebSocket(selectedLog);
      }, 300);
    }
  }, [selectedLog]);


  const filteredLogs = useMemo(() => {
    const query = searchTerm.toLowerCase();

    // 'logs' is now an array of { raw, level } objects
    return logs.filter((parsed) => {
      // We no longer need to call parseLogLine here!

      const level = (parsed.level || "UNKNOWN").toUpperCase().trim();
      const message = parsed.raw.toLowerCase(); // Filter against the raw line

      let levelMatch = false;
      if (parsed.level === null) {
        // This is a raw line that didn't parse
        levelMatch = !query || message.includes(query);
      } else if (level === "INFO") {
        levelMatch = levelFilters.INFO;
      } else if (level === "WARNING" || level === "WARN") {
        levelMatch = levelFilters.WARNING;
      } else if (level === "ERROR") {
        levelMatch = levelFilters.ERROR;
      } else if (level === "DEBUG") {
        levelMatch = levelFilters.DEBUG;
      } else {
        levelMatch = true; // Show other known levels by default
      }

      if (!levelMatch) return false;

      // Search match is now the primary check
      const searchMatch = !query || message.includes(query);

      return searchMatch;
    });
  }, [logs, searchTerm, levelFilters]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const clearLogs = () => {
    setLogs([]);
    showSuccess(t("logViewer.logsCleared"));
  };

  // UPDATED to download from state
  const downloadLogs = () => {
    if (!selectedLog) {
      showError(t("logViewer.noLogSelected"));
      return;
    }

    // Download the currently filtered logs from state
    const logText = filteredLogs.map(p => p.raw).join("\n");
    const blob = new Blob([logText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const logNameWithoutExt = selectedLog.replace(/\.[^/.]+$/, "");
    a.download = `${logNameWithoutExt}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}_(filtered).log`;

    a.click();
    URL.revokeObjectURL(url);

    showSuccess(t("logViewer.downloaded", { count: filteredLogs.length }));
  };

  const getDisplayStatus = () => {
    if (connected) {
      return {
        color: "bg-green-400",
        icon: Wifi,
        text: t("logViewer.status.live"),
        ringColor: "ring-green-400/30",
      };
    } else if (isReconnecting) {
      return {
        color: "bg-yellow-400",
        icon: Wifi,
        text: t("logViewer.status.reconnecting"),
        ringColor: "ring-yellow-400/30",
      };
    } else {
      return {
        color: "bg-red-400",
        icon: WifiOff,
        text: t("logViewer.status.disconnected"),
        ringColor: "ring-red-400/30",
      };
    }
  };

  const displayStatus = getDisplayStatus();
  const StatusIcon = displayStatus.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      {/* +++ MODIFIED: Added gap-4 and new button +++ */}
      <div className="flex items-center justify-end gap-4">
        {/* Gather Support Logs Button */}
        <button
          onClick={gatherSupportZip}
          disabled={isGatheringSupportZip}
          className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-primary/10 border border-theme-primary/50 rounded-lg text-theme-primary text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGatheringSupportZip ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LifeBuoy className="w-4 h-4" />
          )}
          {t("logViewer.gatherSupport", "Gather Support Logs")}
        </button>

        {/* Connection Status Badge */}
        <div
          className={`flex items-center gap-3 px-4 py-2 rounded-lg bg-theme-card border ${
            connected
              ? "border-green-500/50"
              : isReconnecting
              ? "border-yellow-500/50"
              : "border-red-500/50"
          } shadow-sm`}
        >
          <div className="relative">
            <div
              className={`w-3 h-3 rounded-full ${displayStatus.color} ${
                connected || isReconnecting ? "animate-pulse" : ""
              }`}
            ></div>
            {(connected || isReconnecting) && (
              <div
                className={`absolute inset-0 w-3 h-3 rounded-full ${
                  displayStatus.color
                } ${connected || isReconnecting ? "animate-ping" : ""}`}
              ></div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon className="w-4 h-4 text-theme-muted" />
            <span className="text-sm font-medium text-theme-text">
              {displayStatus.text}
            </span>
          </div>
        </div>
      </div>
      {/* +++ END MODIFICATION +++ */}


      {status.running && (
        <div className="bg-orange-950/40 rounded-xl p-4 border border-orange-600/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-600/20">
                <Activity className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="font-medium text-orange-200">
                  {t("logViewer.scriptRunning")}
                </p>
                <p className="text-sm text-orange-300/80">
                  {status.current_mode && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-200 mr-2">
                      {t("logViewer.mode")}: {status.current_mode}
                    </span>
                  )}
                  {t("logViewer.stopBeforeRunning")}
                </p>
              </div>
            </div>
            <button
              onClick={stopScript}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg font-medium transition-all shadow-sm"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              {t("logViewer.stopScript")}
            </button>
          </div>
        </div>
      )}

      {/* Controls Section */}
      <div className="bg-theme-card rounded-xl p-6 border border-theme shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Log Selector */}
          <div className="flex-1 w-full lg:max-w-md">
            <label className="block text-sm font-medium text-theme-text mb-2">
              {t("logViewer.selectLogFile")}
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text text-sm flex items-center justify-between hover:bg-theme-hover hover:border-theme-primary/50 transition-all shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-theme-primary" />
                  <span className="font-medium">
                    {selectedLog || "Select a log"}
                  </span>
                  {selectedLog &&
                    availableLogs.find((l) => l.name === selectedLog) && (
                      <span className="text-theme-muted text-xs">
                        (
                        {(
                          availableLogs.find((l) => l.name === selectedLog)
                            .size / 1024
                        ).toFixed(2)}{" "}
                        KB)
                      </span>
                    )}
                </div>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    dropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {dropdownOpen && (
                <div className="absolute z-10 w-full mt-2 bg-theme-card border border-theme-primary rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {availableLogs.map((log) => (
                  <button
                      key={log.name}
                      onClick={() => {
                        setSelectedLog(log.name);
                        setDropdownOpen(false);
                      }}
                      className={`w-full px-4 py-3 text-left text-sm transition-all ${
                        selectedLog === log.name
                          ? "bg-theme-primary text-white"
                          : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{log.name}</span>
                        <span className="text-xs opacity-80">
                          {(log.size / 1024).toFixed(2)} KB
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Auto-scroll Toggle Switch */}
            <label className="flex items-center gap-3 px-4 py-2 bg-theme-bg border border-theme rounded-lg cursor-pointer hover:bg-theme-hover transition-all">
              <span className="text-sm text-theme-text font-medium">
                {t("logViewer.autoScroll")}
              </span>
              <div className="relative inline-block w-11 h-6">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-theme-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
              </div>
            </label>

            {/* Refresh Button */}
            <button
              onClick={() => fetchAvailableLogs(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 bg-theme-bg hover:bg-theme-hover border border-theme disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all hover:scale-[1.02] shadow-sm"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {t("logViewer.refresh")}
            </button>

            {/* Load Full Log Button */}
            <button
              onClick={() => fetchFullLogFile(selectedLog)}
              disabled={!selectedLog || isLoadingFullLog}
              className="flex items-center gap-2 px-4 py-2 bg-theme-bg hover:bg-theme-hover border border-theme disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all hover:scale-[1.02] shadow-sm"
            >
              {isLoadingFullLog ? (
                <Loader2 className="w-4 h-4 animate-spin text-theme-primary" />
              ) : (
                <Database className="w-4 h-4 text-theme-primary" />
              )}
              {t("logViewer.loadFull")}
            </button>

            {/* Download Button */}
            <button
              onClick={downloadLogs}
              disabled={!selectedLog || filteredLogs.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text text-sm font-medium transition-all hover:scale-[1.02] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4 text-theme-primary" />
              {t("logViewer.download")}
            </button>

            {/* +++ BUTTON REMOVED FROM HERE +++ */}

            {/* Clear Button */}
            <button
              onClick={clearLogs}
              className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-red-500/50 rounded-lg text-theme-text text-sm font-medium transition-all hover:scale-[1.02] shadow-sm"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              {t("logViewer.clear")}
            </button>
          </div>
        </div>

        {/* FILTER/SEARCH ROW */}
        <div className="mt-4 pt-4 border-t border-theme-border flex flex-col md:flex-row gap-4">
          {/* Search Bar */}
          <div className="flex-grow">
            <label className="block text-sm font-medium text-theme-text mb-2">
              {t("logViewer.searchLogs")}
            </label>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-theme-muted" />
              <input
                type="text"
                placeholder={t("logViewer.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:ring-1 focus:ring-theme-primary focus:border-theme-primary transition-all"
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
          </div>
          {/* Level Filters */}
          <div className="flex-shrink-0">
            <label className="block text-sm font-medium text-theme-text mb-2">
              {t("logViewer.filterLevel")}
            </label>
            <LogLevelFilter
              levelFilters={levelFilters}
              setLevelFilters={setLevelFilters}
            />
          </div>
        </div>
      </div>

      {/* Log Display Section */}
      <div className="bg-theme-card rounded-xl border border-theme shadow-sm overflow-hidden">
        {/* Log Container Header */}
        <div className="bg-theme-bg px-6 py-3 border-b border-theme flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded bg-theme-primary/10">
              <FileText className="w-4 h-4 text-theme-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-theme-text">
                {selectedLog || t("logViewer.noLogSelected")}
              </h3>
              <p className="text-xs text-theme-muted">
                {selectedLog
                  ? t("logViewer.showingLast")
                  : t("logViewer.pleaseSelectLog")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-theme-muted">
            <span className="font-mono">
              {t("logViewer.entries", { count: filteredLogs.length })}
            </span>
            {connected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/30 rounded text-green-400">
                <CheckCircle className="w-3 h-3" />
                <span>{t("logViewer.status.live")}</span>
              </div>
            )}
            {isReconnecting && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>{t("logViewer.status.reconnecting")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Terminal-Style Log Container */}
        <div
          ref={logContainerRef}
          className="h-[700px] overflow-y-auto bg-black p-4"
          style={{ scrollbarWidth: "thin" }}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileText className="w-16 h-16 text-gray-700 mb-4" />
              <p className="text-gray-500 font-medium mb-2">
                {logs.length > 0 &&
                (searchTerm || !Object.values(levelFilters).every((v) => v))
                  ? t("logViewer.noMatchingLogs")
                  : t("logViewer.noLogs")}
              </p>
              <p className="text-gray-600 text-sm">
                {logs.length > 0 &&
                (searchTerm || !Object.values(levelFilters).every((v) => v))
                  ? t("logViewer.adjustFilters")
                  : availableLogs.length > 0
                  ? t("logViewer.startScript")
                  : t("logViewer.noLogsAvailable")}
              </p>
            </div>
          ) : (
            <div className="font-mono text-[11px] leading-relaxed">
              {filteredLogs.map((parsed, index) => { // 'parsed' is { raw, level }
                // Get color based on parsed level
                const logColor = getLogColor(parsed.level); // Use parsed.level

                return (
                  <div
                    key={index}
                    // ...
                    style={{ color: logColor }}
                  >
                    {/* Render the raw line */}
                    <pre className="whitespace-pre-wrap m-0 p-0">{parsed.raw}</pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-theme-bg px-6 py-3 border-t border-theme flex items-center justify-between text-xs text-theme-muted">
          <div className="flex items-center gap-4">
            <span className="font-mono">
              {t("logViewer.logEntries", { count: filteredLogs.length })}
              {logs.length !== filteredLogs.length &&
                ` (filtered from ${logs.length})`}
            </span>
            <span>•</span>
            <span>
              {t("logViewer.autoScrollStatus", {
                status: autoScroll ? t("logViewer.on") : t("logViewer.off"),
              })}
            </span>
          </div>
          {connected && (
            <div className="flex items-center gap-2 text-green-400">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <span>{t("logViewer.receivingUpdates")}</span>
            </div>
          )}
          {isReconnecting && (
            <div className="flex items-center gap-2 text-yellow-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>{t("logViewer.status.reconnecting")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LogViewer;
