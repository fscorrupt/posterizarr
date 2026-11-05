import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

export function useSiloEnabled(knownEnabled) {
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    if (knownEnabled !== undefined) return;
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (controller.signal.aborted || !data) return;
        const config = data.config || data;
        setDetected(String(config.UseSilo ?? config.SiloPart?.UseSilo).toLowerCase() === "true");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [knownEnabled]);

  return knownEnabled === undefined ? detected : Boolean(knownEnabled);
}

export default function SiloSupportNotice({ enabled, scope = "general" }) {
  const { t } = useTranslation();
  const visible = useSiloEnabled(enabled);
  if (!visible) return null;

  return (
    <aside role="note" aria-label={t("silo.support.heading")} className="flex min-w-0 items-start gap-3 border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-theme-text">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        <p className="text-sm font-semibold">{t("silo.support.heading")}</p>
        <p className="mt-1 text-sm leading-relaxed text-theme-muted">{t(`silo.support.${scope}`)}</p>
      </div>
    </aside>
  );
}