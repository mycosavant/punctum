# Punctum: name checks

2026-10-10. A research agent ran these checks for the maintainer. This is not legal advice.
Tags: **RAN** (I ran a query and saw the result), **READ** (I read a page), **ASSUMED**.

## Verdict

Usable, with one thing to look at. No live PUNCTUM mark covers software in the US. The
only live mark that names software in its owner is a German one: *punctum
Gesellschaft für Software mbH*, DE 1128046, a combined word-and-figure mark in classes
9/35/42, registered 1988. The Benelux mark held by LNRS Data Services (part of
LexisNexis Risk) is also live and includes class 9. Neither appears to sell a launcher,
and a free MIT project is a low-risk user. Still, a lawyer would want to see the
German mark before the name goes on anything commercial. Every package registry is
free, as is `mycosavant/punctum`. The `.dev`, `.app` and `.com` domains are taken;
`punctum.sh` appears free.

## 1. Trademarks

**USPTO**: RAN, using the JSON backend the tmsearch.uspto.gov UI calls (an undocumented
endpoint), with a phrase match and a `*punctum*` wildcard on the wordmark. 2 hits, both dead:
- PUNCTUM, Dominio de Punctum S.L. (ES), IC 033 wine, reg. 3953573: cancelled. No conflict.
- AQUAFLO PUNCTUM PLUG, AlphaMed Inc., IC 010 eye implant: cancelled (Sec. 8). No conflict.

**TMview** (the EU's aggregator: EUIPO, national EU offices, WIPO international (WO) and
many others): RAN through its search API with `basicSearch=punctum`. 73 results, all
retrieved. These are live (registered or filed) and touch class 9 or 42:

| mark | office | owner | classes | status | conflict? |
|---|---|---|---|---|---|
| punctum (combined, figure 27.05.01) | DE 1128046 | punctum Gesellschaft für Software mbH | 9, 35, 42 | Registered 1988 | **The closest.** The owner's name says software. Goods text not retrieved. Most plausible conflict |
| PUNCTUM | BX 939094 | LNRS Data Services B.V. | 9, 16, 41 | Registered 2013 | Probably data or publishing products. Moderate-low |
| PUNCTUM | CN 9125179 | 上海鹏途量具有限公司 (a Shanghai measuring-tools maker) | 9 | Registered 2011 | Measuring instruments, by its name. Low |
| PUNCTUM | MX 1521841 | Antonio Arista Jalife | 42 | Registered 2014 | Goods unknown. Low (Mexico) |
| PUNCTUM | AR 2658175 | Pielvitori, Samanta | 42 | Registered 2013 | Goods unknown. Low (Argentina) |
| PUNCTUM ANALYTICS | DE 302022006061 | Konzept & Markt GmbH (market research) | 35, 41, 42 | Registered 2022 | Compound mark, research services. Low |
| punctum architecture | TR | withheld | 42 | Filed 2022 | Architecture. Low |

- The other live hits are wine (EM/GB/ES, Dominio de Punctum, classes 32/33), clothing,
  photography/education (41), clinics (44) and PR (35). None is plausible against a
  launcher. RAN.
- The only EUIPO (EM) marks are wine (live) and glass fittings (expired). No EU-wide
  software mark. RAN.
- Expired software-adjacent marks: DE punctum pr-agentur (35/42), DE Adpunctum AG
  (9/38/42), FR Ets Ulmann (incl. 9). RAN.
- The TMview detail endpoint returned 403, so **I have no goods/services text for any
  TMview hit**. The judgements above rest on class and owner name. RAN (the 403), ASSUMED (the judgements).
- A web search for "punctum Gesellschaft für Software mbH" found no website and nothing
  confirming the company still trades. The mark's status reads Registered, and German marks
  must be renewed every 10 years, so it has presumably been renewed. RAN (search), ASSUMED (renewal).

