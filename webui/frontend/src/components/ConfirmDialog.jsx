import React from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * ConfirmDialog Component
 * A reusable confirmation dialog for delete operations or other confirmations
 */
const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  itemName,
  confirmText,
  cancelText,
  type = "danger", // "danger" or "warning"
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const buttonColors = {
    danger: "bg-red-500 hover:bg-red-600",
    warning: "bg-yellow-500 hover:bg-yellow-600",
  };

  return (
    <div
      className="app-dialog-backdrop fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-3 sm:p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || t("confirmDialog.title")}
        className="app-dialog-panel bg-theme-card border border-theme rounded-lg max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-4 sm:p-6 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 sm:gap-4 mb-4">
          <div
            className={`w-10 h-10 sm:w-12 sm:h-12 ${
              type === "danger" ? "bg-red-500/10" : "bg-yellow-500/10"
            } rounded-full flex items-center justify-center flex-shrink-0`}
          >
            <AlertCircle
              className={`w-6 h-6 ${
                type === "danger" ? "text-red-500" : "text-yellow-500"
              }`}
            />
          </div>
          <div className="min-w-0 break-words [overflow-wrap:anywhere]">
            <h3 className="text-lg font-semibold text-theme-text mb-2">
              {title || t("confirmDialog.title")}
            </h3>
            {message && (
              <p className="text-theme-muted text-sm mb-1 whitespace-pre-line">
                {typeof message === "string" ? message.replace(/\\n/g, "\n") : message}
              </p>
            )}
            {itemName && (
              <p className="text-theme-text font-medium text-sm mt-2 break-words">
                {itemName}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse min-[400px]:flex-row gap-2 sm:gap-3 justify-end">
          <button
            onClick={onClose}
            className="min-h-11 px-4 py-2 bg-theme-hover hover:bg-theme-bg-dark text-theme-text rounded-lg transition-colors whitespace-normal break-words"
          >
            {cancelText || t("confirmDialog.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            className={`min-h-11 px-4 py-2 ${buttonColors[type]} text-white rounded-lg transition-colors whitespace-normal break-words`}
          >
            {confirmText || t("confirmDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
