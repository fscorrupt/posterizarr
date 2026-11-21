import React, { useState, useEffect, useCallback } from "react";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  Info,
  ExternalLink,
  Github,
  Heart,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Loader2,
  BookOpen,
  Sparkles,
  Copy,
  Check,
  Server,
  Cpu,
  Clock,
  FolderOpen,
  Terminal,
  Shield,
  Layers,
  Code2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import ReleasesSection from "./ReleasesSection";
import WhatsNewModal from "./WhatsNewModal";

const API_URL = "/api";
const REPO_URL = "https://github.com/fscorrupt/posterizarr/releases/latest";

function normalizeTag(version) {
  if (!version || typeof version !== "string") return "";
  return version.trim().replace(/^v/i, "").toLowerCase();
}

function About() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [version, setVersion] = useState({
    local: null,
    raw_local: null,
    remote: null,
    is_update_available: false,
    loading: true,
  });
  const [systemInfo, setSystemInfo] = useState(null);
  const [releases, setReleases] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [releaseRefreshTrigger, setReleaseRefreshTrigger] = useState(0);
  const [copied, setCopied] = useState(false);
  const [modalRelease, setModalRelease] = useState(null);

  const fetchAboutData = useCallback(async (forceReleaseRefresh = false) => {
    setRefreshing(true);
    try {
      const [verRes, sysRes] = await Promise.all([
        fetch(`${API_URL}/version`).then((r) => r.json()).catch(() => null),
        fetch(`${API_URL}/system-info`).then((r) => r.json()).catch(() => null),
      ]);

      if (verRes) {
        setVersion({
          local: verRes.local || null,
          raw_local: verRes.raw_local || verRes.local || null,
          remote: verRes.remote || null,
          is_update_available: Boolean(verRes.is_update_available),
          loading: false,
        });
      } else {
        setVersion((prev) => ({ ...prev, loading: false }));
      }

      if (sysRes) {
        setSystemInfo(sysRes);
      }

      if (forceReleaseRefresh) {
        setReleaseRefreshTrigger((c) => c + 1);
      }
    } catch (error) {
      console.error("Error fetching about details:", error);
      setVersion((prev) => ({ ...prev, loading: false }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAboutData(false);
  }, [fetchAboutData]);

  const isDevBuild = Boolean(version.local && String(version.local).includes("-dev"));
  const outOfDate = Boolean(
    version.is_update_available !== undefined
      ? version.is_update_available
      : version.local && version.remote && version.local !== version.remote
  );

  const resolvedTimezone =
    systemInfo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const environmentLabel = systemInfo
    ? [
        systemInfo.is_docker ? "Docker" : null,
        systemInfo.os_version && systemInfo.os_version !== "Unknown"
          ? systemInfo.os_version
          : systemInfo.platform,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("common.loading");

  const runtimeParts = [
    systemInfo?.python_version ? `Python ${systemInfo.python_version}` : null,
    systemInfo?.powershell_version ? `PowerShell ${systemInfo.powershell_version}` : null,
    systemInfo?.imagemagick_version || null,
  ].filter(Boolean);

  const hardwareSummary = systemInfo
    ? [
        systemInfo.cpu_cores ? `${systemInfo.cpu_cores} cores` : null,
        systemInfo.used_memory && systemInfo.total_memory
          ? `${systemInfo.used_memory} / ${systemInfo.total_memory} (${systemInfo.memory_percent ?? 0}%)`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("common.loading");

  const preferredReleaseForWhatsNew = (() => {
    if (!releases.length) return null;
    const normLocal = normalizeTag(version.raw_local || version.local);
    if (!isDevBuild && normLocal) {
      const exact = releases.find(
        (r) => !r.is_prerelease && normalizeTag(r.version) === normLocal
      );
      if (exact) return exact;
    }
    return releases.find((r) => !r.is_prerelease) || releases[0];
  })();

  const handleCopySystemInfo = async () => {
    const lines = [
      `Posterizarr Version: ${version.local || t("about.unknown")}`,
      version.remote ? `Latest Release: ${version.remote}` : null,
      `Environment: ${environmentLabel}`,
      systemInfo?.data_directory ? `Data Directory: ${systemInfo.data_directory}` : null,
      resolvedTimezone ? `Time Zone: ${resolvedTimezone}` : null,
      runtimeParts.length ? `Runtime: ${runtimeParts.join(" | ")}` : null,
      systemInfo?.cpu_model && systemInfo.cpu_model !== "Unknown"
        ? `CPU: ${systemInfo.cpu_model} (${systemInfo.cpu_cores || 0} cores)`
        : null,
      systemInfo?.total_memory && systemInfo.total_memory !== "Unknown"
        ? `Memory: ${systemInfo.used_memory} / ${systemInfo.total_memory} (${systemInfo.memory_percent ?? 0}%)`
        : null,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      showSuccess(t("about.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError("Clipboard copy is unavailable in this browser context.");
    }
  };

  return (
    <div className="workspace-page space-y-6">
      <WorkspaceHeader icon={Info} title={t("about.title")} subtitle={t("about.tagline")}>
        {preferredReleaseForWhatsNew && (
          <button
            type="button"
            onClick={() => setModalRelease(preferredReleaseForWhatsNew)}
            className="workspace-command hover:text-theme-primary transition-colors"
          >
            <Sparkles className="w-4 h-4 text-theme-primary" />
            <span>{t("about.whatsNew")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => fetchAboutData(true)}
          disabled={refreshing}
          className="workspace-command hover:text-theme-primary transition-colors"
        >
          <RefreshCw
            className={`w-4 h-4 text-theme-primary ${refreshing ? "animate-spin" : ""}`}
          />
          <span>{t("common.refresh")}</span>
        </button>
      </WorkspaceHeader>

      {/* Hero Identity Card (Kavita + Seerr style) */}
      <section className="bg-theme-card border border-theme rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-black/30 border border-theme p-2.5 flex items-center justify-center shrink-0 shadow-sm">
              <img
                src="/favicon.png"
                alt="Posterizarr"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-bold text-theme-text tracking-tight">
                  Posterizarr
                </h2>

                {version.loading ? (
                  <Loader2 className="w-4 h-4 text-theme-muted animate-spin" />
                ) : (
                  <>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-theme-hover text-theme-text border border-theme">
                      v{version.local || t("about.unknown")}
                    </span>

                    {isDevBuild && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
                        {t("about.devBuild")}
                      </span>
                    )}

                    {!isDevBuild && outOfDate && version.remote && (
                      <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-0.5 bg-orange-500/20 text-orange-400 rounded-full text-xs font-medium border border-orange-500/30 inline-flex items-center gap-1 hover:bg-orange-500/30 transition-colors"
                      >
                        <AlertCircle className="w-3 h-3" />
                        <span>
                          {t("about.outOfDate")} · v{version.remote}
                        </span>
                      </a>
                    )}

                    {!isDevBuild && !outOfDate && version.remote && (
                      <span className="px-2.5 py-0.5 bg-green-500/15 text-green-400 rounded-full text-xs font-medium border border-green-500/30 inline-flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        <span>{t("about.upToDate")}</span>
                      </span>
                    )}
                  </>
                )}

                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-black/25 text-theme-muted border border-theme inline-flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  GPL-3.0
                </span>
              </div>

              <p className="text-sm text-theme-muted">{t("about.description")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {outOfDate && version.remote && (
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-button text-button hover:opacity-90 transition-opacity"
              >
                <ExternalLink className="w-4 h-4" />
                <span>
                  {t("about.latestAvailable")}: v{version.remote}
                </span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* System & Runtime Environment Spec Table */}
      <section className="bg-theme-card border border-theme rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="workspace-header-icon">
              <Server size={18} />
            </span>
            <h2 className="text-lg font-bold text-theme-text">
              {t("about.systemInfo")}
            </h2>
          </div>

          <button
            type="button"
            onClick={handleCopySystemInfo}
            className="workspace-command hover:text-theme-primary transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-theme-primary" />
            )}
            <span>{copied ? t("about.copied") : t("about.copySystemInfo")}</span>
          </button>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div className="flex items-baseline justify-between gap-4 py-3 border-b border-theme">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <Code2 className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.version")}</span>
            </dt>
            <dd className="text-sm font-mono font-semibold text-theme-text text-right break-words">
              {version.loading ? t("common.loading") : `v${version.local || t("about.unknown")}`}
              {outOfDate && version.remote ? ` → v${version.remote}` : ""}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 py-3 border-b border-theme">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <Server className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.environment")}</span>
            </dt>
            <dd className="text-sm font-medium text-theme-text text-right break-words">
              {environmentLabel}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 py-3 border-b border-theme">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <FolderOpen className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.dataDirectory")}</span>
            </dt>
            <dd className="text-sm font-mono text-theme-text text-right break-all">
              {systemInfo?.data_directory || "/config"}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 py-3 border-b border-theme">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <Clock className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.timeZone")}</span>
            </dt>
            <dd className="text-sm font-medium text-theme-text text-right break-words">
              {resolvedTimezone}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 py-3 border-b border-theme md:border-b-0">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <Terminal className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.runtimeStack")}</span>
            </dt>
            <dd className="text-sm text-theme-text text-right break-words">
              {runtimeParts.length ? runtimeParts.join(" · ") : t("about.unknown")}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 py-3 border-b-0">
            <dt className="text-xs font-medium text-theme-muted flex items-center gap-2 shrink-0">
              <Cpu className="w-3.5 h-3.5 text-theme-primary" />
              <span>{t("about.hardware")}</span>
            </dt>
            <dd className="text-sm text-theme-text text-right break-words">
              {hardwareSummary}
            </dd>
          </div>
        </dl>
      </section>

      {/* Changelog & Release History */}
      <ReleasesSection
        installedVersion={version.local}
        refreshTrigger={releaseRefreshTrigger}
        onOpenModal={(release) => setModalRelease(release)}
        onReleasesLoaded={setReleases}
      />

      {/* Resources, Community & Support */}
      <section className="bg-theme-card border border-theme rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="workspace-header-icon">
            <ExternalLink size={18} />
          </span>
          <h2 className="text-lg font-bold text-theme-text">
            {t("about.gettingSupport")}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <a
            href="https://fscorrupt.github.io/posterizarr/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 bg-black/20 hover:bg-theme-hover border border-theme hover:border-theme-primary rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <BookOpen className="w-5 h-5 text-theme-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text">
                  {t("about.docsLink")}
                </div>
                <div className="text-xs text-theme-muted truncate">
                  {t("about.docsDesc")}
                </div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary shrink-0 ml-2" />
          </a>

          <a
            href="https://fscorrupt.github.io/posterizarr/dynamic_overlays/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 bg-black/20 hover:bg-theme-hover border border-theme hover:border-theme-primary rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Layers className="w-5 h-5 text-theme-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text">
                  {t("about.overlaysGuide")}
                </div>
                <div className="text-xs text-theme-muted truncate">
                  {t("about.overlaysGuideDesc")}
                </div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary shrink-0 ml-2" />
          </a>

          <a
            href="https://github.com/fscorrupt/posterizarr/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 bg-black/20 hover:bg-theme-hover border border-theme hover:border-theme-primary rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Github className="w-5 h-5 text-theme-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text">
                  {t("about.githubIssues")}
                </div>
                <div className="text-xs text-theme-muted truncate">
                  {t("about.githubIssuesDesc")}
                </div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary shrink-0 ml-2" />
          </a>

          <a
            href="https://discord.gg/fYyJQSGt54"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 bg-black/20 hover:bg-theme-hover border border-theme hover:border-theme-primary rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <svg
                className="w-5 h-5 text-theme-primary shrink-0"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text">
                  {t("about.discordServer")}
                </div>
                <div className="text-xs text-theme-muted truncate">
                  {t("about.discordDesc")}
                </div>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary shrink-0 ml-2" />
          </a>

          <a
            href="https://ko-fi.com/R6R81S6SC"
            target="_blank"
            rel="noopener noreferrer"
            className="md:col-span-2 flex items-center justify-between p-4 bg-black/20 hover:bg-theme-hover border border-theme hover:border-theme-primary rounded-xl transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Heart className="w-5 h-5 text-red-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text">
                  {t("about.helpPayForCoffee")}
                </div>
                <div className="text-xs text-theme-muted">
                  {t("about.supportDevelopment")}
                </div>
              </div>
            </div>
            <div className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/25 rounded-full text-xs font-medium shrink-0 ml-2">
              {t("about.supportPosterizarr")}
            </div>
          </a>
        </div>
      </section>

      {/* Open Source & Credits Footer */}
      <footer className="bg-theme-card border border-theme rounded-xl p-4 sm:p-5 text-center space-y-1.5">
        <p className="text-theme-text text-sm flex flex-wrap items-center justify-center gap-1.5">
          <span>{t("about.webuiDevelopedWith")}</span>
          <Heart className="w-4 h-4 text-red-400 inline" />
          <span>{t("about.by")}</span>
          <a
            href="https://github.com/fscorrupt/posterizarr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-theme-primary hover:underline font-semibold"
          >
            fscorrupt
          </a>
          <span>{t("about.forTheCommunity")}</span>
        </p>
        <p className="text-xs text-theme-muted">{t("about.openSourceNote")}</p>
      </footer>

      <WhatsNewModal
        isOpen={Boolean(modalRelease)}
        release={modalRelease}
        installedVersion={modalRelease?.version}
        isPreview={true}
        onClose={() => setModalRelease(null)}
      />
    </div>
  );
}

export default About;
