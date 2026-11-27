import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  Play,
  Search,
  Settings,
  Sliders,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import {
  buildConfigSearchItems,
  buildStaticSearchItems,
  scoreLocalItem,
} from "../utils/globalSearchIndex";

const RECENT_STORAGE_KEY = "posterizarr_global_search_recent";
const CONFIG_CACHE_TTL_MS = 60_000;
const MAX_RECENT_ITEMS = 6;

const CATEGORY_ORDER = [
  "all",
  "pages",
  "settings",
  "assets",
  "overlays",
  "blueprints",
  "logs",
  "actions",
];

const ICON_MAP = {
  activity: Activity,
  clock: Clock,
  fileText: FileText,
  folder: Folder,
  globe: Globe,
  image: ImageIcon,
  layers: Layers,
  palette: Palette,
  play: Play,
  settings: Settings,
  sliders: Sliders,
  sparkles: Sparkles,
  zap: Zap,
};

function renderItemIcon(item) {
  if (item.category === "assets" && item.url) {
    return (
      <img
        src={item.url}
        alt={item.title}
        loading="lazy"
        className="w-8 h-10 rounded-md object-cover bg-black/40 border border-theme shrink-0"
      />
    );
  }
  const Icon = ICON_MAP[item.iconKey] || Globe;
  return (
    <div className="w-8 h-8 rounded-lg bg-theme-primary/10 border border-theme-primary/20 text-theme-primary flex items-center justify-center shrink-0">
      {item.colorDot ? (
        <span
          className="w-3.5 h-3.5 rounded-full border border-white/30"
          style={{ backgroundColor: item.colorDot }}
        />
      ) : (
        <Icon className="w-4 h-4" />
      )}
    </div>
  );
}

