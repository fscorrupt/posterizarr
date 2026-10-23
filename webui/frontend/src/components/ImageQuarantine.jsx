import React, { useEffect, useState } from "react";
import { Archive, AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import WorkspaceHeader from "./WorkspaceHeader";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "../context/ToastContext";
import { useNavigate } from "react-router-dom";

const endpoint = "/api/plex-image-cleanup/quarantine";

const formatSize = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent ? 2 : 0)} ${units[exponent]}`;
};

export default function ImageQuarantine() {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null);
  const [data, setData] = useState({ runs: [], total_files: 0, total_bytes: 0, cleanup_running: false, deletion_running: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loadRuns = async (signal) => {
    setLoading(true);
    setError("");
    try {
      const availabilityResponse = await fetch("/api/plex-image-cleanup/availability", { signal });
      const availability = await availabilityResponse.json();
      if (!availabilityResponse.ok || !availability.success) throw new Error("Unable to check Plex quarantine availability");
      if (signal?.aborted) return;
      if (!availability.visible) {
        setAvailable(false);
        navigate("/asset-overview", { replace: true });
        return;
      }
      setAvailable(true);
      const response = await fetch(endpoint, { signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.detail || result.error || "Unable to load image quarantine");
      if (!signal?.aborted) setData(result);
    } catch (failure) {
      if (failure.name !== "AbortError") setError(failure.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal);
    return () => controller.abort();
  }, []);

  const deleteRun = async (run) => {
    if (!run || deleting) return;
    setDeleting(run.id);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: run.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.detail || result.error || "Unable to delete quarantine run");
      setData(previous => {
        const runs = previous.runs.filter(candidate => candidate.id !== run.id);
        return { ...previous, runs, total_files: runs.reduce((total, candidate) => total + candidate.files, 0), total_bytes: runs.reduce((total, candidate) => total + candidate.bytes, 0) };
      });
      showSuccess(`Deleted ${result.deleted_files.toLocaleString()} quarantined files (${formatSize(result.deleted_bytes)}).`);
      window.dispatchEvent(new Event("plexQuarantineChanged"));
      await loadRuns();
    } catch (failure) {
      showError(failure.message);
    } finally {
      setDeleting(null);
    }
  };

  const busy = Boolean(deleting || data.cleanup_running || data.deletion_running);

  if (available !== true) {
    return <div className="workspace-page" role={error ? "alert" : "status"}>{error || (available === false ? "" : "Loading...")}</div>;
  }

  return (
    <div className="workspace-page space-y-6">
      <WorkspaceHeader icon={Archive} title="Plex Image Quarantine">
        <button type="button" onClick={() => loadRuns()} disabled={loading || Boolean(deleting)} title="Refresh quarantine runs" aria-label="Refresh quarantine runs" className="p-2 rounded-lg border border-theme text-theme-text hover:bg-theme-hover disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </WorkspaceHeader>

      <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-theme pb-4 text-sm text-theme-muted" aria-label="Quarantine totals">
        <span><strong className="text-theme-text">{data.runs.length.toLocaleString()}</strong> {data.runs.length === 1 ? "run" : "runs"}</span>
        <span><strong className="text-theme-text">{data.total_files.toLocaleString()}</strong> {data.total_files === 1 ? "file" : "files"}</span>
        <span><strong className="text-theme-text">{formatSize(data.total_bytes)}</strong> stored</span>
      </div>

      {(data.cleanup_running || data.deletion_running) && <div role="status" className="flex items-center gap-2 text-sm text-amber-400"><Loader2 className="w-4 h-4 animate-spin shrink-0" />Image maintenance is active. Deletion is temporarily unavailable.</div>}
      {error && <div role="alert" className="flex items-start gap-2 text-sm text-red-400"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      {loading && data.runs.length === 0 ? (
        <div role="status" className="flex items-center gap-2 py-8 text-theme-muted"><Loader2 className="w-5 h-5 animate-spin" />Loading quarantine runs...</div>
      ) : data.runs.length === 0 && !error ? (
        <div className="py-12 text-center text-theme-muted"><Archive className="w-9 h-9 mx-auto mb-3" /><h2 className="text-base font-semibold text-theme-text">No quarantined Plex images</h2></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Quarantine runs">
            <thead className="border-b border-theme text-theme-muted"><tr><th className="py-3 pr-4 font-medium">Run</th><th className="py-3 pr-4 font-medium">Created (Server Time)</th><th className="py-3 pr-4 font-medium text-right">Files</th><th className="py-3 pr-4 font-medium text-right">Stored Size</th><th className="py-3 font-medium text-right">Action</th></tr></thead>
            <tbody>
              {data.runs.map(run => (
                <tr key={run.id} className="border-b border-theme hover:bg-theme-hover/40">
                  <td className="py-4 pr-4 min-w-0"><span className="font-mono text-xs text-theme-text break-all">{run.id}</span>{run.warning && <div className="text-xs text-amber-400 mt-1">{run.warning}</div>}</td>
                  <td className="py-4 pr-4 whitespace-nowrap text-theme-muted">{run.created_at.replace("T", " ")}</td>
                  <td className="py-4 pr-4 text-right tabular-nums text-theme-text">{run.files.toLocaleString()}</td>
                  <td className="py-4 pr-4 text-right tabular-nums whitespace-nowrap text-theme-text">{formatSize(run.bytes)}</td>
                  <td className="py-4 text-right">
                    <button type="button" onClick={() => setDeleteTarget(run)} disabled={busy || loading || !run.deletable} aria-label={`Delete quarantine run ${run.id}`} title={run.warning || "Permanently delete this quarantine run"} className="inline-flex p-2 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                      {deleting === run.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog isOpen={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteRun(deleteTarget)} title="Permanently delete quarantine run?" itemName={deleteTarget?.id} confirmText="Delete Permanently" message={deleteTarget ? `Delete ${deleteTarget.files.toLocaleString()} recovery copies (${formatSize(deleteTarget.bytes)})? These images can no longer be restored. Active Plex artwork and other quarantine runs are not removed. This cannot be undone.` : ""} />
    </div>
  );
}