import React, { useState, useEffect } from "react";
import {
  Tag,
  Clock,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Calendar,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "./MarkdownRenderer";

const API_URL = "/api";

function normalizeVersionTag(version) {
  if (!version || typeof version !== "string") return "";
  return version.trim().replace(/^v/i, "").toLowerCase();
}

function isStableTag(version) {
  return Boolean(version) && !String(version).includes("-");
}

function formatPublishedDate(publishedAt) {
  if (!publishedAt) return "";
  try {
    const date = new Date(publishedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function ReleasesSection({
  installedVersion = null,
  refreshTrigger = 0,
  onOpenModal = null,
  onReleasesLoaded = null,
}) {
  const { t } = useTranslation();
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchReleases = async () => {
      setLoading(true);
      try {
        const suffix = refreshTrigger > 0 ? "?refresh=true" : "";
        const response = await fetch(`${API_URL}/releases${suffix}`);
        const data = await response.json();

        if (cancelled) return;

        if (data.success) {
          const list = Array.isArray(data.releases) ? data.releases : [];
          setReleases(list);
          setError(null);
          onReleasesLoaded?.(list);
        } else {
          setError(data.error || t("releasesSection.fetchFailed"));
          onReleasesLoaded?.([]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching releases:", err);
        setError(t("releasesSection.fetchError"));
        onReleasesLoaded?.([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchReleases();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  // Expand installed release (or latest release if running dev/unmatched) once releases & version arrive
  useEffect(() => {
    if (!releases.length) return;
    setExpandedVersion((prev) => {
      if (prev && releases.some((r) => r.version === prev)) return prev;
      const installedNorm = isStableTag(installedVersion)
        ? normalizeVersionTag(installedVersion)
        : "";
      const matched = installedNorm
        ? releases.find(
            (r) => !r.is_prerelease && normalizeVersionTag(r.version) === installedNorm
          )
        : null;
      return matched ? matched.version : releases[0].version;
    });
  }, [releases, installedVersion]);

  const formatDaysAgo = (daysAgo) => {
    if (daysAgo === 0) return t("releasesSection.today");
    if (daysAgo === 1) return t("releasesSection.yesterday");
    return t("releasesSection.daysAgo", { days: daysAgo });
  };

  const latestStableVersion = releases.find((r) => !r.is_prerelease)?.version;
  const installedNorm = isStableTag(installedVersion)
    ? normalizeVersionTag(installedVersion)
    : "";
  const visibleReleases = showAll ? releases : releases.slice(0, 5);
  const hiddenCount = Math.max(0, releases.length - visibleReleases.length);

  return (
    <section className="bg-theme-card border border-theme rounded-xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="workspace-header-icon">
            <Tag size={18} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-theme-text">
              {t("releasesSection.changelogTitle")}
            </h2>
          </div>
        </div>
        {!loading && !error && releases.length > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-theme-hover text-theme-muted border border-theme">
            {t("releasesSection.releaseCount", { count: releases.length })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-7 h-7 animate-spin text-theme-primary" />
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {t("releasesSection.error")}: {error}
        </div>
      ) : releases.length === 0 ? (
        <div className="text-center text-theme-muted py-8 text-sm">
          {t("releasesSection.noReleases")}
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleReleases.map((release) => {
            const isExpanded = expandedVersion === release.version;
            const isInstalled =
              Boolean(installedNorm) &&
              !release.is_prerelease &&
              normalizeVersionTag(release.version) === installedNorm;
            const isLatest = latestStableVersion === release.version;
            const publishedDate = formatPublishedDate(release.published_at);
            const cleanVersion = release.version.replace(/^v/i, "");
            const distinctTitle =
              release.name &&
              normalizeVersionTag(release.name) !== normalizeVersionTag(release.version)
                ? release.name
                : null;

            return (
              <div
                key={release.version}
                className={`border rounded-xl overflow-hidden transition-colors ${
                  isInstalled
                    ? "border-sky-500/35 bg-sky-500/[0.04]"
                    : "border-theme bg-black/20"
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedVersion(isExpanded ? null : release.version)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedVersion(isExpanded ? null : release.version);
                    }
                  }}
                  className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 cursor-pointer hover:bg-theme-hover transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    <span className="text-theme-text font-bold text-base font-mono">
                      v{cleanVersion}
                    </span>

                    {distinctTitle && (
                      <span className="text-sm text-theme-muted truncate max-w-xs sm:max-w-sm">
                        {distinctTitle}
                      </span>
                    )}

                    {isInstalled && (
                      <span className="px-2 py-0.5 bg-sky-500/15 text-sky-400 rounded-full text-xs font-semibold border border-sky-500/30">
                        {t("releasesSection.installed")}
                      </span>
                    )}
                    {isLatest && (
                      <span className="px-2 py-0.5 bg-green-500/15 text-green-400 rounded-full text-xs font-medium border border-green-500/30">
                        {t("releasesSection.latest")}
                      </span>
                    )}
                    {release.is_prerelease && (
                      <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-400 rounded-full text-xs font-medium border border-yellow-500/30">
                        {t("releasesSection.preRelease")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="flex items-center gap-3 text-xs text-theme-muted">
                      {publishedDate && (
                        <span className="hidden md:inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {publishedDate}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDaysAgo(release.days_ago)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {onOpenModal && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenModal(release);
                          }}
                          title={t("releasesSection.openInPopup")}
                          aria-label={t("releasesSection.openInPopup")}
                          className="p-1.5 rounded-lg text-theme-muted hover:text-theme-primary hover:bg-theme-hover transition-colors"
                        >
                          <Sparkles className="w-4 h-4" />
                        </button>
                      )}

                      {release.html_url && (
                        <a
                          href={release.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("releasesSection.openOnGithub")}
                          aria-label={t("releasesSection.openOnGithub")}
                          className="p-1.5 rounded-lg text-theme-muted hover:text-theme-primary hover:bg-theme-hover transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}

                      <span
                        className="p-1.5 text-theme-muted"
                        aria-label={
                          isExpanded
                            ? t("releasesSection.collapse")
                            : t("releasesSection.expand")
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 sm:px-5 pb-5 pt-4 border-t border-theme bg-black/25">
                    {release.body ? (
                      <MarkdownRenderer content={release.body} compact={true} />
                    ) : (
                      <p className="text-sm text-theme-muted italic">
                        {t("releasesSection.noChangelog")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {releases.length > 5 && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="workspace-command hover:text-theme-primary transition-colors"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>{t("releasesSection.showLess")}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>{t("releasesSection.showMore", { count: hiddenCount })}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default ReleasesSection;
