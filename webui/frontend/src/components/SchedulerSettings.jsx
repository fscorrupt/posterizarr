import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Plus,
  Trash2,
  Power,
  RefreshCw,
  Play,
  Calendar,
  AlertCircle,
  Loader2,
  Settings,
  Zap,
  ChevronDown,
  Database,
  Share2,
  HardDrive,
  Grid,
  Activity
} from "lucide-react";
import Notification from "./Notification";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import { formatDateTimeInTimezone } from "../utils/timeUtils";
import { waitForLogFile } from "../utils/logUtils";

const API_URL = "/api";

const SchedulerSettings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newTime, setNewTime] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [isUpdating, setIsUpdating] = useState(false);

  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [newMode, setNewMode] = useState("normal");

  // --- NEW CRON-LIKE STATE ---
  const [frequency, setFrequency] = useState("daily");
  const [dayOfWeek, setDayOfWeek] = useState("mon");
  const [dayOfMonth, setDayOfMonth] = useState("1"); // Preserved as string for "1,15" logic
  const [newMonth, setNewMonth] = useState("*");
  const [freqDropdownOpen, setFreqDropdownOpen] = useState(false);
  const [freqDropdownUp, setFreqDropdownUp] = useState(false);
  const freqDropdownRef = useRef(null);

  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [monthDropdownUp, setMonthDropdownUp] = useState(false);
  const monthDropdownRef = useRef(null);

  // --- NEW INTERVAL STATE ---
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState("hours");

  // --- LOGO UPDATER OPTIONS ---
  const [logoLibrary, setLogoLibrary] = useState("all");
  const [logoForceReplace, setLogoForceReplace] = useState(false);
  const [logoRevert, setLogoRevert] = useState(false);

  const frequencies = [
    { id: "daily", label: t("schedulerSettings.frequencies.daily") || "Daily" },
    { id: "weekly", label: t("schedulerSettings.frequencies.weekly") || "Weekly" },
    { id: "monthly", label: t("schedulerSettings.frequencies.monthly") || "Monthly" },
    { id: "interval", label: t("schedulerSettings.frequencies.interval") || "Interval" },
  ];

  const months = [
    { id: "*", label: "Every Month" },
    { id: "1", label: "January" },
    { id: "2", label: "February" },
    { id: "3", label: "March" },
    { id: "4", label: "April" },
    { id: "5", label: "May" },
    { id: "6", label: "June" },
    { id: "7", label: "July" },
    { id: "8", label: "August" },
    { id: "9", label: "September" },
    { id: "10", label: "October" },
    { id: "11", label: "November" },
    { id: "12", label: "December" },
  ];

  const daysOfWeek = [
    { id: "mon", label: t("schedulerSettings.days.mon") || "Monday" },
    { id: "tue", label: t("schedulerSettings.days.tue") || "Tuesday" },
    { id: "wed", label: t("schedulerSettings.days.wed") || "Wednesday" },
    { id: "thu", label: t("schedulerSettings.days.thu") || "Thursday" },
    { id: "fri", label: t("schedulerSettings.days.fri") || "Friday" },
    { id: "sat", label: t("schedulerSettings.days.sat") || "Saturday" },
    { id: "sun", label: t("schedulerSettings.days.sun") || "Sunday" },
  ];

  const intervalUnits = [
    { id: "hours", label: "Hours" },
    { id: "days", label: "Days" },
    { id: "weeks", label: "Weeks" },
  ];

  // Helper for calendar selection
  const toggleCalendarDay = (day) => {
    let selectedDays = dayOfMonth.split(",").filter(d => d !== "");
    const dayStr = day.toString();

    if (selectedDays.includes(dayStr)) {
      selectedDays = selectedDays.filter(d => d !== dayStr);
    } else {
      selectedDays.push(dayStr);
    }

    // Fallback to "1" if everything is deselected
    setDayOfMonth(selectedDays.length > 0 ? selectedDays.sort((a,b) => parseInt(a)-parseInt(b)).join(",") : "1");
  };

  // Time picker state
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerUp, setTimePickerUp] = useState(false);
  const [selectedHour, setSelectedHour] = useState("00");
  const [selectedMinute, setSelectedMinute] = useState("00");
  const timePickerRef = useRef(null);

  const [timezoneDropdownOpen, setTimezoneDropdownOpen] = useState(false);
  const [timezoneDropdownUp, setTimezoneDropdownUp] = useState(false);
  const timezoneDropdownRef = useRef(null);

  const timezones = [
    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
    "America/Los_Angeles", "America/Anchorage", "America/Honolulu", "America/Boise",
    "America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg",
    "America/Halifax", "America/St_Johns", "America/Mexico_City", "America/Sao_Paulo",
    "America/Buenos_Aires", "America/Bogota", "America/Lima", "America/Santiago",
    "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam",
    "Europe/Brussels", "Europe/Madrid", "Europe/Rome", "Europe/Vienna", "Europe/Zurich",
    "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen", "Europe/Helsinki", "Europe/Warsaw",
    "Europe/Prague", "Europe/Budapest", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong",
    "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Jakarta", "Asia/Manila", "Asia/Taipei",
    "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth",
    "Australia/Adelaide", "Pacific/Auckland", "Africa/Cairo", "Africa/Johannesburg",
    "Africa/Lagos", "Africa/Nairobi"
  ];

  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [modeDropdownUp, setModeDropdownUp] = useState(false);
  const modeDropdownRef = useRef(null);

  const runModes = [
    { id: "normal", label: t("schedulerSettings.modes.normal") },
    { id: "syncjelly", label: t("schedulerSettings.modes.syncjelly") || "Sync Jellyfin" },
    { id: "syncemby", label: t("schedulerSettings.modes.syncemby") || "Sync Emby" },
    { id: "backup", label: t("schedulerSettings.modes.backup") || "System Backup" },
    { id: "logoupdater", label: "Logo Updater" },
  ];

  const modeConfigs = {
    normal: { icon: Clock, color: "text-theme-primary", bgColor: "bg-theme-primary/10", label: t("schedulerSettings.modes.normal") },
    syncjelly: { icon: RefreshCw, color: "text-blue-400", bgColor: "bg-blue-400/10", label: "Jellyfin Sync" },
    syncemby: { icon: RefreshCw, color: "text-green-500", bgColor: "bg-green-500/10", label: "Emby Sync" },
    backup: { icon: Database, color: "text-amber-500", bgColor: "bg-amber-500/10", label: "Backup" },
    logoupdater: { icon: Grid, color: "text-purple-400", bgColor: "bg-purple-400/10", label: "Logo Updater" }
  };

  useEffect(() => {
    fetchSchedulerData();
    const interval = setInterval(fetchSchedulerData, 30000);
    return () => clearInterval(interval);
  }, []);

  const calculateDropdownPosition = (ref) => {
    if (!ref.current) return false;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    return spaceAbove > spaceBelow;
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (timezoneDropdownRef.current && !timezoneDropdownRef.current.contains(event.target)) setTimezoneDropdownOpen(false);
      if (timePickerRef.current && !timePickerRef.current.contains(event.target)) setTimePickerOpen(false);
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target)) setModeDropdownOpen(false);
      if (freqDropdownRef.current && !freqDropdownRef.current.contains(event.target)) setFreqDropdownOpen(false);
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(event.target)) setMonthDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSchedulerData = async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        fetch(`${API_URL}/scheduler/config`),
        fetch(`${API_URL}/scheduler/status`),
      ]);
      const configData = await configRes.json();
      const statusData = await statusRes.json();
      if (configData.success) {
        setConfig(configData.config);
        setTimezone(configData.config.timezone || "Europe/Berlin");
      }
      if (statusData.success) setStatus(statusData);
    } catch (error) {
      console.error("Error fetching scheduler data:", error);
      showError(t("schedulerSettings.errors.loadData"));
    } finally {
      setLoading(false);
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"));

  const handleTimeSelect = (hour, minute) => {
    const time = `${hour}:${minute}`;
    setNewTime(time);
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setTimePickerOpen(false);
  };

  const openTimePicker = () => {
    if (isUpdating) return;
    const shouldOpenUp = calculateDropdownPosition(timePickerRef);
    setTimePickerUp(shouldOpenUp);
    setTimePickerOpen(!timePickerOpen);
  };

  const toggleScheduler = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const endpoint = config.enabled ? "disable" : "enable";
      const response = await fetch(`${API_URL}/scheduler/${endpoint}`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        showSuccess(t(`schedulerSettings.success.scheduler${config.enabled ? "Disabled" : "Enabled"}`));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.updateScheduler"));
      }
    } catch (error) {
      console.error("Error toggling scheduler:", error);
      showError(t("schedulerSettings.errors.updateScheduler"));
    } finally {
      setIsUpdating(false);
    }
  };

  const addSchedule = async (e) => {
    e.preventDefault();

    if (!newTime) {
      showError(t("schedulerSettings.errors.enterTime"));
      return;
    }

    if (frequency !== "interval" && !newTime) {
      showError(t("schedulerSettings.errors.enterTime"));
      return;
    }
    if (frequency !== "interval") {
      const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
      if (!timePattern.test(newTime)) {
        showError("Invalid time format. Please use HH:MM (00:00-23:59)");
        return;
      }
    }
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const payload = {
        time: newTime,
        description: newDescription,
        mode: newMode,
        frequency: frequency,
        month: newMonth,
      };

      if (newMode === "logoupdater") {
        payload.library = logoLibrary;
        payload.force_replace = logoForceReplace;
        payload.revert = logoRevert;
      }

      if (frequency === "weekly") {
        payload.day_of_week = dayOfWeek;
        payload.day = "*";
      } else if (frequency === "monthly") {
        payload.day = dayOfMonth;
        payload.day_of_week = "*";
      } else if (frequency === "interval") {
        payload.interval_value = intervalValue;
        payload.interval_unit = intervalUnit;
        payload.day = "*";
        payload.day_of_week = "*";
      } else {
        payload.day = "*";
        payload.day_of_week = "*";
      }

      const response = await fetch(`${API_URL}/scheduler/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        showSuccess(t("schedulerSettings.success.scheduleAdded"));
        setNewTime("");
        setNewDescription("");
        setFrequency("daily");
        setDayOfWeek("mon");
        setDayOfMonth("1");
        setNewMonth("*");
        setIntervalValue(1);
        setIntervalUnit("hours");
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.addSchedule"));
      }
    } catch (error) {
      console.error("Error adding schedule:", error);
      showError(t("schedulerSettings.errors.addSchedule"));
    } finally {
      setIsUpdating(false);
    }
  };

  const removeSchedule = async (time) => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/scheduler/schedule/${encodeURIComponent(time)}`, { method: "DELETE" });
      const data = await response.json();
      if (data.success) {
        showSuccess(t("schedulerSettings.success.scheduleRemoved"));
        await new Promise((resolve) => setTimeout(resolve, 200));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.removeSchedule"));
      }
    } catch (error) {
      console.error("Error removing schedule:", error);
      showError(t("schedulerSettings.errors.removeSchedule"));
    } finally {
      setIsUpdating(false);
    }
  };

  const clearAllSchedules = async () => setClearAllConfirm(true);

  const handleClearAllConfirm = async () => {
    setClearAllConfirm(false);
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/scheduler/schedules`, { method: "DELETE" });
      const data = await response.json();
      if (data.success) {
        setStatus(data);
        const configRes = await fetch(`${API_URL}/scheduler/config`);
        const configData = await configRes.json();
        if (configData.success) setConfig(configData.config);
        showSuccess(t("schedulerSettings.success.allCleared"));
      } else {
        showError(data.detail || t("schedulerSettings.errors.clearSchedules"));
      }
    } catch (error) {
      console.error("Error clearing schedules:", error);
      showError(t("schedulerSettings.errors.clearSchedules"));
    } finally {
      setIsUpdating(false);
    }
  };

  const updateTimezone = async (newTimezone) => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/scheduler/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: newTimezone }),
      });
      const data = await response.json();
      if (data.success) {
        showSuccess(t("schedulerSettings.success.timezoneUpdated"));
        setTimezone(newTimezone);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.updateTimezone"));
      }
    } catch (error) {
      console.error("Error updating timezone:", error);
      showError(t("schedulerSettings.errors.updateTimezone"));
    } finally {
      setIsUpdating(false);
    }
  };

  const updateSkipIfRunning = async (value) => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/scheduler/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip_if_running: value }),
      });
      const data = await response.json();
      if (data.success) {
        showSuccess(value ? t("schedulerSettings.success.willSkip") : t("schedulerSettings.success.willAllow"));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.updateConfig"));
      }
    } catch (error) {
      console.error("Error updating config:", error);
      showError(t("schedulerSettings.errors.updateConfig"));
    } finally {
      setIsUpdating(false);
    }
  };

  const triggerNow = async () => {
    console.log("🏃 triggerNow called - isUpdating:", isUpdating, "status?.is_executing:", status?.is_executing, "config?.enabled:", config?.enabled);
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      console.log("🚀 Sending API request to:", `${API_URL}/scheduler/run-now`);
      const response = await fetch(`${API_URL}/scheduler/run-now`, { method: "POST" });
      const data = await response.json();
      console.log("🏃 Response data:", data);
      if (data.success) {
        showSuccess(t("schedulerSettings.success.manualRunTriggered"));
        fetchSchedulerData();
        const logFile = "Scriptlog.log";
        const logExists = await waitForLogFile(logFile);
        navigate("/logs", { state: { logFile: logFile } });
      } else {
        showError(data.detail || t("schedulerSettings.errors.triggerRun"));
      }
    } catch (error) {
      console.error("🏃 Error in triggerNow:", error);
      showError(t("schedulerSettings.errors.triggerRun"));
    } finally {
      setIsUpdating(false);
    }
  };

  const restartScheduler = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/scheduler/restart`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        showSuccess(t("schedulerSettings.success.schedulerRestarted"));
        await fetchSchedulerData();
      } else {
        showError(data.detail || t("schedulerSettings.errors.restartScheduler"));
      }
    } catch (error) {
      console.error("Error restarting scheduler:", error);
      showError(t("schedulerSettings.errors.restartScheduler"));
    } finally {
      setIsUpdating(false);
    }
  };

  const formatDateTime = (isoString) => formatDateTimeInTimezone(isoString, timezone, t("schedulerSettings.never"));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary mx-auto mb-4" />
          <p className="text-theme-muted">{t("schedulerSettings.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        isOpen={clearAllConfirm}
        onClose={() => setClearAllConfirm(false)}
        onConfirm={handleClearAllConfirm}
        title={t("schedulerSettings.confirmClearAllTitle")}
        message={t("schedulerSettings.confirmClearAllMessage")}
        type="danger"
      />

      <div className="bg-blue-900/20 border-l-4 border-blue-500 rounded-lg p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-blue-300 mb-2">{t("schedulerSettings.containerUsersOnly")}</h3>
            <p className="text-sm text-blue-200 leading-relaxed" dangerouslySetInnerHTML={{ __html: t("schedulerSettings.containerUsersInfo") }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-theme-card rounded-xl shadow-sm border border-theme p-5 hover:border-theme-primary/50 transition-all">
          <div className="flex items-center gap-2 text-sm text-theme-muted mb-2"><Calendar className="w-4 h-4" />{t("schedulerSettings.lastRun")}</div>
          <div className="text-xl font-semibold text-theme-text">{formatDateTime(status?.last_run)}</div>
        </div>
        <div className="bg-theme-card rounded-xl shadow-sm border border-theme p-5 hover:border-theme-primary/50 transition-all">
          <div className="flex items-center gap-2 text-sm text-theme-muted mb-2"><Clock className="w-4 h-4" />{t("schedulerSettings.nextRun")}</div>
          <div className="text-xl font-semibold text-theme-text">{formatDateTime(status?.next_run)}</div>
        </div>
        <div className="bg-theme-card rounded-xl shadow-sm border border-theme p-5 hover:border-theme-primary/50 transition-all">
          <div className="flex items-center gap-2 text-sm text-theme-muted mb-2"><Zap className="w-4 h-4" />Status</div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${status?.is_executing ? "bg-yellow-500 animate-pulse" : status?.running ? "bg-green-500" : "bg-theme-muted"}`} />
            <span className="text-xl font-semibold text-theme-text">
              {status?.is_executing ? t("schedulerSettings.status.running") : status?.running ? t("schedulerSettings.status.active") : t("schedulerSettings.status.inactive")}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-theme-card rounded-xl shadow-sm border border-theme p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-theme-primary/10"><Settings className="w-6 h-6 text-theme-primary" /></div>
            <h2 className="text-xl font-semibold text-theme-primary">{t("schedulerSettings.configuration")}</h2>
          </div>
          <button
            onClick={toggleScheduler}
            disabled={isUpdating}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all shadow-sm hover:scale-105 ${config?.enabled ? "bg-green-600 hover:bg-green-700 text-white" : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text"} ${isUpdating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {isUpdating ? <Loader2 className="w-5 h-5 text-theme-primary animate-spin" /> : <Power className="w-5 h-5" />}
            {isUpdating ? t("schedulerSettings.updating") : config?.enabled ? t("schedulerSettings.enabled") : t("schedulerSettings.disabled")}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-text mb-2">{t("schedulerSettings.timezone")}</label>
          <p className="text-xs text-theme-muted mb-2">{t("schedulerSettings.timezoneDescription")}</p>
          <div className="relative" ref={timezoneDropdownRef}>
            <button
              onClick={() => { if (!isUpdating) { setTimezoneDropdownUp(calculateDropdownPosition(timezoneDropdownRef)); setTimezoneDropdownOpen(!timezoneDropdownOpen); } }}
              disabled={isUpdating}
              className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-between"
            >
              <span>{timezone}</span>
              <ChevronDown className={`w-5 h-5 text-theme-muted transition-transform ${timezoneDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {timezoneDropdownOpen && !isUpdating && (
              <div className={`absolute z-50 left-0 right-0 ${timezoneDropdownUp ? "bottom-full mb-2" : "top-full mt-2"} bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-80 overflow-y-auto`}>
                {timezones.map((tz) => (
                  <button key={tz} onClick={() => { updateTimezone(tz); setTimezoneDropdownOpen(false); }} className={`w-full px-4 py-2 text-sm transition-all text-left ${timezone === tz ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>{tz}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-theme-bg rounded-lg border border-theme">
          <div>
            <label className="block text-sm font-medium text-theme-text">{t("schedulerSettings.skipIfRunning")}</label>
            <p className="text-sm text-theme-muted mt-1">{t("schedulerSettings.skipIfRunningDesc")}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={config?.skip_if_running || false} onChange={(e) => updateSkipIfRunning(e.target.checked)} disabled={isUpdating} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-theme-primary peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={restartScheduler} disabled={isUpdating || !config?.enabled} className="flex items-center gap-2 px-5 py-2.5 bg-theme-primary hover:bg-theme-primary/90 text-white rounded-lg transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
            {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
            {t("schedulerSettings.restartScheduler")}
          </button>
          <button onClick={triggerNow} disabled={isUpdating || status?.is_executing || !config?.enabled} className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
            {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            {t("schedulerSettings.runNow")}
          </button>
        </div>
      </div>

      <div className="bg-theme-card rounded-xl shadow-sm border border-theme p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-theme-primary/10"><Clock className="w-6 h-6 text-theme-primary" /></div>
            <h2 className="text-xl font-semibold text-theme-primary">{t("schedulerSettings.schedules")}</h2>
          </div>
          {config?.schedules?.length > 0 && <button onClick={clearAllSchedules} disabled={isUpdating} className="text-sm text-red-400 hover:text-red-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{t("schedulerSettings.clearAll")}</button>}
        </div>

        <form onSubmit={addSchedule} className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            {(frequency !== "interval" || frequency === "interval") && (
              <div className="flex-1 relative" ref={timePickerRef}>
                <button type="button" onClick={openTimePicker} disabled={isUpdating} className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-between">
                  <span className={newTime ? "" : "text-theme-muted"}>{newTime || t("schedulerSettings.timePlaceholder")}</span>
                  <Clock className="w-5 h-5 text-theme-muted" />
                </button>
                {timePickerOpen && !isUpdating && (
                  <div className={`absolute z-50 left-0 right-0 ${timePickerUp ? "bottom-full mb-2" : "top-full mt-2"} bg-theme-card border border-theme-primary rounded-lg shadow-xl`}>
                    <div className="flex divide-x divide-theme">
                      <div className="flex-1 max-h-64 overflow-y-auto">
                        <div className="sticky top-0 bg-theme-card border-b border-theme px-3 py-2 text-xs font-semibold text-theme-primary">{t("schedulerSettings.hour") || "Hour"}</div>
                        {hours.map((hour) => (
                          <button key={hour} type="button" onClick={() => handleTimeSelect(hour, selectedMinute)} className={`w-full px-4 py-2 text-sm transition-all text-center ${selectedHour === hour ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>{hour}</button>
                        ))}
                      </div>
                      <div className="flex-1 max-h-64 overflow-y-auto">
                        <div className="sticky top-0 bg-theme-card border-b border-theme px-3 py-2 text-xs font-semibold text-theme-primary">{t("schedulerSettings.minute") || "Minute"}</div>
                        {minutes.map((minute) => (
                          <button key={minute} type="button" onClick={() => handleTimeSelect(selectedHour, minute)} className={`w-full px-4 py-2 text-sm transition-all text-center ${selectedMinute === minute ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>{minute}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 relative" ref={modeDropdownRef}>
              <button type="button" onClick={() => { if (!isUpdating) { setModeDropdownUp(calculateDropdownPosition(modeDropdownRef)); setModeDropdownOpen(!modeDropdownOpen); } }} disabled={isUpdating} className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {React.createElement(modeConfigs[newMode]?.icon || Clock, { className: `w-4 h-4 ${modeConfigs[newMode]?.color || 'text-theme-primary'}` })}
                  <span>{runModes.find((m) => m.id === newMode)?.label}</span>
                </div>
                <ChevronDown className={`w-5 h-5 text-theme-muted transition-transform ${modeDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {modeDropdownOpen && !isUpdating && (
                <div className={`absolute z-50 left-0 right-0 ${modeDropdownUp ? "bottom-full mb-2" : "top-full mt-2"} bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}>
                  {runModes.map((mode) => (
                    <button key={mode.id} type="button" onClick={() => { setNewMode(mode.id); setModeDropdownOpen(false); }} className={`w-full px-4 py-3 text-sm transition-all text-left flex items-center gap-3 ${newMode === mode.id ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>
                      {React.createElement(modeConfigs[mode.id].icon, { className: "w-4 h-4" })}{mode.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 relative" ref={freqDropdownRef}>
              <button type="button" onClick={() => { if (!isUpdating) { setFreqDropdownUp(calculateDropdownPosition(freqDropdownRef)); setFreqDropdownOpen(!freqDropdownOpen); } }} disabled={isUpdating} className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-theme-primary" /><span>{frequencies.find((f) => f.id === frequency)?.label}</span></div>
                <ChevronDown className={`w-5 h-5 text-theme-muted transition-transform ${freqDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {freqDropdownOpen && !isUpdating && (
                <div className={`absolute z-50 left-0 right-0 ${freqDropdownUp ? "bottom-full mb-2" : "top-full mt-2"} bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}>
                  {frequencies.map((freq) => (
                    <button key={freq.id} type="button" onClick={() => { setFrequency(freq.id); setFreqDropdownOpen(false); }} className={`w-full px-4 py-3 text-sm transition-all text-left ${frequency === freq.id ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>{freq.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            {frequency === "interval" && (
              <div className="flex-1 flex gap-2">
                 <div className="flex items-center gap-2 bg-theme-bg border border-theme rounded-lg px-3 flex-1">
                    <span className="text-theme-muted text-sm whitespace-nowrap">Every</span>
                    <input
                      type="number"
                      min="1"
                      value={intervalValue}
                      onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-transparent text-theme-text focus:outline-none"
                    />
                 </div>
                 <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value)}
                  className="px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary transition-all"
                >
                  {intervalUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>{unit.label}</option>
                  ))}
                </select>
              </div>
            )}

            {frequency === "monthly" && (
              <div className="flex-1 relative" ref={monthDropdownRef}>
                <button type="button" onClick={() => { if (!isUpdating) { setMonthDropdownUp(calculateDropdownPosition(monthDropdownRef)); setMonthDropdownOpen(!monthDropdownOpen); } }} disabled={isUpdating} className="w-full px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-theme-primary" /><span>{months.find((m) => m.id === newMonth)?.label}</span></div>
                  <ChevronDown className={`w-5 h-5 text-theme-muted transition-transform ${monthDropdownOpen ? "rotate-180" : ""}`} />
                </button>
                {monthDropdownOpen && !isUpdating && (
                  <div className={`absolute z-50 left-0 right-0 ${monthDropdownUp ? "bottom-full mb-2" : "top-full mt-2"} bg-theme-card border border-theme-primary rounded-lg shadow-xl max-h-60 overflow-y-auto`}>
                    {months.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setNewMonth(m.id); setMonthDropdownOpen(false); }} className={`w-full px-4 py-3 text-sm transition-all text-left ${newMonth === m.id ? "bg-theme-primary text-white" : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"}`}>{m.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {frequency === "weekly" && (
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="flex-1 px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 transition-all">
                {daysOfWeek.map((day) => (<option key={day.id} value={day.id}>{day.label}</option>))}
              </select>
            )}

            <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={t("schedulerSettings.descriptionPlaceholder")} disabled={isUpdating} className="flex-[2] px-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all" />

            <button type="submit" disabled={isUpdating} className="flex items-center justify-center gap-2 px-6 py-3 bg-theme-primary hover:bg-theme-primary/90 text-white rounded-lg transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
              {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}{t("schedulerSettings.add")}
            </button>
          </div>

          {/* Logo Updater Options */}
          {newMode === "logoupdater" && (
            <div className="flex flex-col md:flex-row gap-4 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
              <div className="flex-1">
                <label className="block text-xs font-medium text-purple-300 mb-1">Plex Library</label>
                <input
                  type="text"
                  value={logoLibrary}
                  onChange={(e) => setLogoLibrary(e.target.value)}
                  placeholder="Library name or 'all'"
                  className="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-sm text-theme-text focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>
              <div className="flex items-center gap-6 pt-5">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={logoForceReplace}
                    onChange={(e) => setLogoForceReplace(e.target.checked)}
                    disabled={logoRevert}
                    className="w-4 h-4 rounded border-theme bg-theme-bg text-purple-500 focus:ring-purple-500"
                  />
                  <span className={`text-sm ${logoRevert ? 'text-theme-muted' : 'text-theme-text group-hover:text-purple-300'} transition-colors`}>Force Replace</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={logoRevert}
                    onChange={(e) => setLogoRevert(e.target.checked)}
                    className="w-4 h-4 rounded border-theme bg-theme-bg text-purple-500 focus:ring-purple-500"
                  />
                  <span className="text-sm text-theme-text group-hover:text-purple-300 transition-colors">Revert Mode</span>
                </label>
              </div>
            </div>
          )}

          {/* Calendar Day Picker for Monthly selection */}
          {frequency === "monthly" && (
            <div className="p-4 bg-theme-bg border border-theme rounded-lg">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-theme-text">
                <Grid className="w-4 h-4 text-theme-primary" />
                Select Days
              </div>
              <div className="grid grid-cols-7 sm:grid-cols-10 gap-1.5">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleCalendarDay(day)}
                    className={`h-9 rounded-md text-xs font-medium transition-all border ${
                      dayOfMonth.split(",").includes(day.toString())
                        ? "bg-theme-primary text-white border-theme-primary"
                        : "bg-theme-card text-theme-muted border-theme hover:border-theme-primary/50"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-theme-muted">You can select multiple specific days of the month.</p>
            </div>
          )}
        </form>

        {config?.schedules?.length > 0 ? (
          <div className="space-y-3">
            {config.schedules.map((schedule, index) => {
              const mode = schedule.mode || "normal";
              const mConfig = modeConfigs[mode] || modeConfigs.normal;
              const Icon = mConfig.icon;
              const freqVal = schedule.frequency || "daily";
              const freqLabel = frequencies.find(f => f.id === freqVal)?.label || freqVal;
              let detailText = "";
              const monthVal = schedule.month || "*";
              const monthLabel = months.find(m => m.id === monthVal)?.label || monthVal;

              if (freqVal === "interval") {
                detailText = `Every ${schedule.interval_value} ${schedule.interval_unit}`;
              } else {
                if (monthVal !== "*") detailText = `${monthLabel} `;
                if (freqVal === "weekly") {
                  detailText += daysOfWeek.find(d => d.id === schedule.day_of_week)?.label || schedule.day_of_week;
                } else if (freqVal === "monthly") {
                  detailText += `Day ${schedule.day}`;
                }
              }

              return (
                <div key={index} className="flex items-center justify-between p-4 bg-theme-bg rounded-lg hover:bg-theme-hover transition-all border border-theme hover:border-theme-primary/50 group">
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-lg ${mConfig.bgColor} transition-all`}><Icon className={`w-5 h-5 ${mConfig.color}`} /></div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-theme-text text-lg">{freqVal === "interval" ? <Activity className="w-5 h-5 text-theme-muted" /> : schedule.time}</span>
                        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border ${mConfig.color} ${mConfig.bgColor} border-current opacity-80`}>{mConfig.label}</span>
                        <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border border-theme-muted/30 text-theme-muted">{freqLabel}{detailText ? `, ${detailText}` : ""}</span>
                      </div>
                      {schedule.description && <div className="text-sm text-theme-muted mt-0.5">{schedule.description}</div>}
                      {mode === "logoupdater" && (
                        <div className="flex gap-3 mt-1 text-[10px] text-purple-300/70 font-medium">
                          <span>Library: {schedule.library || "all"}</span>
                          {schedule.force_replace && <span>• Force Replace</span>}
                          {schedule.revert && <span className="text-red-400">•• REVERT MODE</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeSchedule(schedule.time)} disabled={isUpdating} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-all"><Trash2 className="w-5 h-5" /></button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-theme-bg rounded-lg border border-theme">
            <Clock className="w-16 h-16 mx-auto mb-3 text-theme-muted opacity-30" />
            <p className="font-semibold text-theme-text mb-1">{t("schedulerSettings.noSchedulesConfigured")}</p>
            <p className="text-sm text-theme-muted">{t("schedulerSettings.addScheduleHint")}</p>
          </div>
        )}
      </div>

      {status?.active_jobs?.length > 0 && (
        <div className="bg-theme-primary/10 rounded-xl border border-theme-primary/30 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3"><Zap className="w-5 h-5 text-theme-primary" /><h3 className="text-sm font-semibold text-theme-primary">{t("schedulerSettings.activeJobs")}</h3></div>
          <div className="space-y-2">
            {status.active_jobs.map((job, index) => (
              <div key={index} className="text-sm text-theme-text bg-theme-card px-3 py-2 rounded-lg border border-theme">
                <span className="font-medium">{job.name}</span>
                <span className="text-theme-muted"> - {t("schedulerSettings.next")}: </span>
                <span className="text-theme-primary font-medium">{formatDateTime(job.next_run)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulerSettings;
