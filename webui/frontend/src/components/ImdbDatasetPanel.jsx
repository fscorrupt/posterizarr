import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ChevronDown, Database, Download, ExternalLink, FileText, HelpCircle, Key, Loader2, Save, Search, ShieldCheck, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

const endpoint = "/api/dynamic-overlays/ratings-cache";

async function request(path, options) {
  const response = await fetch(`${endpoint}${path}`, options);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return data;
}

function ImdbMatchingHelp() {
  const { t } = useTranslation();
  const steps = [
    { key: "id", icon: Key },
    { key: "title", icon: FileText },
    { key: "manual", icon: ShieldCheck },
  ];
  return (
    <details className="group text-xs text-theme-muted">
      <summary className="flex items-center gap-2 py-1 cursor-pointer list-none text-theme-text [&::-webkit-details-marker]:hidden">
        <HelpCircle className="w-4 h-4 shrink-0 text-theme-primary" />
        <span className="font-medium">{t("imdbDataset.help.heading")}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 pl-3 border-l-2 border-theme-primary/40 space-y-4 max-w-3xl">
        <ol className="space-y-3">
          {steps.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-start gap-2.5">
              <Icon className="w-4 h-4 shrink-0 mt-0.5 text-theme-primary" />
              <div className="min-w-0"><h4 className="font-semibold text-theme-text">{t(`imdbDataset.help.${key}Title`)}</h4>
                <p className="mt-1 leading-relaxed break-words">{t(`imdbDataset.help.${key}Body`)}</p></div>
            </li>
          ))}
        </ol>
        <div className="space-y-1.5">
          <div className="font-medium text-theme-text">{t("imdbDataset.help.filename")}</div>
          <code className="block text-[11px] leading-relaxed break-words text-theme-text">S21E83 - <mark className="bg-amber-500/15 text-amber-500 px-1 rounded-sm">974</mark> - {t("imdbDataset.help.exampleTitle")}</code>
          <p className="leading-relaxed">
            <Trans
              i18nKey="imdbDataset.help.absolute"
              components={{
                guide: <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/?h=naming#episode-format" target="_blank" rel="noopener noreferrer" className="text-theme-primary underline underline-offset-2" />
              }}
            />
          </p>
        </div>
        <p className="pt-2 border-t border-theme leading-relaxed">{t("imdbDataset.help.local")}</p>
      </div>
    </details>
  );
}

