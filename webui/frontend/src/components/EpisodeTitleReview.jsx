import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Clapperboard, List, Loader2, RotateCcw, Search, StopCircle } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

const endpoint = "/api/dynamic-overlays/episode-title-changes";
const pageSize = 25;

export default function EpisodeTitleReview({ enabled, dryRun }) {
  const { t } = useTranslation();
  const text = (key, values) => t(`dynamicOverlays.episodeTitles.${key}`, values);
  const [data, setData] = useState({ entries: [], total: 0, eligible: 0, job: {} });
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const selectPageRef = useRef(null);

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
        const params = new URLSearchParams({ search: query, limit: String(pageSize), offset: String(page * pageSize) });
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
  }, [query, page, revision, enabled, dryRun]);

  const pageEntries = data.entries.filter(entry => entry.status === "ready");
  const selectedOnPage = pageEntries.filter(entry => selected.has(entry.candidate_id)).length;
  const allOnPage = pageEntries.length > 0 && selectedOnPage === pageEntries.length;
  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = selectedOnPage > 0 && !allOnPage;
  }, [selectedOnPage, allOnPage]);

  const busy = Boolean(data.job?.running);
  const canRebuild = enabled && !dryRun && data.can_rebuild && !busy && !pending && !loading && search === query;
  const actionClass = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-theme px-3 py-2 text-xs font-medium text-theme-text hover:bg-theme-hover disabled:opacity-40 disabled:cursor-not-allowed";

  const post = async (action, body = {}) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const known = ["busy", "master_off", "rebuild_disabled", "nothing_selected", "unavailable"];
        throw new Error(known.includes(result.detail) ? result.detail : "request_failed");
      }
      setData(current => ({ ...current, job: result.job }));
      if (action === "rebuild") setSelected(new Set());
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure.message || "request_failed");
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

  return (
    <section className="min-w-0 max-w-full space-y-4 border-y border-theme py-5" aria-label={text("title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-theme-text">
            <Clapperboard className="h-5 w-5 shrink-0 text-theme-primary" />{text("title")}
          </h3>
          <p className="mt-1 text-xs text-theme-muted">{text("counts", { total: data.total, eligible: data.eligible })}</p>
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
      {data.job.error && <p role="alert" className="text-sm text-red-500">{text(`errors.${data.job.error}`)}</p>}
      {data.job.scan_errors?.length > 0 && <p role="alert" className="text-xs text-amber-500">{text("partialScan", { servers: data.job.scan_errors.join(", ") })}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-theme-muted" />
          <span className="sr-only">{text("search")}</span>
          <input type="search" value={search} placeholder={text("search")} onChange={event => {
            setSearch(event.target.value); setPage(0); setSelected(new Set());
          }} className="min-h-9 w-full rounded-lg border border-theme bg-theme-card py-2 pl-9 pr-3 text-xs text-theme-text" />
        </label>
        <button type="button" className={actionClass} disabled={!canRebuild || !selected.size} onClick={() => setConfirmation({ candidate_ids: [...selected], count: selected.size })}>
          <RotateCcw className="h-4 w-4 shrink-0" />{text("rebuildSelected", { count: selected.size })}
        </button>
        <button type="button" className={actionClass} disabled={!canRebuild || !data.eligible} onClick={() => setConfirmation({ all_eligible: true, search: query, count: data.eligible })}>
          <RotateCcw className="h-4 w-4 shrink-0" />{text("rebuildAll", { count: data.eligible })}
        </button>
      </div>

      {data.job.phase && data.job.phase !== "idle" && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-theme-primary pl-3 text-xs text-theme-muted">
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-theme-text">{text(`phases.${data.job.phase}`)}</p>
            {data.job.phase !== "scanning" && <p>{text("progress", { processed: (data.job.processed || 0) + (data.job.skipped || 0), total: data.job.total || 0,
              succeeded: data.job.succeeded || 0, failed: data.job.failed || 0, skipped: data.job.skipped || 0 })}</p>}
            {data.job.current_title && <p className="break-words">{data.job.current_title}</p>}
          </div>
          {busy && <button type="button" className={actionClass} title={text("stopHint")} disabled={pending || data.job.cancel_requested} onClick={() => post("cancel")}>
            <StopCircle className="h-4 w-4" />{text("stop")}
          </button>}
        </div>
      )}

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
              <th className="w-12"><span className="sr-only">{text("rebuildOne")}</span></th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map(entry => {
              const coordinates = `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`;
              const preview = `/poster_assets/${entry.preview_path.split("/").map(encodeURIComponent).join("/")}`;
              return <tr key={entry.candidate_id} className="border-b border-theme last:border-0">
                <td className="p-3"><input type="checkbox" aria-label={text("selectEpisode", { episode: `${entry.parent_title || entry.folder} ${coordinates}` })}
                  checked={selected.has(entry.candidate_id)} disabled={entry.status !== "ready" || busy || loading || search !== query} onChange={event => {
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
                  <p className="mt-1 text-theme-muted">{entry.requires_review ? text("historical") : text("future")}</p>
                  {entry.last_error && <p className="mt-1 text-red-500">{text("errors.not_completed")}</p>}</td>
                <td className="px-2 py-3"><button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-theme text-theme-text hover:bg-theme-hover disabled:opacity-40"
                  aria-label={text("rebuildOne")} title={text("rebuildOne")} disabled={!canRebuild || entry.status !== "ready"}
                  onClick={() => setConfirmation({ candidate_ids: [entry.candidate_id], count: 1 })}><RotateCcw className="h-4 w-4" /></button></td>
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
      <ConfirmDialog isOpen={Boolean(confirmation)} onClose={() => setConfirmation(null)} type="warning"
        title={text("confirmTitle")} message={text("confirmMessage", { count: confirmation?.count || 0 })}
        confirmText={text("confirmAction")} onConfirm={() => {
          if (!confirmation || !canRebuild) return;
          const { count, ...selection } = confirmation;
          post("rebuild", { ...selection, confirmed: true });
        }} />
    </section>
  );
}