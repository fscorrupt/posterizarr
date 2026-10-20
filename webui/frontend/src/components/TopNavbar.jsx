import React, { useState, useEffect } from "react";
import { Palette, User, LogOut, Activity, Zap, Square, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./LanguageSwitcher";
import ConfirmDialog from "./ConfirmDialog";

const TopNavbar = () => {
  const { t } = useTranslation();
  const { theme, setTheme, themes } = useTheme();
  const { isAuthEnabled, logout } = useAuth();
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  // Dialog States
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  // Status State
  const [systemStatus, setSystemStatus] = useState({
    running: false,
    mode: null,
    runningFileExists: false
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setSystemStatus({
          running: data.running,
          // Use the specific mode from the backend (e.g. "tautulli", "arr")
          // If null, fallback to "Running"
          mode: data.current_mode || "Running", 
          runningFileExists: data.already_running_detected || data.running_file_exists
        });
      }
    } catch (e) { /* Silent fail */ }
  };

  const isRunningRef = useRef(systemStatus.running);
  useEffect(() => {
    isRunningRef.current = systemStatus.running;
  }, [systemStatus.running]);

  useEffect(() => {
    fetchStatus();
    let tick = 0;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      tick++;
      // Poll every 5s if Posterizarr is actively running; relax to every 15s when idle
      if (isRunningRef.current || tick % 3 === 0) {
        fetchStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStopSystem = async () => {
    try {
      const response = await fetch("/api/stop", { method: "POST" });
      const data = await response.json();

      if (data.success) {
        fetchStatus();
      } else {
        console.error("Stop failed:", data.message);
      }
    } catch (error) {
      console.error("Failed to stop system", error);
    } finally {
      setShowStopConfirm(false);
    }
  };

  const handleDeleteLockfile = async () => {
    try {
      const response = await fetch("/api/running-file", { method: "DELETE" });
      if (!response.ok) {
        console.error(`HTTP Error ${response.status}: ${response.statusText}`);
        setShowLockConfirm(false);
        return;
      }

      const data = await response.json();
      if (data.success) {
        fetchStatus();
      } else {
        console.error("Delete failed:", data.message);
      }
    } catch (error) {
      console.error("Failed to delete lockfile", error);
    } finally {
      setShowLockConfirm(false);
    }
  };

  const themeArray = Object.entries(themes).map(([id, config]) => ({
    id, name: config.name, color: config.variables["--theme-primary"],
  }));

  return (
    <div className="hidden md:block fixed top-0 left-0 right-0 bg-theme-card/90 backdrop-blur-md z-40 h-20 md:pl-80 shadow-sm transition-all duration-300">
      <div className="flex items-center justify-end h-full px-8">

        {/* Right Side: Tools & Status */}
        <div className="flex items-center gap-4">

           {/* System Status Indicators */}
             {/* 1. System Running Status */}
             {systemStatus.running && (
                 <div className="flex items-center gap-3 animate-in slide-in-from-left-5 duration-500 mr-2">
                    <div className="flex items-center gap-2.5 px-4 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                        </span>
                        <span className="text-xs font-bold text-green-500 uppercase tracking-widest">
                             {systemStatus.mode || "Running"}
                        </span>
                    </div>

                    <button
                      onClick={() => setShowStopConfirm(true)}
                      className="group flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/30 text-red-400 hover:text-red-500 transition-all"
                      title={t("topNavbar.stopSystem", "Stop System")}
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span className="text-xs font-semibold">Stop</span>
                    </button>
                 </div>
             )}

             {/* 2. Lock File / Zombie State */}
             {!systemStatus.running && systemStatus.runningFileExists && (
                <div className="flex items-center gap-3 animate-in slide-in-from-left-5 duration-500 mr-2">
                   <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="text-xs font-bold text-yellow-500 uppercase tracking-widest">
                        LOCKED
                      </span>
                   </div>

                   <button
                      onClick={() => setShowLockConfirm(true)}
                      className="group flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/5 hover:bg-orange-500/10 border border-orange-500/10 hover:border-orange-500/30 text-orange-400 hover:text-orange-500 transition-all"
                      title={t("topNavbar.deleteLockfile", "Delete Running File")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">Clear Lock</span>
                    </button>
                </div>
             )}

          {/* Language Switcher */}
          <div className="bg-theme-hover/30 rounded-xl p-1">
             <LanguageSwitcher compact={true} />
          </div>

          <div className="h-6 w-px bg-theme-border"></div>

          {/* Theme Switcher */}
          <div className="relative">
            <button
              onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-theme-hover transition-colors text-theme-muted hover:text-theme-text group"
              title={t("topNavbar.changeTheme")}
            >
              <Palette className="w-5 h-5 group-hover:text-theme-primary transition-colors" />
              <ChevronDown className={`w-3 h-3 transition-transform ${isThemeDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {isThemeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsThemeDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-theme-card border border-theme shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="p-2 space-y-0.5">
                    <div className="px-3 py-2 text-[10px] font-bold text-theme-muted uppercase tracking-widest opacity-70">
                      {t("topNavbar.selectTheme")}
                    </div>
                    {themeArray.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setTheme(t.id); setIsThemeDropdownOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          theme === t.id
                            ? "bg-theme-primary text-white shadow-md"
                            : "text-theme-muted hover:bg-theme-hover hover:text-theme-text"
                        }`}
                      >
                        <span>{t.name}</span>
                        <div className={`w-2.5 h-2.5 rounded-full ring-2 ring-offset-2 ring-offset-theme-card ${theme === t.id ? "ring-white" : "ring-transparent"}`} style={{ backgroundColor: t.color }} />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Menu */}
          {isAuthEnabled && (
            <div className="relative">
              <button
                onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-theme-hover/50 hover:bg-theme-hover transition-colors text-theme-text border border-theme"
                title={t("topNavbar.userMenu")}
              >
                <User className="w-5 h-5" />
              </button>

              {isUserDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl bg-theme-card border border-theme shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2">
                      <button
                        onClick={async () => {
                            setIsUserDropdownOpen(false);
                            logout();
                            try {
                              await fetch("/api/auth/check", {
                                headers: { "Authorization": "Basic " + btoa("logout:logout") }
                              });
                            } catch (e) {
                              // We expect this to fail
                            }

                            window.location.reload();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t("topNavbar.signOut")}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showStopConfirm}
        onClose={() => setShowStopConfirm(false)}
        onConfirm={handleStopSystem}
        title={t("topNavbar.stopSystem", "Stop System")}
        message={t("topNavbar.confirmStop", "Are you sure you want to force stop?")}
        confirmText={t("common.stop", "Stop")}
        type="danger"
      />

      <ConfirmDialog
        isOpen={showLockConfirm}
        onClose={() => setShowLockConfirm(false)}
        onConfirm={handleDeleteLockfile}
        title={t("topNavbar.deleteLockfile", "Delete Running File")}
        message={t("topNavbar.confirmDeleteLock", "Are you sure you want to delete the running file?")}
        confirmText={t("common.delete", "Delete")}
        type="warning"
      />
    </div>
  );
};

export default TopNavbar;
