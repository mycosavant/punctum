# Naming research: the Omarchy command palette (fork of omarchy-commandbar)

Checked 2026-10-09, on this Arch/Omarchy machine and the live web. No accounts,
repos, packages or posts were created. Raw outputs sit beside this file:
`local.txt` (pacman, command -v, AUR), `gh.txt` (GitHub search), `reg.txt`
(npm/crates.io/PyPI HTTP status).

## Method (what "checked" means here)

- **pacman**: `pacman -Si <name>` and `pacman -Ss '^<name>$'` against the
  local sync databases. They are as fresh as the last `pacman -Sy`; I did not refresh them.
- **AUR**: `https://aur.archlinux.org/rpc/v5/info?arg[]=<name>` (exact pkgname)
  and `rpc/v5/search/<name>?by=name` (substring), to catch `-bin`/`-git`
  variants. **The exact-name check does not see `provides=`.** That gap turned
  out to matter for "everywhere" (see below).
- **GitHub**: `gh api search/repositories?q=<name>+in:name&sort=stars`, top 6.
  `in:name` is a substring match, so the "total" counts are inflated. The
  star counts of the top hits are the useful part.
- **Registries**: HTTP status of `registry.npmjs.org/<n>`,
  `crates.io/api/v1/crates/<n>` and `pypi.org/pypi/<n>/json` (200 = taken,
  404 = free).
- **Products/trademarks**: WebSearch only (general web search). **I did not
  query USPTO, EUIPO or WIPO.** Their search UIs are JavaScript apps and were
  not reachable this way. "No product found" means none surfaced in a web
  search. It does not mean there is no registered mark.
- **CLI**: `command -v <name>` on this machine. Every candidate was free
  except `everywhere`, which resolves to the maintainer's own symlink.

## Ranked shortlist (available)

