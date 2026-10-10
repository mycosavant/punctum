// Finds and loads extensions the way Punctum.qml does, for the tests:
// every extensions/<id>/extension.json, validated by lib/Extensions.js, its
// provider loaded (js) or wrapped (script), then handed to Engine.
const fs = require("fs"), path = require("path")
const load = require("./loader")

function discover(dirs) {
  const found = []
  for (const { dir, user } of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name, "extension.json")
      if (fs.existsSync(file)) found.push({ dir: path.join(dir, name), manifest: fs.readFileSync(file, "utf8"), missing: [], user: !!user })
    }
  }
  return found
}

function install(Engine, Ext, found) {
  const { list, errors } = Ext.collect(found)
  const entries = []
  for (const m of list) {
    if (m.type === "script") { entries.push({ provider: Ext.scriptProvider(m), manifest: m }); continue }
    const mod = load(path.join(m.dir, m.entry))
    if (!mod.provider || mod.provider.id !== m.id) { errors.push({ dir: m.dir, error: "provider id doesn't match" }); continue }
    entries.push({ provider: mod.provider, manifest: m })
  }
  Engine.setProviders(entries)
  Engine.setExtensionErrors(errors)
  return { manifests: list, errors }
}

module.exports = { discover, install }
