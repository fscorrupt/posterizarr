import React, { useState, useEffect, useRef } from "react";
import WorkspaceHeader from "./WorkspaceHeader";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Image as ImageIcon,
  Loader2,
  X,
  Upload,
  Trash2,
  Eye,
  AlertCircle,
  Download,
  Type,
  Palette,
  Save,
  LayoutTemplate,
  Monitor,
  Smartphone,
  FileImage,
  RotateCcw,
  ImagePlus,
  Layers,
  Move,
  ArrowUp,
  ArrowDown,
  RotateCw,
  BringToFront,
  SendToBack,
  Sun,
  Moon,
  Grid
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import ScrollToButtons from "./ScrollToButtons";

// HELPER: Color Input
const ColorInput = ({ value, onChange, label }) => (
    <div className="flex items-center gap-2 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
        <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-theme shadow-sm shrink-0">
            <input
                type="color"
                value={value}
                onChange={e => onChange(e.target.value)}
                className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer p-0 border-0"
                title={label}
            />
        </div>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-24 bg-transparent border border-theme rounded-md px-2 py-1 text-xs font-mono uppercase text-white focus:border-theme-primary focus:outline-none transition-colors"
        />
    </div>
);

// HELPER: Background Class Generator
const getBackgroundClass = (mode) => {
    if (mode === 'light') return "bg-gray-100";
    if (mode === 'checker') return "bg-white [background-image:linear-gradient(45deg,#ccc_25%,transparent_25%),linear-gradient(-45deg,#ccc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ccc_75%),linear-gradient(-45deg,transparent_75%,#ccc_75%)] [background-size:20px_20px] [background-position:0_0,0_10px,10px_-10px,-10px_0px]";
    // Default Dark
    return "bg-[#1a1a1a] bg-[url('https://transparenttextures.com/patterns/dark-matter.png')]";
};

// COMPONENT: Background Toggle Buttons
const BackgroundToggle = ({ current, onChange, className = "" }) => (
    <div className={`flex items-center bg-theme-input rounded-lg p-1 border border-theme/50 ${className}`}>
        <button
            onClick={(e) => { e.stopPropagation(); onChange("dark"); }}
            className={`p-1.5 rounded-md transition-all ${current === 'dark' ? 'bg-theme-primary text-white shadow-sm' : 'text-theme-muted hover:text-white'}`}
            title="Dark Background"
        >
            <Moon className="w-3.5 h-3.5" />
        </button>
        <button
            onClick={(e) => { e.stopPropagation(); onChange("light"); }}
            className={`p-1.5 rounded-md transition-all ${current === 'light' ? 'bg-theme-primary text-white shadow-sm' : 'text-theme-muted hover:text-white'}`}
            title="Light Background"
        >
            <Sun className="w-3.5 h-3.5" />
        </button>
        <button
            onClick={(e) => { e.stopPropagation(); onChange("checker"); }}
            className={`p-1.5 rounded-md transition-all ${current === 'checker' ? 'bg-theme-primary text-white shadow-sm' : 'text-theme-muted hover:text-white'}`}
            title="Transparent/Grid Background"
        >
            <Grid className="w-3.5 h-3.5" />
        </button>
    </div>
);

