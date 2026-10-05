import React, { useState, useEffect, useRef } from "react";
import {
  ImageIcon,
  Folder,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  ChevronLeft, // Added
  ChevronRight, // Added
  CheckSquare,
  Square,
  ArrowUpDown,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import CompactImageSizeSlider from "./CompactImageSizeSlider";
import Notification from "./Notification";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import AssetReplacer from "./AssetReplacer";
import ScrollToButtons from "./ScrollToButtons";
import ImagePreviewModal from "./ImagePreviewModal";
import { buildResponsiveGridClass } from "../utils/gridClass";

const API_URL = "/api";

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++ NEW PAGINATION COMPONENT
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
  const { t } = useTranslation();

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5; // Max 5 page buttons (e.g., 1 ... 4 5 6 ... 10)
    const half = Math.floor(maxPagesToShow / 2);

    if (totalPages <= maxPagesToShow + 2) {
      // Show all pages if 7 or less
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      // Ellipsis after first page?
      if (currentPage > half + 2) {
        pages.push("...");
      }

      // Middle pages
      let start = Math.max(2, currentPage - half);
      let end = Math.min(totalPages - 1, currentPage + half);

      if (currentPage <= half + 2) {
        end = maxPagesToShow - 1;
      }
      if (currentPage >= totalPages - half - 1) {
        start = totalPages - maxPagesToShow + 2;
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      // Ellipsis before last page?
      if (currentPage < totalPages - half - 1) {
        pages.push("...");
      }

      // Show last page
      pages.push(totalPages);
    }

    return pages;
  };

  if (totalPages <= 1) {
    return null; // Don't show pagination if only one page
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <ChevronLeft className="w-4 h-4" />
        {t("pagination.previous")}
      </button>

      {getPageNumbers().map((page, index) =>
        typeof page === "number" ? (
          <button
            key={index}
            onClick={() => handlePageChange(page)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm font-semibold transition-all shadow-sm ${
              currentPage === page
                ? "bg-theme-primary text-white"
                : "bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 text-theme-text"
            }`}
          >
            {page}
          </button>
        ) : (
          <span
            key={`ellipsis-${index}`}
            className="w-10 h-10 flex items-center justify-center text-theme-muted"
          >
            ...
          </span>
        )
      )}

      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {t("pagination.next")}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++ END OF PAGINATION COMPONENT
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

function Gallery() {
  const { t } = useTranslation();
  const { showSuccess, showError, showInfo } = useToast();
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState(null); // Local error state for loading display

  const [selectedImage, setSelectedImage] = useState(null);
  const [deletingImage, setDeletingImage] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  // --- SORTING STATE ---
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem("gallery-sort-order") || "name_asc";
  });
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef(null);

  // Helper to encode path segments but keep slashes
  const safeEncodePath = (path) => {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  };

  useEffect(() => {
    localStorage.setItem("gallery-sort-order", sortOrder);
  }, [sortOrder]);

  // Click outside listener for sort dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target)
      ) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Sorting Helper Function
  const getSortedImages = (imagesToSort) => {
    const sorted = [...imagesToSort];
    sorted.sort((a, b) => {
      // Extract the movie/show folder name from the path for sorting
      // This matches your display logic: image.path.split(/[\\/]/).slice(-2, -1)[0]
      const getNameForSort = (img) => {
        const parts = img.path.split(/[\\/]/);
        // Get the second to last part (the folder name)
        return parts.length > 1 ? parts[parts.length - 2] : img.name;
      };

      const nameA = getNameForSort(a).toLowerCase();
      const nameB = getNameForSort(b).toLowerCase();

      if (sortOrder === "name_asc") return nameA.localeCompare(nameB);
      if (sortOrder === "name_desc") return nameB.localeCompare(nameA);

      const dateA = a.modified || a.created || 0;
      const dateB = b.modified || b.created || 0;

      if (sortOrder === "date_newest") return dateB - dateA;
      if (sortOrder === "date_oldest") return dateA - dateB;

      return 0;
    });
    return sorted;
  };

  // --- PAGINATION STATE ---
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    const saved = localStorage.getItem("gallery-items-per-page");
    return saved ? parseInt(saved) : 25;
  });
  // --- END PAGINATION STATE ---

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);

  // Asset replacer state
  const [replacerOpen, setReplacerOpen] = useState(false);
  const [assetToReplace, setAssetToReplace] = useState(null);

  // Dropdown state
  const [itemsPerPageDropdownOpen, setItemsPerPageDropdownOpen] =
    useState(false);
  const [itemsPerPageDropdownUp, setItemsPerPageDropdownUp] = useState(false);
  const itemsPerPageDropdownRef = useRef(null);

  // Cache busting timestamp for force-reloading images after replacement
  const [cacheBuster, setCacheBuster] = useState(Date.now());

  // Image size state with localStorage (2-20 range, default 5)
  const [imageSize, setImageSize] = useState(() => {
    const saved = localStorage.getItem("gallery-poster-size");
    const parsed = saved ? parseInt(saved) : 5;
    return Math.min(Math.max(parsed, 2), 20);
  });

  const getGridClass = (size) => buildResponsiveGridClass(size);

  const fetchFolders = async (showNotification = false) => {
    try {
      const response = await fetch(`${API_URL}/assets-folders`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setFolders(data.folders || []);

      if (showNotification && data.folders) {
        const totalPosters = data.folders.reduce(
          (sum, folder) => sum + (folder.poster_count || 0),
          0
        );
        const foldersWithPosters = data.folders.filter(
          (f) => f.poster_count > 0
        ).length;

        if (totalPosters > 0) {
          showSuccess(
            t("gallery.foldersLoaded", {
              folderCount: foldersWithPosters,
              posterCount: totalPosters,
            })
          );
        } else {
          showSuccess(
            t("gallery.foldersFound", { count: data.folders.length })
          );
        }
      }

      if (data.folders && data.folders.length > 0 && !activeFolder) {
        const folderWithImages = data.folders.find((f) => f.poster_count > 0);
        if (folderWithImages) {
          setActiveFolder(folderWithImages);
        }
      }
    } catch (error) {
      console.error("Error fetching folders:", error);
      const errorMsg = error.message || t("gallery.loadFoldersError");
      setError(errorMsg);
      showError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const fetchFolderImages = async (
    folder,
    showNotification = false,
    keepScrollPosition = false
  ) => {
    if (!folder) return;
    // Only show loading spinner if we ARE NOT trying to keep scroll position
    if (!keepScrollPosition) {
      setImagesLoading(true);
    }
    try {
      const response = await fetch(
        `${API_URL}/assets-folder-images/posters/${folder.path}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setImages(data.images || []);

      // Log media types for debugging
      if (data.images && data.images.length > 0) {
        const typeCounts = {};
        data.images.forEach((img) => {
          const type = img.type || "undefined";
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        });
        console.log(
          `[Gallery] Loaded ${data.images.length} images from ${folder.name}:`,
          typeCounts
        );
        console.log(
          `[Gallery] Sample images:`,
          data.images.slice(0, 3).map((img) => ({
            name: img.name,
            path: img.path,
            type: img.type,
          }))
        );
      }

      if (showNotification && data.images && data.images.length > 0) {
        showSuccess(
          t("gallery.postersLoaded", {
            count: data.images.length,
            folder: folder.name,
          })
        );
      }
    } catch (error) {
      console.error("Error fetching images:", error);
      const errorMsg =
        error.message || t("gallery.loadImagesError", { folder: folder.name });
      setError(errorMsg);
      showError(errorMsg);
      setImages([]);
    } finally {
      if (!keepScrollPosition) {
        setImagesLoading(false);
      }
    }
  };

  // Click outside detection for dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        itemsPerPageDropdownRef.current &&
        !itemsPerPageDropdownRef.current.contains(event.target)
      ) {
        setItemsPerPageDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const formatDisplayPath = (path) => {
    return path;
  };

  // Helper function to get media type from filename/path
  const getMediaType = (imagePath, imageName) => {
    const path = imagePath.toLowerCase();
    const name = imageName.toLowerCase();

    // Check the folder structure
    if (path.includes("/collections/") || path.includes("\\collections\\")) {
      return "Collection";
    }
    if (path.includes("/seasons/") || path.includes("\\seasons\\")) {
      return "Season";
    }
    if (path.includes("/titlecards/") || path.includes("\\titlecards\\")) {
      return "Episode";
    }
    if (path.includes("/backgrounds/") || path.includes("\\backgrounds\\")) {
      return "Background";
    }

    // Check filename patterns
    if (
      name.includes("season") &&
      (name.includes("poster") || name.match(/s\d+/i))
    ) {
      return "Season";
    }
    if (name.includes("background")) {
      return "Background";
    }

    // Check if it's a show (has series/show in path or multiple seasons)
    if (
      path.includes("/series/") ||
      path.includes("\\series\\") ||
      path.includes("/shows/") ||
      path.includes("\\shows\\")
    ) {
      return "Show";
    }

    // Default to Movie for posters folder
    return "Movie";
  };

  // Get color for media type badge
  const getTypeColor = (type) => {
    switch (type) {
      case "Collection":
        return "bg-amber-500/20 text-amber-400 border-amber-500/50";
      case "Movie":
        return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "Show":
        return "bg-purple-500/20 text-purple-400 border-purple-500/50";
      case "Season":
        return "bg-indigo-500/20 text-indigo-400 border-indigo-500/50";
      case "Episode":
        return "bg-cyan-500/20 text-cyan-400 border-cyan-500/50";
      case "Background":
        return "bg-pink-500/20 text-pink-400 border-pink-500/50";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  // Format timestamp for display
  const formatTimestamp = (filePath) => {
    try {
      // Try to get file modification time from the file system
      // Since we don't have direct access, we'll show when it was loaded
      return new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch (e) {
      return "Unknown";
    }
  };

  const deletePoster = async (imagePath, imageName, event) => {
    if (event) {
      event.stopPropagation();
    }

    setDeletingImage(imagePath);
    try {
      // FIX: Use safeEncodePath instead of encodeURIComponent
      const response = await fetch(
        `${API_URL}/gallery/${safeEncodePath(imagePath)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to delete poster");
      }

      const data = await response.json();

      if (data.success) {
        showSuccess(t("gallery.posterDeleted", { name: imageName }));

        setImages(images.filter((img) => img.path !== imagePath));

        if (selectedImage && selectedImage.path === imagePath) {
          setSelectedImage(null);
        }

        fetchFolders(false);
      } else {
        throw new Error(data.message || "Failed to delete poster");
      }
    } catch (error) {
      console.error("Error deleting poster:", error);
      showError(t("gallery.deleteError", { message: error.message }));
    } finally {
      setDeletingImage(null);
    }
  };

  const bulkDeletePosters = async () => {
    if (selectedImages.length === 0) return;

    setDeletingImage("bulk");
    try {
      const response = await fetch(`${API_URL}/gallery/bulk-delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paths: selectedImages }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to delete posters");
      }

      const data = await response.json();

      if (data.success) {
        const deletedCount = data.deleted.length;
        const failedCount = data.failed.length;

        if (failedCount > 0) {
          showError(
            t("gallery.bulkDeletePartial", {
              deleted: deletedCount,
              failed: failedCount,
            })
          );
        } else {
          showSuccess(t("gallery.bulkDeleteSuccess", { count: deletedCount }));
        }

        // Remove deleted images from the list
        setImages(images.filter((img) => !data.deleted.includes(img.path)));

        // Clear selection
        setSelectedImages([]);
        setSelectMode(false);

        fetchFolders(false);
      } else {
        throw new Error(data.message || "Failed to delete posters");
      }
    } catch (error) {
      console.error("Error deleting posters:", error);
      showError(t("gallery.deleteError", { message: error.message }));
    } finally {
      setDeletingImage(null);
    }
  };

  const toggleImageSelection = (imagePath) => {
    setSelectedImages((prev) =>
      prev.includes(imagePath)
        ? prev.filter((path) => path !== imagePath)
        : [...prev, imagePath]
    );
  };

  const toggleSelectAll = () => {
    if (selectedImages.length === displayedImages.length) {
      setSelectedImages([]);
    } else {
      setSelectedImages(displayedImages.map((img) => img.path));
    }
  };

  const cancelSelectMode = () => {
    setSelectMode(false);
    setSelectedImages([]);
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value);
    localStorage.setItem("gallery-items-per-page", value.toString());
    setCurrentPage(1); // Reset to first page
  };

  useEffect(() => {
    fetchFolders(false);
  }, []);

  useEffect(() => {
    if (activeFolder) {
      fetchFolderImages(activeFolder, false);
    }
  }, [activeFolder]);

  useEffect(() => {
    setCurrentPage(1); // Reset to page 1 on search or folder change
  }, [searchTerm, activeFolder, itemsPerPage, sortOrder]);

  // Function to calculate dropdown position
  const calculateDropdownPosition = (ref) => {
    if (!ref.current) return false;

    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // If more space above than below, open upward
    return spaceAbove > spaceBelow;
  };

  // Click outside detection for dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        itemsPerPageDropdownRef.current &&
        !itemsPerPageDropdownRef.current.contains(event.target)
      ) {
        setItemsPerPageDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const filteredImages = images.filter(
    (img) =>
      img.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      img.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // --- APPLY SORTING HERE ---
  const sortedImages = getSortedImages(filteredImages);

  // --- PAGINATION LOGIC (Updated to use sortedImages) ---
  const totalPages = Math.ceil(sortedImages.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const displayedImages = sortedImages.slice(startIndex, endIndex);

  return (
    <div className="space-y-6">
      <ScrollToButtons />
      {/* Header */}

      {/* Folder Tabs */}
      {folders.length > 0 && (
        <div className="bg-theme-card rounded-lg border border-theme-border p-3 sm:p-4">
          {/* Header with Controls - Stack on mobile */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-4">
            <h2 className="text-lg sm:text-xl font-semibold text-theme-text flex items-center gap-2">
              <Folder className="w-5 h-5 text-theme-primary" />
              {t("gallery.folders")}
            </h2>

            {/* Controls - wrap on small screens */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Image Size Slider with count badge */}
              <div className="flex flex-col items-center mr-2 relative group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
                    {t("imageSizeSlider.imageSize")}
                  </span>
                  <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-theme-primary text-white text-[10px] font-black shadow-sm shadow-theme-primary/20">
                    {imageSize}
                  </span>
                </div>
                <CompactImageSizeSlider
                  value={imageSize}
                  onChange={setImageSize}
                  storageKey="gallery-poster-size"
                />
              </div>
              {/* Select Mode Toggle */}
              {activeFolder && images.length > 0 && (
                <button
                  onClick={() => {
                    if (selectMode) {
                      cancelSelectMode();
                    } else {
                      setSelectMode(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg ${
                    selectMode
                      ? "bg-orange-600 hover:bg-orange-700"
                      : "bg-theme-primary hover:bg-theme-primary/90"
                  }`}
                >
                  {selectMode ? (
                    <>
                      <Square className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                      <span className="hidden sm:inline">
                        {t("gallery.cancelSelect")}
                      </span>
                      <span className="sm:hidden">
                        {t("gallery.cancelSelect") || "Cancel"}
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                      <span className="hidden sm:inline">
                        {t("gallery.select")}
                      </span>
                      <span className="sm:hidden">{t("gallery.select")}</span>
                    </>
                  )}
                </button>
              )}

              {/* Sorting Dropdown - MOVED INSIDE CONTROL GROUP */}
              <div className="relative" ref={sortDropdownRef}>
                <button
                  onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                  title={t("common.sorting.title")}
                >
                  <ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-theme-primary" />
                  <span className="hidden sm:inline">
                    {sortOrder.includes("date")
                      ? t("common.date")
                      : t("common.name")}
                  </span>
                </button>

                {sortDropdownOpen && (
                  <div className="absolute z-50 right-0 top-full mt-2 w-48 bg-theme-card border border-theme-primary/50 rounded-lg shadow-xl overflow-hidden">
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setSortOrder("name_asc");
                          setSortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          sortOrder === "name_asc"
                            ? "bg-theme-primary/20 text-theme-primary"
                            : "text-theme-text hover:bg-theme-hover"
                        }`}
                      >
                        {t("common.sorting.nameAsc")}
                      </button>
                      <button
                        onClick={() => {
                          setSortOrder("name_desc");
                          setSortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          sortOrder === "name_desc"
                            ? "bg-theme-primary/20 text-theme-primary"
                            : "text-theme-text hover:bg-theme-hover"
                        }`}
                      >
                        {t("common.sorting.nameDesc")}
                      </button>
                      <div className="border-t border-theme-border my-1"></div>
                      <button
                        onClick={() => {
                          setSortOrder("date_newest");
                          setSortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          sortOrder === "date_newest"
                            ? "bg-theme-primary/20 text-theme-primary"
                            : "text-theme-text hover:bg-theme-hover"
                        }`}
                      >
                        {t("common.sorting.dateNewest")}
                      </button>
                      <button
                        onClick={() => {
                          setSortOrder("date_oldest");
                          setSortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          sortOrder === "date_oldest"
                            ? "bg-theme-primary/20 text-theme-primary"
                            : "text-theme-text hover:bg-theme-hover"
                        }`}
                      >
                        {t("common.sorting.dateOldest")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Refresh Button */}
              <button
                onClick={() => {
                  fetchFolders(true);
                  if (activeFolder) {
                    fetchFolderImages(activeFolder, true);
                  }
                }}
                disabled={loading || imagesLoading}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
              >
                <RefreshCw
                  className={`w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-theme-primary ${
                    loading || imagesLoading ? "animate-spin" : ""
                  }`}
                />
                <span className="hidden sm:inline">{t("gallery.refresh")}</span>
              </button>
            </div>
          </div>
          {/* Folder buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {folders
              .filter((folder) => folder.poster_count > 0)
              .map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => setActiveFolder(folder)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap shadow-sm ${
                    activeFolder?.path === folder.path
                      ? "bg-theme-primary text-white scale-105 border-2 border-theme-primary"
                      : "bg-theme-card text-theme-text hover:bg-theme-hover border border-theme hover:border-theme-primary/50 hover:scale-105"
                  }`}
                >
                  <Folder className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate max-w-[120px] sm:max-w-none">
                    {folder.name}
                  </span>
                  <span className="ml-1 px-2 py-0.5 bg-black/20 rounded-full text-xs font-semibold">
                    {folder.poster_count}
                  </span>
                </button>
              ))}
          </div>

          {/* Search bar */}
          {activeFolder && images.length > 0 && (
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder={t("gallery.searchPlaceholder", {
                  folder: activeFolder.name,
                })}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-10 py-3 bg-theme-bg border border-theme-primary/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-theme-muted hover:text-theme-text"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-theme-card rounded-xl border border-theme">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary mb-4" />
          <p className="text-theme-muted">{t("gallery.loadingFolders")}</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/40 rounded-xl p-8 border-2 border-red-600/50 text-center">
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-red-600/20 mb-4">
              <ImageIcon className="w-12 h-12 text-red-400" />
            </div>
            <h3 className="text-2xl font-semibold text-red-300 mb-2">
              {t("gallery.errorLoadingGallery")}
            </h3>
            <p className="text-red-200 text-sm mb-6 max-w-md">{error}</p>
            <button
              onClick={() => {
                fetchFolders(true);
                if (activeFolder) {
                  fetchFolderImages(activeFolder, true);
                }
              }}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-all shadow-lg hover:scale-105"
            >
              <RefreshCw className="w-5 h-5" />
              {t("gallery.tryAgain")}
            </button>
          </div>
        </div>
      ) : !activeFolder ? (
        <div className="bg-theme-card rounded-xl p-12 border border-theme text-center">
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-theme-primary/20 mb-4">
              <Folder className="w-12 h-12 text-theme-primary" />
            </div>
            <h3 className="text-2xl font-semibold text-theme-text mb-2">
              {t("gallery.noFoldersFound")}
            </h3>
            <p className="text-theme-muted max-w-md">
              {t("gallery.noFoldersDescription")}
            </p>
          </div>
        </div>
      ) : imagesLoading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-theme-card rounded-xl border border-theme">
          <Loader2 className="w-12 h-12 animate-spin text-theme-primary mb-4" />
          <p className="text-theme-muted">{t("gallery.loadingPosters")}</p>
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="bg-theme-card rounded-xl p-12 border border-theme text-center">
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-theme-primary/20 mb-4">
              <ImageIcon className="w-12 h-12 text-theme-primary" />
            </div>
            <h3 className="text-2xl font-semibold text-theme-text mb-2">
              {searchTerm
                ? t("gallery.noMatchingPosters")
                : t("gallery.noPostersFound")}
            </h3>
            <p className="text-theme-muted max-w-md">
              {searchTerm
                ? t("gallery.adjustSearch")
                : t("gallery.noPostersInFolder", { folder: activeFolder.name })}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Selection controls - Responsive */}
          {selectMode && (
            <div className="bg-theme-card rounded-xl p-3 sm:p-4 border border-theme-primary">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-theme-card hover:bg-theme-hover border border-theme hover:border-theme-primary/50 rounded-lg text-theme-text text-sm font-medium transition-all shadow-sm"
                  >
                    {selectedImages.length === displayedImages.length ? (
                      <>
                        <Square className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-theme-primary" />
                        <span className="text-sm sm:text-base">
                          {t("gallery.deselectAll")}
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-theme-primary" />
                        <span className="text-sm sm:text-base">
                          {t("gallery.selectAll")}
                        </span>
                      </>
                    )}
                  </button>
                  <span className="text-sm sm:text-base text-theme-text font-medium">
                    {t("gallery.selected", { count: selectedImages.length })}
                  </span>
                </div>
                <button
                  onClick={() => {
                    if (selectedImages.length > 0) {
                      setDeleteConfirm({
                        bulk: true,
                        count: selectedImages.length,
                      });
                    }
                  }}
                  disabled={
                    selectedImages.length === 0 || deletingImage === "bulk"
                  }
                  className="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all"
                >
                  <Trash2
                    className={`w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 ${
                      deletingImage === "bulk" ? "animate-spin" : ""
                    }`}
                  />
                  <span className="text-sm sm:text-base">
                    {t("gallery.deleteSelected", {
                      count: selectedImages.length,
                    })}
                  </span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-theme-card rounded-xl p-4 border border-theme">
            <div className="flex items-center justify-between text-sm">
              <span className="text-theme-text font-medium">
                {t("gallery.showing", {
                  displayed: displayedImages.length,
                  total: filteredImages.length,
                  folder: activeFolder.name,
                })}
              </span>
              {images.length !== filteredImages.length && (
                <span className="text-theme-primary font-semibold">
                  {t("gallery.filteredFrom", { total: images.length })}
                </span>
              )}
            </div>
          </div>

          <div className={`grid ${getGridClass(imageSize)} gap-4`}>
            {displayedImages.map((image, index) => (
              <div
                key={index}
                className={`group relative bg-theme-card rounded-lg border transition-all duration-200 overflow-hidden ${
                  selectMode && selectedImages.includes(image.path)
                    ? "border-theme-primary ring-2 ring-theme-primary"
                    : "border-theme-border hover:border-theme-primary"
                }`}
              >
                {selectMode ? (
                  <>
                    {/* Selection checkbox overlay */}
                    <div
                      className="absolute top-2 left-2 z-10 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleImageSelection(image.path);
                      }}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                          selectedImages.includes(image.path)
                            ? "bg-theme-primary text-white"
                            : "bg-black/50 text-white hover:bg-black/70"
                        }`}
                      >
                        {selectedImages.includes(image.path) ? (
                          <CheckSquare className="w-5 h-5" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </div>
                    </div>

                    <div
                      className="relative cursor-pointer aspect-[2/3] p-2"
                      onClick={() => toggleImageSelection(image.path)}
                    >
                      <img
                        src={`/api/thumbnail?path=${encodeURIComponent(image.url)}&t=${cacheBuster}`}
                        alt={image.name}
                        className="w-full h-full object-cover rounded"
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                      <div
                        className="w-full h-full flex items-center justify-center bg-gray-800 rounded"
                        style={{ display: "none" }}
                      >
                        <ImageIcon className="w-12 h-12 text-theme-primary" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({
                          path: image.path,
                          name: image.name,
                        });
                      }}
                      disabled={deletingImage === image.path}
                      className={`absolute top-2 right-2 z-10 p-2 rounded-lg transition-all shadow-lg backdrop-blur-sm ${
                        deletingImage === image.path
                          ? "bg-theme-muted cursor-not-allowed opacity-70"
                          : "bg-red-600/95 hover:bg-red-700 opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
                      }`}
                      title={t("gallery.deletePoster")}
                    >
                      <Trash2
                        className={`w-4 h-4 text-white ${
                          deletingImage === image.path ? "animate-spin" : ""
                        }`}
                      />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssetToReplace(image);
                        setReplacerOpen(true);
                      }}
                      className="absolute top-2 left-2 z-10 p-2 rounded-lg bg-theme-primary/95 hover:bg-theme-primary opacity-0 group-hover:opacity-100 transition-all shadow-lg backdrop-blur-sm hover:scale-110 active:scale-95"
                      title={t("gallery.replaceAsset")}
                    >
                      <RefreshCw className="w-4 h-4 text-white" />
                    </button>

                    <div
                      className="relative cursor-pointer aspect-[2/3] p-2"
                      onClick={() => setSelectedImage(image)}
                    >
                      <img
                        src={`/api/thumbnail?path=${encodeURIComponent(image.url)}&t=${cacheBuster}`}
                        alt={image.name}
                        className="w-full h-full object-cover rounded"
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                      <div
                        className="w-full h-full flex items-center justify-center bg-gray-800 rounded"
                        style={{ display: "none" }}
                      >
                        <ImageIcon className="w-12 h-12 text-theme-primary" />
                      </div>
                    </div>
                  </>
                )}

                <div className="p-3 border-t border-theme-border bg-theme-card">
                  <p
                    className="text-sm text-theme-text truncate"
                    title={formatDisplayPath(image.path)}
                  >
                    {image.path.split(/[\\/]/).slice(-2, -1)[0] || image.name}
                  </p>
                  <p className="text-xs text-theme-muted mt-1">
                    {(image.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* --- PAGINATION AND ITEMS PER PAGE --- */}
          {filteredImages.length > 25 && (
            <div className="mt-8 space-y-6">
              {/* Items per page selector */}
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-theme-card border border-theme-border rounded-xl shadow-md">
                  <label className="text-sm font-medium text-theme-text">
                    {t("gallery.itemsPerPage")}:
                  </label>
                  <div className="relative" ref={itemsPerPageDropdownRef}>
                    <button
                      onClick={() => {
                        const shouldOpenUp = calculateDropdownPosition(
                          itemsPerPageDropdownRef
                        );
                        setItemsPerPageDropdownUp(shouldOpenUp);
                        setItemsPerPageDropdownOpen(!itemsPerPageDropdownOpen);
                      }}
                      className="px-4 py-2 bg-theme-bg text-theme-text border border-theme-border rounded-lg text-sm font-semibold hover:bg-theme-hover hover:border-theme-primary/50 focus:outline-none focus:ring-2 focus:ring-theme-primary transition-all cursor-pointer shadow-sm flex items-center gap-2"
                    >
                      <span>{itemsPerPage}</span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                          itemsPerPageDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {itemsPerPageDropdownOpen && (
                      <div
                        className={`absolute z-50 right-0 ${
                          itemsPerPageDropdownUp
                            ? "bottom-full mb-2"
                            : "top-full mt-2"
                        } bg-theme-card border border-theme-primary rounded-lg shadow-xl overflow-hidden min-w-[80px] max-h-60 overflow-y-auto`}
                      >
                        {[25, 50, 100, 200, 500].map((value) => (
                          <button
                            key={value}
                            onClick={() => {
                              handleItemsPerPageChange(value);
                              setItemsPerPageDropdownOpen(false);
                            }}
                            className={`w-full px-4 py-2 text-sm transition-all text-center ${
                              itemsPerPage === value
                                ? "bg-theme-primary text-white"
                                : "text-theme-text hover:bg-theme-hover hover:text-theme-primary"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Pagination controls */}
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={(page) => {
                  setCurrentPage(page);
                  // You can add scroll-to-top logic here if desired
                }}
              />
            </div>
          )}
          {/* --- END OF PAGINATION --- */}
        </>
      )}

      {/* Image Preview Modal */}
      <ImagePreviewModal
        selectedImage={selectedImage}
        onClose={() => setSelectedImage(null)}
        onDelete={(image) => {
          setDeleteConfirm({
            path: image.path,
            name: image.name,
          });
        }}
        onReplace={(image) => {
          setAssetToReplace(image);
          setReplacerOpen(true);
        }}
        isDeleting={deletingImage === selectedImage?.path}
        cacheBuster={cacheBuster}
        formatDisplayPath={formatDisplayPath}
        formatTimestamp={formatTimestamp}
        getMediaType={getMediaType}
        getTypeColor={getTypeColor}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            if (deleteConfirm.bulk) {
              bulkDeletePosters();
            } else {
              deletePoster(deleteConfirm.path, deleteConfirm.name);
            }
            setDeleteConfirm(null);
          }
        }}
        title={
          deleteConfirm?.bulk
            ? t("gallery.deleteMultipleTitle")
            : t("gallery.deletePosterTitle")
        }
        message={
          deleteConfirm?.bulk
            ? t("gallery.deleteMultipleMessage", { count: deleteConfirm.count })
            : t("gallery.deletePosterMessage")
        }
        itemName={deleteConfirm?.bulk ? undefined : deleteConfirm?.name}
        confirmText={t("gallery.deleteButton")}
        type="danger"
      />

      {/* Asset Replacer Modal */}
      {replacerOpen && assetToReplace && (
        <AssetReplacer
          asset={assetToReplace}
          onClose={() => {
            setReplacerOpen(false);
            setAssetToReplace(null);
          }}
          onSuccess={() => {
            // Force cache refresh by updating timestamp
            setCacheBuster(Date.now());

            // Update selectedImage if it's still open
            if (selectedImage && assetToReplace) {
              setSelectedImage({
                ...selectedImage,
                url: `${selectedImage.url.split("?")[0]}?t=${Date.now()}`,
              });
            }

            // Refresh the images, passing 'true' for keepScrollPosition
            setTimeout(() => {
              fetchFolderImages(activeFolder, false, true);
            }, 500);
            showSuccess(t("gallery.assetReplaced"));
          }}
        />
      )}
    </div>
  );
}

export default Gallery;
