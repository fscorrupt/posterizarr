import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clapperboard, Clock, Layers, Loader2 } from "lucide-react";
import WorkspaceHeader from "./WorkspaceHeader";
import EpisodeTitleReview from "./EpisodeTitleReview";
import { useToast } from "../context/ToastContext";

const INTERVAL_OPTIONS = [
  { value: 15, key: "dynamicOverlays.changeDetection.every15Minutes", fallback: "Every 15 minutes" },
  { value: 30, key: "dynamicOverlays.changeDetection.every30Minutes", fallback: "Every 30 minutes" },
  { value: 60, key: "dynamicOverlays.changeDetection.everyHour", fallback: "Every hour" },
  { value: 120, key: "dynamicOverlays.changeDetection.every2Hours", fallback: "Every 2 hours" },
  { value: 240, key: "dynamicOverlays.changeDetection.every4Hours", fallback: "Every 4 hours" },
  { value: 360, key: "dynamicOverlays.changeDetection.every6Hours", fallback: "Every 6 hours" },
  { value: 720, key: "dynamicOverlays.changeDetection.every12Hours", fallback: "Every 12 hours" },
  { value: 1440, key: "dynamicOverlays.changeDetection.every24Hours", fallback: "Every 24 hours" },
];

export default function AssetTitleReviewPage() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [settings, setSettings] = useState({
    enabled: false,
    regenerate_assets_on_title_change: false,
    title_change_interval_minutes: 60,
    title_change_dry_run: false,
    last_title_change_check_at: null,
    last_title_change_summary: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/dynamic-overlays/settings", { signal: controller.signal });
        const data = await res.json();
        if (active && res.ok && data.success && data.settings) {
          setSettings(prev => ({ ...prev, ...data.settings }));
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          showError(t("assetTitleReview.saveFailed", "Could not save title check settings."));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSettings();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const updateSetting = async (patch) => {
    const previous = settings;
    setSettings(prev => ({ ...prev, ...patch }));
    setSaving(true);
    try {
      const res = await fetch("/api/dynamic-overlays/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.settings) {
        throw new Error(data.error || "save_failed");
      }
      setSettings(prev => ({ ...prev, ...data.settings }));
      showSuccess(t("assetTitleReview.saved", "Title check settings saved."));
    } catch {
      setSettings(previous);
      showError(t("assetTitleReview.saveFailed", "Could not save title check settings."));
    } finally {
      setSaving(false);
    }
  };

  const autoRecreate = settings.regenerate_assets_on_title_change === true;
  const dryRun = Boolean(settings.title_change_dry_run);
  const overlaysActive = Boolean(settings.enabled);
  const intervalMinutes = Number(settings.title_change_interval_minutes) || 60;
  const lastCheckAt = settings.last_title_change_check_at;
  const lastSummary = settings.last_title_change_summary;

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        icon={Clapperboard}
        title={t("nav.assetTitleReview", "Asset Title Review")}
        subtitle={t(
          "assetTitleReview.subtitle",
          "Monitor text-enabled posters, season posters, and episode titlecards against Plex, Jellyfin, and Emby — works standalone without Dynamic Overlays."
        )}
      >
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
            overlaysActive
              ? "border-theme-primary/30 bg-theme-primary/10 text-theme-primary"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {overlaysActive ? <Layers className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {overlaysActive
            ? t("assetTitleReview.overlaysActiveBadge", "Dynamic Overlays active — overlays re-sync automatically")
            : t("assetTitleReview.standaloneBadge", "Standalone mode — direct upload to media server")}
        </span>
      </WorkspaceHeader>

      <div className="bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-theme-text flex items-center gap-2">
              {t("assetTitleReview.autoRecreateLabel", "Recreate artwork when titles change")}
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-muted" />}
            </h2>
            <p className="mt-1 text-xs text-theme-muted leading-relaxed">
              {t(
                "assetTitleReview.autoRecreateHint",
                "Automatically checks for newly renamed titles at the configured interval and recreates & uploads text-enabled artwork. Historical ImageChoices review candidates remain manual."
              )}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoRecreate}
            aria-label={t("assetTitleReview.autoRecreateLabel", "Recreate artwork when titles change")}
            disabled={loading || saving}
            onClick={() => updateSetting({ regenerate_assets_on_title_change: !autoRecreate })}
            className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
              autoRecreate ? "bg-theme-primary" : "bg-theme-hover border border-theme"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                autoRecreate ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-theme/70 pt-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-theme-muted">
              <Clock className="h-4 w-4 shrink-0 text-theme-primary" />
              <span>{t("assetTitleReview.intervalLabel", "Check interval")}</span>
              <select
                aria-label={t("assetTitleReview.intervalLabel", "Check interval")}
                value={intervalMinutes}
                disabled={loading || saving}
                onChange={event => updateSetting({ title_change_interval_minutes: Number(event.target.value) })}
                className="rounded-lg border border-theme bg-theme-bg px-2.5 py-1.5 text-xs font-medium text-theme-text"
              >
                {!INTERVAL_OPTIONS.some(opt => opt.value === intervalMinutes) && (
                  <option value={intervalMinutes}>{intervalMinutes} min</option>
                )}
                {INTERVAL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.key, opt.fallback)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-theme-text" title={t("assetTitleReview.dryRunHint", "Detect and log title changes without recreating files or uploading to the media server.")}>
              <input
                type="checkbox"
                checked={dryRun}
                disabled={loading || saving}
                onChange={event => updateSetting({ title_change_dry_run: event.target.checked })}
                className="h-4 w-4 rounded accent-amber-500"
              />
              <span>{t("assetTitleReview.dryRunLabel", "Dry Run")}</span>
              {dryRun && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t("assetTitleReview.dryRunBadge", "DRY RUN")}
                </span>
              )}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-theme-muted">
            <span>
              {t("assetTitleReview.lastCheck", "Last automatic check")}:{" "}
              <strong className="font-medium text-theme-text">
                {lastCheckAt ? new Date(lastCheckAt).toLocaleString() : t("assetTitleReview.neverChecked", "Never")}
              </strong>
            </span>
            {lastSummary && (
              <span className="rounded-lg border border-theme bg-theme-hover/50 px-2.5 py-1 text-[11px] text-theme-text">
                {t("assetTitleReview.summary", "{{detected}} detected · {{regenerated}} recreated", {
                  detected: lastSummary.detected ?? 0,
                  regenerated: lastSummary.regenerated ?? 0,
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-theme-card border border-theme rounded-2xl p-5 sm:p-6 shadow-sm">
        <EpisodeTitleReview enabled={true} dryRun={dryRun} standalone />
      </div>
    </div>
  );
}