**Not queried directly**: the WIPO Global Brand Database (a JS app; I took its WO
records from TMview instead), EUIPO eSearch (I relied on TMview's EM records), Justia
(403), Trademarkia (the page loaded but is JS-rendered; I did not parse it). DPMAregister was
not opened for DE 1128046's goods list. Do that next: `register.dpma.de`, number 1128046.

## 2. Software products and companies named Punctum

- GitHub: 45 repos with `punctum` in the name. The top ones are sundyme/punctum
  (dot-matrix typeface, 47 stars, active 2026-10-05), KeKsBoTer/punctum (point-cloud
  renderer, 7 stars, last push 2022), yyqlovelife/Punctum_YYQ (photo gallery, 1 star) and
  anthonyec/punctum (image focal point, 0). None is a launcher. RAN.
- **punctum-im** (org "punctum.im", created 2020-01-13): 4 repos for "an open and
  federated chat protocol" (`protocol`, 1 star, last push 2021-07-27), a WIP reference
  server `drywall` (0 stars, last push 2021-10-06), and an archived `protocol-old`.
  Dormant for about 5 years. `punctum.im` does not resolve. RAN.
- Web searches for a Punctum app, launcher, SaaS or developer tool returned nothing
  named Punctum. RAN. A search engine returning nothing is weak evidence: these searches
  are US-biased and shallow.
- `punctum.com` (registered 1996, Vautron, resolves) is unidentified: the page gave no
  title. RAN.

## 3. Availability (re-verified)

- AUR: `punctum` returns 0 for both `by=name` and `by=name-desc`. Exact `info` 0. RAN.
- Arch repos: `pacman -Si punctum` says not found. RAN.
- crates.io: "crate `punctum` does not exist". npm 404. PyPI 404. RAN.
- GitHub user `punctum`: **taken**. An individual account created 2008, 0 public repos. RAN.
- GitHub `mycosavant`: exists (User, created 2020-09-19, 1011 public repos), so it is presumably
  the maintainer's. RAN (exists), ASSUMED (ownership). `mycosavant/punctum`: 404, free. RAN.

## 4. Domains (getent + RDAP; whois for .sh)

| domain | status |
|---|---|
| punctum.dev | **registered** 2025-12-25 (Dynadot), resolves 76.223.54.146, expires 2026-12-25. RAN |
| punctum.app | **registered** 2020-10-01 (1&1/IONOS), status "client hold", does not resolve. RAN |
| getpunctum.com | **registered** 2026-07-20 (GoDaddy), Squarespace "Website Expired" page. RAN |
| punctum.sh | whois: "Domain not found". Appears free. RAN |
| punctum.com | registered 1996. RAN |

## 5. Pronunciation

"PUNK-tum" (/ˈpʌŋktəm/), the Latin for a prick or point, Barthes' word in *Camera
Lucida* for the detail that pierces the viewer. ASSUMED for the English IPA: Wiktionary
gives only Latin [ˈpuːŋk.tũː] (READ), and Merriam-Webster returned 403.

## 6. Alternates (AUR, GitHub, one web search each)

- **Aum**: no exact AUR package (6 substring hits). GitHub `aum` is an org (0 repos). The
  search found BitCrackers/aum-launcher, a Windows Among Us mod launcher. USPTO has 95 hits,
  2 of them live in class 9/42. RAN.
- **Modul**: no exact AUR package (substring floods, 3520). GitHub user `modul` is taken (20
  repos). USPTO has live class 9/42 marks (MODUL-CONNECT, MODUL-ION, MODUL by FFG Werke in 42).
  Crowded. RAN.
- **Substrata**: no exact AUR package, but `vim-substrata-git`/`neovim-substrata-git` exist (a
  colour scheme, 217 stars), and glaretechnologies/substrata is a metaverse client (86 stars).
  GitHub user `subSTRATA` is taken. USPTO: 9 hits, none live in class 9/42. RAN.

## Not checked

- Goods/services text for any non-US mark, and DE 1128046 at DPMA itself.
- WIPO Global Brand Database and EUIPO eSearch directly (only through TMview).
- Common-law (unregistered) use, and company registers (Handelsregister, Companies House).
- Social handles (X, Mastodon, Bluesky, Reddit, Discord), Flathub, Snap, Debian/Fedora/Nix
  package names, AUR `-git`/`-bin` variants beyond the substring search (which showed none).
- Whether punctum.sh can actually be bought (registrar price, premium status).
- Trademarks for the alternates outside the USPTO.