// COMPONENT: Interactive Layer
const InteractiveLayer = ({ layer, index, isSelected, onSelect, onChange, parentRef }) => {
    const layerRef = useRef(null);

    // Store drag state
    const dragStart = useRef({
        centerX: 0, centerY: 0,
        startX: 0, startY: 0,
        startDist: 0, startWidth: 0,
        aspectRatio: 1
    });

    const baseZ = layer.position === 'back' ? 10 : 60;
    const zIndex = isSelected ? 100 : baseZ + index;

    // 1. DRAG
    const handleDragStart = (e) => {
        if (e.target.dataset.handle) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(layer.id);

        if (!parentRef.current) return;

        dragStart.current = {
            startX: e.clientX,
            startY: e.clientY,
            startLeft: layer.x,
            startTop: layer.y,
            parentRect: parentRef.current.getBoundingClientRect()
        };

        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
    };

    const onDragMove = (e) => {
        const { startX, startY, startLeft, startTop, parentRect } = dragStart.current;
        const deltaX = (e.clientX - startX) / parentRect.width;
        const deltaY = (e.clientY - startY) / parentRect.height;

        onChange(layer.id, {
            x: Math.min(Math.max(startLeft + deltaX, 0), 1 - layer.width),
            y: Math.min(Math.max(startTop + deltaY, 0), 1 - layer.height)
        });
    };

    const onDragEnd = () => {
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
    };

    // 2. RESIZE
    const handleResizeStart = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!parentRef.current || !layerRef.current) return;
        const rect = layerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        dragStart.current = {
            centerX, centerY,
            startDist: Math.hypot(e.clientX - centerX, e.clientY - centerY),
            startWidth: layer.width,
            parentRect: parentRef.current.getBoundingClientRect(),
            aspectRatio: layer.aspectRatio || 1
        };

        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('mouseup', onResizeEnd);
    };

    const onResizeMove = (e) => {
        const { centerX, centerY, startDist, startWidth, parentRect, aspectRatio } = dragStart.current;
        const currentDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
        const scale = currentDist / startDist;
        const parentRatio = parentRect.width / parentRect.height;

        const newWidth = Math.max(0.05, startWidth * scale);
        const newHeight = (newWidth * parentRatio) / aspectRatio;

        onChange(layer.id, { width: newWidth, height: newHeight });
    };

    const onResizeEnd = () => {
        window.removeEventListener('mousemove', onResizeMove);
        window.removeEventListener('mouseup', onResizeEnd);
    };

    // 3. ROTATE
    const handleRotateStart = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!layerRef.current) return;
        const rect = layerRef.current.getBoundingClientRect();

        dragStart.current = {
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2
        };

        window.addEventListener('mousemove', onRotateMove);
        window.addEventListener('mouseup', onRotateEnd);
    };

    const onRotateMove = (e) => {
        const { centerX, centerY } = dragStart.current;
        const angleRad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        let angleDeg = angleRad * (180 / Math.PI);
        angleDeg += 90;
        onChange(layer.id, { rotation: angleDeg });
    };

    const onRotateEnd = () => {
        window.removeEventListener('mousemove', onRotateMove);
        window.removeEventListener('mouseup', onRotateEnd);
    };

    return (
        <div
            ref={layerRef}
            onMouseDown={handleDragStart}
            onClick={(e) => e.stopPropagation()}
            className={`absolute cursor-move select-none`}
            style={{
                left: `${layer.x * 100}%`,
                top: `${layer.y * 100}%`,
                width: `${layer.width * 100}%`,
                height: `${layer.height * 100}%`,
                zIndex: zIndex,
                transform: `rotate(${layer.rotation || 0}deg)`,
            }}
        >
            <div className={`w-full h-full relative group ${isSelected ? 'ring-2 ring-theme-primary' : 'hover:ring-1 hover:ring-white/30'}`}>
                {/* Visual border for 'Behind' layers */}
                {layer.position === 'back' && isSelected && (
                     <div className="absolute inset-0 border-2 border-dashed border-red-400/50 pointer-events-none" />
                )}

                <img
                    src={layer.src}
                    alt="layer"
                    style={{ opacity: layer.opacity }}
                    className={`w-full h-full object-contain pointer-events-none transition-opacity duration-300`}
                />

                {isSelected && (
                    <>
                        <div
                            data-handle="resize"
                            onMouseDown={handleResizeStart}
                            className="absolute -bottom-3 -right-3 w-6 h-6 bg-white rounded-full cursor-nwse-resize border-2 border-theme-primary shadow-md z-50 hover:scale-110 transition-transform"
                        />
                        <div
                            data-handle="rotate"
                            onMouseDown={handleRotateStart}
                            className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-theme-primary rounded-full cursor-grab border-2 border-white shadow-md z-50 flex items-center justify-center hover:scale-110 transition-transform"
                        >
                            <RotateCw className="w-3 h-3 text-white" />
                        </div>
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-px h-8 bg-theme-primary pointer-events-none" />
                    </>
                )}
            </div>
        </div>
    );
};

//-------------------------------------

