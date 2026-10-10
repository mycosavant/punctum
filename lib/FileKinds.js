.pragma library

// File names to icons, shared by the file extensions.

function baseName(rel) { var s = rel.lastIndexOf("/"); return s >= 0 ? rel.slice(s + 1) : rel }
function parentOf(rel) { var s = rel.lastIndexOf("/"); return s >= 0 ? rel.slice(0, s) : "" }

var ICONS = { folder: "󰉋", image: "󰋩", pdf: "󰈦", archive: "󰀼", audio: "󰈣", video: "󰈫", text: "󰈙", file: "󰈔" }
var KIND = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", svg: "image", avif: "image",
  pdf: "pdf", zip: "archive", tar: "archive", gz: "archive", xz: "archive", zst: "archive", "7z": "archive",
  mp3: "audio", flac: "audio", ogg: "audio", wav: "audio", m4a: "audio", opus: "audio",
  mp4: "video", mkv: "video", webm: "video", mov: "video",
  md: "text", txt: "text", json: "text", toml: "text", yaml: "text", yml: "text", conf: "text", csv: "text"
}

function kindOf(entry) {
  if (entry.dir) return "folder"
  var name = baseName(entry.rel), dot = name.lastIndexOf(".")
  return (dot > 0 && KIND[name.slice(dot + 1).toLowerCase()]) || "file"
}
