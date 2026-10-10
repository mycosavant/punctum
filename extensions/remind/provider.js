.pragma library

// Reminders and alarms, as Omarchy reminders: they show in its bar indicator
// and `omarchy-reminder show` / `clear` see them.
//
//   remind 10m take out the laundry       in ten minutes
//   remind me to call mom at 3pm          at 15:00 (tomorrow if that's passed)
//   !remindme tomorrow 9am dentist        DuckDuckGo-style
//   remind 1h30m stretch · remind 20 tea  a bare number is minutes, as omarchy-reminder takes it
//   alarm 6:45 · alarm tomorrow 7am       a critical notification and a sound
//   remind                                what's set; Shift+Enter cancels one
//
// The time is parsed here; Enter runs remind-set (in this folder) with the
// time (--at a clock time, --in a duration, counted from Enter) as an
// argument and the message on stdin. A reminder doesn't survive a reboot or
// logout, as with Omarchy's own.

// "alarm" and "wake" need a time after them (or nothing), so "alarm clock"
// and "wake on lan" stay ordinary searches.
var MODE = /^\s*(!remindme|!remind|remind(?:\s+me)?|reminder|(?:alarm|wake(?:\s+me)?)(?=\s*$|\s+(?:\d|at\b|in\b|for\b|today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun|noon|midnight)))(?:\s+|$)/i
var UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
              h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 }
var UNIT = "(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)"
var DURATION = new RegExp("(^|\\s)(in\\s+|for\\s+|after\\s+)?((?:\\d+(?:\\.\\d+)?\\s*" + UNIT + "(?:\\s*(?:and\\s+)?|(?=\\d)))+)(?=\\s|$)", "gi")
var DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
var DAY = "(today|tonight|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)"
var CLOCK = new RegExp("(^|\\s)(?:" + DAY + "\\s+)?(at\\s+)?(noon|midnight|(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.?m\\.?|p\\.?m\\.?)?)(?:\\s+" + DAY + ")?(?=\\s|$)", "gi")
var MAX_AHEAD = 366 * 86400 * 1000

function pad(n) { return (n < 10 ? "0" : "") + n }

// Seconds in "1h30m", "10 min", "2.5h", or NaN.
function seconds(text) {
  var total = 0, re = new RegExp("(\\d+(?:\\.\\d+)?)\\s*(" + UNIT + ")", "gi"), m, any = false
  while ((m = re.exec(text))) { total += parseFloat(m[1]) * UNITS[m[2].toLowerCase()]; any = true }
  return any ? total : NaN
}

function dayOffset(word, now) {
  if (!word) return null
  var w = word.toLowerCase()
  if (w === "today" || w === "tonight") return 0
  if (w === "tomorrow") return 1
  var target = DAYS[w.slice(0, 3)]
  var d = (target - now.getDay() + 7) % 7
  return d
}

// When "at 3pm", "7:30", "tomorrow 9am", "friday noon" means, from now.
function clockTime(m, now) {
  var dayWord = m[2] || m[8] || ""
  var hasAt = !!m[3], word = (m[4] || "").toLowerCase()
  var hour, minute = 0, ampm = (m[7] || "").toLowerCase().replace(/\./g, "")
  if (word === "noon") { hour = 12; ampm = "pm" }
  else if (word === "midnight") { hour = 0; ampm = "am" }
  else {
    hour = parseInt(m[5], 10)
    minute = m[6] ? parseInt(m[6], 10) : 0
    // A bare number is only a time with am/pm, a colon, "at" or a day.
    if (!ampm && !m[6] && !hasAt && !dayWord) return null
    if (hour > 23 || minute > 59 || (ampm && (hour < 1 || hour > 12))) return null
  }
  if (ampm === "a") ampm = "am"
  if (ampm === "p") ampm = "pm"
  var h24 = ampm === "pm" ? (hour % 12) + 12 : ampm === "am" ? hour % 12 : hour
  var offset = dayOffset(dayWord, now)
  if (dayWord.toLowerCase() === "tonight" && !ampm && h24 < 12) h24 += 12
  var at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (offset || 0), h24, minute, 0, 0)
  if (offset === null) {
    // No day named: the next time it comes round. A bare "at 7" at 14:00
    // means 19:00; a time with a colon is the 24-hour clock, so "6:45" is
    // tomorrow's 06:45, which is what an alarm means.
    if (!ampm && !m[6] && hour >= 1 && hour <= 12 && at <= now) {
      var later = new Date(at.getTime() + 12 * 3600 * 1000)
      if (later > now) at = later
    }
    if (at <= now) at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, at.getHours(), at.getMinutes(), 0, 0)
  } else if (at <= now && offset === 0) {
    // "friday 9am" on a Friday at 10:00 is next Friday; "today 9am" has passed.
    if (/^(today|tonight)$/i.test(dayWord)) return { past: true }
    at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7, at.getHours(), at.getMinutes(), 0, 0)
  }
  return { at: at }
}

