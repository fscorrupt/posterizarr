import React, { useState, useEffect } from "react";
import {
  X,
  Calendar,
  HardDrive,
  Trash2,
  RefreshCw,
  ImageIcon,
  ExternalLink,
  Clock,
  ListOrdered,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Tv,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const PlexIcon = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M11.643 0H4.68l7.679 12-7.679 12h6.963l7.679-12L11.643 0z" />
  </svg>
);

function parseCollectionSummary(summary) {
  if (!summary || typeof summary !== "string") return { type: "empty" };
  const trimmed = summary.trim();
  if (!trimmed) return { type: "empty" };

  // 1. Check for timeline pattern: (Year/Number) [-–—] (Movie Title (ReleaseYear))
  const timelineRegex = /(\d{3,4})\s*[\u2013\u2014-]\s*(.*?)(?=(?:\s+\d{3,4}\s*[\u2013\u2014-])|$)/g;
  const timelineMatches = [];
  let match;
  while ((match = timelineRegex.exec(trimmed)) !== null) {
    const year = match[1];
    const rest = match[2].trim();
    if (rest) {
      const tm = rest.match(/^(.*?)\s*\((\d{4})\)(?:\s*\((.*?)\))?$/);
      if (tm) {
        timelineMatches.push({
          year,
          title: tm[1].trim(),
          releaseYear: tm[2],
          tag: tm[3] ? tm[3].trim() : null
        });
      } else {
        timelineMatches.push({
          year,
          title: rest,
          releaseYear: null,
          tag: null
        });
      }
    }
  }

  if (timelineMatches.length >= 2) {
    return {
      type: "timeline",
      items: timelineMatches,
      raw: trimmed
    };
  }

  // 2. Check for multiline or bullet lists
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const isBulletList = lines.some(l => /^([•\-\*]|\d+[\.\)])\s+/.test(l));
    return {
      type: isBulletList ? "bullets" : "multiline",
      lines: lines.map(l => l.replace(/^([•\-\*]|\d+[\.\)])\s+/, "")),
      raw: trimmed
    };
  }

  // 3. Regular prose paragraph
  return {
    type: "prose",
    text: trimmed,
    raw: trimmed
  };
}

/**
 * Global Image Preview Modal Component
 * Displays a full-screen preview of an image with metadata and action buttons
 *
 * @param {Object} props
 * @param {Object|null} props.selectedImage - The image object to preview (null to hide modal)
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {Function} props.onDelete - Callback when delete button is clicked
 * @param {Function} props.onReplace - Callback when replace button is clicked
 * @param {boolean} props.isDeleting - Whether delete operation is in progress
 * @param {number} props.cacheBuster - Timestamp for cache busting
 * @param {Function} props.formatDisplayPath - Function to format the display path
 * @param {Function} props.formatTimestamp - Function to format the timestamp
 * @param {Function} props.getMediaType - Function to get media type from path/name
 * @param {Function} props.getTypeColor - Function to get color class for media type badge
 */
