export function getAssetPreviewFormats(mediaType) {
  const formats = [
    { id: "movie_poster", label: "Movie Poster (2:3)", isLandscape: false, level: "movie" },
    { id: "show_poster", label: "Show Poster (2:3)", isLandscape: false, level: "show" },
    { id: "season_poster", label: "Season (2:3)", isLandscape: false, level: "season" },
    { id: "episode_card", label: "Titlecard (16:9)", isLandscape: true, level: "episode" },
    { id: "backdrop", label: "Background (16:9)", isLandscape: true, level: "backdrop" },
  ];
  if (mediaType === "show") return formats.filter((format) => format.level !== "movie");
  if (mediaType === "movie") return formats.filter((format) => ["movie", "backdrop"].includes(format.level));
  return formats;
}

export function getAssetPreviewGuides(config, template) {
  if (!config) return null;
  const landscape = ["episode_card", "titlecard", "backdrop", "background"].includes(template);
  const width = landscape ? 3840 : 2000;
  const height = landscape ? 2160 : 3000;
  const read = (prefix, section, key, suffix = key) =>
    config[`${prefix}${suffix}`] ?? config[section]?.[key];
  const enabled = (value) => value === true || String(value).toLowerCase() === "true";
  const number = (value) => {
    if (value == null || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const titlecard = ["episode_card", "titlecard"].includes(template);
  const season = template === "season_poster";
  const collection = template === "collection_poster";
  const prefix = titlecard ? "TitleCard" : landscape ? "Background" : season ? "SeasonPoster" : collection ? "CollectionPoster" : "Poster";
  const section = titlecard ? "TitleCardOverlayPart" : landscape ? "BackgroundOverlayPart" : season ? "SeasonPosterOverlayPart" : collection ? "CollectionPosterOverlayPart" : "PosterOverlayPart";
  const boxes = [];
  const addBox = (boxPrefix, boxSection, label, color) => {
    const boxWidth = number(read(boxPrefix, boxSection, "MaxWidth"));
    const boxHeight = number(read(boxPrefix, boxSection, "MaxHeight"));
    const offset = number(read(boxPrefix, boxSection, "text_offset", "TextOffset"));
    if (boxWidth == null || boxHeight == null || offset == null || boxWidth <= 0 || boxHeight <= 0) return;
    boxes.push({
      label, color, width: boxWidth / width * 100, height: boxHeight / height * 100,
      left: (width - boxWidth) / 2 / width * 100,
      top: (height - offset - boxHeight) / height * 100,
    });
  };
  if (titlecard) {
    addBox("TitleCardTitle", "TitleCardTitleTextPart", "Episode title", "#fbbf24");
    addBox("TitleCardEP", "TitleCardEPTextPart", "Season / episode", "#22d3ee");
  } else {
    addBox(prefix, section, season ? "Season title" : "Title / logo", "#fbbf24");
    if (season && enabled(read("ShowTitle", "ShowTitleOnSeasonPosterPart", "AddShowTitletoSeason"))) {
      addBox("ShowTitle", "ShowTitleOnSeasonPosterPart", "Show title", "#22d3ee");
    }
    if (collection && enabled(read("CollectionTitle", "CollectionTitlePosterPart", "AddCollectionTitle"))) {
      addBox("CollectionTitle", "CollectionTitlePosterPart", "Collection title", "#22d3ee");
    }
  }
  const border = enabled(read(prefix, section, "AddBorder"))
    ? Math.max(0, number(read(prefix, section, "borderwidth", "Borderwidth")) ?? 0) : 0;
  return { boxes, borderX: border / width * 100, borderY: border / height * 100 };
}