.pragma library

// Word matching shared by the app, window and keybinding extensions.

// "VSCodium" → ["vs", "codium"], "org.gnome.Nautilus" → ["org", "gnome", "nautilus"]
function words(text) {
  return String(text || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(function(w) { return w.length > 0 })
}

// Every query word starts some word of the haystack.
function prefixesAll(queryWords, hay) {
  for (var i = 0; i < queryWords.length; i++) {
    var hit = false
    for (var j = 0; j < hay.length && !hit; j++) hit = hay[j].indexOf(queryWords[i]) === 0
    if (!hit) return false
  }
  return true
}

// How well the query names this app, best first; 0 means no match.
function rankApp(app, q, qw) {
  // A query with no letters (2+2, 15%) is arithmetic, never an app name: Pinta's
  // keyword "2d" used to outrank the answer to 2+2.
  if (!/[a-z]/i.test(q)) return 0
  var name = app.name.toLowerCase()
  if (name === q) return 100
  if (name.indexOf(q) === 0) return 90
  var nameWords = words(app.name)
  if (app.id.toLowerCase() === q) return 88
  if (prefixesAll(qw, nameWords)) return 85
  if (q.length >= 2 && qw.length === 1 && nameWords.length > 1
      && nameWords.map(function(w) { return w[0] }).join("").indexOf(q) === 0) return 80
  if (q.length >= 3 && name.indexOf(q) !== -1) return 75
  if (prefixesAll(qw, words(app.id))) return 72
  if (prefixesAll(qw, words(app.generic + " " + app.keywords.join(" ")))) return 65
  return 0
}
