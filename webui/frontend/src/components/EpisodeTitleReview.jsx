import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clapperboard, EyeOff, ImagePlus, List, Loader2, RotateCcw, Search, StopCircle, Zap } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import AssetReplacer from "./AssetReplacer";

const endpoint = "/api/dynamic-overlays/episode-title-changes";
const pageSize = 25;

export default function EpisodeTitleReview({ enabled, dryRun }) {
  const { t } = useTranslation();
  const text = (key, values) => t(`dynamicOverlays.episodeTitles.${key}`, values);
  const [data, setData] = useState({ entries: [], total: 0, eligible: 0, job: {} });
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [reviewType, setReviewType] = useState("all");
  const [includeUncertain, setIncludeUncertain] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [fastStarting, setFastStarting] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const [replacementAsset, setReplacementAsset] = useState(null);
  const selectPageRef = useRef(null);
  const fastRunIdRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    let timer;
    const controller = new AbortController();
    setLoading(true);
    const load = async () => {
      let delay = 15000;
      try {
        const params = new URLSearchParams({ search: query, limit: String(pageSize), offset: String(page * pageSize),
          status_filter: statusFilter, reason_filter: reasonFilter, review_type: reviewType });
        const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error("request_failed");
        if (active) {
          setData(result);
          if (result.job?.running) delay = 2000;
          if (page > 0 && result.total <= page * pageSize) setPage(Math.max(0, Math.ceil(result.total / pageSize) - 1));
        }
      } catch (failure) {
        if (active && failure.name !== "AbortError") setError("request_failed");
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(load, delay);
        }
      }
    };
    load();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [query, page, revision, enabled, dryRun, statusFilter, reasonFilter, reviewType]);

  const fastStartedAt = fastStarting?.startedAt || (data.job?.fast_run ? data.job.started_at : null);
  useEffect(() => {
    if (!fastStartedAt) {
      setElapsedSeconds(0);
      return undefined;
    }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(fastStartedAt).getTime()) / 1000)));
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [fastStartedAt]);

  useEffect(() => {
    const job = data.job;
    if (job?.fast_run && job.running) {
      fastRunIdRef.current = job.started_at;
      return;
    }
    if (job?.fast_run && fastRunIdRef.current && fastRunIdRef.current === job.started_at && !job.running) {
      setFastStarting(null);
      setNotice(text("fastRunFinished", { succeeded: job.succeeded || 0, restored: job.restored ?? job.failed ?? 0 }));
      fastRunIdRef.current = null;
      setRevision(value => value + 1);
    }
  }, [data.job]);

  const pageEntries = data.entries.filter(entry => entry.status === "ready" || (includeUncertain && entry.force_recreatable));
  const eligibleCount = includeUncertain ? (data.force_eligible ?? data.eligible) : data.eligible;
  const selectedOnPage = pageEntries.filter(entry => selected.has(entry.candidate_id)).length;
  const allOnPage = pageEntries.length > 0 && selectedOnPage === pageEntries.length;
  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = selectedOnPage > 0 && !allOnPage;
  }, [selectedOnPage, allOnPage]);

  const busy = Boolean(data.job?.running);
  const fastRunActive = Boolean(fastStarting || (busy && data.job?.fast_run));
  const progressPhase = fastStarting ? "preparing_fast_run" : data.job?.phase;
  const showRebuildProgress = (busy && data.job?.phase === "rebuilding") || fastRunActive;
  const indeterminateProgress = fastRunActive || progressPhase === "scanning";
  const fastRunCount = fastStarting?.count ?? data.job?.total ?? 0;
  const elapsedLabel = [Math.floor(elapsedSeconds / 3600), Math.floor((elapsedSeconds % 3600) / 60), elapsedSeconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
  const total = Math.max(0, Number(data.job?.total) || 0);
  const processed = Math.max(0, (Number(data.job?.processed) || 0) + (Number(data.job?.skipped) || 0));
  const progress = total ? Math.min(100, Math.round(processed / total * 100)) : 0;
  const hasFailures = (data.job?.failed || 0) > 0 || data.job?.phase === "failed";
  const progressTone = hasFailures ? "border-amber-500/70 bg-amber-500/10" : busy ? "border-theme-primary bg-theme-primary/10" : "border-theme bg-theme-hover/40";
  const canRebuild = enabled && !dryRun && data.can_rebuild && !busy && !pending && !loading && search === query;
  const canQueue = enabled && !dryRun && data.can_rebuild && !pending && !loading && search === query;
  const actionClass = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-theme px-3 py-2 text-xs font-medium text-theme-text hover:bg-theme-hover disabled:opacity-40 disabled:cursor-not-allowed";

  const post = async (action, body = {}) => {
    setPending(true);
    setError(null);
    setNotice(null);
    if (action === "fast-normal-run") {
      setFastStarting({ count: body.count || body.candidate_ids?.length || data.eligible, startedAt: new Date().toISOString() });
    }
    try {
      const response = await fetch(`${endpoint}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const known = ["busy", "master_off", "rebuild_disabled", "nothing_selected", "unavailable", "fast_run_failed"];
        throw new Error(known.includes(result.detail) ? result.detail : "request_failed");
      }
      setData(current => ({ ...current, job: result.job || current.job }));
      if (action === "rebuild") setSelected(new Set());
      if (action === "queue") {
        setSelected(new Set());
        setNotice(text("queued", { count: result.queued }));
      }
      if (action === "fast-normal-run") {
        setSelected(new Set());
        setNotice(text("fastRunStarted", { count: result.count }));
        setFastStarting(null);
      }
      if (action === "dismiss") setSelected(current => { const next = new Set(current); next.delete(body.candidate_id); return next; });
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure.message || "request_failed");
      if (action === "fast-normal-run") setFastStarting(null);
    } finally {
      setPending(false);
    }
  };

  const togglePage = () => setSelected(current => {
    const next = new Set(current);
    for (const entry of pageEntries) {
      if (allOnPage) next.delete(entry.candidate_id);
      else next.add(entry.candidate_id);
    }
    return next;
  });

  const activeFilters = { status_filter: statusFilter, reason_filter: reasonFilter, review_type: reviewType };
  const updateFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(0);
    setSelected(new Set());
  };

  return (
    <section className="min-w-0 max-w-full space-y-4 border-y border-theme py-5" aria-label={text("title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-theme-text">
            <Clapperboard className="h-5 w-5 shrink-0 text-theme-primary" />{text("title")}
          </h3>
          <p className="mt-1 text-xs text-theme-muted">{text("counts", { total: data.total, eligible: eligibleCount })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/queue" className={actionClass}><List className="h-4 w-4" />{t("queue.title")}</Link>
          <button type="button" className={actionClass} disabled={!enabled || busy || pending} onClick={() => post("scan")}>
            {busy && data.job.phase === "scanning" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {text("scan")}
          </button>
        </div>
      </div>

      {!enabled && <p className="text-xs text-theme-muted">{text("errors.master_off")}</p>}
      {enabled && dryRun && <p className="text-xs text-amber-500">{text("errors.rebuild_disabled")}</p>}
      {error && <p role="alert" className="flex items-center gap-2 text-sm text-red-500"><AlertTriangle className="h-4 w-4 shrink-0" />{text(`errors.${error}`)}</p>}
      {notice && <p role="status" className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</p>}
      {data.job.error && <p role="alert" className="text-sm text-red-500">{text(`errors.${data.job.error}`)}</p>}
      {data.job.scan_errors?.length > 0 && <p role="alert" className="text-xs text-amber-500">{text("partialScan", { servers: data.job.scan_errors.join(", ") })}</p>}

      {showRebuildProgress && (
        <div role="status" aria-live="polite" aria-atomic="true" className={`space-y-4 border-y-2 px-4 py-4 sm:px-5 ${progressTone}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${hasFailures ? "bg-amber-500/15 text-amber-500" : "bg-theme-primary/15 text-theme-primary"}`}>
                {busy || fastStarting ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" /> : hasFailures ? <AlertTriangle className="h-5 w-5" /> : data.job.phase === "cancelled" ? <StopCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <p className="break-words text-base font-semibold text-theme-text">{text(`phases.${progressPhase}`)}</p>
                {fastRunActive ? <div className="mt-2 space-y-1 text-sm text-theme-muted">
                  <p>{text(`fastRunStages.${progressPhase}`, { count: fastRunCount })}</p>
                  <p>{text("fastRunElapsed", { time: elapsedLabel })} · {text("fastRunEtaUnavailable")}</p>
                </div> : progressPhase !== "scanning" && <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-mono text-2xl font-semibold tabular-nums text-theme-text">{processed}<span className="text-lg font-normal text-theme-muted"> / {total}</span></p>
                  {total > 0 && <span className="text-sm font-semibold tabular-nums text-theme-muted">{progress}%</span>}
                </div>}
                {data.job.current_title && <p className="mt-1 break-words text-sm text-theme-text">{data.job.current_title}</p>}
              </div>
            </div>
            {busy && !fastRunActive && <button type="button" className={`${actionClass} min-h-10 shrink-0 bg-theme-card`} title={text("stopHint")} disabled={pending || data.job.cancel_requested} onClick={() => post("cancel")}>
              <StopCircle className="h-4 w-4" />{text("stop")}
            </button>}
          </div>
          <div role="progressbar" aria-label={text(`phases.${progressPhase}`)} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={indeterminateProgress ? undefined : progress}
            aria-valuetext={indeterminateProgress ? text(`phases.${progressPhase}`) : text("progress", { processed, total, succeeded: data.job.succeeded || 0, failed: data.job.failed || 0, skipped: data.job.skipped || 0 })}
            className="h-2.5 overflow-hidden rounded-sm bg-theme-bg/70">
            <div className={`h-full motion-safe:transition-[width] motion-safe:duration-300 ${hasFailures ? "bg-amber-500" : "bg-theme-primary"} ${indeterminateProgress ? "motion-safe:animate-pulse" : ""}`}
              style={{ width: indeterminateProgress ? "35%" : `${progress}%` }} />
          </div>
          {!fastRunActive && progressPhase !== "scanning" && <div className="grid grid-cols-3 gap-3 border-t border-theme/50 pt-3">
            <div className="min-w-0"><p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-emerald-500"><CheckCircle2 className="h-4 w-4 shrink-0" />{data.job.succeeded || 0}</p><p className="mt-0.5 break-words text-xs text-theme-muted">{text("progressRecreated")}</p></div>
            <div className="min-w-0"><p className={`flex items-center gap-1.5 text-lg font-semibold tabular-nums ${(data.job.failed || 0) > 0 ? "text-red-500" : "text-theme-muted"}`}><AlertTriangle className="h-4 w-4 shrink-0" />{data.job.failed || 0}</p><p className={`mt-0.5 break-words text-xs ${(data.job.failed || 0) > 0 ? "font-semibold text-red-500" : "text-theme-muted"}`}>{text("progressFailed")}</p></div>
            <div className="min-w-0"><p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums text-theme-muted"><ChevronRight className="h-4 w-4 shrink-0" />{data.job.skipped || 0}</p><p className="mt-0.5 break-words text-xs text-theme-muted">{text("progressSkipped")}</p></div>
          </div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-theme-muted" />
          <span className="sr-only">{text("search")}</span>
          <input type="search" value={search} placeholder={text("search")} onChange={event => {
            setSearch(event.target.value); setPage(0); setSelected(new Set());
          }} className="min-h-9 w-full rounded-lg border border-theme bg-theme-card py-2 pl-9 pr-3 text-xs text-theme-text" />
        </label>
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-theme bg-theme-card px-2 text-xs text-theme-muted">
          <span>{text("filterStatus")}</span>
          <select aria-label={text("filterStatus")} value={statusFilter} onChange={updateFilter(setStatusFilter)}
            className="max-w-36 bg-transparent py-2 text-theme-text">
            <option value="all">{text("filterAll")}</option>
            <option value="eligible">{text("filterEligible")}</option>
            <option value="blocked">{text("filterBlocked")}</option>
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-theme bg-theme-card px-2 text-xs text-theme-muted">
          <span>{text("filterReason")}</span>
          <select aria-label={text("filterReason")} value={reasonFilter} onChange={updateFilter(setReasonFilter)}
            className="max-w-44 bg-transparent py-2 text-theme-text">
            <option value="all">{text("filterAll")}</option>
            <option value="none">{text("filterNoReason")}</option>
            {[
              ["media_server_source", "media_server_source"], ["missing_source", "missing_source"],
              ["source_has_text", "source_has_text"], ["unknown_text", "unknown_text"], ["placeholder", "placeholder"]
            ].map(([value, key]) => <option key={value} value={value}>{text(`reasons.${key}`)}</option>)}
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-theme bg-theme-card px-2 text-xs text-theme-muted">
          <span>{text("filterType")}</span>
          <select aria-label={text("filterType")} value={reviewType} onChange={updateFilter(setReviewType)}
            className="max-w-36 bg-transparent py-2 text-theme-text">
            <option value="all">{text("filterAll")}</option>
            <option value="historical">{text("historical")}</option>
            <option value="future">{text("future")}</option>
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-xs text-amber-500">
          <input type="checkbox" checked={includeUncertain} disabled={busy || pending} onChange={event => {
            setIncludeUncertain(event.target.checked); setSelected(new Set());
          }} />{text("includeUncertain")}
        </label>
        <button type="button" className={actionClass} disabled={!canRebuild || !selected.size} onClick={() => setConfirmation({ candidate_ids: [...selected], count: selected.size, force_unknown_text: includeUncertain })}>
          <RotateCcw className="h-4 w-4 shrink-0" />{text("rebuildSelected", { count: selected.size })}
        </button>
        <button type="button" className={actionClass} disabled={!canQueue || !selected.size} title={text("queueHint")}
          onClick={() => setConfirmation({ queue: true, candidate_ids: [...selected], count: selected.size, force_unknown_text: includeUncertain })}>
          <List className="h-4 w-4 shrink-0" />{text("queueSelected", { count: selected.size })}
        </button>
        <button type="button" className={actionClass} disabled={!canRebuild || !eligibleCount} onClick={() => setConfirmation({ ...activeFilters, all_eligible: true, search: query, count: eligibleCount, force_unknown_text: includeUncertain })}>
          <RotateCcw className="h-4 w-4 shrink-0" />{text("rebuildAll", { count: eligibleCount })}
        </button>
        <button type="button" className={`${actionClass} border-amber-500/60 text-amber-500`} disabled={!canRebuild || !selected.size}
          onClick={() => setConfirmation({ ...activeFilters, fast_normal_run: true, candidate_ids: [...selected], count: selected.size, force_unknown_text: includeUncertain })}>
          <Zap className="h-4 w-4 shrink-0" />{text("fastSelected", { count: selected.size })}
        </button>
        <button type="button" className={`${actionClass} border-amber-500/60 text-amber-500`} disabled={!canRebuild || !eligibleCount}
          onClick={() => setConfirmation({ ...activeFilters, fast_normal_run: true, all_eligible: true, search: query, count: eligibleCount, force_unknown_text: includeUncertain })}>
          <Zap className="h-4 w-4 shrink-0" />{text("fastRun", { count: eligibleCount })}
        </button>
      </div>

      <div className="relative max-w-full overflow-x-auto rounded-lg border border-theme" aria-busy={loading}>
        <table className="w-full min-w-[800px] table-fixed text-left text-xs">
          <thead className="border-b border-theme bg-theme-hover/50 text-theme-muted">
            <tr>
              <th className="w-10 p-3"><input ref={selectPageRef} type="checkbox" aria-label={text("selectPage")} checked={allOnPage}
                disabled={!pageEntries.length || busy || loading || search !== query} onChange={togglePage} /></th>
              <th className="w-28 px-2 py-3">{text("preview")}</th>
              <th className="w-44 px-2 py-3">{text("episode")}</th>
              <th className="px-2 py-3">{text("previous")}</th>
              <th className="px-2 py-3">{text("current")}</th>
              <th className="w-36 px-2 py-3">{text("status")}</th>
              <th className="w-20"><span className="sr-only">{text("rebuildOne")}</span></th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map(entry => {
              const coordinates = `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`;
              const preview = `/poster_assets/${entry.preview_path.split("/").map(encodeURIComponent).join("/")}`;
              const needsProvider = ["media_server_source", "missing_source", "source_has_text"].includes(entry.reason)
                || (entry.reason === "unknown_text" && !entry.force_recreatable);
              return <tr key={entry.candidate_id} className="border-b border-theme last:border-0">
                <td className="p-3"><input type="checkbox" aria-label={text("selectEpisode", { episode: `${entry.parent_title || entry.folder} ${coordinates}` })}
                  checked={selected.has(entry.candidate_id)} disabled={(entry.status !== "ready" && !(includeUncertain && entry.force_recreatable)) || busy || loading || search !== query} onChange={event => {
                    const checked = event.target.checked;
                    setSelected(current => { const next = new Set(current); if (checked) next.add(entry.candidate_id); else next.delete(entry.candidate_id); return next; });
                  }} /></td>
                <td className="px-2 py-3"><a href={preview} target="_blank" rel="noreferrer" title={text("preview")}>
                  <img src={preview} alt={`${entry.parent_title || entry.folder} ${coordinates}`} loading="lazy" className="aspect-video w-24 rounded object-contain bg-black/10" />
                </a></td>
                <td className="px-2 py-3 text-theme-text"><p className="break-words font-medium">{entry.parent_title || entry.folder}</p>
                  <p className="mt-1 font-mono text-theme-muted">{coordinates}</p><p className="mt-1 break-words text-theme-muted">{entry.library} · {entry.server_type}</p></td>
                <td className="break-words px-2 py-3 text-theme-muted">{entry.old_title || text("unknown")}</td>
                <td className="break-words px-2 py-3 font-medium text-theme-text">{entry.title}</td>
                <td className="px-2 py-3"><p className={entry.status === "ready" ? "text-emerald-500" : "text-amber-500"}>
                  {entry.reason ? text(`reasons.${entry.reason}`) : text("ready")}</p>
                  {entry.rebuild_block_reason && <p className="mt-1 text-amber-500">{text(`reasons.${entry.rebuild_block_reason}`)}</p>}
                  <p className="mt-1 text-theme-muted">{entry.requires_review ? text("historical") : text("future")}</p>
                  {entry.last_error && <p className="mt-1 text-red-500">{text("errors.not_completed")}</p>}</td>
                <td className="px-2 py-3"><div className="flex items-center gap-1">{needsProvider && <button type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-theme text-theme-primary hover:bg-theme-hover disabled:opacity-40"
                  aria-label={text("chooseProviderImage")} title={text("chooseProviderImage")} disabled={!canRebuild}
                  onClick={() => setReplacementAsset({
                    path: entry.preview_path, type: "titlecard", filename: `${coordinates}.jpg`, url: preview,
                    _replacementMetadata: {title: entry.parent_title || entry.folder, show_title: entry.parent_title || entry.folder,
                      folder_name: entry.folder, library_name: entry.library, asset_type: "titlecard", media_type: "tv",
                      season_number: entry.season, episode_number: entry.episode},
                    _dbData: { Type: "Episode", Title: entry.parent_title || entry.folder,
                      EpisodeTitle: entry.title, Rootfolder: entry.folder, LibraryName: entry.library,
                      tmdbid: entry.provider_ids?.tmdb || "", tvdbid: entry.provider_ids?.tvdb || "",
                      imdbid: entry.provider_ids?.imdb || "", _attemptedEpisodeFetch: true }
                  })}><ImagePlus className="h-4 w-4" /></button>}{(!needsProvider || entry.force_recreatable) && <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-theme-hover disabled:opacity-40 ${entry.force_recreatable ? "border-amber-500/60 text-amber-500" : "border-theme text-theme-text"}`}
                  aria-label={text(entry.force_recreatable ? "fastOne" : "rebuildOne")} title={text(entry.force_recreatable ? "fastOne" : "rebuildOne")}
                  disabled={!canRebuild || (entry.status !== "ready" && !entry.force_recreatable)}
                  onClick={() => setConfirmation(entry.force_recreatable
                    ? { fast_normal_run: true, candidate_ids: [entry.candidate_id], count: 1, force_unknown_text: true }
                    : { candidate_ids: [entry.candidate_id], count: 1 })}>
                  {entry.force_recreatable ? <Zap className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}</button>}{entry.reason && <button type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-text disabled:opacity-40"
                  aria-label={text("dismissCandidate")} title={text("dismissCandidate")} disabled={pending || busy || loading || search !== query}
                  onClick={() => post("dismiss", { candidate_id: entry.candidate_id })}><EyeOff className="h-4 w-4" /></button>}</div></td>
              </tr>;
            })}
            {!data.entries.length && <tr><td colSpan={7} className="p-8 text-center text-theme-muted">{loading ? text("loading") : text("empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-theme-muted">
        <span>{text("page", { page: page + 1, pages: Math.max(1, Math.ceil(data.total / pageSize)) })}</span>
        <div className="flex gap-2">
          <button type="button" className={actionClass} aria-label={text("previousPage")} title={text("previousPage")} disabled={!page || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={actionClass} aria-label={text("nextPage")} title={text("nextPage")} disabled={(page + 1) * pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      {replacementAsset && <AssetReplacer key={replacementAsset.path} asset={replacementAsset} initialTab="previews" initialMetadata={replacementAsset._replacementMetadata}
        autoFetchProviders
        onClose={() => { setReplacementAsset(null); setRevision(value => value + 1); }}
        onSuccess={() => setRevision(value => value + 1)} />}
      <ConfirmDialog isOpen={Boolean(confirmation)} onClose={() => setConfirmation(null)} type="warning"
        title={text(confirmation?.fast_normal_run ? "fastRunTitle" : confirmation?.force_unknown_text ? "forceTitle" : "confirmTitle")}
        message={[
          confirmation?.fast_normal_run ? text("fastRunMessage", { count: confirmation.count })
            : confirmation?.force_unknown_text && confirmation.episode && !confirmation.media_server ? text("forceMessage", { episode: confirmation.episode, title: confirmation.title })
              : text("confirmMessage", { count: confirmation?.count || 0 }),
          confirmation?.force_unknown_text && !confirmation?.fast_normal_run && !confirmation.episode ? text("forceBulkMessage", { count: confirmation.count }) : "",
          confirmation?.force_unknown_text && !confirmation?.fast_normal_run && (confirmation.media_server || !confirmation.episode) ? text("forceServerHint") : "",
          confirmation?.queue ? text("queueHint") : ""
        ].filter(Boolean).join("\n\n")}
        confirmText={text(confirmation?.queue ? "queueAction" : confirmation?.fast_normal_run ? "fastRunAction" : confirmation?.force_unknown_text ? "forceAction" : "confirmAction")} onConfirm={() => {
          if (!confirmation || (confirmation.queue ? !canQueue : !canRebuild)) return;
          if (confirmation.queue) {
            const { queue, count, ...selection } = confirmation;
            setConfirmation(null);
            post("queue", { ...selection, ...activeFilters, confirmed: true });
            return;
          }
          if (confirmation.fast_normal_run) {
            const { fast_normal_run, count, ...selection } = confirmation;
            setConfirmation(null);
            post("fast-normal-run", { ...selection, count, confirmed: true });
            return;
          }
          const { count, episode, title, media_server, ...selection } = confirmation;
          setConfirmation(null);
          post("rebuild", { ...selection, ...activeFilters, confirmed: true });
        }} />
    </section>
  );
}