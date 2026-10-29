import React, { useState, useEffect, useRef } from "react";
import {
  FileImage,
  ExternalLink,
  RefreshCw,
  Loader2,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  X,
  Calendar,
  Folder,
  HardDrive,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDashboardLoading } from "../context/DashboardLoadingContext";
import { useToast } from "../context/ToastContext";
import CompactImageSizeSlider from "./CompactImageSizeSlider";
import ImagePreviewModal from "./ImagePreviewModal";
import AssetReplacer from "./AssetReplacer";

const API_URL = "/api";

let cachedAssets = null;

function RecentAssets({ refreshTrigger = 0 }) {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();
  const { startLoading, finishLoading } = useDashboardLoading();
  const hasInitiallyLoaded = useRef(false);
  const requestController = useRef(null);
  const [assets, setAssets] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Asset replacer state
  const [replacerOpen, setReplacerOpen] = useState(false);
  const [assetToReplace, setAssetToReplace] = useState(null);
  const [cacheBuster, setCacheBuster] = useState(Date.now());

  // Tab filter state
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem("recent-assets-tab");
    return ["All", "Posters", "Collections", "Backgrounds", "Seasons", "TitleCards"].includes(saved) ? saved : "All";
  });

  // Pagination offset state
  const [pageOffset, setPageOffset] = useState(() => {
    const saved = localStorage.getItem(`recent-assets-offset-${activeTab}`);
    return Math.max(0, parseInt(saved) || 0);
  });

  // Asset count state
  const [assetCount, setAssetCount] = useState(() => {
    const saved = localStorage.getItem("recent-assets-count");
    const count = parseInt(saved) || 10;
    return Math.min(Math.max(count, 5), 20);
  });

  const query = new URLSearchParams({ limit: assetCount, offset: pageOffset, tab: activeTab }).toString();
  const queryRef = useRef(query);
  queryRef.current = query;

  const fetchRecentAssets = async (silent = false) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const requestedQuery = queryRef.current;
    if (!silent) {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await fetch(`${API_URL}/recent-assets?${requestedQuery}`, { signal: controller.signal });
      if (!response.ok) throw new Error(t("recentAssets.loadError"));
      const data = await response.json();
      if (controller.signal.aborted || requestedQuery !== queryRef.current) return;

      if (data.success) {
        cachedAssets = { query: requestedQuery, data };
        setAssets(data.assets);
        setTotalCount(data.total_count);
        setTabCounts(data.counts || {});
        const requestedParams = new URLSearchParams(requestedQuery);
        if (Number.isInteger(data.offset) && data.offset !== Number(requestedParams.get("offset"))) {
          setPageOffset(data.offset);
          localStorage.setItem(`recent-assets-offset-${requestedParams.get("tab")}`, String(data.offset));
        }
        setError(null);
      } else {
        const errorMsg = data.error || t("recentAssets.loadError");
        setError(errorMsg);
        showError(errorMsg);
      }
    } catch (err) {
      if (controller.signal.aborted || requestedQuery !== queryRef.current) return;
      const errorMsg = err.message || t("recentAssets.loadError");
      setError(errorMsg);
      showError(errorMsg);
      console.error("Error fetching recent assets:", err);
    } finally {
      if (!controller.signal.aborted && requestedQuery === queryRef.current) {
        setLoading(false);
        setRefreshing(false);
        if (!hasInitiallyLoaded.current) {
          hasInitiallyLoaded.current = true;
          finishLoading("recent-assets");
        }
      }
    }
  };

  useEffect(() => {
    startLoading("recent-assets");
    hasInitiallyLoaded.current = false;
    if (cachedAssets?.query === query) {
      setAssets(cachedAssets.data.assets);
      setTotalCount(cachedAssets.data.total_count);
      setTabCounts(cachedAssets.data.counts || {});
      setLoading(false);
      hasInitiallyLoaded.current = true;
      finishLoading("recent-assets");
    } else {
      setAssets([]);
      setLoading(true);
      fetchRecentAssets(true);
    }

    const interval = setInterval(() => {
      fetchRecentAssets(true);
    }, 2 * 60 * 1000);

    return () => {
      clearInterval(interval);
      requestController.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchRecentAssets(true);
    }
  }, [refreshTrigger]);

  useEffect(() => {
    const handleAssetReplaced = () => {
      cachedAssets = null;
      fetchRecentAssets(true);
    };
    window.addEventListener("assetReplaced", handleAssetReplaced);
    return () => {
      window.removeEventListener("assetReplaced", handleAssetReplaced);
    };
  }, []);

  const handleAssetCountChange = (newCount) => {
    const validCount = Math.min(Math.max(newCount, 5), 20);
    setAssetCount(validCount);
    localStorage.setItem("recent-assets-count", validCount.toString());
    setPageOffset(0);
    localStorage.setItem(`recent-assets-offset-${activeTab}`, "0");
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    localStorage.setItem("recent-assets-tab", tab);
    const savedOffset = localStorage.getItem(`recent-assets-offset-${tab}`);
    setPageOffset(Math.max(0, parseInt(savedOffset) || 0));
  };

  const handlePageChange = (direction) => {
    const maxOffset = Math.max(0, (Math.ceil(totalCount / assetCount) - 1) * assetCount);

    let newOffset = pageOffset;
    if (direction === "prev") {
      newOffset = Math.max(0, pageOffset - assetCount);
    } else if (direction === "next") {
      newOffset = Math.min(maxOffset, pageOffset + assetCount);
    }

    setPageOffset(newOffset);
    localStorage.setItem(
      `recent-assets-offset-${activeTab}`,
      newOffset.toString()
    );
  };

  const getTypeColor = (type) => {
    switch (type?.toLowerCase()) {
      case "collection":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "movie":
      case "poster":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "show":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "season":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "episode":
      case "titlecard":
      case "title_card":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "background":
        return "bg-pink-500/10 text-pink-400 border-pink-500/20";
      default:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  const getTypeLabel = (type) => {
    switch (type?.toLowerCase()) {
      case "titlecard":
      case "title_card":
        return "Episode";
      case "collection":
        return "Collection";
      default:
        return type;
    }
  };

  const getMediaTypeLabel = (asset) => {
    const type = asset.type?.toLowerCase() || "";

    switch (type) {
      case "collection":
        return "Collection";
      case "movie":
      case "poster":
        return "Movie";
      case "show":
        return "Show";
      case "season":
        return "Season";
      case "episode":
      case "titlecard":
      case "title_card":
        return "Episode";
      case "background":
        return "Background";
      default:
        return "Asset";
    }
  };

  const isLandscapeAsset = (type) => {
    const typeStr = type?.toLowerCase() || "";
    const landscapeTypes = ["background", "episode", "titlecard", "title_card"];
    const isLandscape =
      landscapeTypes.some((t) => typeStr.includes(t)) ||
      typeStr.includes("background");
    return isLandscape;
  };

  const getLanguageColor = (language) => {
    if (language === "Textless") {
      return "bg-green-500/10 text-green-400 border-green-500/20";
    }
    return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  };

  const displayedAssets = assets;

  const totalPages = Math.ceil(totalCount / assetCount);
  const currentPage = Math.floor(pageOffset / assetCount) + 1;
  const hasPrevPage = pageOffset > 0;
  const hasNextPage = pageOffset + assetCount < totalCount;

  const allTabs = [
    { id: "All", label: "All" },
    { id: "Posters", label: "Posters" },
    { id: "Collections", label: "Collections" },
    { id: "Backgrounds", label: "Backgrounds" },
    { id: "Seasons", label: "Seasons" },
    { id: "TitleCards", label: "TitleCards" },
  ];

  const tabs = allTabs.filter((tab) => tab.id === activeTab || (tabCounts[tab.id] || 0) > 0);

  if (!loading && !error && totalCount === 0 && !tabCounts.All) {
    return null;
  }

  return (
    <div className="bg-theme-card rounded-3xl p-6 border border-theme hover:border-theme-primary/30 transition-all shadow-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-lg font-bold text-theme-text flex items-center gap-3">
          <div className="p-2 rounded-xl bg-theme-primary/10">
            <FileImage className="w-5 h-5 text-theme-primary" />
          </div>
          {t("dashboard.recentAssets")}
        </h2>

        <div className="flex items-center gap-3">
          {/* Enhanced Slider with Badge */}
          <div className="flex flex-col items-center mr-2 relative group">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
                {t("dashboard.assets")}
              </span>
              {/* Dynamic Badge */}
              <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-theme-primary text-white text-[10px] font-black shadow-sm shadow-theme-primary/20">
                {assetCount}
              </span>
            </div>

            <CompactImageSizeSlider
              value={assetCount}
              onChange={handleAssetCountChange}
              storageKey="recent-assets-count"
              min={5}
              max={20}
            />
          </div>

          <button
            onClick={() => fetchRecentAssets()}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-theme-hover border border-theme rounded-lg text-xs font-medium transition-all hover:bg-theme-hover/80"
            title={t("recentAssets.refreshTooltip")}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-theme-primary ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            <span>{t("common.refresh")}</span>
          </button>
        </div>
      </div>

      {/* Modern Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none mask-fade-right">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-full font-medium text-xs transition-all whitespace-nowrap
                ${
                  isActive
                    ? "bg-theme-primary text-white shadow-md shadow-theme-primary/20"
                    : "bg-theme-hover/50 text-theme-muted hover:text-theme-text hover:bg-theme-hover border border-theme/50"
                }
              `}
            >
              <span>{tab.label}</span>
              {isActive && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                  {tabCounts[tab.id] || 0}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading && assets.length === 0 ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-theme-primary" />
        </div>
      ) : error && assets.length === 0 ? (
        <div className="text-center py-8 text-red-400 bg-red-500/5 rounded-xl border border-red-500/10">
          <p className="text-sm font-medium">Error: {error}</p>
          <button
            onClick={() => fetchRecentAssets()}
            className="mt-3 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs transition-colors"
          >
            Retry
          </button>
        </div>
      ) : displayedAssets.length === 0 ? (
        <div className="text-center py-12 text-theme-muted bg-theme-hover/30 rounded-2xl border border-theme border-dashed">
          <FileImage className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("recentAssets.noAssets")}</p>
        </div>
      ) : (
        <>
          {/* Asset Grid */}
          <div className="w-full overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-theme-border scrollbar-track-transparent">
            <div
              className="poster-grid"
              style={{
                "--poster-count": assetCount,
              }}
            >
              {displayedAssets.map((asset, index) => (
                <div
                  key={index}
                  onClick={() => setSelectedAsset(asset)}
                  // REMOVED "h-full" from className to allow bottom alignment to work naturally
                  className="bg-theme-card rounded-xl overflow-hidden border border-theme hover:border-theme-primary/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group flex flex-col cursor-pointer"
                >
                  {/* Poster/Background Image */}
                  <div
                    className={`relative bg-black/40 flex-shrink-0 overflow-hidden ${
                      isLandscapeAsset(asset.type)
                        ? "aspect-[16/9]"
                        : "aspect-[2/3]"
                    }`}
                  >
                    {asset.has_poster ? (
                      <img
                        src={asset.poster_url}
                        alt={asset.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          e.target.parentElement.innerHTML = `
                            <div class="w-full h-full flex items-center justify-center bg-theme-hover">
                              <svg class="w-8 h-8 text-theme-muted opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          `;
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageOff className="w-8 h-8 text-theme-muted opacity-30" />
                      </div>
                    )}

                    {/* Hover Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                    {asset.provider_link && (
                      <a
                        href={asset.provider_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-md hover:bg-theme-primary text-white transition-all opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                        title="View on provider"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>

                  {/* Asset Info */}
                  <div className="p-3 flex-1 flex flex-col justify-between bg-theme-hover/10">
                    <h3
                      className="font-medium text-theme-text text-xs truncate mb-2 group-hover:text-theme-primary transition-colors"
                      title={asset.title}
                    >
                      {asset.title}
                    </h3>

                    <div className="flex flex-wrap gap-1 mt-auto">
                      {asset.type && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${getTypeColor(
                            asset.type
                          )}`}
                        >
                          {getTypeLabel(asset.type)}
                        </span>
                      )}

                      {asset.library && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
                          {asset.library}
                        </span>
                      )}

                      {asset.is_manually_created && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          Manual
                        </span>
                      )}

                      {!asset.is_manually_created &&
                        asset.language &&
                        asset.language !== "N/A" && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${getLanguageColor(
                              asset.language
                            )}`}
                          >
                            {asset.language}
                          </span>
                        )}

                      {asset.fallback && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          FB
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modern Footer */}
          <div className="mt-2 pt-4 border-t border-theme/50 flex items-center justify-between">
            <div className="text-xs text-theme-muted font-medium">
              Showing{" "}
              <span className="text-theme-text">
                {pageOffset + 1}-
                {Math.min(pageOffset + assetCount, totalCount)}
              </span>{" "}
              of{" "}
              <span className="text-theme-text">{totalCount}</span>{" "}
              {activeTab !== "All" && `${activeTab.toLowerCase()} `}
              {totalCount === 1 ? "asset" : "assets"}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange("prev")}
                  disabled={!hasPrevPage}
                  className="p-1.5 rounded-lg hover:bg-theme-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Previous"
                >
                  <ChevronLeft className="w-4 h-4 text-theme-text" />
                </button>

                <span className="text-xs text-theme-muted font-medium px-2">
                  Page <span className="text-theme-text">{currentPage}</span> /{" "}
                  {totalPages}
                </span>

                <button
                  onClick={() => handlePageChange("next")}
                  disabled={!hasNextPage}
                  className="p-1.5 rounded-lg hover:bg-theme-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Next"
                >
                  <ChevronRight className="w-4 h-4 text-theme-text" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Asset Details Modal */}
      {selectedAsset && (
        <ImagePreviewModal
          selectedImage={{
            url: selectedAsset.poster_url,
            name: selectedAsset.path ? selectedAsset.path.split(/[\\/]/).pop() : "poster.jpg",
            title: selectedAsset.title,
            episode_title: selectedAsset.title,
            path: selectedAsset.path || "",
            show_name: selectedAsset.rootfolder,
            type: getMediaTypeLabel(selectedAsset),
            created: selectedAsset.created,
            modified: selectedAsset.modified,
            library: selectedAsset.library,
            language: selectedAsset.language,
            is_manually_created: selectedAsset.is_manually_created,
            fallback: selectedAsset.fallback,
            text_truncated: selectedAsset.text_truncated,
            provider_link: selectedAsset.provider_link
          }}
          onClose={() => setSelectedAsset(null)}
          onReplace={(image) => {
            setAssetToReplace(image);
            setReplacerOpen(true);
          }}
          cacheBuster={cacheBuster}
          formatDisplayPath={(path) => selectedAsset.rootfolder}
          formatTimestamp={() => "Unknown"}
          getTypeColor={getTypeColor}
        />
      )}

      {/* Asset Replacer Modal */}
      {replacerOpen && assetToReplace && (
        <AssetReplacer
          asset={assetToReplace}
          onClose={() => {
            setReplacerOpen(false);
            setAssetToReplace(null);
          }}
          onSuccess={() => {
            setCacheBuster(Date.now());
            fetchRecentAssets(true);
            showSuccess(t("gallery.assetReplaced"));
          }}
        />
      )}

      {/* Grid CSS */}
      <style jsx>{`
        .poster-grid {
          display: flex;
          gap: 1rem;
          align-items: flex-end; /* Changed from stretch to flex-end */
        }

        .poster-grid > div {
          display: flex;
          flex-direction: column;
          flex: 0 0
            calc(
              (100% - (var(--poster-count) - 1) * 1rem) / var(--poster-count)
            );
          min-width: 0;
        }

        /* Responsive Breakpoints */
        @media (max-width: 1024px) {
          .poster-grid > div {
            flex: 0 0 calc((100% - 3rem) / 4);
            min-width: 160px;
          }
        }

        @media (max-width: 640px) {
          .poster-grid > div {
            flex: 0 0 calc((100% - 1rem) / 2);
            min-width: 130px;
          }
        }
      `}</style>
    </div>
  );
}

export default RecentAssets;
