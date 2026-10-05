import React from "react";
import { Play, X, ExternalLink } from "lucide-react";

/**
 * NormalModeModal
 * Confirmation and description modal before triggering Normal Mode run
 */
const NormalModeModal = React.memo(({ show, onClose, onStart, loading, status, t }) => {
  const [dontShowAgain, setDontShowAgain] = React.useState(false);

  React.useEffect(() => {
    if (show) {
      setDontShowAgain(false);
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-theme-card border border-theme-primary rounded-xl max-w-2xl w-full shadow-2xl animate-in fade-in duration-200">
        {/* Header */}
        <div className="bg-theme-primary px-6 py-4 rounded-t-xl flex items-center justify-between">
          <div className="flex items-center">
            <Play className="w-6 h-6 mr-3 text-white" />
            <h3 className="text-xl font-bold text-white">
              {t("runModes.normal.title", "Normal Mode")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-all p-1 hover:bg-white/10 rounded"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-theme-primary/10 border-l-4 border-theme-primary p-4 rounded">
            <p className="text-theme-primary font-medium mb-1">
              {t("runModes.normal.info", "Run Posterizarr across configured media libraries")}
            </p>
            <p className="text-theme-muted text-sm">
              {t(
                "runModes.normal.description",
                "This mode processes your movies, TV shows, and seasons based on your configuration and custom blueprints. It generates artwork and uploads directly to your media server."
              )}
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-theme-primary text-lg">
              {t("runModes.normal.howItWorks", "How Normal Mode works:")}
            </h4>
            <ul className="space-y-3 text-theme-text">
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm font-bold">
                  1
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.normal.step1Title", "Media Library Scan")}
                  </strong>
                  <p className="text-sm text-theme-muted mt-1">
                    {t(
                      "runModes.normal.step1Text",
                      "Scans configured libraries (Plex, Jellyfin, Emby) for media items requiring artwork updates."
                    )}
                  </p>
                </div>
              </li>
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm font-bold">
                  2
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.normal.step2Title", "Artwork & Overlay Processing")}
                  </strong>
                  <p className="text-sm text-theme-muted mt-1">
                    {t(
                      "runModes.normal.step2Text",
                      "Fetches source images, applies your configured borders, overlays, gradients, and custom blueprints."
                    )}
                  </p>
                </div>
              </li>
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 text-sm font-bold">
                  3
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.normal.step3Title", "Server Sync & Local Backups")}
                  </strong>
                  <p className="text-sm text-theme-muted mt-1">
                    {t(
                      "runModes.normal.step3Text",
                      "Sets the generated artwork on your media server and stores local backups if enabled in settings."
                    )}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div className="bg-blue-900/20 border-l-4 border-blue-500 p-3 rounded">
            <p className="text-blue-200 text-sm">
              {t(
                "runModes.normal.tip",
                "Tip: Review your configuration and active blueprints before starting a normal run."
              )}
            </p>
          </div>

          <div className="pt-2 border-t-2 border-theme">
            <a
              href="https://fscorrupt.github.io/posterizarr/modes/#normal-mode"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center px-6 py-2.5 bg-theme-bg hover:bg-theme-hover border border-theme rounded-lg font-medium transition-all text-theme-text shadow-sm text-sm"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              {t("runModes.viewDocumentation", "View Full Documentation")}
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-theme-bg px-6 py-4 rounded-b-xl flex flex-wrap items-center justify-between gap-3 border-t-2 border-theme">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-theme-muted hover:text-theme-text transition-colors">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-theme text-theme-primary focus:ring-theme-primary focus:ring-offset-theme-bg cursor-pointer"
            />
            <span>{t("common.dontShowAgain", "Don't show this again")}</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-theme-card hover:bg-theme-hover border border-theme rounded-lg font-medium transition-all text-theme-text text-sm"
            >
              {t("runModes.normal.cancel", "Cancel")}
            </button>
            <button
              onClick={() => onStart({ dontShowAgain })}
              disabled={loading || status.running}
              className="px-6 py-2 bg-theme-primary hover:bg-theme-primary/90 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-all text-white flex items-center shadow-lg text-sm"
            >
              <Play className="w-4 h-4 mr-2" />
              {t("runModes.normal.start", "Start Normal Run")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default NormalModeModal;
