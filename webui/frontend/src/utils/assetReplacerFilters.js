const IGNORED_ORDER_VALUES = new Set(["", "pleasefillme"]);

export function normalizeLanguageOrder(rawOrder) {
  const entries = Array.isArray(rawOrder)
    ? rawOrder
    : typeof rawOrder === "string"
      ? rawOrder.split(",")
      : [];
  const seen = new Set();
  const normalized = [];
  for (const item of entries) {
    const code = String(item ?? "").trim().toLowerCase();
    if (!code || IGNORED_ORDER_VALUES.has(code) || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}

export function expandAllowedLanguages(order, tmdbLanguageMappings = null) {
  const baseOrder = normalizeLanguageOrder(order);
  const mappings = tmdbLanguageMappings && typeof tmdbLanguageMappings === "object"
    ? Object.entries(tmdbLanguageMappings).reduce((acc, [key, value]) => {
      const normKey = String(key ?? "").trim().toLowerCase();
      const normVal = String(value ?? "").trim().toLowerCase();
      if (normKey && normVal) {
        acc.set(normKey, normVal);
      }
      return acc;
    }, new Map())
    : new Map();

  const seen = new Set();
  const expanded = [];
  for (const code of baseOrder) {
    if (!seen.has(code)) {
      seen.add(code);
      expanded.push(code);
    }
    const mapped = mappings.get(code);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      expanded.push(mapped);
    }
  }
  return expanded;
}

export function isPosterPreview(preview) {
  return preview?.type === "poster" || preview?.type === "season" || preview?.type === "season_poster";
}

export function isBackdropPreview(preview) {
  return preview?.type === "backdrop" || preview?.type === "background" || preview?.sub_type === "background";
}

export function isLogoPreview(preview) {
  const type = String(preview?.type || "").toLowerCase();
  const subType = String(preview?.sub_type || "").toLowerCase();
  return (
    type === "logo" ||
    subType === "clearlogo" ||
    subType === "clearart" ||
    type.includes("clearart") ||
    type.includes("clearlogo") ||
    type.includes("hdmovielogo") ||
    type.includes("hdtvlogo")
  );
}

export function getDefaultTypeFilter(assetType) {
  return assetType === "titlecard" ? "all" : assetType === "background" ? "backdrop" : "poster";
}

export function filterReplacerPreviews({
  previews = [],
  typeFilter = "poster",
  languageFilter = "all",
  logoSelectionMode = false,
  assetType = "poster",
  languageOrder = {},
  tmdbLanguageMappings = null,
}) {
  const list = Array.isArray(previews) ? previews : [];
  const hasPosters = list.some(isPosterPreview);
  const hasBackdrops = list.some(isBackdropPreview);
  const hasClearLogos = list.some(p => isLogoPreview(p) && String(p?.sub_type || "").toLowerCase() === "clearlogo");
  const hasClearArt = list.some(p => isLogoPreview(p) && String(p?.sub_type || "").toLowerCase() === "clearart");

  let effectiveTypeFilter;
  if (logoSelectionMode) {
    if (typeFilter === "clearlogo" && hasClearLogos) effectiveTypeFilter = "clearlogo";
    else if (typeFilter === "clearart" && hasClearArt) effectiveTypeFilter = "clearart";
    else effectiveTypeFilter = "all";
  } else if (!hasPosters && !hasBackdrops) {
    effectiveTypeFilter = "all";
  } else if (typeFilter === "clearlogo" || typeFilter === "clearart") {
    effectiveTypeFilter = "all";
  } else if (typeFilter === "poster" && !hasPosters && hasBackdrops) {
    effectiveTypeFilter = "backdrop";
  } else if (typeFilter === "backdrop" && !hasBackdrops && hasPosters) {
    effectiveTypeFilter = "poster";
  } else {
    effectiveTypeFilter = typeFilter;
  }

  const typeFilteredPreviews = effectiveTypeFilter === "all"
    ? list
    : effectiveTypeFilter === "poster"
      ? list.filter(isPosterPreview)
      : effectiveTypeFilter === "backdrop"
        ? list.filter(isBackdropPreview)
        : effectiveTypeFilter === "clearlogo"
          ? list.filter(p => isLogoPreview(p) && String(p?.sub_type || "").toLowerCase() === "clearlogo")
          : list.filter(p => isLogoPreview(p) && String(p?.sub_type || "").toLowerCase() === "clearart");

  const configuredOrder = logoSelectionMode
    ? normalizeLanguageOrder(languageOrder?.logo)
    : normalizeLanguageOrder(languageOrder?.[assetType] || languageOrder?.poster);

  const allowedMatchSet = new Set(expandAllowedLanguages(configuredOrder, tmdbLanguageMappings));
  const rawAvailable = [...new Set(typeFilteredPreviews.map(p => (p?.language || "xx").toLowerCase()))];
  const allowedLanguages = configuredOrder.length > 0
    ? rawAvailable.filter(l => allowedMatchSet.has(l))
    : rawAvailable;

  const availableLanguages = ["all", ...allowedLanguages];
  const effectiveLanguageFilter = availableLanguages.includes(languageFilter) ? languageFilter : "all";

  const filteredPreviews = effectiveLanguageFilter === "all"
    ? (configuredOrder.length > 0
        ? typeFilteredPreviews.filter(p => allowedMatchSet.has((p?.language || "xx").toLowerCase()))
        : typeFilteredPreviews)
    : typeFilteredPreviews.filter(p => (p?.language || "xx").toLowerCase() === effectiveLanguageFilter);

  return {
    hasPosters,
    hasBackdrops,
    hasClearLogos,
    hasClearArt,
    effectiveTypeFilter,
    typeFilteredPreviews,
    availableLanguages,
    effectiveLanguageFilter,
    filteredPreviews,
  };
}
