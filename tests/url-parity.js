// node tests/url-parity.js [punctumd] — the JS web-address provider and the
// Rust one in punctumd must agree, row and actions, on hosts, schemes,
// ports, paths and things that only look like addresses. One difference is
// on purpose (url.rs): Rust wants a top-level domain that exists, so where
// the JS opens "mr.smith" Rust stays quiet. Those are counted, and checked to
// be only that.
const { spawnSync } = require("child_process")
const path = require("path")
const load = require("./loader")
const P = path.join(__dirname, "..") + "/"
const Url = load(P + "extensions/url/provider.js")
const bin = process.argv[2] || P + "target/debug/punctumd"

function corpus() {
  const hosts = ["example.com", "Example.COM", "sub.example.co.uk", "github.io", "localhost", "LOCALHOST", "app.localhost", "nas.local", "router.lan",
    "printer.home.arpa", "svc.internal", "x.test", "bücher.de", "xn--bcher-kva.de", "münchen", "例え.jp", "a.b.c.d.example.org", "example.com.",
    "192.168.1.1", "10.0.0.256", "01.2.3.4", "1.2.3", "127.0.0.1", "0.0.0.0", "[::1]", "[2001:db8::1]", "[::ffff:192.168.1.1]", "[::g]", "[1::2::3]",
    "readme.md", "notes.txt", "archive.zip", "node.js", "app.py", "data.json", "photo.jpg", "foo.io", "foo.rs", "foo.dev", "foo.ai", "x.co",
    "mr.smith", "john.doe", "e.g", "i.e", "foo.notatld", "hello", "intranet", "-bad.com", "bad-.com", "a_b.com", "1.5", "3.14159", "v1.2",
    "a".repeat(64) + ".com", "a".repeat(63) + ".com", "x.c", "x.museum", "x.photography", "user@example.com", "@example.com"]
  const out = ["", " ", "hello world", "http://", "https://", "//", "javascript:alert(1)", "ftp://example.com", "mailto:a@b.c", "example.com<x>", "exa mple.com"]
  for (const h of hosts) {
    out.push(h, h + "/", h + "/path?q=1#frag", h + ":8080", h + ":0", h + ":65536", h + ":3000/x", "http://" + h, "HTTPS://" + h + "/a",
      "https://user:pw@" + h, "user:pw@" + h, "//" + h, " " + h + " ")
  }
  return out
}

const queries = corpus()
const input = queries.map((query, id) => JSON.stringify({ id, ext: "url", query })).join("\n") + "\n"
const run = spawnSync(bin, [], { input, encoding: "utf8" })
if (run.error || run.status !== 0) { console.log("FAIL  punctumd didn't run: " + (run.error || run.stderr)); process.exit(1) }
const replies = run.stdout.trim().split("\n").map(l => JSON.parse(l))
const action = a => a ? { kind: a.kind, target: a.target, label: a.label } : null
const fields = r => ({ title: r.title, subtitle: r.subtitle, icon: r.icon || "", score: r.score, copy: r.copy, run: action(r.run), alt: action(r.alt) })
let diffs = 0, tld = 0, answered = 0
queries.forEach((q, id) => {
  const js = Url.provider.match(q, {}).map(fields)
  const rs = replies[id].rows ? replies[id].rows.map(fields) : replies[id].error
  if (Array.isArray(rs) && rs.length) answered++
  if (JSON.stringify(js) === JSON.stringify(rs)) return
  // The one difference on purpose: JS opens it, Rust doesn't, and the host
  // ends in a label that isn't a real or private TLD.
  const host = (q.trim().replace(/^\/\//, "").split(/[/?#:]/)[0] || "").replace(/\.$/, "")
  if (js.length === 1 && Array.isArray(rs) && rs.length === 0 && /\.(smith|doe|g|e|notatld|c|txt|js|json|jpg)$/i.test(host)) { tld++; return }
  if (diffs++ < 12) console.log("FAIL  " + JSON.stringify(q) + "\n  js:   " + JSON.stringify(js) + "\n  rust: " + JSON.stringify(rs))
})
console.log((diffs ? "FAIL" : "ok  ") + "  url: JS and Rust agree on " + (queries.length - diffs - tld) + " of " + queries.length + " queries ("
  + answered + " open something; " + tld + " names without a real TLD that only the JS opens)")
process.exit(diffs ? 1 : 0)