function loadRecentItems() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveRecentItem(item) {
  try {
    const serializable = {
      id: item.id,
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      route: item.route || null,
      navState: item.navState || null,
      iconKey: item.iconKey || "globe",
      colorDot: item.colorDot || null,
    };
    const existing = loadRecentItems().filter((entry) => entry.id !== serializable.id);
    const updated = [serializable, ...existing].slice(0, MAX_RECENT_ITEMS);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export default function GlobalSearchModal() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { themes, setTheme } = useTheme();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [configItems, setConfigItems] = useState([]);
  const [remoteResults, setRemoteResults] = useState({
    assets: [],
    overlays: [],
    blueprints: [],
    logs: [],
  });
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [recentItems, setRecentItems] = useState(() => loadRecentItems());

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const configFetchedAtRef = useRef(0);
  const configLanguageRef = useRef("");

  const staticItems = useMemo(
    () => buildStaticSearchItems({ t, themes, setTheme }),
    [t, themes, setTheme]
  );

  const staticById = useMemo(
    () => new Map(staticItems.map((item) => [item.id, item])),
    [staticItems]
  );

  // Global keyboard shortcut (Ctrl+K / Cmd+K or "/") and custom open event
  useEffect(() => {
    const handleOpenEvent = () => setIsOpen(true);
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }
      if (
        !isOpen &&
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (
          activeTag === "input" ||
          activeTag === "textarea" ||
          activeTag === "select" ||
          document.activeElement?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener("openGlobalSearch", handleOpenEvent);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("openGlobalSearch", handleOpenEvent);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Focus input, lock scroll, and lazy-load / refresh config setting index when opened
  useEffect(() => {
    if (!isOpen) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setRecentItems(loadRecentItems());

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);

    const now = Date.now();
    const needsConfigLoad =
      now - configFetchedAtRef.current > CONFIG_CACHE_TTL_MS ||
      configLanguageRef.current !== i18n.language;

    if (needsConfigLoad) {
      let cancelled = false;
      fetch("/api/config")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data?.success) return;
          configFetchedAtRef.current = Date.now();
          configLanguageRef.current = i18n.language;
          setConfigItems(buildConfigSearchItems(data, t));
        })
        .catch(() => {
          // Non-fatal: pages, actions, and remote backend search remain usable
        });
      return () => {
        cancelled = true;
        clearTimeout(timer);
        document.body.style.overflow = prevOverflow;
      };
    }

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, i18n.language, t]);

  // Debounced live backend search across cached assets, overlays, logs, and blueprints
  useEffect(() => {
    if (!isOpen) return undefined;
    const clean = query.trim();
    if (clean.length < 2) {
      setRemoteResults({ assets: [], overlays: [], blueprints: [], logs: [] });
      setIsSearchingRemote(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearchingRemote(true);
    const debounceId = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: clean, limit: "8" });
        const response = await fetch(`/api/global-search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search request failed");
        const data = await response.json();
        if (!controller.signal.aborted && data?.success) {
          setRemoteResults({
            assets: (data.assets || []).map((asset) => ({
              ...asset,
              category: "assets",
              iconKey: "image",
              navState: {
                globalSearchTerm: asset.search_term,
                globalSearchFolder: asset.folder,
              },
            })),
            overlays: (data.overlays || []).map((ov) => ({
              ...ov,
              category: "overlays",
              iconKey: "sparkles",
              navState: ov.library ? { selectedLibrary: ov.library } : null,
            })),
            blueprints: (data.blueprints || []).map((bp) => ({
              ...bp,
              category: "blueprints",
              iconKey: "layers",
              navState: { tab: bp.tab || "presets" },
            })),
            logs: (data.logs || []).map((logItem) => ({
              ...logItem,
              category: "logs",
              iconKey: "fileText",
              navState: { logFile: logItem.name },
            })),
          });
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setRemoteResults({ assets: [], overlays: [], blueprints: [], logs: [] });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingRemote(false);
        }
      }
    }, 160);

    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
  }, [isOpen, query]);

  const localResultsByCategory = useMemo(() => {
    const clean = query.trim();
    if (!clean) {
      return { pages: [], settings: [], actions: [] };
    }
    const tokens = clean.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const rank = (list, cap) =>
      list
        .map((item) => ({ item, score: scoreLocalItem(item, tokens, clean) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, cap)
        .map((entry) => entry.item);

    return {
      pages: rank(
        staticItems.filter((item) => item.category === "pages"),
        8
      ),
      settings: rank(
        [...configItems, ...staticItems.filter((item) => item.category === "settings")],
        12
      ),
      actions: rank(
        staticItems.filter((item) => item.category === "actions"),
        6
      ),
    };
  }, [query, staticItems, configItems]);

  const groupedResults = useMemo(
    () => ({
      pages: localResultsByCategory.pages,
      settings: localResultsByCategory.settings,
      assets: remoteResults.assets,
      overlays: remoteResults.overlays,
      blueprints: remoteResults.blueprints,
      logs: remoteResults.logs,
      actions: localResultsByCategory.actions,
    }),
    [localResultsByCategory, remoteResults]
  );

  const defaultQuickJumps = useMemo(() => {
    const pickIds = [
      "page:dashboard",
      "page:config-system",
      "page:dynamic-overlays",
      "page:blueprints-community",
      "page:gallery-posters",
      "page:logs",
    ];
    return pickIds.map((id) => staticById.get(id)).filter(Boolean);
  }, [staticById]);

  const visibleItems = useMemo(() => {
    const clean = query.trim();
    if (!clean) {
      const seen = new Set();
      const merged = [];
      for (const item of [...recentItems, ...defaultQuickJumps]) {
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
      return merged;
    }

    const categories =
      activeCategory === "all"
        ? CATEGORY_ORDER.filter((cat) => cat !== "all")
        : [activeCategory];
    return categories.flatMap((cat) => groupedResults[cat] || []);
  }, [query, activeCategory, groupedResults, recentItems, defaultQuickJumps]);

  const totalMatches = useMemo(() => {
    return CATEGORY_ORDER.filter((c) => c !== "all").reduce(
      (sum, cat) => sum + (groupedResults[cat]?.length || 0),
      0
    );
  }, [groupedResults]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, activeCategory, isOpen]);

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-search-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setActiveCategory("all");
  }, []);

  const executeItem = useCallback(
    (item) => {
      if (!item) return;
      setRecentItems(saveRecentItem(item));
      closeModal();

      const liveStatic = staticById.get(item.id);
      if (typeof item.action === "function") {
        item.action();
        return;
      }
      if (liveStatic && typeof liveStatic.action === "function") {
        liveStatic.action();
        return;
      }
      if (item.route) {
        navigate(item.route, {
          state: item.navState
            ? { ...item.navState, ts: Date.now() }
            : { ts: Date.now() },
        });
      }
    },
    [closeModal, navigate, staticById]
  );

  const handleInputKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visibleItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % visibleItems.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + visibleItems.length) % visibleItems.length);
      }
      return;
    }
    if (event.key === "Enter" && visibleItems.length > 0) {
      event.preventDefault();
      executeItem(visibleItems[Math.min(selectedIndex, visibleItems.length - 1)]);
    }
  };

  if (!isOpen) return null;

  const categoryLabel = (cat) => {
    const defaults = {
      all: "All",
      pages: "Pages",
      settings: "Settings",
      assets: "Assets",
      overlays: "Overlays",
      blueprints: "Blueprints",
      logs: "Logs",
      actions: "Actions",
    };
    return t(`globalSearch.categories.${cat}`, defaults[cat] || cat);
  };

  const hasQuery = query.trim().length > 0;
  let globalIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9990] bg-black/65 backdrop-blur-sm flex items-start justify-center p-3 sm:p-6 pt-[8vh] sm:pt-[11vh]"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-label={t("globalSearch.inputPlaceholder", "Search pages, settings, assets, overlays, logs...")}
    >
      <div
        className="w-full max-w-2xl bg-theme-card border border-theme rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[78vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-theme bg-theme-bg/40">
          {isSearchingRemote ? (
            <Loader2 className="w-5 h-5 text-theme-primary animate-spin shrink-0" />
          ) : (
            <Search className="w-5 h-5 text-theme-primary shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t(
              "globalSearch.inputPlaceholder",
              "Search pages, settings, assets, overlays, logs..."
            )}
            className="flex-1 bg-transparent text-sm sm:text-base text-theme-text placeholder-theme-muted focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("globalSearch.clear", "Clear search")}
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-hover transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={closeModal}
            className="px-2 py-1 rounded-md border border-theme bg-theme-bg text-[11px] font-mono text-theme-muted hover:text-theme-text transition-colors"
          >
            Esc
          </button>
        </div>

        {/* Category Filter Tabs when searching */}
        {hasQuery && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-theme/70 overflow-x-auto bg-theme-bg/20">
            {CATEGORY_ORDER.map((cat) => {
              const count = cat === "all" ? totalMatches : groupedResults[cat]?.length || 0;
              if (cat !== "all" && count === 0 && activeCategory !== cat) {
                return null;
              }
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap border transition-colors ${
                    active
                      ? "bg-theme-primary text-white border-theme-primary"
                      : "bg-theme-bg/60 text-theme-muted border-theme hover:text-theme-text"
                  }`}
                >
                  <span>{categoryLabel(cat)}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      active ? "bg-white/20 text-white" : "bg-theme-hover text-theme-muted"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Results Body */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-3"
        >
          {!hasQuery ? (
            <>
              {recentItems.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
                    {t("globalSearch.recent", "Recent")}
                  </div>
                  <div className="space-y-0.5">
                    {recentItems.map((item) => {
                      const idx = globalIdx++;
                      const isActive = idx === selectedIndex;
                      return (
                        <button
                          key={`recent-${item.id}`}
                          type="button"
                          data-search-index={idx}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => executeItem(item)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                            isActive
                              ? "bg-theme-primary/15 border border-theme-primary/40"
                              : "border border-transparent hover:bg-theme-hover/60"
                          }`}
                        >
                          {renderItemIcon(item)}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-theme-text truncate">
                              {item.title}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-theme-muted truncate">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-theme-muted shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
                  {t("globalSearch.quickJump", "Quick Jump")}
                </div>
                <div className="space-y-0.5">
                  {defaultQuickJumps
                    .filter((item) => !recentItems.some((r) => r.id === item.id))
                    .map((item) => {
                      const idx = globalIdx++;
                      const isActive = idx === selectedIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-search-index={idx}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => executeItem(item)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                            isActive
                              ? "bg-theme-primary/15 border border-theme-primary/40"
                              : "border border-transparent hover:bg-theme-hover/60"
                          }`}
                        >
                          {renderItemIcon(item)}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-theme-text truncate">
                              {item.title}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-theme-muted truncate">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-theme-muted shrink-0" />
                        </button>
                      );
                    })}
                </div>
              </div>
            </>
          ) : visibleItems.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-2">
              <Search className="w-9 h-9 mx-auto text-theme-muted opacity-40" />
              <p className="text-sm font-medium text-theme-text">
                {isSearchingRemote
                  ? t("globalSearch.searching", "Searching across Posterizarr...")
                  : t("globalSearch.noResults", {
                      query: query.trim(),
                      defaultValue: 'No matches for "{{query}}"',
                    })}
              </p>
              {!isSearchingRemote && (
                <p className="text-xs text-theme-muted">
                  {t(
                    "globalSearch.noResultsHint",
                    "Try a page name, setting key, movie/show title, overlay rule, or log filename."
                  )}
                </p>
              )}
            </div>
          ) : (
            (activeCategory === "all"
              ? CATEGORY_ORDER.filter((cat) => cat !== "all")
              : [activeCategory]
            ).map((cat) => {
              const catItems = groupedResults[cat] || [];
              if (catItems.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-theme-muted flex items-center justify-between">
                    <span>{categoryLabel(cat)}</span>
                    <span className="font-mono">{catItems.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {catItems.map((item) => {
                      const idx = globalIdx++;
                      const isActive = idx === selectedIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-search-index={idx}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => executeItem(item)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                            isActive
                              ? "bg-theme-primary/15 border border-theme-primary/40"
                              : "border border-transparent hover:bg-theme-hover/60"
                          }`}
                        >
                          {renderItemIcon(item)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-theme-text truncate">
                                {item.title}
                              </span>
                              {item.settingKey && (
                                <span className="hidden sm:inline px-1.5 py-0.5 rounded bg-theme-bg border border-theme text-[10px] font-mono text-theme-muted shrink-0">
                                  {item.settingKey}
                                </span>
                              )}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-theme-muted truncate">
                                {item.subtitle}
                              </div>
                            )}
                            {item.description && (
                              <div className="text-[11px] text-theme-muted/80 truncate mt-0.5">
                                {item.description}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-theme-muted shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-4 py-2 border-t border-theme bg-theme-bg/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-theme-muted">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-theme-card border border-theme font-mono text-[10px]">
                ↑↓
              </kbd>{" "}
              {t("globalSearch.hints.navigate", "Navigate")}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-theme-card border border-theme font-mono text-[10px]">
                ↵
              </kbd>{" "}
              {t("globalSearch.hints.open", "Open")}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-theme-card border border-theme font-mono text-[10px]">
                Esc
              </kbd>{" "}
              {t("globalSearch.hints.close", "Close")}
            </span>
          </div>
          {hasQuery && totalMatches > 0 && (
            <span className="font-mono text-[10px]">{totalMatches}</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
