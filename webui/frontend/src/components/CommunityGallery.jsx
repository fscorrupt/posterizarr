import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Globe,
  Info,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Save,
  Search,
  Sliders,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const DEFAULT_REPO_URL = "https://github.com/fscorrupt/posterizarr-community";
const DEFAULT_SUBMIT_URL = "https://github.com/fscorrupt/posterizarr-community/blob/main/CONTRIBUTING.md";

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDownloadCount(count) {
  if (count === null || count === undefined || typeof count === "boolean") return null;
  const num = Number(count);
  if (!Number.isFinite(num) || num < 0) return null;
  const floored = Math.floor(num);
  if (floored >= 1_000_000) {
    return `${(floored / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (floored >= 1_000) {
    return `${(floored / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(floored);
}

export default function CommunityGallery({
  kind = "blueprints",
  onSelectBlueprint,
  onSelectOverlayBundle,
  busyEntryId = null,
  compact = false,
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [repoInfo, setRepoInfo] = useState({
    repoUrl: DEFAULT_REPO_URL,
    submitUrl: DEFAULT_SUBMIT_URL,
  });

  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [previewIndexById, setPreviewIndexById] = useState({});
  const [expandedAssetsById, setExpandedAssetsById] = useState({});
  const [lightbox, setLightbox] = useState(null);

  const loadCatalog = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const params = new URLSearchParams({
        kind,
        ...(forceRefresh ? { refresh: "true" } : {}),
      });
      const response = await fetch(`/api/community-gallery?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        const code = data.detail?.code || "catalogUnavailable";
        const err = new Error(data.detail?.message || data.detail || "Failed to load Community Gallery.");
        err.code = code;
        throw err;
      }

      const list = kind === "blueprints" ? data.blueprints || [] : data.dynamic_overlays || [];
      setItems(list);
      setRepoInfo({
        repoUrl: data.repo_url || DEFAULT_REPO_URL,
        submitUrl: data.submit_url || DEFAULT_SUBMIT_URL,
      });
    } catch (err) {
      setErrorCode(err.code || "catalogUnavailable");
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [kind]);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setLightbox(null);
      } else if (event.key === "ArrowLeft") {
        setLightbox((prev) => {
          if (!prev) return null;
          const len = prev.item.preview_urls?.length || 1;
          return { ...prev, index: (prev.index - 1 + len) % len };
        });
      } else if (event.key === "ArrowRight") {
        setLightbox((prev) => {
          if (!prev) return null;
          const len = prev.item.preview_urls?.length || 1;
          return { ...prev, index: (prev.index + 1) % len };
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  const allTags = useMemo(() => {
    const tagSet = new Set();
    items.forEach((item) => {
      (item.tags || []).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [items]);

  const hasDownloadStats = useMemo(
    () => items.some((item) => typeof item.downloads === "number" && Number.isFinite(item.downloads)),
    [items]
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = items.filter((item) => {
      const matchesTag = selectedTag === "all" || (item.tags || []).includes(selectedTag);
      if (!matchesTag) return false;
      if (!query) return true;
      const haystack = [
        item.name,
        item.description,
        item.author,
        item.notes,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    if (sortBy === "downloads" && hasDownloadStats) {
      return [...matched].sort((a, b) => {
        const dlA = typeof a.downloads === "number" ? a.downloads : -1;
        const dlB = typeof b.downloads === "number" ? b.downloads : -1;
        return dlB - dlA;
      });
    }
    return matched;
  }, [items, search, selectedTag, sortBy, hasDownloadStats]);

  const stepPreview = (entryId, total, delta) => {
    setPreviewIndexById((prev) => {
      const current = prev[entryId] || 0;
      const next = (current + delta + total) % total;
      return { ...prev, [entryId]: next };
    });
  };

  return (
    <div className="space-y-4">
      {/* Header / Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-theme-bg/50 border border-theme rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-theme-primary/15 text-theme-primary shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-theme-text">
              {t("communityGallery.title", "Posterizarr Community Gallery")}
            </h3>
            <p className="text-xs text-theme-muted mt-0.5">
              {kind === "blueprints"
                ? t(
                    "communityGallery.subtitleBlueprints",
                    "Browse user-shared visual styles and import them straight into Blueprint Builder or your config."
                  )
                : t(
                    "communityGallery.subtitleOverlays",
                    "Browse sanitized Dynamic Overlay bundles and map them safely to your own libraries in Dry Run."
                  )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadCatalog(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme bg-theme-card hover:bg-theme-hover text-xs font-medium text-theme-text transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-theme-primary ${refreshing ? "animate-spin" : ""}`} />
            <span>{t("common.refresh", "Refresh")}</span>
          </button>
          <a
            href={repoInfo.submitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-primary/30 bg-theme-primary/10 hover:bg-theme-primary/20 text-xs font-semibold text-theme-primary transition-colors"
          >
            <span>{t("communityGallery.submitYours", "Submit yours on GitHub")}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Search, Sort & Tags */}
      {!loading && !error && items.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("communityGallery.searchPlaceholder", "Search presets, authors, or tags...")}
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-theme-bg border border-theme text-xs sm:text-sm text-theme-text placeholder-theme-muted focus:border-theme-primary outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label={t("common.clear", "Clear")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {hasDownloadStats && items.length > 1 && (
              <div className="inline-flex items-center rounded-lg border border-theme bg-theme-bg p-0.5 text-[11px] font-medium shrink-0">
                <button
                  type="button"
                  onClick={() => setSortBy("default")}
                  className={`px-2.5 py-1.5 rounded-md transition-colors ${
                    sortBy === "default"
                      ? "bg-theme-primary text-white"
                      : "text-theme-muted hover:text-theme-text"
                  }`}
                >
                  {t("communityGallery.sortDefault", "Default")}
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("downloads")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md transition-colors ${
                    sortBy === "downloads"
                      ? "bg-theme-primary text-white"
                      : "text-theme-muted hover:text-theme-text"
                  }`}
                >
                  <Download className="w-3 h-3" />
                  <span>{t("communityGallery.sortMostDownloaded", "Most downloaded")}</span>
                </button>
              </div>
            )}
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedTag("all")}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  selectedTag === "all"
                    ? "bg-theme-primary text-white border-theme-primary"
                    : "bg-theme-bg/60 text-theme-muted border-theme hover:text-theme-text"
                }`}
              >
                {t("communityGallery.allTags", "All")} ({items.length})
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === tag ? "all" : tag)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    selectedTag === tag
                      ? "bg-theme-primary text-white border-theme-primary"
                      : "bg-theme-bg/60 text-theme-muted border-theme hover:text-theme-text"
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-theme-bg/30 border border-theme rounded-xl">
          <Loader2 className="w-8 h-8 animate-spin text-theme-primary mb-3" />
          <p className="text-sm text-theme-muted">
            {t("communityGallery.loading", "Loading Community Gallery from GitHub...")}
          </p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-theme-text">
                {errorCode === "catalogNotPublished"
                  ? t("communityGallery.notPublishedTitle", "Community catalog not published yet")
                  : t("communityGallery.unavailableTitle", "Could not load Community Gallery")}
              </h4>
              <p className="text-xs text-theme-muted leading-relaxed">
                {errorCode === "catalogNotPublished"
                  ? t(
                      "communityGallery.notPublishedDesc",
                      "The community repository does not have a published index.json on main yet, or is still private."
                    )
                  : error}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={repoInfo.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg border border-theme bg-theme-card hover:bg-theme-hover text-xs font-medium text-theme-text inline-flex items-center gap-1"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={() => loadCatalog(true)}
              className="px-3 py-1.5 rounded-lg bg-theme-primary text-white text-xs font-semibold hover:bg-theme-primary/90 transition-colors"
            >
              {t("communityGallery.retry", "Retry")}
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="p-8 rounded-xl bg-theme-bg/30 border border-theme text-center space-y-2">
          <Globe className="w-8 h-8 text-theme-muted mx-auto opacity-60" />
          <p className="text-sm font-medium text-theme-text">
            {items.length === 0
              ? t("communityGallery.emptyCatalog", "No entries published in this category yet.")
              : t("communityGallery.noMatches", "No presets match your search or tag filter.")}
          </p>
          {(search || selectedTag !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSelectedTag("all");
              }}
              className="text-xs font-semibold text-theme-primary hover:underline"
            >
              {t("communityGallery.resetFilters", "Reset filters")}
            </button>
          )}
        </div>
      )}

      {/* Gallery Grid */}
      {!loading && !error && filteredItems.length > 0 && (
        <div className={`grid grid-cols-1 ${compact ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"} gap-5`}>
          {filteredItems.map((item) => {
            const previews = item.preview_urls || [];
            const currentIdx = Math.min(previewIndexById[item.id] || 0, Math.max(0, previews.length - 1));
            const activePreview = previews[currentIdx];
            const isBusy = busyEntryId === item.id;
            const formattedSize = formatBytes(item.bundle_size_bytes || item.file_size_bytes);
            const formattedDownloads = formatDownloadCount(item.downloads);

            return (
              <article
                key={item.id}
                className="bg-theme-bg/60 border border-theme hover:border-theme-primary/50 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-lg transition-all"
              >
                {/* Preview Area */}
                <div className={`relative bg-black/40 border-b border-theme ${compact ? "h-40" : "h-52"} flex items-center justify-center overflow-hidden group`}>
                  {activePreview ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({ item, index: currentIdx })}
                      className="w-full h-full flex items-center justify-center cursor-zoom-in focus:outline-none"
                      title={t("communityGallery.zoomPreview", "Click to enlarge preview")}
                    >
                      <img
                        src={activePreview}
                        alt={`${item.name} preview ${currentIdx + 1}`}
                        loading="lazy"
                        className="w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                      <span className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  ) : (
                    <div className="text-xs text-theme-muted flex items-center gap-1.5">
                      {kind === "blueprints" ? <Layers className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                      <span>{t("communityGallery.noPreview", "No preview image")}</span>
                    </div>
                  )}

                  {previews.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => stepPreview(item.id, previews.length, -1)}
                        aria-label={t("communityGallery.previousPreview", "Previous preview")}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/15 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => stepPreview(item.id, previews.length, 1)}
                        aria-label={t("communityGallery.nextPreview", "Next preview")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/15 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60">
                        {previews.map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPreviewIndexById((prev) => ({ ...prev, [item.id]: idx }))}
                            aria-label={`Preview ${idx + 1}`}
                            className={`h-1.5 rounded-full transition-all ${
                              idx === currentIdx ? "w-4 bg-theme-primary" : "w-1.5 bg-white/40 hover:bg-white/70"
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Details */}
                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm sm:text-base font-bold text-theme-text leading-snug">
                        {item.name}
                      </h4>
                      {item.min_posterizarr_version && (
                        <span className="px-2 py-0.5 rounded bg-theme-card border border-theme text-[10px] font-mono text-theme-muted shrink-0">
                          v{item.min_posterizarr_version}+
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-theme-muted">
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3 h-3 text-theme-primary" />
                        {item.author_url ? (
                          <a
                            href={item.author_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-theme-primary hover:underline font-medium"
                          >
                            {item.author}
                          </a>
                        ) : (
                          <span className="font-medium">{item.author}</span>
                        )}
                      </span>
                      {item.repo_url && (
                        <a
                          href={item.repo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-theme-primary"
                        >
                          <span>GitHub</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {formattedSize && <span className="font-mono text-[11px]">{formattedSize}</span>}
                      {formattedDownloads !== null && (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-theme-text/85"
                          title={t("communityGallery.downloadsCount", {
                            count: item.downloads,
                            defaultValue: "{{count}} downloads",
                          })}
                        >
                          <Download className="w-3 h-3 text-theme-primary" />
                          <span>{formattedDownloads}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-theme-muted leading-relaxed flex-1">{item.description}</p>

                  {/* Capability / Metadata Pills */}
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {kind === "blueprints" && (
                      <>
                        {item.settings_count > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-card border border-theme text-theme-text font-medium">
                            {t("communityGallery.settingsCount", { count: item.settings_count, defaultValue: "{{count}} settings" })}
                          </span>
                        )}
                        {item.asset_count > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium">
                            {t("communityGallery.bundledAssetsCount", { count: item.asset_count, defaultValue: "{{count}} bundled files" })}
                          </span>
                        )}
                        {item.uses_logo && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-primary/10 border border-theme-primary/25 text-theme-primary font-medium">
                            Logo
                          </span>
                        )}
                        {item.uses_borders && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-card border border-theme text-theme-muted">
                            Borders
                          </span>
                        )}
                        {item.uses_text && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-card border border-theme text-theme-muted">
                            Text
                          </span>
                        )}
                      </>
                    )}

                    {kind === "dynamic-overlays" && (
                      <>
                        {Array.isArray(item.libraries) && item.libraries.length > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-card border border-theme text-theme-text font-medium">
                            {t("communityGallery.profilesCount", { count: item.libraries.length, defaultValue: "{{count}} library profiles" })}
                          </span>
                        )}
                        {item.features?.animetafill && (
                          <span className="px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-300 font-medium">
                            AniMetaFill
                          </span>
                        )}
                        {Array.isArray(item.features?.rating_sources) && item.features.rating_sources.length > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-theme-card border border-theme text-theme-muted">
                            {item.features.rating_sources.join(", ")}
                          </span>
                        )}
                      </>
                    )}

                    {(item.tags || []).slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-md bg-theme-hover/50 text-theme-muted"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  {Array.isArray(item.assets) && item.assets.length > 0 && (() => {
                    const isExpanded = Boolean(expandedAssetsById[item.id]);
                    const visibleAssets = isExpanded ? item.assets : item.assets.slice(0, 6);
                    const hiddenCount = item.assets.length - visibleAssets.length;
                    return (
                      <div className="p-2.5 rounded-lg bg-theme-card/60 border border-theme/60 space-y-1.5 text-[11px]">
                        <div className="flex items-center gap-1.5 text-theme-muted font-medium">
                          <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>
                            {t("communityGallery.includedFiles", "Included files")} ({item.assets.length})
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {visibleAssets.map((filename) => (
                            <span
                              key={filename}
                              className="px-1.5 py-0.5 rounded bg-theme-bg border border-theme/70 font-mono text-[10px] text-theme-text break-all"
                            >
                              {filename}
                            </span>
                          ))}
                          {item.assets.length > 6 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAssetsById((prev) => ({ ...prev, [item.id]: !isExpanded }))
                              }
                              className="px-1.5 py-0.5 rounded bg-theme-primary/10 border border-theme-primary/25 text-[10px] font-medium text-theme-primary hover:bg-theme-primary/20 transition-colors"
                            >
                              {isExpanded
                                ? t("communityGallery.showLessFiles", "Show less")
                                : t("communityGallery.showMoreFiles", {
                                    count: hiddenCount,
                                    defaultValue: "+{{count}} more",
                                  })}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {item.notes && (
                    <div className="p-2.5 rounded-lg bg-theme-card/80 border border-theme/60 flex items-start gap-2 text-[11px] text-theme-muted">
                      <Info className="w-3.5 h-3.5 text-theme-primary shrink-0 mt-0.5" />
                      <span>{item.notes}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-theme/60 flex flex-wrap gap-2">
                    {kind === "blueprints" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectBlueprint?.(item, "builder")}
                          disabled={Boolean(busyEntryId)}
                          className="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-theme bg-theme-card hover:bg-theme-hover text-xs font-medium text-theme-text transition-colors disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sliders className="w-3.5 h-3.5" />}
                          <span>{t("blueprints.loadInBuilder", "Load in Builder")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectBlueprint?.(item, "save")}
                          disabled={Boolean(busyEntryId)}
                          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-theme bg-theme-card hover:bg-theme-hover text-xs font-medium text-theme-text transition-colors disabled:opacity-50"
                          title={t("communityGallery.saveAsPreset", "Save as Custom Preset")}
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{t("communityGallery.saveShort", "Save")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectBlueprint?.(item, "apply")}
                          disabled={Boolean(busyEntryId)}
                          className="flex-1 min-w-[95px] inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-theme-primary/15 hover:bg-theme-primary/25 border border-theme-primary/30 text-xs font-semibold text-theme-primary transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t("communityGallery.applyAction", "Apply")}</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectOverlayBundle?.(item)}
                        disabled={Boolean(busyEntryId)}
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-theme-primary hover:bg-theme-primary/90 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span>
                          {isBusy
                            ? t("communityGallery.downloading", "Fetching bundle...")
                            : t("communityGallery.previewAndImport", "Preview & Import Bundle")}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-[10001] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-white">
              <div className="min-w-0">
                <h4 className="font-semibold text-sm sm:text-base truncate">{lightbox.item.name}</h4>
                <p className="text-xs text-white/70">
                  {lightbox.item.author} · {lightbox.index + 1} / {lightbox.item.preview_urls.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label={t("common.close", "Close")}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative flex items-center justify-center w-full max-h-[78vh]">
              <img
                src={lightbox.item.preview_urls[lightbox.index]}
                alt={`${lightbox.item.name} enlarged preview`}
                className="max-h-[78vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
              {lightbox.item.preview_urls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((prev) => ({
                        ...prev,
                        index: (prev.index - 1 + prev.item.preview_urls.length) % prev.item.preview_urls.length,
                      }))
                    }
                    className="absolute left-2 p-2 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/20"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((prev) => ({
                        ...prev,
                        index: (prev.index + 1) % prev.item.preview_urls.length,
                      }))
                    }
                    className="absolute right-2 p-2 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/20"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
