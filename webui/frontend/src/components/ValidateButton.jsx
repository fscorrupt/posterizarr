import React, { useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

const API_URL = "/api";

const ValidateButton = ({
  type,
  config,
  label = "Validate",
  className = "",
  onSuccess,
  onError,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [validating, setValidating] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const validateService = async () => {
    setValidating(true);
    setLastResult(null);

    try {
      let requestBody = {};

      // Build request body based on validation type
      switch (type) {
        case "plex":
          requestBody = {
            url: config.PlexUrl?.trim(),
            token: config.PlexToken?.trim(),
          };
          break;

        case "jellyfin":
          requestBody = {
            url: config.JellyfinUrl?.trim(),
            api_key: config.JellyfinAPIKey?.trim(),
          };
          break;

        case "emby":
          requestBody = {
            url: config.EmbyUrl?.trim(),
            api_key: config.EmbyAPIKey?.trim(),
          };
          break;

        case "tmdb":
          requestBody = {
            token: config.tmdbtoken?.trim(),
          };
          break;

        case "tvdb":
          // Split API key and PIN if formatted as "key#pin"
          const tvdbParts = config.tvdbapi?.trim().split("#") || [];
          requestBody = {
            api_key: tvdbParts[0]?.trim(),
            pin: tvdbParts[1]?.trim() || null,
          };
          break;

        case "fanart":
          requestBody = {
            api_key: config.FanartTvAPIKey?.trim(),
          };
          break;

        case "discord":
          requestBody = {
            webhook_url: config.Discord?.trim(),
          };
          break;

        case "apprise":
          requestBody = {
            url: config.AppriseUrl?.trim(),
          };
          break;

        case "uptimekuma":
          requestBody = {
            url: config.UptimeKumaUrl?.trim(),
          };
          break;

        case "agregarr":
          requestBody = {
            url: config.AgregarrUrl?.trim(),
            api_key: config.AgregarrApiKey?.trim(),
          };
          break;

        default:
          throw new Error(`Unknown validation type: ${type}`);
      }

      // API-Aufruf
      const response = await fetch(`${API_URL}/validate/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();
      setLastResult(result);

      // Callback notifications
      const resultMessage = result.message || result.detail || `${label} failed`;
      if (result.valid) {
        if (onSuccess) onSuccess(resultMessage);
      } else {
        if (onError) onError(resultMessage);
      }
    } catch (error) {
      const errorMessage = `Validation failed: ${error.message}`;
      setLastResult({ valid: false, message: errorMessage });
      if (onError) onError(errorMessage);
    } finally {
      setValidating(false);
    }
  };

  return (
    <button
      onClick={validateService}
      disabled={validating || disabled}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium
        transition-all duration-200 min-w-[120px] justify-center
        ${
          validating || disabled
            ? "bg-theme-muted/20 text-theme-muted cursor-not-allowed opacity-50"
            : lastResult?.valid
            ? "bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
            : lastResult?.valid === false
            ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
            : "bg-theme-primary/20 text-theme-primary border border-theme-primary/30 hover:bg-theme-primary/30"
        }
        ${className}
      `}
    >
      {validating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t("validateButton.validating")}</span>
        </>
      ) : lastResult?.valid ? (
        <>
          <CheckCircle className="w-4 h-4" />
          <span>{label}</span>
        </>
      ) : lastResult?.valid === false ? (
        <>
          <XCircle className="w-4 h-4" />
          <span>{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
};

export default ValidateButton;
