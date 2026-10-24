import React, { useState, useEffect } from "react";
import {
  Upload,
  Trash2,
  Eye,
  X,
  AlertCircle,
  CheckCircle,
  Image as ImageIcon,
  FileImage,
  Download,
  Type,
  Filter,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";

const OverlayAssets = () => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterType, setFilterType] = useState("all"); // "all", "image", "font"
  const [error, setError] = useState(null); // Error state for display
  const [success, setSuccess] = useState(null); // Success state for display

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/overlayfiles");
      const data = await response.json();

      if (data.success) {
        setFiles(data.files || []);
        setError(null);
      } else {
        const errorMsg = t("overlayAssets.loadFailed");
        setError(errorMsg);
        showError(errorMsg);
      }
    } catch (err) {
      console.error("Error loading overlay files:", err);
      const errorMsg = t("overlayAssets.loadError", { message: err.message });
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type - images and fonts
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "font/ttf",
      "font/otf",
      "font/woff",
      "font/woff2",
      "application/x-font-ttf",
      "application/x-font-otf",
      "application/font-woff",
      "application/font-woff2",
    ];

    const fileExtension = file.name.split(".").pop().toLowerCase();
    const validExtensions = [
      "png",
      "jpg",
      "jpeg",
      "ttf",
      "otf",
      "woff",
      "woff2",
    ];

    if (!validExtensions.includes(fileExtension)) {
      showError(t("overlayAssets.invalidFileType"));
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      showError(t("overlayAssets.fileTooLarge"));
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setSuccess(null);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/overlayfiles/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const successMsg = data.message || t("overlayAssets.uploadSuccess");
        setSuccess(successMsg);
        showSuccess(successMsg);
        await loadFiles(); // Reload file list
        // Reset file input
        event.target.value = "";
      } else {
        const errorMsg = data.detail || t("overlayAssets.uploadFailed");
        setError(errorMsg);
        showError(errorMsg);
      }
    } catch (err) {
      console.error("Error uploading file:", err);
      const errorMsg = t("overlayAssets.uploadError", { message: err.message });
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename) => {
    try {
      setError(null);
      setSuccess(null);

      const response = await fetch(
        `/api/overlayfiles/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        const successMsg = data.message || t("overlayAssets.deleteSuccess");
        setSuccess(successMsg);
        showSuccess(successMsg);
        await loadFiles(); // Reload file list
        setDeleteConfirm(null);
      } else {
        const errorMsg = data.detail || t("overlayAssets.deleteFailed");
        setError(errorMsg);
        showError(errorMsg);
      }
    } catch (err) {
      console.error("Error deleting file:", err);
      const errorMsg = t("overlayAssets.deleteError", { message: err.message });
      setError(errorMsg);
      showError(errorMsg);
    }
  };

  const getFileExtension = (filename) => {
    return filename.split(".").pop().toUpperCase();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const filteredFiles = files.filter((file) => {
    if (filterType === "all") return true;
    return file.type === filterType;
  });

  const imageCount = files.filter((f) => f.type === "image").length;
  const fontCount = files.filter((f) => f.type === "font").length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <p className="text-theme-muted">{t("overlayAssets.description")}</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-500 font-medium">
              {t("notification.error")}
            </p>
            <p className="text-red-400 text-sm mt-1">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-6 bg-green-500/10 border border-green-500 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-green-500 font-medium">
              {t("notification.success")}
            </p>
            <p className="text-green-400 text-sm mt-1">{success}</p>
          </div>
          <button
            onClick={() => setSuccess(null)}
            className="text-green-400 hover:text-green-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Upload Section */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Upload className="w-5 h-5 text-theme-primary" />
          <h2 className="text-xl font-semibold text-theme-text">
            {t("overlayAssets.uploadTitle")}
          </h2>
        </div>

        <div className="border-2 border-dashed border-theme rounded-lg p-8 text-center">
          <input
            type="file"
            id="file-upload"
            accept="image/png,image/jpeg,image/jpg,.ttf,.otf,.woff,.woff2"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
          <label
            htmlFor="file-upload"
            className={`cursor-pointer ${uploading ? "opacity-50" : ""}`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center">
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-theme-primary animate-spin" />
                ) : (
                  <Upload className="w-8 h-8 text-theme-primary" />
                )}
              </div>
              <div>
                <p className="text-theme-text font-medium mb-1">
                  {uploading
                    ? t("overlayAssets.uploading")
                    : t("overlayAssets.clickToUpload")}
                </p>
                <p className="text-theme-muted text-sm">
                  {t("overlayAssets.uploadHint")}
                </p>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Files List */}
      <div className="bg-theme-card border border-theme rounded-lg p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <FileImage className="w-5 h-5 text-theme-primary" />
            <h2 className="text-xl font-semibold text-theme-text">
              {t("overlayAssets.filesTitle")}
            </h2>
            <span className="px-2 py-1 bg-theme-primary/10 text-theme-primary text-sm font-medium rounded">
              {filteredFiles.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Filter Buttons */}
            <div className="flex items-center gap-2 bg-theme-hover rounded-lg p-1">
              <button
                onClick={() => setFilterType("all")}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  filterType === "all"
                    ? "bg-theme-primary text-white"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                {t("overlayAssets.all")} ({files.length})
              </button>
              <button
                onClick={() => setFilterType("image")}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  filterType === "image"
                    ? "bg-theme-primary text-white"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                {t("overlayAssets.images")} ({imageCount})
              </button>
              <button
                onClick={() => setFilterType("font")}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  filterType === "font"
                    ? "bg-theme-primary text-white"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                {t("overlayAssets.fonts")} ({fontCount})
              </button>
            </div>

            <button
              onClick={loadFiles}
              disabled={loading}
              className="px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary rounded-lg transition-colors disabled:opacity-50"
            >
              {loading
                ? t("overlayAssets.loading")
                : t("overlayAssets.refresh")}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-theme-primary animate-spin" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-12">
            {filterType === "all" ? (
              <>
                <ImageIcon className="w-16 h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                <p className="text-theme-muted text-lg mb-2">
                  {t("overlayAssets.noFiles")}
                </p>
                <p className="text-theme-muted text-sm">
                  {t("overlayAssets.uploadFirst")}
                </p>
              </>
            ) : (
              <>
                {filterType === "image" ? (
                  <ImageIcon className="w-16 h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                ) : (
                  <Type className="w-16 h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                )}
                <p className="text-theme-muted text-lg mb-2">
                  {t("overlayAssets.noFilteredFiles", {
                    type: t(`overlayAssets.${filterType}`),
                  })}
                </p>
                <p className="text-theme-muted text-sm">
                  {t("overlayAssets.uploadOrChangeFilter", {
                    type: t(`overlayAssets.${filterType}`),
                  })}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredFiles.map((file) => (
              <div
                key={file.name}
                className="bg-theme-card border-2 border-theme rounded-lg overflow-hidden group hover:border-theme-primary hover:shadow-lg hover:shadow-theme-primary/20 transition-all duration-300"
              >
                {/* Image/Font Preview */}
                <div className="aspect-square relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900">
                  {file.type === "image" ? (
                    <div className="w-full h-full p-4 flex items-center justify-center relative">
                      {/* Checkered background for transparency */}
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundImage: `
                          linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
                          linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
                          linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)
                        `,
                          backgroundSize: "20px 20px",
                          backgroundPosition:
                            "0 0, 0 10px, 10px -10px, -10px 0px",
                        }}
                      ></div>
                      <img
                        src={`/api/overlayfiles/preview/${file.name}`}
                        alt={file.name}
                        className="relative z-10 max-w-full max-h-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full p-4 flex items-center justify-center relative">
                      <img
                        src={`/api/fonts/preview/${file.name}?text=AaBbCc&v=${file.size}`}
                        alt={file.name}
                        className="relative z-10 max-w-full max-h-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          // Fallback if preview fails
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                      <div
                        className="hidden flex-col items-center justify-center"
                        style={{ display: "none" }}
                      >
                        <Type className="w-16 h-16 text-theme-primary mb-2" />
                        <p className="text-theme-muted text-sm text-center">
                          {file.extension.toUpperCase()} Font
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20">
                    <button
                      onClick={() => setPreviewFile(file)}
                      className="p-3 bg-theme-primary hover:bg-theme-primary/80 rounded-lg transition-all hover:scale-110 shadow-lg"
                      title={t("overlayAssets.preview")}
                    >
                      <Eye className="w-6 h-6 text-white" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(file)}
                      className="p-3 bg-red-500 hover:bg-red-600 rounded-lg transition-all hover:scale-110 shadow-lg"
                      title={t("overlayAssets.delete")}
                    >
                      <Trash2 className="w-6 h-6 text-white" />
                    </button>
                    <a
                      href={`/api/overlayfiles/preview/${file.name}`}
                      download={file.name}
                      className="p-3 bg-green-500 hover:bg-green-600 rounded-lg transition-all hover:scale-110 shadow-lg inline-block"
                      title={t("overlayAssets.download")}
                    >
                      <Download className="w-6 h-6 text-white" />
                    </a>
                  </div>
                </div>

                {/* File Info */}
                <div className="p-3 bg-theme-hover border-t border-theme">
                  <p
                    className="text-theme-text text-sm font-medium truncate mb-1"
                    title={file.name}
                  >
                    {file.name}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 bg-theme-primary/10 text-theme-primary text-xs font-semibold rounded">
                      {getFileExtension(file.name)}
                    </span>
                    <span className="text-theme-muted text-xs font-medium">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div
          className="app-dialog-backdrop fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="app-dialog-panel relative max-w-7xl max-h-[90vh] bg-theme-card rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewFile(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex flex-col md:flex-row max-h-[90vh]">
              {/* Preview Content */}
              <div className="flex-1 flex items-center justify-center bg-black p-4">
                {previewFile.type === "image" ? (
                  /* Image Preview with Checkered Background */
                  <div className="relative max-w-full max-h-[80vh] flex items-center justify-center">
                    {/* Checkered background for transparency */}
                    <div
                      className="absolute inset-0 rounded-lg"
                      style={{
                        backgroundImage: `
                          linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
                          linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
                          linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)
                        `,
                        backgroundSize: "20px 20px",
                        backgroundPosition:
                          "0 0, 0 10px, 10px -10px, -10px 0px",
                      }}
                    ></div>
                    <img
                      src={`/api/overlayfiles/preview/${previewFile.name}`}
                      alt={previewFile.name}
                      className="relative z-10 max-w-full max-h-[80vh] object-contain"
                      onError={(e) => {
                        e.target.style.display = "none";
                        e.target.nextSibling.style.display = "flex";
                      }}
                    />
                    <div
                      className="hidden flex-col items-center gap-3 text-white relative z-10"
                      style={{ display: "none" }}
                    >
                      <AlertCircle className="w-12 h-12" />
                      <p>{t("overlayAssets.failedToLoad")}</p>
                    </div>
                  </div>
                ) : (
                  /* Font Preview */
                  <div className="w-full max-h-[80vh] overflow-y-auto px-4">
                    <div className="space-y-4">
                      <div className="bg-theme-card rounded-lg p-4">
                        <p className="text-xs text-theme-muted mb-2">
                          {t("overlayAssets.uppercase")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=ABCDEFGHIJKLMNOPQRSTUVWXYZ&v=${previewFile.size}`}
                          alt="Uppercase letters"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-theme-card rounded-lg p-4">
                        <p className="text-xs text-theme-muted mb-2">
                          {t("overlayAssets.lowercase")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=abcdefghijklmnopqrstuvwxyz&v=${previewFile.size}`}
                          alt="Lowercase letters"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-theme-card rounded-lg p-4">
                        <p className="text-xs text-theme-muted mb-2">
                          {t("overlayAssets.numbers")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=0123456789&v=${previewFile.size}`}
                          alt="Numbers"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-theme-card rounded-lg p-4">
                        <p className="text-xs text-theme-muted mb-2">
                          {t("overlayAssets.sample")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=The Quick Brown Fox&v=${previewFile.size}`}
                          alt="Sample text"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Info Panel */}
              <div className="md:w-80 p-6 bg-theme-card overflow-y-auto">
                <h3 className="text-xl font-bold text-theme-text mb-4">
                  {previewFile.type === "image"
                    ? "Overlay Image Details"
                    : "Font Details"}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-theme-muted">Type</label>
                    <div className="flex items-center gap-2 mt-1">
                      {previewFile.type === "image" ? (
                        <ImageIcon className="w-4 h-4 text-theme-primary" />
                      ) : (
                        <Type className="w-4 h-4 text-theme-primary" />
                      )}
                      <p className="text-theme-text capitalize">
                        {previewFile.type}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-theme-muted">Filename</label>
                    <p className="text-theme-text break-all font-mono text-sm mt-1">
                      {previewFile.name}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm text-theme-muted">
                      Extension
                    </label>
                    <p className="text-theme-text">
                      {previewFile.extension.toUpperCase()}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm text-theme-muted">Size</label>
                    <p className="text-theme-text">
                      {formatFileSize(previewFile.size)}
                    </p>
                  </div>

                  {previewFile.type === "font" && (
                    <div className="pt-4 border-t border-theme">
                      <p className="text-xs text-theme-muted mb-2">
                        {t("overlayAssets.fontInfo")}
                      </p>
                      <p className="text-sm text-theme-text">
                        Font files can be used for custom text overlays in your
                        posters and title cards.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="app-dialog-backdrop fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="app-dialog-panel bg-theme-card border border-theme rounded-lg max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-theme-text mb-2">
                  {t("overlayAssets.deleteTitle")}
                </h3>
                <p className="text-theme-muted text-sm mb-1">
                  {t("overlayAssets.deleteConfirm")}
                </p>
                <p className="text-theme-text font-medium text-sm">
                  {deleteConfirm.name}
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-theme-hover hover:bg-theme-bg-dark text-theme-text rounded-lg transition-colors"
              >
                {t("overlayAssets.cancel")}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.name)}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                {t("overlayAssets.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OverlayAssets;
