import React, { useState, useEffect, useRef } from "react";
import { Loader2, Palette, Image, Layers, CheckCircle2, AlertCircle, Type, Square, Languages, Sparkles, Download, Upload, Info, Sliders, LayoutTemplate, ChevronDown, ChevronRight, Settings, ImagePlus, RotateCcw, Wand2, MousePointerClick, Trash2, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";

const API_URL = "/api";

export const BLUEPRINTS = [
  {
    id: "clearlogo-instead-of-text",
    titleKey: "blueprints.items.clearlogo.title",
    descriptionKey: "blueprints.items.clearlogo.description",
    icon: Image,
    images: ["/blueprint-previews/clearlogo-instead-of-text_poster.png", "/blueprint-previews/clearlogo-instead-of-text_background.png"],
    updates: {
      flat: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "true", UseClearart: "false", ConvertLogoColor: "false", PosterAddText: "true", BackgroundAddText: "true" },
      nested: {
        PrerequisitePart: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "true", UseClearart: "false", ConvertLogoColor: "false" },
        PosterOverlayPart: { AddText: "true" },
        BackgroundOverlayPart: { AddText: "true" }
      }
    }
  },
  {
    id: "clearart-instead-of-text",
    titleKey: "blueprints.items.clearart.title",
    descriptionKey: "blueprints.items.clearart.description",
    icon: Image,
    images: ["/blueprint-previews/clearart-instead-of-text_poster.png", "/blueprint-previews/clearart-instead-of-text_background.png"],
    updates: {
      flat: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "false", UseClearart: "true", ConvertLogoColor: "false", PosterAddText: "true", BackgroundAddText: "true" },
      nested: {
        PrerequisitePart: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "false", UseClearart: "true", ConvertLogoColor: "false" },
        PosterOverlayPart: { AddText: "true" },
        BackgroundOverlayPart: { AddText: "true" }
      }
    }
  },
  {
    id: "flat-clearlogo-instead-of-text",
    titleKey: "blueprints.items.flatClearlogo.title",
    descriptionKey: "blueprints.items.flatClearlogo.description",
    icon: Image,
    images: ["/blueprint-previews/flat-clearlogo-instead-of-text_poster.png", "/blueprint-previews/flat-clearlogo-instead-of-text_background.png"],
    updates: {
      flat: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "true", UseClearart: "false", ConvertLogoColor: "true", LogoFlatColor: "white", PosterAddText: "true", BackgroundAddText: "true" },
      nested: {
        PrerequisitePart: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "true", UseClearart: "false", ConvertLogoColor: "true", LogoFlatColor: "white" },
        PosterOverlayPart: { AddText: "true" },
        BackgroundOverlayPart: { AddText: "true" }
      }
    }
  },
  {
    id: "flat-clearart-instead-of-text",
    titleKey: "blueprints.items.flatClearart.title",
    descriptionKey: "blueprints.items.flatClearart.description",
    icon: Image,
    images: ["/blueprint-previews/flat-clearart-instead-of-text_poster.png", "/blueprint-previews/flat-clearart-instead-of-text_background.png"],
    updates: {
      flat: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "false", UseClearart: "true", ConvertLogoColor: "true", LogoFlatColor: "white", PosterAddText: "true", BackgroundAddText: "true" },
      nested: {
        PrerequisitePart: { UseLogo: "true", UseBGLogo: "true", UseClearlogo: "false", UseClearart: "true", ConvertLogoColor: "true", LogoFlatColor: "white" },
        PosterOverlayPart: { AddText: "true" },
        BackgroundOverlayPart: { AddText: "true" }
      }
    }
  },
  {
    id: "show-title-on-season",
    titleKey: "blueprints.items.showTitleSeason.title",
    descriptionKey: "blueprints.items.showTitleSeason.description",
    icon: Type,
    images: ["/blueprint-previews/show-title-on-season.png"],
    updates: { flat: { ShowTitleAddShowTitletoSeason: "true" }, nested: { ShowTitleOnSeasonPosterPart: { AddShowTitletoSeason: "true" } } }
  },
  {
    id: "minimalist-posters",
    titleKey: "blueprints.items.minimalist.title",
    descriptionKey: "blueprints.items.minimalist.description",
    icon: Palette,
    images: ["/blueprint-previews/minimalist-posters_en.png", "/blueprint-previews/minimalist-posters_textless.png", "/blueprint-previews/minimalist-posters_textless_background.png"],
    updates: { flat: { ImageProcessing: "false" }, nested: { OverlayPart: { ImageProcessing: "false" } } }
  },
  {
    id: "full-overlays",
    titleKey: "blueprints.items.fullOverlays.title",
    descriptionKey: "blueprints.items.fullOverlays.description",
    icon: Layers,
    images: ["/blueprint-previews/full-overlays.png", "/blueprint-previews/full-overlays_background-small.png"],
    updates: {
      flat: { PosterAddBorder: "true", PosterAddText: "true", PosterAddOverlay: "true", SeasonPosterAddBorder: "true", SeasonPosterAddText: "true", SeasonPosterAddOverlay: "true", BackgroundAddBorder: "true", BackgroundAddText: "true", BackgroundAddOverlay: "true", TitleCardAddOverlay: "true", TitleCardAddBorder: "true", TitleCardTitleAddEPTitleText: "true", TitleCardEPAddEPText: "true" },
      nested: {
        PosterOverlayPart: { AddBorder: "true", AddText: "true", AddOverlay: "true" },
        SeasonPosterOverlayPart: { AddBorder: "true", AddText: "true", AddOverlay: "true" },
        BackgroundOverlayPart: { AddBorder: "true", AddText: "true", AddOverlay: "true" },
        TitleCardOverlayPart: { AddOverlay: "true", AddBorder: "true" },
        TitleCardTitleTextPart: { AddEPTitleText: "true" },
        TitleCardEPTextPart: { AddEPText: "true" }
      }
    }
  },
  {
    id: "resolution-overlays",
    titleKey: "blueprints.items.resolutionOverlays.title",
    descriptionKey: "blueprints.items.resolutionOverlays.description",
    icon: Sparkles,
    images: ["/blueprint-previews/resolution-overlays_poster4k.png", "/blueprint-previews/resolution-overlays_Background4k.png", "/blueprint-previews/resolution-overlays_4KDoVi.png", "/blueprint-previews/resolution-overlays_4KHDR10.png", "/blueprint-previews/resolution-overlays_4KDoViHDR10.png"],
    updates: { flat: { UsePosterResolutionOverlays: "true", UseBackgroundResolutionOverlays: "true", UseTCResolutionOverlays: "true" }, nested: { PrerequisitePart: { UsePosterResolutionOverlays: "true", UseBackgroundResolutionOverlays: "true", UseTCResolutionOverlays: "true" } } }
  },
  {
    id: "only-borders",
    titleKey: "blueprints.items.onlyBorders.title",
    descriptionKey: "blueprints.items.onlyBorders.description",
    icon: Square,
    images: ["/blueprint-previews/only-borders.png", "/blueprint-previews/only-borders_background.png"],
    updates: {
      flat: { PosterAddBorder: "true", PosterAddText: "false", PosterAddOverlay: "false", SeasonPosterAddBorder: "true", SeasonPosterAddText: "false", SeasonPosterAddOverlay: "false", ShowTitleAddShowTitletoSeason: "false", BackgroundAddBorder: "true", BackgroundAddText: "false", BackgroundAddOverlay: "false", TitleCardAddBorder: "true", TitleCardAddOverlay: "false", TitleCardTitleAddEPTitleText: "false", TitleCardEPAddEPText: "false" },
      nested: {
        PosterOverlayPart: { AddBorder: "true", AddText: "false", AddOverlay: "false" },
        SeasonPosterOverlayPart: { AddBorder: "true", AddText: "false", AddOverlay: "false" },
        ShowTitleOnSeasonPosterPart: { AddShowTitletoSeason: "false" },
        BackgroundOverlayPart: { AddBorder: "true", AddText: "false", AddOverlay: "false" },
        TitleCardOverlayPart: { AddBorder: "true", AddOverlay: "false" },
        TitleCardTitleTextPart: { AddEPTitleText: "false" },
        TitleCardEPTextPart: { AddEPText: "false" }
      }
    }
  },
  {
    id: "only-text",
    titleKey: "blueprints.items.onlyText.title",
    descriptionKey: "blueprints.items.onlyText.description",
    icon: Type,
    images: ["/blueprint-previews/only-text.png", "/blueprint-previews/only-text_background.png"],
    updates: {
      flat: { PosterAddBorder: "false", PosterAddText: "true", PosterAddOverlay: "false", SeasonPosterAddBorder: "false", SeasonPosterAddText: "true", SeasonPosterAddOverlay: "false", ShowTitleAddShowTitletoSeason: "true", BackgroundAddBorder: "false", BackgroundAddText: "true", BackgroundAddOverlay: "false", TitleCardAddBorder: "false", TitleCardAddOverlay: "false", TitleCardTitleAddEPTitleText: "true", TitleCardEPAddEPText: "true" },
      nested: {
        PosterOverlayPart: { AddBorder: "false", AddText: "true", AddOverlay: "false" },
        SeasonPosterOverlayPart: { AddBorder: "false", AddText: "true", AddOverlay: "false" },
        ShowTitleOnSeasonPosterPart: { AddShowTitletoSeason: "true" },
        BackgroundOverlayPart: { AddBorder: "false", AddText: "true", AddOverlay: "false" },
        TitleCardOverlayPart: { AddBorder: "false", AddOverlay: "false" },
        TitleCardTitleTextPart: { AddEPTitleText: "true" },
        TitleCardEPTextPart: { AddEPText: "true" }
      }
    }
  },
  {
    id: "only-overlays",
    titleKey: "blueprints.items.onlyOverlays.title",
    descriptionKey: "blueprints.items.onlyOverlays.description",
    icon: Layers,
    images: ["/blueprint-previews/only-overlays.png", "/blueprint-previews/only-overlays_background.png"],
    updates: {
      flat: { PosterAddBorder: "false", PosterAddText: "false", PosterAddOverlay: "true", SeasonPosterAddBorder: "false", SeasonPosterAddText: "false", SeasonPosterAddOverlay: "true", ShowTitleAddShowTitletoSeason: "false", BackgroundAddBorder: "false", BackgroundAddText: "false", BackgroundAddOverlay: "true", TitleCardAddBorder: "false", TitleCardAddOverlay: "true", TitleCardTitleAddEPTitleText: "false", TitleCardEPAddEPText: "false" },
      nested: {
        PosterOverlayPart: { AddBorder: "false", AddText: "false", AddOverlay: "true" },
        SeasonPosterOverlayPart: { AddBorder: "false", AddText: "false", AddOverlay: "true" },
        ShowTitleOnSeasonPosterPart: { AddShowTitletoSeason: "false" },
        BackgroundOverlayPart: { AddBorder: "false", AddText: "false", AddOverlay: "true" },
        TitleCardOverlayPart: { AddBorder: "false", AddOverlay: "true" },
        TitleCardTitleTextPart: { AddEPTitleText: "false" },
        TitleCardEPTextPart: { AddEPText: "false" }
      }
    }
  },
  {
    id: "textless-posters-only",
    titleKey: "blueprints.items.textless.title",
    descriptionKey: "blueprints.items.textless.description",
    icon: Languages,
    images: ["/blueprint-previews/minimalist-posters_textless.png", "/blueprint-previews/minimalist-posters_textless_background.png"],
    updates: {
      flat: { PreferredLanguageOrder: ["xx"], PreferredSeasonLanguageOrder: ["xx"], PreferredBackgroundLanguageOrder: ["xx"], PreferredTCLanguageOrder: ["xx"] },
      nested: { ApiPart: { PreferredLanguageOrder: ["xx"], PreferredSeasonLanguageOrder: ["xx"], PreferredBackgroundLanguageOrder: ["xx"], PreferredTCLanguageOrder: ["xx"] } }
    }
  }
];

// Reusable Accordion Component for the Builder
const Accordion = ({ title, icon: Icon, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-theme rounded-lg overflow-hidden bg-theme-bg/50 mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-theme-card hover:bg-theme-bg transition-colors"
      >
        <div className="flex items-center gap-3">
          {Icon && <Icon className="w-5 h-5 text-theme-primary" />}
          <span className="font-semibold text-theme-text">{title}</span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-theme-muted" /> : <ChevronRight className="w-4 h-4 text-theme-muted" />}
      </button>
      {isOpen && (
        <div className="p-4 border-t border-theme space-y-4">
          {children}
        </div>
      )}
    </div>
  );
};

const ColorInput = ({ value, onChange, label }) => (
  <div className="flex items-center gap-2 mt-2 w-full">
    <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-theme shadow-sm shrink-0">
      <input type="color" value={value || "#ffffff"} onChange={e => onChange(e.target.value)} className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer p-0 border-0" title={label} />
    </div>
    <div className="flex-grow flex flex-col">
       <span className="text-xs text-theme-muted uppercase tracking-wider">{label}</span>
       <input type="text" value={value || "#ffffff"} onChange={e => onChange(e.target.value)} className="w-full bg-transparent border-b border-theme/50 px-1 py-0.5 text-sm font-mono uppercase text-theme-text focus:border-theme-primary focus:outline-none transition-colors" />
    </div>
  </div>
);

const NumberInput = ({ label, value, onChange, min = 0, max = 5000 }) => (
  <div className="flex flex-col gap-1 mt-3 w-full">
    <span className="text-xs text-theme-muted uppercase tracking-wider">{label}</span>
    <input type="number" min={min} max={max} value={value || 0} onChange={(e) => onChange(e.target.value)} className="bg-theme-bg border border-theme rounded-md px-3 py-1.5 text-sm w-full focus:border-theme-primary outline-none transition-colors text-theme-text" />
  </div>
);

const SelectInput = ({ label, value, onChange, options }) => (
  <div className="flex flex-col gap-1 mt-3 w-full">
    <span className="text-xs text-theme-muted uppercase tracking-wider">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-theme-bg border border-theme rounded-md px-3 py-1.5 text-sm w-full focus:border-theme-primary outline-none transition-colors text-theme-text">
      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  </div>
);

