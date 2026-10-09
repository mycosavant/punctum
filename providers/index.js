.pragma library
.import "commands.js" as Commands
.import "math.js" as Calculator
.import "currency.js" as Currency
.import "time.js" as Time
.import "emoji.js" as Emoji
.import "processes.js" as Processes
.import "apps.js" as Apps
.import "units.js" as Units
.import "windows.js" as Windows
.import "ai.js" as Ai
.import "clipboard.js" as Clipboard
.import "files.js" as Files
.import "hotkeys.js" as Hotkeys
.import "url.js" as Url
.import "colors.js" as Colors
.import "notes.js" as Notes
.import "bangs.js" as Bangs
.import "bible.js" as Bible
.import "packages.js" as Packages

// Every provider the bar knows about. To add a feature: write providers/<name>.js
// exporting `var provider = { id, name, icon, match(query, ctx) }`, import it
// above and list it here, then add its id to "providers" in the config.
var all = [
  Commands.provider,
  Calculator.provider,
  Currency.provider,
  Time.provider,
  Emoji.provider,
  Processes.provider,
  Units.provider,
  Windows.provider,
  Apps.provider,
  Ai.provider,
  Clipboard.provider,
  Files.provider,
  Hotkeys.provider,
  Url.provider,
  Colors.provider,
  Notes.provider,
  Bangs.provider,
  Bible.provider,
  Packages.provider
]
