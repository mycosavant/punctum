# Naming

**Decided 2026-10-10: Punctum** (the maintainer's call), with the tagline
"the extensible command bar for Linux". Spot and Bang were considered the
same morning: `spot` is taken in the AUR twice (a model-checking library, and
`spot-client`, a Spotify client called Spot), and Bang would collide with the
bar's own `!` bangs. Omni was taken. Further checks on the chosen name, including
trademarks: [punctum-checks.md](punctum-checks.md).

Candidates as checked on 2026-10-09:

## What was checked

For each of 36 candidates:

- **Arch repos**: `pacman -Si` and `pacman -Ss '^name$'` (local databases,
  not refreshed).
- **AUR**: the exact-name lookup and a name substring search, which catches
  `-bin` and `-git` variants. Neither shows a package that only *provides*
  the name; that gap is what hides the clash for "Everywhere" below.
- **GitHub**: repositories with the name, top hits by stars.
- **npm, crates.io, PyPI**: taken or free (matters less).
- **Products**: a general web search.
- **This machine**: `command -v`, so the CLI wouldn't shadow anything.

Not checked: trademark registries (USPTO, EUIPO, WIPO), Omarchy's plugin
marketplace, domains and social handles. **Run a trademark search on the final
pick before announcing it.**

The top three were re-checked by hand the same evening: AUR exact and
substring empty, nothing in pacman, and the GitHub results as listed.

## Shortlist

| | Name | Why | Evidence |
|---|---|---|---|
| 1 | **punctum** | Latin for "point" or "dot": it names Super+Period. Short, easy to type, distinctive without being cute | Not in pacman or the AUR. npm, crates and PyPI free. GitHub: a typeface (46 stars), a 7-star repo, and a `punctum-im` organisation (2 stars; looks like a small messaging project, worth a look). No software product found |
| 2 | **sporeprint** | A spore print records what a mushroom holds: an index of everything, made locally. Clearly yours. Long, so ship a short alias (`sp`) | Not in pacman or the AUR. All registries free. GitHub: 5 repos, at most 1 star. No product found |
| 3 | **fullstop** | British for "period": says Super+Period plainly | Not in pacman or the AUR. npm taken. GitHub: Zalando's AWS audit tool (41 stars). A New York design agency uses the name |
| 4 | **fruitbody** | The fruiting body is the visible part of a fungus: the palette as the one surface over many extensions | Not in pacman or the AUR. All registries free. GitHub: 1 repo, 0 stars |
| 5 | **puffball** | One press, a burst of results. Playful | Not in pacman or the AUR. PyPI taken. GitHub: at most 2 stars |
| 6 | **hyphal** | Ties to "hypha" without colliding with it. Reads as an adjective | Not in pacman or the AUR. npm taken. GitHub: research code only |
| 7 | **sporelight** | Light and evocative | Not in pacman or the AUR. All registries free. GitHub: at most 1 star |

**Recommendation: punctum.** It says what the thing is (the dot key, a point
of entry), it types well as a command, and nothing in the Linux desktop space
uses it. **sporeprint** is the best of the mycology names if you want the
brand to carry your theme.

## Taken, and why

| Name | Taken by |
|---|---|
| hypha | three GitHub projects (78 to 447 stars); all registries |
| spore | an AUR package; EA's game |
| truffle | an AUR package; Truffle Suite, TruffleHog |
| summon | an AUR package; CyberArk Summon |
| mote | an AUR text editor |
| mycelia, mycora | projects in the same space |
| sporecast | Sporecast Ltd's mushroom-map app |
| lodestar, wayfinder, morel, rhizome, enoki, mycel, kinoko | popular GitHub projects |

## Everywhere

Fine as the name of the extension inside the bar; taken as a standalone
command or package:

- The AUR has `everywhere-bin` and `everywhere-git`, an AI desktop assistant
  (Sylinko/Everywhere, about 6,300 stars). Both declare `provides` and
  `conflicts` for `everywhere`, and `everywhere-git` installs
  `/usr/bin/everywhere`.
- On crates.io, `everywhere` is a wrapper for Everything-style Windows file
  search: the same idea.
- A macOS app is called "Everywhere File Search".

If it ships on its own, it needs a prefixed package name
(`punctum-everywhere`), with `everywhere` as a command you choose to link
yourself, or a name of its own. Not
researched yet; worth a round of the same checks once the bar's name is
settled.

## Context

- Omarchy 4's own launcher (part of the Omarchy menu) opens with Super+Space,
  per its release notes, so Super+Period doesn't clash with it.
- The plugin id for a release would be namespaced, e.g.
  `io.github.mycosavant.punctum`.
- The full research notes, candidate by candidate, are in
  [naming-research.md](naming-research.md).