function EpisodeImdbDialog({ entry, onClose, onSaved, disabled }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [selection, setSelection] = useState("auto");
  const [customId, setCustomId] = useState("");
  const [scope, setScope] = useState("episode");
  const [seasonEnabled, setSeasonEnabled] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [targetSeason, setTargetSeason] = useState(1);
  const [episodeOffset, setEpisodeOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const path = `/episode/${encodeURIComponent(entry.id)}/imdb`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await request(`${path}?query=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!initialized.current) {
          const currentId = result.mapping?.imdb_id;
          setSelection(result.mapping?.mode === "manual" ? result.candidates.some(candidate => candidate.imdb_id === currentId) ? currentId : "custom" : "auto");
          setCustomId(currentId || "");
          const season = result.season_mapping;
          setScope(result.mapping?.mode === "season" ? "season" : "episode");
          setSeasonEnabled(Boolean(season));
          setSeriesId(season?.imdb_id || "");
          setTargetSeason(season?.target_season ?? 1);
          setEpisodeOffset(season?.episode_offset ?? 0);
          initialized.current = true;
        }
        setData(result);
        setError("");
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, query]);

  const save = async event => {
    event.preventDefault();
    if (saving || loading || disabled) return;
    const imdbId = scope === "season" ? seasonEnabled ? seriesId.trim() : null
      : selection === "auto" ? null : selection === "custom" ? customId.trim() : selection;
    if (imdbId !== null && !/^tt\d{7,12}$/.test(imdbId)) {
      setError(t("imdbDataset.invalidId"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        imdb_id: imdbId, scope, target_season: Number(targetSeason), episode_offset: Number(episodeOffset),
      }) });
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure.message);
      setSaving(false);
    }
  };

  return (
    <div className="app-dialog-backdrop fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3"
      onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="episode-imdb-title"
        onKeyDown={event => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); } }}
        className="app-dialog-panel w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-lg border border-theme bg-theme-card shadow-2xl">
        <div className="p-4 border-b border-theme flex justify-between items-start gap-3">
          <div className="min-w-0"><h3 id="episode-imdb-title" className="text-base font-semibold text-theme-text">{t("imdbDataset.mapping")}</h3>
            <p className="mt-1 text-xs text-theme-muted break-words">{entry.display_title || entry.title || entry.item_id}</p></div>
          <button type="button" title={t("imdbDataset.close")} aria-label={t("imdbDataset.close")} onClick={onClose} disabled={saving}
            className="p-2 text-theme-muted hover:text-theme-text shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto min-h-0">
          <ImdbMatchingHelp />
          <div className="text-xs text-theme-muted flex flex-wrap gap-3">
            <span>{t("imdbDataset.status")}: {t(`imdbDataset.states.${data?.mapping?.status || "loading"}`)}</span>
            {data?.mapping?.imdb_id && <a className="inline-flex items-center gap-1 text-theme-primary" href={`https://www.imdb.com/title/${data.mapping.imdb_id}/`} target="_blank" rel="noopener noreferrer">{data.mapping.imdb_id}<ExternalLink className="w-3 h-3" /></a>}
          </div>
          {data?.context?.file_path && <p className="text-[11px] text-theme-muted break-all">{data.context.file_path}</p>}
          <fieldset className="flex flex-wrap gap-4 text-sm text-theme-text" disabled={saving}>
            <legend className="sr-only">{t("imdbDataset.scope")}</legend>
            <label className="inline-flex items-center gap-2"><input type="radio" name="imdb-scope" checked={scope === "episode"} onChange={() => setScope("episode")} />{t("imdbDataset.episodeScope")}</label>
            <label className="inline-flex items-center gap-2"><input type="radio" name="imdb-scope" checked={scope === "season"} onChange={() => setScope("season")}
              disabled={!data?.context?.series_title || data?.context?.season_number == null} />{t("imdbDataset.seasonScope")}</label>
          </fieldset>
          {scope === "season" ? <fieldset className="space-y-4 min-w-0" disabled={saving}>
            <legend className="text-xs font-medium text-theme-text mb-2">{data?.context?.series_title} / S{data?.context?.season_number}</legend>
            <label className="flex items-center gap-2 text-sm text-theme-text"><input type="checkbox" checked={seasonEnabled} onChange={event => setSeasonEnabled(event.target.checked)} />{t("imdbDataset.seasonOverride")}</label>
            <label className="block text-xs text-theme-text">{t("imdbDataset.seriesId")}
              <input type="text" placeholder="tt1234567" pattern="tt[0-9]{7,12}" required={seasonEnabled} disabled={!seasonEnabled} value={seriesId}
                onChange={event => setSeriesId(event.target.value)} className="mt-1 w-full min-w-0 border border-theme rounded-lg bg-theme-bg px-3 py-2 text-sm text-theme-text disabled:opacity-50" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs text-theme-text">{t("imdbDataset.targetSeason")}
                <input type="number" min="0" step="1" required disabled={!seasonEnabled} value={targetSeason} onChange={event => setTargetSeason(event.target.value)}
                  className="mt-1 w-full min-w-0 border border-theme rounded-lg bg-theme-bg px-3 py-2 text-sm disabled:opacity-50" />
              </label>
              <label className="block text-xs text-theme-text">{t("imdbDataset.episodeOffset")}
                <input type="number" step="1" required disabled={!seasonEnabled} value={episodeOffset} onChange={event => setEpisodeOffset(event.target.value)}
                  className="mt-1 w-full min-w-0 border border-theme rounded-lg bg-theme-bg px-3 py-2 text-sm disabled:opacity-50" />
              </label>
            </div>
            {seasonEnabled && data?.context?.episode_number != null && <output className="block text-xs text-theme-muted break-words">
              S{data.context.season_number} E{data.context.episode_number}{" -> "}S{targetSeason} E{Number(data.context.episode_number) + Number(episodeOffset)}
            </output>}
          </fieldset> : <>
          <label className="block text-xs text-theme-text">{t("imdbDataset.search")}
            <div className="relative mt-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-theme-muted" />
              <input autoFocus type="search" value={query} maxLength={250} onChange={event => setQuery(event.target.value)} disabled={saving}
                className="w-full min-w-0 pl-9 pr-3 py-2 bg-theme-bg border border-theme rounded-lg text-sm" /></div>
          </label>
          <fieldset className="min-w-0 space-y-2" disabled={saving}>
            <legend className="text-xs font-medium text-theme-text mb-2">{t("imdbDataset.assignment")}</legend>
            <label className="flex items-center gap-2 text-sm text-theme-text"><input type="radio" name="imdb-choice" checked={selection === "auto"} onChange={() => setSelection("auto")} />{t("imdbDataset.automatic")}</label>
            {loading ? <Loader2 aria-label={t("imdbDataset.loading")} className="w-5 h-5 animate-spin text-theme-primary" /> : (
              <div className="divide-y divide-theme max-h-64 overflow-y-auto">
                {(data?.candidates || []).map(candidate => (
                  <label key={candidate.imdb_id} className="flex gap-3 items-start py-3 text-xs cursor-pointer hover:bg-theme-hover">
                    <input type="radio" name="imdb-choice" className="mt-1 shrink-0" value={candidate.imdb_id} checked={selection === candidate.imdb_id} onChange={() => setSelection(candidate.imdb_id)} />
                    <span className="min-w-0 break-words"><span className="block font-semibold text-theme-text">{candidate.title}</span>
                      <span className="block mt-1 text-theme-muted">{candidate.series_title || data?.context?.series_title || candidate.parent_id} / S{candidate.season} E{candidate.episode} / {candidate.imdb_id} / IMDb {candidate.rating}</span></span>
                  </label>
                ))}
                {!data?.candidates?.length && <p className="py-3 text-xs text-theme-muted">{t("imdbDataset.noMatches")}</p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-theme-text"><input type="radio" name="imdb-choice" checked={selection === "custom"} onChange={() => setSelection("custom")} />{t("imdbDataset.customId")}</label>
            {selection === "custom" && <input aria-label={t("imdbDataset.customId")} type="text" placeholder="tt14571480" pattern="tt[0-9]{7,12}" required value={customId}
              onChange={event => setCustomId(event.target.value)} className="w-full min-w-0 border border-theme rounded-lg bg-theme-bg px-3 py-2 text-sm text-theme-text" />}
          </fieldset>
          </>}
          {error && <p role="alert" className="text-xs text-red-400 break-words">{error}</p>}
        </div>
        <div className="p-4 border-t border-theme flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="px-3 py-2 border border-theme rounded-lg text-sm text-theme-text">{t("imdbDataset.cancel")}</button>
          <button type="submit" disabled={saving || loading || disabled || !data} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-primary text-white text-sm disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t("imdbDataset.save")}</button>
        </div>
      </form>
    </div>
  );
}

export default function ImdbDatasetPanel({ entry, onClose, onSaved, disabled }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const result = await request("/imdb-dataset", { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  const update = async (path, body) => {
    setBusy(true);
    setError("");
    try {
      setData(await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <>
    <section aria-label={t("imdbDataset.title")} className="px-4 py-3 border-b border-theme space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-theme-text">
          <Database className="w-4 h-4 shrink-0" /><input type="checkbox" checked={Boolean(data?.enabled)} disabled={busy || !data || disabled}
            onChange={event => update("/imdb-dataset", { enabled: event.target.checked })} />{t("imdbDataset.title")}</label>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-theme-muted">
          <span>{t("imdbDataset.ratings")}: {Number(data?.ratings || 0).toLocaleString()}</span>
          <span>{t("imdbDataset.updated")}: {data?.updated_at ? new Date(data.updated_at).toLocaleString() : t("imdbDataset.notImported")}</span>
          <button type="button" disabled={busy || !data?.enabled || data?.job?.running || disabled} onClick={() => setConfirmImport(true)} title={t("imdbDataset.import")}
            className="inline-flex items-center gap-2 border border-theme rounded-lg px-3 py-2 text-xs text-theme-text disabled:opacity-50 hover:bg-theme-hover">
            {data?.job?.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t("imdbDataset.import")}</button>
        </div>
      </div>
      {data?.job?.running && <p role="status" className="text-xs text-theme-muted">{t("imdbDataset.importing")}: {data.job.phase}</p>}
      {(error || data?.job?.error) && <p role="alert" className="text-xs text-red-400 break-words">{error || data.job.error}</p>}
      <ImdbMatchingHelp />
      <a href="https://data.imdb.com/non-commercial-datasets/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-theme-muted hover:underline">{t("imdbDataset.license")}<ExternalLink className="w-3 h-3" /></a>
    </section>
    <ConfirmDialog isOpen={confirmImport} onClose={() => setConfirmImport(false)} onConfirm={() => update("/imdb-dataset/import")}
      title={t("imdbDataset.import")} message={t("imdbDataset.confirmImport")} confirmText={t("imdbDataset.import")} cancelText={t("imdbDataset.cancel")} type="warning" />
    {entry && <EpisodeImdbDialog key={entry.id} entry={entry} onClose={onClose} onSaved={onSaved} disabled={disabled || !data?.enabled} />}
  </>;
}