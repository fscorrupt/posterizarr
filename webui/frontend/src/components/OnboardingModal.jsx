import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, ChevronLeft, Save, Server, Key, Settings, Bell, Rocket, Shield, Activity, HardDrive, Database, ExternalLink, Loader2, Clock, Calendar, Zap, RefreshCw, Grid, X, Eye, EyeOff } from "lucide-react";

const ClearableInput = ({ value, onChange, placeholder, isPassword }) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const showAsPassword = isPassword && !showPassword;

  return (
    <div className="relative flex items-center">
      <input
        type={showAsPassword ? "password" : "text"}
        className="w-full bg-white border-transparent rounded-md px-3 py-1.5 text-sm text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary transition-all pr-14 placeholder-gray-500 hover:bg-gray-50"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="absolute right-2 flex items-center gap-1">
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
            title={showPassword ? "Hide text" : "Show text"}
          >
            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
            title={t("onboarding.clearInput")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
import ValidateButton from "./ValidateButton";
import LanguageSwitcher from "./LanguageSwitcher";
import LibraryExclusionSelector from "./LibraryExclusionSelector";
import PlexOAuthButton from "./PlexOAuthButton";

export default function OnboardingModal({ onComplete }) {
  const { t } = useTranslation();

const STEPS = [
  { id: "welcome", title: t("onboarding.welcome"), icon: <Rocket className="w-5 h-5" /> },
  { id: "server", title: t("onboarding.mediaServer"), icon: <Server className="w-5 h-5" /> },
  { id: "keys", title: t("onboarding.apiKeys"), icon: <Key className="w-5 h-5" /> },
  { id: "auto", title: t("onboarding.automation"), icon: <Settings className="w-5 h-5" /> },
  { id: "perf", title: t("onboarding.performance"), icon: <Activity className="w-5 h-5" /> },
  { id: "notif", title: t("onboarding.notifications"), icon: <Bell className="w-5 h-5" /> },
  { id: "schedule", title: t("onboarding.schedule"), icon: <Clock className="w-5 h-5" /> },
  { id: "finish", title: t("onboarding.ready"), icon: <Check className="w-5 h-5" /> },
];

  const frequencies = [
  { id: "daily", label: t("onboarding.daily") },
  { id: "weekly", label: t("onboarding.weekly") },
  { id: "monthly", label: t("onboarding.monthly") },
  { id: "interval", label: t("onboarding.interval") },
];

const months = [
  { id: "*", label: "Every Month" },
  { id: "1", label: "January" },
  { id: "2", label: "February" },
  { id: "3", label: "March" },
  { id: "4", label: "April" },
  { id: "5", label: "May" },
  { id: "6", label: "June" },
  { id: "7", label: "July" },
  { id: "8", label: "August" },
  { id: "9", label: "September" },
  { id: "10", label: "October" },
  { id: "11", label: "November" },
  { id: "12", label: "December" },
];

const daysOfWeek = [
  { id: "mon", label: t("onboarding.monday") },
  { id: "tue", label: t("onboarding.tuesday") },
  { id: "wed", label: t("onboarding.wednesday") },
  { id: "thu", label: t("onboarding.thursday") },
  { id: "fri", label: t("onboarding.friday") },
  { id: "sat", label: t("onboarding.saturday") },
  { id: "sun", label: t("onboarding.sunday") },
];

const intervalUnits = [
  { id: "hours", label: t("onboarding.hours") },
  { id: "days", label: t("onboarding.days") },
  { id: "weeks", label: "Weeks" },
];

const runModes = [
  { id: "normal", label: "Normal Run" },
  { id: "syncjelly", label: "Sync Jellyfin" },
  { id: "syncemby", label: "Sync Emby" },
  { id: "backup", label: "System Backup" },
  { id: "logoupdater", label: "Logo Updater" },
];




  const [currentStep, setCurrentStep] = useState(0);

  // UI State for selections
  const [primaryServer, setPrimaryServer] = useState(null); // 'plex', 'jellyfin', 'emby'
  const [syncFromPlex, setSyncFromPlex] = useState(false);
  const [plexSyncServer, setPlexSyncServer] = useState(null); // 'jellyfin', 'emby'
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [dayOfWeek, setDayOfWeek] = useState("mon");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [newMonth, setNewMonth] = useState("*");
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState("hours");
  const [newMode, setNewMode] = useState("normal");
  const [newTime, setNewTime] = useState("03:00");
  const [logoLibrary, setLogoLibrary] = useState("all");
  const [logoForceReplace, setLogoForceReplace] = useState(false);
  const [logoExifCheck, setLogoExifCheck] = useState(false);
  const [logoRevert, setLogoRevert] = useState(false);
  const [notificationType, setNotificationType] = useState('none'); // 'none', 'discord', 'apprise'

  const [plexValidated, setPlexValidated] = useState(false);
  const [jellyfinValidated, setJellyfinValidated] = useState(false);
  const [embyValidated, setEmbyValidated] = useState(false);

  const [plexLibsValid, setPlexLibsValid] = useState(false);
  const [jellyfinLibsValid, setJellyfinLibsValid] = useState(false);
  const [embyLibsValid, setEmbyLibsValid] = useState(false);

  const [config, setConfig] = useState({
    // Server URLs and Tokens
    PlexUrl: "",
    PlexToken: "",
    UsePlex: "false",
    JellyfinUrl: "",
    JellyfinAPIKey: "",
    UseJellyfin: "false",
    EmbyUrl: "",
    EmbyAPIKey: "",
    UseEmby: "false",

    // API Keys
    tmdbtoken: "",
    tvdbapi: "",
    FanartTvAPIKey: "",

    // Automation
    AssetCleanup: "false",
    SkipJapTitle: "false",
    SkipTBA: "false",

    // Performance
    ImageProcessing: "true",
    outputQuality: "92%",
    maxLogs: "5",
    ParallelJobs: "5",

    // Notifications
    SendNotification: "false",
    Discord: "",
    DiscordUserName: "Posterizarr",
    AppriseUrl: "",
    UseUptimeKuma: "false",
    UptimeKumaUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.style.overflow = "hidden";

    // Fetch full config to prevent overwriting missing keys on save
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        if (data.success && data.config) {
          // Merge existing config into state so we don't lose anything
          setConfig(prev => {
            const newConfig = { ...prev, ...data.config };

            // Clear out default example values so they don't get appended to
            const defaultsToClear = {
              tmdbtoken: "TMDBTOKEN",
              tvdbapi: "TVDBAPIKEY",
              FanartTvAPIKey: "FANARTAPIKEY",
              Discord: "https://discordapp.com/api/webhooks/",
              AppriseUrl: "discord://{WebhookID}/{WebhookToken}/",
              UptimeKumaUrl: "https://uptime-kuma.domain.com"
            };

            for (const [key, defaultVal] of Object.entries(defaultsToClear)) {
              if (newConfig[key] === defaultVal) {
                newConfig[key] = "";
              }
            }

            if (newConfig.Discord) setNotificationType('discord');
            else if (newConfig.AppriseUrl) setNotificationType('apprise');
            return newConfig;
          });
        }
      } catch (err) {
        console.error("Failed to fetch initial config", err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();

    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const handleChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const finalConfig = { ...config };

      // Enforce Media Server flags based on UI selections
      finalConfig.UsePlex = (primaryServer === 'plex') ? "true" : "false";
      finalConfig.UseJellyfin = (primaryServer === 'jellyfin') ? "true" : "false";
      finalConfig.UseEmby = (primaryServer === 'emby') ? "true" : "false";
      // Note: If syncFromPlex is true, the secondary server URLs/Tokens are sent, but their 'Use' flag remains false.

      // Enforce Notification toggle
      if (notificationType === 'discord') {
          finalConfig.SendNotification = finalConfig.Discord ? "true" : "false";
          finalConfig.AppriseUrl = "";
      } else if (notificationType === 'apprise') {
          finalConfig.SendNotification = finalConfig.AppriseUrl ? "true" : "false";
          finalConfig.Discord = "";
          finalConfig.DiscordUserName = "";
      } else {
          finalConfig.SendNotification = "false";
          finalConfig.Discord = "";
          finalConfig.AppriseUrl = "";
      }

      // Enforce Uptime Kuma toggle
      if (finalConfig.UseUptimeKuma !== "true") {
          finalConfig.UptimeKumaUrl = "";
      }

      // Save config updates
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: finalConfig }),
      });

      // Save Schedule if enabled
      if (enableSchedule) {
        try {
          await fetch("/api/scheduler/enable", { method: "POST" });

          const payload = {
            time: newTime,
            description: "Onboarding Schedule",
            mode: newMode,
            frequency: frequency,
            month: newMonth,
          };

          if (newMode === "logoupdater") {
            payload.library = logoLibrary;
            payload.force_replace = logoForceReplace;
            payload.exif_check = logoExifCheck;
            payload.revert = logoRevert;
          }

          if (frequency === "weekly") {
            payload.day_of_week = dayOfWeek;
            payload.day = "*";
          } else if (frequency === "monthly") {
            payload.day = dayOfMonth;
            payload.day_of_week = "*";
          } else if (frequency === "interval") {
            payload.interval_value = intervalValue;
            payload.interval_unit = intervalUnit;
            payload.day = "*";
            payload.day_of_week = "*";
          } else {
            payload.day = "*";
            payload.day_of_week = "*";
          }

          await fetch("/api/scheduler/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (scheduleErr) {
          console.error("Failed to setup schedule during onboarding", scheduleErr);
        }
      }

      // Mark onboarding as complete
      await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      onComplete();
    } catch (err) {
      console.error("Failed to complete onboarding", err);
    } finally {
      setSaving(false);
    }
  };

  const renderServerForm = (type) => {
    if (type === 'plex') {
      return (
        <div className="mt-2 p-3 bg-theme-bg/30 rounded-xl animate-fade-in flex flex-col h-full overflow-hidden">
          <h4 className="font-semibold text-sm text-theme-primary mb-2 flex items-center shrink-0">
            <img src="/plex.svg" alt="Plex" className="w-4 h-4 mr-2 object-contain" /> {t("onboarding.plexConfiguration")}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <div className="space-y-3 shrink-0">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1">{t("onboarding.plexUrl")}</label>
                <ClearableInput value={config.PlexUrl} onChange={val => handleChange("PlexUrl", val)} placeholder={t("onboarding.plexUrlExample") || "http://192.168.1.93:32400"} />
              </div>
              <div>
                <label className="flex items-center justify-between text-xs font-medium text-theme-muted mb-1">
                  {t("onboarding.plexToken")}
                  <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/" target="_blank" rel="noreferrer" className="text-[10px] text-theme-primary hover:underline font-normal">{t("onboarding.howToFindThis")}</a>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ClearableInput value={config.PlexToken} onChange={val => handleChange("PlexToken", val)} placeholder={t("onboarding.yourPlexToken")} isPassword />
                  </div>
                  <PlexOAuthButton onTokenReceived={(token) => handleChange("PlexToken", token)} className="h-[38px] shrink-0" />
                </div>
              </div>
              <div className="flex justify-end pt-1 shrink-0">
                <ValidateButton type="plex" config={config} label={t("onboarding.testConnection")} disabled={!config.PlexUrl || !config.PlexToken} onSuccess={() => setPlexValidated(true)} />
              </div>
            </div>
            <div className="pl-4 h-full min-h-[160px] max-h-full border-l border-white/5">
              <LibraryExclusionSelector
                value={config.PlexLibstoExclude || []}
                onChange={(val) => handleChange('PlexLibstoExclude', val)}
                mediaServerType="plex"
                config={config}
                disabled={!config.PlexUrl || !config.PlexToken}
                inlineMode={true}
                autoFetchTrigger={plexValidated}
                onValidStateChange={setPlexLibsValid}
              />
            </div>
          </div>
        </div>
      );
    }
    if (type === 'jellyfin') {
      return (
        <div className="mt-2 p-3 bg-theme-bg/30 rounded-xl animate-fade-in flex flex-col h-full overflow-hidden">
          <h4 className="font-semibold text-sm text-theme-primary mb-2 flex items-center shrink-0">
            <img src="/jellyfin.svg" alt="Jellyfin" className="w-4 h-4 mr-2 object-contain" />{t("onboarding.jellyfinConfiguration")}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <div className="space-y-3 shrink-0">
              <div className="text-xs text-theme-muted bg-theme-primary/10 border border-theme-primary/20 p-2 rounded-lg flex items-start gap-2">
                <Rocket className="w-4 h-4 shrink-0 text-theme-primary" />
                <div>{t("onboarding.noteAnOfficial")}<a href="https://fscorrupt.github.io/posterizarr/jellyfin_plugin/" target="_blank" rel="noreferrer" className="text-theme-primary hover:underline font-medium flex items-center gap-1 inline-flex">{t("onboarding.jellyfinPlugin")}<ExternalLink className="w-3 h-3" /></a> is available to act as an asset middleware for Posterizarr.
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1">{t("onboarding.jellyfinUrl")}</label>
                <ClearableInput value={config.JellyfinUrl} onChange={val => handleChange("JellyfinUrl", val)} placeholder={t("onboarding.jellyfinUrlExample") || "http://192.168.1.93:8096"} />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1">{t("onboarding.apiKey")}</label>
                <ClearableInput value={config.JellyfinAPIKey} onChange={val => handleChange("JellyfinAPIKey", val)} placeholder={t("onboarding.jellyfinApiKey")} isPassword />
              </div>
              <div className="flex justify-end pt-1 shrink-0">
                <ValidateButton type="jellyfin" config={config} label={t("onboarding.testConnection")} disabled={!config.JellyfinUrl || !config.JellyfinAPIKey} onSuccess={() => setJellyfinValidated(true)} />
              </div>
            </div>
            <div className="pl-4 h-full min-h-[160px] max-h-full border-l border-white/5">
              <LibraryExclusionSelector
                value={config.JellyfinLibstoExclude || []}
                onChange={(val) => handleChange('JellyfinLibstoExclude', val)}
                mediaServerType="jellyfin"
                config={config}
                disabled={!config.JellyfinUrl || !config.JellyfinAPIKey}
                inlineMode={true}
                autoFetchTrigger={jellyfinValidated}
                onValidStateChange={setJellyfinLibsValid}
              />
            </div>
          </div>
        </div>
      );
    }
    if (type === 'emby') {
      return (
        <div className="mt-2 p-3 bg-theme-bg/30 rounded-xl animate-fade-in flex flex-col h-full overflow-hidden">
          <h4 className="font-semibold text-sm text-theme-primary mb-2 flex items-center shrink-0">
            <img src="/emby.svg" alt="Emby" className="w-4 h-4 mr-2 object-contain" />{t("onboarding.embyConfiguration")}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <div className="space-y-3 shrink-0">
              <div className="text-xs text-theme-muted bg-theme-primary/10 border border-theme-primary/20 p-2 rounded-lg flex items-start gap-2">
                <Rocket className="w-4 h-4 shrink-0 text-theme-primary" />
                <div>{t("onboarding.noteAnOfficial")}<a href="https://fscorrupt.github.io/posterizarr/emby_plugin/" target="_blank" rel="noreferrer" className="text-theme-primary hover:underline font-medium flex items-center gap-1 inline-flex">{t("onboarding.embyPlugin")}<ExternalLink className="w-3 h-3" /></a> is available to act as an asset middleware for Posterizarr.
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1">{t("onboarding.embyUrl")}</label>
                <ClearableInput value={config.EmbyUrl} onChange={val => handleChange("EmbyUrl", val)} placeholder={t("onboarding.embyUrlExample") || "http://192.168.1.93:8096/emby"} />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1">{t("onboarding.apiKey")}</label>
                <ClearableInput value={config.EmbyAPIKey} onChange={val => handleChange("EmbyAPIKey", val)} placeholder={t("onboarding.embyApiKey")} isPassword />
              </div>
              <div className="flex justify-end pt-1 shrink-0">
                <ValidateButton type="emby" config={config} label={t("onboarding.testConnection")} disabled={!config.EmbyUrl || !config.EmbyAPIKey} onSuccess={() => setEmbyValidated(true)} />
              </div>
            </div>
            <div className="pl-4 h-full min-h-[160px] max-h-full border-l border-white/5">
              <LibraryExclusionSelector
                value={config.EmbyLibstoExclude || []}
                onChange={(val) => handleChange('EmbyLibstoExclude', val)}
                mediaServerType="emby"
                config={config}
                disabled={!config.EmbyUrl || !config.EmbyAPIKey}
                inlineMode={true}
                autoFetchTrigger={embyValidated}
                onValidStateChange={setEmbyLibsValid}
              />
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Welcome
        return (
          <div className="flex flex-col items-center justify-center text-center space-y-6 animate-fade-in py-10">
            <div className="mb-4">
              <img src="/logo.png" alt="Posterizarr Logo" className="h-24 object-contain" />
            </div>
            <p className="text-theme-muted max-w-md text-lg">
              The ultimate automated tool for standardizing and enhancing your media server's artwork. Let's get you set up in just a few steps!
            </p>
          </div>
        );
      case 1: // Server
        return (
          <div className="animate-fade-in flex flex-col h-full">
            {!primaryServer && (
              <div className="shrink-0 mb-4 animate-fade-in">
                <h3 className="text-xl font-bold text-white mb-1">{t("onboarding.primaryMediaServer")}</h3>
                <p className="text-sm text-theme-muted">{t("onboarding.selectPrimaryServer")}</p>
              </div>
            )}

            <div className={`grid grid-cols-1 min-[440px]:grid-cols-3 gap-3 shrink-0 transition-all duration-300 ${primaryServer ? 'mb-2' : 'mb-6'}`}>
              <button
                onClick={() => setPrimaryServer('plex')}
                className={`py-2 px-3 rounded-xl flex flex-row items-center justify-center transition-all ${primaryServer === 'plex' ? 'bg-theme-primary/15 text-theme-primary shadow-sm ring-1 ring-theme-primary/50' : 'bg-theme-bg-dark/40 text-theme-muted hover:bg-theme-bg-dark/60'}`}
              >
                <img src="/plex.svg" alt="Plex" className="w-5 h-5 mr-2 object-contain drop-shadow-md opacity-90 transition-transform hover:scale-110" />
                <span className="font-semibold text-sm">Plex</span>
              </button>
              <button
                onClick={() => setPrimaryServer('jellyfin')}
                className={`py-2 px-3 rounded-xl flex flex-row items-center justify-center transition-all ${primaryServer === 'jellyfin' ? 'bg-theme-primary/15 text-theme-primary shadow-sm ring-1 ring-theme-primary/50' : 'bg-theme-bg-dark/40 text-theme-muted hover:bg-theme-bg-dark/60'}`}
              >
                <img src="/jellyfin.svg" alt="Jellyfin" className="w-5 h-5 mr-2 object-contain drop-shadow-md opacity-90 transition-transform hover:scale-110" />
                <span className="font-semibold text-sm">Jellyfin</span>
              </button>
              <button
                onClick={() => setPrimaryServer('emby')}
                className={`py-2 px-3 rounded-xl flex flex-row items-center justify-center transition-all ${primaryServer === 'emby' ? 'bg-theme-primary/15 text-theme-primary shadow-sm ring-1 ring-theme-primary/50' : 'bg-theme-bg-dark/40 text-theme-muted hover:bg-theme-bg-dark/60'}`}
              >
                <img src="/emby.svg" alt="Emby" className="w-5 h-5 mr-2 object-contain drop-shadow-md opacity-90 transition-transform hover:scale-110" />
                <span className="font-semibold text-sm">Emby</span>
              </button>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              {primaryServer && renderServerForm(primaryServer)}
            </div>

            {primaryServer === 'plex' && (
              <div className="mt-4 border-t border-white/5 pt-4 animate-fade-in shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-sm text-white">{t("onboarding.syncFromPlex")}</h4>
                    <p className="text-xs text-theme-muted">{t("onboarding.syncFromPlexDesc")}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={syncFromPlex} onChange={(e) => {
                      setSyncFromPlex(e.target.checked);
                      if (!e.target.checked) setPlexSyncServer(null);
                    }} />
                    <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                  </label>
                </div>

                {syncFromPlex && (
                  <div className="space-y-3 animate-fade-in">
                    <p className="text-xs text-theme-muted">{t("onboarding.selectSecondaryServer")}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setPlexSyncServer('jellyfin')}
                        className={`py-2 px-3 rounded-xl flex items-center justify-center transition-all font-medium text-sm ${plexSyncServer === 'jellyfin' ? 'bg-theme-primary/15 text-theme-primary shadow-sm' : 'bg-theme-bg-dark/40 text-theme-muted hover:bg-theme-bg-dark/60'}`}
                      >
                        <img src="/jellyfin.svg" alt="Jellyfin" className="w-4 h-4 mr-2 object-contain" /> Jellyfin
                      </button>
                      <button
                        onClick={() => setPlexSyncServer('emby')}
                        className={`py-2 px-3 rounded-xl flex items-center justify-center transition-all font-medium text-sm ${plexSyncServer === 'emby' ? 'bg-theme-primary/15 text-theme-primary shadow-sm' : 'bg-theme-bg-dark/40 text-theme-muted hover:bg-theme-bg-dark/60'}`}
                      >
                        <img src="/emby.svg" alt="Emby" className="w-4 h-4 mr-2 object-contain" /> Emby
                      </button>
                    </div>
                    {plexSyncServer && renderServerForm(plexSyncServer)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      case 2: // API Keys
        return (
          <div className="space-y-4 animate-fade-in flex flex-col h-full">
            <h3 className="text-xl font-bold text-white mb-1">{t("onboarding.apiKeys")}</h3>
            <p className="text-sm text-theme-muted mb-4">{t("onboarding.requiredToFetchArtwork")}</p>

            <div className="flex flex-col gap-3 flex-1 justify-center max-w-2xl mx-auto w-full">
              <div className="p-3 bg-theme-bg/30 rounded-xl flex flex-row items-center gap-4 hover:bg-theme-bg/50 transition-colors">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-sm font-medium text-white flex items-center">
                      <img src="/tmdb.png" alt="TMDb" className="w-5 h-5 mr-2 object-contain rounded" /> {t("onboarding.tmdbApiTokenRequired")} <span className="ml-1 text-xs text-theme-primary">(Free)</span>
                    </label>
                    <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-[10px] text-theme-primary flex items-center hover:underline">{t("onboarding.howToGet")}<ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                  <ClearableInput value={config.tmdbtoken} onChange={val => handleChange("tmdbtoken", val)} placeholder={t("onboarding.v3ApiKeyV4Token")} isPassword />
                </div>
                <div className="mt-6">
                  <ValidateButton type="tmdb" config={config} label={t("onboarding.test")} disabled={!config.tmdbtoken} />
                </div>
              </div>

              <div className="p-3 bg-theme-bg/30 rounded-xl flex flex-row items-center gap-4 hover:bg-theme-bg/50 transition-colors">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-sm font-medium text-white flex items-center">
                      <img src="/tvdb.png" alt="TVDb" className="w-5 h-5 mr-2 object-contain rounded bg-white/10 p-0.5" /> {t("onboarding.tvdbApiKeyRequired")} <span className="ml-1 text-xs text-theme-primary">(Free)</span>
                    </label>
                    <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer" className="text-[10px] text-theme-primary flex items-center hover:underline">{t("onboarding.howToGet")}<ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                  <ClearableInput value={config.tvdbapi} onChange={val => handleChange("tvdbapi", val)} placeholder={t("onboarding.v4ApiKey")} isPassword />
                  <p className="text-[10px] text-theme-muted mt-1.5 leading-tight">Free for personal use. Consider subscribing to support their work!</p>
                </div>
                <div className="mt-6">
                  <ValidateButton type="tvdb" config={config} label={t("onboarding.test")} disabled={!config.tvdbapi} />
                </div>
              </div>

              <div className="p-3 bg-theme-bg/30 rounded-xl flex flex-row items-center gap-4 hover:bg-theme-bg/50 transition-colors">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-sm font-medium text-white flex items-center">
                      <img src="/fanart.png" alt="Fanart" className="w-5 h-5 mr-2 object-contain rounded" /> {t("onboarding.fanartTvApiKeyRequired")} <span className="ml-1 text-xs text-theme-primary">(Free)</span>
                    </label>
                    <a href="https://fanart.tv/get-an-api-key/" target="_blank" rel="noreferrer" className="text-[10px] text-theme-primary flex items-center hover:underline">{t("onboarding.howToGet")}<ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                  <ClearableInput value={config.FanartTvAPIKey} onChange={val => handleChange("FanartTvAPIKey", val)} placeholder={t("onboarding.personalApiKey")} isPassword />
                </div>
                <div className="mt-6">
                  <ValidateButton type="fanart" config={config} label={t("onboarding.test")} disabled={!config.FanartTvAPIKey} />
                </div>
              </div>
            </div>
          </div>
        );
      case 3: // Automation
        return (
          <div className="space-y-6 animate-fade-in">
            <h3 className="text-2xl font-bold text-white mb-2">{t("onboarding.automationPreferences")}</h3>
            <p className="text-theme-muted mb-6">{t("onboarding.configureHowPosterizarrProcesses")}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 hover:border-theme-primary/50 transition-colors">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.assetCleanup")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.removeUnusedAssets")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.AssetCleanup === "true"} onChange={e => handleChange("AssetCleanup", e.target.checked ? "true" : "false")} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 hover:border-theme-primary/50 transition-colors">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.skipAsianTitles")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.skipProcessingAsianMedia")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.SkipJapTitle === "true"} onChange={e => handleChange("SkipJapTitle", e.target.checked ? "true" : "false")} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 hover:border-theme-primary/50 transition-colors">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.skipTbaItems")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.skipItemsToBeAnnounced")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.SkipTBA === "true"} onChange={e => handleChange("SkipTBA", e.target.checked ? "true" : "false")} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>
            </div>
          </div>
        );
      case 4: // Performance
        return (
          <div className="space-y-6 animate-fade-in">
            <h3 className="text-2xl font-bold text-white mb-2">{t("onboarding.performanceQuality")}</h3>
            <p className="text-theme-muted mb-6">{t("onboarding.tuneResourceUsage")}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.imageProcessing")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.useAdvancedImageMagickProcessing")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.ImageProcessing === "true"} onChange={e => handleChange("ImageProcessing", e.target.checked ? "true" : "false")} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.outputQuality")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.setJpegQualityCompression")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="1" max="100" className="w-20 bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-3 py-1.5 text-gray-900 font-semibold text-right focus:border-theme-primary focus:ring-1 focus:ring-theme-primary" value={(config.outputQuality || "92").replace('%', '')} onChange={e => handleChange("outputQuality", `${e.target.value}%`)} />
                  <span className="text-white font-medium">%</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.maxLogsRetained")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.previousRunLogsToKeep")}</p>
                </div>
                <input type="number" min="1" max="50" className="w-24 bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-3 py-1.5 text-gray-900 font-semibold text-right focus:border-theme-primary focus:ring-1 focus:ring-theme-primary" value={config.maxLogs} onChange={e => handleChange("maxLogs", e.target.value)} />
              </div>

              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.parallelJobs")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.concurrentPosterCreations")}</p>
                </div>
                <input type="number" min="1" max="50" className="w-24 bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-3 py-1.5 text-gray-900 font-semibold text-right focus:border-theme-primary focus:ring-1 focus:ring-theme-primary" value={config.ParallelJobs} onChange={e => handleChange("ParallelJobs", e.target.value)} />
              </div>
            </div>
          </div>
        );
      case 5: // Notifications
        return (
          <div className="space-y-6 animate-fade-in">
            <h3 className="text-2xl font-bold text-white mb-2">{t("onboarding.notifications")}</h3>
            <p className="text-theme-muted mb-6">{t("onboarding.receiveAlertsWhenPosterizarrCompletes")}</p>

            <div className="grid grid-cols-1 min-[440px]:grid-cols-3 gap-3 sm:gap-4 mb-6">
              <button
                onClick={() => setNotificationType('none')}
                className={`py-3 px-4 rounded-lg border flex flex-col items-center justify-center transition-all font-medium ${notificationType === 'none' ? 'bg-theme-primary/10 border-theme-primary text-theme-primary shadow-inner shadow-theme-primary/10' : 'bg-theme-bg-dark border-theme-border text-theme-muted hover:border-theme-primary/50'}`}
              >{t("onboarding.none") || "None"}</button>
              <button
                onClick={() => setNotificationType('discord')}
                className={`py-3 px-4 rounded-lg border flex flex-col items-center justify-center transition-all font-medium ${notificationType === 'discord' ? 'bg-[#5865F2]/10 border-[#5865F2] text-[#5865F2] shadow-inner shadow-[#5865F2]/10' : 'bg-theme-bg-dark border-theme-border text-theme-muted hover:border-[#5865F2]/50'}`}
              >{t("onboarding.discord")}</button>
              <button
                onClick={() => setNotificationType('apprise')}
                className={`py-3 px-4 rounded-lg border flex flex-col items-center justify-center transition-all font-medium ${notificationType === 'apprise' ? 'bg-green-500/10 border-green-500 text-green-500 shadow-inner shadow-green-500/10' : 'bg-theme-bg-dark border-theme-border text-theme-muted hover:border-green-500/50'}`}
              >{t("onboarding.apprise")}</button>
            </div>

            {notificationType === 'discord' && (
              <div className="p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 animate-fade-in">
                <label className="block text-sm font-medium text-white mb-2">{t("onboarding.discordWebhookUrl")}</label>
                <ClearableInput value={config.Discord} onChange={val => handleChange("Discord", val)} placeholder={t("onboarding.discordWebhookUrlExample") || "https://discordapp.com/api/webhooks/..."} />

                <div className="mt-4 pt-4 border-t border-theme-border/30">
                  <label className="block text-sm font-medium text-white mb-2">{t("onboarding.discordBotName")}</label>
                <ClearableInput value={config.DiscordUserName} onChange={val => handleChange("DiscordUserName", val)} placeholder="" />
                </div>
              </div>
            )}

            {notificationType === 'apprise' && (
              <div className="p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 animate-fade-in">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-white flex items-center">{t("onboarding.appriseUrl")}</label>
                  <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noreferrer" className="text-xs text-theme-primary flex items-center hover:underline">{t("onboarding.howToGuide")}<ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </div>
                <ClearableInput value={config.AppriseUrl} onChange={val => handleChange("AppriseUrl", val)} placeholder={t("onboarding.discordWebhookUrlExample")} />
                <p className="text-xs text-theme-muted mt-2">{t("onboarding.usesAppriseSupportsDiscord")}</p>
                <div className="mt-4 flex justify-end">
                  <ValidateButton type="apprise" config={config} label={t("onboarding.testConnection")} disabled={!config.AppriseUrl} />
                </div>
              </div>
            )}

            {/* Uptime Kuma Section */}
            <div className="mt-8 border-t border-theme-border/50 pt-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.uptimeKumaHealthCheck")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.sendPushNotificationToUptimeKuma")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.UseUptimeKuma === "true"} onChange={e => handleChange("UseUptimeKuma", e.target.checked ? "true" : "false")} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>

              {config.UseUptimeKuma === "true" && (
                <div className="p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 animate-fade-in">
                  <label className="block text-sm font-medium text-white mb-2">{t("onboarding.pushUrl")}</label>
                  <ClearableInput value={config.UptimeKumaUrl} onChange={val => handleChange("UptimeKumaUrl", val)} placeholder={t("onboarding.uptimeKumaPushUrlExample")} />
                  <div className="mt-4 flex justify-end">
                    <ValidateButton type="uptimekuma" config={config} label={t("onboarding.testConnection")} disabled={!config.UptimeKumaUrl} />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 6: // Schedule
        return (
          <div className="space-y-6 animate-fade-in">
            <h3 className="text-2xl font-bold text-white mb-2">{t("onboarding.automatedSchedule")}</h3>
            <p className="text-theme-muted mb-6">{t("onboarding.configureWhenPosterizarrShouldRun") || "Configure exactly when Posterizarr should run."}</p>

            <div className="space-y-5">
              <div className="flex items-center justify-between p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50">
                <div>
                  <h4 className="font-semibold text-white">{t("onboarding.enableAutomation")}</h4>
                  <p className="text-sm text-theme-muted">{t("onboarding.turnOnScheduler")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={enableSchedule} onChange={e => setEnableSchedule(e.target.checked)} />
                  <div className="w-11 h-6 bg-theme-bg peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                </label>
              </div>

              {enableSchedule && (
                <div className="p-4 bg-theme-bg/50 rounded-xl border border-theme-border/50 animate-fade-in space-y-4">
                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Time Input */}
                    {frequency !== "interval" && (
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-white mb-2">{t("onboarding.timeHhMm")}</label>
                        <input type="time" className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-semibold focus:border-theme-primary focus:ring-1 focus:ring-theme-primary" value={newTime} onChange={e => setNewTime(e.target.value)} required />
                      </div>
                    )}

                    {/* Mode Selector */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-white mb-2">{t("onboarding.runMode")}</label>
                      <select value={newMode} onChange={(e) => setNewMode(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary appearance-none">
                        {runModes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>

                    {/* Frequency Selector */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-white mb-2">{t("onboarding.frequency")}</label>
                      <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary appearance-none">
                        {frequencies.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Interval specifics */}
                    {frequency === "interval" && (
                      <div className="flex-1 flex gap-2">
                        <div className="flex-1">
                           <label className="block text-sm font-medium text-white mb-2">{t("onboarding.every")}</label>
                           <input type="number" min="1" value={intervalValue} onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value) || 1))} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary" />
                        </div>
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-white mb-2">{t("onboarding.unit")}</label>
                          <select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary appearance-none">
                            {intervalUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Monthly specifics */}
                    {frequency === "monthly" && (
                      <div className="flex-1 flex gap-2">
                         <div className="flex-1">
                           <label className="block text-sm font-medium text-white mb-2">Month</label>
                           <select value={newMonth} onChange={(e) => setNewMonth(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary appearance-none">
                             {months.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                           </select>
                         </div>
                         <div className="flex-1">
                           <label className="block text-sm font-medium text-white mb-2">{t("onboarding.daysOfMonth")}</label>
                           <input type="text" placeholder={t("onboarding.eg1_15_30")} value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary placeholder-gray-500" />
                         </div>
                      </div>
                    )}

                    {/* Weekly specifics */}
                    {frequency === "weekly" && (
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-white mb-2">{t("onboarding.dayOfWeek")}</label>
                        <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="w-full bg-white border border-transparent hover:bg-gray-50 transition-all rounded-lg px-4 py-2.5 text-gray-900 font-medium focus:border-theme-primary focus:ring-1 focus:ring-theme-primary appearance-none">
                          {daysOfWeek.map(day => <option key={day.id} value={day.id}>{day.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Logo Updater Options */}
                  {newMode === "logoupdater" && (
                    <div className="flex flex-col md:flex-row gap-4 p-4 mt-4 bg-[#8b5cf6]/10 border border-[#8b5cf6]/30 rounded-lg">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-[#c4b5fd] mb-1">{t("onboarding.plexLibrary")}</label>
                        <input type="text" value={logoLibrary} onChange={(e) => setLogoLibrary(e.target.value)} placeholder={t("onboarding.libraryNameOrAll")} className="w-full px-3 py-2 bg-white border border-transparent hover:bg-gray-50 transition-all rounded-md text-sm text-gray-900 font-medium focus:outline-none focus:ring-1 focus:border-theme-primary focus:ring-theme-primary placeholder-gray-500" />
                      </div>
                      <div className="flex items-center gap-6 pt-5">
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input type="checkbox" checked={logoForceReplace} onChange={(e) => setLogoForceReplace(e.target.checked)} disabled={logoRevert} className="w-4 h-4 rounded border-theme-border bg-theme-bg-dark text-[#8b5cf6] focus:ring-[#8b5cf6]" />
                          <span className={`text-sm ${logoRevert ? 'text-theme-muted' : 'text-white group-hover:text-[#c4b5fd]'} transition-colors`}>{t("onboarding.forceReplace")}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input type="checkbox" checked={logoExifCheck} onChange={(e) => setLogoExifCheck(e.target.checked)} disabled={logoRevert} className="w-4 h-4 rounded border-theme-border bg-theme-bg-dark text-[#8b5cf6] focus:ring-[#8b5cf6]" />
                          <span className={`text-sm ${logoRevert ? 'text-theme-muted' : 'text-white group-hover:text-[#c4b5fd]'} transition-colors`}>EXIF Check</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input type="checkbox" checked={logoRevert} onChange={(e) => setLogoRevert(e.target.checked)} className="w-4 h-4 rounded border-theme-border bg-theme-bg-dark text-[#8b5cf6] focus:ring-[#8b5cf6]" />
                          <span className="text-sm text-white group-hover:text-[#c4b5fd] transition-colors">{t("onboarding.revertMode")}</span>
                        </label>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>
        );
      case 7: // Finish
        return (
          <div className="flex flex-col items-center justify-center text-center space-y-6 animate-fade-in py-10">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-4 text-green-500 ring-4 ring-green-500/10">
              <Check className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-bold text-white">{t("onboarding.allSet")}</h2>
            <p className="text-theme-muted max-w-md">{t("onboarding.yourConfigurationHasBeenPrepared")}</p>
            <div className="mt-8 p-4 bg-theme-bg/50 rounded-xl border border-theme-border text-sm text-theme-muted inline-flex items-center">
              <Shield className="w-4 h-4 mr-2 text-theme-primary" />{t("onboarding.changeSettingsAnytime")}</div>
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans"
        style={{
          '--theme-primary': '#e5a00d',
          '--theme-primary-hover': '#cc8f0c',
          '--theme-accent': '#ffc107'
        }}
      >
        <div className="flex flex-col items-center">
          <Loader2 className="w-10 h-10 animate-spin text-theme-primary mb-4" />
          <p className="text-white font-medium">{t("onboarding.preparingEnvironment")}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-dialog-backdrop fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans"
      style={{
        '--theme-primary': '#e5a00d',
        '--theme-primary-hover': '#cc8f0c',
        '--theme-accent': '#ffc107'
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Posterizarr setup" className="app-dialog-panel bg-theme-bg-dark w-full min-w-0 max-w-5xl rounded-lg shadow-2xl border border-theme-border/50 overflow-hidden flex flex-col md:flex-row h-[calc(100dvh-2rem)] max-h-[700px] animate-scale-in">

        {/* Left Sidebar - Stepper */}
        <div className="w-full md:w-64 bg-theme-bg-dark border-r border-theme-border/30 p-6 flex flex-col shrink-0 hidden md:flex">
          <div className="mb-8">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center">
              <Rocket className="w-6 h-6 mr-2 text-theme-primary" />
              Posterizarr
            </h1>
          </div>

          <div className="flex-1 space-y-1">
            {STEPS.map((step, index) => {
              const isActive = index === currentStep;
              const isPast = index < currentStep;
              return (
                <div
                  key={step.id}
                  className={`flex items-center px-4 py-3 rounded-xl transition-all duration-300 ${
                    isActive ? "bg-theme-primary/10 text-theme-primary" :
                    isPast ? "text-white hover:bg-theme-bg/50 cursor-pointer" : "text-theme-muted"
                  }`}
                  onClick={() => isPast && setCurrentStep(index)}
                >
                  <div className={`mr-3 ${isActive ? "text-theme-primary" : isPast ? "text-green-500" : "text-theme-muted"}`}>
                    {isPast ? <Check className="w-5 h-5" /> : step.icon}
                  </div>
                  <span className={`font-medium ${isActive ? "font-semibold" : ""}`}>{step.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content Area */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden bg-gradient-to-br from-theme-darker to-theme-dark h-full">
              {/* Language Switcher */}
              <div className="hidden md:block absolute top-4 right-6 z-50">
                <LanguageSwitcher compact={true} />
              </div>

            {/* Mobile Stepper (visible only on small screens) */}
            <div className="md:hidden flex gap-3 p-4 border-b border-theme-border/30 items-center justify-between bg-theme-bg-dark shrink-0">
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-theme-primary">Step {currentStep + 1} of {STEPS.length}</span>
                <span className="block text-sm text-theme-muted break-words">{STEPS[currentStep].title}</span>
              </div>
              <LanguageSwitcher compact={true} />
            </div>

            <div className="flex-1 min-h-0 p-4 sm:p-6 md:p-8 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-theme-border scrollbar-track-transparent">
              {renderStepContent()}
            </div>

            {/* Footer Actions */}
            <div className="app-dialog-actions px-4 sm:px-6 py-3 sm:py-4 bg-theme-bg-dark border-t border-theme-border/30 flex flex-wrap gap-2 justify-between items-center shrink-0">
              <button
                onClick={handlePrev}
                disabled={currentStep === 0 || saving}
                className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                  currentStep === 0
                    ? "opacity-0 cursor-default"
                    : "text-theme-muted hover:text-white hover:bg-theme-bg"
                }`}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />{t("onboarding.back")}</button>

              {currentStep < STEPS.length - 1 ? (
                <button
                  onClick={handleNext}
                  disabled={
                    (currentStep === 1 && !((plexValidated && plexLibsValid) || (jellyfinValidated && jellyfinLibsValid) || (embyValidated && embyLibsValid))) ||
                    (currentStep === 2 && (!config.tmdbtoken || !config.tvdbapi || !config.FanartTvAPIKey))
                  }
                  className="flex items-center px-5 py-2 bg-theme-primary text-black rounded-lg font-semibold shadow-md shadow-theme-primary/20 hover:bg-theme-accent hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >{t("onboarding.continue")}<ChevronRight className="w-4 h-4 ml-1" />
                </button>
              ) : (
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="flex items-center px-6 py-2 bg-gradient-to-r from-theme-primary to-theme-accent text-black rounded-lg font-bold shadow-md shadow-theme-primary/30 hover:shadow-theme-primary/50 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {saving ? (
                    <span className="flex items-center">
                      <Activity className="w-4 h-4 mr-2 animate-spin" />{t("onboarding.saving")}</span>
                  ) : (
                    <span className="flex items-center">{t("onboarding.finishSetup")}<Save className="w-4 h-4 ml-2" />
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}