function ImagePreviewModal({
  selectedImage,
  onClose,
  onDelete,
  onReplace,
  isDeleting = false,
  cacheBuster = Date.now(),
  formatDisplayPath,
  formatTimestamp,
  getMediaType,
  getTypeColor,
}) {
  const { t } = useTranslation();

  // Get the display media type - use type from backend if available, otherwise fallback
  const getDisplayMediaType = () => {
    if (!selectedImage) return "Asset";
    // First priority: use the type field from backend (already determined by database lookup)
    if (selectedImage.type) {
      console.log(
        `[ImagePreviewModal] Using backend type for ${selectedImage.name}: ${selectedImage.type}`
      );
      return selectedImage.type;
    }

    // Fallback to filename-based detection if type not provided
    if (getMediaType) {
      const fallbackType = getMediaType(selectedImage.path || "", selectedImage.name || "");
      if (fallbackType && fallbackType !== "Asset" && fallbackType !== "Movie") {
        return fallbackType;
      }
    }

    // Fallback check for collections in path
    const p = (selectedImage.path || "").toLowerCase();
    if (p.includes("/collections/") || p.includes("\\collections\\")) {
      return "Collection";
    }

    if (getMediaType) {
      return getMediaType(selectedImage.path || "", selectedImage.name || "");
    }

    return "Asset";
  };

  // Helper to get color class for media type badge with Collection support
  const resolveTypeColor = (type) => {
    if (getTypeColor) {
      const col = getTypeColor(type);
      if (col) return col;
    }
    const t = String(type || "").toLowerCase();
    switch (t) {
      case "collection":
        return "bg-amber-500/20 text-amber-400 border-amber-500/50";
      case "movie":
        return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "show":
        return "bg-purple-500/20 text-purple-400 border-purple-500/50";
      case "season":
        return "bg-indigo-500/20 text-indigo-400 border-indigo-500/50";
      case "episode":
      case "titlecard":
      case "title_card":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/50";
      case "background":
        return "bg-rose-500/20 text-rose-400 border-rose-500/50";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  const [fetchedTitle, setFetchedTitle] = useState(null);
  const [fetchedShowName, setFetchedShowName] = useState(null);
  const [summaryViewMode, setSummaryViewMode] = useState("formatted");
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [mediaServerLink, setMediaServerLink] = useState(null);
  const [loadingLink, setLoadingLink] = useState(false);

  useEffect(() => {
    if (!selectedImage) {
      setMediaServerLink(null);
      return;
    }

    setSummaryViewMode("formatted");
    setSummaryExpanded(false);

    if (selectedImage.plexWebUrl || selectedImage.webUrl) {
      setMediaServerLink({
        server_type: selectedImage.serverType || "plex",
        web_url: selectedImage.plexWebUrl || selectedImage.webUrl,
        local_url: selectedImage.plexLocalUrl,
        rating_key: selectedImage.ratingKey,
        machine_identifier: selectedImage.machineIdentifier,
      });
      return;
    }

    let isCancelled = false;
    const resolveLink = async () => {
      try {
        setLoadingLink(true);
        const params = new URLSearchParams();
        if (selectedImage.ratingKey) params.set("rating_key", selectedImage.ratingKey);
        const titleToQuery = selectedImage.collection_name || selectedImage.title || selectedImage.show_name;
        if (titleToQuery && titleToQuery !== "Unknown") params.set("title", titleToQuery);
        if (selectedImage.path) params.set("path", selectedImage.path);
        if (selectedImage.library) params.set("library", selectedImage.library);
        if (selectedImage.type) params.set("item_type", selectedImage.type);
        if (selectedImage.serverType) params.set("server_type", selectedImage.serverType);

        const res = await fetch(`/api/media-server/item-link?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.success && (data.web_url || data.local_url)) {
            setMediaServerLink(data);
          }
        }
      } catch (e) {
        // Silently ignore link resolution errors
      } finally {
        if (!isCancelled) setLoadingLink(false);
      }
    };

    resolveLink();
    return () => { isCancelled = true; };
  }, [selectedImage]);

  useEffect(() => {
    setFetchedTitle(null);
    setFetchedShowName(null);

    if (!selectedImage) return;
    const type = getDisplayMediaType();
    const isTitleCard =
      type?.toLowerCase() === "episode" ||
      type?.toLowerCase() === "titlecard" ||
      type?.toLowerCase() === "title_card";
    const isSeason = type?.toLowerCase() === "season";
    const isCollection = type?.toLowerCase() === "collection";
    if (isCollection) return;

    if (selectedImage.episode_title && isTitleCard) return;

    const fetchTitle = async () => {
      try {
        const pathSegments = selectedImage.path ? selectedImage.path.split(/[\\/]/).filter(Boolean) : [];
        let rootfolder = selectedImage.show_name;

        if (!rootfolder && pathSegments.length > 0) {
          if (isTitleCard || isSeason) {
            let showFolderIndex = -1;
            for (let i = pathSegments.length - 1; i >= 0; i--) {
              if (pathSegments[i].match(/Season\d+/i) || pathSegments[i].match(/S\d+E\d+/i)) {
                showFolderIndex = i - 1;
                break;
              }
            }
            if (showFolderIndex === -1) {
              for (let i = 0; i < pathSegments.length; i++) {
                if (pathSegments[i].match(/\{(tvdb|tmdb)-\d+\}/)) {
                  showFolderIndex = i;
                  break;
                }
              }
            }
            if (showFolderIndex >= 0 && pathSegments[showFolderIndex]) {
              rootfolder = pathSegments[showFolderIndex];
            } else if (pathSegments.length > 1) {
              rootfolder = pathSegments[pathSegments.length - 2];
            }
          } else {
            let showFolderIndex = -1;
            for (let i = pathSegments.length - 1; i >= 0; i--) {
              if (pathSegments[i].match(/\(\d{4}\)/)) {
                showFolderIndex = i;
                break;
              }
            }
            if (showFolderIndex >= 0 && pathSegments[showFolderIndex]) {
              rootfolder = pathSegments[showFolderIndex];
            } else if (pathSegments.length > 1) {
              const isFile = pathSegments[pathSegments.length - 1].match(/\.[^.]+$/);
              rootfolder = isFile ? pathSegments[pathSegments.length - 2] : pathSegments[pathSegments.length - 1];
            }
          }
        }

        if (rootfolder) {
          const findBestMatch = (records, isPlexDb) => {
            const rootFolderRecords = records.filter(r => (r.Rootfolder || r.root_foldername) === rootfolder);
            if (rootFolderRecords.length === 0) return null;

            if (isTitleCard) {
              const pathLower = (selectedImage.path || selectedImage.name || "").toLowerCase();
              const seasonMatch = pathLower.match(/s(\d+)e\d+/i) || pathLower.match(/season\s*(\d+)/i);
              const episodeMatch = pathLower.match(/s\d+e(\d+)/i);
              if (seasonMatch && episodeMatch) {
                const targetSeason = parseInt(seasonMatch[1]);
                const targetEpisode = parseInt(episodeMatch[1]);
                const exact = rootFolderRecords.find(r => {
                  const t = r.Title || r.title || "";
                  const m = t.match(/S(\d+)E(\d+)/i);
                  if (m) return parseInt(m[1]) === targetSeason && parseInt(m[2]) === targetEpisode;

                  // Handle PlexExport format if possible (though it lacks SXXEYY, it might match by other means if we had season_number)
                  if (isPlexDb && r.library_type === "Episode") {
                     if (r.season_number === targetSeason && r.episode_number === targetEpisode) {
                        return true;
                     }
                  }

                  return false;
                });
                if (exact) return exact;
              }
              // Do not fallback to show for an episode!
              return null;
            } else if (isSeason) {
              const exactSeason = rootFolderRecords.find(r => (r.Type || r.library_type)?.toLowerCase().includes("season") && !(r.Type || r.library_type)?.toLowerCase().includes("episode"));
              if (exactSeason) return exactSeason;

              // Do not fallback to show for a season!
              return null;
            } else if (isBackground) {
              return rootFolderRecords.find(r => (r.Type || r.library_type)?.toLowerCase().includes("background")) || rootFolderRecords.find(r => (r.Type || r.library_type)?.toLowerCase().includes("show") || (r.Type || r.library_type)?.toLowerCase().includes("movie")) || rootFolderRecords[0];
            }
            return rootFolderRecords.find(r => (r.Type || r.library_type)?.toLowerCase().includes("show") || (r.Type || r.library_type)?.toLowerCase().includes("movie")) || rootFolderRecords[0];
          };

          let foundMatch = null;

          // Check ImageChoices DB FIRST because it has perfectly formatted Titles like 'S01E01 | Pilot' and actual 'Season' records
          const choicesRes = await fetch("/api/imagechoices");
          if (choicesRes.ok) {
            const choicesData = await choicesRes.json();
            foundMatch = findBestMatch(choicesData, false);
          }

          // Check Plex Export DB if not found in ImageChoices
          if (!foundMatch) {
            const plexRes = await fetch("/api/plex-export/library");
            if (plexRes.ok) {
              const plexData = await plexRes.json();
              if (plexData.success && plexData.data) {
                foundMatch = findBestMatch(plexData.data, true);
              }
            }
          }

          // Check Jellyfin/Emby Export DB if still not found
          if (!foundMatch) {
            const otherRes = await fetch("/api/other-media-export/library");
            if (otherRes.ok) {
              const otherData = await otherRes.json();
              if (otherData.success && otherData.data) {
                foundMatch = findBestMatch(otherData.data, true);
              }
            }
          }

          if (foundMatch) {
            setFetchedShowName(rootfolder);
            setFetchedTitle(foundMatch.Title || foundMatch.title);
          } else {
            setFetchedShowName(rootfolder);
          }
        }
      } catch (error) {
        console.error("Error fetching title for modal:", error);
      }
    };

    fetchTitle();
  }, [selectedImage]);

  if (!selectedImage) return null;

  const displayType = getDisplayMediaType();
  console.log(
    `[ImagePreviewModal] Displaying ${selectedImage.name} with type: ${displayType}`
  );

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 md:p-6 lg:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1550px] max-h-[92vh] bg-theme-card rounded-xl overflow-hidden shadow-2xl border border-theme/60 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-colors border border-white/10"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="w-full flex flex-col md:flex-row max-h-[92vh]">
          {/* Image */}
          <div className="flex-1 flex items-center justify-center bg-black/95 p-4 md:p-8 min-h-[350px] relative overflow-hidden">
            <img
              src={`${selectedImage.url}?t=${cacheBuster}`}
              alt={selectedImage.name}
              className="max-w-full max-h-[84vh] object-contain drop-shadow-2xl rounded"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.nextSibling.style.display = "flex";
              }}
            />
            <div
              className="text-center flex-col items-center justify-center"
              style={{ display: "none" }}
            >
              <div className="p-4 rounded-full bg-theme-primary/20 inline-block mb-4">
                <ImageIcon className="w-16 h-16 text-theme-primary" />
              </div>
              <p className="text-white text-lg font-semibold mb-2">
                {t("gallery.previewNotAvailable")}
              </p>
              <p className="text-gray-400 text-sm">
                {t("gallery.useFileExplorer")}
              </p>
            </div>
          </div>

          {/* Info Panel */}
          <div className="w-full md:w-[460px] lg:w-[500px] xl:w-[560px] shrink-0 p-6 md:p-7 bg-theme-card border-t md:border-t-0 md:border-l border-theme/50 overflow-y-auto max-h-[92vh] custom-scrollbar">
            <h3 className="text-xl font-bold text-theme-text mb-4">
              Asset Details
            </h3>

            <div className="space-y-4">
              {/* Media Type */}
              <div>
                <label className="text-sm text-theme-muted">
                  {t("common.mediaType")}
                </label>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm font-medium ${resolveTypeColor(
                      displayType
                    )}`}
                  >
                    {displayType}
                  </span>
                </div>
              </div>

              {/* Show / Movie / Collection Name */}
              {displayType?.toLowerCase() === "collection" ? (
                <div>
                  <label className="text-sm text-theme-muted">Collection</label>
                  <p className="text-theme-text font-medium mt-1">
                    {selectedImage.title || selectedImage.collection_name || selectedImage.show_name || fetchedShowName || (selectedImage.path ? selectedImage.path.split(/[\\/]/).slice(-2, -1)[0] : "Collection")}
                  </p>
                </div>
              ) : fetchedShowName ? (
                <div>
                  <label className="text-sm text-theme-muted">Show/Movie</label>
                  <p className="text-theme-text font-medium mt-1">
                    {fetchedShowName}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-sm text-theme-muted">Folder Path</label>
                  <p className="text-theme-text text-xs break-all mt-1 opacity-70">
                    {selectedImage.path
                      ? selectedImage.path.split(/[\\/]/).slice(-2, -1)[0] || "Unknown"
                      : (selectedImage.show_name || "Unknown")}
                  </p>
                </div>
              )}

              {/* Sub-Title / Episode / Season / Collection Stats */}
              {(displayType?.toLowerCase() === "episode" || displayType?.toLowerCase() === "titlecard" || displayType?.toLowerCase() === "title_card") ? (
                <div>
                  <label className="text-sm text-theme-muted">Episode Title</label>
                  <p className="text-theme-text break-all mt-1">
                    {selectedImage.episode_title || fetchedTitle || selectedImage.title || "Unknown"}
                  </p>
                </div>
              ) : displayType?.toLowerCase() === "season" ? (
                <div>
                  <label className="text-sm text-theme-muted">Season</label>
                  <p className="text-theme-text break-all mt-1">
                    {(fetchedTitle || selectedImage.title || "Unknown").split("|").pop().trim()}
                  </p>
                </div>
              ) : displayType?.toLowerCase() === "collection" ? (
                <div className="space-y-3">
                  {(selectedImage.itemCount || selectedImage.year) && (
                    <div>
                      <label className="text-sm text-theme-muted">Collection Info</label>
                      <p className="text-theme-text break-all mt-1">
                        {selectedImage.itemCount !== undefined && selectedImage.itemCount !== null ? `${selectedImage.itemCount} ${selectedImage.itemCount === 1 ? 'item' : 'items'}` : ""}
                        {selectedImage.itemCount !== undefined && selectedImage.itemCount !== null && selectedImage.year ? " • " : ""}
                        {selectedImage.year || ""}
                      </p>
                    </div>
                  )}

                  {/* Direct Link to Media Server (Plex / Jellyfin / Emby) */}
                  {mediaServerLink?.web_url && (
                    <div className="pt-0.5">
                      <a
                        href={mediaServerLink.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-medium text-xs transition-all shadow-sm group ${
                          mediaServerLink.server_type === "plex"
                            ? "bg-[#E5A00D]/15 hover:bg-[#E5A00D]/25 text-[#E5A00D] border border-[#E5A00D]/30 hover:border-[#E5A00D]/50"
                            : mediaServerLink.server_type === "jellyfin"
                            ? "bg-[#00A4DC]/15 hover:bg-[#00A4DC]/25 text-[#00A4DC] border border-[#00A4DC]/30 hover:border-[#00A4DC]/50"
                            : "bg-[#52B54B]/15 hover:bg-[#52B54B]/25 text-[#52B54B] border border-[#52B54B]/30 hover:border-[#52B54B]/50"
                        }`}
                        title={
                          mediaServerLink.server_type === "plex"
                            ? "Open collection details directly on Plex Web (app.plex.tv)"
                            : `Open directly in ${mediaServerLink.server_type.toUpperCase()}`
                        }
                      >
                        {mediaServerLink.server_type === "plex" ? (
                          <PlexIcon className="w-3.5 h-3.5 fill-current transition-transform group-hover:scale-110" />
                        ) : (
                          <Tv className="w-3.5 h-3.5 text-current" />
                        )}
                        <span>
                          Open in {mediaServerLink.server_type === "plex" ? "Plex" : mediaServerLink.server_type === "jellyfin" ? "Jellyfin" : "Emby"}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity ml-0.5" />
                      </a>
                      {mediaServerLink.local_url && mediaServerLink.local_url !== mediaServerLink.web_url && (
                        <div className="text-center mt-1">
                          <a
                            href={mediaServerLink.local_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-theme-muted hover:text-theme-text transition-colors hover:underline inline-flex items-center gap-1"
                            title="Open in your local media server instance"
                          >
                            <span>or open in local {mediaServerLink.server_type === "plex" ? "Plex Web" : "Web UI"}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-sm text-theme-muted">Title</label>
                  <p className="text-theme-text break-all mt-1">
                    {fetchedTitle || selectedImage.title || selectedImage.show_name || "Unknown"}
                  </p>
                </div>
              )}

              {/* Formatted Summary / Timeline */}
              {selectedImage.summary && (() => {
                const parsed = parseCollectionSummary(selectedImage.summary);
                const handleCopySummary = () => {
                  navigator.clipboard.writeText(selectedImage.summary);
                  setSummaryCopied(true);
                  setTimeout(() => setSummaryCopied(false), 2000);
                };

                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-theme-muted font-medium flex items-center gap-1.5">
                        {parsed.type === "timeline" ? (
                          <>
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>Timeline ({parsed.items.length} items)</span>
                          </>
                        ) : parsed.type === "bullets" ? (
                          <>
                            <ListOrdered className="w-3.5 h-3.5 text-theme-primary" />
                            <span>List ({parsed.lines.length} items)</span>
                          </>
                        ) : (
                          <span>Summary</span>
                        )}
                      </label>

                      <div className="flex items-center gap-1">
                        {parsed.type !== "prose" && (
                          <button
                            type="button"
                            onClick={() => setSummaryViewMode(m => m === "formatted" ? "raw" : "formatted")}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-theme-bg hover:bg-theme-hover border border-theme text-theme-muted hover:text-theme-text transition-colors"
                            title={summaryViewMode === "formatted" ? "View raw unformatted text" : "View formatted timeline/list"}
                          >
                            {summaryViewMode === "formatted" ? "Raw" : "Formatted"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleCopySummary}
                          className="p-1 rounded hover:bg-theme-hover text-theme-muted hover:text-theme-text transition-colors"
                          title="Copy summary to clipboard"
                        >
                          {summaryCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>

                    {summaryViewMode === "raw" ? (
                      <p className="text-theme-text text-xs leading-relaxed opacity-85 bg-theme-bg/60 p-2.5 rounded-lg border border-theme max-h-52 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] custom-scrollbar">
                        {selectedImage.summary}
                      </p>
                    ) : parsed.type === "timeline" ? (
                      <div className={`bg-theme-bg/60 rounded-lg border border-theme/80 p-2 space-y-1 overflow-y-auto custom-scrollbar transition-all ${summaryExpanded ? 'max-h-96' : 'max-h-52'}`}>
                        <div className="divide-y divide-theme/40">
                          {parsed.items.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2.5 py-1.5 px-1 hover:bg-theme-hover/30 rounded transition-colors"
                            >
                              <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded shrink-0 shadow-sm mt-0.5">
                                {item.year}
                              </span>
                              <div className="text-xs leading-snug flex-1 min-w-0">
                                <span className="font-medium text-theme-text">{item.title}</span>
                                {item.releaseYear && (
                                  <span className="text-theme-muted text-[11px] ml-1.5 font-normal">
                                    ({item.releaseYear})
                                  </span>
                                )}
                                {item.tag && (
                                  <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-medium bg-theme-muted/15 text-theme-muted border border-theme/40 inline-block align-baseline">
                                    {item.tag}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {parsed.items.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setSummaryExpanded(e => !e)}
                            className="w-full text-center py-1 text-[11px] text-theme-muted hover:text-theme-text transition-colors flex items-center justify-center gap-1 border-t border-theme/40 pt-1.5 mt-1"
                          >
                            {summaryExpanded ? (
                              <>
                                <ChevronUp className="w-3 h-3" />
                                <span>Collapse Timeline</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                <span>Show All ({parsed.items.length} items)</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : parsed.type === "bullets" ? (
                      <ul className="bg-theme-bg/60 rounded-lg border border-theme/80 p-2.5 space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar text-xs">
                        {parsed.lines.map((line, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-theme-text/90">
                            <span className="w-1.5 h-1.5 rounded-full bg-theme-primary shrink-0 mt-1.5" />
                            <span className="leading-relaxed">{line}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-theme-text text-xs leading-relaxed opacity-90 bg-theme-bg/60 p-2.5 rounded-lg border border-theme max-h-44 overflow-y-auto whitespace-pre-wrap custom-scrollbar">
                        {selectedImage.summary}
                      </p>
                    )}
                  </div>
                );
              })()}

              <div>
                <label className="text-sm text-theme-muted">
                  {t("common.filename")}
                </label>
                <p className="text-theme-text break-all mt-1">
                  {selectedImage.name}
                </p>
              </div>

              {/* Timestamp */}
              {formatTimestamp && (
                <>
                  <div>
                    <label className="text-sm text-theme-muted flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {t("common.created")}
                    </label>
                    <p className="text-theme-text mt-1 text-sm">
                      {/* --- THIS IS THE FIX --- */}
                      {selectedImage.created
                        ? new Date(selectedImage.created * 1000)
                            .toLocaleString("sv-SE")
                            .replace("T", " ")
                        : (formatTimestamp ? formatTimestamp(selectedImage.path) : "Unknown")}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm text-theme-muted flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {t("common.modified")}
                    </label>
                    <p className="text-theme-text mt-1 text-sm">
                      {selectedImage.modified
                        ? new Date(selectedImage.modified * 1000)
                            .toLocaleString("sv-SE")
                            .replace("T", " ")
                        : (formatTimestamp ? formatTimestamp(selectedImage.path) : "Unknown")}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm text-theme-muted flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {t("common.lastViewed")}
                    </label>
                    <p className="text-theme-text mt-1 text-sm">
                      {new Date().toLocaleString("sv-SE").replace("T", " ")}
                    </p>
                  </div>
                </>
              )}

              {/* Path */}
              {formatDisplayPath && (
                <div>
                  <label className="text-sm text-theme-muted flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5" />
                    {t("common.path")}
                  </label>
                  <p className="text-theme-text text-sm break-all mt-1 font-mono bg-theme-bg p-2 rounded border border-theme">
                    {selectedImage.path && formatDisplayPath ? formatDisplayPath(selectedImage.path) : (selectedImage.path || "N/A")}
                  </p>
                </div>
              )}

              {/* Library */}
              {selectedImage.library && (
                <div>
                  <label className="text-sm text-theme-muted">Library</label>
                  <p className="text-theme-text mt-1">{selectedImage.library}</p>
                </div>
              )}

              {/* Properties */}
              {(selectedImage.is_manually_created || selectedImage.fallback || selectedImage.text_truncated || (selectedImage.language && selectedImage.language !== "N/A")) && (
                <div>
                  <label className="text-sm text-theme-muted">Properties</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedImage.is_manually_created && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        Manual
                      </span>
                    )}
                    {selectedImage.fallback && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-orange-500/10 text-orange-400 border border-orange-500/20">
                        Fallback
                      </span>
                    )}
                    {selectedImage.text_truncated && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                        Truncated
                      </span>
                    )}
                    {selectedImage.language && selectedImage.language !== "N/A" && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-green-500/10 text-green-400 border border-green-500/20">
                        {selectedImage.language}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* File Size */}
              {selectedImage.size && (
                <div>
                  <label className="text-sm text-theme-muted">
                    {t("common.size")}
                  </label>
                  <p className="text-theme-text mt-1">
                    {(selectedImage.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-theme space-y-2">
                {mediaServerLink?.web_url && (
                  <a
                    href={mediaServerLink.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-xs transition-all shadow-sm group ${
                      mediaServerLink.server_type === "plex"
                        ? "bg-[#E5A00D]/20 hover:bg-[#E5A00D]/30 border border-[#E5A00D]/50 text-[#E5A00D]"
                        : mediaServerLink.server_type === "jellyfin"
                        ? "bg-[#00A4DC]/20 hover:bg-[#00A4DC]/30 border border-[#00A4DC]/50 text-[#00A4DC]"
                        : "bg-[#52B54B]/20 hover:bg-[#52B54B]/30 border border-[#52B54B]/50 text-[#52B54B]"
                    }`}
                    title={
                      mediaServerLink.server_type === "plex"
                        ? "Open directly on Plex Web (app.plex.tv)"
                        : `Open directly on ${mediaServerLink.server_type.toUpperCase()}`
                    }
                  >
                    {mediaServerLink.server_type === "plex" ? (
                      <PlexIcon className="w-4 h-4 fill-current transition-transform group-hover:scale-110" />
                    ) : (
                      <Tv className="w-4 h-4 text-current" />
                    )}
                    <span>Open in {mediaServerLink.server_type === "plex" ? "Plex" : mediaServerLink.server_type === "jellyfin" ? "Jellyfin" : "Emby"}</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 transition-opacity ml-0.5" />
                  </a>
                )}

                {selectedImage.provider_link && (
                  <a
                    href={selectedImage.provider_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/50 text-blue-400 rounded-lg transition-all"
                  >
                    View on Provider
                  </a>
                )}

                {onReplace && (
                  <button
                    onClick={() => {
                      onReplace(selectedImage);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 text-white rounded-lg transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t("gallery.replace")}
                  </button>
                )}

                {onDelete && (
                  <button
                    onClick={() => {
                      onDelete(selectedImage);
                    }}
                    disabled={isDeleting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2
                      className={`w-4 h-4 ${isDeleting ? "animate-spin" : ""}`}
                    />
                    {t("gallery.delete")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImagePreviewModal;