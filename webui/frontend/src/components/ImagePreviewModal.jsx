import React, { useState, useEffect } from "react";
import {
  X,
  Calendar,
  HardDrive,
  Trash2,
  RefreshCw,
  ImageIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

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
      console.log(
        `[ImagePreviewModal] No backend type for ${selectedImage.name}, using fallback: ${fallbackType}`
      );
      return fallbackType;
    }

    console.warn(
      `[ImagePreviewModal] No type available for ${selectedImage.name}, using default: Asset`
    );
    return "Asset";
  };

  const [fetchedTitle, setFetchedTitle] = useState(null);
  const [fetchedShowName, setFetchedShowName] = useState(null);

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
    const isBackground = type?.toLowerCase() === "background";

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
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-7xl max-h-[90vh] bg-theme-card rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex flex-col md:flex-row max-h-[90vh]">
          {/* Image */}
          <div className="flex-1 flex items-center justify-center bg-black p-4">
            <img
              src={`${selectedImage.url}?t=${cacheBuster}`}
              alt={selectedImage.name}
              className="max-w-full max-h-[80vh] object-contain"
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
          <div className="md:w-80 p-6 bg-theme-card overflow-y-auto">
            <h3 className="text-xl font-bold text-theme-text mb-4">
              Asset Details
            </h3>

            <div className="space-y-4">
              {/* Media Type */}
              {getTypeColor && (
                <div>
                  <label className="text-sm text-theme-muted">
                    {t("common.mediaType")}
                  </label>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm font-medium ${getTypeColor(
                        displayType
                      )}`}
                    >
                      {displayType}
                    </span>
                  </div>
                </div>
              )}

              {/* Show Name */}
              {fetchedShowName && (
                <div>
                  <label className="text-sm text-theme-muted">Show/Movie</label>
                  <p className="text-theme-text font-medium mt-1">
                    {fetchedShowName}
                  </p>
                </div>
              )}

              {/* Original path-based display as fallback if we couldn't parse the show name */}
              {!fetchedShowName && (
                <div>
                  <label className="text-sm text-theme-muted">Folder Path</label>
                  <p className="text-theme-text text-xs break-all mt-1 opacity-70">
                    {selectedImage.path
                      ? selectedImage.path.split(/[\\/]/).slice(-2, -1)[0] || "Unknown"
                      : (selectedImage.show_name || "Unknown")}
                  </p>
                </div>
              )}

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
              ) : (
                <div>
                  <label className="text-sm text-theme-muted">Title</label>
                  <p className="text-theme-text break-all mt-1">
                    {fetchedTitle || selectedImage.title || "Unknown"}
                  </p>
                </div>
              )}

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