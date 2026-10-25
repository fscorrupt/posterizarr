import React, { useState, useEffect, useMemo } from "react";
import { X, RefreshCw, Loader2, AlertCircle, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

const LibraryExclusionSelector = ({
  value = [],
  onChange,
  label,
  helpText,
  mediaServerType, // 'plex', 'jellyfin', or 'emby'
  config, // Full config object to get connection details
  disabled = false, // New prop for disabled state
  showIncluded = false, // New prop to show included libraries section
  inlineMode = false,
  autoFetchTrigger = false,
  onValidStateChange = null,
}) => {
  const { t } = useTranslation();

  const [excludedLibraries, setExcludedLibraries] = useState([]);
  const [availableLibraries, setAvailableLibraries] = useState([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [error, setError] = useState(null);
  const [librariesFetched, setLibrariesFetched] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Separate state for DB-cached data (shown in boxes)
  const [cachedLibraries, setCachedLibraries] = useState([]);
  const [cachedExclusions, setCachedExclusions] = useState([]);

  // Create a Set of all valid library names from the server list
  const validLibraryNames = React.useMemo(() => {
    return new Set(cachedLibraries.map((lib) => lib.name));
  }, [cachedLibraries]);

  // Create a *filtered* list of exclusions
  // This list only contains libraries that are BOTH in the exclusion list AND on the server
  const validExclusions = React.useMemo(() => {
    // We use cachedExclusions as it's the source for the summary boxes
    return cachedExclusions.filter((name) => validLibraryNames.has(name));
  }, [cachedExclusions, validLibraryNames]);

  // Create the *filtered* list of included libraries
  const validIncluded = React.useMemo(() => {
    const exclusionSet = new Set(validExclusions);
    return cachedLibraries.filter((lib) => !exclusionSet.has(lib.name));
  }, [cachedLibraries, validExclusions]);

  const excludedCount = validExclusions.length;
  const includedCount = validIncluded.length;



  useEffect(() => {
    if (onValidStateChange) {
      onValidStateChange(includedCount > 0);
    }
  }, [includedCount, onValidStateChange]);

  // Initialize from value prop
  useEffect(() => {
    if (Array.isArray(value) && value.length > 0) {
      setExcludedLibraries(value);
    }
  }, [value]);

  useEffect(() => {
    if (autoFetchTrigger && !disabled && !librariesFetched && !loadingLibraries) {
      fetchLibraries();
    }
  }, [autoFetchTrigger, disabled, librariesFetched, loadingLibraries]);

  // Load ONLY exclusion/inclusion info from DB (not for fetching)
  useEffect(() => {
    if (!disabled) {
      loadCachedExclusionsForDisplay();
    } else {
      // Clear out if it becomes disabled (e.g., token removed)
      setCachedLibraries([]);
      setAvailableLibraries([]);
      setLibrariesFetched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaServerType, disabled]); // Re-run if server type or disabled status changes

  const loadCachedExclusionsForDisplay = async () => {
    try {
      const response = await fetch(`/api/libraries/${mediaServerType}/cached`);
      const data = await response.json();

      if (data.success) {
        // Store cached libraries for display
        if (data.libraries && data.libraries.length > 0) {
          setCachedLibraries(data.libraries);
        }

        // Trust the 'value' prop (from the main config) as the source of truth
        const exclusions =
          Array.isArray(value) && value.length > 0
            ? value
            : data.excluded || []; // Fallback to DB cache if 'value' is empty

        setCachedExclusions(exclusions);
        setExcludedLibraries(exclusions);

        // Only call onChange if the DB/value is different from current state
        if (JSON.stringify(exclusions) !== JSON.stringify(value)) {
          onChange(exclusions);
        }
      }
    } catch (err) {
      console.log("No cached data in database, using config 'value'");
      // If DB query fails, just use the 'value' prop from the config
      if (Array.isArray(value)) {
        setCachedExclusions(value);
      }
    }
  };

  const getMediaServerConfig = () => {
    if (!config) return null;

    if (mediaServerType === "plex") {
      return {
        url: config.PlexPart?.PlexUrl || config.PlexUrl,
        token: config.ApiPart?.PlexToken || config.PlexToken,
      };
    } else if (mediaServerType === "jellyfin") {
      return {
        url: config.JellyfinPart?.JellyfinUrl || config.JellyfinUrl,
        api_key: config.ApiPart?.JellyfinAPIKey || config.JellyfinAPIKey,
      };
    } else if (mediaServerType === "emby") {
      return {
        url: config.EmbyPart?.EmbyUrl || config.EmbyUrl,
        api_key: config.ApiPart?.EmbyAPIKey || config.EmbyAPIKey,
      };
    }
    return null;
  };

  const fetchLibraries = async () => {
    setLoadingLibraries(true);
    setError(null);

    const serverConfig = getMediaServerConfig();
    if (!serverConfig) {
      setError(t("libraryExclusion.configNotFound"));
      setLoadingLibraries(false);
      return;
    }

    try {
      // Get the current stale list *from state*. (e.g., your 14 libraries)
      // This state was populated on load by loadCachedExclusionsForDisplay
      const staleExclusions = cachedExclusions;

      // Then fetch fresh libraries from server
      const endpoint = `/api/libraries/${mediaServerType}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serverConfig),
      });

      const data = await response.json();

      if (data.success && data.libraries) {
        const allFetchedLibraries = data.libraries; // Full list (e.g., 12 libs)

        // Prune the stale list (14 items) against the fresh list (12 items)
        const freshLibraryNames = new Set(allFetchedLibraries.map(lib => lib.name));
        // This creates the list of 10 valid exclusions
        const validExclusions = staleExclusions.filter(name => freshLibraryNames.has(name));

        // Set the UI list to show ALL fetched libraries
        setAvailableLibraries(allFetchedLibraries);
        setLibrariesFetched(true);
        setError(null);

        // Set the exclusion state to the *pruned, valid* list (10 items)
        setExcludedLibraries(validExclusions);
        // Send the pruned list back to the config
        onChange(validExclusions);

        // Update the summary boxes
        setCachedLibraries(allFetchedLibraries); // Full list (12)
        setCachedExclusions(validExclusions); // Pruned list (10)

      } else {
        setError(data.error || t("libraryExclusion.fetchFailed"));
        setAvailableLibraries([]);
      }
    } catch (err) {
      setError(t("libraryExclusion.fetchError", { message: err.message }));
      setAvailableLibraries([]);
    } finally {
      setLoadingLibraries(false);
    }
  };

  const toggleLibrary = (libraryName) => {
    // Removed 'async'
    let newExcluded;
    if (excludedLibraries.includes(libraryName)) {
      // Remove from excluded (include it)
      newExcluded = excludedLibraries.filter((name) => name !== libraryName);
    } else {
      // Add to excluded
      newExcluded = [...excludedLibraries, libraryName];
    }
    setExcludedLibraries(newExcluded);
    setCachedExclusions(newExcluded); // Update cached state for summary boxes
    onChange(newExcluded); // Update the main config
  };

  // THIS FUNCTION CAN BE DELETED, but is left for safety. It is not called.
  const updateExclusionsInDB = async (excluded) => {
    try {
      await fetch(`/api/libraries/${mediaServerType}/exclusions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ excluded_libraries: excluded }),
      });

      // Reload cached data for display boxes
      await loadCachedExclusionsForDisplay();
    } catch (err) {
      console.error("Failed to update exclusions in database:", err);
    }
  };

  const clearAll = () => {
    // Removed 'async'
    setExcludedLibraries([]);
    setCachedExclusions([]);
    onChange([]);
  };

  const excludeAll = () => {
    // Removed 'async'
    const allLibraryNames = availableLibraries.map((lib) => lib.name);
    setExcludedLibraries(allLibraryNames);
    setCachedExclusions(allLibraryNames);
    onChange(allLibraryNames);
  };

  const getLibraryTypeIcon = (type) => {
    if (type === "movie" || type === "movies") {
      return "🎬"; // Movie
    } else if (type === "show" || type === "tvshows") {
      return "📺"; // TV Show
    } else if (type === "music") {
      return "🎵"; // Music
    } else if (type === "photo" || type === "photos") {
      return "📸"; // Photo
    } else if (type === "audiobook" || type === "audiobooks") {
      return "🎧"; // Audiobook
    } else if (type === "book" || type === "books") {
      return "📖"; // Book
    }
    // Plex uses 'artist' for music/audiobooks, but the backend is filtering them.
    // If the backend ever sends them, this will try to show an icon.
    else if (type === "artist") {
      return "🎤"; // Artist (fallback for music/audiobooks)
    }
    return "📁"; // Fallback for any other type
  };

  const renderListContent = () => (
    <div className="flex flex-col h-full">
      {/* Fetch Libraries Button */}
      <div className="flex flex-wrap gap-2 mb-4 shrink-0">
        <button
          onClick={fetchLibraries}
          disabled={loadingLibraries || disabled}
          className={`flex items-center gap-2 px-3 py-1.5 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary border border-theme-primary/20 rounded-md font-medium transition-all text-xs ${
            loadingLibraries || disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loadingLibraries ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          <span>
            {librariesFetched
              ? t("libraryExclusion.refreshLibraries")
              : t("libraryExclusion.fetchLibraries")}
          </span>
        </button>

        {librariesFetched && availableLibraries.length > 0 && !disabled && (
          <>
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-bg/50 hover:bg-theme-hover border border-theme/50 rounded-md font-medium transition-all text-xs text-white"
            >
              <Check className="w-3.5 h-3.5 text-green-400" />
              Include All
            </button>
            <button
              onClick={excludeAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-bg/50 hover:bg-theme-hover border border-theme/50 rounded-md font-medium transition-all text-xs text-white"
            >
              <X className="w-3.5 h-3.5 text-red-400" />
              Exclude All
            </button>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md mb-4 shrink-0">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-red-400 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loadingLibraries && (
        <div className="flex items-center justify-center py-6 bg-theme-bg/30 border border-theme/20 rounded-md flex-1">
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin text-theme-primary mx-auto mb-2" />
            <p className="text-xs text-theme-muted">{t("onboarding.fetchingLibraries") || "Fetching libraries..."}</p>
          </div>
        </div>
      )}

      {/* Empty State - No Libraries Fetched */}
      {!loadingLibraries && !librariesFetched && (
        <div className="flex items-center justify-center p-6 border-2 border-dashed border-theme-border/30 rounded-lg text-center flex-1">
          <p className="text-xs text-theme-muted">
            {t("onboarding.testConnectionToLoad") || "Test connection to load libraries."}
          </p>
        </div>
      )}

      {/* Libraries List */}
      {!loadingLibraries && librariesFetched && availableLibraries.length > 0 && (
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-theme-border scrollbar-track-transparent pr-2 space-y-1.5">
          {availableLibraries.map((library) => {
            const isExcluded = excludedLibraries.includes(library.name);
            return (
              <div
                key={library.name}
                onClick={() => !disabled && toggleLibrary(library.name)}
                className={`flex items-center justify-between p-2 rounded-lg transition-all cursor-pointer ${
                  disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-theme-bg-dark/50"
                } ${isExcluded ? "bg-theme-bg-dark/20 text-theme-muted" : "bg-theme-bg-dark/40"}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base flex-shrink-0">
                    {getLibraryTypeIcon(library.type)}
                  </span>
                  <div className="flex flex-col">
                    <span className={`text-sm font-medium truncate ${isExcluded ? "text-theme-muted" : "text-white"}`}>
                      {library.name}
                    </span>
                    <span className="text-[10px] text-theme-muted uppercase tracking-wider">
                      {library.type}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {isExcluded ? (
                    <div className="w-5 h-5 rounded-full border-2 border-theme-muted flex items-center justify-center">
                      <div className="w-2.5 h-0.5 bg-theme-muted rounded-full"></div>
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-theme-primary flex items-center justify-center text-black">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State - No Libraries Found */}
      {!loadingLibraries && librariesFetched && availableLibraries.length === 0 && !error && (
        <div className="px-4 py-8 bg-theme-bg/30 border border-theme/20 rounded-md text-center flex-1">
          <p className="text-sm text-theme-muted">{t("onboarding.noLibrariesFound") || "No libraries found."}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col h-full ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {label && !inlineMode && (
        <label className="block text-sm font-medium text-theme-text mb-3">
          {label}
        </label>
      )}

      {inlineMode ? (
        <div className="flex-1 bg-theme-bg/10 rounded-xl p-3 flex flex-col h-full min-h-[150px]">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <div>
              <h4 className="text-sm font-semibold text-white">{t("onboarding.selectLibraries") || "Select Libraries"}</h4>
              {helpText && <p className="text-[11px] text-theme-muted">{helpText}</p>}
            </div>
            <div className="text-xs px-2 py-1 bg-theme-bg rounded-md text-theme-muted">
              {includedCount} {t("onboarding.included") || "Included"}
            </div>
          </div>
          {renderListContent()}
        </div>
      ) : (
        <>
          {/* Inline Summary View */}
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center bg-theme-bg/30 p-4 border border-theme rounded-lg">
              <div>
                <h4 className="text-white font-medium">{t("libraryExclusion.manageLibraries") || "Manage Libraries"}</h4>
                <p className="text-sm text-theme-muted">{t("libraryExclusion.manageHelp") || "Select which libraries to include or exclude from processing."}</p>
              </div>
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={disabled}
                className="px-4 py-2 bg-theme-primary/20 hover:bg-theme-primary/30 text-theme-primary border border-theme-primary/30 rounded-lg font-medium transition-all"
              >
                {t("libraryExclusion.openManager") || "Manage Selection"}
              </button>
            </div>
          </div>

          {/* Excluded and Included Libraries */}
          <div>
            <div className="grid grid-cols-2 gap-6">
              {/* Excluded Libraries */}
              <div className="px-4 py-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400/80 font-medium mb-2">
                  {t("libraryExclusion.excludedCount", {
                    count: excludedCount,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {validExclusions.length > 0 ? (
                    validExclusions.map((libName) => (
                      <span
                        key={libName}
                        className="max-w-full min-w-0 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-sm border border-red-500/30 flex items-center gap-1.5 [overflow-wrap:anywhere]"
                      >
                        <X className="w-3 h-3" />
                        {libName}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-theme-muted italic">
                      {t("libraryExclusion.noneExcluded")}
                    </span>
                  )}
                </div>
              </div>

              {/* Included Libraries */}
              <div className="px-4 py-3 bg-green-500/5 border border-green-500/20 rounded-lg">
                <p className="text-xs text-green-400/80 font-medium mb-2">
                  {t("libraryExclusion.includedCount", {
                    count: includedCount,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {includedCount > 0 ? (
                    validIncluded.map((lib) => (
                      <span
                        key={lib.name}
                        className="max-w-full min-w-0 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm border border-green-500/30 flex items-center gap-1.5 [overflow-wrap:anywhere]"
                      >
                        <Check className="w-3 h-3" />
                        {lib.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-theme-muted italic">
                      {cachedLibraries.length === 0
                        ? t("libraryExclusion.noneExcluded")
                        : t("libraryExclusion.allExcluded")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Help Text */}
          {helpText && <p className="text-xs text-theme-muted">{helpText}</p>}
        </>
      )}

      {/* The Modal */}
      {isModalOpen && !inlineMode && (
        <div className="app-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setIsModalOpen(false)}>
          <div className="app-dialog-panel bg-theme-card border border-theme rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-theme flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-theme-text">
                {t("libraryExclusion.manageLibraries") || "Manage Libraries"} - {mediaServerType.toUpperCase()}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-theme-hover rounded-full transition-colors">
                <X className="w-5 h-5 text-theme-muted hover:text-white" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-4">
              {/* Disabled Message */}
              {disabled && (
                <div className="flex items-start gap-3 px-4 py-3 bg-theme-muted/10 border border-theme rounded-lg">
                  <AlertCircle className="w-5 h-5 text-theme-muted flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-theme-muted font-medium">
                      {t("libraryExclusion.disabled")}
                    </p>
                    <p className="text-xs text-theme-muted/80 mt-1">
                      {t("libraryExclusion.disabledHint", {
                        server:
                          mediaServerType.charAt(0).toUpperCase() +
                          mediaServerType.slice(1),
                      })}
                    </p>
                  </div>
                </div>
              )}

              {renderListContent()}
            </div>

            <div className="p-4 border-t border-theme shrink-0 flex justify-end bg-theme-bg/50 rounded-b-xl">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2 bg-theme-primary text-black font-semibold rounded-lg hover:bg-theme-primary/90 transition-colors shadow-lg"
              >
                {t("common.done") || "Done"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryExclusionSelector;