const TextInput = ({ label, value, onChange, placeholder = "" }) => (
  <div className="flex flex-col gap-1 mt-3 w-full">
    <span className="text-xs text-theme-muted uppercase tracking-wider">{label}</span>
    <input type="text" placeholder={placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} className="bg-theme-bg border border-theme rounded-md px-3 py-1.5 text-sm w-full focus:border-theme-primary outline-none transition-colors text-theme-text" />
  </div>
);

const LayerItem = ({ id, label, icon: Icon, active, onSelect, enabled, onToggle, showToggle = true }) => (
  <div
    onClick={() => onSelect(id)}
    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all duration-200 ${
      active ? 'bg-theme-primary/10 border-theme-primary shadow-sm' : 'bg-theme-bg/50 border-theme hover:bg-theme-card'
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon className={`w-4 h-4 ${active ? 'text-theme-primary' : 'text-theme-muted'}`} />
      <span className={`text-sm font-medium ${active ? 'text-theme-text' : 'text-theme-muted'}`}>{label}</span>
    </div>
    {showToggle && (
      <button onClick={(e) => { e.stopPropagation(); onToggle(!enabled); }} className={`p-1.5 rounded-md transition-colors ${enabled ? 'text-theme-primary hover:bg-theme-primary/20' : 'text-theme-muted hover:bg-theme-hover'}`}>
        {enabled ? <CheckCircle2 className="w-4 h-4" /> : <Square className="w-4 h-4 opacity-50" />}
      </button>
    )}
  </div>
);

const DEFAULT_BUILDER_STATE = {
    ImageProcessing: true,
    outputQuality: 100,
    Poster: { SampleText: "Movie Title",  AddBorder: false, AddOverlay: false, overlayfile: "overlay-innerglow.png", AddText: false, AddTextStroke: false, UseResolutionOverlays: false, bordercolor: "#ffffff", borderwidth: 30, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", text_offset: "+430", fontAllCaps: true, minPointSize: 45, maxPointSize: 300, lineSpacing: 0, MaxWidth: 1900, MaxHeight: 500, TextGravity: "south" },
    Season: { SampleText: "Season 1",  AddBorder: false, AddOverlay: false, overlayfile: "overlay-innerglow.png", AddText: false, AddTextStroke: false, bordercolor: "#ffffff", borderwidth: 30, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", text_offset: "+400", fontAllCaps: true, minPointSize: 95, maxPointSize: 250, lineSpacing: 0, MaxWidth: 1900, MaxHeight: 500, TextGravity: "south", ShowFallback: false, OverrideSeasonName: false, SeasonOverrideText: "Season", SpecialSeasonOverrideText: "Specials" },
    SeasonTitle: { SampleText: "Show Title",  ShowTitle: false, fontAllCaps: true, AddTextStroke: false, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", minPointSize: 45, maxPointSize: 300, MaxWidth: 1900, MaxHeight: 500, text_offset: "+300", lineSpacing: 0, TextGravity: "south" },
    TitleCard: { AddBorder: false, AddOverlay: false, overlayfile: "backgroundoverlay-innerglow.png", UseResolutionOverlays: false, bordercolor: "#ffffff", borderwidth: 30, UseBackgroundAsTitleCard: false, BackgroundFallback: true },
    TitleCardEPTitle: { SampleText: "Episode Title",  AddEPTitleText: false, fontAllCaps: true, AddTextStroke: false, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", minPointSize: 50, maxPointSize: 150, MaxWidth: 3640, MaxHeight: 280, text_offset: "+300", lineSpacing: 0, TextGravity: "south" },
    TitleCardEPText: { AddEPText: false, fontAllCaps: true, AddTextStroke: false, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", minPointSize: 50, maxPointSize: 150, MaxWidth: 3640, MaxHeight: 280, text_offset: "+100", lineSpacing: 0, TextGravity: "south", SeasonTCText: "Season", EpisodeTCText: "Episode" },
    Background: { SampleText: "Movie Title",  AddBorder: false, AddText: false, AddTextStroke: false, AddOverlay: false, overlayfile: "backgroundoverlay-innerglow.png", UseResolutionOverlays: false, bordercolor: "#ffffff", borderwidth: 30, strokecolor: "#000000", strokewidth: 6, fontcolor: "#ffffff", text_offset: "+200", fontAllCaps: true, minPointSize: 100, maxPointSize: 300, lineSpacing: 0, MaxWidth: 3640, MaxHeight: 500, TextGravity: "south" },

    ResolutionOverlays: {
      poster4k: "overlay-innerglow.png",
      Poster1080p: "overlay-innerglow.png",
      Background4k: "backgroundoverlay-innerglow.png",
      Background1080p: "backgroundoverlay-innerglow.png",
      TC4k: "backgroundoverlay-innerglow.png",
      TC1080p: "backgroundoverlay-innerglow.png",
      "4KDoVi": "overlay-innerglow.png",
      "4KHDR10": "overlay-innerglow.png",
      "4KDoViHDR10": "overlay-innerglow.png",
      "4KDoViBackground": "backgroundoverlay-innerglow.png",
      "4KHDR10Background": "backgroundoverlay-innerglow.png",
      "4KDoViHDR10Background": "backgroundoverlay-innerglow.png",
      "4KDoViTC": "backgroundoverlay-innerglow.png",
      "4KHDR10TC": "backgroundoverlay-innerglow.png"
    },
    Global: {
      UseClearlogo: true,
      UseClearart: false,
      UseOriginalTitle: false,
      FlatWhiteLogo: false,
      TextlessOnly: false
    }
  };

export default function Blueprints() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();
  const fileInputRef = useRef(null);

  const [config, setConfig] = useState(null);
  const [usingFlatStructure, setUsingFlatStructure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState(null);
  const [error, setError] = useState(null);
  const [displayNames, setDisplayNames] = useState({});
  const [isImporting, setIsImporting] = useState(false);
  const [customPreviewImage, setCustomPreviewImage] = useState(null);
  const [overlayFiles, setOverlayFiles] = useState([]);

  // Tabs: "presets" | "builder"
  const [activeTab, setActiveTab] = useState("presets");
  const [showOnlyModified, setShowOnlyModified] = useState(false);

  // Builder State
  const [builderState, setBuilderState] = useState(JSON.parse(JSON.stringify(DEFAULT_BUILDER_STATE)));

  const [previewType, setPreviewType] = useState("Poster"); // "Poster", "Season", "TitleCard", "Background", "Collection"
  const [selectedLayer, setSelectedLayer] = useState("Global");
  const [importBlueprintState, setImportBlueprintState] = useState(null);

  // Custom Presets State
  const [customBlueprints, setCustomBlueprints] = useState([]);
  const [savePresetModalState, setSavePresetModalState] = useState(null);

  // Preview Data State
  const [sampleText, setSampleText] = useState("Movie Title");
  const [sampleLogoUrl, setSampleLogoUrl] = useState("/blueprint-previews/clearlogo.png");
  const [sampleArtUrl, setSampleArtUrl] = useState("/blueprint-previews/clearart.png");

  const fetchOverlayFiles = async () => {
    try {
      const response = await fetch(`${API_URL}/overlayfiles`);
      if (response.ok) {
        const data = await response.json();
        const filesArray = Array.isArray(data) ? data : data.files || [];
        const imageFiles = filesArray.filter(f => f.name.match(/\.(png|jpg|jpeg|webp)$/i)).map(f => ({ label: f.name, value: f.name }));
        setOverlayFiles(imageFiles);
      }
    } catch (err) { console.error("Failed to load overlay files:", err); }
  };

  useEffect(() => {
    fetchConfig();
    fetchOverlayFiles();
    
    // Fetch and migrate custom blueprints
    fetch("/api/custom-blueprints")
      .then(res => res.json())
      .then(dbBlueprints => {
        let merged = Array.isArray(dbBlueprints) ? [...dbBlueprints] : [];
        const stored = localStorage.getItem("posterizarr_custom_blueprints");
        if (stored) {
          try {
            const localBlueprints = JSON.parse(stored);
            if (Array.isArray(localBlueprints) && localBlueprints.length > 0) {
              let changed = false;
              localBlueprints.forEach(lb => {
                if (!merged.find(mb => mb.id === lb.id)) {
                  merged.push(lb);
                  changed = true;
                }
              });
              
              if (changed) {
                fetch("/api/custom-blueprints", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(merged)
                }).then(() => {
                  localStorage.removeItem("posterizarr_custom_blueprints");
                }).catch(e => console.error("Migration save failed", e));
              } else {
                localStorage.removeItem("posterizarr_custom_blueprints");
              }
            } else {
              localStorage.removeItem("posterizarr_custom_blueprints");
            }
          } catch (e) {
            console.error("Failed to parse local custom blueprints", e);
          }
        }
        setCustomBlueprints(merged);
      })
      .catch(e => console.error("Failed to fetch custom blueprints", e));
  }, []);

  const unflattenConfig = (flat) => {
    return {
      OverlayPart: {
        ImageProcessing: flat.ImageProcessing,
        outputQuality: flat.outputQuality
      },
      PrerequisitePart: {
        UseClearlogo: flat.UseClearlogo,
        UseClearart: flat.UseClearart,
        UseOriginalTitle: flat.UseOriginalTitle,
        ConvertLogoColor: flat.ConvertLogoColor,
        LogoFlatColor: flat.LogoFlatColor,
        SkipAddText: flat.SkipAddText,
        UsePosterResolutionOverlays: flat.UsePosterResolutionOverlays,
        UseBackgroundResolutionOverlays: flat.UseBackgroundResolutionOverlays,
        UseTCResolutionOverlays: flat.UseTCResolutionOverlays,
        overlayfile: flat.overlayfile,
        seasonoverlayfile: flat.seasonoverlayfile,
        backgroundoverlayfile: flat.backgroundoverlayfile,
        titlecardoverlayfile: flat.titlecardoverlayfile,
        font: flat.font,
        backgroundfont: flat.backgroundfont,
        titlecardfont: flat.titlecardfont
      },
      PosterOverlayPart: {
        AddBorder: flat.PosterAddBorder,
        AddOverlay: flat.PosterAddOverlay,
        AddText: flat.PosterAddText,
        AddTextStroke: flat.PosterAddTextStroke,
        bordercolor: flat.Posterbordercolor,
        borderwidth: flat.Posterborderwidth,
        fontcolor: flat.Posterfontcolor,
        strokecolor: flat.Posterstrokecolor,
        strokewidth: flat.Posterstrokewidth,
        text_offset: flat.Postertext_offset,
        fontAllCaps: flat.PosterfontAllCaps,
        minPointSize: flat.PosterminPointSize,
        maxPointSize: flat.PostermaxPointSize,
        lineSpacing: flat.PosterlineSpacing,
        MaxWidth: flat.PosterMaxWidth,
        MaxHeight: flat.PosterMaxHeight,
        TextGravity: flat.PosterTextGravity
      },
      SeasonPosterOverlayPart: {
        AddBorder: flat.SeasonPosterAddBorder,
        AddOverlay: flat.SeasonPosterAddOverlay,
        AddText: flat.SeasonPosterAddText,
        AddTextStroke: flat.SeasonPosterAddTextStroke,
        bordercolor: flat.SeasonPosterbordercolor,
        borderwidth: flat.SeasonPosterborderwidth,
        fontcolor: flat.SeasonPosterfontcolor,
        strokecolor: flat.SeasonPosterstrokecolor,
        strokewidth: flat.SeasonPosterstrokewidth,
        text_offset: flat.SeasonPostertext_offset,
        fontAllCaps: flat.SeasonPosterfontAllCaps,
        minPointSize: flat.SeasonPosterminPointSize,
        maxPointSize: flat.SeasonPostermaxPointSize,
        lineSpacing: flat.SeasonPosterlineSpacing,
        MaxWidth: flat.SeasonPosterMaxWidth,
        MaxHeight: flat.SeasonPosterMaxHeight,
        TextGravity: flat.SeasonPosterTextGravity,
        ShowFallback: flat.SeasonPosterShowFallback,
        OverrideSeasonName: flat.SeasonPosterOverrideSeasonName,
        SeasonOverrideText: flat.SeasonPosterSeasonOverrideText,
        SpecialSeasonOverrideText: flat.SeasonPosterSpecialSeasonOverrideText
      },
      ShowTitleOnSeasonPosterPart: {
        AddShowTitletoSeason: flat.ShowTitleAddShowTitletoSeason,
        fontAllCaps: flat.ShowTitlefontAllCaps,
        AddTextStroke: flat.ShowTitleAddTextStroke,
        strokecolor: flat.ShowTitlestrokecolor,
        strokewidth: flat.ShowTitlestrokewidth,
        fontcolor: flat.ShowTitlefontcolor,
        minPointSize: flat.ShowTitleminPointSize,
        maxPointSize: flat.ShowTitlemaxPointSize,
        MaxWidth: flat.ShowTitleMaxWidth,
        MaxHeight: flat.ShowTitleMaxHeight,
        text_offset: flat.ShowTitletext_offset,
        lineSpacing: flat.ShowTitlelineSpacing,
        TextGravity: flat.ShowTitleTextGravity
      },
      BackgroundOverlayPart: {
        AddBorder: flat.BackgroundAddBorder,
        AddOverlay: flat.BackgroundAddOverlay,
        AddText: flat.BackgroundAddText,
        AddTextStroke: flat.BackgroundAddTextStroke,
        bordercolor: flat.Backgroundbordercolor,
        borderwidth: flat.Backgroundborderwidth,
        fontcolor: flat.Backgroundfontcolor,
        strokecolor: flat.Backgroundstrokecolor,
        strokewidth: flat.Backgroundstrokewidth,
        text_offset: flat.Backgroundtext_offset,
        fontAllCaps: flat.BackgroundfontAllCaps,
        minPointSize: flat.BackgroundminPointSize,
        maxPointSize: flat.BackgroundmaxPointSize,
        lineSpacing: flat.BackgroundlineSpacing,
        MaxWidth: flat.BackgroundMaxWidth,
        MaxHeight: flat.BackgroundMaxHeight,
        TextGravity: flat.BackgroundTextGravity
      },
      TitleCardOverlayPart: {
        AddBorder: flat.TitleCardAddBorder,
        AddOverlay: flat.TitleCardAddOverlay,
        bordercolor: flat.TitleCardbordercolor,
        borderwidth: flat.TitleCardborderwidth,
        UseBackgroundAsTitleCard: flat.TitleCardUseBackgroundAsTitleCard,
        BackgroundFallback: flat.TitleCardBackgroundFallback
      },
      TitleCardTitleTextPart: {
        AddEPTitleText: flat.TitleCardTitleAddEPTitleText,
        AddTextStroke: flat.TitleCardTitleAddTextStroke,
        fontcolor: flat.TitleCardTitlefontcolor,
        strokecolor: flat.TitleCardTitlestrokecolor,
        strokewidth: flat.TitleCardTitlestrokewidth,
        text_offset: flat.TitleCardTitletext_offset,
        fontAllCaps: flat.TitleCardTitlefontAllCaps,
        minPointSize: flat.TitleCardTitleminPointSize,
        maxPointSize: flat.TitleCardTitlemaxPointSize,
        lineSpacing: flat.TitleCardTitlelineSpacing,
        MaxWidth: flat.TitleCardTitleMaxWidth,
        MaxHeight: flat.TitleCardTitleMaxHeight,
        TextGravity: flat.TitleCardTitleTextGravity
      },
      TitleCardEPTextPart: {
        AddEPText: flat.TitleCardEPAddEPText,
        AddTextStroke: flat.TitleCardEPAddTextStroke,
        fontcolor: flat.TitleCardEPfontcolor,
        strokecolor: flat.TitleCardEPstrokecolor,
        strokewidth: flat.TitleCardEPstrokewidth,
        text_offset: flat.TitleCardEPtext_offset,
        fontAllCaps: flat.TitleCardEPfontAllCaps,
        minPointSize: flat.TitleCardEPminPointSize,
        maxPointSize: flat.TitleCardEPmaxPointSize,
        lineSpacing: flat.TitleCardEPlineSpacing,
        MaxWidth: flat.TitleCardEPMaxWidth,
        MaxHeight: flat.TitleCardEPMaxHeight,
        TextGravity: flat.TitleCardEPTextGravity,
        SeasonTCText: flat.TitleCardEPSeasonTCText,
        EpisodeTCText: flat.TitleCardEPEpisodeTCText
      }
    };
  };

  const populateBuilderStateFromConfig = (configData, isFlat = false) => {
    if (isFlat) configData = unflattenConfig(configData);

    setBuilderState(prev => ({
      ...prev,
          ImageProcessing: configData.OverlayPart?.ImageProcessing !== undefined ? configData.OverlayPart.ImageProcessing === "true" : prev.ImageProcessing,
          outputQuality: parseInt(configData.OverlayPart?.outputQuality?.replace("%", "") || prev.outputQuality),
          Poster: { SampleText: "Movie Title", 
             ...prev.Poster,
             AddBorder: configData.PosterOverlayPart?.AddBorder !== undefined ? configData.PosterOverlayPart.AddBorder === "true" : prev.Poster.AddBorder,
             AddOverlay: configData.PosterOverlayPart?.AddOverlay !== undefined ? configData.PosterOverlayPart.AddOverlay === "true" : prev.Poster.AddOverlay,
             overlayfile: configData.PrerequisitePart?.overlayfile || prev.Poster.overlayfile,
             AddText: configData.PosterOverlayPart?.AddText !== undefined ? configData.PosterOverlayPart.AddText === "true" : prev.Poster.AddText,
             AddTextStroke: configData.PosterOverlayPart?.AddTextStroke !== undefined ? configData.PosterOverlayPart.AddTextStroke === "true" : prev.Poster.AddTextStroke,
             UseResolutionOverlays: configData.PrerequisitePart?.UsePosterResolutionOverlays !== undefined ? configData.PrerequisitePart.UsePosterResolutionOverlays === "true" : prev.Poster.UseResolutionOverlays,
             bordercolor: configData.PosterOverlayPart?.bordercolor || prev.Poster.bordercolor,
             borderwidth: parseInt(configData.PosterOverlayPart?.borderwidth || prev.Poster.borderwidth),
             fontcolor: configData.PosterOverlayPart?.fontcolor || prev.Poster.fontcolor,
             strokecolor: configData.PosterOverlayPart?.strokecolor || prev.Poster.strokecolor,
             strokewidth: parseInt(configData.PosterOverlayPart?.strokewidth || prev.Poster.strokewidth),
             text_offset: configData.PosterOverlayPart?.text_offset || prev.Poster.text_offset,
             fontAllCaps: configData.PosterOverlayPart?.fontAllCaps !== undefined ? configData.PosterOverlayPart.fontAllCaps === "true" : prev.Poster.fontAllCaps,
             minPointSize: parseInt(configData.PosterOverlayPart?.minPointSize || prev.Poster.minPointSize),
             maxPointSize: parseInt(configData.PosterOverlayPart?.maxPointSize || prev.Poster.maxPointSize),
             lineSpacing: parseInt(configData.PosterOverlayPart?.lineSpacing || prev.Poster.lineSpacing),
             MaxWidth: parseInt(configData.PosterOverlayPart?.MaxWidth || prev.Poster.MaxWidth),
             MaxHeight: parseInt(configData.PosterOverlayPart?.MaxHeight || prev.Poster.MaxHeight),
             TextGravity: configData.PosterOverlayPart?.TextGravity || prev.Poster.TextGravity
          },
          Season: { SampleText: "Season 1", 
             ...prev.Season,
             AddBorder: configData.SeasonPosterOverlayPart?.AddBorder !== undefined ? configData.SeasonPosterOverlayPart.AddBorder === "true" : prev.Season.AddBorder,
             AddOverlay: configData.SeasonPosterOverlayPart?.AddOverlay !== undefined ? configData.SeasonPosterOverlayPart.AddOverlay === "true" : prev.Season.AddOverlay,
             overlayfile: configData.PrerequisitePart?.seasonoverlayfile || prev.Season.overlayfile,
             AddText: configData.SeasonPosterOverlayPart?.AddText !== undefined ? configData.SeasonPosterOverlayPart.AddText === "true" : prev.Season.AddText,
             AddTextStroke: configData.SeasonPosterOverlayPart?.AddTextStroke !== undefined ? configData.SeasonPosterOverlayPart.AddTextStroke === "true" : prev.Season.AddTextStroke,
             bordercolor: configData.SeasonPosterOverlayPart?.bordercolor || prev.Season.bordercolor,
             borderwidth: parseInt(configData.SeasonPosterOverlayPart?.borderwidth || prev.Season.borderwidth),
             fontcolor: configData.SeasonPosterOverlayPart?.fontcolor || prev.Season.fontcolor,
             strokecolor: configData.SeasonPosterOverlayPart?.strokecolor || prev.Season.strokecolor,
             strokewidth: parseInt(configData.SeasonPosterOverlayPart?.strokewidth || prev.Season.strokewidth),
             text_offset: configData.SeasonPosterOverlayPart?.text_offset || prev.Season.text_offset,
             fontAllCaps: configData.SeasonPosterOverlayPart?.fontAllCaps !== undefined ? configData.SeasonPosterOverlayPart.fontAllCaps === "true" : prev.Season.fontAllCaps,
             minPointSize: parseInt(configData.SeasonPosterOverlayPart?.minPointSize || prev.Season.minPointSize),
             maxPointSize: parseInt(configData.SeasonPosterOverlayPart?.maxPointSize || prev.Season.maxPointSize),
             lineSpacing: parseInt(configData.SeasonPosterOverlayPart?.lineSpacing || prev.Season.lineSpacing),
             MaxWidth: parseInt(configData.SeasonPosterOverlayPart?.MaxWidth || prev.Season.MaxWidth),
             MaxHeight: parseInt(configData.SeasonPosterOverlayPart?.MaxHeight || prev.Season.MaxHeight),
             TextGravity: configData.SeasonPosterOverlayPart?.TextGravity || prev.Season.TextGravity,
             ShowFallback: configData.SeasonPosterOverlayPart?.ShowFallback !== undefined ? configData.SeasonPosterOverlayPart.ShowFallback === "true" : prev.Season.ShowFallback,
             OverrideSeasonName: configData.SeasonPosterOverlayPart?.OverrideSeasonName !== undefined ? configData.SeasonPosterOverlayPart.OverrideSeasonName === "true" : prev.Season.OverrideSeasonName,
             SeasonOverrideText: configData.SeasonPosterOverlayPart?.SeasonOverrideText || prev.Season.SeasonOverrideText,
             SpecialSeasonOverrideText: configData.SeasonPosterOverlayPart?.SpecialSeasonOverrideText || prev.Season.SpecialSeasonOverrideText
          },
          SeasonTitle: { SampleText: "Show Title", 
             ...prev.SeasonTitle,
             ShowTitle: configData.ShowTitleOnSeasonPosterPart?.AddShowTitletoSeason !== undefined ? configData.ShowTitleOnSeasonPosterPart.AddShowTitletoSeason === "true" : prev.SeasonTitle.ShowTitle,
             fontAllCaps: configData.ShowTitleOnSeasonPosterPart?.fontAllCaps !== undefined ? configData.ShowTitleOnSeasonPosterPart.fontAllCaps === "true" : prev.SeasonTitle.fontAllCaps,
             AddTextStroke: configData.ShowTitleOnSeasonPosterPart?.AddTextStroke !== undefined ? configData.ShowTitleOnSeasonPosterPart.AddTextStroke === "true" : prev.SeasonTitle.AddTextStroke,
             strokecolor: configData.ShowTitleOnSeasonPosterPart?.strokecolor || prev.SeasonTitle.strokecolor,
             strokewidth: parseInt(configData.ShowTitleOnSeasonPosterPart?.strokewidth || prev.SeasonTitle.strokewidth),
             fontcolor: configData.ShowTitleOnSeasonPosterPart?.fontcolor || prev.SeasonTitle.fontcolor,
             minPointSize: parseInt(configData.ShowTitleOnSeasonPosterPart?.minPointSize || prev.SeasonTitle.minPointSize),
             maxPointSize: parseInt(configData.ShowTitleOnSeasonPosterPart?.maxPointSize || prev.SeasonTitle.maxPointSize),
             MaxWidth: parseInt(configData.ShowTitleOnSeasonPosterPart?.MaxWidth || prev.SeasonTitle.MaxWidth),
             MaxHeight: parseInt(configData.ShowTitleOnSeasonPosterPart?.MaxHeight || prev.SeasonTitle.MaxHeight),
             text_offset: configData.ShowTitleOnSeasonPosterPart?.text_offset || prev.SeasonTitle.text_offset,
             lineSpacing: parseInt(configData.ShowTitleOnSeasonPosterPart?.lineSpacing || prev.SeasonTitle.lineSpacing),
             TextGravity: configData.ShowTitleOnSeasonPosterPart?.TextGravity || prev.SeasonTitle.TextGravity
          },
          Background: { SampleText: "Movie Title", 
             ...prev.Background,
             AddBorder: configData.BackgroundOverlayPart?.AddBorder !== undefined ? configData.BackgroundOverlayPart.AddBorder === "true" : prev.Background.AddBorder,
             AddText: configData.BackgroundOverlayPart?.AddText !== undefined ? configData.BackgroundOverlayPart.AddText === "true" : prev.Background.AddText,
             AddTextStroke: configData.BackgroundOverlayPart?.AddTextStroke !== undefined ? configData.BackgroundOverlayPart.AddTextStroke === "true" : prev.Background.AddTextStroke,
             AddOverlay: configData.BackgroundOverlayPart?.AddOverlay !== undefined ? configData.BackgroundOverlayPart.AddOverlay === "true" : prev.Background.AddOverlay,
             overlayfile: configData.PrerequisitePart?.backgroundoverlayfile || prev.Background.overlayfile,
             UseResolutionOverlays: configData.PrerequisitePart?.UseBackgroundResolutionOverlays !== undefined ? configData.PrerequisitePart.UseBackgroundResolutionOverlays === "true" : prev.Background.UseResolutionOverlays,
             bordercolor: configData.BackgroundOverlayPart?.bordercolor || prev.Background.bordercolor,
             borderwidth: parseInt(configData.BackgroundOverlayPart?.borderwidth || prev.Background.borderwidth),
             fontcolor: configData.BackgroundOverlayPart?.fontcolor || prev.Background.fontcolor,
             strokecolor: configData.BackgroundOverlayPart?.strokecolor || prev.Background.strokecolor,
             strokewidth: parseInt(configData.BackgroundOverlayPart?.strokewidth || prev.Background.strokewidth),
             text_offset: configData.BackgroundOverlayPart?.text_offset || prev.Background.text_offset,
             fontAllCaps: configData.BackgroundOverlayPart?.fontAllCaps !== undefined ? configData.BackgroundOverlayPart.fontAllCaps === "true" : prev.Background.fontAllCaps,
             minPointSize: parseInt(configData.BackgroundOverlayPart?.minPointSize || prev.Background.minPointSize),
             maxPointSize: parseInt(configData.BackgroundOverlayPart?.maxPointSize || prev.Background.maxPointSize),
             lineSpacing: parseInt(configData.BackgroundOverlayPart?.lineSpacing || prev.Background.lineSpacing),
             MaxWidth: parseInt(configData.BackgroundOverlayPart?.MaxWidth || prev.Background.MaxWidth),
             MaxHeight: parseInt(configData.BackgroundOverlayPart?.MaxHeight || prev.Background.MaxHeight),
             TextGravity: configData.BackgroundOverlayPart?.TextGravity || prev.Background.TextGravity
          },
          TitleCard: {
             ...prev.TitleCard,
             AddBorder: configData.TitleCardOverlayPart?.AddBorder !== undefined ? configData.TitleCardOverlayPart.AddBorder === "true" : prev.TitleCard.AddBorder,
             AddOverlay: configData.TitleCardOverlayPart?.AddOverlay !== undefined ? configData.TitleCardOverlayPart.AddOverlay === "true" : prev.TitleCard.AddOverlay,
             overlayfile: configData.PrerequisitePart?.titlecardoverlayfile || prev.TitleCard.overlayfile,
             UseResolutionOverlays: configData.PrerequisitePart?.UseTCResolutionOverlays !== undefined ? configData.PrerequisitePart.UseTCResolutionOverlays === "true" : prev.TitleCard.UseResolutionOverlays,
             bordercolor: configData.TitleCardOverlayPart?.bordercolor || prev.TitleCard.bordercolor,
             borderwidth: parseInt(configData.TitleCardOverlayPart?.borderwidth || prev.TitleCard.borderwidth),
             UseBackgroundAsTitleCard: configData.TitleCardOverlayPart?.UseBackgroundAsTitleCard !== undefined ? configData.TitleCardOverlayPart.UseBackgroundAsTitleCard === "true" : prev.TitleCard.UseBackgroundAsTitleCard,
             BackgroundFallback: configData.TitleCardOverlayPart?.BackgroundFallback !== undefined ? configData.TitleCardOverlayPart.BackgroundFallback === "true" : prev.TitleCard.BackgroundFallback,
          },
          TitleCardEPTitle: { SampleText: "Episode Title", 
             ...prev.TitleCardEPTitle,
             AddEPTitleText: configData.TitleCardTitleTextPart?.AddEPTitleText !== undefined ? configData.TitleCardTitleTextPart.AddEPTitleText === "true" : prev.TitleCardEPTitle.AddEPTitleText,
             fontAllCaps: configData.TitleCardTitleTextPart?.fontAllCaps !== undefined ? configData.TitleCardTitleTextPart.fontAllCaps === "true" : prev.TitleCardEPTitle.fontAllCaps,
             AddTextStroke: configData.TitleCardTitleTextPart?.AddTextStroke !== undefined ? configData.TitleCardTitleTextPart.AddTextStroke === "true" : prev.TitleCardEPTitle.AddTextStroke,
             strokecolor: configData.TitleCardTitleTextPart?.strokecolor || prev.TitleCardEPTitle.strokecolor,
             strokewidth: parseInt(configData.TitleCardTitleTextPart?.strokewidth || prev.TitleCardEPTitle.strokewidth),
             fontcolor: configData.TitleCardTitleTextPart?.fontcolor || prev.TitleCardEPTitle.fontcolor,
             minPointSize: parseInt(configData.TitleCardTitleTextPart?.minPointSize || prev.TitleCardEPTitle.minPointSize),
             maxPointSize: parseInt(configData.TitleCardTitleTextPart?.maxPointSize || prev.TitleCardEPTitle.maxPointSize),
             MaxWidth: parseInt(configData.TitleCardTitleTextPart?.MaxWidth || prev.TitleCardEPTitle.MaxWidth),
             MaxHeight: parseInt(configData.TitleCardTitleTextPart?.MaxHeight || prev.TitleCardEPTitle.MaxHeight),
             text_offset: configData.TitleCardTitleTextPart?.text_offset || prev.TitleCardEPTitle.text_offset,
             lineSpacing: parseInt(configData.TitleCardTitleTextPart?.lineSpacing || prev.TitleCardEPTitle.lineSpacing),
             TextGravity: configData.TitleCardTitleTextPart?.TextGravity || prev.TitleCardEPTitle.TextGravity
          },
          TitleCardEPText: {
             ...prev.TitleCardEPText,
             AddEPText: configData.TitleCardEPTextPart?.AddEPText !== undefined ? configData.TitleCardEPTextPart.AddEPText === "true" : prev.TitleCardEPText.AddEPText,
             fontAllCaps: configData.TitleCardEPTextPart?.fontAllCaps !== undefined ? configData.TitleCardEPTextPart.fontAllCaps === "true" : prev.TitleCardEPText.fontAllCaps,
             AddTextStroke: configData.TitleCardEPTextPart?.AddTextStroke !== undefined ? configData.TitleCardEPTextPart.AddTextStroke === "true" : prev.TitleCardEPText.AddTextStroke,
             strokecolor: configData.TitleCardEPTextPart?.strokecolor || prev.TitleCardEPText.strokecolor,
             strokewidth: parseInt(configData.TitleCardEPTextPart?.strokewidth || prev.TitleCardEPText.strokewidth),
             fontcolor: configData.TitleCardEPTextPart?.fontcolor || prev.TitleCardEPText.fontcolor,
             minPointSize: parseInt(configData.TitleCardEPTextPart?.minPointSize || prev.TitleCardEPText.minPointSize),
             maxPointSize: parseInt(configData.TitleCardEPTextPart?.maxPointSize || prev.TitleCardEPText.maxPointSize),
             MaxWidth: parseInt(configData.TitleCardEPTextPart?.MaxWidth || prev.TitleCardEPText.MaxWidth),
             MaxHeight: parseInt(configData.TitleCardEPTextPart?.MaxHeight || prev.TitleCardEPText.MaxHeight),
             text_offset: configData.TitleCardEPTextPart?.text_offset || prev.TitleCardEPText.text_offset,
             lineSpacing: parseInt(configData.TitleCardEPTextPart?.lineSpacing || prev.TitleCardEPText.lineSpacing),
             TextGravity: configData.TitleCardEPTextPart?.TextGravity || prev.TitleCardEPText.TextGravity,
             SeasonTCText: configData.TitleCardEPTextPart?.SeasonTCText || prev.TitleCardEPText.SeasonTCText,
             EpisodeTCText: configData.TitleCardEPTextPart?.EpisodeTCText || prev.TitleCardEPText.EpisodeTCText
          },
          Collection: { SampleText: "Collection Name", 
             ...prev.Collection,
             AddBorder: configData.CollectionPosterOverlayPart?.AddBorder === "true",
             AddOverlay: configData.CollectionPosterOverlayPart?.AddOverlay === "true",
             overlayfile: configData.PrerequisitePart?.collectionoverlayfile || "overlay-innerglow.png",
             AddText: configData.CollectionPosterOverlayPart?.AddText === "true",
             AddTextStroke: configData.CollectionPosterOverlayPart?.AddTextStroke === "true",
             bordercolor: configData.CollectionPosterOverlayPart?.bordercolor || "#000000",
             borderwidth: parseInt(configData.CollectionPosterOverlayPart?.borderwidth || 30),
             fontcolor: configData.CollectionPosterOverlayPart?.fontcolor || "#ffffff",
             strokecolor: configData.CollectionPosterOverlayPart?.strokecolor || "#000000",
             strokewidth: parseInt(configData.CollectionPosterOverlayPart?.strokewidth || 6),
             text_offset: configData.CollectionPosterOverlayPart?.text_offset || "+300",
             fontAllCaps: configData.CollectionPosterOverlayPart?.fontAllCaps === "true",
             minPointSize: parseInt(configData.CollectionPosterOverlayPart?.minPointSize || 100),
             maxPointSize: parseInt(configData.CollectionPosterOverlayPart?.maxPointSize || 250),
             lineSpacing: parseInt(configData.CollectionPosterOverlayPart?.lineSpacing || 0),
             MaxWidth: parseInt(configData.CollectionPosterOverlayPart?.MaxWidth || 1900),
             MaxHeight: parseInt(configData.CollectionPosterOverlayPart?.MaxHeight || 500),
             TextGravity: configData.CollectionPosterOverlayPart?.TextGravity || "south"
          },
          CollectionTitle: {
             ...prev.CollectionTitle,
             AddCollectionTitle: configData.CollectionTitlePosterPart?.AddCollectionTitle === "true",
             CollectionTitle: configData.CollectionTitlePosterPart?.CollectionTitle || "Collection",
             fontAllCaps: configData.CollectionTitlePosterPart?.fontAllCaps === "true",
             AddTextStroke: configData.CollectionTitlePosterPart?.AddTextStroke === "true",
             strokecolor: configData.CollectionTitlePosterPart?.strokecolor || "#000000",
             strokewidth: parseInt(configData.CollectionTitlePosterPart?.strokewidth || 6),
             fontcolor: configData.CollectionTitlePosterPart?.fontcolor || "#ffffff",
             minPointSize: parseInt(configData.CollectionTitlePosterPart?.minPointSize || 50),
             maxPointSize: parseInt(configData.CollectionTitlePosterPart?.maxPointSize || 100),
             MaxWidth: parseInt(configData.CollectionTitlePosterPart?.MaxWidth || 1000),
             MaxHeight: parseInt(configData.CollectionTitlePosterPart?.MaxHeight || 140),
             text_offset: configData.CollectionTitlePosterPart?.text_offset || "+150",
             lineSpacing: parseInt(configData.CollectionTitlePosterPart?.lineSpacing || 0),
             TextGravity: configData.CollectionTitlePosterPart?.TextGravity || "south"
          },
          ResolutionOverlays: {
      poster4k: "overlay-innerglow.png",
      Poster1080p: "overlay-innerglow.png",
      Background4k: "backgroundoverlay-innerglow.png",
      Background1080p: "backgroundoverlay-innerglow.png",
      TC4k: "backgroundoverlay-innerglow.png",
      TC1080p: "backgroundoverlay-innerglow.png",
      "4KDoVi": "overlay-innerglow.png",
      "4KHDR10": "overlay-innerglow.png",
      "4KDoViHDR10": "overlay-innerglow.png",
      "4KDoViBackground": "backgroundoverlay-innerglow.png",
      "4KHDR10Background": "backgroundoverlay-innerglow.png",
      "4KDoViHDR10Background": "backgroundoverlay-innerglow.png",
      "4KDoViTC": "backgroundoverlay-innerglow.png",
      "4KHDR10TC": "backgroundoverlay-innerglow.png"
    },
    Global: {
             UseClearlogo: configData.PrerequisitePart?.UseClearlogo !== undefined ? configData.PrerequisitePart.UseClearlogo === "true" : prev.Global.UseClearlogo,
             UseClearart: configData.PrerequisitePart?.UseClearart !== undefined ? configData.PrerequisitePart.UseClearart === "true" : prev.Global.UseClearart,
             UseOriginalTitle: configData.PrerequisitePart?.UseOriginalTitle === "true",
             FlatWhiteLogo: configData.PrerequisitePart?.ConvertLogoColor === "true",
             TextlessOnly: configData.PrerequisitePart?.SkipAddText === "true"
          }
    }));
  };

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/config`);
      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        setUsingFlatStructure(data.using_flat_structure || false);
        if (data.display_names) setDisplayNames(data.display_names);

        populateBuilderStateFromConfig(data.config, data.using_flat_structure);
      } else {
        setError("Failed to load config");
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyBlueprint = async (blueprint) => {
    if (!config) return;

    setApplyingId(blueprint.id);
    try {
      let updatedConfig = { ...config };
      const updates = usingFlatStructure ? blueprint.updates.flat : blueprint.updates.nested;

      if (usingFlatStructure) {
        updatedConfig = { ...updatedConfig, ...updates };
      } else {
        for (const [section, fields] of Object.entries(updates)) {
          updatedConfig[section] = {
            ...(updatedConfig[section] || {}),
            ...fields
          };
        }
      }

      const response = await fetch(`${API_URL}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: updatedConfig }),
      });

      const data = await response.json();
      if (data.success) {
        setConfig(updatedConfig);
        showSuccess(`Blueprint applied successfully!`);
      } else {
        showError("Failed to apply blueprint configuration");
      }
    } catch (err) {
      showError(`Error applying blueprint: ${err.message}`);
    } finally {
      setApplyingId(null);
    }
  };

  const handleLoadBlueprintInBuilder = (blueprint) => {
    if (!config) return;
    
    let fauxConfig = { ...config };
    const updates = usingFlatStructure ? blueprint.updates.flat : blueprint.updates.nested;
if (usingFlatStructure) {
      fauxConfig = { ...fauxConfig, ...updates };
    } else {
      for (const [section, fields] of Object.entries(updates)) {
        fauxConfig[section] = {
          ...(fauxConfig[section] || {}),
          ...fields
        };
      }
    }

    // Auto-enable Text/Logo if a preset enforces Clearlogo, Clearart or OriginalTitle
    const needsText = (fauxConfig.PrerequisitePart?.UseClearlogo === "true" || fauxConfig.PrerequisitePart?.UseClearart === "true" || fauxConfig.PrerequisitePart?.UseOriginalTitle === "true");
    if (needsText) {
       fauxConfig.PosterOverlayPart = { ...(fauxConfig.PosterOverlayPart || {}), AddText: "true" };
       fauxConfig.SeasonPosterOverlayPart = { ...(fauxConfig.SeasonPosterOverlayPart || {}), AddText: "true" };
       fauxConfig.BackgroundOverlayPart = { ...(fauxConfig.BackgroundOverlayPart || {}), AddText: "true" };
    }

    populateBuilderStateFromConfig(fauxConfig, usingFlatStructure);
    setActiveTab("builder");
    showSuccess(`Loaded ${blueprint.customTitle || blueprint.name || 'preset'} into Builder!`);
  };


  const generateBlueprintUpdates = (state = builderState) => {
    return {
      OverlayPart: {
        ImageProcessing: state.ImageProcessing ? "true" : "false",
        outputQuality: `${state.outputQuality}%`
      },
      PrerequisitePart: {
        UseClearlogo: state.Global.UseClearlogo ? "true" : "false",
        UseClearart: state.Global.UseClearart ? "true" : "false",
        UseOriginalTitle: state.Global.UseOriginalTitle ? "true" : "false",
        ConvertLogoColor: state.Global.FlatWhiteLogo ? "true" : "false",
        LogoFlatColor: state.Global.FlatWhiteLogo ? "white" : undefined,
        SkipAddText: state.Global.TextlessOnly ? "true" : "false",
        UsePosterResolutionOverlays: state.Poster.UseResolutionOverlays ? "true" : "false",
        UseBackgroundResolutionOverlays: state.Background.UseResolutionOverlays ? "true" : "false",
        UseTCResolutionOverlays: state.TitleCard.UseResolutionOverlays ? "true" : "false",
                backgroundoverlayfile: state.Background.overlayfile,
        showbackgroundoverlayfile: state.Background.overlayfile,
        titlecardoverlayfile: state.TitleCard.overlayfile,
        overlayfile: state.Poster.overlayfile,
        showoverlayfile: state.Poster.overlayfile,
        seasonoverlayfile: state.Season.overlayfile,
        poster4k: state.ResolutionOverlays.poster4k,
        Poster1080p: state.ResolutionOverlays.Poster1080p,
        Background4k: state.ResolutionOverlays.Background4k,
        Background1080p: state.ResolutionOverlays.Background1080p,
        TC4k: state.ResolutionOverlays.TC4k,
        TC1080p: state.ResolutionOverlays.TC1080p,
        "4KDoVi": state.ResolutionOverlays["4KDoVi"],
        "4KHDR10": state.ResolutionOverlays["4KHDR10"],
        "4KDoViHDR10": state.ResolutionOverlays["4KDoViHDR10"],
        "4KDoViBackground": state.ResolutionOverlays["4KDoViBackground"],
        "4KHDR10Background": state.ResolutionOverlays["4KHDR10Background"],
        "4KDoViHDR10Background": state.ResolutionOverlays["4KDoViHDR10Background"],
        "4KDoViTC": state.ResolutionOverlays["4KDoViTC"],
        "4KHDR10TC": state.ResolutionOverlays["4KHDR10TC"]
      },
      PosterOverlayPart: {
        AddBorder: state.Poster.AddBorder ? "true" : "false",
        AddText: state.Poster.AddText ? "true" : "false",
        AddTextStroke: state.Poster.AddTextStroke ? "true" : "false",
        AddOverlay: state.Poster.AddOverlay ? "true" : "false",
        bordercolor: state.Poster.bordercolor,
        borderwidth: state.Poster.borderwidth.toString(),
        fontcolor: state.Poster.fontcolor,
        strokecolor: state.Poster.strokecolor,
        strokewidth: state.Poster.strokewidth.toString(),
        text_offset: state.Poster.text_offset,
        fontAllCaps: state.Poster.fontAllCaps ? "true" : "false",
        minPointSize: state.Poster.minPointSize.toString(),
        maxPointSize: state.Poster.maxPointSize.toString(),
        lineSpacing: state.Poster.lineSpacing.toString(),
        MaxWidth: state.Poster.MaxWidth.toString(),
        MaxHeight: state.Poster.MaxHeight.toString(),
        TextGravity: state.Poster.TextGravity
      },
      SeasonPosterOverlayPart: {
        AddBorder: state.Season.AddBorder ? "true" : "false",
        AddText: state.Season.AddText ? "true" : "false",
        AddTextStroke: state.Season.AddTextStroke ? "true" : "false",
        AddOverlay: state.Season.AddOverlay ? "true" : "false",
        bordercolor: state.Season.bordercolor,
        borderwidth: state.Season.borderwidth.toString(),
        fontcolor: state.Season.fontcolor,
        strokecolor: state.Season.strokecolor,
        strokewidth: state.Season.strokewidth.toString(),
        text_offset: state.Season.text_offset,
        fontAllCaps: state.Season.fontAllCaps ? "true" : "false",
        minPointSize: state.Season.minPointSize.toString(),
        maxPointSize: state.Season.maxPointSize.toString(),
        lineSpacing: state.Season.lineSpacing.toString(),
        MaxWidth: state.Season.MaxWidth.toString(),
        MaxHeight: state.Season.MaxHeight.toString(),
        TextGravity: state.Season.TextGravity,
        ShowFallback: state.Season.ShowFallback ? "true" : "false",
        OverrideSeasonName: state.Season.OverrideSeasonName ? "true" : "false",
        SeasonOverrideText: state.Season.SeasonOverrideText,
        SpecialSeasonOverrideText: state.Season.SpecialSeasonOverrideText
      },
      ShowTitleOnSeasonPosterPart: {
        AddShowTitletoSeason: state.SeasonTitle.ShowTitle ? "true" : "false",
        fontAllCaps: state.SeasonTitle.fontAllCaps ? "true" : "false",
        AddTextStroke: state.SeasonTitle.AddTextStroke ? "true" : "false",
        strokecolor: state.SeasonTitle.strokecolor,
        strokewidth: state.SeasonTitle.strokewidth.toString(),
        fontcolor: state.SeasonTitle.fontcolor,
        minPointSize: state.SeasonTitle.minPointSize.toString(),
        maxPointSize: state.SeasonTitle.maxPointSize.toString(),
        MaxWidth: state.SeasonTitle.MaxWidth.toString(),
        MaxHeight: state.SeasonTitle.MaxHeight.toString(),
        text_offset: state.SeasonTitle.text_offset,
        lineSpacing: state.SeasonTitle.lineSpacing.toString(),
        TextGravity: state.SeasonTitle.TextGravity
      },
      BackgroundOverlayPart: {
        AddBorder: state.Background.AddBorder ? "true" : "false",
        AddText: state.Background.AddText ? "true" : "false",
        AddTextStroke: state.Background.AddTextStroke ? "true" : "false",
        AddOverlay: state.Background.AddOverlay ? "true" : "false",
        bordercolor: state.Background.bordercolor,
        borderwidth: state.Background.borderwidth.toString(),
        fontcolor: state.Background.fontcolor,
        strokecolor: state.Background.strokecolor,
        strokewidth: state.Background.strokewidth.toString(),
        text_offset: state.Background.text_offset,
        fontAllCaps: state.Background.fontAllCaps ? "true" : "false",
        minPointSize: state.Background.minPointSize.toString(),
        maxPointSize: state.Background.maxPointSize.toString(),
        lineSpacing: state.Background.lineSpacing.toString(),
        MaxWidth: state.Background.MaxWidth.toString(),
        MaxHeight: state.Background.MaxHeight.toString(),
        TextGravity: state.Background.TextGravity
      },
      TitleCardOverlayPart: {
        AddBorder: state.TitleCard.AddBorder ? "true" : "false",
        AddOverlay: state.TitleCard.AddOverlay ? "true" : "false",
        bordercolor: state.TitleCard.bordercolor,
        borderwidth: state.TitleCard.borderwidth.toString(),
        UseBackgroundAsTitleCard: state.TitleCard.UseBackgroundAsTitleCard ? "true" : "false",
        BackgroundFallback: state.TitleCard.BackgroundFallback ? "true" : "false"
      },
      TitleCardTitleTextPart: {
        AddEPTitleText: state.TitleCardEPTitle.AddEPTitleText ? "true" : "false",
        AddTextStroke: state.TitleCardEPTitle.AddTextStroke ? "true" : "false",
        fontcolor: state.TitleCardEPTitle.fontcolor,
        strokecolor: state.TitleCardEPTitle.strokecolor,
        strokewidth: state.TitleCardEPTitle.strokewidth.toString(),
        text_offset: state.TitleCardEPTitle.text_offset,
        fontAllCaps: state.TitleCardEPTitle.fontAllCaps ? "true" : "false",
        minPointSize: state.TitleCardEPTitle.minPointSize.toString(),
        maxPointSize: state.TitleCardEPTitle.maxPointSize.toString(),
        lineSpacing: state.TitleCardEPTitle.lineSpacing.toString(),
        MaxWidth: state.TitleCardEPTitle.MaxWidth.toString(),
        MaxHeight: state.TitleCardEPTitle.MaxHeight.toString(),
        TextGravity: state.TitleCardEPTitle.TextGravity
      },
      TitleCardEPTextPart: {
        AddEPText: state.TitleCardEPText.AddEPText ? "true" : "false",
        AddTextStroke: state.TitleCardEPText.AddTextStroke ? "true" : "false",
        fontcolor: state.TitleCardEPText.fontcolor,
        strokecolor: state.TitleCardEPText.strokecolor,
        strokewidth: state.TitleCardEPText.strokewidth.toString(),
        text_offset: state.TitleCardEPText.text_offset,
        fontAllCaps: state.TitleCardEPText.fontAllCaps ? "true" : "false",
        minPointSize: state.TitleCardEPText.minPointSize.toString(),
        maxPointSize: state.TitleCardEPText.maxPointSize.toString(),
        lineSpacing: state.TitleCardEPText.lineSpacing.toString(),
        MaxWidth: state.TitleCardEPText.MaxWidth.toString(),
        MaxHeight: state.TitleCardEPText.MaxHeight.toString(),
        TextGravity: state.TitleCardEPText.TextGravity,
        SeasonTCText: state.TitleCardEPText.SeasonTCText,
        EpisodeTCText: state.TitleCardEPText.EpisodeTCText
      }
    };
  };

  const handleSavePresetClick = () => {
    const updates = generateBlueprintUpdates();
    setSavePresetModalState({ updates });
  };

  const saveCustomPreset = (title, description) => {
    if (!title) return;
    const newBlueprint = {
      id: "custom_" + Date.now(),
      titleKey: null,
      customTitle: title,
      customDescription: description,
      icon: "User",
      updates: { nested: savePresetModalState.updates }
    };
    const updatedBlueprints = [...customBlueprints, newBlueprint];
    setCustomBlueprints(updatedBlueprints);
    
    fetch("/api/custom-blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedBlueprints)
    }).then(() => {
      showSuccess("Custom Preset saved!");
    }).catch(e => {
      console.error("Failed to save blueprint to db", e);
      showError("Failed to save preset to database.");
    });
    
    setSavePresetModalState(null);
    setActiveTab("presets");
  };

  const deleteCustomPreset = (id) => {
    const updatedBlueprints = customBlueprints.filter(b => b.id !== id);
    setCustomBlueprints(updatedBlueprints);
    
    fetch("/api/custom-blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedBlueprints)
    }).then(() => {
      showSuccess("Custom Preset deleted!");
    }).catch(e => {
      console.error("Failed to delete blueprint from db", e);
      showError("Failed to delete preset from database.");
    });
  };

  const applyBuilderConfig = async () => {
    const nestedUpdates = generateBlueprintUpdates();

    const syntheticBlueprint = {
      id: "builder",
      title: "Custom Builder Config",
      updates: { nested: nestedUpdates }
    };

    await handleApplyBlueprint(syntheticBlueprint);
  };

  const handleExportBlueprint = () => {
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", `${API_URL}/config/export`);
    downloadAnchorNode.setAttribute("download", "custom_blueprint.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.updates && !parsed.PosterOverlayPart) {
        throw new Error("Invalid blueprint format. Missing updates object.");
      }

      let updates = parsed;
      if (parsed.updates) {
         updates = parsed.updates.nested || parsed.updates.flat || parsed.updates;
      }

      setSavePresetModalState({ updates, isImport: true });
    } catch (err) {
      showError(t("blueprints.importError", { message: err.message }));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    if (!importBlueprintState) return;
    setIsImporting(true);
    try {
      const response = await fetch(`${API_URL}/config/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(importBlueprintState),
      });

      const result = await response.json();
      if (result.success) {
        showSuccess(t("blueprints.importSuccess"));
        fetchConfig();
      } else {
        showError(t("blueprints.importFailed", { message: result.message || "Unknown error" }));
      }
    } catch (err) {
      showError(t("blueprints.importError", { message: err.message }));
    } finally {
      setIsImporting(false);
      setImportBlueprintState(null);
    }
  };

  const updateBuilder = (category, field, value) => {
    if (category) {
      setBuilderState(prev => ({
        ...prev,
        [category]: { ...prev[category], [field]: value }
      }));
    } else {
      setBuilderState(prev => ({ ...prev, [field]: value }));
    }
  };

  const handleCustomPreview = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => { setCustomPreviewImage(e.target.result); };
      reader.readAsDataURL(file);
    }
  };

  const resetCustomPreview = () => setCustomPreviewImage(null);

  const Toggle = ({ label, checked, onChange }) => (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-theme-text group-hover:text-theme-primary transition-colors">{label}</span>
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className={`block w-10 h-6 rounded-full transition-colors ${checked ? 'bg-theme-primary' : 'bg-theme-bg border border-theme'}`}></div>
        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${checked ? 'transform translate-x-4' : ''}`}></div>
      </div>
    </label>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-12 h-12 animate-spin text-theme-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/40 rounded-xl p-6 border-2 border-red-600/50 text-center mx-auto max-w-2xl mt-10">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-300 text-lg font-semibold mb-2">Error Loading Configuration</p>
        <p className="text-red-200 mb-4">{error}</p>
        <button onClick={fetchConfig} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-all shadow-lg">Retry</button>
      </div>
    );
  }

  const getStyleObj = (categoryState) => {
    const part = categoryState || {};
    const bColor = part.bordercolor || "white";
    const bWidth = Math.max(2, (parseInt(part.borderwidth) || 30) * 0.15); // scaled
    const fColor = part.fontcolor || "white";
    const sColor = part.strokecolor || "black";
    const sWidth = Math.max(1, (parseInt(part.strokewidth) || 6) * 0.15);
    const hasStroke = part.AddTextStroke;
    const gravity = part.TextGravity?.toLowerCase() || "south";
    const offsetRaw = part.text_offset || "+400";
    let offset = parseInt(String(offsetRaw).replace('+', '').replace('-', '')) || 400;
    offset = Math.max(0, offset * 0.15);

    return {
      border: {
        borderColor: bColor,
        borderWidth: `${bWidth}px`,
        borderStyle: 'solid'
      },
      text: {
        color: fColor,
        WebkitTextStroke: hasStroke ? `${sWidth}px ${sColor}` : undefined,
        textShadow: hasStroke ? undefined : '0px 4px 10px rgba(0,0,0,0.5)'
      }
    };
  };


  const getBoundingBoxStyle = (layer) => {
    if (!layer) return {};
    const canvasW = (previewType === 'Background' || previewType === 'TitleCard') ? 3840 : 2000;
    const canvasH = (previewType === 'Background' || previewType === 'TitleCard') ? 2160 : 3000;
    const offsetRaw = layer.text_offset || "+400";
    const offset = parseInt(String(offsetRaw).replace('+', '').replace('-', '')) || 400;
    const gravity = layer.TextGravity?.toLowerCase() || "south";
    const offsetPercent = (offset / canvasH) * 100;
    const w = Math.min(100, (layer.MaxWidth / canvasW) * 100);
    const h = Math.min(100, (layer.MaxHeight / canvasH) * 100);

    let justifyContent = 'center';
    let alignItems = 'center';
    if (gravity.includes('north')) justifyContent = 'flex-start';
    if (gravity.includes('south')) justifyContent = 'flex-end';
    if (gravity.includes('west')) alignItems = 'flex-start';
    if (gravity.includes('east')) alignItems = 'flex-end';

    return {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      [gravity.includes('north') ? 'top' : 'bottom']: `${offsetPercent}%`,
      width: `${w}%`,
      height: `${h}%`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent,
      alignItems
    };
  };

  const previewStyles = getStyleObj(builderState[previewType]);


  const seasonTitleStyles = getStyleObj(builderState.SeasonTitle);
  const tcTitleStyles = getStyleObj(builderState.TitleCardEPTitle);
  const tcEpStyles = getStyleObj(builderState.TitleCardEPText);
  const collectionTitleStyles = getStyleObj(builderState.CollectionTitle);

  const getSampleImage = () => {
    if (customPreviewImage) return customPreviewImage;
    if (previewType === 'Background' || previewType === 'TitleCard') return `/images/default_background.jpg?t=${Date.now()}`;
    return `/images/default_poster.jpg?t=${Date.now()}`;
  };

  const getScalingStyle = (settings, text = "") => {
    const canvasH = (previewType === 'Background' || previewType === 'TitleCard') ? 2160 : 3000;
    
    // Estimate optimal pixel size to fit horizontally
    const charScale = Math.max(1, text.length) * 0.55;
    const computedMaxPixels = (settings?.MaxWidth || 1900) / charScale;
    
    // Convert absolute canvas pixels to Container Query Heights (cqh) of the master poster wrapper
    const minCqh = ((settings?.minPointSize || 10) / canvasH) * 100;
    const maxCqh = ((settings?.maxPointSize || 200) / canvasH) * 100;
    
    // Ideal size is constrained by either the bounding box height or the available width
    const boundingBoxHeightCqh = ((settings?.MaxHeight || 400) / canvasH) * 100;
    const optimalWidthCqh = (computedMaxPixels / canvasH) * 100;
    const idealCqh = Math.min(boundingBoxHeightCqh, optimalWidthCqh);
    
    return {
      fontSize: `clamp(${minCqh}cqh, ${idealCqh}cqh, ${maxCqh}cqh)`,
      textTransform: settings?.fontAllCaps ? 'uppercase' : 'none',
      lineHeight: 1 + (settings?.lineSpacing || 0) / 100,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    };
  };

  return (
    <div className="space-y-6">
      <style>{`
        @font-face {
          font-family: 'PosterFont';
          src: url('${API_URL}/fonts/download/${config?.PrerequisitePart?.font || 'Impact.ttf'}');
        }
        @font-face {
          font-family: 'BackgroundFont';
          src: url('${API_URL}/fonts/download/${config?.PrerequisitePart?.backgroundfont || 'Impact.ttf'}');
        }
        @font-face {
          font-family: 'TitleCardFont';
          src: url('${API_URL}/fonts/download/${config?.PrerequisitePart?.titlecardfont || 'Impact.ttf'}');
        }
      `}</style>
      <div className="bg-theme-card border border-theme rounded-xl p-6 shadow-sm">
        <div className="mb-6 flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-theme-text">{t("blueprints.pageTitle")}</h1>
            <p className="text-theme-muted mt-2">
              {t("blueprints.pageDescription")}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleExportBlueprint} className="flex items-center gap-2 px-4 py-2 bg-theme-bg border border-theme hover:border-theme-primary/50 text-theme-text rounded-lg transition-colors">
              <Download className="w-4 h-4" />
              <span>{t("blueprints.export")}</span>
            </button>
            <div className="relative">
              <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="flex items-center gap-2 px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary border border-theme-primary/30 rounded-lg transition-colors disabled:opacity-50">
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{isImporting ? t("blueprints.importing") : t("blueprints.import")}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex border-b border-theme mb-6">
          <button
            onClick={() => setActiveTab("presets")}
            className={`px-6 py-3 flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'presets' ? 'border-theme-primary text-theme-primary font-medium' : 'border-transparent text-theme-muted hover:text-theme-text'}`}
          >
            <LayoutTemplate className="w-4 h-4" />
            {t("blueprints.builder.tabPresets", "Presets")}
          </button>
          <button
            onClick={() => setActiveTab("builder")}
            className={`px-6 py-3 flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'builder' ? 'border-theme-primary text-theme-primary font-medium' : 'border-transparent text-theme-muted hover:text-theme-text'}`}
          >
            <Sliders className="w-4 h-4" />
            {t("blueprints.builder.tabBuilder", "Builder")}
          </button>
        </div>

        {activeTab === "presets" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[...BLUEPRINTS, ...customBlueprints].map((blueprint) => {
              const Icon = typeof blueprint.icon === "string" ? Layers : blueprint.icon;
              const isApplying = applyingId === blueprint.id;
              return (
                <div key={blueprint.id} className="bg-theme-bg/50 border border-theme rounded-xl p-5 hover:border-theme-primary/50 transition-all flex flex-col h-full group shadow-md hover:shadow-lg">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-3 bg-theme-primary/10 rounded-xl text-theme-primary group-hover:scale-110 transition-transform">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-grow">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-theme-text">{blueprint.customTitle || t(blueprint.titleKey)}</h3>
                      </div>
                    </div>
                  </div>
                  {blueprint.images && blueprint.images.length > 0 && (
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar items-center">
                      {blueprint.images.map((img, idx) => (
                        <img key={idx} src={img} alt={`${blueprint.customTitle || t(blueprint.titleKey)} preview ${idx + 1}`} className="h-32 object-contain rounded-md bg-black/20 shrink-0 shadow-sm" />
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-theme-muted flex-grow mb-4">{blueprint.customDescription || (blueprint.descriptionKey ? t(blueprint.descriptionKey) : "")}</p>

                  {blueprint.id.startsWith("custom_") && (
                    <button onClick={(e) => { e.stopPropagation(); deleteCustomPreset(blueprint.id); }} className="text-theme-muted hover:text-red-500 p-1.5 rounded-lg bg-theme-bg/50 hover:bg-red-500/10 transition-colors w-min mb-4 self-end" title="Delete Preset">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  <Accordion title={t("blueprints.settingsChanged", "Settings Changed")} icon={Info}>
                    <ul className="space-y-1 text-xs">
                      {(blueprint.updates.flat 
                        ? Object.entries(blueprint.updates.flat) 
                        : Object.entries(blueprint.updates.nested || blueprint.updates).flatMap(([section, fields]) => 
                            typeof fields === 'object' && fields !== null ? Object.entries(fields).map(([k, v]) => [`${section}.${k}`, v]) : [[section, fields]]
                          )
                      ).map(([key, val], idx) => (
                        <li key={`${key}-${idx}`} className="flex flex-col border-b border-theme/10 pb-1 last:border-0 last:pb-0">
                          <span className="text-theme-muted truncate" title={displayNames[key] || key}>{displayNames[key] || key}</span>
                          <span className="text-theme-primary font-mono text-right">{String(val)}</span>
                        </li>
                      ))}
                    </ul>
                  </Accordion>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => handleLoadBlueprintInBuilder(blueprint)} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-theme-bg hover:bg-theme-hover border border-theme rounded-lg font-medium transition-all text-theme-text">
                      <Sliders className="w-4 h-4" />
                      <span>{t("blueprints.loadInBuilder", "Load in Builder")}</span>
                    </button>
                    <button onClick={() => handleApplyBlueprint(blueprint)} disabled={applyingId !== null} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary border border-theme-primary/30 rounded-lg font-medium transition-all disabled:opacity-50">
                      {isApplying ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                      <span>{isApplying ? t("blueprints.applying") : t("blueprints.apply")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "builder" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

            {/* Left Column: Layers */}
            <div className="xl:col-span-3 space-y-4">
              <div className="bg-theme-bg/50 border border-theme rounded-xl p-4 shadow-sm h-full max-h-[800px] overflow-y-auto custom-scrollbar">
                <h3 className="font-bold text-theme-text border-b border-theme pb-3 mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-theme-primary" /> Layers
                </h3>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wider mb-2">Global</h4>
                    <LayerItem id="Global" label="Global Settings" icon={Settings} active={selectedLayer === "Global"} onSelect={setSelectedLayer} showToggle={false} />
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wider mb-2">{previewType} Overlays</h4>

                    {previewType === "Poster" && (
                      <>
                        <LayerItem id="Poster.Border" label="Border" icon={Square} active={selectedLayer === "Poster.Border"} onSelect={setSelectedLayer} enabled={builderState.Poster.AddBorder} onToggle={(v) => updateBuilder("Poster", "AddBorder", v)} />
                        <LayerItem id="Poster.Overlay" label="Overlay" icon={Layers} active={selectedLayer === "Poster.Overlay"} onSelect={setSelectedLayer} enabled={builderState.Poster.AddOverlay} onToggle={(v) => updateBuilder("Poster", "AddOverlay", v)} />
                        <LayerItem id="Poster.Text" label="Text / Logo" icon={Type} active={selectedLayer === "Poster.Text"} onSelect={setSelectedLayer} enabled={builderState.Poster.AddText} onToggle={(v) => updateBuilder("Poster", "AddText", v)} />
                        <LayerItem id="Poster.Resolution" label="Resolution Overlays" icon={Image} active={selectedLayer === "Poster.Resolution"} onSelect={setSelectedLayer} enabled={builderState.Poster.UseResolutionOverlays} onToggle={(v) => updateBuilder("Poster", "UseResolutionOverlays", v)} />
                      </>
                    )}

                    {previewType === "Season" && (
                      <>
                        <LayerItem id="Season.Border" label="Border" icon={Square} active={selectedLayer === "Season.Border"} onSelect={setSelectedLayer} enabled={builderState.Season.AddBorder} onToggle={(v) => updateBuilder("Season", "AddBorder", v)} />
                        <LayerItem id="Season.Overlay" label="Overlay" icon={Layers} active={selectedLayer === "Season.Overlay"} onSelect={setSelectedLayer} enabled={builderState.Season.AddOverlay} onToggle={(v) => updateBuilder("Season", "AddOverlay", v)} />
                        <LayerItem id="Season.Text" label="Text / Logo" icon={Type} active={selectedLayer === "Season.Text"} onSelect={setSelectedLayer} enabled={builderState.Season.AddText} onToggle={(v) => updateBuilder("Season", "AddText", v)} />
                        <LayerItem id="SeasonTitle" label="Show Title" icon={Type} active={selectedLayer === "SeasonTitle"} onSelect={setSelectedLayer} enabled={builderState.SeasonTitle.ShowTitle} onToggle={(v) => updateBuilder("SeasonTitle", "ShowTitle", v)} />
                      </>
                    )}

                    {previewType === "Background" && (
                      <>
                        <LayerItem id="Background.Border" label="Border" icon={Square} active={selectedLayer === "Background.Border"} onSelect={setSelectedLayer} enabled={builderState.Background.AddBorder} onToggle={(v) => updateBuilder("Background", "AddBorder", v)} />
                        <LayerItem id="Background.Text" label="Text / Logo" icon={Type} active={selectedLayer === "Background.Text"} onSelect={setSelectedLayer} enabled={builderState.Background.AddText} onToggle={(v) => updateBuilder("Background", "AddText", v)} />
                        <LayerItem id="Background.Overlay" label="Overlay" icon={Layers} active={selectedLayer === "Background.Overlay"} onSelect={setSelectedLayer} enabled={builderState.Background.AddOverlay} onToggle={(v) => updateBuilder("Background", "AddOverlay", v)} />
                        <LayerItem id="Background.Resolution" label="Resolution Overlays" icon={Image} active={selectedLayer === "Background.Resolution"} onSelect={setSelectedLayer} enabled={builderState.Background.UseResolutionOverlays} onToggle={(v) => updateBuilder("Background", "UseResolutionOverlays", v)} />
                      </>
                    )}

                    {previewType === "TitleCard" && (
                      <>
                        <LayerItem id="TitleCard.Border" label="Border" icon={Square} active={selectedLayer === "TitleCard.Border"} onSelect={setSelectedLayer} enabled={builderState.TitleCard.AddBorder} onToggle={(v) => updateBuilder("TitleCard", "AddBorder", v)} />
                        <LayerItem id="TitleCard.Overlay" label="Overlay" icon={Layers} active={selectedLayer === "TitleCard.Overlay"} onSelect={setSelectedLayer} enabled={builderState.TitleCard.AddOverlay} onToggle={(v) => updateBuilder("TitleCard", "AddOverlay", v)} />
                        <LayerItem id="TitleCardEPTitle" label="Episode Title" icon={Type} active={selectedLayer === "TitleCardEPTitle"} onSelect={setSelectedLayer} enabled={builderState.TitleCardEPTitle.AddEPTitleText} onToggle={(v) => updateBuilder("TitleCardEPTitle", "AddEPTitleText", v)} />
                        <LayerItem id="TitleCardEPText" label="SxxExx Text" icon={Type} active={selectedLayer === "TitleCardEPText"} onSelect={setSelectedLayer} enabled={builderState.TitleCardEPText.AddEPText} onToggle={(v) => updateBuilder("TitleCardEPText", "AddEPText", v)} />
                        <LayerItem id="TitleCard.Resolution" label="Resolution Overlays" icon={Image} active={selectedLayer === "TitleCard.Resolution"} onSelect={setSelectedLayer} enabled={builderState.TitleCard.UseResolutionOverlays} onToggle={(v) => updateBuilder("TitleCard", "UseResolutionOverlays", v)} />
                      </>
                    )}

                    {previewType === "Collection" && (
                      <>
                        <LayerItem id="Collection.Border" label="Border" icon={Square} active={selectedLayer === "Collection.Border"} onSelect={setSelectedLayer} enabled={builderState.Collection.AddBorder} onToggle={(v) => updateBuilder("Collection", "AddBorder", v)} />
                        <LayerItem id="Collection.Overlay" label="Overlay" icon={Layers} active={selectedLayer === "Collection.Overlay"} onSelect={setSelectedLayer} enabled={builderState.Collection.AddOverlay} onToggle={(v) => updateBuilder("Collection", "AddOverlay", v)} />
                        <LayerItem id="Collection.Text" label="Text / Logo" icon={Type} active={selectedLayer === "Collection.Text"} onSelect={setSelectedLayer} enabled={builderState.Collection.AddText} onToggle={(v) => updateBuilder("Collection", "AddText", v)} />
                        <LayerItem id="CollectionTitle" label="Collection Title" icon={Type} active={selectedLayer === "CollectionTitle"} onSelect={setSelectedLayer} enabled={builderState.CollectionTitle.AddCollectionTitle} onToggle={(v) => updateBuilder("CollectionTitle", "AddCollectionTitle", v)} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Center Column: Canvas */}
            <div className="xl:col-span-6 flex flex-col h-full space-y-4">
              <div className="bg-[#121212] rounded-xl border border-theme p-4 flex-grow flex flex-col shadow-inner relative overflow-hidden" style={{ backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>

                {/* Header Dropdown */}
                <div className="flex justify-between items-center mb-4 z-10">
                  <div className="flex gap-1 bg-black/60 backdrop-blur-md p-1 rounded-lg border border-theme/50 shadow-lg">
                    {["Poster", "Season", "Background", "TitleCard"].map((t) => (
                       <button key={t} onClick={() => { setPreviewType(t); setSelectedLayer(null); }} className={`px-4 py-1.5 text-xs lg:text-sm font-medium rounded-md transition-colors ${previewType === t ? 'bg-theme-primary text-white shadow-sm' : 'text-theme-muted hover:text-theme-text hover:bg-white/5'}`}>{t}</button>
                    ))}
                  </div>
                  <div className="flex gap-2 z-10">
                    {customPreviewImage ? (
                      <button onClick={resetCustomPreview} className="p-2 text-theme-muted hover:text-white bg-black/60 backdrop-blur-md border border-theme/50 rounded-lg transition-colors shadow-lg" title="Reset Sample Image">
                          <RotateCcw className="w-4 h-4" />
                      </button>
                    ) : (
                      <label className="p-2 text-theme-primary hover:text-theme-primary/80 bg-theme-primary/10 hover:bg-theme-primary/20 backdrop-blur-md border border-theme-primary/30 rounded-lg cursor-pointer transition-colors shadow-lg" title="Upload Sample Image">
                          <ImagePlus className="w-4 h-4" />
                          <input type="file" accept="image/*" onChange={handleCustomPreview} className="hidden" />
                      </label>
                    )}
                  </div>
                </div>

                {/* CSS Visual Preview Container */}
                <div className="w-full flex-grow flex items-center justify-center p-4 min-h-[400px] z-10">
                  <div className={`relative overflow-hidden shadow-2xl transition-all duration-300 ${!customPreviewImage ? 'bg-black' : 'bg-black'} ${
                    previewType === 'Poster' || previewType === 'Season' || previewType === 'Collection' ? 'w-2/3 aspect-[2/3] rounded-sm' :
                    previewType === 'Background' || previewType === 'TitleCard' ? 'w-full aspect-[16/9] rounded-sm' : ''
                  }`} style={{ containerType: 'size' }}>
                    {/* Base Image */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <img src={getSampleImage()} className="w-full h-full object-cover" alt="Preview Base" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                      <div className="hidden flex-col items-center opacity-30 mix-blend-overlay">
                        <Image className="w-16 h-16 mb-2" />
                        <span className="font-bold text-2xl tracking-widest uppercase">{previewType}</span>
                      </div>
                    </div>

                    {/* Dynamic Overlays */}
                    {builderState.ImageProcessing && (
                      <>
                        {/* BORDERS */}
                        {(previewType === 'Poster' && builderState.Poster.AddBorder) ||
                         (previewType === 'Season' && builderState.Season.AddBorder) ||
                         (previewType === 'Background' && builderState.Background.AddBorder) ||
                         (previewType === 'Collection' && builderState.Collection.AddBorder) ||
                         (previewType === 'TitleCard' && builderState.TitleCard.AddBorder) ? (
                          <div className={`absolute inset-0 z-10 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] rounded-sm pointer-events-none transition-all ${selectedLayer?.endsWith('.Border') ? 'ring-2 ring-theme-primary' : ''}`} style={{ ...previewStyles.border, margin: previewStyles.border.borderWidth }}></div>
                        ) : null}

                        {/* TEXT / LOGO */}
                        {((previewType === 'Poster' && builderState.Poster.AddText) ||
                         (previewType === 'Season' && builderState.Season.AddText) ||
                         (previewType === 'Collection' && builderState.Collection.AddText) ||
                         (previewType === 'Background' && builderState.Background.AddText)) && (
                          <div className={`z-20 pointer-events-none transition-all ${selectedLayer?.endsWith('.Text') ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`} style={{ ...getBoundingBoxStyle(builderState[previewType]), ...previewStyles.text }}>
                            {builderState.Global.UseClearlogo && previewType !== 'Season' ? (
                               <img
                                 src={sampleLogoUrl}
                                 alt="Sample Logo"
                                 referrerPolicy="no-referrer"
                                 className="w-full h-full object-contain drop-shadow-2xl transition-all"
                                 style={{
                                    filter: builderState.Global.FlatWhiteLogo ? 'brightness(0) invert(1) drop-shadow(0px 4px 10px rgba(0,0,0,0.8))' : 'drop-shadow(0px 4px 10px rgba(0,0,0,0.8))'
                                 }}
                               />
                            ) : builderState.Global.UseClearart && previewType !== 'Season' ? (
                               <img
                                 src={sampleArtUrl}
                                 alt="Sample Art"
                                 referrerPolicy="no-referrer"
                                 className="w-full h-full object-contain drop-shadow-2xl transition-all"
                               />
                            ) : (
                               <div className="font-bold tracking-widest text-center" style={{ ...getScalingStyle(builderState[previewType], builderState[previewType].SampleText), color: previewStyles.text.color, WebkitTextStroke: previewStyles.text.WebkitTextStroke }}>{builderState[previewType].SampleText}</div>
                            )}
                          </div>
                        )}

                        {/* SEASON SPECIFIC TEXT */}
                        {previewType === 'Season' && (
                          <>
                            {builderState.SeasonTitle.ShowTitle && (
                               <div className={`z-20 pointer-events-none transition-all ${selectedLayer === 'SeasonTitle' ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`} style={{ ...getBoundingBoxStyle(builderState.SeasonTitle), ...seasonTitleStyles.text }}>
                                  {builderState.Global.UseClearlogo ? (
                                    <img
                                      src={sampleLogoUrl}
                                      alt="Sample Logo"
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-contain drop-shadow-2xl transition-all"
                                      style={{
                                         filter: builderState.Global.FlatWhiteLogo ? 'brightness(0) invert(1) drop-shadow(0px 4px 10px rgba(0,0,0,0.8))' : 'drop-shadow(0px 4px 10px rgba(0,0,0,0.8))'
                                      }}
                                    />
                                  ) : builderState.Global.UseClearart ? (
                                    <img
                                      src={sampleArtUrl}
                                      alt="Sample Art"
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-contain drop-shadow-2xl transition-all"
                                    />
                                  ) : (
                                    <div className="font-bold tracking-wider text-center" style={{ ...getScalingStyle(builderState.SeasonTitle, builderState.SeasonTitle.SampleText) }}>{builderState.SeasonTitle.SampleText}</div>
                                  )}
                               </div>
                            )}
                          </>
                        )}

                        {/* TITLE CARD TEXT */}
                        {previewType === 'TitleCard' && (
                          <>
                            {builderState.TitleCardEPText.AddEPText && (
                               <div className={`z-20 pointer-events-none transition-all ${selectedLayer === 'TitleCardEPText' ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`} style={{ ...getBoundingBoxStyle(builderState.TitleCardEPText), ...tcEpStyles.text }}>
                                  <div className="font-medium text-center" style={{ ...getScalingStyle(builderState.TitleCardEPText, `${builderState.TitleCardEPText.SeasonTCText} 1 • ${builderState.TitleCardEPText.EpisodeTCText} 1`) }}>{builderState.TitleCardEPText.SeasonTCText} 1 • {builderState.TitleCardEPText.EpisodeTCText} 1</div>
                               </div>
                            )}
                            {builderState.TitleCardEPTitle.AddEPTitleText && (
                               <div className={`z-20 pointer-events-none transition-all ${selectedLayer === 'TitleCardEPTitle' ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`} style={{ ...getBoundingBoxStyle(builderState.TitleCardEPTitle), ...tcTitleStyles.text }}>
                                  <div className="font-bold tracking-wide text-center" style={{ ...getScalingStyle(builderState.TitleCardEPTitle, builderState.TitleCardEPTitle.SampleText) }}>{builderState.TitleCardEPTitle.SampleText}</div>
                               </div>
                            )}
                          </>
                        )}

                        {/* COLLECTION SPECIFIC TEXT */}
                        {previewType === 'Collection' && builderState.Collection.AddText && (
                          <>
                            {builderState.CollectionTitle.AddCollectionTitle && (
                               <div className={`z-20 pointer-events-none transition-all ${selectedLayer === 'CollectionTitle' ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`} style={{ ...getBoundingBoxStyle(builderState.CollectionTitle), ...collectionTitleStyles.text }}>
                                  <div className="font-bold tracking-wider text-center" style={{ ...getScalingStyle(builderState.CollectionTitle, builderState.CollectionTitle.CollectionTitle) }}>{builderState.CollectionTitle.CollectionTitle}</div>
                               </div>
                            )}
                          </>
                        )}

                        {/* CUSTOM OVERLAY */}
                        {((previewType === 'Poster' && builderState.Poster.AddOverlay) ||
                         (previewType === 'Season' && builderState.Season.AddOverlay) ||
                         (previewType === 'Background' && builderState.Background.AddOverlay) ||
                         (previewType === 'TitleCard' && builderState.TitleCard.AddOverlay)) && builderState[previewType]?.overlayfile && (
                          <div className={`absolute inset-0 pointer-events-none z-[15] overflow-hidden transition-all ${selectedLayer?.endsWith('.Overlay') ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`}>
                            <img 
                              src={`${API_URL}/overlayfiles/preview/${builderState[previewType].overlayfile}`} 
                              alt="Overlay" 
                              className="w-full h-full object-fill drop-shadow-2xl" 
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                          </div>
                        )}

                        {/* RESOLUTION OVERLAYS */}
                        {((previewType === 'Poster' && builderState.Poster.UseResolutionOverlays) ||
                         (previewType === 'Season' && builderState.Season.UseResolutionOverlays) ||
                         (previewType === 'Background' && builderState.Background.UseResolutionOverlays) ||
                         (previewType === 'TitleCard' && builderState.TitleCard.UseResolutionOverlays)) && (
                          <div className={`absolute inset-0 pointer-events-none z-[25] overflow-hidden transition-all ${selectedLayer?.endsWith('.Resolution') ? 'border-2 border-dashed border-red-500/50 bg-red-500/5 ring-2 ring-theme-primary ring-inset' : ''}`}>
                            <img 
                              src={`${API_URL}/overlayfiles/preview/${previewType === 'Background' ? builderState.ResolutionOverlays.Background4k : previewType === 'TitleCard' ? builderState.ResolutionOverlays.TC4k : builderState.ResolutionOverlays.poster4k}`} 
                              alt="Resolution Overlay" 
                              className="w-full h-full object-fill drop-shadow-2xl" 
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                          </div>
                        )}
                        </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Properties */}
            <div className="xl:col-span-3 space-y-4">
              <div className="bg-theme-bg/50 border border-theme rounded-xl p-4 shadow-sm h-full max-h-[800px] overflow-y-auto custom-scrollbar flex flex-col">
                <h3 className="font-bold text-theme-text border-b border-theme pb-3 mb-4 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-theme-primary" /> Properties
                </h3>

                <div className="flex-grow space-y-4">
                  {!selectedLayer && (
                    <div className="flex flex-col items-center justify-center h-40 text-theme-muted opacity-50">
                      <MousePointerClick className="w-8 h-8 mb-2" />
                      <p className="text-sm">Select a layer to edit</p>
                    </div>
                  )}

                  {selectedLayer === "Global" && (
                    <div className="space-y-4">
                      <Toggle label={t("blueprints.builder.enableProcessing", "Enable Processing")} checked={builderState.ImageProcessing} onChange={(v) => updateBuilder(null, "ImageProcessing", v)} />
                      <div className="border-t border-theme/50 my-2 pt-2"></div>
                      <Toggle label={t("blueprints.builder.useClearlogo", "Use Clearlogo")} checked={builderState.Global.UseClearlogo} onChange={(v) => updateBuilder("Global", "UseClearlogo", v)} />
                      <Toggle label={t("blueprints.builder.useClearart", "Use Clearart")} checked={builderState.Global.UseClearart} onChange={(v) => updateBuilder("Global", "UseClearart", v)} />
                      <Toggle label={t("blueprints.builder.flatWhiteLogo", "Flat White Logo")} checked={builderState.Global.FlatWhiteLogo} onChange={(v) => updateBuilder("Global", "FlatWhiteLogo", v)} />
                      <div className="border-t border-theme/50 my-2 pt-2"></div>
                      <Toggle label={t("blueprints.builder.onlyTextless", "Textless Artwork")} checked={builderState.Global.TextlessOnly} onChange={(v) => updateBuilder("Global", "TextlessOnly", v)} />
                    </div>
                  )}

                  {selectedLayer?.endsWith(".Border") && (
                    <div className="space-y-4">
                      <ColorInput label="Border Color" value={builderState[selectedLayer.split('.')[0]].bordercolor} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "bordercolor", v)} />
                      <NumberInput label="Border Width" value={builderState[selectedLayer.split('.')[0]].borderwidth} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "borderwidth", v)} />
                    </div>
                  )}

                  {selectedLayer?.endsWith(".Resolution") && (
                    <div className="space-y-4">
                      {previewType === 'Poster' || previewType === 'Season' || previewType === 'Collection' ? (
                         <>
                           <SelectInput label="4K Overlay File" value={builderState.ResolutionOverlays.poster4k} onChange={(v) => updateBuilder("ResolutionOverlays", "poster4k", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="1080p Overlay File" value={builderState.ResolutionOverlays.Poster1080p} onChange={(v) => updateBuilder("ResolutionOverlays", "Poster1080p", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K DoVi Overlay File" value={builderState.ResolutionOverlays["4K DoVi Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K DoVi Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K HDR10 Overlay File" value={builderState.ResolutionOverlays["4K HDR10 Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K HDR10 Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K DoVi+HDR10 Overlay File" value={builderState.ResolutionOverlays["4K DoVi+HDR10 Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K DoVi+HDR10 Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                         </>
                      ) : previewType === 'Background' ? (
                         <>
                           <SelectInput label="4K Overlay File" value={builderState.ResolutionOverlays.Background4k} onChange={(v) => updateBuilder("ResolutionOverlays", "Background4k", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="1080p Overlay File" value={builderState.ResolutionOverlays.Background1080p} onChange={(v) => updateBuilder("ResolutionOverlays", "Background1080p", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K DoVi Overlay File" value={builderState.ResolutionOverlays["4K DoVi Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K DoVi Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K HDR10 Overlay File" value={builderState.ResolutionOverlays["4K HDR10 Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K HDR10 Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K DoVi+HDR10 Overlay File" value={builderState.ResolutionOverlays["4K DoVi+HDR10 Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K DoVi+HDR10 Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                         </>
                      ) : (
                         <>
                           <SelectInput label="4K Overlay File" value={builderState.ResolutionOverlays.TC4k} onChange={(v) => updateBuilder("ResolutionOverlays", "TC4k", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="1080p Overlay File" value={builderState.ResolutionOverlays.TC1080p} onChange={(v) => updateBuilder("ResolutionOverlays", "TC1080p", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K DoVi Overlay File" value={builderState.ResolutionOverlays["4K DoVi Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K DoVi Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                           <SelectInput label="4K HDR10 Overlay File" value={builderState.ResolutionOverlays["4K HDR10 Overlay File"]} onChange={(v) => updateBuilder("ResolutionOverlays", "4K HDR10 Overlay File", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                         </>
                      )}
                    </div>
                  )}

                  {selectedLayer?.endsWith(".Overlay") && (
                    <div className="space-y-4">
                      <SelectInput label="Overlay File" value={builderState[selectedLayer.split('.')[0]].overlayfile} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "overlayfile", v)} options={[{label: "None", value: ""}, ...overlayFiles]} />
                    </div>
                  )}

                  {selectedLayer === "TitleCard.Border" && (
                    <div className="space-y-4 border-t border-theme/50 pt-4">
                      <Toggle label="Use Background as Title Card" checked={builderState.TitleCard.UseBackgroundAsTitleCard} onChange={(v) => updateBuilder("TitleCard", "UseBackgroundAsTitleCard", v)} />
                      <Toggle label="Background Fallback" checked={builderState.TitleCard.BackgroundFallback} onChange={(v) => updateBuilder("TitleCard", "BackgroundFallback", v)} />
                    </div>
                  )}

                  {(selectedLayer?.endsWith(".Text") || selectedLayer === "TitleCardEPTitle" || selectedLayer === "TitleCardEPText" || selectedLayer === "SeasonTitle" || selectedLayer === "CollectionTitle") && (
                    <div className="space-y-4">
                        {selectedLayer === "SeasonTitle" && (
                          <Toggle label="Show Title" checked={builderState.SeasonTitle.ShowTitle} onChange={(v) => updateBuilder("SeasonTitle", "ShowTitle", v)} />
                        )}
                        <Toggle label="All Caps" checked={builderState[selectedLayer.split('.')[0]].fontAllCaps} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "fontAllCaps", v)} />
                        <Toggle label="Enable Stroke" checked={builderState[selectedLayer.split('.')[0]].AddTextStroke} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "AddTextStroke", v)} />

                        <ColorInput label="Text Color" value={builderState[selectedLayer.split('.')[0]].fontcolor} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "fontcolor", v)} />
                        {builderState[selectedLayer.split('.')[0]]?.SampleText !== undefined && (
                          <TextInput label="Sample Text" value={builderState[selectedLayer.split('.')[0]].SampleText} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "SampleText", v)} placeholder="Type sample text here..." />
                        )}
                        {selectedLayer === "TitleCardEPText" && (
                          <>
                            <TextInput label="Season Text" value={builderState.TitleCardEPText.SeasonTCText} onChange={(v) => updateBuilder("TitleCardEPText", "SeasonTCText", v)} />
                            <TextInput label="Episode Text" value={builderState.TitleCardEPText.EpisodeTCText} onChange={(v) => updateBuilder("TitleCardEPText", "EpisodeTCText", v)} />
                          </>
                        )}
                        {builderState[selectedLayer.split('.')[0]].AddTextStroke && (
                          <>
                            <ColorInput label="Stroke Color" value={builderState[selectedLayer.split('.')[0]].strokecolor} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "strokecolor", v)} />
                            <NumberInput label="Stroke Width" value={builderState[selectedLayer.split('.')[0]].strokewidth} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "strokewidth", v)} />
                          </>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          <NumberInput label="Min Point Size" value={builderState[selectedLayer.split('.')[0]].minPointSize} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "minPointSize", parseInt(v))} />
                          <NumberInput label="Max Point Size" value={builderState[selectedLayer.split('.')[0]].maxPointSize} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "maxPointSize", parseInt(v))} />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <NumberInput label="Max Width" value={builderState[selectedLayer.split('.')[0]].MaxWidth} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "MaxWidth", parseInt(v))} />
                          <NumberInput label="Max Height" value={builderState[selectedLayer.split('.')[0]].MaxHeight} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "MaxHeight", parseInt(v))} />
                        </div>

                        <NumberInput label="Line Spacing" value={builderState[selectedLayer.split('.')[0]].lineSpacing} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "lineSpacing", parseInt(v))} />

                        <SelectInput
                          label="Text Gravity"
                          value={builderState[selectedLayer.split('.')[0]].TextGravity}
                          onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "TextGravity", v)}
                          options={[
                            {label: "North", value: "north"}, {label: "South", value: "south"}, {label: "Center", value: "center"},
                            {label: "East", value: "east"}, {label: "West", value: "west"}, {label: "NorthWest", value: "northwest"},
                            {label: "NorthEast", value: "northeast"}, {label: "SouthWest", value: "southwest"}, {label: "SouthEast", value: "southeast"}
                          ]}
                        />
                        <TextInput label="Text Offset Y" value={builderState[selectedLayer.split('.')[0]].text_offset} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "text_offset", v)} placeholder="+400" />

                        {selectedLayer === "TitleCardEPText" && (
                          <div className="grid grid-cols-2 gap-4 border-t border-theme/50 pt-4 mt-4">
                             <TextInput label="Season Prefix" value={builderState.TitleCardEPText.SeasonTCText} onChange={(v) => updateBuilder("TitleCardEPText", "SeasonTCText", v)} placeholder="Season" />
                             <TextInput label="Episode Prefix" value={builderState.TitleCardEPText.EpisodeTCText} onChange={(v) => updateBuilder("TitleCardEPText", "EpisodeTCText", v)} placeholder="Episode" />
                          </div>
                        )}

                        {selectedLayer === "Season.Text" && (
                          <div className="space-y-4 border-t border-theme/50 pt-4 mt-4">
                             <Toggle label="Show Fallback Text" checked={builderState.Season.ShowFallback} onChange={(v) => updateBuilder("Season", "ShowFallback", v)} />
                             <Toggle label="Override Season Name" checked={builderState.Season.OverrideSeasonName} onChange={(v) => updateBuilder("Season", "OverrideSeasonName", v)} />
                             {builderState.Season.OverrideSeasonName && (
                               <div className="grid grid-cols-2 gap-4">
                                  <TextInput label="Season Override" value={builderState.Season.SeasonOverrideText} onChange={(v) => updateBuilder("Season", "SeasonOverrideText", v)} placeholder="Season" />
                                  <TextInput label="Special Season Override" value={builderState.Season.SpecialSeasonOverrideText} onChange={(v) => updateBuilder("Season", "SpecialSeasonOverrideText", v)} placeholder="Specials" />
                               </div>
                             )}
                          </div>
                        )}

                        {selectedLayer === "CollectionTitle" && (
                          <div className="space-y-4 border-t border-theme/50 pt-4 mt-4">
                             <TextInput label="Collection Title Prefix" value={builderState.CollectionTitle.CollectionTitle} onChange={(v) => updateBuilder("CollectionTitle", "CollectionTitle", v)} placeholder="Collection" />
                          </div>
                        )}
                    </div>
                  )}



                  {selectedLayer?.endsWith(".Resolution") && (
                    <div className="space-y-4">
                      <p className="text-sm text-theme-muted">Toggle resolution badges for 4K / 1080p etc.</p>
                      <Toggle label="Resolution Overlays" checked={builderState[selectedLayer.split('.')[0]].UseResolutionOverlays} onChange={(v) => updateBuilder(selectedLayer.split('.')[0], "UseResolutionOverlays", v)} />
                    </div>
                  )}
                </div>

                {/* Generate Button Fixed at Bottom of Panel */}
                <div className="mt-8 pt-4 border-t border-theme">
                  <button
                    onClick={handleSavePresetClick}
                    className="w-full flex justify-center items-center gap-2 bg-theme-primary text-white px-6 py-3 rounded-lg font-medium shadow-lg hover:bg-theme-primary/90 hover:shadow-theme-primary/30 transition-all disabled:opacity-50"
                  >
                    <Wand2 className="w-5 h-5" />
                    {t("blueprints.builder.savePreset", "Save as Preset")}
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Save Preset Modal */}
      {savePresetModalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-theme-card border border-theme rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-theme bg-theme-bg/50 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
                {savePresetModalState.isImport ? <Upload className="w-6 h-6 text-theme-primary" /> : <Save className="w-6 h-6 text-theme-primary" />}
                {savePresetModalState.isImport ? "Import & Save Custom Preset" : "Save Custom Preset"}
              </h2>
              <button onClick={() => setSavePresetModalState(null)} className="text-theme-muted hover:text-theme-text"><X className="w-6 h-6" /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-theme-muted">Preset Title</label>
                  <input type="text" id="presetTitleInput" placeholder="e.g. Clean Poster Layout" className="bg-theme-bg border border-theme rounded-lg px-4 py-2 text-theme-text focus:border-theme-primary outline-none transition-colors" autoFocus />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-theme-muted">Description</label>
                  <textarea id="presetDescInput" placeholder="Describe what this preset does..." className="bg-theme-bg border border-theme rounded-lg px-4 py-2 text-theme-text focus:border-theme-primary outline-none transition-colors resize-none h-24" />
                </div>
              </div>

              <div className="bg-theme-bg/50 rounded-lg border border-theme p-4">
                <div className="flex justify-between items-center mb-4 border-b border-theme pb-2">
                  <h3 className="font-semibold text-theme-text">Included Settings</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-theme-muted">Show Only Modified</span>
                    <button 
                      onClick={() => setShowOnlyModified(!showOnlyModified)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${showOnlyModified ? 'bg-theme-primary' : 'bg-theme-bg border border-theme'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${showOnlyModified ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
                <ul className="space-y-2 text-xs">
                  {savePresetModalState.updates && Object.entries(savePresetModalState.updates).map(([section, fields]) => {
                    const defaultUpdates = generateBlueprintUpdates(DEFAULT_BUILDER_STATE);
                    
                    const fieldsToRender = Object.entries(fields).filter(([key, val]) => {
                        const isChanged = String(val) !== String(defaultUpdates[section]?.[key]);
                        if (showOnlyModified) return isChanged;
                        return true;
                    });
                    
                    if (fieldsToRender.length === 0) return null;
                    
                    return (
                    <li key={section} className="flex flex-col border-b border-theme/10 pb-2 last:border-0 last:pb-0">
                      <span className="text-theme-primary font-semibold mb-1">{section}</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-2 border-l-2 border-theme-primary/30">
                        {fieldsToRender.map(([key, val]) => {
                          const isChanged = String(val) !== String(defaultUpdates[section]?.[key]);
                          return (
                          <div key={key} className={`flex justify-between items-center gap-2 px-1.5 py-0.5 rounded ${isChanged ? 'bg-green-500/10 border border-green-500/30' : ''}`}>
                            <span className={`truncate ${isChanged ? 'text-green-500 font-bold' : 'text-theme-muted'}`} title={key}>
                                {key} {isChanged && <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500 text-white" title="Changed from default">MODIFIED</span>}
                            </span>
                            <span className={`font-mono px-1.5 rounded truncate max-w-[100px] ${isChanged ? 'text-green-500 font-bold bg-green-500/20' : 'text-theme-text bg-theme-bg'}`} title={String(val)}>{String(val)}</span>
                          </div>
                        )})}
                      </div>
                    </li>
                  )})}
                </ul>
              </div>
            </div>

            <div className="p-6 border-t border-theme bg-theme-bg/50 flex justify-end gap-3">
              <button
                onClick={() => setSavePresetModalState(null)}
                className="px-6 py-2.5 rounded-lg font-medium text-theme-text bg-theme-bg border border-theme hover:bg-theme-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const title = document.getElementById('presetTitleInput').value;
                  const desc = document.getElementById('presetDescInput').value;
                  if (title) saveCustomPreset(title, desc);
                }}
                className="px-6 py-2.5 rounded-lg font-medium text-white bg-theme-primary hover:bg-theme-primary/90 transition-colors shadow-lg flex items-center gap-2"
              >
                <Save className="w-5 h-5" /> Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirmation Modal */}
      {importBlueprintState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-theme-card border border-theme rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-theme bg-theme-bg/50">
              <h2 className="text-2xl font-bold text-theme-text flex items-center gap-2">
                <AlertCircle className="w-6 h-6 text-theme-primary" />
                {t("blueprints.importConfirmTitle", "Confirm Blueprint Import")}
              </h2>
              <p className="text-theme-muted mt-2">
                {t("blueprints.importConfirmDesc", "The following settings will be modified by this blueprint. Do you want to proceed?")}
              </p>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-4">
              <div className="bg-theme-bg/50 rounded-lg border border-theme p-4">
                <h3 className="font-semibold text-theme-text mb-4 border-b border-theme pb-2">Proposed Changes</h3>
                <ul className="space-y-2 text-sm">
                  {Object.entries(importBlueprintState.updates?.flat || {}).map(([key, val]) => (
                    <li key={key} className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-theme/10 pb-2 last:border-0 last:pb-0">
                      <span className="text-theme-muted truncate mr-4" title={displayNames[key] || key}>{displayNames[key] || key}</span>
                      <span className="text-theme-primary font-mono bg-theme-primary/10 px-2 py-0.5 rounded shrink-0">{String(val)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-6 border-t border-theme bg-theme-bg/50 flex justify-end gap-3">
              <button
                onClick={() => setImportBlueprintState(null)}
                disabled={isImporting}
                className="px-6 py-2.5 rounded-lg font-medium text-theme-text bg-theme-bg border border-theme hover:bg-theme-hover transition-colors"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                onClick={confirmImport}
                disabled={isImporting}
                className="flex items-center gap-2 bg-theme-primary text-white px-6 py-2.5 rounded-lg font-medium shadow-lg hover:bg-theme-primary/90 transition-colors disabled:opacity-50"
              >
                {isImporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {isImporting ? t("blueprints.importing", "Importing...") : t("blueprints.importConfirmBtn", "Confirm Import")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
