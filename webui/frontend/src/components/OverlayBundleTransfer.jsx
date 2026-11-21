import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";

const API = "/api/dynamic-overlays/bundle";

async function responseData(response, t) {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const code = data.detail?.code || (response.status === 409 ? "busy" : "requestFailed");
    const error = new Error(t(`overlayBundle.errors.${code}`, { defaultValue: t("overlayBundle.errors.requestFailed") }));
    error.localized = true;
    throw error;
  }
  return data;
}

export default function OverlayBundleTransfer({ disabled = false, onImported }) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [busy, setBusy] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [targets, setTargets] = useState({});
  const [includeSettings, setIncludeSettings] = useState(true);
  const [replaceFiles, setReplaceFiles] = useState(false);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const escape = (event) => {
      if (event.key === "Escape" && !busy) setPreview(null);
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = [...(dialog?.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], summary") || [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [preview, busy]);

  const exportBundle = async () => {
    setBusy("export");
    try {
      const response = await fetch(`${API}/export`);
      if (!response.ok) await responseData(response, t);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "posterizarr-overlays.zip";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showSuccess(t("overlayBundle.exported"));
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusy("");
    }
  };

  const inspectBundle = async (event) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (selected.size > 128 * 1024 * 1024) {
      showError(t("overlayBundle.tooLarge"));
      return;
    }
    setBusy("preview");
    try {
      const form = new FormData();
      form.append("file", selected);
      const data = await responseData(await fetch(`${API}/preview`, { method: "POST", body: form }), t);
      setFile(selected);
      setMapping(Object.fromEntries(data.libraries.map((profile) => [profile.name,
        data.local_libraries.some((library) => library.name === profile.name && (!profile.media_type || library.type === profile.media_type)) ? profile.name : ""
      ])));
      setTargets(Object.fromEntries(data.libraries.map((profile) => [profile.name, {
        anime: Boolean(profile.animetafill), seasons: Boolean(profile.season_ratings),
      }])));
      setIncludeSettings(true);
      setReplaceFiles(false);
      setPreview({ ...data, warning_codes: data.warning_codes || (data.warnings?.length ? ["unknown"] : []) });
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusy("");
    }
  };

  const importBundle = async () => {
    setBusy("import");
    try {
      const form = new FormData();
      const featureLibraries = (feature) => includeSettings ? preview.libraries
        .filter((profile) => mapping[profile.name] && targets[profile.name]?.[feature]
          && preview.local_libraries.some((library) => library.name === mapping[profile.name] && library.type === "show"))
        .map((profile) => mapping[profile.name]) : [];
      form.append("file", file);
      form.append("mapping", JSON.stringify(mapping));
      form.append("anime_libraries", JSON.stringify(featureLibraries("anime")));
      form.append("season_libraries", JSON.stringify(featureLibraries("seasons")));
      form.append("import_settings", String(includeSettings));
      form.append("replace_files", String(replaceFiles));
      await responseData(await fetch(`${API}/import`, { method: "POST", body: form }), t);
      showSuccess(t("overlayBundle.imported"));
      setPreview(null);
      setFile(null);
      onImported?.();
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusy("");
    }
  };

  const selected = Object.values(mapping).filter(Boolean);
  const duplicates = new Set(selected).size !== selected.length;
  const buttonClass = "flex items-center gap-1.5 rounded-lg border border-theme bg-theme-bg px-3 py-1.5 text-xs font-semibold text-theme-text hover:bg-theme-hover disabled:opacity-50";

  return <>
    <button type="button" className={buttonClass} onClick={exportBundle} disabled={disabled || Boolean(busy)} title={t("overlayBundle.exportHint")}>
      {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{t("overlayBundle.export")}
    </button>
    <button type="button" className={buttonClass} onClick={() => inputRef.current?.click()} disabled={disabled || Boolean(busy)} title={t("overlayBundle.importHint")}>
      {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{t("overlayBundle.import")}
    </button>
    <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" aria-label={t("overlayBundle.fileLabel")} onChange={inspectBundle} />
    {preview && <div className="app-dialog-backdrop fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-3 sm:p-5">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="overlay-bundle-title" className="app-dialog-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-theme bg-theme-card text-theme-text shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-theme p-4">
          <div>
            <h2 id="overlay-bundle-title" className="text-base font-semibold">{t("overlayBundle.title")}</h2>
            <p className="mt-1 text-xs text-theme-muted">{t("overlayBundle.stats", { files: preview.file_count, assets: preview.asset_count, server: preview.destination_server })}</p>
          </div>
          <button type="button" title={t("overlayBundle.close")} aria-label={t("overlayBundle.close")} disabled={Boolean(busy)} onClick={() => setPreview(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-theme hover:bg-theme-hover disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <div className="flex gap-2 text-xs text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" /><p>{t("overlayBundle.safety")}</p></div>
          {preview.warning_codes.map((code) => <p key={code} className="text-xs text-amber-400">{t(`overlayBundle.warnings.${code}`, { defaultValue: t("overlayBundle.warnings.unknown") })}</p>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSettings} onChange={(event) => setIncludeSettings(event.target.checked)} disabled={Boolean(busy)} />{t("overlayBundle.restoreSettings")}</label>
          {preview.features.rating_sources.length > 0 && <p className="text-xs text-theme-muted">{t("overlayBundle.ratingSources", { sources: preview.features.rating_sources.join(", ") })}</p>}
          {preview.features.imdb_dataset && <p className="text-xs text-theme-muted">{t("overlayBundle.imdbEnabled")}</p>}
          <div className="divide-y divide-theme border-y border-theme">
            {preview.libraries.map((profile) => {
              const target = mapping[profile.name] || "";
              const showLibrary = preview.local_libraries.some((library) => library.name === target && library.type === "show");
              return <div key={profile.name} className="grid grid-cols-1 items-start gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0 break-words"><h3 className="text-sm font-semibold">{profile.name}</h3><p className="mt-1 text-xs text-theme-muted">{t("overlayBundle.profileSummary", { type: t(`overlayBundle.types.${["movie", "show"].includes(profile.media_type) ? profile.media_type : "mixed"}`), count: profile.rule_count })}</p></div>
                <label className="min-w-0 text-xs text-theme-muted">{t("overlayBundle.destination")}
                  <select aria-label={t("overlayBundle.destinationFor", { library: profile.name })} value={target} onChange={(event) => setMapping((current) => ({ ...current, [profile.name]: event.target.value }))} disabled={Boolean(busy)} className="mt-1 w-full min-w-0 rounded border border-theme bg-theme-bg p-2 text-sm text-theme-text">
                    <option value="">{t("overlayBundle.skip")}</option>
                    {preview.local_libraries.filter((library) => !profile.media_type || library.type === profile.media_type).map((library) => <option key={library.name} value={library.name}>{library.name}</option>)}
                  </select>
                </label>
                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2"><input type="checkbox" aria-label={t("overlayBundle.animeFor", { library: profile.name })} checked={Boolean(targets[profile.name]?.anime)} disabled={Boolean(busy) || !includeSettings || !showLibrary} onChange={(event) => setTargets((current) => ({ ...current, [profile.name]: { ...current[profile.name], anime: event.target.checked } }))} />AniMetaFill</label>
                  <label className="flex items-center gap-2"><input type="checkbox" aria-label={t("overlayBundle.seasonFor", { library: profile.name })} checked={Boolean(targets[profile.name]?.seasons)} disabled={Boolean(busy) || !includeSettings || !showLibrary} onChange={(event) => setTargets((current) => ({ ...current, [profile.name]: { ...current[profile.name], seasons: event.target.checked } }))} />{t("overlayBundle.seasonRatings")}</label>
                </div>
              </div>;
            })}
          </div>
          {duplicates && <p role="alert" className="text-xs text-red-400">{t("overlayBundle.duplicate")}</p>}
          {preview.conflicts.length > 0 && <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={replaceFiles} onChange={(event) => setReplaceFiles(event.target.checked)} disabled={Boolean(busy)} />{t("overlayBundle.replaceFiles", { count: preview.conflicts.length })}</label>
            <details className="text-xs text-theme-muted"><summary className="cursor-pointer">{t("overlayBundle.conflicts")}</summary><ul className="mt-2 space-y-1">{preview.conflicts.map((path) => <li key={path} className="break-all font-mono">{path}</li>)}</ul></details>
          </div>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-theme p-4">
          <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => setPreview(null)}>{t("overlayBundle.cancel")}</button>
          <button type="button" onClick={importBundle} disabled={Boolean(busy) || !selected.length || duplicates || (preview.conflicts.length > 0 && !replaceFiles)} className="flex items-center gap-2 rounded-lg bg-theme-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{t("overlayBundle.import")}
          </button>
        </footer>
      </section>
    </div>}
  </>;
}