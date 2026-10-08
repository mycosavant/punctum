.pragma library

// A colour typed as hex or rgb() shows a swatch and its HEX, RGB and HSL
// forms; Enter copies one. Parsing adapted from Keystroke's core/Colors.js
// (MIT, Arseniy Zarechnev, evindor/keystroke).
//
//   #ff6644 · #f64 · ff6644 · rgb(255, 102, 68)
//
// Six hex digits without # count only when one is a digit, so words like
// "decade" or "facade" stay words.

function clamp(n) { return Math.max(0, Math.min(255, n)) }

function fromHex(q) {
  var m = /^(#)?([a-f0-9]{6}|[a-f0-9]{3})$/i.exec(q)
  if (!m) return null
  if (!m[1] && (m[2].length === 3 || !/[0-9]/.test(m[2]) || !/[a-f]/i.test(m[2]))) return null
  var hex = m[2].length === 6 ? m[2] : m[2].split("").map(function(c) { return c + c }).join("")
  return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)]
}

function fromRgb(q) {
  var m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,\/]\s*[\d.]+%?\s*)?\)$/i.exec(q)
  return m ? [clamp(+m[1]), clamp(+m[2]), clamp(+m[3])] : null
}

function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16) }

function parse(text) {
  var q = String(text || "").trim()
  var rgb = fromHex(q) || fromRgb(q)
  if (!rgb) return null
  var r = rgb[0], g = rgb[1], b = rgb[2]
  var rf = r / 255, gf = g / 255, bf = b / 255
  var max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf)
  var l = (max + min) / 2, h = 0, s = 0
  if (max !== min) {
    var d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0)
    else if (max === gf) h = (bf - rf) / d + 2
    else h = (rf - gf) / d + 4
    h /= 6
  }
  var hex = "#" + hex2(r) + hex2(g) + hex2(b)
  return {
    swatch: hex,
    values: [
      { label: "HEX", text: hex.toUpperCase() },
      { label: "RGB", text: "rgb(" + r + ", " + g + ", " + b + ")" },
      { label: "HSL", text: "hsl(" + Math.round(h * 360) + ", " + Math.round(s * 100) + "%, " + Math.round(l * 100) + "%)" }
    ]
  }
}

var provider = {
  id: "colors",
  name: "Colour",
  icon: "󰏘",
  commands: [
    { title: "Pick a colour from the screen", keywords: "color colour picker eyedropper hex", text: "Click any pixel; its hex is copied",
      icon: "󰈊", run: { kind: "argv", target: ["hyprpicker", "-a"], label: "pick" } }
  ],
  help: [
    { id: "colors", title: "Colours", about: "A hex or rgb() colour shows a swatch and its other forms",
      examples: ["#ff6644", "rgb(40, 120, 200)"] }
  ],
  match: function(query, ctx) {
    var c = parse(query)
    if (!c) return []
    return c.values.map(function(v, i) {
      return { title: v.text, subtitle: v.label, swatch: c.swatch, score: 92 - i * 0.01, copy: v.text }
    })
  }
}
