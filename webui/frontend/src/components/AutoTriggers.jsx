import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import {
  Zap,
  Activity,
  Tv,
  Film,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Code,
  Terminal,
  Server,
  Settings,
  FileCode,
  Info,
  Copy,
  Check,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Save,
  TestTube2,
} from "lucide-react";

// Helper function to handle robust copying to clipboard (with fallback)
const robustCopy = (code, id, setCopiedCodeState) => {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopiedCodeState(id);
        setTimeout(() => setCopiedCodeState(null), 2000);
      })
      .catch((err) => {
        console.error("Failed to copy with navigator.clipboard", err);
      });
  } else {
    let textArea;
    try {
      textArea = document.createElement("textarea");
      textArea.value = code;
      textArea.style.position = "fixed";
      textArea.style.top = 0;
      textArea.style.left = 0;
      textArea.style.width = "2em";
      textArea.style.height = "2em";
      textArea.style.padding = 0;
      textArea.style.border = "none";
      textArea.style.outline = "none";
      textArea.style.boxShadow = "none";
      textArea.style.background = "transparent";

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      if (successful) {
        setCopiedCodeState(id);
        setTimeout(() => setCopiedCodeState(null), 2000);
      }
    } catch (err) {
      console.error("Fallback copy exception", err);
    } finally {
      if (textArea) {
        document.body.removeChild(textArea);
      }
    }
  }
};

// Helper function to render step title with optional download button
const StepTitle = ({ step, onDownload }) => {
  // Safe check for title string
  const titleStr = step?.title?.toString() || "";
  const showDownloadButton = titleStr.includes("Download the Trigger Script");

  return (
    <div className="flex items-start justify-between mb-2 gap-2">
      <h3 className="text-base sm:text-lg font-semibold text-theme-text break-words leading-tight flex-1">
        {titleStr}
      </h3>
      <div className="flex items-center gap-2">
        {showDownloadButton && onDownload && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="px-3 py-1.5 bg-theme-primary hover:bg-theme-primary/80 text-white rounded-lg transition-colors flex items-center gap-2 text-xs sm:text-sm font-medium flex-shrink-0"
            title="Download script"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
        )}
      </div>
    </div>
  );
};

