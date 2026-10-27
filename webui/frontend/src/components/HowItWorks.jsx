import React, { useState } from "react";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  Layers,
  Download,
  Image,
  Sparkles,
  Upload,
  Database,
  Zap,
  CheckCircle,
  ChevronRight,
  FileImage,
  Globe,
  Server,
  RefreshCw,
  Shield,
  Palette,
  Film,
  Tv,
  Layout,
  ArrowRight,
  Eye,
  ExternalLink,
  Webhook,
  FileCode,
  Radio,
} from "lucide-react";
import { useTranslation } from "react-i18next";

function HowItWorks() {
  const { t } = useTranslation();
  const [expandedStep, setExpandedStep] = useState(null);
  const [integrationMethod, setIntegrationMethod] = useState("webhook"); // 'webhook' or 'script'

  const workflowSteps = [
    {
      id: 1,
      title: t("howItWorks.steps.libraryScanning.title"),
      icon: Database,
      description: t("howItWorks.steps.libraryScanning.description"),
      details: t("howItWorks.steps.libraryScanning.details", {
        returnObjects: true,
      }),
    },
    {
      id: 2,
      title: t("howItWorks.steps.artworkDiscovery.title"),
      icon: Globe,
      description: t("howItWorks.steps.artworkDiscovery.description"),
      details: t("howItWorks.steps.artworkDiscovery.details", {
        returnObjects: true,
      }),
    },
    {
      id: 3,
      title: t("howItWorks.steps.imageProcessing.title"),
      icon: Sparkles,
      description: t("howItWorks.steps.imageProcessing.description"),
      details: t("howItWorks.steps.imageProcessing.details", {
        returnObjects: true,
      }),
    },
    {
      id: 4,
      title: t("howItWorks.steps.assetOrganization.title"),
      icon: Layers,
      description: t("howItWorks.steps.assetOrganization.description"),
      details: t("howItWorks.steps.assetOrganization.details", {
        returnObjects: true,
      }),
    },
    {
      id: 5,
      title: t("howItWorks.steps.mediaServerUpload.title"),
      icon: Upload,
      description: t("howItWorks.steps.mediaServerUpload.description"),
      details: t("howItWorks.steps.mediaServerUpload.details", {
        returnObjects: true,
      }),
    },
  ];

  const supportedTypes = [
    {
      icon: FileImage,
      title: t("howItWorks.assetTypes.posters.title"),
      description: t("howItWorks.assetTypes.posters.description"),
    },
    {
      icon: Image,
      title: t("howItWorks.assetTypes.backgrounds.title"),
      description: t("howItWorks.assetTypes.backgrounds.description"),
    },
    {
      icon: Tv,
      title: t("howItWorks.assetTypes.seasons.title"),
      description: t("howItWorks.assetTypes.seasons.description"),
    },
    {
      icon: Film,
      title: t("howItWorks.assetTypes.titleCards.title"),
      description: t("howItWorks.assetTypes.titleCards.description"),
    },
  ];

  const keyFeatures = [
    {
      icon: Zap,
      title: t("howItWorks.features.multiSource.title"),
      text: t("howItWorks.features.multiSource.text"),
    },
    {
      icon: Palette,
      title: t("howItWorks.features.customOverlays.title"),
      text: t("howItWorks.features.customOverlays.text"),
    },
    {
      icon: Shield,
      title: t("howItWorks.features.smartFiltering.title"),
      text: t("howItWorks.features.smartFiltering.text"),
    },
    {
      icon: RefreshCw,
      title: t("howItWorks.features.autoSync.title"),
      text: t("howItWorks.features.autoSync.text"),
    },
    {
      icon: Layout,
      title: t("howItWorks.features.kometaCompatible.title"),
      text: t("howItWorks.features.kometaCompatible.text"),
    },
    {
      icon: Server,
      title: t("howItWorks.features.crossPlatform.title"),
      text: t("howItWorks.features.crossPlatform.text"),
    },
  ];

  return (
    <div className="workspace-page space-y-6">
      {/* Header */}
      <WorkspaceHeader icon={Zap} title={t("howItWorks.header.title")} />

      {/* Workflow Steps */}
      <div className="workspace-section space-y-6">
        <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
          <Zap className="w-6 h-6 text-theme-primary" />
          {t("howItWorks.workflow.title")}
        </h2>

        <div className="space-y-4">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon;
            const isExpanded = expandedStep === step.id;

            return (
              <div key={step.id} className="relative">
                {/* Connection Line */}
                {index < workflowSteps.length - 1 && (
                  <div className="absolute left-8 sm:left-8 top-20 w-0.5 h-8 bg-theme-border" />
                )}

                <div
                  className="bg-theme-hover border border-theme rounded-lg p-5 transition-all duration-300 cursor-pointer hover:border-theme-primary/50"
                  onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                >
                  <div className="flex flex-col sm:flex-row items-start gap-4">
                    {/* Step Number & Icon */}
                    <div className="flex-shrink-0">
                      <div className="w-16 h-16 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center relative">
                        <Icon className="w-7 h-7 text-theme-primary" />
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-theme-primary rounded-full border-2 border-theme-card flex items-center justify-center">
                          <span className="text-xs font-bold text-white">
                            {step.id}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-2">
                        <h3 className="text-lg font-semibold text-theme-text break-words">
                          {step.title}
                        </h3>
                        <ChevronRight
                          className={`w-5 h-5 text-theme-muted transition-transform duration-300 flex-shrink-0 ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                      </div>
                      <p className="text-theme-muted text-sm mb-3 break-words">
                        {step.description}
                      </p>

                      {/* Expandable Details */}
                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isExpanded
                            ? "max-h-96 opacity-100 mt-4"
                            : "max-h-0 opacity-0"
                        }`}
                      >
                        <div className="space-y-2 pt-3 border-t border-theme">
                          {step.details.map((detail, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2 text-sm text-theme-text"
                            >
                              <CheckCircle className="w-4 h-4 flex-shrink-0 text-theme-primary mt-0.5" />
                              <span className="break-words">{detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Supported Asset Types */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-6">
        <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
          <Image className="w-6 h-6 text-theme-primary" />
          {t("howItWorks.assetTypes.title")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {supportedTypes.map((type, index) => {
            const Icon = type.icon;
            return (
              <div
                key={index}
                className="bg-theme-hover border border-theme rounded-lg p-4 hover:border-theme-primary/50 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center mb-3">
                  <Icon className="w-6 h-6 text-theme-primary" />
                </div>
                <h3 className="font-semibold text-theme-text mb-1 text-sm">
                  {type.title}
                </h3>
                <p className="text-xs text-theme-muted">{type.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key Features Grid */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-6">
        <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-theme-primary" />
          {t("howItWorks.features.title")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {keyFeatures.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="bg-theme-hover border border-theme rounded-lg p-4 hover:border-theme-primary/50 transition-all duration-300 group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <Icon className="w-5 h-5 text-theme-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-theme-text mb-1 text-sm">
                      {feature.title}
                    </h3>
                    <p className="text-xs text-theme-muted">{feature.text}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Media Server Plugins & Real-Time Sync */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
              <Server className="w-6 h-6 text-theme-primary" />
              {t("howItWorks.plugins.title", "Media Server Plugins & Real-Time Sync")}
            </h2>
            <p className="text-sm text-theme-muted mt-1">
              {t("howItWorks.plugins.subtitle", "Direct middleware plugins for Jellyfin and Emby that map local assets and listen for real-time WebSocket updates.")}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 w-fit">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            Live WebSocket
          </span>
        </div>

        {/* Plugin Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Jellyfin Card */}
          <div className="bg-theme-hover border border-theme rounded-xl p-6 flex flex-col justify-between hover:border-theme-primary/60 transition-all duration-300 group">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform duration-300">
                    <Server className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-theme-text">
                      {t("howItWorks.plugins.jellyfin.title", "Posterizarr for Jellyfin")}
                    </h3>
                    <span className="text-xs text-theme-muted font-mono">
                      {t("howItWorks.plugins.jellyfin.tag", "Jellyfin 10.11 / 12.0 (.NET 9 & 10)")}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-theme-primary/15 text-theme-primary border border-theme-primary/30">
                  {t("howItWorks.plugins.jellyfin.badge", "Official Plugin")}
                </span>
              </div>

              <p className="text-sm text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.jellyfin.description", "Acts as a local asset proxy for Jellyfin. Automatically maps posters, backgrounds, season posters, and titlecards from your shared /assets folder to library items.")}
              </p>

              <div className="space-y-2 pt-2 border-t border-theme">
                {t("howItWorks.plugins.jellyfin.features", { returnObjects: true })?.map((feat, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-theme-text">
                    <CheckCircle className="w-3.5 h-3.5 text-theme-primary flex-shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6">
              <a
                href="https://fscorrupt.github.io/posterizarr/jellyfin_plugin/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <span>{t("howItWorks.plugins.jellyfin.button", "Jellyfin Plugin Docs")}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Emby Card */}
          <div className="bg-theme-hover border border-theme rounded-xl p-6 flex flex-col justify-between hover:border-theme-primary/60 transition-all duration-300 group">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-400 group-hover:scale-105 transition-transform duration-300">
                    <Server className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-theme-text">
                      {t("howItWorks.plugins.emby.title", "Posterizarr for Emby")}
                    </h3>
                    <span className="text-xs text-theme-muted font-mono">
                      {t("howItWorks.plugins.emby.tag", "Emby Server (.NET 8)")}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-theme-primary/15 text-theme-primary border border-theme-primary/30">
                  {t("howItWorks.plugins.emby.badge", "Official Plugin")}
                </span>
              </div>

              <p className="text-sm text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.emby.description", "Ported middleware for Emby Server. Provides local asset mapping, scheduled background sync tasks, and instantaneous artwork updates via WebSockets.")}
              </p>

              <div className="space-y-2 pt-2 border-t border-theme">
                {t("howItWorks.plugins.emby.features", { returnObjects: true })?.map((feat, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-theme-text">
                    <CheckCircle className="w-3.5 h-3.5 text-theme-primary flex-shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6">
              <a
                href="https://fscorrupt.github.io/posterizarr/emby_plugin/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <span>{t("howItWorks.plugins.emby.button", "Emby Plugin Docs")}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Real-Time WebSocket Architecture Callout */}
        <div className="bg-theme-bg/60 border border-theme rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-theme pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-theme-text text-sm sm:text-base">
                {t("howItWorks.plugins.realtimeBridge.title", "How Real-Time WebSocket Sync Works")}
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 w-fit">
              {t("howItWorks.plugins.realtimeBridge.badge", "Instant Push Bridge")}
            </span>
          </div>

          <p className="text-xs sm:text-sm text-theme-muted">
            {t("howItWorks.plugins.realtimeBridge.description", "Posterizarr provides an active event stream so Jellyfin and Emby stay synchronized immediately without waiting for daily scheduled tasks or manual triggers:")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-theme-hover border border-theme space-y-1">
              <div className="font-semibold text-theme-primary flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-theme-primary/20 flex items-center justify-center text-[10px] font-bold">1</span>
                Asset Action
              </div>
              <p className="text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.realtimeBridge.step1", "Save or overlay-process any poster, background, season, or titlecard in Posterizarr WebUI.")}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-theme-hover border border-theme space-y-1">
              <div className="font-semibold text-theme-primary flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-theme-primary/20 flex items-center justify-center text-[10px] font-bold">2</span>
                WebSocket Broadcast
              </div>
              <p className="text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.realtimeBridge.step2", "Posterizarr dispatches an asset_updated payload over WebSocket (/ws/events).")}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-theme-hover border border-theme space-y-1">
              <div className="font-semibold text-theme-primary flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-theme-primary/20 flex items-center justify-center text-[10px] font-bold">3</span>
                Security Validation
              </div>
              <p className="text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.realtimeBridge.step3", "Plugin authenticates via X-API-Key HTTP header and validates paths against directory traversal (CWE-22).")}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-theme-hover border border-theme space-y-1">
              <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold">4</span>
                Instant Media Refresh
              </div>
              <p className="text-theme-muted leading-relaxed">
                {t("howItWorks.plugins.realtimeBridge.step4", "The plugin updates the target Movie, Series, Season, or Episode immediately and caches its hash.")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 pt-2 text-xs text-theme-muted bg-theme-card/50 p-3 rounded-lg border border-theme">
            <Shield className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
            <span>
              {t("howItWorks.plugins.realtimeBridge.note", "Independent Operation: Even if Posterizarr is configured with Plex enabled and Jellyfin/Emby disabled, the plugins monitor the shared /assets folder via WebSocket and update artwork seamlessly.")}
            </span>
          </div>
        </div>
      </div>

      {/* Getting Started CTA */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-theme-text">
            {t("howItWorks.cta.title")}
          </h2>
          <p className="text-theme-muted mt-2">
            {t("howItWorks.cta.selectMethod")}
          </p>
        </div>

        {/* Integration Selection Toggle */}
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <button
            onClick={() => setIntegrationMethod("webhook")}
            className={`flex items-center gap-3 px-6 py-4 rounded-lg border transition-all duration-200 ${
              integrationMethod === "webhook"
                ? "bg-theme-primary/20 border-theme-primary text-theme-text shadow-sm"
                : "bg-theme-bg border-theme hover:border-theme-primary/50 text-theme-muted hover:text-theme-text"
            }`}
          >
            <div className="p-2 rounded-full bg-theme-primary/10 text-theme-primary">
              <Webhook className="w-6 h-6" />
            </div>
            <div className="text-left">
              <div className="font-semibold">{t("howItWorks.integration.webhook")}</div>
              <div className="text-xs opacity-75">{t("howItWorks.integration.recommended")}</div>
            </div>
          </button>

          <button
            onClick={() => setIntegrationMethod("script")}
            className={`flex items-center gap-3 px-6 py-4 rounded-lg border transition-all duration-200 ${
              integrationMethod === "script"
                ? "bg-theme-primary/20 border-theme-primary text-theme-text shadow-sm"
                : "bg-theme-bg border-theme hover:border-theme-primary/50 text-theme-muted hover:text-theme-text"
            }`}
          >
            <div className="p-2 rounded-full bg-theme-primary/10 text-theme-primary">
              <FileCode className="w-6 h-6" />
            </div>
            <div className="text-left">
              <div className="font-semibold">{t("howItWorks.integration.script")}</div>
              <div className="text-xs opacity-75">{t("howItWorks.integration.legacy")}</div>
            </div>
          </button>
        </div>

        {/* Dynamic CTA Content */}
        <div className="pt-2 text-center space-y-4">
          <p className="text-sm text-theme-muted">
            {integrationMethod === "webhook"
              ? t("howItWorks.integration.webhookDesc")
              : t("howItWorks.integration.scriptDesc")}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {integrationMethod === "webhook" ? (
              <>
                <a
                  href="https://fscorrupt.github.io/posterizarr/modes#sonarrradarr-mode-native-webhook"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg font-medium transition-colors duration-200 flex items-center gap-2"
                >
                  {t("howItWorks.cta.setupSonarrRadarr")}
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="https://fscorrupt.github.io/posterizarr/modes#tautulli-mode-native-webhook"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-theme-hover hover:bg-theme-primary/20 text-theme-text rounded-lg font-medium transition-colors duration-200 flex items-center gap-2 border border-theme"
                >
                  {t("howItWorks.cta.setupTautulli")}
                  <ArrowRight className="w-4 h-4" />
                </a>
              </>
            ) : (
              <>
                <a
                  href="https://fscorrupt.github.io/posterizarr/modes#sonarrradarr-mode-docker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg font-medium transition-colors duration-200 flex items-center gap-2"
                >
                  {t("howItWorks.cta.setupArrScript")}
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="https://fscorrupt.github.io/posterizarr/modes#tautulli-mode-docker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-theme-hover hover:bg-theme-primary/20 text-theme-text rounded-lg font-medium transition-colors duration-200 flex items-center gap-2 border border-theme"
                >
                  {t("howItWorks.cta.setupTautulliDocker")}
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="https://fscorrupt.github.io/posterizarr/modes#tautulli-mode-windows"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-theme-hover hover:bg-theme-primary/20 text-theme-text rounded-lg font-medium transition-colors duration-200 flex items-center gap-2 border border-theme"
                >
                  {t("howItWorks.cta.setupTautulliWin")}
                  <ArrowRight className="w-4 h-4" />
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Technical Details */}
      <div className="bg-theme-card border border-theme rounded-lg p-6 space-y-4">
        <h3 className="text-xl font-bold text-theme-text flex items-center gap-2">
          <Server className="w-6 h-6 text-theme-primary" />
          {t("howItWorks.technical.title")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.smartCaching"),
                }}
              />
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.hashValidation"),
                }}
              />
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.rtlSupport"),
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.backupMode"),
                }}
              />
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.automatedCleanup"),
                }}
              />
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
              <span
                className="text-theme-text"
                dangerouslySetInnerHTML={{
                  __html: t("howItWorks.technical.multipleTriggers"),
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HowItWorks;