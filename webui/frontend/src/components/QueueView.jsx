import React, { useState, useEffect } from "react";
import {
    Play,
    Trash2,
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Clock,
    FileImage,
    Link as LinkIcon,
    List,
    ChevronLeft,
    ChevronRight,
    Square,
    CheckSquare
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import WorkspaceHeader from "./WorkspaceHeader";

const ITEMS_PER_PAGE = 50;

const QueueView = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [isPosterizarrRunning, setIsPosterizarrRunning] = useState(false);

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const response = await fetch("/api/status");
                if (response.ok) {
                    const data = await response.json();
                    setIsPosterizarrRunning(data.running || false);
                }
            } catch (error) {
                console.error("Error checking status:", error);
            }
        };

        checkStatus();
        const interval = setInterval(checkStatus, 3000); // Poll every 3 seconds
        return () => clearInterval(interval);
    }, []);

    // Confirm Dialog State
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState({
        title: "",
        message: "",
        action: () => { }
    });

    const fetchQueue = async () => {
        try {
            const response = await fetch("/api/queue");
            if (response.ok) {
                const data = await response.json();
                setItems(data);

                // Clear selection if items are gone, or keep valid ones
                setSelectedItems(prev => {
                    const newSet = new Set();
                    data.forEach(item => {
                        if (prev.has(item.id)) newSet.add(item.id);
                    });
                    return newSet;
                });
            }
        } catch (error) {
            console.error("Failed to fetch queue:", error);
        } finally {
            setLoading(false);
        }
    };

    const prevProcessingRef = React.useRef(false);

    useEffect(() => {
        fetchQueue();
        const interval = setInterval(() => {
            fetchQueue();

            if (prevProcessingRef.current === true && processing === false) {
                // The queue just finished! Trigger the refresh once.
                window.dispatchEvent(new Event("assetReplaced"));
            }
            prevProcessingRef.current = processing;
        }, 5000);
        return () => clearInterval(interval);
    }, [processing]);

    const handleRunQueue = async () => {
        setProcessing(true);
        try {
            const payload = selectedItems.size > 0
                ? { item_ids: Array.from(selectedItems) }
                : null;

            const response = await fetch("/api/queue/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                showToast(t("queue.executionStarted"), "success");
                setSelectedItems(new Set());
                fetchQueue();
            } else {
                const data = await response.json();
                showToast(data.detail || t("queue.startFailed"), "error");
            }
        } catch (error) {
            showToast(t("queue.errorStarting"), "error");
        } finally {
            setProcessing(false);
        }
    };

    const confirmClearQueue = () => {
        setConfirmConfig({
            title: t("queue.clearQueue"),
            message: t("queue.confirmClear"),
            action: performClearQueue
        });
        setConfirmOpen(true);
    };

    const performClearQueue = async () => {
        try {
            const response = await fetch("/api/queue/clear", { method: "POST" });
            if (response.ok) {
                showToast(t("queue.cleared"), "success");
                setSelectedItems(new Set());
                fetchQueue();
            } else {
                showToast(t("queue.clearFailed"), "error");
            }
        } catch (error) {
            showToast(t("queue.errorClearing"), "error");
        }
    };

    const handleDeleteItem = async (id) => {
        try {
            const response = await fetch(`/api/queue/${id}`, { method: "DELETE" });
            if (response.ok) {
                showToast(t("queue.itemRemoved"), "success");
                setItems(prev => prev.filter(item => item.id !== id));
                setSelectedItems(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            } else {
                showToast(t("queue.removeFailed"), "error");
            }
        } catch (error) {
            showToast(t("queue.errorRemoving"), "error");
        }
    }

    const confirmDeleteSelected = () => {
        if (selectedItems.size === 0) return;
        setConfirmConfig({
            title: "Delete Selected",
            message: `Are you sure you want to delete ${selectedItems.size} items?`,
            action: performDeleteSelected
        });
        setConfirmOpen(true);
    };

    const performDeleteSelected = async () => {
        try {
            const response = await fetch("/api/queue/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item_ids: Array.from(selectedItems) })
            });

            if (response.ok) {
                showToast(`Deleted ${selectedItems.size} items`, "success");
                setSelectedItems(new Set());
                fetchQueue();
            } else {
                showToast("Failed to delete items", "error");
            }
        } catch (error) {
            showToast("Error deleting items", "error");
        }
    };

    // --- Pagination Logic ---
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const paginatedItems = items.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    // --- Selection Logic ---
    const toggleSelect = (id) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedItems.size === items.length && items.length > 0) {
            setSelectedItems(new Set()); // Deselect all
        } else {
            // Select ALL items (across all pages)
            setSelectedItems(new Set(items.map(i => i.id)));
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case "completed": return <CheckCircle2 className="w-5 h-5 text-green-500" />;
            case "processing": return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
            case "failed": return <AlertCircle className="w-5 h-5 text-red-500" />;
            default: return <Clock className="w-5 h-5 text-theme-muted" />;
        }
    };

    return (
        <div className="workspace-page space-y-6">
            {/* Confirm Dialog */}
            <ConfirmDialog
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                confirmText={t("confirmDialog.confirm")} // Or specific text if needed
                type="danger"
            />

            <div className="flex flex-col gap-6 mb-8">
                {/* Header Section */}
                <WorkspaceHeader icon={List} title={t("queue.title")} />

                {/* Integrated How-To Section - Prominent & Above Buttons */}
                <details className="workspace-help">
                    <summary className="flex items-center gap-2 text-sm text-theme-muted cursor-pointer">
                        <AlertCircle className="w-5 h-5" />
                        {t("queue.howTo.title")}
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-theme-primary/40">1</span>
                            <span className="text-sm font-medium opacity-90">{t("queue.howTo.step1")}</span>
                        </div>
                        <div className="hidden md:block w-px h-8 bg-theme-primary/10"></div>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-theme-primary/40">2</span>
                            <span className="text-sm font-medium opacity-90">{t("queue.howTo.step2")}</span>
                        </div>
                        <div className="hidden md:block w-px h-8 bg-theme-primary/10"></div>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-theme-primary/40">3</span>
                            <span className="text-sm font-medium opacity-90">{t("queue.howTo.step3")}</span>
                        </div>
                        <div className="hidden md:block w-px h-8 bg-theme-primary/10"></div>
                        <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-theme-primary/40">4</span>
                            <span className="text-sm font-medium opacity-90">{t("queue.howTo.step4")}</span>
                        </div>
                    </div>
                </details>

                {/* Actions Toolbar */}
                <div className="workspace-toolbar justify-end">
                    <button
                        onClick={fetchQueue}
                        className="p-2 rounded-lg bg-theme-card border border-theme hover:bg-theme-hover transition-colors"
                        title={t("queue.refresh")}
                    >
                        <RefreshCw className="w-5 h-5 text-theme-muted" />
                    </button>

                    {selectedItems.size > 0 ? (
                        <button
                            onClick={confirmDeleteSelected}
                            className="flex items-center px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors font-medium"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete ({selectedItems.size})
                        </button>
                    ) : (
                        <button
                            onClick={confirmClearQueue}
                            disabled={items.length === 0}
                            className="flex items-center px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t("queue.clearQueue")}
                        </button>
                    )}

                    <button
                        onClick={handleRunQueue}
                        disabled={
                            processing ||
                            isPosterizarrRunning ||
                            items.length === 0 ||
                            (selectedItems.size === 0 && items.every(i => i.status === 'completed')) ||
                            (selectedItems.size > 0 && Array.from(selectedItems).some(id => items.find(i => i.id === id)?.status === 'completed'))
                        }
                        className="flex items-center px-6 py-2 rounded-lg bg-theme-primary text-white hover:bg-theme-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-theme-primary/20 transition-all hover:scale-105 active:scale-95 font-medium"
                        title={selectedItems.size > 0 && Array.from(selectedItems).some(id => items.find(i => i.id === id)?.status === 'completed') ? "Cannot run completed items" : ""}
                    >
                        {processing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                        {processing
                            ? t("queue.running")
                            : (selectedItems.size > 0 ? `Run Selected (${selectedItems.size})` : t("queue.runQueue"))
                        }
                    </button>
                </div>
            </div>

            <div className="bg-theme-card rounded-2xl border border-theme shadow-xl overflow-hidden flex flex-col min-h-[500px]">
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-theme-muted">
                        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 opacity-50" />
                        <p>{t("queue.loading")}</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-16 text-center text-theme-muted">
                        <div className="w-16 h-16 bg-theme-hover rounded-full flex items-center justify-center mx-auto mb-4 opacity-50">
                            <List className="w-8 h-8" />
                        </div>
                        <p className="text-lg font-medium">{t("queue.emptyTitle")}</p>
                        <p className="text-sm mt-2 opacity-70 max-w-md mx-auto">
                            {t("queue.emptyDescription")}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto flex-1">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-theme-hover/30 border-b border-theme/50">
                                        <th className="px-4 py-4 w-[50px]">
                                            <button onClick={toggleSelectAll} className="flex items-center justify-center text-theme-muted hover:text-theme-primary">
                                                {selectedItems.size === items.length && items.length > 0 ? <CheckSquare className="w-5 h-5 text-theme-primary" /> : <Square className="w-5 h-5" />}
                                            </button>
                                        </th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm w-[120px]">{t("queue.status")}</th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm w-[100px]">{t("queue.type")}</th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm w-[140px]">{t("queue.assetType")}</th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm">{t("queue.assetPath")}</th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm">{t("queue.details")}</th>
                                        <th className="px-4 py-4 font-semibold text-theme-muted text-sm text-right w-[80px]">{t("queue.actions")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme/30">
                                    {paginatedItems.map((item) => {
                                        const assetType = item.overlay_params?.asset_type?.toLowerCase() ||
                                            (item.overlay_params?.season_number ? "season" :
                                                (item.overlay_params?.episode_number ? "titlecard" : "poster"));

                                        const getAssetTypeStyles = (type) => {
                                            switch (type) {
                                                case 'titlecard': return "bg-purple-500/10 text-purple-400 border-purple-500/20";
                                                case 'season': return "bg-green-500/10 text-green-400 border-green-500/20";
                                                case 'background': return "bg-orange-500/10 text-orange-400 border-orange-500/20";
                                                default: return "bg-blue-500/10 text-blue-400 border-blue-500/20";
                                            }
                                        };

                                        const isSelected = selectedItems.has(item.id);

                                        return (
                                            <tr
                                                key={item.id}
                                                className={`group transition-colors ${isSelected ? 'bg-theme-primary/5' : 'hover:bg-theme-hover/20'}`}
                                                onClick={() => toggleSelect(item.id)}
                                            >
                                                <td className="px-4 py-4">
                                                    <button onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }} className="flex items-center justify-center text-theme-muted hover:text-theme-primary">
                                                        {isSelected ? <CheckSquare className="w-5 h-5 text-theme-primary" /> : <Square className="w-5 h-5 opacity-50" />}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2">
                                                        {getStatusIcon(item.status)}
                                                        <span className="capitalize text-sm font-medium opacity-80">{item.status}</span>
                                                    </div>
                                                    {item.error_message && (
                                                        <p className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={item.error_message}>
                                                            {item.error_message}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        {item.source_type === 'url' ? (
                                                            <a
                                                                href={item.source_data}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-2 hover:text-theme-primary hover:underline transition-colors group/link"
                                                                title={item.source_data}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <LinkIcon className="w-4 h-4 text-theme-muted opacity-70 group-hover/link:text-theme-primary" />
                                                                <span className="capitalize text-theme-muted opacity-70 group-hover/link:text-theme-primary">{item.source_type}</span>
                                                            </a>
                                                        ) : (
                                                            <>
                                                                <FileImage className="w-4 h-4 text-theme-muted opacity-70" />
                                                                <span className="capitalize text-theme-muted opacity-70">{item.source_type}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium capitalize flex w-fit items-center gap-1.5 ${getAssetTypeStyles(assetType)}`}>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60"></span>
                                                        {assetType === 'titlecard' ? 'Title Card' : assetType}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="font-mono text-xs bg-black/20 px-2 py-1 rounded text-theme-text opacity-90 block max-w-[300px] truncate" title={item.asset_path}>
                                                        {item.asset_path}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-sm text-theme-muted">
                                                    <div className="flex flex-col gap-1">
                                                        {/* Primary Text: Show Episode Title (for Title Cards) or provided Title Text */}
                                                        <span className="text-theme-text opacity-90 font-medium">
                                                            {item.overlay_params?.episode_title || item.overlay_params?.title_text || (
                                                                item.overlay_params?.season_number ? `${t("queue.seasonLabel")} ${item.overlay_params.season_number}` : "-"
                                                            )}
                                                        </span>

                                                        {/* Secondary Info: Show Name, S/E numbers */}
                                                        {(item.overlay_params?.folder_name || item.overlay_params?.season_number) && (
                                                            <div className="flex flex-col gap-0.5 text-xs opacity-80">
                                                                {/* Show/Movie Name from Folder Name */}
                                                                {item.overlay_params?.folder_name && (
                                                                    <span className="truncate max-w-[200px]" title={item.overlay_params.folder_name}>
                                                                        {item.overlay_params.folder_name.split(' {')[0]} {/* Clean up TMDB ID if present for display */}
                                                                    </span>
                                                                )}

                                                                {/* Season/Episode Numbers */}
                                                                {item.overlay_params?.season_number && (
                                                                    <span className="opacity-70">
                                                                        {(() => {
                                                                            const seasonStr = String(item.overlay_params.season_number);
                                                                            const seasonDigits = seasonStr.match(/\d+/);
                                                                            const sNum = seasonDigits ? seasonDigits[0] : seasonStr;

                                                                            return (
                                                                                <>
                                                                                    S{sNum.padStart(2, '0')}
                                                                                    {item.overlay_params?.episode_number && `E${String(item.overlay_params.episode_number).padStart(2, '0')}`}
                                                                                </>
                                                                            );
                                                                        })()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="flex gap-2 text-xs opacity-70 mt-1">
                                                            {item.overlay_params?.process_with_overlays && (
                                                                <span className="bg-theme-primary/10 text-theme-primary px-1.5 py-0.5 rounded border border-theme-primary/10">
                                                                    {t("queue.overlays")}
                                                                </span>
                                                            )}
                                                            <span>{item.created_at ? new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleString() : ''}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                                                        className="p-2 text-theme-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                        title={t("queue.removeFromQueue")}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-6 py-4 border-t border-theme/30 bg-theme-contrast/30">
                                <div className="text-sm text-theme-muted">
                                    Showing <span className="font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, items.length)}</span> of <span className="font-medium">{items.length}</span> items
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="p-2 rounded-lg hover:bg-theme-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </button>
                                    <span className="text-sm font-medium px-4">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages}
                                        className="p-2 rounded-lg hover:bg-theme-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default QueueView;
