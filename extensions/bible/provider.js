.pragma library

// Scripture on Bible Gateway, in your translations, the first one first.
//
//   john 3:16 · 1 john 1:9 · psalm 23 · rom 8:28-30    a reference, no keyword needed
//   bible ps 23 · bible 1 jn 1:9                       short forms after "bible"
//   bible love one another                             a keyword search
//
// "bible": { "versions": ["NASB", "NASB1995", "ESV", "KJV"] } in
// commandbar.json picks the translations, as Bible Gateway names them. A
// reference needs a chapter after the book, so "job" alone stays an app
// search. Bible Gateway's quicksearch takes both a reference and words: it
// sends a reference on to the passage, so one URL serves both.

var DEFAULT_VERSIONS = ["NASB", "NASB1995", "ESV", "KJV"]
var SEARCH = "https://www.biblegateway.com/quicksearch/?quicksearch={q}&version={v}"

// Canonical name, then the other spellings and abbreviations, lower case.
var BOOKS = [
  ["Genesis", "gen ge gn"], ["Exodus", "ex exo exod"], ["Leviticus", "lev le lv"], ["Numbers", "num nu nm nb"],
  ["Deuteronomy", "deut de dt"], ["Joshua", "josh jos jsh"], ["Judges", "judg jdg jg jdgs"], ["Ruth", "rth ru"],
  ["Ezra", "ezr"], ["Nehemiah", "neh ne"], ["Esther", "esth es"], ["Job", "jb"],
  ["Psalms", "psalm ps pss psa psm"], ["Proverbs", "prov pro prv pr"], ["Ecclesiastes", "eccl eccles ecc qoh"],
  ["Song of Solomon", "song|song of songs|sos|canticles"], ["Isaiah", "isa is"], ["Jeremiah", "jer je jr"],
  ["Lamentations", "lam la"], ["Ezekiel", "ezek eze ezk"], ["Daniel", "dan da dn"], ["Hosea", "hos ho"],
  ["Joel", "jl"], ["Amos", "am"], ["Obadiah", "obad ob"], ["Jonah", "jon jnh"], ["Micah", "mic mc"],
  ["Nahum", "nah na"], ["Habakkuk", "hab hb"], ["Zephaniah", "zeph zep zp"], ["Haggai", "hag hg"],
  ["Zechariah", "zech zec zc"], ["Malachi", "mal ml"],
  ["Matthew", "matt mt"], ["Mark", "mk mrk mar"], ["Luke", "lk luk"], ["John", "jn jhn joh"], ["Acts", "ac act"],
  ["Romans", "rom ro rm"], ["Galatians", "gal ga"], ["Ephesians", "eph ephes"], ["Philippians", "phil php pp"],
  ["Colossians", "col"], ["Philemon", "philem phm pm"], ["Hebrews", "heb"], ["James", "jas jm"],
  ["Jude", "jud jd"], ["Revelation", "rev re revelations"]
]

// Books that come in numbered parts: "1 Samuel". "john" with a number is a
// letter, without one the Gospel.
var NUMBERED = [
  ["Samuel", "sam sa sm", 2], ["Kings", "kgs ki kin", 2], ["Chronicles", "chron chr ch", 2],
  ["Corinthians", "cor co", 2], ["Thessalonians", "thess thes th", 2], ["Timothy", "tim ti", 2],
  ["Peter", "pet pe pt", 2], ["John", "jn jhn joh", 3]
]

var ORDINALS = { "1": 1, "2": 2, "3": 3, "i": 1, "ii": 2, "iii": 3, "1st": 1, "2nd": 2, "3rd": 3, "first": 1, "second": 2, "third": 3 }

function names(canonical, aliases) {
  var list = aliases.indexOf("|") >= 0 ? aliases.split("|") : aliases.split(" ")
  return [canonical.toLowerCase()].concat(list)
}

var lookup = null
function table() {
  if (lookup) return lookup
  lookup = { plain: {}, numbered: {} }
  BOOKS.forEach(function(b) { names(b[0], b[1]).forEach(function(n) { lookup.plain[n] = b[0] }) })
  NUMBERED.forEach(function(b) { names(b[0], b[1]).forEach(function(n) { lookup.numbered[n] = { name: b[0], parts: b[2] } }) })
  return lookup
}

