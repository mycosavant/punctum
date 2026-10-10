# Release checklist: Punctum 0.1.0

Status 2026-10-10. The name is decided (punctum, the maintainer's call that
day). The repository is ready locally in `~/git/punctum`; nothing is published.

## Done

- Renamed: id `io.github.mycosavant.punctum`, `Punctum.qml`, `bin/punctum-*`,
  config `~/.config/omarchy/extensions/punctum.json`, user extensions in
  `~/.config/omarchy/punctum/extensions/`, cache `~/.cache/punctum/`.
- Neutral defaults: Bible off, no Bible bangs, no Syncthing keyword, and
  Packages copies the install command instead of running sudo (opt-in with
  `"packages": { "install": true }`).
- README for users; dependencies listed against Omarchy's base packages.
- LICENSE: the maintainer's notice, Saikomantisu's kept, Keystroke's for the
  adapted parts.
- CI: `.github/workflows/tests.yml` (Arch container, normal user). Green
  since run 38055077757 (2026-10-10). In the container it can't test that a
  sandbox hides the session bus, or that the resolver is mounted only with
  network on; the run says so in two `note` lines.
- Name checks: [punctum-checks.md](punctum-checks.md).
- Upstream drafts rebased onto Command Bar 1.3.1: [../upstream/](../upstream/README.md).
- Native extensions (punctumd), Everywhere in Rust, WebAssembly extensions,
  reviewed 2026-10-10 (security, correctness, the bar, Everywhere, release):
  every finding fixed or noted below. `native/release-build` is
  reproducible: two builds from different checkouts give the same bytes.

## The maintainer's steps, in order

1. **Optional: look at DE 1128046** (*punctum Gesellschaft für Software mbH*,
   classes 9/35/42, 1988) at register.dpma.de. It's the one live mark whose
   owner names software; the checks couldn't read its goods list.
2. **Publish the repository.** Done 2026-10-10: `github.com/mycosavant/punctum`.
3. **Screenshots.** `preview.png` and `screenshots/` are Command Bar 1.3.0's.
   New ones need the display on: the card, `?`, `/` (Everywhere) and
   `?extensions`.
4. **Merge `dev` into `main`**, once CI is green on `dev`. `main` has none of
   the native code yet, so `punctumd-git` (which builds `main`) fails until
   then. Decide Everywhere's final name first if it should ship under it:
   the crate (`native/everywhere`) and the binary name are one line each.
5. **Tag it** once CI is green on `main`: `git tag -a v0.1.0 -m "Punctum 0.1.0" && git push origin v0.1.0`.
   `release.yml` builds punctumd and everywhere and attaches them, their
   `.sha256` files and `built-with.txt` to a **draft** release.
6. **Check the draft.** Rebuild from the tag with `native/release-build`
   using the compilers its notes name (rustc 1.99.0 and the runner's gcc;
   a different gcc gives different bytes) and compare both SHA-256s.
7. **Publish the draft**, then commit its two `.sha256` lines to
   `native/checksums.txt` on `main`: that's what `?extensions` → download
   checks against.
8. **Packages.** In each `packaging/arch/*/PKGBUILD`, `updpkgsums` (the
   `-bin` sums must equal `checksums.txt`), then
   `makepkg --printsrcinfo > .SRCINFO`, and build each in a clean chroot.
   Publishing them to the AUR is a separate, public step.
9. **Upstream**: the issue, then PRs 1 and 3, then PR 2, as
   [../upstream/README.md](../upstream/README.md) says. The issue links the
   repository, so after step 2.
10. **Marketplace.** Not researched: how Omarchy's plugin marketplace takes a
   submission. Its rules (from Command Bar's CONTRIBUTING) are met as far as
   they were checked; the automated check itself hasn't been run.

## Switching this machine over

The installed bar is still `hypha.commandbar` in
`~/.config/omarchy/plugins/hypha.commandbar`. To move to Punctum:

1. Write `~/.config/omarchy/extensions/punctum.json` with the maintainer's
   own choices that left the defaults (Bible on, the Bible bangs, the
   Syncthing keyword); there was no Command Bar config file before.
2. Copy `~/.cache/omarchy-commandbar/` to `~/.cache/punctum/` (geometry,
   pins, launch counts, rates, last query).
3. Disable `hypha.commandbar` first, so Super+Period is free, then clone
   `~/git/punctum` into `~/.config/omarchy/plugins/io.github.mycosavant.punctum`
   and enable it. Once on GitHub, `omarchy plugin add` replaces the clone.
4. Keep the old folder until Punctum has run a day; its `fix/*` branches are
   the pre-rebase ones, superseded by those in `~/git/punctum`.

## Not done

- Everywhere as a standalone package: its name clashes (AUR `everywhere-bin`);
  `punctum-everywhere` is the suggestion in [naming.md](naming.md).
- A trademark search beyond what [punctum-checks.md](punctum-checks.md) ran.
- The agent branch past its first step ([../proposal-agent.md](../proposal-agent.md)).
