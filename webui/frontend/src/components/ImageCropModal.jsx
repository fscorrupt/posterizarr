import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, ZoomIn, Check, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * ImageCropModal
 * Allows cropping any uploaded image (e.g. 16:9 backdrop) to a fixed aspect ratio
 * (such as 2:3 poster at 2000x3000 px) with drag-to-position, click-to-center, and zoom.
 */
function ImageCropModal({
  isOpen,
  onClose,
  imageSrc,
  originalFile,
  targetRatio = 2 / 3,
  targetWidth = 2000,
  targetHeight = 3000,
  assetType = "poster",
  onCropComplete,
}) {
  const { t } = useTranslation();

  const [imgElement, setImgElement] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 }); // top-left in natural image coordinates
  const [isDragging, setIsDragging] = useState(false);
  const [containerDimensions, setContainerDimensions] = useState({ width: 700, height: 420 });

  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const hasMovedRef = useRef(false);
  const zoomRef = useRef(zoom);

  // Keep ref in sync
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Determine whether this is a backdrop being cropped to a poster
  const isPosterTarget = assetType === "poster" || assetType === "season" || assetType === "collection";
  const isBackdropSource = naturalSize.width > 0 && naturalSize.width > naturalSize.height;

  // Base crop size (at zoom = 1)
  const getBaseCropSize = useCallback(() => {
    const { width: nw, height: nh } = naturalSize;
    if (!nw || !nh) return { width: 0, height: 0 };
    if (nw / nh >= targetRatio) {
      return { width: nh * targetRatio, height: nh };
    }
    return { width: nw, height: nw / targetRatio };
  }, [naturalSize, targetRatio]);

  const baseCrop = getBaseCropSize();
  const currentCropW = zoom > 0 ? baseCrop.width / zoom : baseCrop.width;
  const currentCropH = zoom > 0 ? baseCrop.height / zoom : baseCrop.height;

  // Load natural image dimensions when imageSrc changes
  useEffect(() => {
    if (!imageSrc || !isOpen) {
      setImgElement(null);
      setNaturalSize({ width: 0, height: 0 });
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImgElement(img);
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      setNaturalSize({ width: nw, height: nh });

      // Calculate initial crop box (at zoom = 1)
      let baseW, baseH;
      if (nw / nh >= targetRatio) {
        baseH = nh;
        baseW = nh * targetRatio;
      } else {
        baseW = nw;
        baseH = nw / targetRatio;
      }

      setZoom(1);
      // Center the crop box
      setCropPos({
        x: Math.max(0, (nw - baseW) / 2),
        y: Math.max(0, (nh - baseH) / 2),
      });
    };
    img.src = imageSrc;
  }, [imageSrc, isOpen, targetRatio]);

  useEffect(() => {
    if (!isOpen) return;
    const updateSize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw < 640;
      const padX = isMobile ? 28 : 64;
      const padY = isMobile ? 210 : 260;
      const maxW = Math.min(880, Math.max(240, vw - padX));
      const maxH = Math.min(520, Math.max(180, vh - padY));
      setContainerDimensions({ width: maxW, height: maxH });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [isOpen]);

  const displayScale = naturalSize.width > 0 && naturalSize.height > 0
    ? Math.min(
        containerDimensions.width / naturalSize.width,
        containerDimensions.height / naturalSize.height
      )
    : 1;

  const displayWidth = naturalSize.width * displayScale;
  const displayHeight = naturalSize.height * displayScale;

  const displayCropX = cropPos.x * displayScale;
  const displayCropY = cropPos.y * displayScale;
  const displayCropW = currentCropW * displayScale;
  const displayCropH = currentCropH * displayScale;

  // Zoom handler: keeps current center point in focus
  const handleZoomChange = useCallback((newZoom) => {
    const clampedZoom = Math.max(1, Math.min(4, newZoom));
    const nw = naturalSize.width;
    const nh = naturalSize.height;
    if (!nw || !nh) return;

    const currentCenterX = cropPos.x + currentCropW / 2;
    const currentCenterY = cropPos.y + currentCropH / 2;

    const nextW = baseCrop.width / clampedZoom;
    const nextH = baseCrop.height / clampedZoom;

    const nextX = Math.max(0, Math.min(nw - nextW, currentCenterX - nextW / 2));
    const nextY = Math.max(0, Math.min(nh - nextH, currentCenterY - nextH / 2));

    setZoom(clampedZoom);
    setCropPos({ x: nextX, y: nextY });
  }, [naturalSize, currentCropW, currentCropH, baseCrop, cropPos]);

  // Native touch pinch-to-zoom support for mobile/tablet screens
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pinchState = null;

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        pinchState = {
          startDist: dist,
          startZoom: zoomRef.current,
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchState && pinchState.startDist > 0) {
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const factor = dist / pinchState.startDist;
        handleZoomChange(pinchState.startZoom * factor);
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinchState = null;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [handleZoomChange]);

  // Dragging the crop frame with pointer capture for touchscreens and mouse
  const handlePointerDown = (e) => {
    if (e.pointerType === "touch" && !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();

    const targetEl = e.currentTarget;
    if (targetEl && targetEl.setPointerCapture) {
      try {
        targetEl.setPointerCapture(e.pointerId);
      } catch (err) {}
    }

    hasMovedRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      targetEl: targetEl,
      startX: e.clientX,
      startY: e.clientY,
      initialCropX: cropPos.x,
      initialCropY: cropPos.y,
    };
    setIsDragging(true);

    const onPointerMove = (moveEvent) => {
      if (!dragRef.current) return;
      if (moveEvent.pointerId !== undefined && dragRef.current.pointerId !== undefined && moveEvent.pointerId !== dragRef.current.pointerId) return;

      const dx = (moveEvent.clientX - dragRef.current.startX) / displayScale;
      const dy = (moveEvent.clientY - dragRef.current.startY) / displayScale;

      if (Math.abs(moveEvent.clientX - dragRef.current.startX) > 3 || Math.abs(moveEvent.clientY - dragRef.current.startY) > 3) {
        hasMovedRef.current = true;
      }

      const nextX = Math.max(
        0,
        Math.min(naturalSize.width - currentCropW, dragRef.current.initialCropX + dx)
      );
      const nextY = Math.max(
        0,
        Math.min(naturalSize.height - currentCropH, dragRef.current.initialCropY + dy)
      );

      setCropPos({ x: nextX, y: nextY });
    };

    const onPointerUp = (upEvent) => {
      if (dragRef.current?.targetEl && dragRef.current.targetEl.releasePointerCapture && dragRef.current.pointerId !== undefined) {
        try {
          dragRef.current.targetEl.releasePointerCapture(dragRef.current.pointerId);
        } catch (err) {}
      }
      dragRef.current = null;
      setIsDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  // Click on background image to move frame center
  const handleImageClick = (e) => {
    if (hasMovedRef.current) {
      hasMovedRef.current = false;
      return;
    }
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const natClickX = clickX / displayScale;
    const natClickY = clickY / displayScale;

    const nextX = Math.max(
      0,
      Math.min(naturalSize.width - currentCropW, natClickX - currentCropW / 2)
    );
    const nextY = Math.max(
      0,
      Math.min(naturalSize.height - currentCropH, natClickY - currentCropH / 2)
    );

    setCropPos({ x: nextX, y: nextY });
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    handleZoomChange(zoom + delta);
  };

  // Execute crop to high-res canvas
  const handleApplyCrop = () => {
    if (!imgElement || !naturalSize.width || !naturalSize.height) return;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      imgElement,
      cropPos.x,
      cropPos.y,
      currentCropW,
      currentCropH,
      0,
      0,
      targetWidth,
      targetHeight
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const originalBase = originalFile?.name
          ? originalFile.name.replace(/\.[^.]+$/, "")
          : "poster";
        const croppedFile = new File([blob], `${originalBase}_cropped.jpg`, {
          type: "image/jpeg",
        });

        const reader = new FileReader();
        reader.onloadend = () => {
          onCropComplete({
            file: croppedFile,
            dataUrl: reader.result,
            width: targetWidth,
            height: targetHeight,
          });
          onClose();
        };
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.95
    );
  };

  if (!isOpen) return null;

  const cropIntW = Math.round(currentCropW);
  const cropIntH = Math.round(currentCropH);
  const scaleMultiplier = (targetWidth / Math.max(1, cropIntW));
  const isEnlarged = scaleMultiplier > 1.05;

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[70] p-3 sm:p-5 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme rounded-xl max-w-4xl w-full max-h-[95vh] overflow-hidden flex flex-col shadow-2xl animate-scaleIn select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 sm:p-5 border-b border-theme bg-theme-hover/20">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-theme-text">
              {isPosterTarget && isBackdropSource
                ? t("assetReplacer.cropPosterTitle", "Crop a poster from this backdrop")
                : t("assetReplacer.cropImageTitle", "Crop image")}
            </h3>
            <p className="text-xs sm:text-sm text-theme-muted mt-0.5">
              {t(
                "assetReplacer.cropDescription",
                "Drag the frame, or click the picture to move it there. Zoom in to use a smaller part."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-theme-muted hover:text-theme-text rounded-lg hover:bg-theme-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Center Preview Viewport */}
        <div
          className="flex-1 bg-black/90 p-2 sm:p-5 flex items-center justify-center overflow-hidden min-h-[180px] sm:min-h-[300px]"
          onWheel={handleWheel}
        >
          {naturalSize.width > 0 && (
            <div
              ref={containerRef}
              onClick={handleImageClick}
              className="relative overflow-hidden cursor-crosshair rounded shadow-lg border border-white/10 touch-none select-none"
              style={{
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
              }}
            >
              {/* Source Image */}
              <img
                src={imageSrc}
                alt=""
                draggable={false}
                className="w-full h-full object-fill pointer-events-none select-none block"
              />

              {/* Crop Frame with Dark Box-Shadow Mask */}
              <div
                onPointerDown={handlePointerDown}
                className={`absolute border-2 border-blue-400 touch-none ${
                  isDragging ? "cursor-grabbing" : "cursor-move"
                }`}
                style={{
                  left: `${displayCropX}px`,
                  top: `${displayCropY}px`,
                  width: `${displayCropW}px`,
                  height: `${displayCropH}px`,
                  boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.65)",
                }}
              >
                {/* Subtle Rule-of-Thirds Grid */}
                <div className="absolute inset-0 pointer-events-none opacity-40">
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/20" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/20" />
                  <div className="absolute top-1/3 left-0 right-0 border-t border-white/20" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-white/20" />
                </div>

                {/* Center Crosshair (matching screenshot) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-5 h-5 flex items-center justify-center">
                    <div className="absolute w-4 h-0.5 bg-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                    <div className="absolute h-4 w-0.5 bg-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                  </div>
                </div>

                {/* Corner Accents */}
                <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-white pointer-events-none" />
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-white pointer-events-none" />
                <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-white pointer-events-none" />
                <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-white pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div className="p-3 sm:p-5 border-t border-theme bg-theme-card flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 overflow-y-auto max-h-[40vh] sm:max-h-none">
          {/* Zoom Slider */}
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <span className="text-xs font-semibold text-theme-muted uppercase tracking-wider flex items-center gap-1.5 shrink-0">
              <ZoomIn className="w-3.5 h-3.5 text-theme-primary" />
              {t("assetReplacer.zoom", "Zoom")}
            </span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="flex-1 sm:w-48 sm:flex-initial accent-theme-primary cursor-pointer h-2"
            />
            <span className="text-xs font-mono text-theme-muted min-w-[3.5ch] text-right shrink-0">
              {zoom.toFixed(1)}x
            </span>
            {zoom > 1 && (
              <button
                type="button"
                onClick={() => handleZoomChange(1)}
                title="Reset zoom"
                className="p-1 text-theme-muted hover:text-theme-text rounded transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dimension Info and Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
            <div className="text-xs text-theme-muted font-mono text-center sm:text-right">
              <span>
                {cropIntW} × {cropIntH} px, {t("assetReplacer.scaledTo", "scaled to")}{" "}
                <span className="text-theme-text font-semibold">{targetWidth} × {targetHeight}</span>
                {isEnlarged && (
                  <span className="text-theme-muted/80 ml-1">
                    ({scaleMultiplier.toFixed(1)}× {t("assetReplacer.enlarged", "enlarged")})
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-lg border border-theme text-theme-muted hover:text-theme-text hover:bg-theme-hover text-xs sm:text-sm font-medium transition-colors"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleApplyCrop}
                className="flex-1 sm:flex-initial px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                {t("assetReplacer.useThisCrop", "Use this crop")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImageCropModal;

