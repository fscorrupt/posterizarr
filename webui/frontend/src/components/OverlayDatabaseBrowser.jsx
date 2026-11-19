import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Database, Eye, Loader2, RefreshCw, Search, X } from "lucide-react";

const FALLBACK_DATABASES = [
  {
    name: "Overlay Cache",
    filename: "overlay_cache.db",
    exists: true,
    total_records: 0,
    tables: [
      { name: "dynamic_overlay_cache", records: 0 },
      { name: "media_ratings_cache", records: 0 },
    ],
  },
  {
    name: "AniMetaFill",
    filename: "animetafill.db",
    exists: true,
    total_records: 0,
    tables: [
      { name: "episodes", records: 0 },
      { name: "updates", records: 0 },
    ],
  },
];

const displayValue = value => value === null || value === undefined ? "-" : typeof value === "object" ? JSON.stringify(value) : String(value);
const fieldLabel = field => field.replaceAll("_", " ");

export default function OverlayDatabaseBrowser({ databases, selectedTarget = null }) {
  const { t } = useTranslation();
  const dbList = useMemo(
    () => (Array.isArray(databases) && databases.length > 0 ? databases : FALLBACK_DATABASES),
    [databases]
  );

  const [selectedDb, setSelectedDb] = useState(dbList[0].filename);
  const [selectedTable, setSelectedTable] = useState(dbList[0].tables?.[0]?.name || "");
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
  const initializedRef = useRef(false);

  const resolveDbName = db =>
    t(`runtime_history.dbBrowser.databases.${db.filename}`, { defaultValue: db.name });

  const resolveTableName = (databaseFilename, tableName) => {
    const key = databaseFilename === "imdb_dataset.db" && tableName === "episodes"
      ? "imdb_episodes"
      : tableName;
    return t(`runtime_history.dbBrowser.tables.${key}`, { defaultValue: fieldLabel(tableName) });
  };

  // Pick initial existing DB on first real payload
  useEffect(() => {
    if (!Array.isArray(databases) || databases.length === 0) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      const firstPopulated = databases.find(d => d.exists && d.tables?.length > 0) || databases[0];
      setSelectedDb(firstPopulated.filename);
      setSelectedTable(firstPopulated.tables?.[0]?.name || "");
      return;
    }
    const currentDb = databases.find(d => d.filename === selectedDb);
    if (!currentDb) {
      const firstPopulated = databases.find(d => d.exists && d.tables?.length > 0) || databases[0];
      setSelectedDb(firstPopulated.filename);
      setSelectedTable(firstPopulated.tables?.[0]?.name || "");
    } else if (currentDb.tables?.length > 0 && !currentDb.tables.some(tb => tb.name === selectedTable)) {
      setSelectedTable(currentDb.tables[0].name);
    }
  }, [databases, selectedDb, selectedTable]);

  // Honor external selection triggered from System Databases cards
  useEffect(() => {
    if (!selectedTarget?.database) return;
    const targetDb = dbList.find(d => d.filename === selectedTarget.database);
    const nextTable = selectedTarget.table || targetDb?.tables?.[0]?.name || "";
    setSelectedDb(selectedTarget.database);
    setSelectedTable(nextTable);
    setSearch("");
    setQuery("");
    setPage(1);
    setSortBy("");
    setDescending(true);
    setRevision(v => v + 1);
  }, [selectedTarget?.database, selectedTarget?.table, selectedTarget?.seq, dbList]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const activeDb = useMemo(
    () => dbList.find(d => d.filename === selectedDb) || dbList[0],
    [dbList, selectedDb]
  );

  const activeTables = activeDb?.tables || [];

  useEffect(() => {
    if (!activeDb) return;
    if (!activeDb.exists) {
      setLoading(false);
      setError("");
      setData({ database: activeDb.filename, table: selectedTable, exists: false, columns: [], entries: [], total: 0, total_pages: 0, page: 1, limit });
      return;
    }
    const tableToFetch = selectedTable || activeTables[0]?.name || "";
    if (!tableToFetch) {
      setLoading(false);
      setError("");
      setData({ database: activeDb.filename, table: "", exists: true, columns: [], entries: [], total: 0, total_pages: 0, page: 1, limit });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const parameters = new URLSearchParams({ database: activeDb.filename, table: tableToFetch, page, limit, search: query, descending });
    if (sortBy) parameters.set("sort_by", sortBy);
    fetch(`/api/dynamic-overlays/database-entries?${parameters}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.detail || result.error || t("runtime_history.dbBrowser.unableToLoad"));
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
  }, [activeDb, selectedTable, activeTables, page, limit, query, sortBy, descending, revision, t]);

  useEffect(() => {
    if (selectedRecord && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [selectedRecord]);

  const chooseDatabase = db => {
    setSelectedDb(db.filename);
    setSelectedTable(db.tables?.[0]?.name || "");
    setSearch("");
    setQuery("");
    setPage(1);
    setSortBy("");
    setDescending(true);
  };

  const chooseTable = tableName => {
    setSelectedTable(tableName);
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
    <section id="overlay-database-records" className="insight-records lg:col-span-2 scroll-mt-24" aria-label={t("runtime_history.dbBrowser.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-theme">
        <h3 className="flex items-center gap-2 text-base font-semibold text-theme-text">
          <Database size={17} className="text-emerald-400" /> {t("runtime_history.dbBrowser.title")}
        </h3>
        <div className="flex items-center gap-2 text-xs font-mono text-theme-muted">
          <span>{activeDb?.filename}</span>
          {activeDb?.exists && (
            <span className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06]">
              {(activeDb.total_records || 0).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Database selector pills */}
      <div className="flex flex-wrap gap-1.5 border-b border-theme px-4 py-2.5 bg-black/20" role="tablist" aria-label={t("runtime_history.dbBrowser.databasesAria")}>
        {dbList.map(db => {
          const isSelected = activeDb?.filename === db.filename;
          return (
            <button
              key={db.filename}
              type="button"
              role="tab"
              aria-selected={isSelected}
              title={db.filename}
              onClick={() => chooseDatabase(db)}
              className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
                isSelected
                  ? "border-theme-primary bg-theme-primary/15 text-theme-primary shadow-sm"
                  : db.exists
                    ? "border-white/[0.08] bg-black/25 text-theme-text-muted hover:text-theme-text hover:border-white/20"
                    : "border-white/[0.04] bg-black/15 text-theme-text-muted/50 hover:text-theme-text-muted"
              }`}
            >
              <span>{resolveDbName(db)}</span>
              <span className={`font-mono text-[10px] px-1.5 py-0.2 rounded ${isSelected ? "bg-black/30 text-theme-primary" : "bg-white/[0.06] text-theme-text-muted"}`}>
                {db.exists ? (db.total_records || 0).toLocaleString() : "-"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tables within selected database */}
      {activeTables.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-theme px-3 pt-2" role="tablist" aria-label={t("runtime_history.dbBrowser.tablesAria")}>
          {activeTables.map(table => {
            const isSelected = selectedTable === table.name;
            return (
              <button
                key={`${activeDb.filename}:${table.name}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => chooseTable(table.name)}
                className={`shrink-0 inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? "border-theme-primary text-theme-primary"
                    : "border-transparent text-theme-muted hover:text-theme-text"
                }`}
              >
                <span>{resolveTableName(activeDb.filename, table.name)}</span>
                {typeof table.records === "number" && (
                  <span className="font-mono text-[10px] text-theme-text-muted">({table.records.toLocaleString()})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted pointer-events-none" />
          <input
            type="search"
            aria-label={t("runtime_history.dbBrowser.searchAria")}
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t("runtime_history.dbBrowser.searchPlaceholder")}
            className="w-full rounded-md border border-theme bg-theme-bg py-2 pl-9 pr-3 text-sm text-theme-text"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-theme-muted">
            {t("runtime_history.dbBrowser.rows")}
            <select
              aria-label={t("runtime_history.dbBrowser.rowsPerPage")}
              value={limit}
              onChange={event => { setLimit(Number(event.target.value)); setPage(1); }}
              className="rounded-md border border-theme bg-theme-bg px-2 py-2 text-theme-text"
            >
              {[25, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button
            type="button"
            title={t("runtime_history.dbBrowser.refresh")}
            aria-label={t("runtime_history.dbBrowser.refresh")}
            disabled={loading}
            onClick={() => setRevision(value => value + 1)}
            className="rounded-md p-2 text-theme-muted hover:bg-theme-hover disabled:opacity-40"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="px-5 py-8 text-sm text-red-400">{error}</div>
      ) : loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-theme-muted">
          <Loader2 size={18} className="animate-spin" /> {t("runtime_history.dbBrowser.loading")}
        </div>
      ) : !data?.exists ? (
        <p className="px-5 py-10 text-center text-sm text-theme-muted">{t("runtime_history.dbBrowser.notCreated")}</p>
      ) : data.entries.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-theme-muted">
          {query ? t("runtime_history.dbBrowser.noSearchMatches") : t("runtime_history.dbBrowser.noRecords")}
        </p>
      ) : (
        <div className="max-h-[560px] overflow-auto border-y border-theme" tabIndex={0} role="region" aria-label={t("runtime_history.dbBrowser.tablesAria")}>
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-theme-card text-theme-muted">
              <tr>
                <th scope="col" className="w-12 px-3 py-3">
                  <span className="sr-only">{t("runtime_history.dbBrowser.details")}</span>
                </th>
                {data.columns.map(column => (
                  <th key={column} scope="col" aria-sort={sortBy === column ? (descending ? "descending" : "ascending") : "none"} className="px-4 py-3 font-medium">
                    <button type="button" onClick={() => sortColumn(column)} className="flex items-center gap-2 capitalize hover:text-theme-primary">
                      {fieldLabel(column)}
                      {sortBy === column && (descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-theme">
              {data.entries.map((record, index) => (
                <tr key={`${currentPage}:${index}`} className="hover:bg-theme-hover/50">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      aria-label={`${t("runtime_history.dbBrowser.viewRecord")} ${index + 1}`}
                      title={t("runtime_history.dbBrowser.viewRecord")}
                      onClick={() => setSelectedRecord(record)}
                      className="rounded-md p-1.5 text-theme-muted hover:text-theme-primary"
                    >
                      <Eye size={15} />
                    </button>
                  </td>
                  {data.columns.map(column => (
                    <td key={column} className="max-w-[280px] truncate px-4 py-3 text-theme-text" title={displayValue(record[column])}>
                      {displayValue(record[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-theme-muted">
        <span aria-live="polite">
          {total.toLocaleString()} {t(total === 1 ? "runtime_history.dbBrowser.recordOne" : "runtime_history.dbBrowser.recordMany")}
          {total > 0 ? ` / ${((currentPage - 1) * limit + 1).toLocaleString()}-${Math.min(currentPage * limit, total).toLocaleString()}` : ""}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            title={t("runtime_history.dbBrowser.previousPage")}
            aria-label={t("runtime_history.dbBrowser.previousPage")}
            disabled={loading || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            className="rounded-md p-2 hover:bg-theme-hover disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="tabular-nums">{currentPage} / {Math.max(1, data?.total_pages || 0)}</span>
          <button
            type="button"
            title={t("runtime_history.dbBrowser.nextPage")}
            aria-label={t("runtime_history.dbBrowser.nextPage")}
            disabled={loading || currentPage >= (data?.total_pages || 0)}
            onClick={() => setPage(currentPage + 1)}
            className="rounded-md p-2 hover:bg-theme-hover disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        onCancel={() => setSelectedRecord(null)}
        onClose={() => setSelectedRecord(null)}
        onClick={event => { if (event.target === event.currentTarget) closeRecord(); }}
        className="insight-record-dialog w-[calc(100%_-_2rem)] max-w-3xl rounded-lg border border-theme bg-theme-card p-0 text-theme-text backdrop:bg-black/70"
        aria-labelledby="database-record-title"
      >
        {selectedRecord && (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-theme px-5 py-4">
              <h3 id="database-record-title" className="text-base font-semibold">
                {t("runtime_history.dbBrowser.recordDetails")}
              </h3>
              <button
                type="button"
                autoFocus
                title={t("runtime_history.dbBrowser.closeRecord")}
                aria-label={t("runtime_history.dbBrowser.closeRecord")}
                onClick={closeRecord}
                className="rounded-md p-2 hover:bg-theme-hover"
              >
                <X size={18} />
              </button>
            </div>
            <dl className="max-h-[70vh] overflow-auto divide-y divide-theme px-5">
              {Object.entries(selectedRecord).map(([field, value]) => (
                <div key={field} className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-2 py-3">
                  <dt className="text-xs capitalize text-theme-muted break-words">{fieldLabel(field)}</dt>
                  <dd className="whitespace-pre-wrap break-all font-mono text-xs text-theme-text select-text">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </dialog>
    </section>
  );
}
