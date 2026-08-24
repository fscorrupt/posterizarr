import React from "react";
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
    // First priority: use the type field from backend (already determined by database lookup)
    if (selectedImage?.type) {
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

              <div>
                <label className="text-sm text-theme-muted">Show/Movie</label>
                <p className="text-theme-text break-all mt-1">
                  {selectedImage.path
                    ? selectedImage.path.split(/[\\/]/).slice(-2, -1)[0] || "Unknown"
                    : (selectedImage.show_name || "Unknown")}
                </p>
              </div>

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