// { book, chapter, rest, verses } for "1 jn 1:9-10", or null. rest is what
// follows the chapter (":9-10"), kept as typed apart from spacing.
// strict is for a reference typed with no keyword, where launcher queries
// collide easily ("mar 3" is a date, "am 5" a time, "ex 1" anything): it
// wants a space before the chapter, a book name or abbreviation of three
// letters or more unless a verse follows, and a colon before a verse
// ("am 5.30" is not Amos 5:30).
function parse(text, strict) {
  var raw = String(text || "").trim().toLowerCase()
  if (raw.length > 80) return null
  if (strict && !/^((?:[123]|i{1,3}|1st|2nd|3rd|first|second|third)\s*)?[a-z][a-z ]*?\s\d{1,3}(\s*:\s*\d.*)?$/.test(raw)) return null
  var m = raw
    .match(/^((?:[123]|i{1,3}|1st|2nd|3rd|first|second|third)\s*)?([a-z][a-z ]*?)\.?\s*(\d{1,3})((?:\s*[:.]\s*\d{1,3}(?:\s*[-–,]\s*\d{1,3}(?:[:.]\d{1,3})?)*)?)$/)
  if (!m) return null
  var t = table(), book = null
  var word = m[2].replace(/\s+/g, " ")
  if (m[1]) {
    var part = ORDINALS[m[1].trim()]
    var nb = t.numbered[word]
    if (nb && part <= nb.parts) book = part + " " + nb.name
  }
  // The prefix can be the start of a plain book's name: "is 53" is Isaiah,
  // not part "i" of a book "s".
  if (!book) book = t.plain[((m[1] || "") + word).replace(/\s+/g, " ")] || null
  if (!book) return null
  // A short abbreviation needs a verse; am and pm are times even then.
  if (strict && word.length < 3 && (!/:/.test(m[4]) || word === "am" || word === "pm")) return null
  var rest = m[4].replace(/\s+/g, "").replace(/–/g, "-").replace(/^\./, ":")
  var label = (book === "Psalms" ? "Psalm" : book) + " " + Number(m[3]) + rest
  return { book: book, chapter: Number(m[3]), rest: rest, verses: rest.length > 0, label: label }
}

function versions(settings) {
  var v = settings && Array.isArray(settings.versions) ? settings.versions : DEFAULT_VERSIONS
  v = v.map(function(x) { return String(x).trim() }).filter(function(x) { return /^[A-Za-z0-9-]{1,16}$/.test(x) })
  return v.length ? v : DEFAULT_VERSIONS
}

function url(q, version) {
  return SEARCH.replace("{q}", encodeURIComponent(q)).replace("{v}", encodeURIComponent(version))
}

// One row per translation, the first on top.
function rows(q, title, settings, top) {
  return versions(settings).map(function(v, i) {
    return {
      title: title + " (" + v + ")",
      subtitle: i === 0 ? "Bible Gateway" : "Bible Gateway · another translation",
      score: i === 0 ? top : 58 - i * 0.01,
      copy: "",
      run: { kind: "open", target: url(q, v), label: "open" },
      alt: { kind: "copy", target: url(q, v), label: "copy link" }
    }
  })
}

var provider = {
  id: "bible",
  name: "Bible",
  icon: "󰂺",
  commands: [
    { title: "Search the Bible", keywords: "bible scripture verse passage nasb esv kjv", text: "A reference like john 3:16, or bible and words", complete: "bible " }
  ],
  help: [
    { id: "bible", title: "Bible", about: "Type a reference (john 3:16, 1 jn 1:9, ps 23), or bible and words. Your first translation is on top; set them with \"bible\": { \"versions\": [...] }",
      examples: [{ q: "john 3:16", hint: "The verse on Bible Gateway" }, { q: "ps 23", hint: "A whole chapter" }, { q: "bible love one another", hint: "A word search" }] }
  ],
  match: function(query, ctx) {
    var text = String(query || "").trim()
    var kw = text.match(/^bible(?:\s+(.*))?$/i)
    if (kw) {
      var words = (kw[1] || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      if (!words) return [{ title: "Type a reference or words", subtitle: "john 3:16 · love one another", score: 95, copy: "" }]
      var asRef = parse(words)
      if (asRef) return rows(asRef.label, asRef.label, ctx.settings, 98)
      return rows(words, "Search the Bible: " + words, ctx.settings, 98)
    }
    var ref = parse(text, true)
    if (!ref) return []
    // "john 3:16" is plainly scripture; "mark 2" might be something else, so
    // it stays under the time, date and app answers.
    return rows(ref.label, ref.label, ctx.settings, ref.verses ? 93 : 65)
  }
}
