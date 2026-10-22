import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ReleasesSection from "./ReleasesSection";

const API_URL = "/api";
const REPO_URL = "https://github.com/fscorrupt/posterizarr/releases/latest";

function About() {
  const { t } = useTranslation();
  const [version, setVersion] = useState({
    local: null,
    remote: null,
    is_update_available: false,
    loading: true,
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchVersion();
  }, []);

  const fetchVersion = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/version`);
      const data = await response.json();

      setVersion({
        local: data.local,
        remote: data.remote,
        is_update_available: data.is_update_available || false,
        loading: false,
      });
    } catch (error) {
      console.error("Error fetching version:", error);
      setVersion({
        local: null,
        remote: null,
        is_update_available: false,
        loading: false,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const isOutOfDate = () => {
    if (version.is_update_available !== undefined) {
      return version.is_update_available;
    }
    if (!version.local || !version.remote) return false;
    return version.local !== version.remote;
  };

  const VersionDisplay = () => {
    if (version.loading) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-theme-text">{t("common.loading")}</span>
          <Loader2 className="w-4 h-4 text-theme-muted animate-spin" />
        </div>
      );
    }

    const outOfDate = isOutOfDate();

    return (
      <div className="flex items-center gap-2">
        <span className="text-theme-text font-medium">
          {version.local || t("about.unknown")}
        </span>
        {outOfDate && version.remote && (
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <span className="px-3 py-1 bg-orange-500/20 text-orange-400 rounded-full text-xs font-medium border border-orange-500/30 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {t("about.outOfDate")}
            </span>
          </a>
        )}
        {!outOfDate && version.remote && (
          <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium border border-green-500/30 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            {t("about.upToDate")}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="workspace-page space-y-6">
      <WorkspaceHeader icon={Info} title={t("about.title")} />
      {/* Beta Warning Banner */}
      <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
        <p className="text-orange-300 text-sm">
          {t("about.betaWarning")}{" "}
          <a
            href="https://github.com/fscorrupt/posterizarr/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 underline font-medium inline-flex items-center gap-1"
          >
            GitHub
            <ExternalLink className="w-3 h-3" />
          </a>
          !
        </p>
      </div>

      {/* About Posterizarr Section */}
      <div className="workspace-section space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-theme-text flex items-center gap-2">
            <Info className="w-6 h-6 text-theme-primary" />
            {t("about.title")}
          </h2>
          <button
            onClick={fetchVersion}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            <RefreshCw
              className={`w-4 h-4 text-theme-primary ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            <span className="text-sm">{t("common.refresh")}</span>
          </button>
        </div>

        <div className="space-y-4">
          {/* Version */}
          <div className="flex justify-between items-center py-3 border-b border-theme">
            <span className="text-theme-muted font-medium">
              {t("about.version")}
            </span>
            <VersionDisplay />
          </div>

          {/* Latest Available (if out of date) */}
          {isOutOfDate() && version.remote && (
            <div className="flex justify-between items-center py-3 border-b border-theme">
              <span className="text-theme-muted font-medium">
                {t("about.latestAvailable")}
              </span>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 font-medium hover:underline"
              >
                <span>{version.remote}</span>
              </a>
            </div>
          )}

          {/* Data Directory */}
          <div className="flex justify-between items-center py-3 border-b border-theme">
            <span className="text-theme-muted font-medium">
              {t("about.dataDirectory")}
            </span>
            <span className="text-theme-text font-mono text-sm">
              /app/config
            </span>
          </div>

          {/* Time Zone */}
          <div className="flex justify-between items-center py-3">
            <span className="text-theme-muted font-medium">
              {t("about.timeZone")}
            </span>
            <span className="text-theme-text">
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
        </div>
      </div>

      {/* Releases Section */}
      <ReleasesSection />

      {/* Getting Support Section*/}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-4">
        <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
          <ExternalLink className="w-6 h-6 text-theme-primary" />
          {t("about.gettingSupport")}
        </h2>

        <div className="space-y-3">
          <a
            href="https://github.com/fscorrupt/posterizarr/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-theme-hover hover:bg-theme-primary/20 border border-theme rounded-lg transition-all group"
          >
            <div className="flex items-center gap-3">
              <Github className="w-5 h-5 text-theme-primary" />
              <span className="text-theme-text font-medium">
                {t("about.githubIssues")}
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary transition-colors" />
          </a>

          <a
            href="https://discord.gg/fYyJQSGt54"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-theme-hover hover:bg-theme-primary/20 border border-theme rounded-lg transition-all group"
          >
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 text-theme-primary"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              <span className="text-theme-text font-medium">
                {t("about.discordServer")}
              </span>
            </div>
            <ExternalLink className="w-4 h-4 text-theme-muted group-hover:text-theme-primary transition-colors" />
          </a>
        </div>
      </div>

      {/* Support Posterizarr Section*/}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-4">
        <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
          <Heart className="w-6 h-6 text-red-400" />
          {t("about.supportPosterizarr")}
        </h2>

        <a
          href="https://ko-fi.com/R6R81S6SC"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between p-4 bg-theme-hover hover:bg-theme-primary/20 border border-theme-primary/30 rounded-lg transition-all group"
        >
          <div className="flex items-center gap-3">
            <Heart className="w-6 h-6 text-theme-primary" />
            <div>
              <p className="text-theme-text font-medium">
                {t("about.helpPayForCoffee")}
              </p>
              <p className="text-theme-muted text-sm">
                {t("about.supportDevelopment")}
              </p>
            </div>
          </div>
          <div className="px-3 py-1 bg-theme-primary/20 text-theme-primary rounded-full text-xs font-medium">
            {t("about.preferred")}
          </div>
        </a>
      </div>

      {/* WebUI Developer Credit */}
      <div className="bg-theme-card border border-theme rounded-lg p-4">
        <p className="text-theme-muted text-sm text-center flex items-center justify-center gap-2">
          {t("about.webuiDevelopedWith")}
          <Heart className="w-4 h-4 text-red-400 inline" />
          {t("about.by")}
          <a
            href="https://github.com/fscorrupt/posterizarr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-theme-primary hover:underline font-medium"
          >
            cyb3rgh05t & fscorrupt
          </a>
          {t("about.forTheCommunity")}
        </p>
      </div>
    </div>
  );
}

export default About;