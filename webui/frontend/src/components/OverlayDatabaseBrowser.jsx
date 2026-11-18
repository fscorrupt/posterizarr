import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Database, Eye, Loader2, RefreshCw, Search, X } from "lucide-react";

const TABLES = [
  { database: "overlay_cache.db", table: "dynamic_overlay_cache", label: "Artwork fingerprints" },
  { database: "overlay_cache.db", table: "media_ratings_cache", label: "Ratings & metadata" },
  { database: "animetafill.db", table: "episodes", label: "Anime episodes" },
  { database: "animetafill.db", table: "updates", label: "Anime updates" },
];

const displayValue = value => value === null || value === undefined ? "-" : typeof value === "object" ? JSON.stringify(value) : String(value);
const fieldLabel = field => field.replaceAll("_", " ");

export default function OverlayDatabaseBrowser({ databases }) {
  const [selection, setSelection] = useState(TABLES[0]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sortBy, setSortBy] = useState("");
  const [descending, setDescending] = useState(true);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const dialogRef = useRef(null);

  const tables = [...TABLES];
  for (const database of databases || []) {
    for (const table of database.tables || []) {
      if (!tables.some(entry => entry.database === database.filename && entry.table === table.name)) {
        tables.push({ database: database.filename, table: table.name, label: fieldLabel(table.name) });
      }
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const parameters = new URLSearchParams({ database: selection.database, table: selection.table, page, limit, search: query, descending });
    if (sortBy) parameters.set("sort_by", sortBy);
    fetch(`/api/dynamic-overlays/database-entries?${parameters}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.detail || result.error || "Unable to load database records.");
        return result;
      })
      .then(result => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selection.database, selection.table, page, limit, query, sortBy, descending, revision]);

  useEffect(() => {
    if (selectedRecord && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [selectedRecord]);

  const chooseTable = table => {
    setSelection(table);
    setSearch("");
    setQuery("");
    setPage(1);
    setSortBy("");
    setDescending(true);
  };

  const closeRecord = () => {
    dialogRef.current?.close();
    setSelectedRecord(null);
  };

  const sortColumn = column => {
    setSortBy(column);
    setDescending(sortBy === column ? !descending : false);
    setPage(1);
  };

  const total = data?.total || 0;
  const currentPage = data?.page || page;

  return (
    <section id="overlay-database-records" className="insight-records lg:col-span-2 scroll-mt-24" aria-label="Overlay database records">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-theme">
        <h3 className="flex items-center gap-2 text-base font-semibold text-theme-text"><Database size={17} className="text-emerald-400" /> Database Records</h3>
        <span className="text-xs font-mono text-theme-muted">{selection.database}</span>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-theme px-3 pt-2" role="tablist" aria-label="Database tables">
        {tables.map(table => (
          <button key={`${table.database}:${table.table}`} type="button" role="tab" aria-selected={selection.database === table.database && selection.table === table.table}
            onClick={() => chooseTable(table)} className={`shrink-0 border-b-2 px-3 py-3 text-xs font-medium transition-colors ${selection.database === table.database && selection.table === table.table ? "border-theme-primary text-theme-primary" : "border-transparent text-theme-muted hover:text-theme-text"}`}>
            {table.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted pointer-events-none" />
          <input type="search" aria-label="Search database records" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search all fields..." className="w-full rounded-md border border-theme bg-theme-bg py-2 pl-9 pr-3 text-sm text-theme-text" />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-theme-muted">Rows
            <select aria-label="Records per page" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1); }} className="rounded-md border border-theme bg-theme-bg px-2 py-2 text-theme-text">
              {[25, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button type="button" title="Refresh database records" aria-label="Refresh database records" disabled={loading} onClick={() => setRevision(value => value + 1)} className="rounded-md p-2 text-theme-muted hover:bg-theme-hover disabled:opacity-40"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>
      {error ? <div role="alert" className="px-5 py-8 text-sm text-red-400">{error}</div> : loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-theme-muted"><Loader2 size={18} className="animate-spin" /> Loading records...</div>
      ) : !data?.exists ? <p className="px-5 py-10 text-center text-sm text-theme-muted">This database has not been created yet.</p> : data.entries.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-theme-muted">{query ? "No records match your search." : "No records in this table."}</p>
      ) : (
        <div className="max-h-[560px] overflow-auto border-y border-theme" tabIndex={0} role="region" aria-label="Database record table">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-theme-card text-theme-muted">
              <tr><th scope="col" className="w-12 px-3 py-3"><span className="sr-only">Details</span></th>
                {data.columns.map(column => <th key={column} scope="col" aria-sort={sortBy === column ? (descending ? "descending" : "ascending") : "none"} className="px-4 py-3 font-medium">
                  <button type="button" onClick={() => sortColumn(column)} className="flex items-center gap-2 capitalize hover:text-theme-primary">{fieldLabel(column)}{sortBy === column && (descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}</button>
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-theme">
              {data.entries.map((record, index) => <tr key={`${currentPage}:${index}`} className="hover:bg-theme-hover/50">
                <td className="px-3 py-3"><button type="button" aria-label={`View record ${index + 1}`} title="View full record" onClick={() => setSelectedRecord(record)} className="rounded-md p-1.5 text-theme-muted hover:text-theme-primary"><Eye size={15} /></button></td>
                {data.columns.map(column => <td key={column} className="max-w-[280px] truncate px-4 py-3 text-theme-text" title={displayValue(record[column])}>{displayValue(record[column])}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-theme-muted">
        <span aria-live="polite">{total.toLocaleString()} {total === 1 ? "record" : "records"}{total > 0 ? ` / ${((currentPage - 1) * limit + 1).toLocaleString()}-${Math.min(currentPage * limit, total).toLocaleString()}` : ""}</span>
        <div className="flex items-center gap-3">
          <button type="button" title="Previous page" aria-label="Previous records page" disabled={loading || currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-md p-2 hover:bg-theme-hover disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="tabular-nums">{currentPage} / {Math.max(1, data?.total_pages || 0)}</span>
          <button type="button" title="Next page" aria-label="Next records page" disabled={loading || currentPage >= (data?.total_pages || 0)} onClick={() => setPage(currentPage + 1)} className="rounded-md p-2 hover:bg-theme-hover disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>
      <dialog ref={dialogRef} onCancel={() => setSelectedRecord(null)} onClose={() => setSelectedRecord(null)} onClick={event => { if (event.target === event.currentTarget) closeRecord(); }} className="insight-record-dialog w-[calc(100%_-_2rem)] max-w-3xl rounded-lg border border-theme bg-theme-card p-0 text-theme-text backdrop:bg-black/70" aria-labelledby="database-record-title">
        {selectedRecord && <>
          <div className="flex items-center justify-between gap-4 border-b border-theme px-5 py-4"><h3 id="database-record-title" className="text-base font-semibold">Record Details</h3><button type="button" autoFocus title="Close record" aria-label="Close record" onClick={closeRecord} className="rounded-md p-2 hover:bg-theme-hover"><X size={18} /></button></div>
          <dl className="max-h-[70vh] overflow-auto divide-y divide-theme px-5">
            {Object.entries(selectedRecord).map(([field, value]) => <div key={field} className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-2 py-3"><dt className="text-xs capitalize text-theme-muted break-words">{fieldLabel(field)}</dt><dd className="whitespace-pre-wrap break-all font-mono text-xs text-theme-text select-text">{displayValue(value)}</dd></div>)}
          </dl>
        </>}
      </dialog>
    </section>
  );
}