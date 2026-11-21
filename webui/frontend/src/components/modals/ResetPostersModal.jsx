import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, X, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import SiloSupportNotice from "../SiloSupportNotice";

const API_URL = "/api";
const ALLOWED_LIBRARY_TYPES = new Set([
  "movie",
  "movies",
  "show",
  "shows",
  "series",
  "tvshows",
  "tvshow",
]);

const ResetPostersModal = React.memo(
  ({
    show,
    onClose,
    onStart,
    loading,
    status,
    serverType = "plex",
    siloEnabled = false,
  }) => {
    const { t } = useTranslation();
    const [libraries, setLibraries] = useState([]);
    const [loadingLibraries, setLoadingLibraries] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [selectedLibrary, setSelectedLibrary] = useState("");

    const fetchServerLibraries = useCallback(
      async (forceRefresh = false) => {
        setLoadingLibraries(true);
        setLoadError("");
        try {
          const response = await fetch(
            `${API_URL}/libraries/${encodeURIComponent(
              serverType
            )}/cached?refresh=${forceRefresh ? "true" : "false"}`
          );
          const data = await response.json();

          if (response.ok && data.success) {
            const unique = new Map();
            for (const item of data.libraries || []) {
              const name = String(item?.name || "").trim();
              const libType = String(item?.type || "").trim();
              if (!ALLOWED_LIBRARY_TYPES.has(libType.toLowerCase())) {
                continue;
              }
              if (name && !unique.has(name)) {
                unique.set(name, {
                  name,
                  type: libType,
                });
              }
            }
            const sorted = Array.from(unique.values()).sort((a, b) =>
              a.name.localeCompare(b.name)
            );
            setLibraries(sorted);
            setSelectedLibrary((prev) =>
              prev && sorted.some((lib) => lib.name === prev) ? prev : ""
            );
          } else {
            setLibraries([]);
            setSelectedLibrary("");
            setLoadError(data.error || t("runModes.reset.noLibrariesFound"));
          }
        } catch (error) {
          setLibraries([]);
          setSelectedLibrary("");
          setLoadError(error.message || t("runModes.reset.noLibrariesFound"));
        } finally {
          setLoadingLibraries(false);
        }
      },
      [serverType, t]
    );

    useEffect(() => {
      if (show) {
        setSelectedLibrary("");
        setLoadError("");
        fetchServerLibraries(false);
      }
    }, [show, fetchServerLibraries]);

    if (!show) return null;

    const handleSubmit = (e) => {
      e.preventDefault();
      if (!selectedLibrary || loading || status?.running || loadingLibraries) {
        return;
      }
      onStart(selectedLibrary);
    };

    return (
      <div
        className="app-dialog-backdrop fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overscroll-contain"
        onClick={onClose}
      >
        <div
          className="app-dialog-panel bg-theme-card border border-red-500/60 rounded-xl max-w-lg w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col shadow-2xl animate-in fade-in duration-200 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-red-700 px-4 sm:px-6 py-3 sm:py-4 rounded-t-xl flex items-center justify-between shrink-0">
            <div className="flex items-center">
              <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6 mr-2 sm:mr-3 text-white" />
              <h3 className="text-lg sm:text-xl font-bold text-white">
                {t("runModes.reset.title")}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white transition-all p-1 hover:bg-white/10 rounded"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="p-4 sm:p-6 space-y-4 flex-1 overflow-y-auto min-h-0 overscroll-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <p className="text-sm text-theme-muted">
              {t("runModes.reset.description")}
            </p>

            <SiloSupportNotice enabled={siloEnabled} scope="reset" />

            <div className="bg-red-900/20 border-l-4 border-red-500 p-4 rounded">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-400 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-200">
                  <p className="font-semibold mb-1">
                    {t("runModes.reset.warning")}
                  </p>
                  <p>{t("runModes.reset.warningText")}</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text mb-2">
                {t("runModes.reset.selectLibrary")}{" "}
                <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedLibrary}
                  onChange={(e) => setSelectedLibrary(e.target.value)}
                  disabled={loading || status?.running || loadingLibraries}
                  className="flex-1 min-w-0 px-3 py-2.5 bg-theme-bg border border-red-500/40 rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {loadingLibraries
                      ? t("runModes.reset.loadingLibraries")
                      : t("runModes.reset.selectLibraryPlaceholder")}
                  </option>
                  {libraries.map((lib) => (
                    <option key={lib.name} value={lib.name}>
                      {lib.type ? `${lib.name} (${lib.type})` : lib.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => fetchServerLibraries(true)}
                  disabled={loading || status?.running || loadingLibraries}
                  title={t("runModes.reset.refreshLibraries")}
                  aria-label={t("runModes.reset.refreshLibraries")}
                  className="px-3 py-2.5 bg-theme-hover hover:bg-red-500/15 text-theme-text border border-theme hover:border-red-500/50 rounded-lg transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      loadingLibraries ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </div>
              {!loadingLibraries && libraries.length === 0 && (
                <p className="mt-2 text-xs text-red-300">
                  {loadError || t("runModes.reset.noLibrariesFound")}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-theme">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-theme-hover hover:bg-theme-bg text-theme-text border border-theme rounded-lg transition-all"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  loading ||
                  status?.running ||
                  loadingLibraries ||
                  !selectedLibrary
                }
                className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded-lg font-medium transition-all border border-red-600 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                {t("runModes.reset.button")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }
);

export default ResetPostersModal;
