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
  Activity,
  Edit2,
  Check,
  X,
  Pencil
} from "lucide-react";
import Notification from "./Notification";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import { formatDateTimeInTimezone } from "../utils/timeUtils";

const API_URL = "/api";

// ============================================================================
// WAIT FOR LOG FILE - Polls backend until log file exists
// ============================================================================
const waitForLogFile = async (logFileName, maxAttempts = 30, delayMs = 200) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/logs/${logFileName}/exists`);
      const data = await response.json();

      if (data.exists) {
        console.log(`Log file ${logFileName} exists after ${i + 1} attempts`);
        return true;
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`Error checking log file existence: ${error}`);
      // Continue trying even if there's an error
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.warn(
    `Log file ${logFileName} not found after ${maxAttempts} attempts`
  );
  return false;
};

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
  const [editingIndex, setEditingIndex] = useState(null);
  const formRef = useRef(null);

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
  const [logoExifCheck, setLogoExifCheck] = useState(false);
  const [logoRevert, setLogoRevert] = useState(false);

  // --- PLEX SYNC OPTIONS ---
  const [plexSyncLibrary, setPlexSyncLibrary] = useState("all");
  const [plexSyncAssetTypes, setPlexSyncAssetTypes] = useState([
    "collection", "poster", "season", "titlecard", "background"
  ]);

  // --- APP CONFIG & SERVER STATUS (to check configured media servers) ---
  const [appConfig, setAppConfig] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);

  const isPlexConfigured = () => {
    if (serverStatus && serverStatus.plex !== undefined) return Boolean(serverStatus.plex);
    if (!appConfig) return true; // Default true while loading to prevent flash
    const isFlat = Boolean(appConfig.using_flat_structure);
    const usePlex = isFlat ? appConfig.UsePlex : appConfig.PlexPart?.UsePlex;
    const plexUrl = isFlat ? appConfig.PlexUrl : appConfig.PlexPart?.PlexUrl;
    return (String(usePlex).toLowerCase() === "true" || usePlex === true) && Boolean(plexUrl);
  };

  const isJellyfinConfigured = () => {
    if (serverStatus && serverStatus.jellyfin !== undefined) return Boolean(serverStatus.jellyfin);
    if (!appConfig) return true;
    const isFlat = Boolean(appConfig.using_flat_structure);
    const useJelly = isFlat ? appConfig.UseJellyfin : appConfig.JellyfinPart?.UseJellyfin;
    const jellyUrl = isFlat ? appConfig.JellyfinUrl : appConfig.JellyfinPart?.JellyfinUrl;
    return (String(useJelly).toLowerCase() === "true" || useJelly === true) && Boolean(jellyUrl);
  };

  const isEmbyConfigured = () => {
    if (serverStatus && serverStatus.emby !== undefined) return Boolean(serverStatus.emby);
    if (!appConfig) return true;
    const isFlat = Boolean(appConfig.using_flat_structure);
    const useEmby = isFlat ? appConfig.UseEmby : appConfig.EmbyPart?.UseEmby;
    const embyUrl = isFlat ? appConfig.EmbyUrl : appConfig.EmbyPart?.EmbyUrl;
    return (String(useEmby).toLowerCase() === "true" || useEmby === true) && Boolean(embyUrl);
  };

  const isAnyServerConfigured = () => {
    return isPlexConfigured() || isJellyfinConfigured() || isEmbyConfigured();
  };

  const getActiveLogoServerType = () => {
    if (isPlexConfigured()) return "plex";
    if (isJellyfinConfigured()) return "jellyfin";
    if (isEmbyConfigured()) return "emby";
    return "plex";
  };

  const getActiveLogoServerName = () => {
    const type = getActiveLogoServerType();
    if (type === "plex") return "Plex";
    if (type === "jellyfin") return "Jellyfin";
    if (type === "emby") return "Emby";
    return "Media Server";
  };

  // --- LOGO LIBRARIES (for Logo Updater) ---
  const [logoLibraries, setLogoLibraries] = useState([]);
  const [loadingLogoLibraries, setLoadingLogoLibraries] = useState(false);

  const fetchLogoLibraries = async (forceRefresh = false) => {
    setLoadingLogoLibraries(true);
    try {
      const serverType = getActiveLogoServerType();
      const url = forceRefresh ? `${API_URL}/libraries/${serverType}/cached?refresh=true` : `${API_URL}/libraries/${serverType}/cached`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.libraries)) {
        setLogoLibraries(data.libraries);
      }
    } catch (err) {
      console.error("Error fetching logo libraries:", err);
    } finally {
      setLoadingLogoLibraries(false);
    }
  };

  // --- PLEX LIBRARIES (for selectors) ---
  const [plexLibraries, setPlexLibraries] = useState([]);
  const [loadingPlexLibraries, setLoadingPlexLibraries] = useState(false);

  const fetchPlexLibraries = async (forceRefresh = false) => {
    setLoadingPlexLibraries(true);
    try {
      const url = forceRefresh ? `${API_URL}/libraries/plex/cached?refresh=true` : `${API_URL}/libraries/plex/cached`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.libraries)) {
        setPlexLibraries(data.libraries);
      }
    } catch (err) {
      console.error("Error fetching Plex libraries:", err);
    } finally {
      setLoadingPlexLibraries(false);
    }
  };

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
    ...(isJellyfinConfigured() ? [{ id: "syncjelly", label: t("schedulerSettings.modes.syncjelly") || "Sync Jellyfin" }] : []),
    ...(isEmbyConfigured() ? [{ id: "syncemby", label: t("schedulerSettings.modes.syncemby") || "Sync Emby" }] : []),
    { id: "backup", label: t("schedulerSettings.modes.backup") || "System Backup" },
    ...(isAnyServerConfigured() ? [{ id: "logoupdater", label: "Logo Updater" }] : []),
    ...(isPlexConfigured() ? [{ id: "plexsync", label: "Plex Sync" }] : []),
  ];

  useEffect(() => {
    if (appConfig) {
      if (newMode === "plexsync" && !isPlexConfigured()) setNewMode("normal");
      if (newMode === "logoupdater" && !isAnyServerConfigured()) setNewMode("normal");
      if (newMode === "syncjelly" && !isJellyfinConfigured()) setNewMode("normal");
      if (newMode === "syncemby" && !isEmbyConfigured()) setNewMode("normal");
    }
  }, [appConfig, newMode]);

  const modeConfigs = {
    normal: { icon: Clock, color: "text-theme-primary", bgColor: "bg-theme-primary/10", label: t("schedulerSettings.modes.normal") },
    syncjelly: { icon: RefreshCw, color: "text-blue-400", bgColor: "bg-blue-400/10", label: "Jellyfin Sync" },
    syncemby: { icon: RefreshCw, color: "text-green-500", bgColor: "bg-green-500/10", label: "Emby Sync" },
    backup: { icon: Database, color: "text-amber-500", bgColor: "bg-amber-500/10", label: "Backup" },
    logoupdater: { icon: Grid, color: "text-purple-400", bgColor: "bg-purple-400/10", label: "Logo Updater" },
    plexsync: { icon: Zap, color: "text-amber-500", bgColor: "bg-amber-500/10", label: "Plex Sync" }
  };

  useEffect(() => {
    fetchSchedulerData();
    fetchPlexLibraries();
    fetchLogoLibraries();
    const interval = setInterval(fetchSchedulerData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (newMode === "logoupdater" && logoLibraries.length === 0) {
      fetchLogoLibraries();
    }
  }, [newMode]);

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
      const [configRes, statusRes, appConfigRes] = await Promise.all([
        fetch(`${API_URL}/scheduler/config`),
        fetch(`${API_URL}/scheduler/status`),
        fetch(`${API_URL}/config`),
      ]);
      const configData = await configRes.json();
      const statusData = await statusRes.json();
      const appConfigData = await appConfigRes.json();
      if (configData.success) {
        setConfig(configData.config);
        setTimezone(configData.config.timezone || "Europe/Berlin");
        if (configData.servers) {
          setServerStatus(configData.servers);
        }
      }
      if (statusData.success) setStatus(statusData);
      if (appConfigData && (appConfigData.config || appConfigData.PlexPart || appConfigData.UsePlex !== undefined)) {
        setAppConfig(appConfigData.config || appConfigData);
      }
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
        payload.exif_check = logoExifCheck;
        payload.revert = logoRevert;
      } else if (newMode === "plexsync") {
        payload.library = plexSyncLibrary;
        payload.asset_types = plexSyncAssetTypes;
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

      const isEditing = editingIndex !== null;
      const endpoint = isEditing ? `${API_URL}/scheduler/schedule/${editingIndex}` : `${API_URL}/scheduler/schedule`;
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        showSuccess(isEditing ? (t("schedulerSettings.success.scheduleUpdated") || "Schedule updated successfully") : t("schedulerSettings.success.scheduleAdded"));
        handleCancelEdit();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fetchSchedulerData();
      } else {
        showError(data.detail || (isEditing ? "Failed to update schedule" : t("schedulerSettings.errors.addSchedule")));
      }
    } catch (error) {
      console.error("Error saving schedule:", error);
      showError(editingIndex !== null ? "Failed to update schedule" : t("schedulerSettings.errors.addSchedule"));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEditSchedule = (schedule, index) => {
    setEditingIndex(index);
    setNewTime(schedule.time || "");
    if (schedule.time && schedule.time.includes(":")) {
      const [h, m] = schedule.time.split(":");
      setSelectedHour(h || "00");
      setSelectedMinute(m || "00");
    }
    setNewDescription(schedule.description || "");
    setNewMode(schedule.mode || "normal");
    setFrequency(schedule.frequency || "daily");
    setDayOfWeek(schedule.day_of_week || "mon");
    setDayOfMonth(schedule.day ? schedule.day.toString() : "1");
    setNewMonth(schedule.month || "*");
    setIntervalValue(schedule.interval_value || 1);
    setIntervalUnit(schedule.interval_unit || "hours");

    if (schedule.mode === "logoupdater") {
      setLogoLibrary(schedule.library || "all");
      setLogoForceReplace(Boolean(schedule.force_replace));
      setLogoExifCheck(Boolean(schedule.exif_check));
      setLogoRevert(Boolean(schedule.revert));
    } else if (schedule.mode === "plexsync") {
      setPlexSyncLibrary(schedule.library || "all");
      setPlexSyncAssetTypes(
        Array.isArray(schedule.asset_types)
          ? schedule.asset_types
          : ["collection", "poster", "season", "titlecard", "background"]
      );
    }

    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setNewTime("");
    setNewDescription("");
    setFrequency("daily");
    setDayOfWeek("mon");
    setDayOfMonth("1");
    setNewMonth("*");
    setIntervalValue(1);
    setIntervalUnit("hours");
    setPlexSyncLibrary("all");
    setLogoLibrary("all");
    setLogoForceReplace(false);
    setLogoExifCheck(false);
    setLogoRevert(false);
  };

  const removeSchedule = async (time, index) => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const endpoint = (index !== undefined && index !== null)
        ? `${API_URL}/scheduler/schedule/index/${index}`
        : `${API_URL}/scheduler/schedule/${encodeURIComponent(time)}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const data = await response.json();
      if (data.success) {
        if (editingIndex === index) {
          handleCancelEdit();
        } else if (editingIndex !== null && editingIndex > index) {
          setEditingIndex(editingIndex - 1);
        }
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

        {editingIndex !== null && (
          <div className="flex items-center justify-between p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-1 rounded bg-amber-500/20">
                <Pencil className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <span className="font-semibold text-amber-300">Editing Schedule #{editingIndex + 1}</span>
                <span className="text-amber-400/80 text-xs ml-2">
                  ({config?.schedules?.[editingIndex]?.time || (config?.schedules?.[editingIndex]?.frequency === "interval" ? `Every ${config?.schedules?.[editingIndex]?.interval_value} ${config?.schedules?.[editingIndex]?.interval_unit}` : "")} • {config?.schedules?.[editingIndex]?.mode})
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-theme-bg border border-amber-500/30 text-amber-300 hover:text-white hover:bg-amber-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Edit</span>
            </button>
          </div>
        )}

        <form ref={formRef} onSubmit={addSchedule} className="space-y-4">
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

            {editingIndex !== null ? (
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-lg transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-1.5 px-4 py-3 bg-theme-bg border border-theme hover:bg-theme-hover text-theme-muted hover:text-theme-text font-medium rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
              </div>
            ) : (
              <button type="submit" disabled={isUpdating} className="flex items-center justify-center gap-2 px-6 py-3 bg-theme-primary hover:bg-theme-primary/90 text-white rounded-lg transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
                {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}{t("schedulerSettings.add")}
              </button>
            )}
          </div>

          {/* Logo Updater Options */}
          {newMode === "logoupdater" && (
            <div className="flex flex-col md:flex-row gap-4 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-purple-300">{getActiveLogoServerName()} Library</label>
                  <button
                    type="button"
                    onClick={() => fetchLogoLibraries(true)}
                    disabled={loadingLogoLibraries}
                    className="flex items-center gap-1 text-[11px] text-purple-400/80 hover:text-purple-300 disabled:opacity-50 transition-colors"
                    title={`Refresh ${getActiveLogoServerName()} Libraries`}
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingLogoLibraries ? "animate-spin" : ""}`} />
                    <span className="text-[10px]">Refresh</span>
                  </button>
                </div>
                <div className="relative">
                  <select
                    value={logoLibrary}
                    onChange={(e) => setLogoLibrary(e.target.value)}
                    disabled={loadingLogoLibraries}
                    className="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-sm text-theme-text focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer appearance-none pr-8"
                  >
                    <option value="all" className="bg-theme-card text-theme-text font-medium">All Included Libraries (all)</option>
                    {logoLibraries.filter(lib => !(typeof lib === "object" && lib.is_excluded)).length > 0 && (
                      <optgroup label="Included Libraries" className="bg-theme-card text-theme-muted font-semibold">
                        {logoLibraries
                          .filter(lib => !(typeof lib === "object" && lib.is_excluded))
                          .map((lib) => {
                            const name = typeof lib === "string" ? lib : lib.name;
                            const type = typeof lib === "object" && lib.type ? ` (${lib.type === 'movie' || lib.type === 'movies' ? 'Movies' : lib.type === 'show' || lib.type === 'tvshows' ? 'TV Shows' : lib.type})` : "";
                            return (
                              <option key={name} value={name} className="bg-theme-card text-theme-text font-normal">
                                {name}{type}
                              </option>
                            );
                          })}
                      </optgroup>
                    )}
                    {logoLibraries.filter(lib => typeof lib === "object" && lib.is_excluded).length > 0 && (
                      <optgroup label="Excluded in Config" className="bg-theme-card text-theme-muted font-semibold">
                        {logoLibraries
                          .filter(lib => typeof lib === "object" && lib.is_excluded)
                          .map((lib) => {
                            const name = typeof lib === "string" ? lib : lib.name;
                            const type = typeof lib === "object" && lib.type ? ` (${lib.type === 'movie' || lib.type === 'movies' ? 'Movies' : lib.type === 'show' || lib.type === 'tvshows' ? 'TV Shows' : lib.type})` : "";
                            return (
                              <option key={name} value={name} className="bg-theme-card text-theme-muted italic font-normal">
                                {name}{type} (Excluded)
                              </option>
                            );
                          })}
                      </optgroup>
                    )}
                    {logoLibrary && logoLibrary !== "all" && !logoLibraries.some(lib => (typeof lib === "string" ? lib : lib.name) === logoLibrary) && (
                      <option value={logoLibrary} className="bg-theme-card text-theme-text font-normal">
                        {logoLibrary} (Configured)
                      </option>
                    )}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-muted">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[10px] text-theme-muted mt-1">'all' targets all included libraries (skips libraries in LibstoExclude).</p>
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
                    checked={logoExifCheck}
                    onChange={(e) => setLogoExifCheck(e.target.checked)}
                    disabled={logoRevert}
                    className="w-4 h-4 rounded border-theme bg-theme-bg text-purple-500 focus:ring-purple-500"
                  />
                  <span className={`text-sm ${logoRevert ? 'text-theme-muted' : 'text-theme-text group-hover:text-purple-300'} transition-colors`}>EXIF Check</span>
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

          {/* Plex Sync Options */}
          {newMode === "plexsync" && (
            <div className="flex flex-col gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-amber-400">Plex Push & Sync Options</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlexSyncAssetTypes(["collection", "poster", "season", "titlecard", "background"])}
                    className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlexSyncAssetTypes(["collection"])}
                    className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                  >
                    Collections Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlexSyncAssetTypes([])}
                    className="text-xs px-2 py-1 rounded bg-theme-bg border border-theme text-theme-muted hover:text-theme-text transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-amber-300">Target Plex Library</label>
                    <button
                      type="button"
                      onClick={() => fetchPlexLibraries(true)}
                      disabled={loadingPlexLibraries}
                      className="flex items-center gap-1 text-[11px] text-amber-400/80 hover:text-amber-300 disabled:opacity-50 transition-colors"
                      title="Refresh Plex Libraries"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingPlexLibraries ? "animate-spin" : ""}`} />
                      <span className="text-[10px]">Refresh</span>
                    </button>
                  </div>
                  <div className="relative">
                    <select
                      value={plexSyncLibrary}
                      onChange={(e) => setPlexSyncLibrary(e.target.value)}
                      disabled={loadingPlexLibraries}
                      className="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-sm text-theme-text focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer appearance-none pr-8"
                    >
                      <option value="all" className="bg-theme-card text-theme-text font-medium">All Included Libraries (all)</option>
                      {plexLibraries.filter(lib => !(typeof lib === "object" && lib.is_excluded)).length > 0 && (
                        <optgroup label="Included Libraries" className="bg-theme-card text-theme-muted font-semibold">
                          {plexLibraries
                            .filter(lib => !(typeof lib === "object" && lib.is_excluded))
                            .map((lib) => {
                              const name = typeof lib === "string" ? lib : lib.name;
                              const type = typeof lib === "object" && lib.type ? ` (${lib.type === 'movie' ? 'Movies' : lib.type === 'show' ? 'TV Shows' : lib.type})` : "";
                              return (
                                <option key={name} value={name} className="bg-theme-card text-theme-text font-normal">
                                  {name}{type}
                                </option>
                              );
                            })}
                        </optgroup>
                      )}
                      {plexLibraries.filter(lib => typeof lib === "object" && lib.is_excluded).length > 0 && (
                        <optgroup label="Excluded in Config" className="bg-theme-card text-theme-muted font-semibold">
                          {plexLibraries
                            .filter(lib => typeof lib === "object" && lib.is_excluded)
                            .map((lib) => {
                              const name = typeof lib === "string" ? lib : lib.name;
                              const type = typeof lib === "object" && lib.type ? ` (${lib.type === 'movie' ? 'Movies' : lib.type === 'show' ? 'TV Shows' : lib.type})` : "";
                              return (
                                <option key={name} value={name} className="bg-theme-card text-theme-muted italic font-normal">
                                  {name}{type} (Excluded)
                                </option>
                              );
                            })}
                        </optgroup>
                      )}
                      {plexSyncLibrary && plexSyncLibrary !== "all" && !plexLibraries.some(lib => (typeof lib === "string" ? lib : lib.name) === plexSyncLibrary) && (
                        <option value={plexSyncLibrary} className="bg-theme-card text-theme-text font-normal">
                          {plexSyncLibrary} (Configured)
                        </option>
                      )}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-theme-muted">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[10px] text-theme-muted mt-1">'all' syncs all included libraries (skips libraries in LibstoExclude).</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-amber-300 mb-2">Asset Types to Sync</label>
                  <div className="flex flex-wrap gap-4">
                    {[
                      { id: "collection", label: "Collections / BoxSets" },
                      { id: "poster", label: "Movie / Show Posters" },
                      { id: "season", label: "Seasons" },
                      { id: "titlecard", label: "Episode Titlecards" },
                      { id: "background", label: "Backgrounds / Art" },
                    ].map((type) => {
                      const isChecked = plexSyncAssetTypes.includes(type.id);
                      return (
                        <label key={type.id} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPlexSyncAssetTypes([...plexSyncAssetTypes, type.id]);
                              } else {
                                setPlexSyncAssetTypes(plexSyncAssetTypes.filter((t) => t !== type.id));
                              }
                            }}
                            className="w-4 h-4 rounded border-theme bg-theme-bg text-amber-500 focus:ring-amber-500"
                          />
                          <span className={`text-sm ${isChecked ? "text-amber-200 font-medium" : "text-theme-muted group-hover:text-theme-text"} transition-colors`}>
                            {type.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
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
              const mConfig = modeConfigs[mode] || modeConfigs.normal || { icon: Clock, color: "text-theme-primary", bgColor: "bg-theme-primary/10", label: mode };
              const Icon = mConfig.icon || Clock;
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

              const isCurrentEditing = editingIndex === index;

              return (
                <div key={index} className={`flex items-center justify-between p-4 bg-theme-bg rounded-lg transition-all border ${isCurrentEditing ? "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/50 shadow-sm" : "hover:bg-theme-hover border-theme hover:border-theme-primary/50"} group`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-lg ${mConfig.bgColor} transition-all`}><Icon className={`w-5 h-5 ${mConfig.color}`} /></div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-theme-text text-lg">{freqVal === "interval" ? <Activity className="w-5 h-5 text-theme-muted" /> : schedule.time}</span>
                        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border ${mConfig.color} ${mConfig.bgColor} border-current opacity-80`}>{mConfig.label}</span>
                        <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border border-theme-muted/30 text-theme-muted">{freqLabel}{detailText ? `, ${detailText}` : ""}</span>
                        {isCurrentEditing && (
                          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-amber-500 text-black animate-pulse">Editing</span>
                        )}
                      </div>
                      {schedule.description && <div className="text-sm text-theme-muted mt-0.5">{schedule.description}</div>}
                      {mode === "logoupdater" && (
                        <div className="flex gap-3 mt-1 text-[10px] text-purple-300/70 font-medium">
                          <span>Library: {schedule.library || "all"}</span>
                          {schedule.force_replace && <span>• Force Replace</span>}
                          {schedule.exif_check && <span>• EXIF Check</span>}
                          {schedule.revert && <span className="text-red-400">•• REVERT MODE</span>}
                        </div>
                      )}
                      {mode === "plexsync" && (
                        <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-amber-400/80 font-medium items-center">
                          <span>Library: {schedule.library || "all"}</span>
                          <span>•</span>
                          <span>Types: {Array.isArray(schedule.asset_types) ? schedule.asset_types.join(", ") : (schedule.asset_types || "all")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEditSchedule(schedule, index)}
                      disabled={isUpdating}
                      className={`p-2 rounded-lg transition-all ${isCurrentEditing ? "text-amber-400 bg-amber-500/20" : "text-theme-muted hover:text-amber-400 hover:bg-amber-500/10"}`}
                      title="Edit schedule"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSchedule(schedule.time, index)}
                      disabled={isUpdating}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      title="Delete schedule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
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