| # | name | why | evidence (2026-10-09) |
|---|---|---|---|
| 1 | **punctum** | Latin for "point, dot". It names the Super+Period trigger, is short to type (7 letters, no awkward keys), and is distinctive without being cute. | pacman: none. AUR exact 0, substring 0. npm/crates/PyPI all **free**. GitHub top hit: `sundyme/punctum`, a dot-matrix typeface, 46 stars; nothing else above 7. Web search: no software product named Punctum. |
| 2 | **sporeprint** | A spore print is the record a mushroom leaves of what it holds, a fitting image for a palette that indexes everything locally. Clearly mycology and on brand. At 10 letters it is long to type, so ship a short alias. | pacman: none. AUR exact 0, substring 0. npm/crates/PyPI all **free**. GitHub: 5 repos, max 1 star (a mushroom grow project). Web search: no software product, only the mycology term. |
| 3 | **fullstop** | British English for "period", so it says Super+Period plainly. Easy to type. | pacman: none. AUR exact 0, substring 0. crates/PyPI free, **npm taken**. GitHub: `zalando-stups/fullstop` (AWS audit tool, 41 stars, Zalando's), plus a punctuation-model repo with 90 stars. Web: FullStop, a New York design agency, and "Fullestop" (different spelling), an Indian web firm. Neither is a launcher, but the name is a common word with a little more prior use than #1 and #2. |
| 4 | **fruitbody** | The fruiting body is the visible part of a mycelium. That matches the palette as the one visible surface over many extensions. | pacman: none. AUR exact 0, substring 0. npm/crates/PyPI all **free**. GitHub: 1 repo, 0 stars. Web: no product. |
| 5 | **puffball** | A puffball releases spores in one puff when pressed, which maps onto one keypress and a burst of results. Playful and memorable. | pacman: none. AUR exact 0, substring 0. npm/crates free, **PyPI taken**. GitHub: max 2 stars. Web: no software product, only the fungus. |
| 6 | **hyphal** | Connects to the maintainer's "hypha" identity and the existing plugin id `hypha.commandbar`, without colliding with the taken "hypha". | pacman: none. AUR exact 0, substring 0. crates/PyPI free, **npm taken**. GitHub: max 5 stars (research code). Web: only scientific tools (HyLength, SkelPy). It is an adjective, which reads oddly as a product noun. |
| 7 | **sporelight** | Light and evocative. | pacman: none. AUR exact 0, substring 0. npm/crates/PyPI all **free**. GitHub: 5 repos, max 1 star (games). Web: no product. |

Near misses that are free everywhere but weaker as names: `sporedot` (all
free; the only GitHub hit is a 2-star "spore.fun" monitor), `hyphabar` (all
free, 0 GitHub repos; "bar" undersells a palette), `lamella` (AUR and pacman
free, but npm and crates taken, and it sits next to pnnl's `lamellar` runtime).

## All candidates

Legend: AUR = exact `info` resultcount (plus notable substring hits). GH =
top repo(s) by stars from the `in:name` search. Reg = npm/crates/PyPI, with
T = taken and f = free. cmd = `command -v` on this machine.

| name | style | pacman | AUR | GitHub (top) | Reg n/c/p | web/product | cmd | verdict |
|---|---|---|---|---|---|---|---|---|
| punctum | short/metaphor | free | 0 | 46 typeface | f/f/f | none found | free | **shortlist 1** |
| sporeprint | mycology | free | 0 | 1 | f/f/f | none found | free | **shortlist 2** |
| fullstop | descriptive | free | 0 | 90 / 41 (Zalando AWS audit) | T/f/f | design agency, "Fullestop" | free | **shortlist 3** |
| fruitbody | mycology | free | 0 | 0 | f/f/f | none found | free | **shortlist 4** |
| puffball | mycology/punchy | free | 0 | 2 | f/f/T | none found | free | **shortlist 5** |
| hyphal | mycology | free | 0 | 5 | T/f/f | scientific tools only | free | **shortlist 6** |
| sporelight | mycology | free | 0 | 1 | f/f/f | none found | free | **shortlist 7** |
| sporedot | mycology+dot | free | 0 | 2 | f/f/f | none | free | ok, weak |
| hyphabar | mycology+desc | free | 0 | none | f/f/f | none | free | ok, weak |
| fruiting | mycology | free | 0 | 1 | not checked | none | free | ok, weak |
| lamella | mycology | free | 0 | 68/32 pnnl `lamellar` | T/T/f | none | free | marginal |
| stipe | mycology | free | 0 | 40 Toadstool-Stipe (Sass) | T/T/f | reads like a "Stripe" typo | free | reject |
| sporecast | mycology | free | 0 | 3 | f/f/f | **Sporecast Ltd, mushroom-map app on the App Store** | free | reject |
| hypha | mycology | free | 0 (AUR `hyphanet`) | 447 CodeSoul-co/Hypha, 342 Hypha-ROS, 78 HyphaApp | T/T/T | Hypha (HyphaApp submission software) | free | reject |
| hyphae | mycology | free | 0 | 98 inconvergent/hyphae | T/T/T | none | free | reject |
| mycel | mycology | free | 0 (AUR `mycelium`, `mycelica`) | 411 psilva261/mycel (web browser) | not checked | none | free | reject |
| mycelia | mycology | free | 0 | 117 mycelial/mycelial; 30 mycelia-tech "privacy-first AI memory" | not checked | Mycelial (company) | free | reject |
| mycora | mycology | free | 0 | 2 TSODev/mycora (mycelium note TUI) | f/T/f | none | free | reject (same theme, Rust TUI) |
| myco | mycology | free | 0 (AUR `mycorrhiza`, `mycoria-bin`) | too generic (58k substring hits) | not checked | none | free | reject |
| spore | mycology | free | **1: `spore` image manager** | 548 MetaSpore etc. | not checked | **EA's Spore** | free | reject |
| spora | mycology | free | 0 | 22 spora (bioinformatics) | not checked | none | free | reject (generic) |
| sporo | mycology | free | 0 | 1 | not checked | Sporo Health (medical AI) | free | weak |
| truffle | mycology | free | **1: Truffle (Ethereum)** | 28k trufflehog, 13.9k Truffle Suite | not checked | Truffle Suite, TruffleHog | free | reject |
| morel | mycology | free | 0 | 3.8k MoreLINQ, 379 hydromatic/morel (query language) | T/T/T | Morel language | free | reject |
| chanterelle | mycology | free | 0 | 79 f-o-a-m/chanterelle ("a more functional truffle") | not checked | none | free | reject (long, taken) |
| enoki | mycology | free | 0 | 1.3k mitsuba-renderer/enoki | not checked | Enoki (Mysten Labs/Sui) | free | reject |
| kinoko | mycology | free | 0 | 278 manga browser, 228 MK Wii physics | T/f/T | none | free | reject |
| rhizome | metaphor | free | 0 | 1.5k Rhizome-Conifer, 820 chrisseaton | not checked | Rhizome (arts org) | free | reject |
| lodestar | metaphor | free | 0 | 1.4k ChainSafe/lodestar (Ethereum client) | T/T/T | Lodestar (ChainSafe) | free | reject |
| wayfinder | metaphor | free | 0 | 1.85k laravel/wayfinder | T/T/T | Laravel Wayfinder | free | reject |
| summon | metaphor | free | **1: summon (Python viz)** | 763 cyberark/summon; 440 window-summoner; AUR `hyprsummon-git` | not checked | CyberArk Summon | free | reject |
| mote | short | free | **1: mote editor** | 221 soveran/mote | not checked | none | free | reject |
| dotbar | descriptive | free | 0 (AUR `dotbare`) | 293 tmux-dotbar; 730 dotbare | not checked | none | free | reject |
| tittle | short (dot on the i) | free | 0 | 3 (tittle-xyz org) | T/T/f | tittle.xyz | free | weak; reads as a misspelling of "title" |
| everywhere | (file-search component) | free | 0 exact, **but see below** | 6.3k Sylinko/Everywhere | T/T/T | Everywhere (AI desktop assistant); Everywhere File Search (macOS) | **taken (your own symlink)** | see section |

## "Everywhere" (the bundled file-search component)

Taken in practice. Results:

- **pacman**: no package (`-Si` and `-Ss '^everywhere$'` both empty).
- **AUR exact `everywhere`**: resultcount 0. **This is misleading.** AUR has
  `everywhere-bin` (0.0.4-1) and `everywhere-git` (r1092), both maintained by
  "Pasical" and both packaging the Everywhere AI desktop assistant. Both
  PKGBUILDs declare `provides=('everywhere')` and `conflicts=('everywhere')`
  (read from aur.git/plain/PKGBUILD). `everywhere-git` installs
  `/usr/bin/everywhere`, and `everywhere-bin` installs `/usr/bin/Everywhere`.
  An AUR package named `everywhere` would therefore conflict with both, and its
  binary would clash with `everywhere-git`'s.
- **GitHub**: `Sylinko/Everywhere`, "On-screen aware AI assistant for your
  desktop", **6,306 stars**, pushed 2026-10-09. It is a desktop tool in a
  neighbouring space. The AUR packages' URLs point at `pasical/Everywhere` and
  `DearVa/Everywhere`. I did not confirm that those redirect to Sylinko's
  repo; the matching descriptions suggest they do.
- **crates.io `everywhere`**: taken by "A high-level, ergonomic Rust wrapper
  around the Everything SDK for fast Windows file search" (updated
  2026-02-02). That is the same concept (Everything-style file search).
- **Web**: "Everywhere File Search", a native macOS file-name search app
  (listed on AlternativeTo), is the same product category.
- **npm**: taken (no description, last modified 2022). **PyPI**: taken (a
  two-line thread-local utility).
- **This machine**: `command -v everywhere` resolves to
  `~/.local/bin/everywhere`, a symlink to the maintainer's own script in
  `~/.config/omarchy/plugins/hypha.commandbar/extensions/everywhere/`.

Conclusion: keeping "Everywhere" as an extension's display name inside the
palette is harmless. Shipping it as a standalone CLI or package under that
bare name would conflict with the AUR packages and share its name with a
same-category crate and macOS app. If it ships alone, give it a prefixed name
(for example `<palette>-everywhere`) or rename it. I did not check
alternatives for it.

## Rejected because taken

- **spore**: AUR `spore` (image manager), and EA's game *Spore*.
- **truffle**: AUR `truffle` (Ethereum), Truffle Suite (13.9k stars) and TruffleHog (28k).
- **summon**: AUR `summon`, CyberArk Summon (763 stars), plus `window-summoner` and AUR `hyprsummon-git` in the same space.
- **mote**: AUR `mote` (terminal editor).
- **hypha**: CodeSoul-co/Hypha (447), Hypha-ROS (342), HyphaApp/hypha (78, submission software). npm, crates and PyPI all taken.
- **hyphae**: inconvergent/hyphae (98). All three registries taken.
- **morel**: hydromatic/morel query language (379). All three registries taken.
- **lodestar**: ChainSafe Ethereum consensus client (1.4k). All registries taken.
- **wayfinder**: laravel/wayfinder (1.85k). All registries taken.
- **rhizome**: Rhizome-Conifer (1.5k) and chrisseaton/rhizome (820).
- **mycel**: psilva261/mycel web browser (411).
- **mycelia**: the Mycelial org and repos, and mycelia-tech ("Privacy-First AI Memory", the same values pitch).
- **mycora**: a mycelium-themed Rust TUI already uses it. crates taken.
- **enoki**: mitsuba-renderer/enoki (1.3k), plus Mysten Labs' Enoki product.
- **kinoko**: a manga browser (278) and a Mario Kart Wii engine (228).
- **chanterelle**: f-o-a-m/chanterelle (79), and the name is long.
- **sporecast**: Sporecast Ltd's commercial mushroom-map app (App Store, Google Play).
- **dotbar**: tmux-dotbar (293), and it is one letter from `dotbare` (730, AUR).
- **stipe**, **tittle**: minor prior use, but they read as typos of "Stripe" and "title".

## What I could not check

- **Trademark registries** (USPTO, EUIPO, WIPO): not queried. Web search
  found no software marks for the shortlisted names, but that is weak
  evidence. Run a Class 9/42 search for the final pick before announcing.
- **Exact-name GitHub repos with few stars** under other owners: the search
  was by stars, top 6. Any shortlisted name may have dozens of 0-star repos;
  only notable ones were recorded.
- **Registries for some rejected names**: not checked where the name was
  already out (marked "not checked").
- **AUR `provides=`** for the shortlisted names: the RPC `info` call matches
  pkgname only. The substring search found no packages containing any of the
  seven shortlisted names, so a `provides` collision is unlikely but not ruled out.
- **Omarchy's plugin marketplace**: I did not search it for name clashes.
  Note that Omarchy 4's own launcher, merged into the Omarchy menu, is on
  Super+Space (per the v4.0.0 release notes as reported by
  newreleases.io/SourceForge).
- **Domains and social handles**: not checked.
- **pacman sync databases** were used as already synced; they were not refreshed.
