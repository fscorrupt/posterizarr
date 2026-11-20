import React, { useEffect } from "react";
import { Sparkles, X, ExternalLink, History, CheckCircle2, Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "./MarkdownRenderer";

function formatPublishedDate(publishedAt) {
  if (!publishedAt) return "";
  try {
    const date = new Date(publishedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function WhatsNewModal({
  isOpen,
  release,
  installedVersion,
  isPreview = false,
  onClose,
  onViewAllReleases,
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !release) return null;

  const displayVersion = (installedVersion || release.version || "").replace(/^v/i, "");
  const publishedDate = formatPublishedDate(release.published_at);

  return (
    <div
      className="app-dialog-backdrop fixed inset-0 z-[9995] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fadeIn"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-modal-title"
        className="app-dialog-panel relative w-full max-w-3xl max-h-[calc(100dvh-2rem)] bg-theme-card border border-theme rounded-xl shadow-2xl flex flex-col overflow-hidden animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-theme flex items-start justify-between gap-4 bg-black/25 shrink-0">
          <div className="flex items-start gap-3.5 min-w-0">
            <span className="workspace-header-icon mt-0.5">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="whats-new-modal-title"
                  className="text-lg sm:text-xl font-bold text-theme-text leading-snug"
                >
                  {t("whatsNew.title", { version: displayVersion })}
                </h2>
                {release.version && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-theme-hover text-theme-text border border-theme">
                    v{displayVersion}
                  </span>
                )}
                {publishedDate && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs text-theme-muted bg-black/25 border border-theme">
                    <Calendar className="w-3 h-3" />
                    {publishedDate}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-theme-muted mt-1">
                {isPreview ? t("whatsNew.previewSubtitle") : t("whatsNew.subtitle")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("whatsNew.close")}
            className="p-2 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-hover transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Release Notes Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5">
          {release.body ? (
            <MarkdownRenderer content={release.body} />
          ) : (
            <div className="py-8 text-center text-sm text-theme-muted">
              {t("whatsNew.emptyNotes")}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="app-dialog-actions px-5 sm:px-6 py-3.5 border-t border-theme bg-black/25 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {release.html_url && (
              <a
                href={release.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="workspace-command hover:text-theme-primary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t("whatsNew.viewOnGithub")}</span>
              </a>
            )}
            {onViewAllReleases && (
              <button
                type="button"
                onClick={onViewAllReleases}
                className="workspace-command hover:text-theme-primary transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>{t("whatsNew.allReleases")}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-button hover:opacity-90 text-button transition-all shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isPreview ? t("whatsNew.close") : t("whatsNew.gotIt")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
