import React, { useState, useEffect } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import SiloSupportNotice from "../SiloSupportNotice";

const API_URL = "/api";

const RestoreModeModal = React.memo(({ show, onClose, onStart, loading, status, initialLibrary = "", initialItem = "" }) => {
  const [restoreScope, setRestoreScope] = useState(initialLibrary ? "specific" : "all");
  const [libraryName, setLibraryName] = useState(initialLibrary);
  const [itemName, setItemName] = useState(initialItem);
  const [assetType, setAssetType] = useState("");

  const [libraryItems, setLibraryItems] = useState([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);

  // Update local state if initial props change
  useEffect(() => {
    if (show) {
      if (initialLibrary) {
        setRestoreScope("specific");
        setLibraryName(initialLibrary);
      } else {
        setRestoreScope("all");
        setLibraryName("");
      }
      setItemName(initialItem);
      setAssetType("");
    }
  }, [show, initialLibrary, initialItem]);

  // Fetch libraries
  useEffect(() => {
    if (show && restoreScope === "specific") {
      setLoadingLibraries(true);
      fetch(`${API_URL}/backup-assets-gallery`)
        .then((res) => res.json())
        .then((data) => {
          const allLibraries = data.libraries || [];
          setLibraryItems(allLibraries.filter((lib) => lib.is_configured));
        })
        .catch((err) => console.error("Error fetching libraries:", err))
        .finally(() => setLoadingLibraries(false));
    }
  }, [show, restoreScope]);

  if (!show) return null;

  const handleStart = () => {
    if (restoreScope === "specific") {
      onStart({
        library_name: libraryName,
        item_name: itemName,
        asset_type: assetType
      });
    } else {
      onStart({
        library_name: "",
        item_name: "",
        asset_type: ""
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-theme-card border border-theme-primary rounded-xl max-w-2xl w-full shadow-2xl animate-in fade-in duration-200">
        <div className="bg-theme-primary px-6 py-4 rounded-t-xl flex items-center justify-between">
          <div className="flex items-center">
            <Upload className="w-6 h-6 mr-3 text-white" />
            <h3 className="text-xl font-bold text-white">Restore Mode</h3>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-all p-1 hover:bg-white/10 rounded">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <SiloSupportNotice scope="backup" />
          <div className="bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded mb-4">
            <p className="text-blue-200 font-medium mb-2">Restores local backups back to your media server.</p>
            <p className="text-blue-100 text-sm">This will look into your backup folder and upload posters and backgrounds for your libraries directly without processing them with overlays.</p>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-theme-text mb-2">What would you like to restore?</label>
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer bg-theme-bg p-3 rounded-lg border border-theme hover:border-theme-primary transition-all">
                <input
                  type="radio"
                  name="restoreScope"
                  value="all"
                  checked={restoreScope === "all"}
                  onChange={() => setRestoreScope("all")}
                  className="w-4 h-4 text-theme-primary focus:ring-theme-primary border-theme-muted"
                />
                <span className="text-theme-text">Restore All Libraries</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer bg-theme-bg p-3 rounded-lg border border-theme hover:border-theme-primary transition-all">
                <input
                  type="radio"
                  name="restoreScope"
                  value="specific"
                  checked={restoreScope === "specific"}
                  onChange={() => setRestoreScope("specific")}
                  className="w-4 h-4 text-theme-primary focus:ring-theme-primary border-theme-muted"
                />
                <span className="text-theme-text">Restore Specific Items</span>
              </label>
            </div>

            {restoreScope === "specific" && (
              <div className="bg-theme-bg p-4 rounded-lg border border-theme space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="block text-sm font-medium text-theme-text mb-1">Library Name (Optional)</label>
                  <select
                    value={libraryName}
                    onChange={(e) => setLibraryName(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-card border border-theme rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  >
                    <option value="">All Libraries</option>
                    {loadingLibraries ? (
                       <option value="" disabled>Loading libraries...</option>
                    ) : (
                       libraryItems.map((lib, idx) => (
                         <option key={idx} value={lib.name}>{lib.name}</option>
                       ))
                    )}
                  </select>
                  <p className="text-xs text-theme-muted mt-1">Leave empty to restore from all libraries.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text mb-1">Folder / Item Name (Optional)</label>
                  <input
                    type="text"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="e.g. Alien"
                    className="w-full px-3 py-2 bg-theme-card border border-theme rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  />
                  <p className="text-xs text-theme-muted mt-1">Leave empty to restore all items in the library.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text mb-1">Asset Type (Optional)</label>
                  <select
                    value={assetType}
                    onChange={(e) => setAssetType(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-card border border-theme rounded-lg text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary"
                  >
                    <option value="">All Types</option>
                    <option value="poster">Poster</option>
                    <option value="background">Background</option>
                    <option value="season">Season</option>
                    <option value="episode">Episode</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="bg-theme-bg px-6 py-4 rounded-b-xl flex justify-between border-t-2 border-theme mt-auto">
          <button onClick={onClose} className="px-6 py-2 bg-theme-card hover:bg-theme-hover border border-theme rounded-lg font-medium transition-all">Cancel</button>
          <button onClick={handleStart} disabled={loading || (status && status.running)} className="px-6 py-2 bg-theme-primary hover:bg-theme-primary/90 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-all text-white flex items-center shadow-lg">
            <Upload className="w-5 h-5 mr-2" />
            Start Restore
          </button>
        </div>
      </div>
    </div>
  );
});

export default RestoreModeModal;
