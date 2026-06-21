import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  LayoutGrid,
  FolderTree,
  // Imports for Gallery, OverlayAssets, and TestGallery
  ImageIcon,
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  Play,
  ChevronUp,
  X,
  Upload,
  Trash2,
  Eye,
  AlertCircle,
  CheckCircle,
  FileImage,
  Download,
  Type,
  Expand,
  Minimize,
  TestTube,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";

// Import all child gallery components
import Gallery from "./Gallery"; // This is your Poster gallery
import BackgroundsGallery from "./BackgroundsGallery";
import SeasonGallery from "./SeasonGallery";
import TitleCardGallery from "./TitleCardGallery";
import FolderView from "./FolderView";
import ScrollToButtons from "./ScrollToButtons"; // Used by child tabs
import BackupAssets from "./BackupAssets";

const API_URL = "/api";
const OVERLAY_UPLOAD_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "ttf",
  "otf",
  "woff",
  "woff2",
];

const getFileExtension = (filename = "") => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toUpperCase() : "";
};

const getFileExtensionLower = (filename = "") => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
};

const formatFileSize = (bytes) => {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
};

const isOverlayUploadFile = (filename) =>
  OVERLAY_UPLOAD_EXTENSIONS.includes(getFileExtensionLower(filename));

// ##########################################################################
// ## MAIN GALLERY HUB COMPONENT
// ##########################################################################

function GalleryHub() {
  const { t } = useTranslation();
  const location = useLocation();

  // View mode: 'grid' (default/current) or 'folder'
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem("gallery-view-mode");
    return saved || "grid";
  });

  // Save view mode to localStorage
  useEffect(() => {
    localStorage.setItem("gallery-view-mode", viewMode);
    window.dispatchEvent(new Event("viewModeChanged"));
  }, [viewMode]);

  // Get active tab from URL path
  const getActiveTabFromPath = () => {
    const path = location.pathname;
    if (path.includes("/backgrounds")) return "backgrounds";
    if (path.includes("/seasons")) return "seasons";
    if (path.includes("/titlecards")) return "titlecards";

    // --- MODIFICATION: Split overlay-assets ---
    if (path.includes("/overlay-upload")) return "overlayUpload";
    if (path.includes("/overlay-files")) return "overlayFiles";
    // --- END MODIFICATION ---

    if (path.includes("/test-gallery")) return "testGallery";
    if (path.includes("/manual-assets")) return "manualAssets";
    if (path.includes("/asset-backups")) return "backupAssets";
    if (path.includes("/asset-overview")) return "assetOverview";

    // Default to "posters"
    return "posters";
  };

  const activeTab = getActiveTabFromPath();

  // This function will render the correct tab's content
  const renderActiveTabContent = () => {

    if (activeTab === "overlayUpload") {
      return <OverlayUploadView />;
    }
    if (activeTab === "overlayFiles") {
      return <OverlayFilesView />;
    }

    if (activeTab === "testGallery") {
      return <TestGalleryTab />;
    }

    if (activeTab === "backupAssets") {
      return <BackupAssets />;
    }

    // These routes are handled by their own <Route>
    if (activeTab === "manualAssets" || activeTab === "assetOverview") {
      return null;
    }

    // Handle standard gallery tabs
    if (viewMode === "folder") {
      return <FolderView />;
    }

    // Render the correct grid view
    switch (activeTab) {
      case "posters":
        return <Gallery />;
      case "backgrounds":
        return <BackgroundsGallery />;
      case "seasons":
        return <SeasonGallery />;
      case "titlecards":
        return <TitleCardGallery />;
      default:
        return <Gallery />; // Fallback to posters
    }
  };

  // Check if the current tab should show the view mode toggle
  const showViewModeToggle = [
    "posters",
    "backgrounds",
    "seasons",
    "titlecards",
  ].includes(activeTab);

  return (
    <div className="space-y-4">
      {/* View Mode Toggle - Only show for relevant tabs */}
      {showViewModeToggle && (
        <div className="bg-theme-card border border-theme-border rounded-lg p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex-1 min-w-0">
              <h3 className="text-base sm:text-lg font-semibold text-theme-text mb-1">
                {t("galleryHub.viewMode")}
              </h3>
              <p className="text-xs sm:text-sm text-theme-muted line-clamp-2 sm:line-clamp-none">
                {viewMode === "grid"
                  ? t("galleryHub.gridDescription")
                  : t("galleryHub.folderDescription")}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all shadow-sm ${
                  viewMode === "grid"
                    ? "bg-theme-primary text-white border-2 border-theme-primary"
                    : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text"
                }`}
              >
                <LayoutGrid className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
                  {t("galleryHub.gridView")}
                </span>
              </button>
              <button
                onClick={() => setViewMode("folder")}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all shadow-sm ${
                  viewMode === "folder"
                    ? "bg-theme-primary text-white border-2 border-theme-primary"
                    : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text"
                }`}
              >
                <FolderTree className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
                  {t("galleryHub.folderView")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Tab Content */}
      <div>{renderActiveTabContent()}</div>
    </div>
  );
}

