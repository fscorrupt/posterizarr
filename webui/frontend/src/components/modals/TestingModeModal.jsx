import React from "react";
import { TestTube, X, ExternalLink, FolderOpen, Play, RotateCcw } from "lucide-react";

/**
 * TestingModeModal
 * Confirmation and description modal before triggering Testing Mode run,
 * featuring a prominent link to the Test Gallery (/test-gallery) and redirect options.
 */
const TestingModeModal = React.memo(({
  show,
  onClose,
  onStart,
  onStartAndGoToGallery,
  autoRedirect,
  setAutoRedirect,
  loading,
  status,
  t,
  navigate,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-theme-card border border-theme-primary rounded-xl max-w-2xl w-full shadow-2xl animate-in fade-in duration-200">
        {/* Header */}
        <div className="bg-theme-primary px-6 py-4 rounded-t-xl flex items-center justify-between">
          <div className="flex items-center">
            <TestTube className="w-6 h-6 mr-3 text-white" />
            <h3 className="text-xl font-bold text-white">
              {t("runModes.testing.title", "Testing Mode")}
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
          {/* Main Info */}
          <div className="bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded">
            <p className="text-blue-200 font-medium mb-1">
              {t("runModes.testing.info", "Safe Preview Run (No Server Uploads)")}
            </p>
            <p className="text-blue-100 text-sm">
              {t(
                "runModes.testing.description",
                "Generates sample posters and artwork according to your rules and configuration without modifying your media server or applying images to your libraries. Ideal for safely testing fonts, borders, overlays, and blueprints."
              )}
            </p>
          </div>

          {/* Asset Destination Highlight Box */}
          <div className="bg-theme-bg/80 border border-blue-500/40 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm sm:text-base">
                <FolderOpen className="w-5 h-5 text-blue-400" />
                <span>{t("runModes.testing.assetLocationTitle", "Where created assets will land")}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/test-gallery");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-lg transition-colors cursor-pointer"
              >
                <span>{t("runModes.testing.openGalleryBtn", "Open Test Gallery")}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm text-theme-muted leading-relaxed">
              {t(
                "runModes.testing.assetLocationText",
                "All sample posters, backgrounds, and season cards generated during testing are saved to your test folder and appear directly in the"
              )}{" "}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/test-gallery");
                }}
                className="text-blue-400 hover:underline font-medium inline-flex items-center gap-1"
              >
                {t("nav.testGallery", "Test Gallery")} (/test-gallery)
              </button>
              .
            </p>
          </div>

          {/* How Testing Mode Works */}
          <div className="space-y-3">
            <h4 className="font-semibold text-theme-primary text-base">
              {t("runModes.testing.howItWorks", "How Testing Mode works:")}
            </h4>
            <ul className="space-y-2.5 text-theme-text text-sm">
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-5 h-5 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">
                  1
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.testing.step1Title", "Sample Processing")}
                  </strong>
                  <p className="text-xs text-theme-muted mt-0.5">
                    {t(
                      "runModes.testing.step1Text",
                      "Processes a test subset of items using your active settings, overlays, borders, and blueprints."
                    )}
                  </p>
                </div>
              </li>
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-5 h-5 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">
                  2
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.testing.step2Title", "No Media Server Changes")}
                  </strong>
                  <p className="text-xs text-theme-muted mt-0.5">
                    {t(
                      "runModes.testing.step2Text",
                      "Posters are never uploaded or synced to your live Plex, Jellyfin, or Emby servers during test runs."
                    )}
                  </p>
                </div>
              </li>
              <li className="flex">
                <span className="bg-theme-primary text-white rounded-full w-5 h-5 flex items-center justify-center mr-3 flex-shrink-0 text-xs font-bold">
                  3
                </span>
                <div>
                  <strong className="text-theme-primary">
                    {t("runModes.testing.step3Title", "Saved to Test Assets")}
                  </strong>
                  <p className="text-xs text-theme-muted mt-0.5">
                    {t(
                      "runModes.testing.step3Text",
                      "All created assets land in your local test folder, completely isolated from production libraries."
                    )}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          {/* Auto-redirect Toggle Option */}
          <div
            onClick={() => setAutoRedirect(!autoRedirect)}
            className="flex items-center justify-between p-3.5 bg-theme-bg/60 border border-theme rounded-xl hover:border-theme-primary/50 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg transition-colors ${
                  autoRedirect
                    ? "bg-theme-primary text-white"
                    : "bg-theme-primary/10 text-theme-muted"
                }`}
              >
                <RotateCcw className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-medium text-theme-text block">
                  {t(
                    "runModes.testing.autoRedirect",
                    "Redirect to Test Gallery after test run finishes"
                  )}
                </span>
                <span className="text-xs text-theme-muted block">
                  {t(
                    "runModes.testing.autoRedirectDesc",
                    "Watches the test run in the log viewer and automatically navigates to /test-gallery once complete."
                  )}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoRedirect}
              onChange={() => {}}
              className="w-4 h-4 rounded text-theme-primary focus:ring-theme-primary focus:ring-offset-theme-bg pointer-events-none"
            />
          </div>

          <div className="pt-2 border-t-2 border-theme">
            <a
              href="https://fscorrupt.github.io/posterizarr/modes/#test-mode"
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
          <button
            onClick={onClose}
            className="px-5 py-2 bg-theme-card hover:bg-theme-hover border border-theme rounded-lg font-medium transition-all text-theme-text text-sm"
          >
            {t("runModes.testing.cancel", "Cancel")}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onStartAndGoToGallery}
              disabled={loading || status.running}
              className="px-4 py-2 bg-theme-card hover:bg-theme-hover border border-blue-500/40 hover:border-blue-400 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg font-medium transition-all text-blue-400 hover:text-blue-300 text-sm flex items-center shadow-sm"
              title="Start test mode and immediately navigate to Test Gallery"
            >
              <TestTube className="w-4 h-4 mr-1.5" />
              {t("runModes.testing.startAndGoToGallery", "Start & Go to Gallery")}
            </button>
            <button
              onClick={() => onStart({ autoRedirect })}
              disabled={loading || status.running}
              className="px-5 py-2 bg-theme-primary hover:bg-theme-primary/90 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-all text-white text-sm flex items-center shadow-lg"
            >
              <Play className="w-4 h-4 mr-1.5" />
              {t("runModes.testing.start", "Start Test Run")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TestingModeModal;
