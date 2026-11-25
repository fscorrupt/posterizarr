import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Download, Globe, Loader2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import CommunityGallery from "./CommunityGallery";

const API = "/api/dynamic-overlays/bundle";
const COMMUNITY_API = "/api/community-gallery/dynamic-overlays";

async function responseData(response, t) {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const code = data.detail?.code || (response.status === 409 ? "busy" : "requestFailed");
    const error = new Error(
      data.detail?.message || t(`overlayBundle.errors.${code}`, { defaultValue: t("overlayBundle.errors.requestFailed") })
    );
    error.localized = true;
    throw error;
  }
  return data;
}

export default function OverlayBundleTransfer({
  disabled = false,
  onImported,
  pendingCommunityEntry = null,
  onPendingCommunityEntryHandled,
}) {
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
  const [fetchDependencies, setFetchDependencies] = useState(true);
  const [importResult, setImportResult] = useState(null);
  const [showCommunityModal, setShowCommunityModal] = useState(false);
  const [communitySource, setCommunitySource] = useState(null);
  const [busyCommunityId, setBusyCommunityId] = useState(null);

  const applyPreviewData = useCallback((data) => {
    setMapping(Object.fromEntries(data.libraries.map((profile) => [profile.name,
      data.local_libraries.some((library) => library.name === profile.name && (!profile.media_type || library.type === profile.media_type)) ? profile.name : ""
    ])));
    setTargets(Object.fromEntries(data.libraries.map((profile) => [profile.name, {
      anime: Boolean(profile.animetafill), seasons: Boolean(profile.season_ratings),
    }])));
    setIncludeSettings(true);
    setReplaceFiles(false);
    setFetchDependencies(true);
    setImportResult(null);
    setPreview({ ...data, warning_codes: data.warning_codes || (data.warnings?.length ? ["unknown"] : []) });
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
    setFile(null);
    setCommunitySource(null);
    setImportResult(null);
  }, []);

  const finishAndReload = useCallback(() => {
    closePreview();
    onImported?.();
  }, [closePreview, onImported]);

  useEffect(() => {
    if (!showCommunityModal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event) => {
      if (event.key === "Escape" && !busy) setShowCommunityModal(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onEscape);
    };
  }, [showCommunityModal, busy]);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const escape = (event) => {
      if (event.key === "Escape" && !busy) {
        if (importResult) finishAndReload();
        else closePreview();
      }
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
  }, [preview, busy, importResult, closePreview, finishAndReload]);

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
      setCommunitySource(null);
      applyPreviewData(data);
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusy("");
    }
  };

  const inspectCommunityBundle = useCallback(async (entry) => {
    setBusyCommunityId(entry.id);
    setBusy("preview");
    try {
      const data = await responseData(
        await fetch(`${COMMUNITY_API}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id }),
        }),
        t
      );
      setFile(null);
      setCommunitySource({
        entry: data.community_entry || entry,
        bundleToken: data.bundle_token,
      });
      setShowCommunityModal(false);
      applyPreviewData(data);
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusyCommunityId(null);
      setBusy("");
    }
  }, [applyPreviewData, showError, t]);

  useEffect(() => {
    if (!pendingCommunityEntry) return;
    inspectCommunityBundle(pendingCommunityEntry);
    onPendingCommunityEntryHandled?.();
  }, [pendingCommunityEntry, inspectCommunityBundle, onPendingCommunityEntryHandled]);

  const importBundle = async () => {
    setBusy("import");
    try {
      const featureLibraries = (feature) => includeSettings ? preview.libraries
        .filter((profile) => mapping[profile.name] && targets[profile.name]?.[feature]
          && preview.local_libraries.some((library) => library.name === mapping[profile.name] && library.type === "show"))
        .map((profile) => mapping[profile.name]) : [];

      let data;
      if (communitySource) {
        data = await responseData(
          await fetch(`${COMMUNITY_API}/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: communitySource.entry.id,
              bundle_token: communitySource.bundleToken,
              mapping,
              anime_libraries: featureLibraries("anime"),
              season_libraries: featureLibraries("seasons"),
              import_settings: includeSettings,
              replace_files: replaceFiles,
              fetch_dependencies: fetchDependencies,
            }),
          }),
          t
        );
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("mapping", JSON.stringify(mapping));
        form.append("anime_libraries", JSON.stringify(featureLibraries("anime")));
        form.append("season_libraries", JSON.stringify(featureLibraries("seasons")));
        form.append("import_settings", String(includeSettings));
        form.append("replace_files", String(replaceFiles));
        form.append("fetch_dependencies", String(fetchDependencies));
        data = await responseData(await fetch(`${API}/import`, { method: "POST", body: form }), t);
      }
      const deps = data?.dependencies;
      if (deps?.failed_count > 0) {
        setImportResult(data);
        return;
      }
      if (deps?.downloaded_count > 0) {
        showSuccess(t("overlayBundle.importedWithDeps", { count: deps.downloaded_count }));
      } else {
        showSuccess(t("overlayBundle.imported"));
      }
      closePreview();
      window.setTimeout(() => onImported?.(), 900);
    } catch (error) {
      showError(error.localized ? error.message : t("overlayBundle.errors.requestFailed"));
    } finally {
      setBusy("");
    }
  };

  const selected = Object.values(mapping).filter(Boolean);
  const duplicates = new Set(selected).size !== selected.length;
  const totalOfficialDeps = preview?.official_dependency_count || 0;
  const missingOfficialDeps = preview?.missing_official_dependency_count ?? totalOfficialDeps;
  const missingBreakdown = preview?.missing_official_dependencies || { defaults: 0, images: 0, fonts: 0 };
  const hasOverlayRules = (preview?.libraries || []).some((profile) => profile.rule_count > 0);
  const showFetchDepsOption = totalOfficialDeps > 0 || hasOverlayRules;
  const buttonClass = "flex items-center gap-1.5 rounded-lg border border-theme bg-theme-bg px-3 py-1.5 text-xs font-semibold text-theme-text hover:bg-theme-hover disabled:opacity-50";

  return <>
    <button type="button" className={buttonClass} onClick={exportBundle} disabled={disabled || Boolean(busy)} title={t("overlayBundle.exportHint")}>
      {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{t("overlayBundle.export")}
    </button>
    <button type="button" className={buttonClass} onClick={() => inputRef.current?.click()} disabled={disabled || Boolean(busy)} title={t("overlayBundle.importHint")}>
      {busy === "preview" && !busyCommunityId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{t("overlayBundle.import")}
    </button>
    <button type="button" className={buttonClass} onClick={() => setShowCommunityModal(true)} disabled={disabled || Boolean(busy)} title={t("overlayBundle.communityHint")}>
      <Globe className="h-3.5 w-3.5 text-theme-primary" />{t("overlayBundle.community")}
    </button>
    <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" aria-label={t("overlayBundle.fileLabel")} onChange={inspectBundle} />

    {showCommunityModal && createPortal(
      <div
        className="app-dialog-backdrop fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-5"
        onClick={() => !busy && setShowCommunityModal(false)}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t("overlayBundle.community")}
          className="app-dialog-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-theme bg-theme-card text-theme-text shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-theme px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Globe className="h-5 w-5 text-theme-primary" />
              <h2 className="text-base font-bold">{t("overlayBundle.community")}</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowCommunityModal(false)}
              disabled={Boolean(busy)}
              aria-label={t("common.close", "Close")}
              className="p-2 rounded-lg border border-theme hover:bg-theme-hover disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <CommunityGallery
              kind="dynamic-overlays"
              onSelectOverlayBundle={inspectCommunityBundle}
              busyEntryId={busyCommunityId}
            />
          </div>
        </section>
      </div>,
      document.body
    )}

    {preview && createPortal(<div className="app-dialog-backdrop fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-3 sm:p-5">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="overlay-bundle-title" className="app-dialog-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-theme bg-theme-card text-theme-text shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-theme p-4">
          <div>
            <h2 id="overlay-bundle-title" className="text-base font-semibold">{t("overlayBundle.title")}</h2>
            {communitySource && (
              <p className="mt-0.5 text-xs font-medium text-theme-primary">
                {t("overlayBundle.communitySource", {
                  name: communitySource.entry.name,
                  author: communitySource.entry.author,
                  defaultValue: "Community bundle: {{name}} by {{author}}",
                })}
              </p>
            )}
            <p className="mt-1 text-xs text-theme-muted">{t("overlayBundle.stats", { files: preview.file_count, assets: preview.asset_count, server: preview.destination_server })}</p>
          </div>
          <button type="button" title={t("overlayBundle.close")} aria-label={t("overlayBundle.close")} disabled={Boolean(busy)} onClick={importResult ? finishAndReload : closePreview} className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-theme hover:bg-theme-hover disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>
        {importResult ? (
          <>
            <div className="min-h-0 space-y-4 overflow-y-auto p-4">
              <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-1">
                  <p className="font-semibold text-theme-text">{t("overlayBundle.partialDepsTitle")}</p>
                  <p className="text-theme-muted">
                    {t("overlayBundle.partialDepsSummary", {
                      downloaded: importResult.dependencies?.downloaded_count || 0,
                      failed: importResult.dependencies?.failed_count || 0,
                    })}
                  </p>
                </div>
              </div>
              {Array.isArray(importResult.dependencies?.failed) && importResult.dependencies.failed.length > 0 && (
                <details open className="text-xs text-theme-muted">
                  <summary className="cursor-pointer font-medium text-theme-text">{t("overlayBundle.failedDependencies")}</summary>
                  <ul className="mt-2 space-y-1.5 rounded-lg border border-theme bg-theme-bg p-3">
                    {importResult.dependencies.failed.map((item, idx) => (
                      <li key={`${item.path || idx}-${idx}`} className="break-all">
                        <span className="font-mono text-theme-text">{item.path}</span>
                        {item.error ? <span className="text-red-400"> — {item.error}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-theme p-4">
              <button type="button" onClick={finishAndReload} className="flex items-center gap-2 rounded-lg bg-theme-primary px-4 py-2 text-sm font-semibold text-white">
                {t("overlayBundle.doneReload")}
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="min-h-0 space-y-4 overflow-y-auto p-4">
              <div className="flex gap-2 text-xs text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" /><p>{t("overlayBundle.safety")}</p></div>
              {preview.warning_codes
                .filter((code) => !(code === "officialDependencies" && fetchDependencies))
                .map((code) => <p key={code} className="text-xs text-amber-400">{t(`overlayBundle.warnings.${code}`, { defaultValue: t("overlayBundle.warnings.unknown") })}</p>)}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSettings} onChange={(event) => setIncludeSettings(event.target.checked)} disabled={Boolean(busy)} />{t("overlayBundle.restoreSettings")}</label>
              {showFetchDepsOption && (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={fetchDependencies} onChange={(event) => setFetchDependencies(event.target.checked)} disabled={Boolean(busy)} />
                    {t("overlayBundle.fetchDependencies")}
                  </label>
                  {totalOfficialDeps > 0 && (
                    <p className="pl-6 text-xs text-theme-muted">
                      {missingOfficialDeps > 0
                        ? t("overlayBundle.fetchDependenciesMissing", {
                            missing: missingOfficialDeps,
                            total: totalOfficialDeps,
                            defaults: missingBreakdown.defaults || 0,
                            images: missingBreakdown.images || 0,
                            fonts: missingBreakdown.fonts || 0,
                          })
                        : t("overlayBundle.fetchDependenciesReady", { total: totalOfficialDeps })}
                    </p>
                  )}
                </div>
              )}
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
              <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={closePreview}>{t("overlayBundle.cancel")}</button>
              <button type="button" onClick={importBundle} disabled={Boolean(busy) || !selected.length || duplicates || (preview.conflicts.length > 0 && !replaceFiles)} className="flex items-center gap-2 rounded-lg bg-theme-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy === "import"
                  ? (fetchDependencies ? t("overlayBundle.importingWithDeps") : t("overlayBundle.importing"))
                  : t("overlayBundle.import")}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>, document.body)}
  </>;
}
