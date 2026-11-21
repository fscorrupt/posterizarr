import React, { useState } from "react";
import { AlertTriangle, Square, Zap, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ConfirmDialog from "./ConfirmDialog";

const API_URL = "/api";

const DangerZone = ({
  status,
  loading,
  onStatusUpdate,
  onSuccess,
  onError,
  compact = false,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const [forceKillConfirm, setForceKillConfirm] = useState(false);
  const [deleteFileConfirm, setDeleteFileConfirm] = useState(false);
  const hasRunningFile = Boolean(
    status?.running_file_exists || status?.already_running_detected
  );

  const stopScript = async () => {
    try {
      const response = await fetch(`${API_URL}/stop`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        // More user-friendly message instead of "Stopped: manual"
        const message = data.message.includes("Stopped:")
          ? t("dangerZone.stopSuccess")
          : data.message;

        if (onSuccess) onSuccess(message);
        if (onStatusUpdate) onStatusUpdate();
      } else {
        if (onError) onError(data.message || t("dangerZone.stopError"));
      }
    } catch (error) {
      console.error("Error stopping script:", error);
      if (onError) onError(t("dangerZone.stopError") + `: ${error.message}`);
    }
  };

  const forceKillScript = async () => {
    try {
      const response = await fetch(`${API_URL}/force-kill`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        // More user-friendly message instead of "Force killed: manual"
        const message = data.message.includes("Force killed:")
          ? t("dangerZone.forceKillSuccess")
          : data.message;

        if (onSuccess) onSuccess(message);
        if (onStatusUpdate) onStatusUpdate();
      } else {
        if (onError) onError(data.message || t("dangerZone.forceKillError"));
      }
    } catch (error) {
      console.error("Error force killing script:", error);
      if (onError)
        onError(t("dangerZone.forceKillError") + `: ${error.message}`);
    }
  };

  const deleteRunningFile = async () => {
    try {
      const response = await fetch(`${API_URL}/running-file`, {
        method: "DELETE",
      });

      if (!response.ok) {
        let errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          // JSON parsing failed
        }

        if (onError) onError(errorMessage);
        return;
      }

      const data = await response.json();

      if (data.success) {
        if (onSuccess) onSuccess(data.message || t("dashboard.deleteSuccess"));
        if (onStatusUpdate) onStatusUpdate();
      } else {
        if (onError) onError(data.message || t("dashboard.deleteError"));
      }
    } catch (error) {
      console.error("Error deleting running file:", error);
      if (onError) onError(t("dashboard.deleteError") + `: ${error.message}`);
    }
  };

  return (
    <>
      {compact ? (
        <div
          className={
            embedded
              ? "bg-red-950/35 border-b border-red-500/25 px-5 py-3"
              : "bg-red-950/35 rounded-2xl border border-red-500/30 px-5 py-3 shadow-sm"
          }
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-1.5 rounded-lg bg-red-500/15 border border-red-500/20 flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h2 className="text-sm font-semibold text-red-400 whitespace-nowrap">
                  {t("dashboard.dangerZone")}
                </h2>
                <p className="text-xs text-red-200/75">
                  {t("dangerZone.warning")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <button
                onClick={stopScript}
                disabled={loading || !status?.running}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors border border-red-500 shadow-sm"
              >
                <Square className="w-3.5 h-3.5" />
                {t("dashboard.stop")}
              </button>

              <button
                onClick={() => setForceKillConfirm(true)}
                disabled={loading || !status?.running}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-800 hover:bg-red-900 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors border border-red-600 shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" />
                {t("dangerZone.forceKill")}
              </button>

              <button
                onClick={() => setDeleteFileConfirm(true)}
                disabled={loading || !hasRunningFile}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors border border-orange-500 shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("dashboard.deleteRunningFile")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-red-950/40 rounded-xl p-6 border-2 border-red-600/50 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-red-600/20">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-red-400">
                {t("dashboard.dangerZone")}
              </h2>
              <p className="text-red-200 text-sm mt-1">
                {t("dangerZone.warning")}
              </p>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={stopScript}
              disabled={loading || !status?.running}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg font-medium transition-all border border-red-500 shadow-sm hover:scale-[1.02]"
            >
              <Square className="w-5 h-5" />
              {t("dashboard.stop")}
            </button>

            <button
              onClick={() => setForceKillConfirm(true)}
              disabled={loading || !status?.running}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-red-800 hover:bg-red-900 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg font-medium transition-all border border-red-600 shadow-sm hover:scale-[1.02]"
            >
              <Zap className="w-5 h-5" />
              {t("dangerZone.forceKill")}
            </button>

            <button
              onClick={() => setDeleteFileConfirm(true)}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg font-medium transition-all border border-orange-500 shadow-sm hover:scale-[1.02]"
            >
              <Trash2 className="w-5 h-5" />
              {t("dashboard.deleteRunningFile")}
            </button>
          </div>
        </div>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        isOpen={forceKillConfirm}
        onClose={() => setForceKillConfirm(false)}
        onConfirm={forceKillScript}
        title={t("dangerZone.forceKillTitle")}
        message={t("dangerZone.forceKillMessage")}
        confirmText={t("dangerZone.forceKill")}
        type="danger"
      />

      <ConfirmDialog
        isOpen={deleteFileConfirm}
        onClose={() => setDeleteFileConfirm(false)}
        onConfirm={deleteRunningFile}
        title={t("dashboard.deleteConfirmTitle")}
        message={t("dashboard.deleteConfirmMessage")}
        confirmText={t("common.delete")}
        type="warning"
      />
    </>
  );
};

export default DangerZone;