// --- New Webhook Component for Arr Apps ---
function WebhookSetupContent({ type }) {
  const { t } = useTranslation();
  const [copiedCode, setCopiedCode] = useState(null);

  const webhookSteps = [
    {
        title: t("autoTriggers.webhookSetup.steps.open", { type }),
        description: t("autoTriggers.webhookSetup.steps.openDesc", { type }),
        substeps: [t("autoTriggers.webhookSetup.steps.connect"), t("autoTriggers.webhookSetup.steps.add")]
    },
    {
        title: t("autoTriggers.webhookSetup.steps.config"),
        description: t("autoTriggers.webhookSetup.steps.configDesc"),
        code: [
            { label: "Name", content: "Posterizarr" },
            { label: "On Import / On Upgrade", content: "Yes" },
            { label: "URL", content: "http://YOUR_POSTERIZARR_IP:8000/api/webhook/arr?api_key=YOUR_API_KEY" },
            { label: "Method", content: "POST" }
        ],
        info: t("autoTriggers.webhookSetup.steps.authInfo")
    }
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 sm:p-4 flex gap-3">
        <Zap className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs sm:text-sm text-theme-text">
            <strong>{t("autoTriggers.modes.webhookRecommended")}:</strong> {t("autoTriggers.webhookSetup.recommendedNote")}
        </p>
      </div>

      <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
        <h2 className="text-xl sm:text-2xl font-bold text-theme-text mb-4 sm:mb-6 flex items-center gap-2">
            <Globe className="w-5 h-5 sm:w-6 sm:h-6 text-theme-primary" />
            {t("autoTriggers.setupSteps")}
        </h2>

        <div className="space-y-4">
            {webhookSteps.map((step, index) => (
                <div key={index} className="relative">
                    {index < webhookSteps.length - 1 && (
                        <div className="absolute left-6 sm:left-8 top-16 sm:top-20 w-0.5 h-6 sm:h-8 bg-theme-border" />
                    )}
                    <div className="bg-theme-hover border border-theme rounded-lg p-3 sm:p-5">
                        <div className="flex items-start gap-3 sm:gap-4">
                            <div className="flex-shrink-0">
                                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center relative">
                                    <CheckCircle className="w-5 h-5 sm:w-7 sm:h-7 text-theme-primary" />
                                    <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 w-5 h-5 sm:w-6 sm:h-6 bg-theme-primary rounded-full border-2 border-theme-card flex items-center justify-center">
                                        <span className="text-[10px] sm:text-xs font-bold text-white">{index + 1}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <StepTitle step={step} />
                                <p className="text-theme-muted text-xs sm:text-sm mb-3 leading-relaxed">{step.description}</p>

                                {step.substeps && (
                                    <div className="space-y-1.5 pl-3 border-l-2 border-theme-primary/30 mb-3">
                                        {step.substeps.map((ss, si) => (
                                            <div key={si} className="flex items-center gap-2 text-xs sm:text-sm text-theme-text">
                                                <CheckCircle className="w-4 h-4 text-theme-primary flex-shrink-0" /> {ss}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {step.info && (
                                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 sm:p-3 mb-3">
                                        <div className="flex items-start gap-2">
                                            <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5" />
                                            <p className="text-xs sm:text-sm text-theme-text leading-relaxed">{step.info}</p>
                                        </div>
                                    </div>
                                )}

                                {step.code && (
                                    <div className="space-y-3 mt-4 pt-4 border-t border-theme">
                                        {step.code.map((c, ci) => (
                                            <div key={ci} className="space-y-1.5">
                                                <span className="text-[10px] uppercase font-bold text-theme-muted">{c.label}</span>
                                                <div className="relative">
                                                    <pre className="bg-theme-bg-dark p-3 rounded border border-theme text-xs break-all text-theme-text">{c.content}</pre>
                                                    <button
                                                        onClick={() => robustCopy(c.content, `web-${index}-${ci}`, setCopiedCode)}
                                                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-theme-card hover:bg-theme-hover transition-colors"
                                                    >
                                                        {copiedCode === `web-${index}-${ci}` ? <Check className="w-4 h-4 text-green-500"/> : <Copy className="w-4 h-4 text-theme-muted"/>}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// --- Combined Arr Content Component ---
function ArrContent({ type }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("webhook");
  const [copiedCode, setCopiedCode] = useState(null);

  const handleCopyCode = (code, id) => {
    robustCopy(code, id, setCopiedCode);
  };

  const handleDownloadScript = () => {
    const url = "https://github.com/fscorrupt/posterizarr/blob/main/modules/ArrTrigger.sh";
    window.open(url, "_blank");
  };

  const steps = t(`autoTriggers.${type.toLowerCase()}.steps`, { returnObjects: true }) || [];

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="bg-theme-card border border-theme rounded-lg p-6">
        <h2 className="text-xl font-bold text-theme-text mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-theme-primary" />
          {t("autoTriggers.modes.selectIntegration")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setMode("webhook")}
            className={`p-5 rounded-lg border-2 text-left transition-all duration-300 ${
              mode === "webhook"
                ? "border-theme-primary bg-theme-primary/10"
                : "border-theme hover:border-theme-primary/50"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <Globe className={`w-8 h-8 ${mode === "webhook" ? "text-theme-primary" : "text-theme-muted"}`} />
              <div className="flex flex-col">
                <span className={`font-semibold text-lg ${mode === "webhook" ? "text-theme-text" : "text-theme-muted"}`}>
                  {t("autoTriggers.modes.webhook")}
                </span>
                <span className="text-[10px] bg-theme-primary text-white px-2 py-0.5 rounded-full font-bold w-fit mt-1 uppercase">
                  {t("autoTriggers.modes.webhookRecommended")}
                </span>
              </div>
            </div>
            <p className="text-xs text-theme-muted">{t("autoTriggers.modes.webhookDesc")}</p>
          </button>

          <button
            onClick={() => setMode("script")}
            className={`p-5 rounded-lg border-2 text-left transition-all duration-300 ${
              mode === "script"
                ? "border-theme-primary bg-theme-primary/10"
                : "border-theme hover:border-theme-primary/50"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <Terminal className={`w-8 h-8 ${mode === "script" ? "text-theme-primary" : "text-theme-muted"}`} />
              <div className="flex flex-col">
                <span className={`font-semibold text-lg ${mode === "script" ? "text-theme-text" : "text-theme-muted"}`}>
                  {t("autoTriggers.modes.script")}
                </span>
                <span className="text-[10px] bg-theme-muted text-white px-2 py-0.5 rounded-full font-bold w-fit mt-1 uppercase">
                  {t("autoTriggers.modes.scriptLegacy")}
                </span>
              </div>
            </div>
            <p className="text-xs text-theme-muted">{t("autoTriggers.modes.scriptDesc")}</p>
          </button>
        </div>
      </div>

      {mode === "webhook" ? (
        <WebhookSetupContent type={type} />
      ) : (
        <>
            {/* Requirements Alert */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 sm:p-4">
                <div className="flex items-start gap-2 sm:gap-3">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-semibold text-theme-text mb-1 text-sm sm:text-base">
                            {t(`autoTriggers.${type.toLowerCase()}.requirements.title`)}
                        </h3>
                        <p className="text-xs sm:text-sm text-theme-muted">
                            {t(`autoTriggers.${type.toLowerCase()}.requirements.description`)}
                        </p>
                    </div>
                </div>
            </div>

            {/* How It Works */}
            <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-bold text-theme-text mb-3 sm:mb-4 flex items-center gap-2">
                    <Info className="w-4 h-4 sm:w-5 sm:h-5 text-theme-primary" />
                    {t("autoTriggers.howItWorks")}
                </h2>
                <div className="space-y-2 sm:space-y-3 text-xs sm:text-sm text-theme-muted">
                    {t(`autoTriggers.${type.toLowerCase()}.howItWorks`, { returnObjects: true }).map(
                        (item, index) => (
                            <div key={index} className="flex items-start gap-2">
                                <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-theme-primary flex-shrink-0 mt-0.5" />
                                <span className="leading-relaxed">{item}</span>
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Setup Steps (Script Mode) */}
            <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
                <h2 className="text-xl sm:text-2xl font-bold text-theme-text mb-4 sm:mb-6 flex items-center gap-2">
                    <FileCode className="w-5 h-5 sm:w-6 sm:h-6 text-theme-primary" />
                    {t("autoTriggers.setupSteps")}
                </h2>

                <div className="space-y-3 sm:space-y-4">
                    {steps.map((step, index) => {
                        const hasCode = step.code && step.code.length > 0;
                        return (
                            <div key={index} className="relative">
                                {index < steps.length - 1 && (
                                    <div className="absolute left-6 sm:left-8 top-16 sm:top-20 w-0.5 h-6 sm:h-8 bg-theme-border" />
                                )}
                                <div className="bg-theme-hover border border-theme rounded-lg p-3 sm:p-5">
                                    <div className="flex items-start gap-3 sm:gap-4">
                                        <div className="flex-shrink-0">
                                            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center relative">
                                                <CheckCircle className="w-5 h-5 sm:w-7 sm:h-7 text-theme-primary" />
                                                <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 w-5 h-5 sm:w-6 sm:h-6 bg-theme-primary rounded-full border-2 border-theme-card flex items-center justify-center">
                                                    <span className="text-[10px] sm:text-xs font-bold text-white">{index + 1}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <StepTitle step={step} onDownload={handleDownloadScript} />
                                            <p className="text-theme-muted text-xs sm:text-sm mb-2 break-words leading-relaxed">{step.description}</p>

                                            {step.warning && (
                                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 sm:p-3 mb-2">
                                                    <div className="flex items-start gap-2">
                                                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
                                                        <p className="text-xs sm:text-sm text-theme-text leading-relaxed">{step.warning}</p>
                                                    </div>
                                                </div>
                                            )}

                                            {hasCode && (
                                                <div className="space-y-2 sm:space-y-3 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-theme">
                                                    {step.code.map((codeBlock, codeIndex) => (
                                                        <div key={codeIndex} className="space-y-1.5 sm:space-y-2">
                                                            {codeBlock.label && <p className="text-xs sm:text-sm font-medium text-theme-text">{codeBlock.label}</p>}
                                                            <div className="relative">
                                                                <pre className="bg-theme-bg-dark border border-theme rounded-lg p-3 overflow-x-auto text-xs sm:text-sm text-theme-text">
                                                                    <code className="break-all">{codeBlock.content}</code>
                                                                </pre>
                                                                <button
                                                                    onClick={() => handleCopyCode(codeBlock.content, `${index}-${codeIndex}`)}
                                                                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-theme-card hover:bg-theme-hover transition-colors"
                                                                >
                                                                    {copiedCode === `${index}-${codeIndex}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-theme-muted" />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {step.substeps && (
                                                <div className="space-y-1.5 mt-2 pl-3 border-l-2 border-theme-primary/30">
                                                    {step.substeps.map((substep, subIndex) => (
                                                        <div key={subIndex} className="flex items-start gap-2">
                                                            <CheckCircle className="w-3.5 h-3.5 text-theme-primary mt-0.5" />
                                                            <span className="text-xs sm:text-sm text-theme-text leading-relaxed">{substep}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Resources (Script Mode) */}
            <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold text-theme-text mb-3 sm:mb-4 flex items-center gap-2">
                    <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5 text-theme-primary" />
                    {t("autoTriggers.resources.title")}
                </h3>
                <div className="space-y-2">
                    <a
                        href={type === "sonarr" ? "https://wiki.servarr.com/sonarr/settings#connect" : "https://wiki.servarr.com/radarr/settings#connect"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-theme-primary hover:underline text-xs sm:text-sm"
                    >
                        <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {type === "sonarr" ? t("autoTriggers.resources.sonarrWiki") : t("autoTriggers.resources.radarrWiki")}
                    </a>
                    <a
                        href="https://github.com/fscorrupt/posterizarr/blob/main/modules/ArrTrigger.sh"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-theme-primary hover:underline text-xs sm:text-sm"
                    >
                        <Code className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {t("autoTriggers.resources.arrTriggerScript")}
                    </a>
                </div>
            </div>
        </>
      )}
    </div>
  );
}

function TautulliContent() {
  const { t } = useTranslation();
  const [mode, setMode] = useState("webhook");
  const [copiedCode, setCopiedCode] = useState(null);

  const handleCopyCode = (code, id) => {
    robustCopy(code, id, setCopiedCode);
  };

  const handleDownloadScript = () => {
    window.open("https://github.com/fscorrupt/posterizarr/blob/main/modules/trigger.py", "_blank");
  };

  const webhookSteps = t("autoTriggers.tautulli.webhook.steps", { returnObjects: true });
  const dockerSteps = t("autoTriggers.tautulli.docker.steps", { returnObjects: true });
  const windowsSteps = t("autoTriggers.tautulli.windows.steps", { returnObjects: true });
  
  let steps;
  if (mode === "webhook") steps = webhookSteps;
  else if (mode === "docker") steps = dockerSteps;
  else steps = windowsSteps;

  return (
    <div className="space-y-6">
      <div className="bg-theme-card border border-theme rounded-lg p-6">
        <h2 className="text-xl font-bold text-theme-text mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-theme-primary" />
          {t("autoTriggers.tautulli.selectMode")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => setMode("webhook")}
            className={`p-5 rounded-lg border-2 transition-all duration-300 ${
              mode === "webhook" ? "border-theme-primary bg-theme-primary/10" : "border-theme"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 ${mode === "webhook" ? "text-theme-primary" : "text-theme-muted"}`}>
                    <Globe className="w-8 h-8" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-lg">Webhook</span>
                  <span className="text-[10px] bg-theme-primary text-white px-2 py-0.5 rounded-full font-bold w-fit mt-1 uppercase">
                    Recommended
                  </span>
                </div>
            </div>
            <p className="text-sm text-theme-muted text-left">Native webhook without custom scripts</p>
          </button>
          <button
            onClick={() => setMode("docker")}
            className={`p-5 rounded-lg border-2 transition-all duration-300 ${
              mode === "docker" ? "border-theme-primary bg-theme-primary/10" : "border-theme"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 ${mode === "docker" ? "text-theme-primary" : "text-theme-muted"}`}>
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338 0-.676.03-1.01.09-.248-1.827-1.66-2.66-1.775-2.742l-.353-.19-.23.352c-.331.498-.556 1.078-.62 1.68-.047.434-.014.87.1 1.289-.326.177-.77.34-1.486.388H.91a.9.9 0 00-.91.907c.002.864.245 1.71.705 2.455.47.774 1.155 1.41 1.98 1.844 1.02.53 2.15.794 3.29.77 5.74 0 9.956-2.64 11.963-7.476.776.01 2.463 0 3.327-1.633l.066-.186-.138-.103z" /></svg>
                </div>
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-lg">Docker</span>
                  <span className="text-[10px] bg-theme-muted text-white px-2 py-0.5 rounded-full font-bold w-fit mt-1 uppercase">
                    Legacy
                  </span>
                </div>
            </div>
            <p className="text-sm text-theme-muted text-left">{t("autoTriggers.tautulli.docker.description")}</p>
          </button>
          <button
            onClick={() => setMode("windows")}
            className={`p-5 rounded-lg border-2 transition-all duration-300 ${
              mode === "windows" ? "border-theme-primary bg-theme-primary/10" : "border-theme"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 ${mode === "windows" ? "text-theme-primary" : "text-theme-muted"}`}>
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" /></svg>
                </div>
                <div className="flex flex-col text-left">
                  <span className="font-semibold text-lg">Windows</span>
                  <span className="text-[10px] bg-theme-muted text-white px-2 py-0.5 rounded-full font-bold w-fit mt-1 uppercase">
                    Legacy
                  </span>
                </div>
            </div>
            <p className="text-sm text-theme-muted text-left">{t("autoTriggers.tautulli.windows.description")}</p>
          </button>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-theme-text mb-1">{t("autoTriggers.tautulli.requirements.title")}</h3>
            <p className="text-sm text-theme-muted">
              {mode === "webhook" 
                ? t("autoTriggers.tautulli.requirements.webhook") 
                : mode === "docker" 
                  ? t("autoTriggers.tautulli.requirements.docker") 
                  : t("autoTriggers.tautulli.requirements.windows")}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-theme-card border border-theme rounded-lg p-4 sm:p-6">
        <h2 className="text-xl sm:text-2xl font-bold text-theme-text mb-6 flex items-center gap-2">
          <FileCode className="w-6 h-6 text-theme-primary" />
          {t("autoTriggers.setupSteps")}
        </h2>
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              {index < steps.length - 1 && <div className="absolute left-8 top-20 w-0.5 h-8 bg-theme-border" />}
              <div className="bg-theme-hover border border-theme rounded-lg p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-16 h-16 rounded-lg bg-theme-primary/10 border border-theme-primary/30 flex items-center justify-center relative">
                        <CheckCircle className="w-7 h-7 text-theme-primary" />
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-theme-primary rounded-full border-2 border-theme-card flex items-center justify-center">
                            <span className="text-xs font-bold text-white">{index + 1}</span>
                        </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <StepTitle step={step} onDownload={handleDownloadScript} />
                    <p className="text-theme-muted text-sm mb-3 leading-relaxed">{step.description}</p>
                    {step.code?.map((cb, ci) => (
                        <div key={ci} className="space-y-2 mt-4">
                            {cb.label && <p className="text-sm font-medium">{cb.label}</p>}
                            <div className="relative">
                                <pre className="bg-theme-bg-dark p-4 rounded text-sm text-theme-text overflow-x-auto"><code className="break-all">{cb.content}</code></pre>
                                <button onClick={() => handleCopyCode(cb.content, `${index}-${ci}`)} className="absolute top-2 right-2 p-2 bg-theme-card rounded">
                                    {copiedCode === `${index}-${ci}` ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-theme-muted" />}
                                </button>
                            </div>
                        </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgregarrContent() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const [settings, setSettings] = useState({
    enabled: false,
    url: "",
    apiKey: "",
    apiKeyConfigured: false,
    clearApiKey: false,
    environmentOverrides: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const applyIntegration = (integration) => {
    setSettings((current) => ({
      ...current,
      enabled: Boolean(integration.enabled),
      url: integration.url || "",
      apiKey: "",
      apiKeyConfigured: Boolean(integration.api_key_configured),
      clearApiKey: false,
      environmentOverrides: integration.environment_overrides || {},
    }));
  };

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/integrations/agregarr");
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.detail || t("autoTriggers.agregarr.loadFailed"));
        }
        if (active) applyIntegration(data.integration);
      } catch (error) {
        if (active) showError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSettings();
    return () => {
      active = false;
    };
  }, [showError, t]);

  const updateField = (field, value) => {
    setTestResult(null);
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/integrations/agregarr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          url: settings.url,
          api_key: settings.apiKey || null,
          clear_api_key: settings.clearApiKey,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || t("autoTriggers.agregarr.saveFailed"));
      }
      applyIntegration(data.integration);
      showSuccess(t("autoTriggers.agregarr.saved"));
    } catch (error) {
      showError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/integrations/agregarr/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: settings.url,
          api_key: settings.apiKey || null,
        }),
      });
      const data = await response.json();
      const result = response.ok ? data : { valid: false, message: data.detail };
      setTestResult(result);
      if (result.valid) showSuccess(result.message);
      else showError(result.message || t("autoTriggers.agregarr.testFailed"));
    } catch (error) {
      setTestResult({ valid: false, message: error.message });
      showError(error.message);
    } finally {
      setTesting(false);
    }
  };

  const overrides = settings.environmentOverrides;
  const hasEnvironmentOverrides = Object.values(overrides).some(Boolean);
  const inputClass = "w-full bg-theme-bg border border-theme rounded-lg px-3 py-2.5 text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary disabled:opacity-60 disabled:cursor-not-allowed";

  if (loading) {
    return (
      <div className="bg-theme-card border border-theme rounded-lg p-12 flex items-center justify-center gap-3 text-theme-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        {t("autoTriggers.agregarr.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="bg-theme-card border border-theme rounded-lg p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-orange-500/10 border border-orange-500/30 p-2.5 flex-shrink-0">
              <img src="/agregarr.svg" alt="Agregarr" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-theme-text">{t("autoTriggers.agregarr.title")}</h2>
              <p className="text-sm text-theme-muted mt-1 max-w-2xl">{t("autoTriggers.agregarr.description")}</p>
            </div>
          </div>
          <span className={`self-start px-3 py-1 rounded-full text-xs font-semibold border ${settings.enabled ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-theme-hover text-theme-muted border-theme"}`}>
            {settings.enabled ? t("autoTriggers.agregarr.enabled") : t("autoTriggers.agregarr.disabled")}
          </span>
        </div>

        {hasEnvironmentOverrides && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-5 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-theme-text">{t("autoTriggers.agregarr.environmentOverride")}</p>
          </div>
        )}

        <div className="space-y-5">
          <label className="flex items-center justify-between gap-4 bg-theme-hover border border-theme rounded-lg p-4">
            <div>
              <span className="font-semibold text-theme-text">{t("autoTriggers.agregarr.enableLabel")}</span>
              <p className="text-xs text-theme-muted mt-1">{t("autoTriggers.agregarr.enableHelp")}</p>
            </div>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={overrides.enabled}
              onChange={(event) => updateField("enabled", event.target.checked)}
              className="w-5 h-5 accent-[var(--color-primary)]"
            />
          </label>

          <div>
            <label className="text-sm font-medium text-theme-text block mb-2">{t("autoTriggers.agregarr.urlLabel")}</label>
            <input
              type="url"
              value={settings.url}
              disabled={overrides.url}
              onChange={(event) => updateField("url", event.target.value)}
              placeholder="http://agregarr:7171"
              className={inputClass}
            />
            <p className="text-xs text-theme-muted mt-2">{t("autoTriggers.agregarr.urlHelp")}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-theme-text block mb-2">{t("autoTriggers.agregarr.apiKeyLabel")}</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 w-4 h-4 text-theme-muted" />
              <input
                type="password"
                value={settings.apiKey}
                disabled={overrides.api_key}
                onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value, clearApiKey: false }))}
                placeholder={settings.apiKeyConfigured ? t("autoTriggers.agregarr.apiKeySaved") : t("autoTriggers.agregarr.apiKeyPlaceholder")}
                autoComplete="new-password"
                className={`${inputClass} pl-10`}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <p className="text-xs text-theme-muted">{t("autoTriggers.agregarr.apiKeyHelp")}</p>
              {settings.apiKeyConfigured && !overrides.api_key && (
                <button
                  type="button"
                  onClick={() => setSettings((current) => ({ ...current, apiKey: "", apiKeyConfigured: false, clearApiKey: true }))}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  {t("autoTriggers.agregarr.clearApiKey")}
                </button>
              )}
            </div>
          </div>

          {testResult && (
            <div className={`rounded-lg border p-3 flex items-start gap-2 ${testResult.valid ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
              {testResult.valid ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              <span className="text-sm">{testResult.message}</span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !settings.url || (!settings.apiKey && !settings.apiKeyConfigured)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-theme text-theme-text bg-theme-hover hover:border-theme-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
              {t("autoTriggers.agregarr.testConnection")}
            </button>
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-theme-primary hover:bg-theme-primary/80 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("autoTriggers.agregarr.save")}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-theme-card border border-theme rounded-lg p-5 sm:p-6">
        <h3 className="text-lg font-bold text-theme-text mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-theme-primary" />
          {t("autoTriggers.agregarr.workflowTitle")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {t("autoTriggers.agregarr.workflow", { returnObjects: true }).map((step, index) => (
            <div key={step} className="bg-theme-hover border border-theme rounded-lg p-4">
              <div className="w-7 h-7 rounded-full bg-theme-primary text-white text-xs font-bold flex items-center justify-center mb-3">{index + 1}</div>
              <p className="text-sm text-theme-text leading-relaxed">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Main AutoTriggers Component ---
function AutoTriggers() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("tautulli");

  const tabs = [
    { id: "tautulli", label: "Tautulli", icon: Activity, description: t("autoTriggers.tabs.tautulli.description") },
    { id: "sonarr", label: "Sonarr", icon: Tv, description: t("autoTriggers.tabs.sonarr.description") },
    { id: "radarr", label: "Radarr", icon: Film, description: t("autoTriggers.tabs.radarr.description") },
    { id: "agregarr", label: "Agregarr", icon: Server, description: t("autoTriggers.tabs.agregarr.description") },
  ];

  return (
    <div className="px-4 py-6 space-y-8">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="flex justify-center gap-4 mb-4">
          <img src="/sonarr.png" alt="Sonarr" className="h-16 w-auto" />
          <img src="/radarr.png" alt="Radarr" className="h-16 w-auto" />
          <img src="/tautulli.png" alt="Tautulli" className="h-16 w-auto" />
          <img src="/agregarr.svg" alt="Agregarr" className="h-16 w-auto" />
        </div>
        <h1 className="text-4xl font-bold text-theme-text mb-3">{t("autoTriggers.header.title")}</h1>
        <p className="text-lg text-theme-muted max-w-2xl mx-auto mb-5">{t("autoTriggers.header.subtitle")}</p>

        {/* Compact Info Box */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 text-left inline-block max-w-2xl">
          <ul className="space-y-2 text-sm text-theme-text">
            <li className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span><strong>How it works:</strong> {t("autoTriggers.header.bullet1")}</span>
            </li>
            <li className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <span><strong>Plex Recommendation:</strong> {t("autoTriggers.header.bullet2")}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-theme-card border border-theme rounded-lg p-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const logoMap = { tautulli: "/tautulli2.png", sonarr: "/sonarr.png", radarr: "/radarr.png", agregarr: "/agregarr.svg" };
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`p-4 rounded-lg transition-all duration-300 ${
                  isActive ? "bg-theme-primary text-white shadow-lg shadow-theme-primary/20" : "bg-theme-hover text-theme-muted hover:text-theme-text"
                }`}
              >
                <div className="flex items-center justify-center gap-3 mb-2">
                  <img src={logoMap[tab.id]} alt={tab.label} className="w-6 h-6 object-contain" />
                  <span className="font-semibold text-lg">{tab.label}</span>
                </div>
                <p className="text-xs opacity-80">{tab.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === "tautulli" && <TautulliContent />}
        {(activeTab === "sonarr" || activeTab === "radarr") && <ArrContent type={activeTab} />}
        {activeTab === "agregarr" && <AgregarrContent />}
      </div>
    </div>
  );
}

export default AutoTriggers;
