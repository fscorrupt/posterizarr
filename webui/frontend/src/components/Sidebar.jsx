import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity, Play, Image, Settings, Clock, FileText, Info, Menu, X,
  ChevronDown, ChevronRight, Film, Layers, Tv, Database, Server,
  Palette, Bell, Lock, User, FileImage, Lightbulb, AlertTriangle,
  TrendingUp, Zap, FolderKanban, GripVertical, TestTube, Archive, List,BookOpen, Heart, Globe
} from "lucide-react";
import VersionBadge from "./VersionBadge";
import { useSidebar } from "../context/SidebarContext";
import { useTheme } from "../context/ThemeContext";

const DiscordIcon = ({ className }) => (
  <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
);

const GithubIcon = ({ className }) => (
  <svg role="img" viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
);

const externalLinks = [
  { name: 'Discord', href: 'https://discord.gg/fYyJQSGt54', icon: DiscordIcon },
  { name: 'Docs', href: 'https://fscorrupt.github.io/posterizarr', icon: BookOpen },
  { name: 'GitHub', href: 'https://github.com/fscorrupt/posterizarr', icon: GithubIcon },
  { name: 'Sponsor', href: 'https://ko-fi.com/R6R81S6SC', icon: Heart },
];

const Sidebar = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const { theme, setTheme, themes } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAssetsExpanded, setIsAssetsExpanded] = useState(false);
  const [isMediaServerExpanded, setIsMediaServerExpanded] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [missingAssetsCount, setMissingAssetsCount] = useState(0);
  const [manualAssetsCount, setManualAssetsCount] = useState(0);
  const [draggedItem, setDraggedItem] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem("gallery-view-mode") || "grid";
  });

  // Counts Fetching Logic
  React.useEffect(() => {
    const fetchMissingAssetsCount = async () => {
      try {
        const response = await fetch("/api/assets/overview");
        if (response.ok) {
          const data = await response.json();
          setMissingAssetsCount(data.categories.assets_with_issues.count);
        }
      } catch (error) { console.error("Failed to fetch missing assets count:", error); }
    };
    fetchMissingAssetsCount();
    const handleAssetReplaced = () => fetchMissingAssetsCount();
    window.addEventListener("assetReplaced", handleAssetReplaced);
    const interval = setInterval(fetchMissingAssetsCount, 60000);
    return () => { clearInterval(interval); window.removeEventListener("assetReplaced", handleAssetReplaced); };
  }, []);

  React.useEffect(() => {
    const fetchManualAssetsCount = async () => {
      try {
        const response = await fetch("/api/manual-assets-gallery");
        if (response.ok) {
          const data = await response.json();
          setManualAssetsCount(data.total_assets || 0);
        }
      } catch (error) { console.error("Failed to fetch manual assets count:", error); }
    };
    fetchManualAssetsCount();
    const handleAssetReplaced = () => fetchManualAssetsCount();
    window.addEventListener("assetReplaced", handleAssetReplaced);
    const interval = setInterval(fetchManualAssetsCount, 600000);
    return () => { clearInterval(interval); window.removeEventListener("assetReplaced", handleAssetReplaced); };
  }, []);

  React.useEffect(() => {
    const handleStorageChange = () => { setViewMode(localStorage.getItem("gallery-view-mode") || "grid"); };
    window.addEventListener("viewModeChanged", handleStorageChange);
    const interval = setInterval(handleStorageChange, 500);
    return () => { window.removeEventListener("viewModeChanged", handleStorageChange); clearInterval(interval); };
  }, []);

  const themeArray = Object.entries(themes).map(([id, config]) => ({
    id, name: config.name, color: config.variables["--theme-primary"],
  }));

  const defaultNavItems = [
    { id: "dashboard", path: "/", label: t("nav.dashboard"), icon: Activity },
    { id: "runModes", path: "/run-modes", label: t("nav.runModes"), icon: Play },
    { id: "queue", path: "/queue", label: "Queue", icon: List },
    { id: "scheduler", path: "/scheduler", label: t("nav.scheduler"), icon: Clock },
    {
      id: "mediaServerExport",
      path: "/media-server-export",
      label: t("nav.mediaServerExport", "Media Server Export"),
      icon: Server,
      hasSubItems: true,
      subItems: [
        { path: "/media-server-export/plex", label: t("mediaServerExport.plex", "Plex"), icon: Database },
        { path: "/media-server-export/jellyfin-emby", label: t("mediaServerExport.jellyfinEmby", "Jellyfin / Emby"), icon: Server },
      ],
    },
    {
      id: "gallery",
      path: "/gallery",
      label: t("nav.assets"),
      icon: Image,
      hasSubItems: true,
      subItems: viewMode === "folder"
        ? [
          { path: "/gallery/posters", label: t("assets.assetsFolders"), icon: FolderKanban },
          { path: "/manual-assets", label: "Manual Assets", icon: FileImage, badge: manualAssetsCount, badgeColor: "green" },
          { path: "/media-server-logos", label: t("mediaServerExport.logos", "Logo Browser"), icon: Image },
          { path: "/asset-backups", label: t("backupAssets.title") || "Backups", icon: Archive },
          { path: "/asset-overview", label: t("nav.assetOverview"), icon: AlertTriangle, badge: missingAssetsCount, badgeColor: "red" },
          { path: "/assets-manager", label: t("nav.assetsManager", "Assets Manager"), icon: Layers },
          { path: "/test-gallery", label: t("nav.testGallery", "Test Gallery"), icon: TestTube },
        ]
        : [
          { path: "/gallery/posters", label: t("assets.posters"), icon: Image },
          { path: "/gallery/backgrounds", label: t("assets.backgrounds"), icon: Layers },
          { path: "/gallery/seasons", label: t("assets.seasons"), icon: Film },
          { path: "/gallery/titlecards", label: t("assets.titleCards"), icon: Tv },
          { path: "/manual-assets", label: "Manual Assets", icon: FileImage, badge: manualAssetsCount, badgeColor: "green" },
          { path: "/media-server-logos", label: t("mediaServerExport.logos", "Logo Browser"), icon: Image },
          { path: "/asset-backups", label: t("backupAssets.title") || "Backups", icon: Archive },
          { path: "/asset-overview", label: t("nav.assetOverview"), icon: AlertTriangle, badge: missingAssetsCount, badgeColor: "red" },
          { path: "/assets-manager", label: t("nav.assetsManager", "Assets Manager"), icon: Layers },
          { path: "/test-gallery", label: t("nav.testGallery", "Test Gallery"), icon: TestTube },
        ],
    },
    { id: "autoTriggers", path: "/auto-triggers", label: t("nav.autoTriggers"), icon: Zap },

    {
      id: "config",
      path: "/config/system",
      label: t("nav.config"),
      icon: Settings,
      hasSubItems: true,
      subItems: [
        { path: "/config/system", label: "Settings", icon: Settings },
        { path: "/blueprints", label: "Blueprints", icon: Layers }
      ]
    },

    { id: "runtimeHistory", path: "/runtime-history", label: t("nav.runtimeHistory"), icon: TrendingUp },
    { id: "logs", path: "/logs", label: t("nav.logs"), icon: FileText },
    { id: "howItWorks", path: "/how-it-works", label: t("nav.howItWorks"), icon: Lightbulb },
    { id: "about", path: "/about", label: t("nav.about"), icon: Info },
  ];

  const [navOrder, setNavOrder] = React.useState(() => {
    const saved = localStorage.getItem("sidebar_nav_order");
    if (saved) {
      try {
        const savedOrder = JSON.parse(saved);
        const defaultIds = defaultNavItems.map((item) => item.id);
        const missingIds = defaultIds.filter((id) => !savedOrder.includes(id));
        const validSavedOrder = savedOrder.filter(id => defaultIds.includes(id));
        return [...validSavedOrder, ...missingIds];
      } catch (e) { return defaultNavItems.map((item) => item.id); }
    }
    return defaultNavItems.map((item) => item.id);
  });

  const navItems = React.useMemo(() => navOrder.map((id) => defaultNavItems.find((item) => item.id === id)).filter(Boolean), [navOrder, viewMode, missingAssetsCount, manualAssetsCount]);

  const saveNavOrder = (order) => { setNavOrder(order); localStorage.setItem("sidebar_nav_order", JSON.stringify(order)); };
  const handleDragStart = (e, index) => { setDraggedItem(index); e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver = (e, index) => { e.preventDefault(); if (draggedItem === null || draggedItem === index) return; const newOrder = [...navOrder]; const draggedId = newOrder[draggedItem]; newOrder.splice(draggedItem, 1); newOrder.splice(index, 0, draggedId); setDraggedItem(index); setNavOrder(newOrder); };
  const handleDragEnd = () => { if (draggedItem !== null) saveNavOrder(navOrder); setDraggedItem(null); };

  const isInAssetsSection = location.pathname.startsWith("/gallery") || location.pathname.startsWith("/manual-assets") || location.pathname.startsWith("/media-server-logos") || location.pathname.startsWith("/asset-backups") || location.pathname.startsWith("/asset-overview") || location.pathname.startsWith("/assets-manager") || location.pathname.startsWith("/test-gallery");
  const isInMediaServerSection = location.pathname.startsWith("/media-server-export");
  const isInConfigSection = location.pathname.startsWith("/config") || location.pathname.startsWith("/blueprints");

  return (
    <>
      {/* REMOVED border-r, added shadow-2xl for cleaner separation */}
      <div className={`hidden md:flex flex-col fixed left-0 top-0 h-screen bg-theme-card shadow-2xl transition-all duration-300 z-50 ${isCollapsed ? "w-20" : "w-80"}`}>

        {/* Header Logo Area - REMOVED border-b */}
        <div className="flex items-center p-5 h-20">
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="p-2 rounded-xl hover:bg-theme-hover transition-colors text-theme-muted hover:text-theme-text">
            <Menu className="w-5 h-5" />
          </button>
          {!isCollapsed && (
            <div className="ml-4 flex items-center animate-in fade-in duration-300">
              <img src="/logo.png" alt="Posterizarr Logo" className="h-10 w-auto object-contain drop-shadow-md" />
              {/* Text span removed entirely */}
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 scrollbar-thin scrollbar-thumb-theme-border scrollbar-track-transparent">
          <div className="space-y-1.5">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const isActive = item.id === "config" ? isInConfigSection : location.pathname === item.path;
              const isDragging = draggedItem === index;

              // Removed purple gradient, now strictly uses theme-primary
              const activeClass = "bg-theme-primary text-white shadow-lg shadow-theme-primary/20";
              const inactiveClass = "text-theme-muted hover:bg-theme-hover hover:text-theme-text";

              if (item.hasSubItems) {
                let isExpanded = false;
                let isInSection = false;
                let toggleExpanded = () => {};

                if (item.id === "gallery") {
                  isExpanded = isAssetsExpanded;
                  isInSection = isInAssetsSection;
                  toggleExpanded = () => setIsAssetsExpanded(!isAssetsExpanded);
                } else if (item.id === "mediaServerExport") {
                  isExpanded = isMediaServerExpanded;
                  isInSection = isInMediaServerSection;
                  toggleExpanded = () => setIsMediaServerExpanded(!isMediaServerExpanded);
                } else if (item.id === "config") {
                  isExpanded = isConfigExpanded;
                  isInSection = isInConfigSection;
                  toggleExpanded = () => setIsConfigExpanded(!isConfigExpanded);
                }
                const isGroupActive = isInSection;

                return (
                  <div key={item.id} draggable={!isCollapsed} onDragStart={(e) => handleDragStart(e, index)} onDragOver={(e) => handleDragOver(e, index)} onDragEnd={handleDragEnd} onMouseEnter={() => setHoveredItem(index)} onMouseLeave={() => setHoveredItem(null)} className={`relative ${isDragging ? "opacity-50" : ""}`}>
                    <button
                      onClick={toggleExpanded}
                      className={`w-full flex items-center ${isCollapsed ? "justify-center" : "justify-between px-4"} py-3 rounded-xl text-sm font-medium transition-all duration-200 group relative overflow-hidden ${isGroupActive && !isExpanded ? "bg-theme-primary/10 text-theme-primary border border-theme-primary/20" : inactiveClass}`}
                      title={isCollapsed ? item.label : ""}
                    >
                      <div className="flex items-center relative z-10">
                        <Icon className={`w-5 h-5 flex-shrink-0 ${isGroupActive ? "text-theme-primary" : ""}`} />
                        {!isCollapsed && <span className="ml-3 font-medium">{item.label}</span>}
                      </div>
                      <div className="flex items-center gap-1 relative z-10">
                        {!isCollapsed && (
                          <>
                            {hoveredItem === index && <GripVertical className="w-4 h-4 text-theme-muted opacity-60 cursor-grab active:cursor-grabbing" />}
                            {isExpanded ? <ChevronDown className="w-4 h-4 opacity-70" /> : <ChevronRight className="w-4 h-4 opacity-70" />}
                          </>
                        )}
                      </div>
                    </button>

                    {isExpanded && !isCollapsed && (
                      <div className="ml-5 mt-1 space-y-1 pl-4 border-l-2 border-theme/50 animate-in slide-in-from-top-1 duration-200">
                        {item.subItems.map((subItem) => {
                          const SubIcon = subItem.icon;
                          const isSubActive = location.pathname === subItem.path;
                          return (
                            <Link
                              key={subItem.path}
                              to={subItem.path}
                              className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isSubActive ? activeClass : "text-theme-muted hover:bg-theme-hover hover:text-theme-text"}`}
                            >
                              <div className="flex items-center">
                                <SubIcon className="w-4 h-4 flex-shrink-0" />
                                <span className="ml-3">{subItem.label}</span>
                              </div>
                              {subItem.badge !== undefined && subItem.badge > 0 && (
                                <span className={`${subItem.badgeColor === "green" ? "bg-green-500" : "bg-red-500"} text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[1.25rem] text-center shadow-sm`}>
                                  {subItem.badge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={item.id} draggable={!isCollapsed} onDragStart={(e) => handleDragStart(e, index)} onDragOver={(e) => handleDragOver(e, index)} onDragEnd={handleDragEnd} onMouseEnter={() => setHoveredItem(index)} onMouseLeave={() => setHoveredItem(null)} className={`relative ${isDragging ? "opacity-50" : ""}`}>
                  <Link
                    to={item.path}
                    className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between px-4"} py-3 rounded-xl text-sm font-medium transition-all duration-200 group relative ${isActive ? activeClass : inactiveClass}`}
                    title={isCollapsed ? item.label : ""}
                  >
                    <div className="flex items-center relative z-10">
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {!isCollapsed && <span className="ml-3 font-medium">{item.label}</span>}
                    </div>

                    <div className="flex items-center gap-2 relative z-10">
                      {!isCollapsed && hoveredItem === index && <GripVertical className="w-4 h-4 text-theme-muted opacity-60 cursor-grab active:cursor-grabbing" />}
                      {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                        <span className={`${item.badgeColor === "green" ? "bg-green-500" : "bg-red-500"} text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[1.25rem] text-center shadow-sm`}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </nav>

        {!isCollapsed && (
          <div className="mt-auto p-4 flex flex-col items-center bg-theme-hover/5">
            
            {/* External Links Section */}
            <div className="flex items-center gap-4 mb-4">
              {externalLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.name}
                  className="text-theme-muted hover:text-theme-primary transition-colors duration-200"
                >
                  <link.icon className="w-5 h-5" />
                </a>
              ))}
            </div>

            {/* Subtle Integrated Divider */}
            <div className="w-12 h-px bg-theme-border/40 mb-4" />

            {/* Minimalist Version Badge */}
            <VersionBadge />
          </div>
        )}
      </div>

      {/* Mobile Menu */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-theme-card/90 backdrop-blur-md border-b border-theme z-50 h-16 shadow-lg">
        <div className="flex items-center justify-between h-full px-4">
          <div className="flex items-center">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 rounded-xl hover:bg-theme-hover transition-colors text-theme-text">
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <span className="ml-3 text-lg font-bold text-theme-primary tracking-tight">Posterizarr</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)} className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-theme-hover transition-colors text-theme-text"><Palette className="w-5 h-5" /></button>
              {isThemeDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsThemeDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-theme-card border border-theme shadow-xl z-50 overflow-hidden">
                    <div className="p-2 space-y-1">{themeArray.map((t) => (<button key={t.id} onClick={() => { setTheme(t.id); setIsThemeDropdownOpen(false); }} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${theme === t.id ? "bg-theme-primary text-white" : "text-gray-300 hover:bg-theme-hover"}`}><span>{t.name}</span><div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} /></button>))}</div>
                  </div>
                </>
              )}
            </div>
            <button className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-theme-hover transition-colors text-theme-text"><User className="w-5 h-5" /></button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 top-16" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="md:hidden fixed left-0 top-16 bottom-0 w-72 bg-theme-card border-r border-theme z-40 flex flex-col shadow-2xl">
            <nav className="flex-1 overflow-y-auto py-6">
              <div className="space-y-1 px-4">
                {navItems.map((item, index) => {
                  const Icon = item.icon;
                  const isActive = item.id === "config" ? isInConfigSection : location.pathname === item.path;

                  if (item.hasSubItems) {
                    let isExpanded = false;
                    let toggleExpanded = () => {};

                    if (item.id === "gallery") {
                      isExpanded = isAssetsExpanded;
                      toggleExpanded = () => setIsAssetsExpanded(!isAssetsExpanded);
                    } else if (item.id === "mediaServerExport") {
                      isExpanded = isMediaServerExpanded;
                      toggleExpanded = () => setIsMediaServerExpanded(!isMediaServerExpanded);
                    } else if (item.id === "config") {
                      isExpanded = isConfigExpanded;
                      toggleExpanded = () => setIsConfigExpanded(!isConfigExpanded);
                    }
                    return (<div key={item.id}><button onClick={toggleExpanded} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-theme-muted hover:bg-theme-hover/50"><div className="flex items-center"><Icon className="w-5 h-5 mr-3" /><span>{item.label}</span></div>{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>{isExpanded && (<div className="ml-4 mt-1 space-y-1 border-l border-theme/30 pl-3">{item.subItems.map(sub => (<Link key={sub.path} to={sub.path} onClick={() => setIsMobileMenuOpen(false)} className="flex items-center px-4 py-3 rounded-xl text-sm font-medium text-theme-muted hover:bg-theme-hover"><sub.icon className="w-4 h-4 mr-3" />{sub.label}</Link>))}</div>)}</div>)
                  }
                  return (<Link key={item.id} to={item.path} onClick={() => setIsMobileMenuOpen(false)} className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium ${isActive ? "bg-theme-primary text-white shadow-lg" : "text-theme-muted hover:bg-theme-hover"}`}><Icon className="w-5 h-5 mr-3" /><span>{item.label}</span></Link>);
                })}
              </div>
            </nav>
          </div>
        </>
      )}
    </>
  );
};

export default Sidebar;