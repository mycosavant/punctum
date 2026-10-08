.pragma library

// Where the card sits and how big it is. Pure, so it can be tested.
//
// The saved geometry (cache file geometry.json) is
//   { cx, top, width, listHeight }
// cx and top are fractions of the screen (the card's centre, and its top
// edge), so a position survives a change of resolution or monitor; width
// and listHeight are pixels. listHeight is the tallest the results list
// grows before it scrolls; the card itself still shrinks to fit fewer rows.
// The "window" section of the config gives the same fields as the default
// for when nothing is saved: cx 0.5, top 0.22, width 640, rows 7.

var MIN_WIDTH = 360
var MIN_LIST = 120

function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback }

function defaults(windowConfig, rowHeight) {
  var w = windowConfig || {}
  return {
    cx: num(w.cx, 0.5),
    top: num(w.top, 0.22),
    width: num(w.width, 640),
    listHeight: num(w.rows, 7) * rowHeight
  }
}

// Saved values win field by field; anything missing or not a number falls
// back to the default.
function merge(saved, base) {
  var s = saved && typeof saved === "object" ? saved : {}
  return { cx: num(s.cx, base.cx), top: num(s.top, base.top), width: num(s.width, base.width), listHeight: num(s.listHeight, base.listHeight) }
}

// Kept on screen: the width fits with a margin, the card's centre stays far
// enough in that the whole card is visible, and its top leaves room below.
function clamp(g, screenW, screenH, margin, cardHeight) {
  var width = Math.max(Math.min(MIN_WIDTH, screenW - 2 * margin), Math.min(g.width, screenW - 2 * margin))
  var listHeight = Math.max(MIN_LIST, Math.min(g.listHeight, screenH * 0.8))
  var halfFrac = (width / 2 + margin) / screenW
  var cx = Math.max(halfFrac, Math.min(1 - halfFrac, g.cx))
  var maxTop = Math.max(0, (screenH - Math.min(cardHeight, screenH) - margin) / screenH)
  var top = Math.max(margin / screenH, Math.min(maxTop, g.top))
  return { cx: cx, top: top, width: width, listHeight: listHeight }
}

function x(g, screenW) { return Math.round(g.cx * screenW - g.width / 2) }
function y(g, screenH) { return Math.round(g.top * screenH) }

// After a drag that moved the card's top-left corner to (left, top).
function moved(g, left, topPx, screenW, screenH) {
  return { cx: (left + g.width / 2) / screenW, top: topPx / screenH, width: g.width, listHeight: g.listHeight }
}

// After dragging the bottom-right grip by (dx, dy) from where it started.
// The left edge stays put, so the centre moves by half the width change.
function resized(start, dx, dy, screenW) {
  var width = Math.max(MIN_WIDTH, start.width + dx)
  return { cx: start.cx + (width - start.width) / 2 / screenW, top: start.top, width: width, listHeight: Math.max(MIN_LIST, start.listHeight + dy) }
}

// Hyprland blurs the layer wherever its alpha is above ignore_alpha. The
// whole-screen scrim has to stay under that line and the card above it, so
// only the card is frosted. Returns the alphas to draw with and the line.
function glass(scrimAlpha, cardAlpha) {
  var card = Math.max(0.3, Math.min(1, cardAlpha))
  var scrim = Math.max(0, Math.min(scrimAlpha, card - 0.2))
  return { scrim: scrim, card: card, ignoreAlpha: Math.round(((scrim + card) / 2) * 100) / 100 }
}
