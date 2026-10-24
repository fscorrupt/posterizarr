import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, X, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * ToastNotification Component
 * A toast-style notification that slides in from the right
 * with auto-dismiss functionality
 */
const ToastNotification = ({
  type = "info",
  message,
  onClose,
  duration = 3000,
  id,
}) => {
  const { t } = useTranslation();
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (onClose) onClose();
    }, 300); // Match animation duration
  };

  if (!message) return null;

  const styles = {
    success: {
      bg: "bg-green-500/10",
      border: "border-green-500",
      icon: (
        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
      ),
      titleColor: "text-green-500",
      textColor: "text-green-400",
      closeColor: "text-green-400 hover:text-green-300",
      title: t("toast.success"),
    },
    error: {
      bg: "bg-red-500/10",
      border: "border-red-500",
      icon: (
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      ),
      titleColor: "text-red-500",
      textColor: "text-red-400",
      closeColor: "text-red-400 hover:text-red-300",
      title: t("toast.error"),
    },
    info: {
      bg: "bg-blue-500/10",
      border: "border-blue-500",
      icon: <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />,
      titleColor: "text-blue-500",
      textColor: "text-blue-400",
      closeColor: "text-blue-400 hover:text-blue-300",
      title: t("toast.info"),
    },
  };

  const style = styles[type] || styles.info;

  return (
    <div
      className={`${style.bg} border ${
        style.border
      } rounded-lg p-4 flex items-start gap-3 shadow-lg backdrop-blur-sm w-full min-w-0 max-w-[420px] transition-all duration-300 ${
        isExiting ? "animate-slideOutRight opacity-0" : "animate-slideInRight"
      }`}
    >
      {style.icon}
      <div className="flex-1 min-w-0">
        <p className={`${style.titleColor} font-medium`}>{style.title}</p>
        <p className={`${style.textColor} text-sm mt-1 break-words [overflow-wrap:anywhere]`}>
          {message}
        </p>
      </div>
      <button
        onClick={handleClose}
        aria-label="Dismiss notification"
        className={`${style.closeColor} min-w-11 min-h-11 flex items-center justify-center transition-colors flex-shrink-0`}
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
};

/**
 * ToastContainer Component
 * Container that manages multiple toast notifications
 */
export const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-20 left-3 right-3 sm:top-4 sm:left-auto sm:right-4 sm:w-[420px] z-[9999] flex flex-col gap-3 max-h-[calc(100dvh-6rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain pointer-events-none">
      <div className="flex flex-col gap-3 pointer-events-auto">
        {toasts.map((toast) => (
          <ToastNotification
            key={toast.id}
            id={toast.id}
            type={toast.type}
            message={toast.message}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default ToastNotification;
