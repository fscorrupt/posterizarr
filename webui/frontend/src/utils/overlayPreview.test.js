import assert from "node:assert/strict";
import { test } from "node:test";
import { getPreviewSpriteBounds, getPreviewSpriteOffset } from "./overlayPreview.js";

const sprite = { key: "rating", left: 845, top: 1418, width: 125, height: 57,
  placement: { align: "right", valign: "bottom", x: 30, y: 25 } };

test("rendered badge keeps its exact measured bounds before dragging", () => {
  const bounds = getPreviewSpriteBounds(sprite, sprite.placement, 1000, 1500);
  assert.equal(bounds.left, 845);
  assert.equal(bounds.top, 1418);
  assert.equal(bounds.w, 125);
  assert.equal(bounds.h, 57);
});

test("drag offsets preserve pixel size and track right/bottom anchoring", () => {
  const bounds = getPreviewSpriteBounds(sprite, { ...sprite.placement, x: 80, y: 50 }, 1000, 1500);
  assert.equal(bounds.left, 795);
  assert.equal(bounds.top, 1393);
  assert.equal(bounds.w, 125);
});

test("alignment changes use the compositor's integer center convention", () => {
  const bounds = getPreviewSpriteBounds(sprite, { align: "center", valign: "top", x: 0, y: 20 }, 1000, 1500);
  assert.equal(bounds.left, 438);
  assert.equal(bounds.top, 20);
});

test("drag round trip preserves the invisible recipe padding without a release jump", () => {
  const padded = { ...sprite, top: sprite.top - 40, left: sprite.left + 3 };
  for (const align of ["left", "center", "right"]) {
    for (const valign of ["top", "center", "bottom"]) {
      const offset = getPreviewSpriteOffset(padded, 240, 800, align, valign, 1000, 1500);
      const bounds = getPreviewSpriteBounds(padded, { ...offset, align, valign }, 1000, 1500);
      assert.equal(bounds.left, 240);
      assert.equal(bounds.top, 800);
    }
  }
});