function AssetsManager() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useToast();

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [uploadPreview, setUploadPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  // Creator State
  const [viewMode, setViewMode] = useState("list");
  const [activeTab, setActiveTab] = useState("design");
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [sampleImage, setSampleImage] = useState(null);

  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const canvasRef = useRef(null);
  const [customPreviews, setCustomPreviews] = useState({ poster: null, background: null });
  const [overwriteConfirm, setOverwriteConfirm] = useState(null);

  // Preview Background State
  const [previewBg, setPreviewBg] = useState("dark"); // 'dark', 'light', 'checker'

  const [options, setOptions] = useState({
    overlay_type: "poster",
    border_enabled: false,
    border_px: 20,
    border_color: "#ffffff",
    corner_radius: 0.0,
    matte_height_ratio: 0.0,
    fade_height_ratio: 0.0,
    gradient_color: "#000000",
    inner_glow_strength: 0.0,
    inner_glow_color: "#000000",
    vignette_strength: 0.0,
    vignette_color: "#000000",
    grain_amount: 0.0,
    grain_size: 1.0,
    blur_amount: 0.0,
    show_text_area: false,
    filename: "custom_overlay"
  });

  useEffect(() => { loadFiles(); }, []);

  useEffect(() => {
    if (viewMode === 'create') {
        const fetchSample = async () => {
            const imagePath = options.overlay_type === "background" ? "/images/default_background.jpg" : "/images/default_poster.jpg";
            setSampleImage(`${imagePath}?t=${Date.now()}`);
        };
        fetchSample();
    }
  }, [options.overlay_type, viewMode]);

  useEffect(() => {
    if (viewMode === "create") {
      const timer = setTimeout(() => { fetchCreatorPreview(); }, 500);
      return () => clearTimeout(timer);
    }
  }, [options.overlay_type, options.border_enabled, options.border_px, options.border_color, options.corner_radius, options.matte_height_ratio, options.fade_height_ratio, options.gradient_color, options.inner_glow_strength, options.inner_glow_color, options.vignette_strength, options.vignette_color, options.grain_amount, options.grain_size, options.blur_amount, options.show_text_area]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/overlayfiles");
      const data = await response.json();
      if (data.success) setFiles(data.files || []);
      else showError(t("overlayAssets.loadFailed"));
    } catch (err) { showError(t("overlayAssets.loadError", { message: err.message })); } finally { setLoading(false); }
  };

  // LAYER MANAGEMENT
  const handleAddLayer = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const aspectRatio = img.width / img.height;
            const newLayer = {
                id: Date.now(),
                src: event.target.result,
                x: 0.35, y: 0.35,
                width: 0.3,
                height: 0.3 / aspectRatio,
                aspectRatio: aspectRatio,
                rotation: 0,
                position: 'front',
                opacity: 1.0
            };
            setLayers(prev => [...prev, newLayer]);
            setSelectedLayerId(newLayer.id);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const updateLayer = (id, newProps) => {
      setLayers(prev => prev.map(l => l.id === id ? { ...l, ...newProps } : l));
  };

  const deleteLayer = (id) => {
      setLayers(prev => prev.filter(l => l.id !== id));
      if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const toggleLayerPosition = (id) => {
      setLayers(prev => prev.map(l => {
          if (l.id === id) {
              return { ...l, position: l.position === 'back' ? 'front' : 'back' };
          }
          return l;
      }));
  };

  const moveLayerOrder = (id, direction) => {
      const index = layers.findIndex(l => l.id === id);
      if (index === -1) return;
      const newLayers = [...layers];
      if (direction === 'up' && index < layers.length - 1) {
          [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
      } else if (direction === 'down' && index > 0) {
          [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
      }
      setLayers(newLayers);
  };

  const handleCustomPreview = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => { setCustomPreviews(prev => ({ ...prev, [options.overlay_type]: e.target.result })); };
      reader.readAsDataURL(file);
    }
  };

  const resetCustomPreview = () => { setCustomPreviews(prev => ({ ...prev, [options.overlay_type]: null })); };

  const fetchCreatorPreview = async () => {
    try {
      setCreatorLoading(true);
      const response = await fetch("/api/overlay-creator/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options),
      });
      const data = await response.json();
      if (data.success) setPreviewImage(`data:image/png;base64,${data.image_base64}`);
    } catch (err) { console.error(err); } finally { setCreatorLoading(false); }
  };

  // SAVE FUNCTION
  const handleSaveOverlay = async (forceOverwrite = false) => {
    if (!options.filename) {
      showError(t("overlayAssets.filenameRequired"));
      return;
    }

    if (layers.length > 0 && previewImage) {
        try {
            setCreatorLoading(true);
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            const baseImg = new Image();
            await new Promise((resolve, reject) => {
                baseImg.onload = resolve;
                baseImg.onerror = reject;
                baseImg.src = previewImage;
            });

            canvas.width = baseImg.naturalWidth;
            canvas.height = baseImg.naturalHeight;

            const drawLayerToCanvas = async (layer) => {
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = layer.src;
                });
                const imgRatio = img.naturalWidth / img.naturalHeight;
                const w = layer.width * canvas.width;
                const h = w / imgRatio;
                const x = layer.x * canvas.width;
                const y = layer.y * canvas.height;
                const centerX = x + w / 2;
                const centerY = y + h / 2;

                ctx.save();
                ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;

                ctx.translate(centerX, centerY);
                ctx.rotate((layer.rotation || 0) * Math.PI / 180);
                ctx.drawImage(img, -w / 2, -h / 2, w, h);
                ctx.restore();
            };

            // 1. Draw BACK Layers
            const backLayers = layers.filter(l => l.position === 'back');
            for (const layer of backLayers) {
                await drawLayerToCanvas(layer);
            }

            // 2. Draw Overlay
            ctx.globalAlpha = 1.0;
            ctx.drawImage(baseImg, 0, 0);

            // 3. Draw FRONT Layers
            const frontLayers = layers.filter(l => l.position !== 'back');
            for (const layer of frontLayers) {
                await drawLayerToCanvas(layer);
            }

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const formData = new FormData();
            const finalFilename = options.filename.endsWith('.png') ? options.filename : `${options.filename}.png`;
            formData.append("file", new File([blob], finalFilename, { type: "image/png" }));

            const response = await fetch("/api/overlayfiles/upload", { method: "POST", body: formData });
            const data = await response.json();
            if (response.ok && data.success) {
                showSuccess(t("overlayAssets.savedSuccess"));
                setViewMode("list");
                loadFiles();
                setLayers([]);
                setOverwriteConfirm(null);
            } else { showError(data.detail || t("overlayAssets.saveFailed")); }
        } catch (err) {
            console.error("Compositing error:", err);
            showError("Failed to combine layers: " + err.message);
        } finally { setCreatorLoading(false); }
        return;
    }

    try {
      setCreatorLoading(true);
      const bodyPayload = { ...options, overwrite: forceOverwrite };
      const response = await fetch("/api/overlay-creator/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyPayload) });
      if (response.status === 409) { setOverwriteConfirm(options.filename); return; }
      const data = await response.json();
      if (data.success) {
        showSuccess(t("overlayAssets.savedSuccess"));
        setViewMode("list");
        loadFiles();
        setOverwriteConfirm(null);
      } else { showError(data.detail || t("overlayAssets.saveFailed")); }
    } catch (err) { showError(err.message); } finally { setCreatorLoading(false); }
  };

  // ... (Standard Handlers)
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileExtension = file.name.split(".").pop().toLowerCase();
    const validExtensions = ["png", "jpg", "jpeg", "ttf", "otf", "woff", "woff2"];
    if (!validExtensions.includes(fileExtension)) { showError(t("overlayAssets.invalidFileType")); return; }
    if (file.size > 10 * 1024 * 1024) { showError(t("overlayAssets.fileTooLarge")); return; }
    setSelectedFile(file);
    if (["png", "jpg", "jpeg"].includes(fileExtension)) {
      const reader = new FileReader();
      reader.onload = (e) => { setUploadPreview(e.target.result); };
      reader.readAsDataURL(file);
    } else { setUploadPreview(null); }
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/overlayfiles/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (response.ok && data.success) {
        showSuccess(data.message || t("overlayAssets.uploadSuccess"));
        await loadFiles();
        event.target.value = "";
        setUploadPreview(null);
        setSelectedFile(null);
      } else { showError(data.detail || t("overlayAssets.uploadFailed")); }
    } catch (err) { showError(t("overlayAssets.uploadError", { message: err.message })); } finally { setUploading(false); }
  };

  const handleDelete = async (filename) => {
    try {
      const response = await fetch(`/api/overlayfiles/${encodeURIComponent(filename)}`, { method: "DELETE" });
      const data = await response.json();
      if (response.ok && data.success) {
        showSuccess(data.message || t("overlayAssets.deleteSuccess"));
        await loadFiles();
        setDeleteConfirm(null);
      } else { showError(data.detail || t("overlayAssets.deleteFailed")); }
    } catch (err) { showError(t("overlayAssets.deleteError", { message: err.message })); }
  };

  const getFileExtension = (filename) => filename.split(".").pop().toUpperCase();
  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };
  const filteredFiles = files.filter((file) => {
    if (filterType === "all") return true;
    return file.type === filterType;
  });
  const imageCount = files.filter((f) => f.type === "image").length;
  const fontCount = files.filter((f) => f.type === "font").length;
  const currentActivePreview = customPreviews[options.overlay_type];

  return (
    <div className="workspace-page space-y-6" onClick={() => setSelectedLayerId(null)}>
      <ScrollToButtons />

      {/* Header */}
            <WorkspaceHeader icon={FileImage} title={t("overlayAssets.title", "Overlay Assets")}>
        <div className="flex bg-theme-hover p-1 rounded-lg border border-theme self-end sm:self-auto">
            <button onClick={() => setViewMode("list")} className={`px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors text-sm font-medium ${viewMode === "list" ? "bg-theme-primary text-white shadow-sm" : "text-theme-muted hover:text-white"}`}>
                <FileImage className="w-4 h-4" /> {t("overlayAssets.list") || "Asset Library"}
            </button>
            <button onClick={() => { setViewMode("create"); fetchCreatorPreview(); }} className={`px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors text-sm font-medium ${viewMode === "create" ? "bg-theme-primary text-white shadow-sm" : "text-theme-muted hover:text-white"}`}>
                <LayoutTemplate className="w-4 h-4" /> {t("overlayAssets.create") || "Overlay Creator"}
            </button>
        </div>
    </WorkspaceHeader>

      {/* ================= CREATOR MODE ================= */}
      {viewMode === "create" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
            {/* Editor Controls */}
            <div className="lg:col-span-1 bg-theme-card border border-theme rounded-lg overflow-hidden h-fit max-h-[85vh] flex flex-col">
                <div className="flex border-b border-theme">
                    <button onClick={() => setActiveTab("design")} className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "design" ? "bg-theme-hover text-theme-primary border-b-2 border-theme-primary" : "text-theme-muted hover:text-white"}`}>
                        <Palette className="w-4 h-4" /> {t("overlayAssets.tabs.design")}
                    </button>
                    <button onClick={() => setActiveTab("layers")} className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "layers" ? "bg-theme-hover text-theme-primary border-b-2 border-theme-primary" : "text-theme-muted hover:text-white"}`}>
                        <Layers className="w-4 h-4" /> {t("overlayAssets.tabs.layers")} <span className="text-xs bg-theme-primary/20 px-1.5 rounded-full ml-1">{layers.length}</span>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
                    {activeTab === "design" && (
                    <>
                        <div className="grid grid-cols-2 gap-2 bg-theme-input p-1 rounded-lg">
                            <button onClick={() => setOptions({...options, overlay_type: "poster"})} className={`py-2 px-3 rounded flex items-center justify-center gap-2 text-sm transition-all ${options.overlay_type === "poster" ? "bg-theme-primary text-white shadow" : "text-theme-muted hover:text-theme-text"}`}>
                                <Smartphone className="w-4 h-4" /> {t("overlayAssets.posterRatio")}
                            </button>
                            <button onClick={() => setOptions({...options, overlay_type: "background"})} className={`py-2 px-3 rounded flex items-center justify-center gap-2 text-sm transition-all ${options.overlay_type === "background" ? "bg-theme-primary text-white shadow" : "text-theme-muted hover:text-theme-text"}`}>
                                <Monitor className="w-4 h-4" /> {t("overlayAssets.backgroundRatio")}
                            </button>
                        </div>
                        <div className="space-y-4">
                            <label className="relative inline-flex items-center cursor-pointer group">
                                <input type="checkbox" checked={options.border_enabled} onChange={e => setOptions({...options, border_enabled: e.target.checked})} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-theme-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-theme-primary"></div>
                                <span className="ml-3 text-sm font-medium text-theme-text group-hover:text-theme-primary transition-colors">{t("overlayAssets.enableBorder")}</span>
                            </label>

                            {options.border_enabled && (
                                <div className="pl-4 space-y-4 border-l-2 border-theme-border ml-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div>
                                        <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.thickness")}</span><span className="text-theme-text font-mono">{options.border_px}px</span></div>
                                        <input type="range" min="0" max="200" value={options.border_px} onChange={e => setOptions({...options, border_px: parseInt(e.target.value)})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.roundedCorners")}</span><span className="text-theme-text font-mono">{Math.round(options.corner_radius * 100)}%</span></div>
                                        <input type="range" min="0" max="50" value={options.corner_radius * 100} onChange={e => setOptions({...options, corner_radius: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                                    </div>
                                    <div>
                                        <label className="text-sm text-theme-muted block mb-2">{t("overlayAssets.color")}</label>
                                        <div className="flex gap-2">
                                            <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-theme shadow-sm"><input type="color" value={options.border_color} onChange={e => setOptions({...options, border_color: e.target.value})} className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer p-0 border-0" /></div>
                                            <input type="text" value={options.border_color} onChange={e => setOptions({...options, border_color: e.target.value})} className="flex-1 bg-transparent border border-theme rounded-lg px-3 text-sm text-white font-mono uppercase focus:border-theme-primary focus:outline-none" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="h-px bg-theme-border" />
                        <div className="space-y-6">
                            <h3 className="text-sm font-medium text-theme-text">{t("overlayAssets.effects")}</h3>
                            {/* BLUR SLIDER START */}
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-theme-muted">{t("overlayAssets.blurStrength") || "Blur Strength"}</span>
                                    <span className="text-theme-text font-mono">{options.blur_amount}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="400"
                                    step="1"
                                    value={options.blur_amount}
                                    onChange={e => setOptions({...options, blur_amount: parseFloat(e.target.value)})}
                                    className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.vignette")}</span><span className="text-theme-text font-mono">{Math.round(options.vignette_strength * 100)}%</span></div>
                                <input type="range" min="0" max="100" value={options.vignette_strength * 100} onChange={e => setOptions({...options, vignette_strength: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                                {options.vignette_strength > 0 && (<ColorInput value={options.vignette_color} onChange={val => setOptions({...options, vignette_color: val})} label={t("overlayAssets.color")} />)}
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.innerGlow")}</span><span className="text-theme-text font-mono">{Math.round(options.inner_glow_strength * 100)}%</span></div>
                                <input type="range" min="0" max="100" value={options.inner_glow_strength * 100} onChange={e => setOptions({...options, inner_glow_strength: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                                {options.inner_glow_strength > 0 && (<ColorInput value={options.inner_glow_color} onChange={val => setOptions({...options, inner_glow_color: val})} label={t("overlayAssets.color")} />)}
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.filmGrainIntensity")}</span><span className="text-theme-text font-mono">{Math.round(options.grain_amount * 100)}%</span></div>
                                <input type="range" min="0" max="100" value={options.grain_amount * 100} onChange={e => setOptions({...options, grain_amount: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                            </div>
                        </div>
                        <div className="h-px bg-theme-border" />
                        <div className="space-y-4">
                            <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-theme-text">{t("overlayAssets.bottomGradient")}</h3></div>
                            <div>
                                <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.matteHeight")}</span><span className="text-theme-text font-mono">{Math.round(options.matte_height_ratio * 100)}%</span></div>
                                <input type="range" min="0" max="50" value={options.matte_height_ratio * 100} onChange={e => setOptions({...options, matte_height_ratio: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2"><span className="text-theme-muted">{t("overlayAssets.fadeHeight")}</span><span className="text-theme-text font-mono">{Math.round(options.fade_height_ratio * 100)}%</span></div>
                                <input type="range" min="0" max="50" value={options.fade_height_ratio * 100} onChange={e => setOptions({...options, fade_height_ratio: e.target.value / 100})} className="w-full h-2 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary" />
                            </div>
                            {(options.matte_height_ratio > 0 || options.fade_height_ratio > 0) && (<ColorInput value={options.gradient_color} onChange={val => setOptions({...options, gradient_color: val})} label={t("overlayAssets.color")} />)}
                        </div>
                    </>
                    )}

                    {activeTab === "layers" && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="bg-theme-input p-4 rounded-lg border border-theme border-dashed text-center">
                            <label className="cursor-pointer block">
                                <Upload className="w-8 h-8 text-theme-primary mx-auto mb-2" />
                                <span className="text-sm text-theme-text font-medium block">{t("overlayAssets.layers.uploadTitle")}</span>
                                <span className="text-xs text-theme-muted">{t("overlayAssets.layers.uploadDesc")}</span>
                                <input type="file" accept="image/*" onChange={handleAddLayer} className="hidden" />
                            </label>
                        </div>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                            {layers.length === 0 && (<p className="text-center text-theme-muted text-sm py-4">{t("overlayAssets.layers.empty")}</p>)}
                            {[...layers].reverse().map((layer) => {
                                const originalIndex = layers.findIndex(l => l.id === layer.id);
                                return (
                                    <div key={layer.id} onClick={(e) => { e.stopPropagation(); setSelectedLayerId(layer.id); }} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-all ${selectedLayerId === layer.id ? 'bg-theme-hover border-theme-primary' : 'bg-theme-card border-theme hover:border-gray-500'}`}>
                                        <div className="w-10 h-10 bg-black/50 rounded flex items-center justify-center overflow-hidden shrink-0"><img src={layer.src} alt="thumbnail" className="max-w-full max-h-full" /></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-theme-text font-medium truncate">{t("overlayAssets.layers.name", { index: originalIndex + 1 })}</p>
                                            <div className="flex gap-2 items-center">
                                                <span className={`text-[10px] uppercase px-1.5 rounded-sm ${layer.position === 'back' ? 'bg-purple-900/50 text-purple-200 border border-purple-500/30' : 'bg-blue-900/50 text-blue-200 border border-blue-500/30'}`}>
                                                    {layer.position === 'back' ? t("overlayAssets.layers.behind") : t("overlayAssets.layers.front")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {/* OPACITY SLIDER */}
                                            {layer.position === 'back' && (
                                                <div className="flex flex-col items-end justify-center w-16 mr-2 group" onClick={(e) => e.stopPropagation()} title={t("overlayAssets.controls.adjustOpacity")}>
                                                    <span className="text-[9px] text-theme-muted leading-none mb-0.5">{Math.round(layer.opacity * 100)}%</span>
                                                    <input
                                                        type="range"
                                                        min="0" max="1" step="0.05"
                                                        value={layer.opacity}
                                                        onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
                                                        className="w-full h-1.5 bg-theme-input rounded-lg appearance-none cursor-pointer accent-theme-primary"
                                                    />
                                                </div>
                                            )}

                                            <button onClick={(e) => { e.stopPropagation(); toggleLayerPosition(layer.id) }} className="p-1 hover:bg-white/10 rounded" title={layer.position === 'back' ? t("overlayAssets.controls.bringFront") : t("overlayAssets.controls.sendBack")}>
                                                {layer.position === 'back' ? <BringToFront className="w-4 h-4 text-theme-primary" /> : <SendToBack className="w-4 h-4 text-theme-text" />}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); moveLayerOrder(layer.id, 'up')}} className="p-1 hover:bg-white/10 rounded" title={t("overlayAssets.controls.moveUp")}><ArrowUp className="w-4 h-4 text-theme-text" /></button>
                                            <button onClick={(e) => { e.stopPropagation(); moveLayerOrder(layer.id, 'down')}} className="p-1 hover:bg-white/10 rounded" title={t("overlayAssets.controls.moveDown")}><ArrowDown className="w-4 h-4 text-theme-text" /></button>
                                            <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id)}} className="p-1 hover:bg-red-500/20 rounded group" title={t("overlayAssets.controls.delete")}><Trash2 className="w-4 h-4 text-theme-muted group-hover:text-red-500" /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded text-xs text-blue-200">
                            <p className="flex items-center gap-2 mb-1 font-semibold"><Move className="w-3 h-3"/> {t("overlayAssets.help.title")}</p>
                            <p>{t("overlayAssets.help.text")}</p>
                            <p>{t("overlayAssets.help.text2")}</p>
                        </div>
                    </div>
                    )}
                </div>

                <div className="p-6 border-t border-theme bg-theme-card mt-auto">
                    <div>
                        <label className="text-sm font-medium text-theme-text block mb-2">{t("overlayAssets.saveAs")}</label>
                        <div className="flex items-center gap-2 bg-theme-input border border-theme rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-theme-primary/30 transition-all mb-4">
                            <input type="text" value={options.filename} onChange={e => setOptions({...options, filename: e.target.value})} placeholder="my_overlay" className="flex-1 bg-transparent text-theme-text border-none focus:outline-none placeholder-theme-muted" />
                            <span className="text-theme-muted text-sm font-mono border-l border-theme pl-2">.png</span>
                        </div>
                    </div>
                    <button onClick={() => handleSaveOverlay(false)} disabled={creatorLoading} className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-md">
                        {creatorLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        {t("overlayAssets.generateAndSave")}
                    </button>
                </div>
            </div>

            {/* Preview Panel */}
            <div className="lg:col-span-2 bg-theme-card border border-theme rounded-lg p-6 flex flex-col min-h-[600px]">
                <div className="flex flex-wrap items-center justify-between mb-4 gap-4">
                    <h3 className="text-theme-muted text-sm font-medium uppercase tracking-wide flex items-center gap-2">
                        {t("overlayAssets.livePreview")}
                        <span className="bg-theme-hover px-2 py-0.5 rounded text-xs normal-case">
                            {options.overlay_type === "background" ? "16:9" : "2:3"}
                        </span>
                    </h3>

                    {/* Background Controls & Upload Actions */}
                    <div className="flex items-center gap-3">
                        <BackgroundToggle current={previewBg} onChange={setPreviewBg} className="mr-2" />

                        {/* Existing Loading/Reset logic */}
                        {creatorLoading && (
                            <span className="text-xs text-theme-primary flex items-center gap-1 animate-pulse">
                                <RefreshCw className="w-3 h-3 animate-spin"/> {t("overlayAssets.updating")}
                            </span>
                        )}

                        <div className="h-4 w-px bg-theme-border mx-1"></div>

                        {currentActivePreview ? (
                            <button onClick={resetCustomPreview} className="px-3 py-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-md flex items-center gap-2 transition-all hover:shadow-sm" title={t("overlayAssets.resetSample")}>
                                <RotateCcw className="w-3 h-3" /> {t("overlayAssets.resetSample")}
                            </button>
                        ) : (
                            <label className="px-3 py-1.5 text-xs font-medium bg-theme-primary/10 hover:bg-theme-primary/20 text-theme-primary border border-theme-primary/20 rounded-md flex items-center gap-2 cursor-pointer transition-all hover:shadow-sm" title={t("overlayAssets.uploadSample")}>
                                <ImagePlus className="w-3 h-3" /> {t("overlayAssets.uploadSample")}
                                <input type="file" accept="image/*" onChange={handleCustomPreview} className="hidden" />
                            </label>
                        )}
                    </div>
                </div>

                {/* Dynamic Background Container */}
                <div className={`flex-1 rounded-lg border border-theme/50 relative overflow-hidden flex items-center justify-center p-8 transition-colors duration-300 ${getBackgroundClass(previewBg)}`}>
                    <div ref={canvasRef} className={`relative shadow-2xl bg-gray-800 rounded-sm ring-1 ring-white/10 group w-full ${options.overlay_type === 'background' ? 'aspect-video max-w-4xl' : 'aspect-[2/3] max-w-sm'}`}>
                        {/* 1. Base Content (Sample Image) */}
                        <div className="absolute inset-0 flex items-center justify-center text-gray-700 bg-gray-800 z-0 pointer-events-none">
                            {currentActivePreview ? (<img src={currentActivePreview} alt="Custom Sample" className="w-full h-full object-cover" />) : sampleImage ? (<img src={sampleImage} alt="Sample" className="w-full h-full object-cover" />) : (<div className="text-center"><ImageIcon className="w-16 h-16 mx-auto mb-2 opacity-20" /></div>)}
                        </div>

                        {/* 2. Generated Overlay Effect (Z-Index 50) */}
                        {previewImage && (<img src={previewImage} alt="Overlay Preview" className="absolute inset-0 w-full h-full object-contain z-[50] pointer-events-none" />)}

                        {/* 3. Interactive Layers (Z-Index determined inside component) */}
                        {layers.map((layer, index) => (
                            <InteractiveLayer key={layer.id} layer={layer} index={index} isSelected={selectedLayerId === layer.id} onSelect={setSelectedLayerId} onChange={updateLayer} parentRef={canvasRef} />
                        ))}
                    </div>
                </div>
                <p className="text-center text-xs text-theme-muted mt-4">
                    {activeTab === 'layers' ? t("overlayAssets.help.text") : (currentActivePreview ? t("overlayAssets.customBackground") : t("overlayAssets.previewHint"))}
                </p>
            </div>
        </div>
      )}

      {/* List Mode, Modals, etc. */}
      {viewMode === "list" && (
        <div className="animate-in fade-in duration-300">
            <div className="bg-theme-card border border-theme rounded-lg p-6 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                        <Upload className="w-5 h-5 text-theme-primary" />
                        <h2 className="text-xl font-semibold text-theme-text">{t("overlayAssets.uploadTitle")}</h2>
                    </div>
                </div>
                <div className="border-2 border-dashed border-theme rounded-lg p-8 text-center">
                    <input type="file" id="file-upload" accept="image/png,image/jpeg,image/jpg,.ttf,.otf,.woff,.woff2" onChange={handleFileUpload} disabled={uploading} className="hidden" />
                    <label htmlFor="file-upload" className={`cursor-pointer ${uploading ? "opacity-50" : ""}`}>
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center">{uploading ? (<Loader2 className="w-8 h-8 text-theme-primary animate-spin" />) : (<Upload className="w-8 h-8 text-theme-primary" />)}</div>
                            <div><p className="text-theme-text font-medium mb-1">{uploading ? t("overlayAssets.uploading") : t("overlayAssets.clickToUpload")}</p></div>
                        </div>
                    </label>
                </div>
            </div>
            <div className="bg-theme-card border border-theme rounded-lg p-6">
                <div className="flex flex-wrap items-center justify-between mb-4 gap-4">
                    <h3 className="font-semibold text-theme-text">Your Assets</h3>
                    <div className="flex items-center gap-2">
                         <span className="text-xs text-theme-muted mr-2">Preview Background:</span>
                         <BackgroundToggle current={previewBg} onChange={setPreviewBg} />
                    </div>
                </div>

                 {loading ? (<div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-theme-primary animate-spin" /></div>) : filteredFiles.length === 0 ? (<div className="text-center py-12"><ImageIcon className="w-16 h-16 text-theme-muted mx-auto mb-4 opacity-50" /><p className="text-theme-muted text-lg mb-2">{t("overlayAssets.noFiles")}</p></div>) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredFiles.map((file) => (
                            <div key={file.name} className="bg-theme-card border-2 border-theme rounded-lg overflow-hidden group hover:border-theme-primary hover:shadow-lg hover:shadow-theme-primary/20 transition-all duration-300">
                                {/* DYNAMIC BACKGROUND APPLIED HERE */}
                                <div className={`aspect-square relative overflow-hidden flex items-center justify-center transition-colors duration-300 ${getBackgroundClass(previewBg)}`}>
                                    {file.type === "image" ? (
                                        <img
                                            src={`/api/overlayfiles/preview/${file.name}?v=${file.mtime}`}
                                            alt={file.name}
                                            className="max-w-full max-h-full object-contain"
                                        />
                                    ) : file.type === "font" ? (
                                        <img
                                            src={`/api/fonts/preview/${file.name}?text=Abc&v=${file.size}`}
                                            alt={file.name}
                                            className="max-w-full max-h-full object-contain bg-white/90 p-2 rounded-md"
                                        />
                                    ) : (
                                        <Type className="w-12 h-12 text-theme-muted" />
                                    )}
                                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button onClick={() => setPreviewFile(file)} className="p-2 bg-theme-primary rounded text-white"><Eye size={20} /></button>
                                        <button onClick={() => setDeleteConfirm(file)} className="p-2 bg-red-500 rounded text-white"><Trash2 size={20} /></button>
                                    </div>
                                </div>
                                <div className="p-3 bg-theme-card"><p className="text-sm font-medium text-theme-text truncate">{file.name}</p><p className="text-xs text-theme-muted">{formatFileSize(file.size)}</p></div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
          <div className="relative max-w-7xl max-h-[90vh] bg-theme-card rounded-lg overflow-hidden flex flex-col w-full h-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewFile(null)} className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors"><X className="w-6 h-6" /></button>

            <div className="flex flex-col md:flex-row h-full">
              {/* Modal Image Area */}
              <div className={`flex-1 flex items-center justify-center p-4 relative transition-colors duration-300 ${getBackgroundClass(previewBg)}`}>

                {/* Floating Toggles inside Modal */}
                <div className="absolute top-4 left-4 z-10">
                    <BackgroundToggle current={previewBg} onChange={setPreviewBg} className="bg-theme-card/90 shadow-xl border-theme-primary/30" />
                </div>

                {previewFile.type === "image" ? (
                    <img src={`/api/overlayfiles/preview/${previewFile.name}?v=${previewFile.mtime}`} alt={previewFile.name} className="relative z-0 max-w-full max-h-[80vh] object-contain shadow-2xl" />
                ) : (
                    <div className="w-full max-h-[80vh] overflow-y-auto px-4 py-8">
                        <img src={`/api/fonts/preview/${previewFile.name}?text=The Quick Brown Fox&v=${previewFile.size}`} alt="Sample text" className="w-full h-auto object-contain bg-white rounded p-4 shadow-xl" loading="lazy" />
                    </div>
                )}
              </div>

              <div className="md:w-80 p-6 bg-theme-card overflow-y-auto border-l border-theme shrink-0">
                <h3 className="text-xl font-bold text-theme-text mb-4">Details</h3>
                <div className="space-y-4"><div><label className="text-sm text-theme-muted">Filename</label><p className="text-theme-text break-all font-mono text-sm mt-1">{previewFile.name}</p></div></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-theme-card border border-theme rounded-lg max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
             <h3 className="text-lg font-semibold text-theme-text mb-2">{t("overlayAssets.deleteTitle")}</h3>
             <div className="flex gap-3 justify-end mt-4"><button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-theme-hover text-theme-text rounded">{t("overlayAssets.cancel")}</button><button onClick={() => handleDelete(deleteConfirm.name)} className="px-4 py-2 bg-red-500 text-white rounded">{t("overlayAssets.delete")}</button></div>
          </div>
        </div>
      )}

      {/* Overwrite Modal */}
      {overwriteConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setOverwriteConfirm(null)}>
          <div className="bg-theme-card border border-theme rounded-lg max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-theme-text mb-2">{t("overlayAssets.fileExistsTitle")}</h3>
            <div className="flex gap-3 justify-end mt-4"><button onClick={() => setOverwriteConfirm(null)} className="px-4 py-2 bg-theme-hover text-theme-text rounded">{t("overlayAssets.cancel")}</button><button onClick={() => handleSaveOverlay(true)} className="px-4 py-2 bg-theme-primary text-white rounded">{t("overlayAssets.overwrite")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AssetsManager;