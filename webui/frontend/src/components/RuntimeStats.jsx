import React, { useState, useEffect, useRef } from "react";
import {
  Clock,
  RefreshCw,
  Loader2,
  Image,
  AlertTriangle,
  Film,
  Tv,
  Globe,
  ImageOff,
  Type,
  Scissors,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDashboardLoading } from "../context/DashboardLoadingContext";

const API_URL = "/api";

let cachedRuntimeStats = null;

function RuntimeStats({ refreshTrigger = 0, onHasDataChange }) {
  const { t } = useTranslation();
  const { startLoading, finishLoading } = useDashboardLoading();
  const hasInitiallyLoaded = useRef(false);
  const [runtimeStats, setRuntimeStats] = useState(
    cachedRuntimeStats || {
      runtime: null,
      total_images: 0,
      posters: 0,
      seasons: 0,
      backgrounds: 0,
      titlecards: 0,
      collections: 0,
      errors: 0,
      tba_skipped: 0,
      jap_chines_skipped: 0,
      notification_sent: false,
      uptime_kuma: null,
      images_cleared: 0,
      folders_cleared: 0,
      space_saved: null,
      script_version: null,
      im_version: null,
      start_time: null,
      end_time: null,
      mode: null,
      timestamp: null,
      source: null,
      fallbacks: 0,
      textless: 0,
      truncated: 0,
      text: 0,
    }
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState(null);

  const fetchMigrationStatus = async () => {
    try {
      const response = await fetch(
        `${API_URL}/runtime-history/migration-status`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMigrationStatus(data);
        }
      }
    } catch (error) {
      console.debug("Could not fetch migration status:", error);
    }
  };

  const fetchRuntimeStats = async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_URL}/runtime-stats`);
      if (!response.ok) {
        console.error("Failed to fetch runtime stats:", response.status);
        if (!hasInitiallyLoaded.current) {
          hasInitiallyLoaded.current = true;
          finishLoading("runtime-stats");
        }
        return;
      }
      const data = await response.json();
      onHasDataChange?.(data.runtime !== null);

      if (!hasInitiallyLoaded.current) {
        hasInitiallyLoaded.current = true;
        finishLoading("runtime-stats");
      }

      if (data.success) {
        cachedRuntimeStats = data;
        setRuntimeStats(data);
      } else {
        cachedRuntimeStats = data;
        setRuntimeStats(data);
      }
    } catch (error) {
      console.error("Error fetching runtime stats:", error);
      if (!hasInitiallyLoaded.current) {
        hasInitiallyLoaded.current = true;
        finishLoading("runtime-stats");
      }
    } finally {
      setLoading(false);
      if (!silent) {
        setTimeout(() => {
          setRefreshing(false);
        }, 500);
      }
    }
  };

  useEffect(() => {
    startLoading("runtime-stats");

    if (cachedRuntimeStats) {
      setRuntimeStats(cachedRuntimeStats);
      onHasDataChange?.(cachedRuntimeStats.runtime !== null);
      setLoading(false);
      if (!hasInitiallyLoaded.current) {
        hasInitiallyLoaded.current = true;
        finishLoading("runtime-stats");
      }
    } else {
      fetchRuntimeStats(true);
    }

    fetchMigrationStatus();

    const interval = setInterval(() => {
      fetchRuntimeStats(true);
    }, 30 * 1000);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchRuntimeStats(true);
    }
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="bg-theme-card rounded-xl p-6 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-theme-primary" />
        </div>
      </div>
    );
  }

  const hasData = runtimeStats.runtime !== null;

  if (!hasData) {
    return null;
  }

  return (
    <div className="bg-theme-card rounded-xl p-5 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
      {/* Header with Refresh Button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-theme-text flex items-center gap-3">
          <div className="p-2 rounded-lg bg-theme-primary/10">
            <Clock className="w-5 h-5 text-theme-primary" />
          </div>
          {t("dashboard.runtimeStats")}
        </h2>
        <button
          onClick={() => fetchRuntimeStats()}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
          title={t("runtimeStats.refreshTooltip")}
        >
          <RefreshCw
            className={`w-4 h-4 text-theme-primary ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          <span className="text-xs font-medium">{t("common.refresh")}</span>
        </button>
      </div>

      {/* Run Info - Mode and Start Time */}
      {(runtimeStats.mode || runtimeStats.start_time) && (
        <div className="mb-4 p-2 bg-theme-hover rounded-lg border border-theme">
          <div className="flex items-center justify-between text-xs sm:text-sm">
            {runtimeStats.mode && (
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">{t("dashboard.mode")}:</span>
                <span className="font-medium text-theme-primary capitalize">
                  {runtimeStats.mode}
                </span>
              </div>
            )}
            {runtimeStats.start_time && (
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">
                  {t("dashboard.lastRun")}:
                </span>
                <span className="font-medium text-theme-text">
                  {new Date(runtimeStats.start_time).toLocaleString("sv-SE").replace("T", " ")}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Runtime Card - Compacted */}
      <div className="bg-theme-card rounded-xl p-4 border border-theme hover:border-theme-primary/50 transition-all shadow-sm mb-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-theme-muted text-xs mb-1 font-medium">
              {t("runtimeStats.executionTime")}
            </p>
            <p className="text-2xl font-bold text-theme-primary">
              {runtimeStats.runtime}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-theme-primary/10">
            <Clock className="w-10 h-10 text-purple-400" />
          </div>
        </div>
      </div>

      {/* Stats Grid - High Density: up to 6 columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {/* Total Images */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.totalImages")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.total_images}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-blue-500/10 shrink-0 ml-2">
              <Image className="w-6 h-6 text-blue-400" />
            </div>
          </div>
        </div>

        {/* Posters */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("assets.posters")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.posters}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-green-500/10 shrink-0 ml-2">
              <Film className="w-6 h-6 text-green-400" />
            </div>
          </div>
        </div>

        {/* Seasons */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("assets.seasons")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.seasons}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-orange-500/10 shrink-0 ml-2">
              <Tv className="w-6 h-6 text-orange-400" />
            </div>
          </div>
        </div>

        {/* Backgrounds */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("assets.backgrounds")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.backgrounds}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-purple-500/10 shrink-0 ml-2">
              <Image className="w-6 h-6 text-purple-400" />
            </div>
          </div>
        </div>

        {/* TitleCards */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("assets.titleCards")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.titlecards}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-cyan-500/10 shrink-0 ml-2">
              <Tv className="w-6 h-6 text-cyan-400" />
            </div>
          </div>
        </div>

        {/* Collections */}
        {runtimeStats.collections > 0 && (
          <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                  {t("assets.collections")}
                </p>
                <p className="text-xl font-bold text-theme-text">
                  {runtimeStats.collections}
                </p>
              </div>
              <div className="p-1.5 rounded-lg bg-yellow-500/10 shrink-0 ml-2">
                <Film className="w-6 h-6 text-yellow-400" />
              </div>
            </div>
          </div>
        )}

        {/* Fallbacks */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.fallbacks")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.fallbacks}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0 ml-2">
              <ImageOff className="w-6 h-6 text-amber-400" />
            </div>
          </div>
        </div>

        {/* Textless */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.textless")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.textless}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 shrink-0 ml-2">
              <Image className="w-6 h-6 text-indigo-400" />
            </div>
          </div>
        </div>

        {/* Truncated */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.truncated")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.truncated}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-pink-500/10 shrink-0 ml-2">
              <Scissors className="w-6 h-6 text-pink-400" />
            </div>
          </div>
        </div>

        {/* Text */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.text")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.text}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-teal-500/10 shrink-0 ml-2">
              <Type className="w-6 h-6 text-teal-400" />
            </div>
          </div>
        </div>

        {/* TBA Skipped */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.tbaSkipped")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.tba_skipped}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-slate-500/10 shrink-0 ml-2">
              <Film className="w-6 h-6 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Jap/Chines Skipped */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                {t("runtimeStats.japChinesSkipped")}
              </p>
              <p className="text-xl font-bold text-theme-text">
                {runtimeStats.jap_chines_skipped}
              </p>
            </div>
            <div className="p-1.5 rounded-lg bg-gray-500/10 shrink-0 ml-2">
              <Globe className="w-6 h-6 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Errors */}
        <div className="bg-theme-card rounded-xl p-3 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 font-semibold truncate">
                Script Errors
              </p>
              <p
                className={`text-xl font-bold ${
                  runtimeStats.errors > 0 ? "text-red-400" : "text-green-400"
                }`}
              >
                {runtimeStats.errors}
              </p>
            </div>
            <div
              className={`p-1.5 rounded-lg shrink-0 ml-2 ${
                runtimeStats.errors > 0 ? "bg-red-500/10" : "bg-green-500/10"
              }`}
            >
              <AlertTriangle
                className={`w-6 h-6 ${
                  runtimeStats.errors > 0 ? "text-red-400" : "text-green-400"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Additional Info Section - Compacted */}
      <div className="mt-4 bg-theme-card rounded-xl p-4 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
        <h3 className="text-sm font-semibold text-theme-text mb-3 uppercase tracking-wider">
          {t("runtimeStats.additionalInfo")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div className="p-2 bg-theme-hover rounded-lg">
            <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 truncate">
              {t("runtimeStats.notificationSent")}
            </p>
            <p
              className={`text-lg font-bold ${
                runtimeStats.notification_sent
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {runtimeStats.notification_sent
                ? t("common.yes").toUpperCase()
                : t("common.no").toUpperCase()}
            </p>
          </div>
          <div className="p-2 bg-theme-hover rounded-lg">
            <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 truncate">Uptime Kuma</p>
            <p
              className={`text-lg font-bold ${
                runtimeStats.uptime_kuma ? "text-green-400" : "text-red-400"
              }`}
            >
              {runtimeStats.uptime_kuma
                ? t("common.yes").toUpperCase()
                : t("common.no").toUpperCase()}
            </p>
          </div>
          <div className="p-2 bg-theme-hover rounded-lg">
            <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 truncate">
              {t("runtimeStats.imagesCleared")}
            </p>
            <p className="text-lg font-bold text-theme-text">
              {runtimeStats.images_cleared}
            </p>
          </div>
          <div className="p-2 bg-theme-hover rounded-lg">
            <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 truncate">
              {t("runtimeStats.foldersCleared")}
            </p>
            <p className="text-lg font-bold text-theme-text">
              {runtimeStats.folders_cleared}
            </p>
          </div>
          <div className="p-2 bg-theme-hover rounded-lg">
            <p className="text-theme-muted text-[10px] uppercase tracking-wider mb-0.5 truncate">
              {t("runtimeStats.spaceSaved")}
            </p>
            <p className="text-lg font-bold text-green-400">
              {runtimeStats.space_saved || "0"}
            </p>
          </div>
        </div>
      </div>

      {/* Version Information - Compacted */}
      {(runtimeStats.script_version || runtimeStats.im_version) && (
        <div className="mt-4 bg-theme-card rounded-xl p-4 border border-theme hover:border-theme-primary/50 transition-all shadow-sm">
          <h3 className="text-sm font-semibold text-theme-text mb-3 uppercase tracking-wider">
            {t("runtimeStats.versionInfo")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {runtimeStats.script_version && (
              <div className="p-2 bg-theme-hover rounded-lg flex items-center justify-between">
                <p className="text-theme-muted text-[10px] uppercase tracking-wider">
                  {t("runtimeStats.scriptVersion")}
                </p>
                <p className="text-sm font-bold text-theme-primary">
                  {runtimeStats.script_version}
                </p>
              </div>
            )}
            {runtimeStats.im_version && (
              <div className="p-2 bg-theme-hover rounded-lg flex items-center justify-between">
                <p className="text-theme-muted text-[10px] uppercase tracking-wider">
                  {t("runtimeStats.imVersion")}
                </p>
                <p className="text-sm font-bold text-theme-primary">
                  {runtimeStats.im_version}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default RuntimeStats;