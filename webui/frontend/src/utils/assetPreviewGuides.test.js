import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAssetPreviewFormats, getAssetPreviewGuides } from "./assetPreviewGuides.js";

const config = JSON.parse(readFileSync(new URL("../../../../config.example.json", import.meta.url), "utf8"));

test("all asset formats are available without a library, with library-specific filtering", () => {
  assert.deepEqual(getAssetPreviewFormats().map((format) => format.id), [
    "movie_poster", "show_poster", "season_poster", "episode_card", "backdrop",
  ]);
  assert.deepEqual(getAssetPreviewFormats("show").map((format) => format.id), [
    "show_poster", "season_poster", "episode_card", "backdrop",
  ]);
  assert.deepEqual(getAssetPreviewFormats("movie").map((format) => format.id), ["movie_poster", "backdrop"]);
  for (const format of getAssetPreviewFormats()) {
    assert.ok(getAssetPreviewGuides(config, format.id).boxes.length > 0, format.id);
  }
});

test("poster boundaries match testing-mode geometry and flattened settings", () => {
  const guides = getAssetPreviewGuides(config, "movie_poster");
  assert.equal(guides.boxes[0].width, 95);
  assert.equal(guides.boxes[0].left, 2.5);
  assert.equal(guides.boxes[0].height, 500 / 3000 * 100);
  assert.equal(guides.boxes[0].top, (3000 - 430 - 500) / 3000 * 100);
  assert.equal(guides.borderX, 1.5);
  assert.equal(guides.borderY, 1);
  assert.deepEqual(getAssetPreviewGuides({
    PosterMaxWidth: "1900", PosterMaxHeight: "500", PosterTextOffset: "+430",
    PosterAddBorder: true, PosterBorderwidth: "30",
  }, "show_poster"), guides);
});

test("season and collection titles use their own configuration sections", () => {
  const seasonConfig = {
    ...config,
    ShowTitleOnSeasonPosterPart: { ...config.ShowTitleOnSeasonPosterPart, AddShowTitletoSeason: true },
  };
  const season = getAssetPreviewGuides(seasonConfig, "season_poster");
  assert.equal(season.boxes.length, 2);
  assert.equal(season.boxes[0].top, (3000 - 400 - 500) / 3000 * 100);
  assert.equal(season.boxes[1].top, (3000 - 300 - 500) / 3000 * 100);
  assert.equal(getAssetPreviewGuides(config, "season_poster").boxes.length, 1);
  assert.equal(getAssetPreviewGuides(config, "collection_poster").boxes.length, 2);
});

test("landscape and episode boundaries scale from 3840 by 2160", () => {
  const background = getAssetPreviewGuides(config, "backdrop");
  assert.equal(background.boxes[0].width, 3640 / 3840 * 100);
  assert.equal(background.boxes[0].top, (2160 - 200 - 500) / 2160 * 100);
  const episode = getAssetPreviewGuides(config, "episode_card");
  assert.equal(episode.boxes.length, 2);
  assert.equal(episode.boxes[0].top, (2160 - 300 - 280) / 2160 * 100);
  assert.equal(episode.boxes[1].width, 1000 / 3840 * 100);
  assert.equal(episode.boxes[1].top, (2160 - 150 - 120) / 2160 * 100);
});

test("missing or malformed settings do not invent boundaries", () => {
  assert.equal(getAssetPreviewGuides(null, "movie_poster"), null);
  assert.deepEqual(getAssetPreviewGuides({}, "movie_poster"), { boxes: [], borderX: 0, borderY: 0 });
  for (const invalid of ["", "bad", "Infinity", -1, 0]) {
    const guides = getAssetPreviewGuides({ ...config, PosterMaxWidth: invalid }, "movie_poster");
    assert.equal(guides.boxes.length, 0);
  }
  assert.equal(getAssetPreviewGuides({ ...config, PosterAddBorder: "false" }, "movie_poster").borderX, 0);
});