// Every time-like phrase in the text, in order: { index, length, at, marked,
// seconds (durations) }. "Marked" means it says it's a time: "in 10m", a
// leading "10m", "at 5", "5pm", a day name. A number in the message ("buy 2
// eggs at 5pm", "a 3d printer at 5pm") is a candidate too, but unmarked.
function candidates(t, now) {
  var out = [], m, re
  re = new RegExp(DURATION.source, "gi")
  while ((m = re.exec(t))) {
    var secs = seconds(m[3])
    if (secs > 0) out.push({ index: m.index, length: m[0].length, seconds: Math.round(secs), at: new Date(now.getTime() + Math.round(secs) * 1000),
                             marked: !!m[2] || m.index === 0 })
    if (m[0].length === 0) re.lastIndex++
  }
  re = new RegExp(CLOCK.source, "gi")
  while ((m = re.exec(t))) {
    var c = clockTime(m, now)
    if (c) out.push({ index: m.index, length: m[0].length, at: c.at, past: !!c.past, marked: true })
    re.lastIndex = m.index + Math.max(1, m[1].length + 1)
  }
  return out.sort(function(a, b) { return a.index - b.index })
}

// { at: Date, message, seconds? } | { missing: true, message } | { past: true } | null
// seconds is set for a duration, so the time is counted from Enter.
function parse(text, now) {
  var t = " " + String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() + " "
  var all = candidates(t, now)
  var pick = all.filter(function(c) { return c.marked })[0] || all[0] || null
  var m
  // omarchy-reminder's form: a leading bare number is minutes, when nothing
  // else in the text is a time.
  if (!pick && (m = t.match(/^\s(\d{1,4})(?=\s)/)) && parseInt(m[1], 10) > 0)
    pick = { index: 0, length: m[0].length, seconds: parseInt(m[1], 10) * 60, at: new Date(now.getTime() + parseInt(m[1], 10) * 60000) }
  if (pick && pick.past) return { past: true }
  var message = pick ? t.slice(0, pick.index) + " " + t.slice(pick.index + pick.length) : t
  message = message.replace(/\s+/g, " ").trim()
    .replace(/^(?:me\s+)?(?:to|that|about|for)\s+/i, "").replace(/^me\s+/i, "")
    .replace(/\s+(?:in|at|on|by)$/i, "").trim()
  if (!pick) return t.trim() ? { missing: true, message: message } : null
  if (pick.at.getTime() - now.getTime() > MAX_AHEAD) return null
  var out = { at: pick.at, message: message.slice(0, 1000) }
  if (pick.seconds) out.seconds = pick.seconds
  return out
}

function until(at, now) {
  var secs = Math.round((at.getTime() - now.getTime()) / 1000)
  if (secs < 120) return "in " + Math.max(1, secs) + " s"
  var mins = Math.round(secs / 60)
  if (mins < 60) return "in " + mins + " min"
  var h = Math.floor(mins / 60), r = mins % 60
  if (h < 24) return "in " + h + " h" + (r ? " " + r + " min" : "")
  var d = Math.round(mins / 1440)
  return "in " + d + (d === 1 ? " day" : " days")
}

