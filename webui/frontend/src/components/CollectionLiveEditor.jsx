import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import AssetSearchModal from './AssetSearchModal';
import { X, Search, Save, Loader2, ChevronDown, ChevronUp, Upload, Type, Image as ImageIcon, LayoutTemplate, Palette, Square , Layers, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import { useToast } from "../context/ToastContext";

// Simple Accordion Component
const Accordion = ({ title, icon: Icon, isOpen, onToggle, children }) => {
    return (
        <div className="border border-theme rounded-lg mb-2 overflow-hidden bg-theme-bg/50">
            <button 
                onClick={onToggle}
                className="w-full flex items-center justify-between p-3 bg-theme-card hover:bg-theme-hover transition-colors"
            >
                <div className="flex items-center gap-2 text-sm font-semibold text-theme-text uppercase tracking-wider">
                    {Icon && <Icon className="w-4 h-4 text-theme-primary" />}
                    {title}
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-theme-muted" /> : <ChevronDown className="w-4 h-4 text-theme-muted" />}
            </button>
            {isOpen && (
                <div className="p-4 border-t border-theme">
                    {children}
                </div>
            )}
        </div>
    );
};

const CollectionLiveEditor = ({ isOpen, onClose, collection, libraryName, activeServer }) => {
    const { t } = useTranslation();
    const { showSuccess, showError, showInfo } = useToast();

    const [presets, setPresets] = useState([]);
    const [presetName, setPresetName] = useState("");
    
    // Editor State
    const [activeAccordion, setActiveAccordion] = useState('background');
    const [manualRefresh, setManualRefresh] = useState(0);
    const [bgSearchOpen, setBgSearchOpen] = useState(false);
    const [overlayImage, setOverlayImage] = useState(null);
    
    // Background State
    const [bgType, setBgType] = useState('texture'); // 'color', 'texture'
    const [bgColor, setBgColor] = useState('#202020');
    const [bgImage, setBgImage] = useState(collection?.posterUrl || null);
    
    // Effects State
    const [bgEffect, setBgEffect] = useState('none');
    const [effectOpacity, setEffectOpacity] = useState(50);
    const [effectBlend, setEffectBlend] = useState('normal'); // 'normal', 'overlay', 'screen', 'multiply'
    const [waveCount, setWaveCount] = useState(2);
    const [waveDirection, setWaveDirection] = useState('horizontal'); // 'horizontal', 'vertical', 'diagonal-up', 'diagonal-down'
    const [waveAmplitude, setWaveAmplitude] = useState(50); // 0 (straight) to 100 (curvy)
    const [waveOffsetX, setWaveOffsetX] = useState(0);
    const [waveOffsetY, setWaveOffsetY] = useState(0);
    const [waveSeed, setWaveSeed] = useState(0);
    
    // Logo State (Studio)
    const [logoSrc, setLogoSrc] = useState(null);
    const [logoWhitewash, setLogoWhitewash] = useState(false);
    const [logoWidth, setLogoWidth] = useState(800);
    const [logoOffset, setLogoOffset] = useState(-300);

    // X Offsets
    const [logoOffsetX, setLogoOffsetX] = useState(0);
    const [mediaLogoOffsetX, setMediaLogoOffsetX] = useState(0);
    const [textOffsetX, setTextOffsetX] = useState(0);
    const [subTextOffsetX, setSubTextOffsetX] = useState(0);
    const [uploadToServer, setUploadToServer] = useState(false);

    // Drag & Drop State
    const [dragTarget, setDragTarget] = useState(null);
    const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 });
    const [dragStartOffsets, setDragStartOffsets] = useState({ x: 0, y: 0 });

    

    // Layers State
    const defaultLayers = [
        { id: 'background', label: 'Background & Effects' },
        { id: 'overlay', label: 'Local Overlay' },
        { id: 'studioLogo', label: 'Studio Logo' },
        { id: 'mediaLogo', label: 'Media Logo' },
        { id: 'text', label: 'Main Text' },
        { id: 'subText', label: 'Sub Text' },
        { id: 'border', label: 'Border' }
    ];
    const [layerOrder, setLayerOrder] = useState(defaultLayers);

    // Media Logo State
    const [mediaLogoQuery, setMediaLogoQuery] = useState(collection?.title || "");
    const [mediaLogoSearchOpen, setMediaLogoSearchOpen] = useState(false);
    const [mediaLogoResults, setMediaLogoResults] = useState([]);
    const [isSearchingMediaLogos, setIsSearchingMediaLogos] = useState(false);
    const [mediaLogoSrc, setMediaLogoSrc] = useState(null);
    const [mediaLogoWidth, setMediaLogoWidth] = useState(800);
    const [mediaLogoOffset, setMediaLogoOffset] = useState(0);
    const [mediaLogoWhitewash, setMediaLogoWhitewash] = useState(false);
    
    // Text State (Main)
    const [textEnabled, setTextEnabled] = useState(true);
    const [textContent, setTextContent] = useState(collection?.title || "Test Collection");
    const [textFont, setTextFont] = useState('Arial');
    const [textColor, setTextColor] = useState('#FFFFFF');
    const [textSize, setTextSize] = useState(100);
    const [textOffset, setTextOffset] = useState(400);
    const [textUppercase, setTextUppercase] = useState(false);

    // Sub-Text State
    const [subTextEnabled, setSubTextEnabled] = useState(false);
    const [subTextContent, setSubTextContent] = useState("Collection");
    const [subTextFont, setSubTextFont] = useState('Arial');
    const [subTextColor, setSubTextColor] = useState('#FFFFFF');
    const [subTextSize, setSubTextSize] = useState(50);
    const [subTextOffset, setSubTextOffset] = useState(500);
    const [subTextUppercase, setSubTextUppercase] = useState(false);

    // Border State
    const [borderEnabled, setBorderEnabled] = useState(false);
    const [borderColor, setBorderColor] = useState('#FFFFFF');
    const [borderWidth, setBorderWidth] = useState(20);

    // External Resources
    const [searchQuery, setSearchQuery] = useState(collection?.title || "");
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [studioLogos, setStudioLogos] = useState([]);
    const [localOverlays, setLocalOverlays] = useState([]);
    const [localFonts, setLocalFonts] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [config, setConfig] = useState(null);

    // Canvas Preview Ref
    const previewCanvasRef = useRef(null);

    // Data Fetching
    useEffect(() => {
        fetchConfig();
        fetchStudioLogos();
        fetchPresets();
        fetchLocalOverlays();
        fetchLocalFonts();
        if (!collection?.posterUrl) {
            handleSearch(collection?.title);
        }
    }, [collection]);

    const fetchLocalOverlays = async () => {
        try {
            const res = await fetch("/api/overlayfiles");
            const data = await res.json();
            if (data.success && Array.isArray(data.files)) {
                setLocalOverlays(data.files.filter(f => f.name.match(/\.(png|jpg|jpeg|webp)$/i)));
            }
        } catch (e) {
            console.error("Failed to fetch local overlays");
        }
    };

    const fetchLocalFonts = async () => {
        try {
            const res = await fetch("/api/fonts");
            const data = await res.json();
            if (data.success && Array.isArray(data.files)) {
                setLocalFonts(data.files);
                data.files.forEach(font => {
                    const fontName = font.split('.')[0];
                    if (!document.getElementById('font-' + fontName)) {
                        const fontFace = `
                            @font-face {
                                font-family: "${fontName}";
                                src: url("/api/fonts/download/${encodeURIComponent(font)}");
                            }
                        `;
                        const style = document.createElement('style');
                        style.id = 'font-' + fontName;
                        style.innerHTML = fontFace;
                        document.head.appendChild(style);
                        // Trigger redraw when font loads
                        document.fonts.load(`16px "${fontName}"`).then(() => {
                            setLocalFonts(prev => [...prev]);
                        });
                    }
                });
            }
        } catch (e) {
            console.error("Failed to fetch local fonts");
        }
    };

    const fetchPresets = async () => {
        try {
            const res = await fetch("/api/collections/presets");
            const data = await res.json();
            setPresets(data);
        } catch (e) {
            console.error("Failed to fetch presets");
        }
    };

    const handleSavePreset = async () => {
        if (!presetName.trim()) {
            showError("Please enter a name for the preset.");
            return;
        }
        
        const newPreset = {
            id: Date.now().toString(),
            name: presetName.trim(),
            bgType, bgColor, bgEffect, effectOpacity, effectBlend,
            waveCount, waveDirection, waveAmplitude, waveOffsetX, waveOffsetY, waveSeed,
            logoSrc, logoWhitewash, logoWidth, logoOffset, logoOffsetX,
            mediaLogoSrc, mediaLogoWidth, mediaLogoOffset, mediaLogoOffsetX, mediaLogoWhitewash,
            textEnabled, textFont, textColor, textSize, textOffset, textOffsetX, textUppercase,
            subTextEnabled, subTextContent, subTextFont, subTextColor, subTextSize, subTextOffset, subTextOffsetX, subTextUppercase,
            borderEnabled, borderColor, borderWidth,
            overlayImage,
            layerOrder
        };
        
        const updatedPresets = [...presets, newPreset];
        try {
            const res = await fetch("/api/collections/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedPresets)
            });
            const data = await res.json();
            if (data.status === "success") {
                setPresets(updatedPresets);
                setPresetName("");
                showSuccess(`Preset "${newPreset.name}" saved!`);
            } else {
                showError("Failed to save preset.");
            }
        } catch (e) {
            showError("Error saving preset.");
        }
    };

    const handleLoadPreset = (preset) => {
        setBgType(preset.bgType ?? 'texture');
        setBgColor(preset.bgColor ?? '#202020');
        setBgEffect(preset.bgEffect ?? 'none');
        setEffectOpacity(preset.effectOpacity ?? 50);
        setEffectBlend(preset.effectBlend ?? 'normal');
        setWaveCount(preset.waveCount ?? 2);
        setWaveDirection(preset.waveDirection ?? 'horizontal');
        setWaveAmplitude(preset.waveAmplitude ?? 50);
        setWaveOffsetX(preset.waveOffsetX ?? 0);
        setWaveOffsetY(preset.waveOffsetY ?? 0);
        setWaveSeed(preset.waveSeed ?? 0);
        
        setLogoSrc(preset.logoSrc ?? null);
        setLogoWhitewash(preset.logoWhitewash ?? false);
        setLogoWidth(preset.logoWidth ?? 800);
        setLogoOffset(preset.logoOffset ?? -300);
        setLogoOffsetX(preset.logoOffsetX ?? 0);
        
        setMediaLogoSrc(preset.mediaLogoSrc ?? null);
        setMediaLogoWidth(preset.mediaLogoWidth ?? 800);
        setMediaLogoOffset(preset.mediaLogoOffset ?? 0);
        setMediaLogoOffsetX(preset.mediaLogoOffsetX ?? 0);
        setMediaLogoWhitewash(preset.mediaLogoWhitewash ?? false);
        
        setTextEnabled(preset.textEnabled ?? true);
        setTextFont(preset.textFont ?? 'Arial');
        setTextColor(preset.textColor ?? '#FFFFFF');
        setTextSize(preset.textSize ?? 100);
        setTextOffset(preset.textOffset ?? 400);
        setTextOffsetX(preset.textOffsetX ?? 0);
        setTextUppercase(preset.textUppercase ?? false);
        
        setSubTextEnabled(preset.subTextEnabled ?? false);
        setSubTextContent(preset.subTextContent ?? "Collection");
        setSubTextFont(preset.subTextFont ?? 'Arial');
        setSubTextColor(preset.subTextColor ?? '#FFFFFF');
        setSubTextSize(preset.subTextSize ?? 50);
        setSubTextOffset(preset.subTextOffset ?? 500);
        setSubTextOffsetX(preset.subTextOffsetX ?? 0);
        setSubTextUppercase(preset.subTextUppercase ?? false);
        
        setBorderEnabled(preset.borderEnabled ?? false);
        setBorderColor(preset.borderColor ?? '#FFFFFF');
        setBorderWidth(preset.borderWidth ?? 20);
        setOverlayImage(preset.overlayImage ?? null);
        setLayerOrder(preset.layerOrder || defaultLayers);
        
        showSuccess(`Loaded preset "${preset.name}"`);
    };

    const handleDeletePreset = async (presetId) => {
        const updatedPresets = presets.filter(p => p.id !== presetId);
        try {
            const res = await fetch("/api/collections/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedPresets)
            });
            const data = await res.json();
            if (data.status === "success") {
                setPresets(updatedPresets);
                showSuccess("Preset deleted.");
            }
        } catch(e) {
            showError("Error deleting preset.");
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch("/api/config");
            const data = await res.json();
            const cfg = data.config || {};
            setConfig(cfg);
            
            // Sync Defaults from Config
            if (cfg.CollectionPosterOverlayPart) {
                const overlay = cfg.CollectionPosterOverlayPart;
                setTextEnabled(overlay.AddText === "true");
                setTextColor(overlay.fontcolor === 'white' ? '#FFFFFF' : overlay.fontcolor === 'black' ? '#000000' : overlay.fontcolor);
                // Scale settings from 2000x3000 to 1000x1500
                setTextSize(Math.min(parseInt(overlay.maxPointSize || 250) / 2, 300));
                setTextOffset(parseInt((overlay.text_offset || "+300").replace('+', '')) / 2);
                setTextUppercase(overlay.fontAllCaps === "true");
                
                setBorderEnabled(overlay.AddBorder === "true");
                setBorderColor(overlay.bordercolor === 'white' ? '#FFFFFF' : overlay.bordercolor === 'black' ? '#000000' : overlay.bordercolor);
                setBorderWidth(parseInt(overlay.borderwidth || 30) / 2);
            }
            if (cfg.PrerequisitePart?.collectionfont) {
                const fontBase = cfg.PrerequisitePart.collectionfont.split('.')[0];
                setTextFont(fontBase); // Attempt to use base name as font family
            }
        } catch (e) {}
    };

    const fetchStudioLogos = async () => {
        try {
            const res = await fetch("/api/studio-logos");
            const data = await res.json();
            if (data.success) setStudioLogos(data.logos);
        } catch (e) {}
    };

    const handleSearch = async (queryToSearch) => {
        const query = queryToSearch || searchQuery;
        if (!query || !config) return;

        let token = config.ApiPart?.tmdbtoken || config.ApiPart?.TMDBAPIKey || config.TMDBAPIKey || config.tmdbtoken;
        if (!token) {
            showError("Media Logo Search: TMDB Token missing in config.json");
            return;
        }

        setIsSearching(true);
        try {
            const res = await fetch("/api/collections/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, token })
            });
            const data = await res.json();
            if (data.success) setSearchResults(data.results.filter(r => r.poster_path));
        } catch (e) {} finally {
            setIsSearching(false);
        }
    };

    const handleSearchMediaLogos = async (queryToSearch) => {
        const query = queryToSearch || mediaLogoQuery;
        if (!query || !config) return;

        let token = config.ApiPart?.tmdbtoken || config.ApiPart?.TMDBAPIKey || config.TMDBAPIKey || config.tmdbtoken;
        if (!token) {
            showError("Media Logo Search: TMDB Token missing in config.json");
            return;
        }

        setIsSearchingMediaLogos(true);
        try {
            const res = await fetch("/api/media/logos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, token })
            });
            const data = await res.json();
            if (data.success) {
                setMediaLogoResults(data.logos.filter((l) => l.file_path));
            } else {
                setMediaLogoResults([]);
                showError("Media Logo Search: " + (data.error || "No results found"));
            }
        } catch (e) {
            setMediaLogoResults([]);
        } finally {
            setIsSearchingMediaLogos(false);
        }
    };

    // --- Layer Active/Visibility Logic ---
    const isLayerActive = (layerId) => {
        switch (layerId) {
            case 'background': return true;
            case 'studioLogo': return !!logoSrc;
            case 'mediaLogo': return !!mediaLogoSrc;
            case 'text': return textEnabled;
            case 'subText': return subTextEnabled;
            case 'border': return borderEnabled;
            case 'overlay': return !!overlayImage;
            case 'effects': return bgEffect !== 'none';
            default: return false;
        }
    };

    // --- Layer Reordering Logic ---
    const moveLayerUp = (index) => {
        if (index > 0) {
            const newOrder = [...layerOrder];
            [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
            setLayerOrder(newOrder);
        }
    };
    const moveLayerDown = (index) => {
        if (index < layerOrder.length - 1) {
            const newOrder = [...layerOrder];
            [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
            setLayerOrder(newOrder);
        }
    };

    const handleCustomBgUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => setBgImage(e.target.result);
            reader.readAsDataURL(file);
        }
    };


    // Bounding Boxes for Hit Detection
    const hitBoxes = useRef({
        logo: null,
        mediaLogo: null,
        text: null,
        subText: null
    });

    // Canvas Rendering Engine
    useEffect(() => {
        let isCancelled = false;
        const drawPreview = async () => {
            const canvas = previewCanvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            
            // Poster Resolution
            const CANVAS_WIDTH = 1000;
            const CANVAS_HEIGHT = 1500;
            const CENTER_X = CANVAS_WIDTH / 2;
            const CENTER_Y = CANVAS_HEIGHT / 2;
            
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;

            // Helper to lighten/darken hex color
            const adjustColor = (hex, amount) => {
                amount = Math.round(amount);
                let color = hex.replace('#', '');
                if (color.length === 3) color = color.split('').map(c => c + c).join('');
                const num = parseInt(color, 16);
                let r = (num >> 16) + amount;
                let g = ((num >> 8) & 0x00FF) + amount;
                let b = (num & 0x0000FF) + amount;
                r = Math.max(Math.min(255, r), 0);
                g = Math.max(Math.min(255, g), 0);
                b = Math.max(Math.min(255, b), 0);
                
                const hexR = r.toString(16).padStart(2, '0');
                const hexG = g.toString(16).padStart(2, '0');
                const hexB = b.toString(16).padStart(2, '0');
                return `#${hexR}${hexG}${hexB}`;
            };

            for (const layer of layerOrder) {
                if (!isLayerActive(layer.id)) continue;
                switch (layer.id) {
                    case 'background':
                        // 1. Draw Background
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            if (bgType === 'texture' && bgImage) {
                try {
                    const bgImg = await loadImage(bgImage);
                    if (isCancelled) return;
                    const imgRatio = bgImg.width / bgImg.height;
                    const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
                    let drawWidth = CANVAS_WIDTH;
                    let drawHeight = CANVAS_HEIGHT;
                    let drawX = 0;
                    let drawY = 0;

                    if (imgRatio > canvasRatio) {
                        drawWidth = CANVAS_HEIGHT * imgRatio;
                        drawX = (CANVAS_WIDTH - drawWidth) / 2;
                    } else {
                        drawHeight = CANVAS_WIDTH / imgRatio;
                        drawY = (CANVAS_HEIGHT - drawHeight) / 2;
                    }

                    ctx.drawImage(bgImg, drawX, drawY, drawWidth, drawHeight);
                } catch(e) {}
            }
                        // 1.5 Draw Effects
            if (bgEffect !== 'none') {
                ctx.save();
                ctx.globalCompositeOperation = effectBlend === 'normal' ? 'source-over' : effectBlend;
                ctx.globalAlpha = effectOpacity / 100;
                
                if (bgEffect.startsWith('gradient')) {
                    let grad;
                    if (bgEffect === 'gradient-radial') {
                        grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 0, CENTER_X, CENTER_Y, Math.max(CANVAS_WIDTH, CANVAS_HEIGHT));
                    } else if (bgEffect === 'gradient-bottom') {
                        grad = ctx.createLinearGradient(0, CANVAS_HEIGHT, 0, 0);
                    } else if (bgEffect === 'gradient-top') {
                        grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
                    }
                    if (grad) {
                        grad.addColorStop(0, 'rgba(0,0,0,1)');
                        grad.addColorStop(1, 'rgba(0,0,0,0)');
                        ctx.fillStyle = grad;
                        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                    }
                } else if (bgEffect.startsWith('lines')) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                    ctx.lineWidth = 2;
                    if (bgEffect === 'lines-vertical') {
                        for(let i=0; i<CANVAS_WIDTH; i+=10) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_HEIGHT); ctx.stroke(); }
                    } else {
                        for(let i=0; i<CANVAS_HEIGHT; i+=10) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CANVAS_WIDTH, i); ctx.stroke(); }
                    }
                } else if (bgEffect === 'curves') {
                    const random = (seed) => {
                        let x = Math.sin((seed + waveSeed) * 12.3456) * 10000;
                        return x - Math.floor(x);
                    };

                    const steps = waveCount;
                    const step = CANVAS_HEIGHT / steps;
                    
                    const isHorizontal = waveDirection === 'horizontal';
                    const isVertical = waveDirection === 'vertical';
                    const isDiagUp = waveDirection === 'diagonal-up';
                    const isDiagDown = waveDirection === 'diagonal-down';

                    ctx.save();
                    
                    ctx.translate(waveOffsetX, waveOffsetY);

                    if (isVertical) {
                        ctx.translate(CANVAS_WIDTH, 0);
                        ctx.rotate(Math.PI / 2);
                    } else if (isDiagUp) {
                        ctx.translate(CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
                        ctx.rotate(-Math.PI / 4);
                        ctx.translate(-CANVAS_WIDTH, -CANVAS_HEIGHT);
                    } else if (isDiagDown) {
                        ctx.translate(CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
                        ctx.rotate(Math.PI / 4);
                        ctx.translate(-CANVAS_WIDTH/2, -CANVAS_HEIGHT*1.5);
                    }

                    const DRAW_SPAN = Math.max(CANVAS_WIDTH, CANVAS_HEIGHT) * 2;
                    const startX = -DRAW_SPAN * 0.25;
                    const endX = DRAW_SPAN * 1.25;

                    for (let i = 0; i < steps; i++) {
                        const yPos = i * step;
                        
                        ctx.beginPath();
                        ctx.moveTo(startX, yPos);
                        
                        const shadeOffset = (random(i) * 120) - 40;
                        const fillHex = adjustColor(bgColor, shadeOffset);
                        const r = parseInt(fillHex.slice(1, 3), 16);
                        const g = parseInt(fillHex.slice(3, 5), 16);
                        const b = parseInt(fillHex.slice(5, 7), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
                        
                        const amplitudeScale = (CANVAS_HEIGHT * waveAmplitude) / 100;
                        
                        const cp1x = startX + (endX - startX) * (0.2 + random(i+1) * 0.2);
                        const cp1y = yPos + (amplitudeScale * (random(i+2) - 0.5) * 2.5);
                        const cp2x = startX + (endX - startX) * (0.6 + random(i+3) * 0.2);
                        const cp2y = yPos + (amplitudeScale * (random(i+4) - 0.5) * 2.5);
                        const endY = yPos + (amplitudeScale * (random(i+5) - 0.5) * 1.5);
                        
                        if (waveAmplitude === 0) {
                            ctx.lineTo(endX, yPos);
                        } else {
                            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
                        }
                        
                        ctx.lineTo(endX, DRAW_SPAN * 2);
                        ctx.lineTo(startX, DRAW_SPAN * 2);
                        ctx.fill();
                    }
                    
                    ctx.restore();
                }
                
                ctx.restore();
            }

            // Reset Hit Boxes
            hitBoxes.current = { logo: null, mediaLogo: null, text: null, subText: null };
                        break;
                    case 'studioLogo':
                        // 2. Draw Logo
            if (logoSrc) {
                try {
                    const logoImg = await loadImage(logoSrc);
                    const ratio = logoImg.width / logoImg.height;
                    const targetWidth = logoWidth;
                    const targetHeight = targetWidth / ratio;
                    
                    const x = CENTER_X + logoOffsetX - (targetWidth / 2);
                    const y = CENTER_Y + logoOffset - (targetHeight / 2);

                    hitBoxes.current.logo = { x, y, width: targetWidth, height: targetHeight };

                    if (logoWhitewash) {
                        const offscreen = document.createElement('canvas');
                        offscreen.width = targetWidth;
                        offscreen.height = targetHeight;
                        const offCtx = offscreen.getContext('2d');
                        offCtx.drawImage(logoImg, 0, 0, targetWidth, targetHeight);
                        offCtx.globalCompositeOperation = 'source-in';
                        offCtx.fillStyle = 'white';
                        offCtx.fillRect(0, 0, targetWidth, targetHeight);
                        ctx.drawImage(offscreen, x, y);
                    } else {
                        ctx.drawImage(logoImg, x, y, targetWidth, targetHeight);
                    }
                } catch(e) {}
            }
                        break;
                    case 'mediaLogo':
                        // 2.5 Draw Media Logo
            if (mediaLogoSrc) {
                try {
                    const logoImg = await loadImage(mediaLogoSrc);
                    const ratio = logoImg.width / logoImg.height;
                    const targetWidth = mediaLogoWidth;
                    const targetHeight = targetWidth / ratio;
                    
                    const x = CENTER_X + mediaLogoOffsetX - (targetWidth / 2);
                    const y = CENTER_Y + mediaLogoOffset - (targetHeight / 2);

                    hitBoxes.current.mediaLogo = { x, y, width: targetWidth, height: targetHeight };

                    if (mediaLogoWhitewash) {
                        const offscreen = document.createElement('canvas');
                        offscreen.width = targetWidth;
                        offscreen.height = targetHeight;
                        const offCtx = offscreen.getContext('2d');
                        offCtx.drawImage(logoImg, 0, 0, targetWidth, targetHeight);
                        offCtx.globalCompositeOperation = 'source-in';
                        offCtx.fillStyle = 'white';
                        offCtx.fillRect(0, 0, targetWidth, targetHeight);
                        ctx.drawImage(offscreen, x, y);
                    } else {
                        ctx.drawImage(logoImg, x, y, targetWidth, targetHeight);
                    }
                } catch(e) {}
            }
                        break;
                    case 'overlay':
                        // 4. Draw Overlay Image
            if (overlayImage) {
                try {
                    const overlayImg = await loadImage(overlayImage);
                    if (isCancelled) return;
                    ctx.drawImage(overlayImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                } catch(e) {}
            }
                        break;
                    case 'text':
                        // 3. Draw Text
            if (textEnabled && textContent) {
                ctx.font = `${textSize}px "${textFont}", sans-serif`;
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                ctx.shadowColor = 'rgba(0,0,0,0.7)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;

                let textToDraw = textUppercase ? textContent.toUpperCase() : textContent;
                
                const paragraphs = textToDraw.split('\\n');
                const MAX_WIDTH = CANVAS_WIDTH * 0.9;
                const lineHeight = textSize * 1.2;
                let finalLines = [];
                
                paragraphs.forEach(paragraph => {
                    let words = paragraph.split(' ');
                    let currentLine = words[0];
                    for (let i = 1; i < words.length; i++) {
                        let word = words[i];
                        let width = ctx.measureText(currentLine + " " + word).width;
                        if (width < MAX_WIDTH) {
                            currentLine += " " + word;
                        } else {
                            finalLines.push(currentLine);
                            currentLine = word;
                        }
                    }
                    finalLines.push(currentLine);
                });
                
                let currentY = CENTER_Y + textOffset;
                currentY -= ((finalLines.length - 1) * lineHeight) / 2;
                let startY = currentY - (textSize / 2);
                let textBlockHeight = finalLines.length * lineHeight;
                
                let maxWidth = 0;
                finalLines.forEach(line => {
                    let w = ctx.measureText(line.trim()).width;
                    if (w > maxWidth) maxWidth = w;
                });
                
                hitBoxes.current.text = { 
                    x: CENTER_X + textOffsetX - maxWidth/2, 
                    y: startY, 
                    width: maxWidth, 
                    height: textBlockHeight 
                };

                finalLines.forEach(line => {
                    ctx.fillText(line.trim(), CENTER_X + textOffsetX, currentY);
                    currentY += lineHeight;
                });
                
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            }
                        break;
                    case 'subText':
                        // 3.5 Draw Sub-Text
            if (subTextEnabled && subTextContent) {
                ctx.font = `${subTextSize}px "${subTextFont}", sans-serif`;
                ctx.fillStyle = subTextColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                ctx.shadowColor = 'rgba(0,0,0,0.7)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;

                let textToDraw = subTextUppercase ? subTextContent.toUpperCase() : subTextContent;
                
                const paragraphs = textToDraw.split('\\n');
                const MAX_WIDTH = CANVAS_WIDTH * 0.9;
                const lineHeight = subTextSize * 1.2;
                let finalLines = [];
                
                paragraphs.forEach(paragraph => {
                    let words = paragraph.split(' ');
                    let currentLine = words[0];
                    for (let i = 1; i < words.length; i++) {
                        let word = words[i];
                        let width = ctx.measureText(currentLine + " " + word).width;
                        if (width < MAX_WIDTH) {
                            currentLine += " " + word;
                        } else {
                            finalLines.push(currentLine);
                            currentLine = word;
                        }
                    }
                    finalLines.push(currentLine);
                });
                
                let currentY = CENTER_Y + subTextOffset;
                currentY -= ((finalLines.length - 1) * lineHeight) / 2;
                let startY = currentY - (subTextSize / 2);
                let textBlockHeight = finalLines.length * lineHeight;
                
                let maxWidth = 0;
                finalLines.forEach(line => {
                    let w = ctx.measureText(line.trim()).width;
                    if (w > maxWidth) maxWidth = w;
                });
                
                hitBoxes.current.subText = { 
                    x: CENTER_X + subTextOffsetX - maxWidth/2, 
                    y: startY, 
                    width: maxWidth, 
                    height: textBlockHeight 
                };

                finalLines.forEach(line => {
                    ctx.fillText(line.trim(), CENTER_X + subTextOffsetX, currentY);
                    currentY += lineHeight;
                });
                
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            }
                        break;
                    case 'border':
                        // 4. Draw Border
            if (borderEnabled && borderWidth > 0) {
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = borderWidth;
                ctx.strokeRect(borderWidth/2, borderWidth/2, CANVAS_WIDTH - borderWidth, CANVAS_HEIGHT - borderWidth);
            }
                        break;
                }
            }
        };
        drawPreview();
        return () => { isCancelled = true; };
    }, [bgType, bgColor, bgImage, bgEffect, effectOpacity, effectBlend, waveCount, waveDirection, waveAmplitude, waveOffsetX, waveOffsetY, waveSeed, logoSrc, logoWhitewash, logoWidth, logoOffset, logoOffsetX, mediaLogoSrc, mediaLogoWidth, mediaLogoOffset, mediaLogoOffsetX, mediaLogoWhitewash, textEnabled, textContent, textFont, textColor, textSize, textOffset, textOffsetX, textUppercase, subTextEnabled, subTextContent, subTextFont, subTextColor, subTextSize, subTextOffset, subTextOffsetX, subTextUppercase, borderEnabled, borderColor, borderWidth, overlayImage, localFonts, layerOrder, manualRefresh]);


    
    // Image Cache
    const imageCache = useRef({});
    const loadImage = (src) => {
        if (imageCache.current[src]) return Promise.resolve(imageCache.current[src]);
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => { imageCache.current[src] = img; resolve(img); };
            img.onerror = reject;
            img.src = src.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(src)}` : src;
        });
    };


    // Drag & Drop Handlers
    const getMousePos = (canvas, evt) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY
        };
    };

    const handleMouseDown = (e) => {
        if (!previewCanvasRef.current) return;
        const pos = getMousePos(previewCanvasRef.current, e);
        const boxes = hitBoxes.current;
        
        let target = null;
        let startOffset = { x: 0, y: 0 };
        
        // Reverse order (top element clicked first)
        if (boxes.subText && pos.x >= boxes.subText.x && pos.x <= boxes.subText.x + boxes.subText.width && pos.y >= boxes.subText.y && pos.y <= boxes.subText.y + boxes.subText.height) {
            target = 'subText';
            startOffset = { x: subTextOffsetX, y: subTextOffset };
        } else if (boxes.text && pos.x >= boxes.text.x && pos.x <= boxes.text.x + boxes.text.width && pos.y >= boxes.text.y && pos.y <= boxes.text.y + boxes.text.height) {
            target = 'text';
            startOffset = { x: textOffsetX, y: textOffset };
        } else if (boxes.mediaLogo && pos.x >= boxes.mediaLogo.x && pos.x <= boxes.mediaLogo.x + boxes.mediaLogo.width && pos.y >= boxes.mediaLogo.y && pos.y <= boxes.mediaLogo.y + boxes.mediaLogo.height) {
            target = 'mediaLogo';
            startOffset = { x: mediaLogoOffsetX, y: mediaLogoOffset };
        } else if (boxes.logo && pos.x >= boxes.logo.x && pos.x <= boxes.logo.x + boxes.logo.width && pos.y >= boxes.logo.y && pos.y <= boxes.logo.y + boxes.logo.height) {
            target = 'logo';
            startOffset = { x: logoOffsetX, y: logoOffset };
        }
        
        if (target) {
            setDragTarget(target);
            setDragStartMouse(pos);
            setDragStartOffsets(startOffset);
        }
    };

    const handleMouseMove = (e) => {
        if (!dragTarget || !previewCanvasRef.current) return;
        const pos = getMousePos(previewCanvasRef.current, e);
        const dx = pos.x - dragStartMouse.x;
        const dy = pos.y - dragStartMouse.y;
        
        const newX = dragStartOffsets.x + dx;
        const newY = dragStartOffsets.y + dy;
        
        if (dragTarget === 'logo') { setLogoOffsetX(newX); setLogoOffset(newY); }
        else if (dragTarget === 'mediaLogo') { setMediaLogoOffsetX(newX); setMediaLogoOffset(newY); }
        else if (dragTarget === 'text') { setTextOffsetX(newX); setTextOffset(newY); }
        else if (dragTarget === 'subText') { setSubTextOffsetX(newX); setSubTextOffset(newY); }
    };

    const handleMouseUp = () => setDragTarget(null);


    const handleSave = async () => {
        setIsSaving(true);
        showInfo("Saving poster...");
        try {
            const dataUrl = previewCanvasRef.current.toDataURL("image/jpeg", 0.9);
            const res = await fetch("/api/collections/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ collection_name: collection.title, library_name: libraryName, image_data: dataUrl })
            });
            const data = await res.json();
            if (data.success) {
                if (uploadToServer && activeServer) {
                    showInfo("Uploading to Media Server...");
                    const uploadRes = await fetch("/api/collections/upload-to-server", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            rating_key: collection.ratingKey,
                            server_type: activeServer.id,
                            server_url: activeServer.url,
                            server_token: activeServer.token,
                            image_data: dataUrl
                        })
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadData.success) {
                        showError("Saved locally, but failed to push to Media Server: " + uploadData.error);
                        setIsSaving(false);
                        return;
                    }
                }
                showSuccess("Poster saved successfully!");
                onClose();
            } else {
                showError("Failed to save: " + data.error);
            }
        } catch (e) {
            showError("Failed to generate or save poster.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-theme-bg border border-theme rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-theme bg-theme-card shrink-0">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-theme-text">
                        <LayoutTemplate className="w-5 h-5 text-theme-primary" />
                        Poster Creator: {collection.title}
                    </h2>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white">
                            <input type="checkbox" checked={uploadToServer} onChange={e => setUploadToServer(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                            Push to {activeServer?.id === 'jellyfin' ? 'Jellyfin' : activeServer?.id === 'emby' ? 'Emby' : 'Plex'}
                        </label>
                        <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 bg-theme-primary hover:bg-theme-primary-hover text-white rounded-lg flex items-center gap-2 font-medium disabled:opacity-50">
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Poster
                        </button>
                        <button onClick={onClose} className="p-2 text-theme-muted hover:text-white rounded-lg hover:bg-theme-hover">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    
                    {/* Left Sidebar (Settings) */}
                    <div className="w-96 bg-theme-card border-r border-theme overflow-y-auto p-4 custom-scrollbar space-y-2 h-full">
                        
                        {/* BACKGROUND ACCORDION */}
                        <Accordion title="Background" icon={ImageIcon} isOpen={activeAccordion === 'background'} onToggle={() => setActiveAccordion('background')}>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-theme-muted mb-2 block">Background Type</label>
                                    <div className="flex bg-theme-input rounded-lg p-1 border border-theme">
                                        <button onClick={() => setBgType('color')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${bgType === 'color' ? 'bg-theme-primary text-white' : 'text-theme-muted hover:text-white'}`}>Solid Color</button>
                                        <button onClick={() => setBgType('texture')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${bgType === 'texture' ? 'bg-theme-primary text-white' : 'text-theme-muted hover:text-white'}`}>Texture/Image</button>
                                    </div>
                                </div>

                                {bgType === 'color' && (
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer p-0 border-0" />
                                        <input type="text" value={bgColor} onChange={e => setBgColor(e.target.value)} className="flex-1 bg-theme-input border border-theme rounded-md px-3 py-2 text-sm focus:border-theme-primary" />
                                    </div>
                                )}

                                {bgType === 'texture' && (
                                    <>
                                                                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                            <label className="text-xs text-theme-muted mb-2 block">Search on Provider</label>
                                            <div className="flex gap-2 mb-3">
                                                <div className="flex-1 relative">
                                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                                                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search for backgrounds..." className="w-full bg-theme-bg border border-theme rounded-lg pl-9 pr-3 py-2 text-sm focus:border-theme-primary transition-colors" onKeyDown={(e) => e.key === 'Enter' && setBgSearchOpen(true)} />
                                                </div>
                                                <button onClick={() => setBgSearchOpen(true)} disabled={!searchQuery.trim()} className="px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center min-w-[80px]">
                                                    Search
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs text-theme-muted mb-2 block">Upload Custom Background</label>
                                            <label className="flex items-center justify-center gap-2 w-full bg-theme-input hover:bg-theme-hover border border-theme rounded-lg py-2 cursor-pointer transition-colors text-sm">
                                                <Upload className="w-4 h-4 text-theme-primary" />
                                                Upload Image
                                                <input type="file" accept="image/*" className="hidden" onChange={handleCustomBgUpload} />
                                            </label>
                                        </div>
                                    </>
                                )}
                            </div>
                        </Accordion>

                                                {/* LOCAL OVERLAYS ACCORDION */}
                        <Accordion title="Your Local Overlays" icon={ImageIcon} isOpen={activeAccordion === 'localOverlays'} onToggle={() => setActiveAccordion('localOverlays')}>
                            <div className="space-y-4">
                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                    <label className="text-xs text-theme-muted mb-2 block">Select Local Overlay</label>
                                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                        <div onClick={() => setOverlayImage(null)} className="bg-theme-input border border-theme rounded flex items-center justify-center cursor-pointer hover:border-red-500 text-xs text-theme-muted p-2 text-center aspect-[2/3]">Remove</div>
                                        {localOverlays.map((overlay, idx) => (
                                            <div key={idx} onClick={() => setOverlayImage(`/api/overlayfiles/preview/${encodeURIComponent(overlay.name)}`)} className={`bg-white/10 rounded cursor-pointer border-2 transition-colors flex items-center justify-center aspect-[2/3] hover:border-theme-primary ${overlayImage === `/api/overlayfiles/preview/${encodeURIComponent(overlay.name)}` ? 'border-theme-primary bg-theme-primary/10' : 'border-transparent'}`}>
                                                <img src={`/api/overlayfiles/preview/${encodeURIComponent(overlay.name)}`} alt={overlay.name} className="max-w-full max-h-full object-contain" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Accordion>

                        {/* EFFECTS ACCORDION */}
                        <Accordion title="Effects & Texture" icon={Palette} isOpen={activeAccordion === 'effects'} onToggle={() => setActiveAccordion('effects')}>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-theme-muted mb-1 block">Effect Style</label>
                                    <select value={bgEffect} onChange={e => setBgEffect(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-sm">
                                        <option value="none">None</option>
                                        <option value="gradient-radial">Center-Out Fade</option>
                                        <option value="gradient-bottom">Bottom-Up Fade</option>
                                        <option value="gradient-top">Top-Down Fade</option>
                                        <option value="lines-vertical">Vertical Lines Texture</option>
                                        <option value="lines-horizontal">Horizontal Lines Texture</option>
                                        <option value="curves">Simposter Waves</option>
                                    </select>
                                </div>
                                {bgEffect !== 'none' && (
                                    <>
                                        <div>
                                            <label className="text-xs text-theme-muted mb-1 block">Blend Mode</label>
                                            <select value={effectBlend} onChange={e => setEffectBlend(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-sm">
                                                <option value="normal">Normal (Matte)</option>
                                                <option value="overlay">Overlay (Rich Contrast)</option>
                                                <option value="screen">Screen (Glossy/Bright)</option>
                                                <option value="multiply">Multiply (Dark/Moody)</option>
                                                <option value="color-dodge">Color Dodge (Glowy)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Effect Intensity (%)</span>
                                                <span className="font-mono">{effectOpacity}</span>
                                            </div>
                                            <input type="range" min="1" max="100" value={effectOpacity} onChange={e => setEffectOpacity(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                        
                                        {bgEffect === 'curves' && (
                                            <>
                                                <div>
                                                    <label className="text-xs text-theme-muted mb-1 block">Wave Direction</label>
                                                    <select value={waveDirection} onChange={e => setWaveDirection(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-sm">
                                                        <option value="horizontal">Horizontal</option>
                                                        <option value="vertical">Vertical</option>
                                                        <option value="diagonal-up">Diagonal Up</option>
                                                        <option value="diagonal-down">Diagonal Down</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                        <span>Number of Waves</span>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <input type="range" min="1" max="100" value={waveCount} onChange={e => setWaveCount(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                                        <input type="number" min="1" max="100" value={waveCount} onChange={e => setWaveCount(parseInt(e.target.value))} className="w-16 bg-theme-input border border-theme rounded px-1 py-0.5 text-xs font-mono text-center" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                        <span>Wave Curve Intensity (%)</span>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <input type="range" min="0" max="100" value={waveAmplitude} onChange={e => setWaveAmplitude(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                                        <input type="number" min="0" max="100" value={waveAmplitude} onChange={e => setWaveAmplitude(parseInt(e.target.value))} className="w-16 bg-theme-input border border-theme rounded px-1 py-0.5 text-xs font-mono text-center" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                        <span>Wave Design Seed</span>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <input type="range" min="-1000" max="1000" value={waveSeed} onChange={e => setWaveSeed(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                                        <input type="number" min="-1000" max="1000" value={waveSeed} onChange={e => setWaveSeed(parseInt(e.target.value))} className="w-16 bg-theme-input border border-theme rounded px-1 py-0.5 text-xs font-mono text-center" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                        <span>Horizontal Offset (sideways)</span>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <input type="range" min="-2000" max="2000" value={waveOffsetX} onChange={e => setWaveOffsetX(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                                        <input type="number" min="-2000" max="2000" value={waveOffsetX} onChange={e => setWaveOffsetX(parseInt(e.target.value))} className="w-16 bg-theme-input border border-theme rounded px-1 py-0.5 text-xs font-mono text-center" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                        <span>Vertical Offset (up/down)</span>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <input type="range" min="-2000" max="2000" value={waveOffsetY} onChange={e => setWaveOffsetY(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                                        <input type="number" min="-2000" max="2000" value={waveOffsetY} onChange={e => setWaveOffsetY(parseInt(e.target.value))} className="w-16 bg-theme-input border border-theme rounded px-1 py-0.5 text-xs font-mono text-center" />
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </Accordion>

                        {/* STUDIO LOGO ACCORDION */}
                        <Accordion title="Studio Logo" icon={Palette} isOpen={activeAccordion === 'logo'} onToggle={() => setActiveAccordion('logo')}>
                            <div className="space-y-4">
                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                    <label className="text-xs text-theme-muted mb-2 block">Select Studio Logo</label>
                                    <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                        <div onClick={() => setLogoSrc(null)} className="bg-theme-input border border-theme rounded flex items-center justify-center cursor-pointer hover:border-red-500 text-xs text-theme-muted p-2 text-center">No Logo</div>
                                        {studioLogos.map(logo => (
                                            <div key={logo.id} onClick={() => setLogoSrc(logo.url)} className={`bg-white/10 rounded p-2 cursor-pointer border-2 transition-colors flex items-center justify-center min-h-12 hover:border-theme-primary ${logoSrc === logo.url ? 'border-theme-primary bg-theme-primary/10' : 'border-transparent'}`}>
                                                <img src={logo.url} alt={logo.name} className={`max-w-full max-h-full object-contain ${logoWhitewash ? 'brightness-0 invert' : ''}`} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                    <input type="checkbox" checked={logoWhitewash} onChange={e => setLogoWhitewash(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                    White-wash logo
                                </label>

                                {logoSrc && (
                                    <>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Logo Width (px)</span>
                                                <span className="font-mono">{logoWidth}</span>
                                            </div>
                                            <input type="range" min="100" max="1500" value={logoWidth} onChange={e => setLogoWidth(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Vertical Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(logoOffset)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={logoOffset} onChange={e => setLogoOffset(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Horizontal Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(logoOffsetX)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={logoOffsetX} onChange={e => setLogoOffsetX(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                    </>
                                )}
                            </div>
                        </Accordion>

                        {/* MEDIA LOGO ACCORDION */}
                        <Accordion title="Media Logo" icon={Palette} isOpen={activeAccordion === 'mediaLogo'} onToggle={() => setActiveAccordion('mediaLogo')}>
                            <div className="space-y-4">
                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                    <label className="text-xs text-theme-muted mb-2 block">Search Media Logos</label>
                                    <div className="flex gap-2 mb-3">
                                        <div className="flex-1 relative">
                                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                                            <input type="text" value={mediaLogoQuery} onChange={(e) => setMediaLogoQuery(e.target.value)} placeholder="Search media logos (e.g. Alien)..." className="w-full bg-theme-bg border border-theme rounded-lg pl-9 pr-3 py-2 text-sm focus:border-theme-primary transition-colors" onKeyDown={(e) => e.key === 'Enter' && setMediaLogoSearchOpen(true)} />
                                        </div>
                                        <button onClick={() => setMediaLogoSearchOpen(true)} disabled={!mediaLogoQuery.trim()} className="px-4 py-2 bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center min-w-[80px]">
                                            Search
                                        </button>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <button onClick={() => setMediaLogoSrc(null)} className="text-xs text-red-500 hover:text-red-400">Remove Logo</button>
                                    </div>
                                </div>
                                
                                {mediaLogoSrc && (
                                    <>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={mediaLogoWhitewash} onChange={e => setMediaLogoWhitewash(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                            White-wash logo
                                        </label>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Logo Width (px)</span>
                                                <span className="font-mono">{mediaLogoWidth}</span>
                                            </div>
                                            <input type="range" min="100" max="1500" value={mediaLogoWidth} onChange={e => setMediaLogoWidth(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Vertical Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(mediaLogoOffset)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={mediaLogoOffset} onChange={e => setMediaLogoOffset(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Horizontal Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(mediaLogoOffsetX)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={mediaLogoOffsetX} onChange={e => setMediaLogoOffsetX(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                    </>
                                )}
                            </div>
                        </Accordion>

                        {/* TEXT ACCORDION */}
                        <Accordion title="Text" icon={Type} isOpen={activeAccordion === 'text'} onToggle={() => setActiveAccordion('text')}>
                            <div className="space-y-4">
                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                    <input type="checkbox" checked={textEnabled} onChange={e => setTextEnabled(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                    Enable Text
                                </label>

                                {textEnabled && (
                                    <>
                                        <div>
                                            <label className="text-xs text-theme-muted mb-1 block">Text Content (Use \n for new line)</label>
                                            <input type="text" value={textContent} onChange={e => setTextContent(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-3 py-2 text-sm focus:border-theme-primary" />
                                        </div>
                                        
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                            <input type="checkbox" checked={textUppercase} onChange={e => setTextUppercase(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                            Force Uppercase
                                        </label>

                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-theme-muted mb-1 block">Font Color</label>
                                                <div className="flex items-center gap-2">
                                                    <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0" />
                                                    <input type="text" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-xs font-mono" />
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-theme-muted mb-1 block">Font Family</label>
                                                <select value={textFont} onChange={e => setTextFont(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-sm">
                                                                                                          <option value="Arial">Arial</option>
                                                      <option value="Times New Roman">Times New Roman</option>
                                                      <option value="Impact">Impact</option>
                                                      <option value="Verdana">Verdana</option>
                                                      <option value="Courier New">Courier New</option>
                                                      {localFonts.map(f => (
                                                          <option key={f} value={f.split('.')[0]}>{f.split('.')[0]} (Local)</option>
                                                      ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Font Size</span>
                                                <span className="font-mono">{textSize}</span>
                                            </div>
                                            <input type="range" min="10" max="300" value={textSize} onChange={e => setTextSize(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Vertical Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(textOffset)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={textOffset} onChange={e => setTextOffset(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Horizontal Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(textOffsetX)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={textOffsetX} onChange={e => setTextOffsetX(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                    </>
                                )}

                                <hr className="border-theme my-2" />

                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                    <input type="checkbox" checked={subTextEnabled} onChange={e => setSubTextEnabled(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                    Enable Sub-Text
                                </label>

                                {subTextEnabled && (
                                    <>
                                        <div>
                                            <label className="text-xs text-theme-muted mb-1 block">Sub-Text Content (Use \n for new line)</label>
                                            <input type="text" value={subTextContent} onChange={e => setSubTextContent(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-3 py-2 text-sm focus:border-theme-primary" />
                                        </div>
                                        
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                            <input type="checkbox" checked={subTextUppercase} onChange={e => setSubTextUppercase(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                            Force Uppercase
                                        </label>

                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-theme-muted mb-1 block">Font Color</label>
                                                <div className="flex items-center gap-2">
                                                    <input type="color" value={subTextColor} onChange={e => setSubTextColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0" />
                                                    <input type="text" value={subTextColor} onChange={e => setSubTextColor(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-xs font-mono" />
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-theme-muted mb-1 block">Font Family</label>
                                                <select value={subTextFont} onChange={e => setSubTextFont(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-sm">
                                                                                                          <option value="Arial">Arial</option>
                                                      <option value="Times New Roman">Times New Roman</option>
                                                      <option value="Impact">Impact</option>
                                                      <option value="Verdana">Verdana</option>
                                                      <option value="Courier New">Courier New</option>
                                                      {localFonts.map(f => (
                                                          <option key={f} value={f.split('.')[0]}>{f.split('.')[0]} (Local)</option>
                                                      ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Font Size</span>
                                                <span className="font-mono">{subTextSize}</span>
                                            </div>
                                            <input type="range" min="10" max="300" value={subTextSize} onChange={e => setSubTextSize(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Vertical Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(subTextOffset)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={subTextOffset} onChange={e => setSubTextOffset(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Horizontal Offset (px from center)</span>
                                                <span className="font-mono">{Math.round(subTextOffsetX)}</span>
                                            </div>
                                            <input type="range" min="-750" max="750" value={subTextOffsetX} onChange={e => setSubTextOffsetX(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>

                                    </>
                                )}
                            </div>
                        </Accordion>




                        {/* BORDER ACCORDION */}
                        <Accordion title="Border" icon={Square} isOpen={activeAccordion === 'border'} onToggle={() => setActiveAccordion('border')}>
                            <div className="space-y-4">
                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                    <input type="checkbox" checked={borderEnabled} onChange={e => setBorderEnabled(e.target.checked)} className="rounded border-theme bg-theme-input text-theme-primary focus:ring-theme-primary" />
                                    Enable Border
                                </label>

                                {borderEnabled && (
                                    <>
                                        <div>
                                            <label className="text-xs text-theme-muted mb-1 block">Border Color</label>
                                            <div className="flex items-center gap-2">
                                                <input type="color" value={borderColor} onChange={e => setBorderColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer p-0 border-0" />
                                                <input type="text" value={borderColor} onChange={e => setBorderColor(e.target.value)} className="w-full bg-theme-input border border-theme rounded-md px-2 py-1.5 text-xs font-mono" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs text-theme-muted mb-1">
                                                <span>Border Width (px)</span>
                                                <span className="font-mono">{borderWidth}</span>
                                            </div>
                                            <input type="range" min="1" max="100" value={borderWidth} onChange={e => setBorderWidth(parseInt(e.target.value))} className="w-full accent-theme-primary" />
                                        </div>
                                    </>
                                )}
                            </div>
                        </Accordion>

                        {/* PRESETS ACCORDION */}
                        <Accordion title="Presets & Blueprints" icon={Save} isOpen={activeAccordion === 'presets'} onToggle={() => setActiveAccordion('presets')}>
                            <div className="space-y-4">
                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                    <label className="text-xs text-theme-muted mb-2 block">Load Blueprint</label>
                                    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                        {presets.length === 0 ? (
                                            <div className="text-xs text-theme-muted text-center py-2">No blueprints saved yet.</div>
                                        ) : (
                                            presets.map(preset => (
                                                <div key={preset.id} className="flex items-center justify-between bg-theme-input border border-theme rounded px-2 py-1.5">
                                                    <span className="text-sm font-medium truncate">{preset.name}</span>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button onClick={() => handleLoadPreset(preset)} className="px-2 py-1 bg-theme-primary text-white text-xs rounded hover:bg-theme-primary-hover">Load</button>
                                                        <button onClick={() => handleDeletePreset(preset.id)} className="px-2 py-1 bg-red-600/20 text-red-500 hover:bg-red-600/40 text-xs rounded"><X className="w-3 h-3" /></button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div className="border border-theme rounded-lg p-3 bg-theme-bg/50">
                                    <label className="text-xs text-theme-muted mb-2 block">Save Current Design</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            value={presetName}
                                            onChange={e => setPresetName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                                            placeholder="Blueprint name..."
                                            className="flex-1 bg-theme-input border border-theme rounded-md px-3 py-1.5 text-sm focus:border-theme-primary outline-none"
                                        />
                                        <button onClick={handleSavePreset} className="p-1.5 bg-theme-primary rounded-md text-white px-3 text-sm font-medium shrink-0">Save</button>
                                    </div>
                                </div>
                            </div>
                        </Accordion>

                    </div>

                    {/* Main Preview Area */}
                    <div className="flex-1 bg-theme-bg relative overflow-hidden flex flex-col p-4 bg-[url('https://transparenttextures.com/patterns/dark-matter.png')]">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-bold uppercase tracking-widest text-theme-muted">Preview</span>
                            <button onClick={() => setManualRefresh(k => k + 1)} className="px-3 py-1 bg-theme-primary text-white text-xs rounded hover:bg-theme-primary-hover flex items-center gap-1">
                                <RefreshCw className="w-3 h-3" /> Refresh
                            </button>
                        </div>
                        
                        <div className="flex-1 flex items-center justify-center overflow-hidden pb-4">
                            <div className="relative shadow-2xl rounded-sm overflow-hidden" style={{ aspectRatio: '2/3', height: '100%', maxHeight: 'calc(100vh - 200px)' }}>
                                {/* Canvas Preview scales to fit container using CSS */}
                                <canvas 
                                    ref={previewCanvasRef} 
                                    className="w-full h-full object-contain bg-black"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar (Layer Order) */}
                    <div className="w-72 bg-theme-card border-l border-theme p-4 flex flex-col shrink-0">
                        <div className="flex items-center gap-2 mb-4">
                            <Layers className="w-5 h-5 text-theme-primary" />
                            <h3 className="font-semibold text-theme-text">Active Layers</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                            {layerOrder.map((layer, index) => {
                                const active = isLayerActive(layer.id);
                                if (!active) return null;
                                return (
                                    <div key={layer.id} className="flex items-center justify-between bg-theme-input border border-theme rounded p-2">
                                        <span className="text-sm font-medium text-theme-text">{layer.label}</span>
                                        <div className="flex flex-col gap-1">
                                            <button 
                                                onClick={() => moveLayerUp(index)}
                                                disabled={index === 0}
                                                className="p-1 hover:bg-theme-hover text-theme-muted hover:text-theme-primary rounded disabled:opacity-30"
                                            >
                                                <ArrowUp className="w-3 h-3" />
                                            </button>
                                            <button 
                                                onClick={() => moveLayerDown(index)}
                                                disabled={index === layerOrder.length - 1}
                                                className="p-1 hover:bg-theme-hover text-theme-muted hover:text-theme-primary rounded disabled:opacity-30"
                                            >
                                                <ArrowDown className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-4 p-3 bg-theme-bg/50 border border-theme rounded text-xs text-theme-muted text-center leading-relaxed">
                            Layers are drawn from top to bottom. Only active layers are shown here.
                        </div>
                    </div>

                </div>
            </div>
                        {bgSearchOpen && (
                <AssetSearchModal
                    isOpen={bgSearchOpen}
                    onClose={() => setBgSearchOpen(false)}
                    query={searchQuery}
                    assetType="texture"
                    favProvider={config?.ApiPart?.FavProvider || config?.FavProvider || "tmdb"}
                    onSelectLogo={(url) => {
                        setBgImage(url);
                        setBgSearchOpen(false);
                        setBgType('texture');
                    }}
                />
            )}
            {mediaLogoSearchOpen && (
                <AssetSearchModal
                    isOpen={mediaLogoSearchOpen}
                    onClose={() => setMediaLogoSearchOpen(false)}
                    query={mediaLogoQuery}
                    favProvider={config?.ApiPart?.FavProvider || config?.FavProvider || "tmdb"}
                    onSelectLogo={(url) => {
                        setMediaLogoSrc(url);
                        setMediaLogoSearchOpen(false);
                    }}
                />
            )}
        </div>
    );
};

export default CollectionLiveEditor;
