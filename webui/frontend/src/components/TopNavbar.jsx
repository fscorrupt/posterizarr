import React, { useState, useEffect, useRef } from "react";
import { Palette, User, LogOut, Activity, Zap, Square, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useSidebar } from "../context/SidebarContext";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./LanguageSwitcher";
import ConfirmDialog from "./ConfirmDialog";

const TopNavbar = () => {
  const { t } = useTranslation();
  const { theme, setTheme, themes } = useTheme();
  const { isAuthEnabled, logout } = useAuth();
  const { isCollapsed } = useSidebar();
  const { pathname } = useLocation();
  const viewNameKeys = {
    "/": "topNavbar.views.dashboard",
    "/runtime-history": "topNavbar.views.insights",
    "/run-modes": "topNavbar.views.runModes",
    "/scheduler": "topNavbar.views.scheduler",
    "/queue": "topNavbar.views.queue",
    "/dynamic-overlays": "dynamicOverlays.title",
    "/assets-manager": "topNavbar.views.assetManager",
    "/blueprints": "topNavbar.views.blueprints",
    "/logs": "topNavbar.views.logs",
    "/image-quarantine": "topNavbar.views.imageQuarantine",
    "/config/system": "nav.config",
  };
  const viewName = viewNameKeys[pathname]
    ? t(viewNameKeys[pathname])
    : pathname.split("/").filter(Boolean).map(segment => segment.replaceAll("-", " ")).join(" / ");
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  // Dialog States
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [taskToStop, setTaskToStop] = useState(null);

  // Status State
  const [systemStatus, setSystemStatus] = useState({
    running: false,
    mode: null,
    runningFileExists: false,
    activeTasks: [],
    anyRunning: false,
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        const activeTasks = Array.isArray(data.active_tasks) ? data.active_tasks : [];
        const isAnyRunning = Boolean(data.any_running ?? (data.running || activeTasks.length > 0));
        setSystemStatus({
          running: Boolean(data.running),
          mode: data.current_mode || "Running",
          runningFileExists: Boolean(data.already_running_detected || data.running_file_exists),
          activeTasks,
          anyRunning: isAnyRunning,
        });
      }
    } catch (e) { /* Silent fail */ }
  };

  const isRunningRef = useRef(systemStatus.anyRunning);
  useEffect(() => {
    isRunningRef.current = systemStatus.anyRunning;
  }, [systemStatus.anyRunning]);

  useEffect(() => {
    fetchStatus();
    let tick = 0;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      tick++;
      // Poll every 5s if any task is actively running; relax to every 15s when idle
      if (isRunningRef.current || tick % 3 === 0) {
        fetchStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStopSystem = async () => {
    try {
      const endpoint = taskToStop?.stop_endpoint || "/api/stop";
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();

      if (data.success) {
        fetchStatus();
      } else {
        console.error("Stop failed:", data.message || data.error);
      }
    } catch (error) {
      console.error("Failed to stop system", error);
    } finally {
      setShowStopConfirm(false);
      setTaskToStop(null);
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
    <div className={`app-topbar hidden md:block fixed top-0 left-0 right-0 z-40 h-16 transition-all duration-300 ${isCollapsed ? "md:pl-20" : "md:pl-64"}`}>
      <div className="flex items-center justify-between gap-4 h-full px-6 lg:px-8">
        <nav aria-label="Current view" className="hidden lg:flex min-w-0 items-center gap-2 text-xs text-theme-muted">
          <Link to="/" className="shrink-0 hover:text-theme-text">Posterizarr</Link>
          <ChevronRight size={13} className="shrink-0" />
          <span aria-current="page" className="truncate capitalize text-theme-text">{viewName}</span>
        </nav>

        {/* Right Side: Tools & Status */}
        <div className="ml-auto flex shrink-0 items-center gap-3">

           {/* System Status Indicators */}
           {/* 1. Active Running Tasks (Posterizarr, Overlay Sync, AniMetaFill, Metadata Refresh) */}
           {systemStatus.activeTasks?.map((task) => {
             const colorMap = {
               green: {
                 badge: "bg-green-500/10 border-green-500/20 text-green-500",
                 ping: "bg-green-400",
                 dot: "bg-green-500",
               },
               blue: {
                 badge: "bg-blue-500/10 border-blue-500/20 text-blue-400",
                 ping: "bg-blue-400",
                 dot: "bg-blue-500",
               },
               purple: {
                 badge: "bg-purple-500/10 border-purple-500/20 text-purple-400",
                 ping: "bg-purple-400",
                 dot: "bg-purple-500",
               },
               amber: {
                 badge: "bg-amber-500/10 border-amber-500/20 text-amber-400",
                 ping: "bg-amber-400",
                 dot: "bg-amber-500",
               },
             };
             const themeColor = colorMap[task.color] || colorMap.green;
             const TaskBadge = task.log_file ? Link : "div";
             const taskLinkProps = task.log_file ? { to: "/logs", state: { logFile: task.log_file }, title: `View ${task.name} live log` } : {};

             return (
               <div key={task.id} className="flex items-center gap-2 animate-in slide-in-from-left-5 duration-300 mr-1">
                 <TaskBadge {...taskLinkProps} className={`flex items-center gap-2 px-3.5 py-1.5 border rounded-full ${themeColor.badge}`}>
                   <span className="relative flex h-2 w-2">
                     <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${themeColor.ping}`}></span>
                     <span className={`relative inline-flex rounded-full h-2 w-2 ${themeColor.dot}`}></span>
                   </span>
                   <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap">
                     {task.label || task.name}
                   </span>
                 </TaskBadge>

                 {task.stop_endpoint && (
                   <button
                     onClick={() => {
                       setTaskToStop(task);
                       setShowStopConfirm(true);
                     }}
                     className="group flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/30 text-red-400 hover:text-red-500 transition-all shadow-sm"
                     title={t("topNavbar.actions.stopTask", { name: task.name })}
                   >
                     <Square className="w-3.5 h-3.5 fill-current" />
                     <span className="text-xs font-semibold">{t("topNavbar.actions.stop")}</span>
                   </button>
                 )}
               </div>
             );
           })}

           {/* Fallback for legacy running state if activeTasks is empty */}
           {(!systemStatus.activeTasks || systemStatus.activeTasks.length === 0) && systemStatus.running && (
             <div className="flex items-center gap-3 animate-in slide-in-from-left-5 duration-500 mr-2">
               <div className="flex items-center gap-2.5 px-4 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
                 <span className="relative flex h-2.5 w-2.5">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                 </span>
                 <span className="text-xs font-bold text-green-500 uppercase tracking-widest">
                   {systemStatus.mode || t("topNavbar.actions.running")}
                 </span>
               </div>

               <button
                 onClick={() => {
                   setTaskToStop({ id: "posterizarr", name: "Posterizarr", stop_endpoint: "/api/stop" });
                   setShowStopConfirm(true);
                 }}
                 className="group flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/30 text-red-400 hover:text-red-500 transition-all"
                 title={t("topNavbar.stopSystem")}
               >
                 <Square className="w-3.5 h-3.5 fill-current" />
                 <span className="text-xs font-semibold">{t("topNavbar.actions.stop")}</span>
               </button>
             </div>
           )}

           {/* 2. Lock File / Zombie State */}
           {!systemStatus.anyRunning && systemStatus.runningFileExists && (
             <div className="flex items-center gap-3 animate-in slide-in-from-left-5 duration-500 mr-2">
               <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                 <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                 <span className="text-xs font-bold text-yellow-500 uppercase tracking-widest">
                   {t("topNavbar.actions.locked")}
                 </span>
               </div>

               <button
                 onClick={() => setShowLockConfirm(true)}
                 className="group flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/5 hover:bg-orange-500/10 border border-orange-500/10 hover:border-orange-500/30 text-orange-400 hover:text-orange-500 transition-all"
                 title={t("topNavbar.deleteLockfile")}
               >
                 <Trash2 className="w-3.5 h-3.5" />
                 <span className="text-xs font-semibold">{t("topNavbar.actions.clearLock")}</span>
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
        onClose={() => {
          setShowStopConfirm(false);
          setTaskToStop(null);
        }}
        onConfirm={handleStopSystem}
        title={taskToStop ? t("topNavbar.actions.stopTask", { name: taskToStop.name }) : t("topNavbar.stopSystem")}
        message={taskToStop ? t("topNavbar.confirmStopTask", { name: taskToStop.name }) : t("topNavbar.confirmStop")}
        confirmText={t("common.stop")}
        type="danger"
      />

      <ConfirmDialog
        isOpen={showLockConfirm}
        onClose={() => setShowLockConfirm(false)}
        onConfirm={handleDeleteLockfile}
        title={t("topNavbar.deleteLockfile")}
        message={t("topNavbar.confirmDeleteLock")}
        confirmText={t("common.delete")}
        type="warning"
      />
    </div>
  );
};

export default TopNavbar;