var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function when(at, now) {
  // Seconds only when it's close enough for them to matter.
  var close = at.getTime() - now.getTime() < 120000
  var hm = at.getHours() + ":" + pad(at.getMinutes()) + (close && at.getSeconds() ? ":" + pad(at.getSeconds()) : "")
  var sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return hm
  var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (at.getFullYear() === tomorrow.getFullYear() && at.getMonth() === tomorrow.getMonth() && at.getDate() === tomorrow.getDate()) return hm + " tomorrow"
  return hm + " " + WEEKDAYS[at.getDay()] + " " + at.getDate() + " " + MONTHS[at.getMonth()]
}

// Omarchy's list, from `omarchy-reminder show --json`.
function listed(text) {
  try {
    var data = JSON.parse(text || "{}")
    return Array.isArray(data.reminders) ? data.reminders.filter(function(r) { return r && /^omarchy-reminder-[A-Za-z0-9-]+\.timer$/.test(String(r.timer)) }) : []
  } catch (e) { return [] }
}

var provider = {
  id: "remind",
  name: "Reminders",
  icon: "󰢌",
  commands: [
    { title: "Set a reminder", keywords: "remind reminder remindme timer later notify", text: "remind 10m tea · remind 3pm call mom", complete: "remind " },
    { title: "Set an alarm", keywords: "alarm wake clock morning", text: "alarm 6:45 · alarm tomorrow 7am", complete: "alarm " }
  ],
  help: [
    { id: "remind", title: "Reminders and alarms", about: "remind and a time: 10m, 1h30m, 3pm, tomorrow 9am, friday noon. alarm also plays a sound. remind alone lists them",
      examples: [{ q: "remind 10m take out the laundry", note: "A notification in ten minutes" }, { q: "remind me to call mom at 3pm", note: "At 15:00, or tomorrow if that's passed" },
                 { q: "!remindme tomorrow 9am dentist", note: "The bang form" }, { q: "alarm 6:45", note: "A critical notification and a sound" }, { q: "remind ", note: "What's set; Shift+Enter cancels one" }] }
  ],
  match: function(query, ctx) {
    var m = String(query || "").match(MODE)
    if (!m) return []
    var alarm = /^(alarm|wake)/i.test(m[1])
    var now = ctx.now()
    var text = String(query).slice(m[0].length)
    var helper = (ctx.dir || "") + "/remind-set"
    var p = parse(text, now)
    if (p && p.at) {
      var label = alarm ? "Alarm at " + when(p.at, now) : "Remind me at " + when(p.at, now)
      return [{ title: label + (p.message ? ": " + p.message : ""), subtitle: until(p.at, now) + " · Enter sets it" + (alarm ? " · with a sound" : ""), score: 98, copy: "",
                // A duration counts from Enter (--in), a clock time is a time (--at).
                run: { kind: "argv", target: [helper].concat(p.seconds ? ["--in", String(p.seconds)] : ["--at", String(Math.round(p.at.getTime() / 1000))]).concat(alarm ? ["--alarm"] : []),
                       input: p.message, label: alarm ? "set alarm" : "set reminder" } }]
    }
    if (p && p.past) return [{ title: "That time has passed today", subtitle: "Try tomorrow, or a later time", score: 98, copy: "" }]
    if (p && p.missing) return [{ title: "When? Add a time", subtitle: "10m · 1h30m · 3pm · tomorrow 9am · friday noon", score: 98, copy: "" }]
    // Just "remind": what's set, from Omarchy's own list.
    var set = listed(ctx.load ? ctx.load("list", ["omarchy-reminder", "show", "--json"]) : null)
    var out = [{ title: alarm ? "Type a time: alarm 6:45" : "Type a time and a message: remind 10m tea", subtitle: "Reminders", score: 97, copy: "" }]
    for (var i = 0; i < set.length; i++) {
      var r = set[i]
      out.push({ title: String(r.label || "Reminder"), subtitle: "at " + String(r.atTime || "") + " · in " + String(r.remaining || "") + " · Shift+Enter cancels", score: 96 - i * 0.001,
                 copy: String(r.message || r.label || ""), alt: { kind: "argv", target: [helper, "--cancel", String(r.timer)], label: "cancel" } })
    }
    return out
  }
}