// ##########################################################################
// ## TEST GALLERY TAB (No Changes)
// ##########################################################################
function TestGalleryTab() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({
    posters: false,
    backgrounds: false,
    seasonPosters: false,
    titleCards: false,
  });
  const [status, setStatus] = useState({
    running: false,
    current_mode: null,
  });

  const categorizeImages = (images) => {
    const categories = {
      posters: [],
      backgrounds: [],
      seasonPosters: [],
      titleCards: [],
    };

    images.forEach((img) => {
      const name = img.name.toLowerCase();
      if (name.includes("poster") && !name.includes("season")) {
        categories.posters.push(img);
      } else if (name.includes("background")) {
        categories.backgrounds.push(img);
      } else if (name.includes("seasonposter")) {
        categories.seasonPosters.push(img);
      } else if (name.includes("titlecard")) {
        categories.titleCards.push(img);
      }
    });

    return categories;
  };

  const toggleCategory = (category, event) => {
    if (event) event.preventDefault();
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const fetchImages = async (showToast = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/test-gallery`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setImages(data.images || []);

      if (showToast && data.images && data.images.length > 0) {
        showSuccess(
          t("testGallery.success.filesLoaded", { count: data.images.length })
        );
      }
    } catch (error) {
      console.error("Error fetching test images:", error);
      const errorMsg = error.message || t("testGallery.errors.loadFailed");
      setError(errorMsg);
      showError(errorMsg);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/status`);
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error("Error fetching status:", error);
    }
  };

  const runTestMode = async () => {
    if (status.running) {
      showError(t("testGallery.errors.scriptRunning"));
      return;
    }

    setScriptLoading(true);
    try {
      const response = await fetch(`${API_URL}/run/testing`, {
        method: "POST",
      });
      const data = await response.json();

      if (data.success) {
        showSuccess(t("testGallery.success.testModeStarted"));
        fetchStatus();
      } else {
        showError(
          t("testGallery.errors.withMessage", { message: data.message })
        );
      }
    } catch (error) {
      showError(
        t("testGallery.errors.withMessage", { message: error.message })
      );
    } finally {
      setScriptLoading(false);
    }
  };

  useEffect(() => {
    fetchImages(false);
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredImages = images.filter(
    (img) =>
      img.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      img.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const categorizedImages = categorizeImages(filteredImages);

  const CategorySection = ({ title, images, categoryKey, description }) => {
    if (images.length === 0) return null;

    const isExpanded = expandedCategories[categoryKey];
    const isPortrait =
      categoryKey === "posters" || categoryKey === "seasonPosters";
    const aspectRatio = isPortrait ? "aspect-[2/3]" : "aspect-[16/9]";
    const gridCols = isPortrait
      ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
      : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

    return (
      <div className="mb-6">
        <button
          onClick={(e) => toggleCategory(categoryKey, e)}
          className="w-full flex items-center justify-between p-5 bg-theme-card border border-theme rounded-xl hover:bg-theme-hover hover:border-theme-primary/50 transition-all group shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-theme-primary/10 group-hover:bg-theme-primary/20 rounded-lg text-sm font-bold text-theme-primary transition-all group-hover:scale-110">
              {images.length}
            </div>
            <div className="text-left">
              <h3 className="text-lg font-semibold text-theme-primary">
                {title}
              </h3>
              {description && (
                <p className="text-xs text-theme-muted mt-1">{description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                isExpanded
                  ? "bg-theme-primary/20 text-theme-primary border border-theme-primary/30"
                  : "bg-theme-bg text-theme-muted border border-theme"
              }`}
            >
              {isExpanded ? t("testGallery.open") : t("testGallery.closed")}
            </span>
            {isExpanded ? (
              <ChevronUp className="w-6 h-6 text-theme-primary transition-transform" />
            ) : (
              <ChevronDown className="w-6 h-6 text-theme-muted transition-transform" />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className={`mt-4 grid ${gridCols} gap-4`}>
            {images.map((image, index) => (
              <div
                key={index}
                className="group relative bg-theme-card rounded-xl overflow-hidden border border-theme hover:border-theme-primary hover:shadow-lg transition-all cursor-pointer"
                onClick={() => setSelectedImage(image)}
              >
                <div
                  className={`${aspectRatio} bg-theme-bg flex items-center justify-center overflow-hidden`}
                >
                  <img
                    src={image.url}
                    alt={image.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextSibling.style.display = "flex";
                    }}
                  />
                  <div
                    className="hidden flex-col items-center justify-center text-theme-muted p-4"
                    style={{ display: "none" }}
                  >
                    <ImageIcon className="w-12 h-12 mb-2" />
                    <span className="text-xs text-center">
                      {t("testGallery.previewUnavailable")}
                    </span>
                  </div>
                </div>

                <div className="p-3 border-t border-theme">
                  <p
                    className="text-xs text-theme-text truncate font-medium"
                    title={image.name}
                  >
                    {image.name}
                  </p>
                  <p className="text-[10px] text-theme-muted mt-1">
                    {(image.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <ScrollToButtons />
      {/* Header Controls */}
      <div className="flex items-center justify-end">
        <div className="flex gap-3">
          <button
            onClick={() => fetchImages(true)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            <RefreshCw
              className={`w-4 h-4 text-theme-primary ${
                loading ? "animate-spin" : ""
              }`}
            />
            <span className="text-theme-text">{t("testGallery.refresh")}</span>
          </button>

          <button
            onClick={runTestMode}
            disabled={scriptLoading || status.running}
            className="flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 border border-yellow-700 hover:border-yellow-600 disabled:bg-gray-600 disabled:border-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            {scriptLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>{t("testGallery.startTestMode")}</span>
          </button>
        </div>
      </div>

      {/* Running Status */}
      {status.running && (
        <div className="bg-orange-950/40 rounded-xl p-4 border border-orange-600/50 shadow-sm">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            <div>
              <p className="font-medium text-orange-200">
                {t("testGallery.scriptRunning")}
              </p>
              <p className="text-sm text-orange-300/80">
                {t("testGallery.mode")}:{" "}
                {status.current_mode || t("testGallery.unknown")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      {images.length > 0 && (
        <div className="bg-theme-card rounded-xl p-4 border border-theme shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-muted" />
            <input
              type="text"
              placeholder={t("testGallery.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-theme-bg border border-theme rounded-lg text-theme-text placeholder-theme-muted focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary transition-all"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-theme-primary mx-auto mb-4" />
            <p className="text-theme-muted">{t("testGallery.loading")}</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-950/40 rounded-xl p-6 border-2 border-red-600/50 text-center shadow-sm">
          <ImageIcon className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-red-300 mb-2">
            {t("testGallery.errorLoadingTitle")}
          </h3>
          <p className="text-red-200">{error}</p>
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="bg-theme-card border border-theme rounded-xl p-12 text-center shadow-sm">
          <ImageIcon className="w-16 h-16 text-theme-muted mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-theme-text mb-2">
            {t("testGallery.noFilesTitle")}
          </h3>
          <p className="text-theme-muted text-sm">
            {searchTerm
              ? t("testGallery.noFilesSearchHint")
              : t("testGallery.noFilesHint")}
          </p>
        </div>
      ) : (
        <>
          {/* Total & Controls */}
          <div className="bg-theme-card border border-theme rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-theme-text">
                  {t("testGallery.total")}:{" "}
                  <span className="font-bold text-theme-primary text-lg">
                    {filteredImages.length}
                  </span>{" "}
                  {t("testGallery.testFiles")}
                </span>
                {images.length !== filteredImages.length && (
                  <span className="ml-2 text-theme-muted text-sm bg-theme-bg px-2 py-1 rounded">
                    {t("testGallery.filteredFrom", { total: images.length })}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setExpandedCategories({
                      posters: true,
                      backgrounds: true,
                      seasonPosters: true,
                      titleCards: true,
                    })
                  }
                  className="flex items-center gap-1 px-3 py-2 text-sm bg-theme-hover hover:bg-theme-primary/20 border border-theme hover:border-theme-primary rounded-lg transition-all font-medium"
                >
                  <Expand className="w-4 h-4" />
                  {t("testGallery.expandAll")}
                </button>
                <button
                  onClick={() =>
                    setExpandedCategories({
                      posters: false,
                      backgrounds: false,
                      seasonPosters: false,
                      titleCards: false,
                    })
                  }
                  className="flex items-center gap-1 px-3 py-2 text-sm bg-theme-hover hover:bg-theme-primary/20 border border-theme hover:border-theme-primary rounded-lg transition-all font-medium"
                >
                  <Minimize className="w-4 h-4" />
                  {t("testGallery.collapseAll")}
                </button>
              </div>
            </div>
          </div>

          {/* Categories */}
          <CategorySection
            title={t("testGallery.categories.posters")}
            images={categorizedImages.posters}
            categoryKey="posters"
            description={t("testGallery.categories.postersDesc")}
          />
          <CategorySection
            title={t("testGallery.categories.backgrounds")}
            images={categorizedImages.backgrounds}
            categoryKey="backgrounds"
            description={t("testGallery.categories.backgroundsDesc")}
          />
          <CategorySection
            title={t("testGallery.categories.seasonPosters")}
            images={categorizedImages.seasonPosters}
            categoryKey="seasonPosters"
            description={t("testGallery.categories.seasonPostersDesc")}
          />
          <CategorySection
            title={t("testGallery.categories.titleCards")}
            images={categorizedImages.titleCards}
            categoryKey="titleCards"
            description={t("testGallery.categories.titleCardsDesc")}
          />
        </>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-7xl max-h-[90vh] bg-theme-card rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="flex flex-col md:flex-row max-h-[90vh]">
              <div className="flex-1 flex items-center justify-center bg-black p-4">
                <img
                  src={selectedImage.url}
                  alt={selectedImage.name}
                  className="max-w-full max-h-[80vh] object-contain"
                  onError={(e) => {
                    e.target.style.display = "none";
                    e.target.nextSibling.style.display = "block";
                  }}
                />
                <div className="text-center" style={{ display: "none" }}>
                  <div className="p-4 rounded-full bg-theme-primary/20 inline-block mb-4">
                    <ImageIcon className="w-16 h-16 text-theme-primary" />
                  </div>
                  <p className="text-white text-lg font-semibold mb-2">
                    {t("testGallery.imagePreviewNotAvailable")}
                  </p>
                  <p className="text-gray-400 text-sm">
                    Image could not be loaded
                  </p>
                </div>
              </div>
              <div className="md:w-80 p-6 bg-theme-card overflow-y-auto">
                <h3 className="text-xl font-bold text-theme-text mb-4">
                  Image Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-theme-muted">Filename</label>
                    <p className="text-theme-text break-all">
                      {selectedImage.name}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-theme-muted">Size</label>
                    <p className="text-theme-text">
                      {(selectedImage.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ##########################################################################
// ## NEW: OVERLAY UPLOAD VIEW
// ##########################################################################
function OverlayUploadView() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileExtension = getFileExtensionLower(file.name);

    if (!isOverlayUploadFile(file.name)) {
      showError(t("overlayAssets.invalidFileType"));
      setUploadPreview(null);
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showError(t("overlayAssets.fileTooLarge"));
      setUploadPreview(null);
      setSelectedFile(null);
      return;
    }

    // Create preview for images
    setSelectedFile(file);
    if (["png", "jpg", "jpeg"].includes(fileExtension)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadPreview(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setUploadPreview(null);
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/overlayfiles/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showSuccess(data.message || t("overlayAssets.uploadSuccess"));
        // Don't need to loadFiles() here, this component just uploads
        event.target.value = "";
        setUploadPreview(null);
        setSelectedFile(null);
      } else {
        showError(data.detail || t("overlayAssets.uploadFailed"));
      }
    } catch (err) {
      console.error("Error uploading file:", err);
      showError(t("overlayAssets.uploadError", { message: err.message }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <ScrollToButtons />
      <div className="text-theme-muted">
        <p>{t("overlayAssets.description")}</p>
      </div>

      {/* Upload Section */}
      <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <Upload className="w-5 h-5 text-theme-primary" />
          <h2 className="text-lg sm:text-xl font-semibold text-theme-text">
            {t("overlayAssets.uploadTitle")}
          </h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          {/* Upload Area */}
          <div className="flex-1">
            <div className="border-2 border-dashed border-theme rounded-lg p-6 sm:p-8 text-center">
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
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-theme-primary/10 rounded-full flex items-center justify-center">
                    {uploading ? (
                      <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-theme-primary animate-spin" />
                    ) : (
                      <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-theme-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-theme-text font-medium mb-1 text-sm sm:text-base">
                      {uploading
                        ? t("overlayAssets.uploading")
                        : t("overlayAssets.clickToUpload")}
                    </p>
                    <p className="text-theme-muted text-xs sm:text-sm">
                      {t("overlayAssets.uploadHint")}
                    </p>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Upload Preview */}
          {(uploadPreview || selectedFile) && (
            <div className="lg:w-80">
              <div className="bg-theme-bg border border-theme rounded-lg p-4">
                <h3 className="text-sm font-semibold text-theme-text mb-3">
                  {t("overlayAssets.uploadPreview")}
                </h3>

                {uploadPreview ? (
                  <div className="relative aspect-square bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 rounded-lg overflow-hidden mb-3">
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
                      src={uploadPreview}
                      alt="Upload preview"
                      className="relative z-10 w-full h-full object-contain p-4"
                    />
                  </div>
                ) : (
                  <div className="aspect-square bg-theme-hover border border-theme rounded-lg flex items-center justify-center mb-3">
                    <div className="text-center">
                      <Type className="w-12 h-12 text-theme-primary mx-auto mb-2" />
                      <p className="text-xs text-theme-muted">
                        {t("overlayAssets.fontFile")}
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-theme-muted">
                      {t("overlayAssets.filename")}:
                    </span>
                    <span
                      className="text-theme-text font-medium truncate ml-2 max-w-[60%]"
                      title={selectedFile?.name}
                    >
                      {selectedFile?.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-theme-muted">
                      {t("overlayAssets.size")}:
                    </span>
                    <span className="text-theme-text font-medium">
                      {formatFileSize(selectedFile?.size || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-theme-muted">
                      {t("overlayAssets.type")}:
                    </span>
                    <span className="px-2 py-0.5 bg-theme-primary/10 text-theme-primary text-xs font-semibold rounded">
                      {getFileExtension(selectedFile?.name || "")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ##########################################################################
// ## NEW: OVERLAY FILES VIEW
// ##########################################################################
function OverlayFilesView() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterType, setFilterType] = useState("all");

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/overlayfiles");
      const data = await response.json();

      if (data.success) {
        setFiles(data.files || []);
      } else {
        showError(t("overlayAssets.loadFailed"));
      }
    } catch (err) {
      console.error("Error loading overlay files:", err);
      showError(t("overlayAssets.loadError", { message: err.message }));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (filename) => {
    try {
      const response = await fetch(
        `/api/overlayfiles/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        showSuccess(data.message || t("overlayAssets.deleteSuccess"));
        await loadFiles();
        setDeleteConfirm(null);
      } else {
        showError(data.detail || t("overlayAssets.deleteFailed"));
      }
    } catch (err) {
      console.error("Error deleting file:", err);
      showError(t("overlayAssets.deleteError", { message: err.message }));
    }
  };

  const filteredFiles = files.filter((file) => {
    if (filterType === "all") return true;
    return file.type === filterType;
  });

  const imageCount = files.filter((f) => f.type === "image").length;
  const fontCount = files.filter((f) => f.type === "font").length;

  return (
    <div className="space-y-6">
      <ScrollToButtons />

      {/* Files List */}
      <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <FileImage className="w-5 h-5 text-theme-primary" />
            <h2 className="text-lg sm:text-xl font-semibold text-theme-text">
              {t("overlayAssets.filesTitle")}
            </h2>
            <span className="px-2 py-1 bg-theme-primary/10 text-theme-primary text-sm font-medium rounded">
              {filteredFiles.length}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Filter Buttons */}
            <div className="flex items-center gap-2 bg-theme-hover rounded-lg p-1">
              <button
                onClick={() => setFilterType("all")}
                className={`px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${
                  filterType === "all"
                    ? "bg-theme-primary text-white"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                {t("overlayAssets.all")} ({files.length})
              </button>
              <button
                onClick={() => setFilterType("image")}
                className={`px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${
                  filterType === "image"
                    ? "bg-theme-primary text-white"
                    : "text-theme-muted hover:text-theme-text"
                }`}
              >
                {t("overlayAssets.images")} ({imageCount})
              </button>
              <button
                onClick={() => setFilterType("font")}
                className={`px-2 sm:px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${
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
              className="px-3 sm:px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary rounded-lg transition-colors disabled:opacity-50 text-xs sm:text-sm"
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
                <ImageIcon className="w-12 h-12 sm:w-16 sm:h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                <p className="text-theme-muted text-base sm:text-lg mb-2">
                  {t("overlayAssets.noFiles")}
                </p>
                <p className="text-theme-muted text-xs sm:text-sm">
                  {t("overlayAssets.uploadFirst")}
                </p>
              </>
            ) : (
              <>
                {filterType === "image" ? (
                  <ImageIcon className="w-12 h-12 sm:w-16 sm:h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                ) : (
                  <Type className="w-12 h-12 sm:w-16 sm:h-16 text-theme-muted mx-auto mb-4 opacity-50" />
                )}
                <p className="text-theme-muted text-base sm:text-lg mb-2">
                  {t("overlayAssets.noFilteredFiles", {
                    type: t(`overlayAssets.${filterType}`),
                  })}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredFiles.map((file) => (
              <div
                key={file.name}
                onClick={() => setPreviewFile(file)}
                className="bg-theme-card border-2 border-theme rounded-lg overflow-hidden group hover:border-theme-primary hover:shadow-lg hover:shadow-theme-primary/20 transition-all duration-300 cursor-pointer"
              >
                {/* Image/Font Preview */}
                <div className="aspect-square relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900">
                  {file.type === "image" ? (
                    <div className="w-full h-full p-2 sm:p-4 flex items-center justify-center relative">
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
                    <div className="w-full h-full p-2 sm:p-4 flex items-center justify-center relative">
                      <img
                        src={`/api/fonts/preview/${file.name}?text=AaBbCc&v=${file.size}`}
                        alt={file.name}
                        className="relative z-10 max-w-full max-h-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                      <div
                        className="hidden flex-col items-center justify-center"
                        style={{ display: "none" }}
                      >
                        <Type className="w-12 h-12 sm:w-16 sm:h-16 text-theme-primary mb-2" />
                        <p className="text-theme-muted text-xs sm:text-sm text-center">
                          {file.extension.toUpperCase()} Font
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* File Info */}
                <div className="p-2 sm:p-3 bg-theme-hover border-t border-theme">
                  <p
                    className="text-theme-text text-xs sm:text-sm font-medium truncate mb-1"
                    title={file.name}
                  >
                    {file.name}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="px-1.5 sm:px-2 py-0.5 bg-theme-primary/10 text-theme-primary text-[10px] sm:text-xs font-semibold rounded">
                      {getFileExtension(file.name)}
                    </span>
                    <span className="text-theme-muted text-[10px] sm:text-xs font-medium">
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
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative max-w-7xl max-h-[90vh] bg-theme-card rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Floating Close Button */}
            <button
              onClick={() => setPreviewFile(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col md:flex-row max-h-[90vh]">
              {/* Left Side - Preview */}
              <div className="flex-1 flex items-center justify-center bg-black p-4 overflow-auto">
                {previewFile.type === "image" ? (
                  <div className="relative w-full h-full flex items-center justify-center">
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
                      src={`/api/overlayfiles/preview/${previewFile.name}`}
                      alt={previewFile.name}
                      className="relative z-10 max-w-full max-h-[80vh] w-auto h-auto object-contain rounded-lg shadow-lg"
                    />
                  </div>
                ) : (
                  <div className="w-full space-y-4 max-h-[80vh] overflow-y-auto pr-2">
                    <div className="space-y-3">
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-2">
                          {t("overlayAssets.uppercase")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=ABCDEFGHIJKLMNOPQRSTUVWXYZ&v=${previewFile.size}`}
                          alt="Uppercase"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-2">
                          {t("overlayAssets.lowercase")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=abcdefghijklmnopqrstuvwxyz&v=${previewFile.size}`}
                          alt="Lowercase"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-2">
                          {t("overlayAssets.numbers")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=0123456789&v=${previewFile.size}`}
                          alt="Numbers"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-2">
                          {t("overlayAssets.sample")}:
                        </p>
                        <img
                          src={`/api/fonts/preview/${previewFile.name}?text=The Quick Brown Fox&v=${previewFile.size}`}
                          alt="Sample"
                          className="w-full h-auto object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side - Info Panel */}
              <div className="md:w-80 p-6 bg-theme-card overflow-y-auto">
                <div className="flex items-center gap-3 mb-6">
                  {previewFile.type === "image" ? (
                    <ImageIcon className="w-5 h-5 text-theme-primary" />
                  ) : (
                    <Type className="w-5 h-5 text-theme-primary" />
                  )}
                  <h3 className="text-lg font-semibold text-theme-text">
                    {previewFile.type === "image"
                      ? t("overlayAssets.imagePreview")
                      : t("overlayAssets.fontPreview")}
                  </h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-theme-muted mb-2">
                      {t("overlayAssets.filename")}:
                    </p>
                    <p className="text-sm text-theme-text font-mono bg-theme-bg px-3 py-2 rounded-lg border border-theme break-all">
                      {previewFile.name}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-theme-muted mb-2">
                      {t("overlayAssets.type")}:
                    </p>
                    <p className="text-sm text-theme-text">
                      {previewFile.type === "image" ? "Image" : "Font"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-theme-muted mb-2">
                      {t("overlayAssets.size")}:
                    </p>
                    <p className="text-sm text-theme-text">
                      {formatFileSize(previewFile.size)}
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-6 space-y-3">
                  <a
                    href={`/api/overlayfiles/preview/${previewFile.name}`}
                    download={previewFile.name}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-theme-primary hover:bg-theme-primary/80 text-white rounded-lg transition-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="w-4 h-4" />
                    {t("overlayAssets.download")}
                  </a>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(previewFile);
                      setPreviewFile(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("overlayAssets.delete")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-theme-card border border-theme rounded-lg max-w-md w-full p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-theme-text mb-2">
                  {t("overlayAssets.deleteTitle")}
                </h3>
                <p className="text-theme-muted text-xs sm:text-sm mb-1">
                  {t("overlayAssets.deleteConfirm")}
                </p>
                <p className="text-theme-text font-medium text-xs sm:text-sm break-all">
                  {deleteConfirm.name}
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-theme-hover hover:bg-theme-dark text-theme-text rounded-lg transition-colors text-sm"
              >
                {t("overlayAssets.cancel")}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.name)}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-sm"
              >
                {t("overlayAssets.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GalleryHub;
