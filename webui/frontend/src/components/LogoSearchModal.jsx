import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Search, Loader2 } from "lucide-react";

const API_URL = "/api";

const LogoSearchModal = ({ isOpen, onClose, query, mediaType, onSelectLogo }) => {
  const { t } = useTranslation();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState({ tmdb: [], tvdb: [], fanart: [] });
  const [activeProvider, setActiveProvider] = useState("tmdb");
  const [searchQuery, setSearchQuery] = useState(query || "");

  useEffect(() => {
    if (isOpen && query) {
      handleSearch(query);
    }
  }, [isOpen]);

  const handleSearch = async (overrideQuery = null) => {
    const q = overrideQuery || searchQuery;
    if (!q) return;

    setLoading(true);
    setError(null);
    setResults({ tmdb: [], tvdb: [], fanart: [] });

    try {
      const requestBody = {
        asset_path: `manual_logo_${Date.now()}`,
        media_type: mediaType === "tv" ? "tv" : "movie",
        asset_type: "logo",
        title: q
      };

      const res = await fetch(`${API_URL}/assets/fetch-replacements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (data.success) {
        const fetchedResults = {
          tmdb: data.results.tmdb || [],
          tvdb: data.results.tvdb || [],
          fanart: data.results.fanart || [],
        };
        setResults(fetchedResults);
        
        if (fetchedResults.fanart.length > 0) setActiveProvider("fanart");
        else if (fetchedResults.tmdb.length > 0) setActiveProvider("tmdb");
        else if (fetchedResults.tvdb.length > 0) setActiveProvider("tvdb");
      } else {
        setError(data.message || "Failed to search logos");
      }
    } catch (e) {
      setError("Error connecting to server");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentResults = results[activeProvider] || [];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-theme-bg w-full max-w-6xl max-h-[90vh] rounded-2xl border border-theme shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-theme flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Search className="w-5 h-5 text-theme-primary" />
            Search Logos for "{query}"
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-theme-hover rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-theme flex gap-2">
            <input 
                type="text" 
                className="flex-1 bg-theme-card border border-theme rounded-lg px-4 py-2" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search title..."
            />
            <button 
                className="px-4 py-2 bg-theme-primary text-white rounded-lg hover:bg-theme-primary-hover"
                onClick={() => handleSearch()}
            >
                Search
            </button>
        </div>

        {/* Providers */}
        <div className="px-4 py-2 border-b border-theme flex gap-2">
            {["fanart", "tmdb", "tvdb"].map(provider => (
                <button
                    key={provider}
                    onClick={() => setActiveProvider(provider)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        activeProvider === provider
                        ? "bg-theme-primary text-white"
                        : "bg-theme-card text-theme-text hover:bg-theme-hover"
                    }`}
                >
                    {provider.toUpperCase()} ({results[provider]?.length || 0})
                </button>
            ))}
        </div>

        {/* Results Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-theme-muted">
              <Loader2 className="w-8 h-8 animate-spin text-theme-primary mb-4" />
              <p>Searching for logos...</p>
            </div>
          ) : error ? (
            <div className="text-center text-red-500 py-12">{error}</div>
          ) : currentResults.length === 0 ? (
            <div className="text-center text-theme-muted py-12">
              <p>No logos found on this provider.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {currentResults.map((item, idx) => (
                <div
                  key={idx}
                  className="group bg-slate-700/50 p-2 rounded-xl overflow-hidden border border-theme hover:border-theme-primary/50 transition-all cursor-pointer relative"
                  onClick={() => onSelectLogo(item.original_url || item.poster_url)}
                >
                  <div className="aspect-[16/9] relative flex items-center justify-center">
                    <img
                      src={item.poster_url}
                      alt="Logo"
                      className="w-full h-full object-contain filter drop-shadow-md group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </div>
                  <div className="absolute inset-0 bg-theme-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  
                  {/* Language badge */}
                  {item.language && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 bg-black/70 text-xs rounded uppercase font-bold text-white shadow">
                          {item.language}
                      </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogoSearchModal;
