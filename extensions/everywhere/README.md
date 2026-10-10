# Everywhere

Find files anywhere on the disk by name, as you type: the Linux answer to
Everything on Windows. A command, an fzf picker, and a Command Bar extension.

```sh
everywhere notes              # ranked paths, best first
everywhere report .pdf$       # fzf syntax: 'exact ^start end$ !leave-out
everywhere -i                 # pick one with fzf, print it
everywhere -i --open          # ... and open it
everywhere --index            # refresh the index of your home folder
everywhere --json dwnlds      # JSON, for other launchers
```

In the Command Bar, type `/` and a name. Full account:
[docs/everywhere.md](../../docs/everywhere.md).

Needs `plocate` (with `plocate-updatedb.timer` on) and `fzf`. The index of
your home folder lives at `$XDG_CACHE_HOME/everywhere/home.db`, mode 600;
`everywhere --index --max-age 60` rebuilds it only if it's over a minute old,
which is what the bar runs on the first `/` query after it opens.
