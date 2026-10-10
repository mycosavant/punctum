# Everywhere

Type `/` and part of a name. Every file and folder on the disk that matches is
listed as you type, best first. It is the Linux answer to Everything on
Windows.

```
/notes              names containing "notes"
/dwnlds             letters in order: finds Downloads
/report .pdf$       "report" in the name, ending in .pdf
/hosts !backup      leave out anything containing "backup"
/'exact name        an exact substring, no fuzzy matching
/^down              a name starting with "down"
/^/etc host         under /etc, with "host" in it
```

Enter opens the file or folder with its default app. Shift+Enter opens a
terminal in its folder.

## Why it is fast

Everything on Windows is instant because it reads the NTFS file table, an index
the filesystem already keeps. Linux filesystems have no such table to read, so
Everywhere keeps indexes instead and asks them:

| Index | Covers | Kept current by | Size here |
|---|---|---|---|
| The system's plocate index, `/var/lib/plocate/plocate.db` | everything outside your home folder | `plocate-updatedb.timer`, nightly | 602k paths |
| A private index of your home folder, `~/.cache/omarchy-commandbar/home.db` | your home folder | the bar: `updatedb` on the first `/` query after it opens, at most once a minute (about 0.5 s) | 275k paths |

Files in your home folder are current to within a minute. Elsewhere, a file
created today shows up after tonight's rebuild. The system index's copy of your
home folder is a day old, so its home entries are dropped in favour of the
private index.

Measured on this laptop, 2026-10-09: a plain lookup takes about 10 ms, a
letters-in-order lookup about 50 ms, and a whole query, ranked, 90 to 170 ms.
Very common short words cost more (`lib`: 0.5 s), because more of the disk
matches before the filters run.

## How a query runs

1. **Split.** `/report .pdf$ !old` becomes the terms `report`, `.pdf$`, `!old`.
2. **Ask plocate** with the plain words (`report`, `.pdf`), all of which must
   appear. `!` terms are left for later; `'`, `^` and `$` are stripped. A
   `*`, `?` or `[` is escaped, since plocate would read it as a glob.
3. **Ask again, fuzzily**: each word as its letters in order within one path
   segment (`dwnlds` → `d[^/]*w[^/]*n…`). The plain pass runs first, so the
   fuzzy pass, which matches far more, can't crowd out the obvious answer.
4. **Filter**: drop the system index's stale home entries and anything
   containing an exclusion (`/.cache/`, `/node_modules/` and so on). Each
   index contributes at most 3000 paths after filtering.
5. **fzf** applies the full query (`fzf --filter`), so its syntax works:
   `'exact`, `^start`, `end$`, `!leave-out`. A `^name` becomes `'/name`,
   since fzf anchors `^` to the whole path and every path starts with `/`.
6. **Order**, best first:
   - a name that *is* the word, then one that starts with it, contains it,
     or has its letters in order;
   - a small lift for your home folder, a small drop for hidden paths;
   - shallower, then shorter;
   - fzf's own order breaks ties.

   fzf's ranking alone put an Android icon file above `~/Downloads` for
   `dwnlds`; this order is the desktop's.

Every command runs under `timeout 3`, and the bar stops a search after 3 s and
says so ("Stopped after 3 s") rather than claiming nothing matched.

## Settings

```jsonc
"locate": {
  // Paths containing any of these strings are left out.
  "exclude": ["/.cache/", "/.cargo/registry/", "/.cargo/git/", "/node_modules/", "/.local/share/Trash/", "/.git/"]
}
```

To turn it off, remove `"locate"` from `"providers"`.

## Privacy

- Nothing leaves the machine.
- plocate only ever returns paths you could list yourself: the system index is
  readable by the `locate` group, and `plocate` checks your permission on each
  result.
- The private index lists every path in your home folder. It is mode 600 in a
  700 folder, so only you can read it. It stays there if you disable the
  feature; delete `~/.cache/omarchy-commandbar/home.db` to remove it.

## Compared with the alternatives

| Tool | Finds names | Finds contents | Index | Stays current |
|---|---|---|---|---|
| **Everywhere** (`/`) | instant, whole disk | no (use `rg `) | plocate | home: within a minute; elsewhere: nightly |
| `~` in the bar | live walk with `fd`, home only | no | none | always |
| KFind | walks the disk on every search | yes, slowly | none | always |
| FSearch (AUR) | instant, an Everything clone | no | its own | on rescan |
| clapgrep, recoll | no / yes | yes | recoll: full-text | recoll: on reindex |

## Limits

- Folders and files look the same in the list: plocate doesn't say which a
  path is. Enter opens either correctly.
- No size or date filters yet (Everything's `size:` and `dm:`).
- Outside your home folder, files from today are missing until tonight.
