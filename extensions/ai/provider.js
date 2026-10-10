.pragma library

// Hands a prompt to Omarchy's default coding agent (`omarchy default agent`):
//
//   ai why is my wifi slow    → omarchy-agent-prompt 'why is my wifi slow'
//
// through bin/commandbar-agent, which says so in a notification when the
// agent isn't installed instead of failing where nothing shows it.
// Omarchy's launcher knows each agent's flags, opens it in a terminal and
// starts it unattended, so the row says that before Enter.
// Below it, one row per chat website in "chats" opens the prompt there
// instead. Nothing runs or opens until Enter.

// Display names, as `omarchy default agent` spells them.
var NAMES = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", gemini: "Gemini",
  copilot: "GitHub Copilot", grok: "Grok", "cursor-agent": "Cursor CLI", hermes: "Hermes",
  muse: "Muse Code", omp: "Oh My Pi", pi: "Pi", openclaw: "OpenClaw", crush: "Crush"
}

function settingsOf(ctx) {
  var s = ctx.settings && typeof ctx.settings === "object" ? ctx.settings : {}
  return { keyword: String(s.keyword || "ai").toLowerCase(), fallback: s.fallback === true,
           chats: Array.isArray(s.chats) ? s.chats : [] }
}

// "Ask ChatGPT: …" rows, opened in the browser with the prompt URL-encoded.
function chatRows(chats, prompt, score) {
  var out = []
  for (var i = 0; i < chats.length; i++) {
    var c = chats[i]
    if (!c || typeof c.open !== "string" || !/\{q\}/.test(c.open)) continue
    var url = c.open.replace(/\{q\}/g, encodeURIComponent(prompt))
    var host = url.match(/^[a-z]+:\/\/(?:www\.)?([^\/?#]+)/i)
    // Their own section and the web keywords' globe, so they read as
    // websites rather than more agents.
    out.push({ title: "Ask " + (c.title || (host ? host[1] : "chat")) + ": " + prompt, subtitle: "Opens " + (host ? host[1] : url) + " in your browser",
               score: score - 0.01 * (i + 1), icon: c.icon || "󰖟", copy: prompt, actionLabel: "Open website",
               group: "Chat websites", run: { kind: "open", target: url } })
  }
  return out
}

function agentName(id) { return NAMES[id] || id }

// Only a name like the ones `omarchy default agent` writes counts as an agent.
// Anything else (an edited or damaged file) is treated as no agent at all.
function cleanAgent(id) {
  id = String(id || "").trim()
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(id) ? id : ""
}

function chooseRow(score) {
  return { title: "Choose a default agent…", subtitle: "Omarchy has no default agent yet. Opens its agent menu",
           score: score, icon: "󰚩", copy: "", actionLabel: "Choose",
           run: { kind: "run", target: "omarchy-agent --pick" } }
}

function askRow(agent, prompt, score) {
  var name = agentName(agent)
  return { title: "Ask " + name + ": " + prompt, subtitle: "Opens " + name + " in a terminal. It runs commands without asking",
           score: score, icon: "󰚩", copy: prompt, actionLabel: "Ask",
           run: { kind: "agent", target: prompt } }
}

var provider = {
  id: "ai",
  name: "Agent",
  icon: "󰚩",
  help: function(ctx) {
    var s = settingsOf(ctx), agent = cleanAgent(ctx.agent)
    var name = agent ? agentName(agent) : "your default agent"
    return [{
      id: "ai", title: "Ask your agent", icon: "󰚩",
      about: "Opens " + name + " in a terminal with your prompt" + (s.chats.length ? ", or a chat website with Alt+2 and on" : ""),
      examples: [
        { q: s.keyword + " ", note: agent ? "Type a prompt after \"" + s.keyword + " \"" : "Choose an agent first with: omarchy default agent <name>" },
        { q: s.keyword + " explain what a .desktop file is", note: "Opens " + name + " with that prompt. It runs commands without asking" }
      ]
    }]
  },
  commands: function(ctx) {
    var s = settingsOf(ctx), agent = cleanAgent(ctx.agent)
    var name = agent ? agentName(agent) : "agent"
    return [{ title: "Ask " + name, keywords: "ai agent chat ask prompt llm " + (agent || ""),
              text: "Keyword \"" + s.keyword + "\"", icon: "󰚩", complete: s.keyword + " " }]
  },
  // "ai " and a prompt; a keyword command of yours with the same word wins.
  mode: function(query, ctx) {
    var kw = String((ctx.settings && ctx.settings.keyword) || "ai").toLowerCase()
    var m = String(query || "").match(/^\s*(\S+)\s/)
    if (!m || m[1].toLowerCase() !== kw || (ctx.keywords || []).indexOf(kw) !== -1) return null
    return { label: "Agent", icon: "󰚩" }
  },
  match: function(query, ctx) {
    var s = settingsOf(ctx), agent = cleanAgent(ctx.agent)
    var text = query.replace(/^\s+/, "")
    var space = text.search(/\s/)
    var word = (space === -1 ? text : text.slice(0, space)).toLowerCase()
    var rest = space === -1 ? "" : text.slice(space).trim()

    // Your own keyword command with the same word wins.
    var taken = (ctx.keywords || []).indexOf(s.keyword) !== -1
    if (word === s.keyword && !taken) {
      if (!rest) {
        if (!agent) return [chooseRow(98)]
        return [{ title: "Ask " + agentName(agent) + "…", subtitle: "Type your prompt after \"" + s.keyword + " \"",
                  score: 95, icon: "󰚩", copy: "" }]
      }
      return [agent ? askRow(agent, rest, 98) : chooseRow(98)].concat(chatRows(s.chats, rest, 98))
    }

    // A query of two words or more that nothing else answers offers the same
    // rows as the keyword. The engine drops them when anything else matches.
    if (s.fallback && agent && /\S\s+\S/.test(text)) {
      return [askRow(agent, text.trim(), 5)].concat(chatRows(s.chats, text.trim(), 5))
        .map(function(r) { r.fallback = true; return r })
    }
    return []
  }
}
