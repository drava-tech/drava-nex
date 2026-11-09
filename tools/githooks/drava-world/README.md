# drava-world git hooks

Keep the CMS's **Drava World** template (`packages/drava-world`) in step with the
[drava-world](https://github.com/drava-tech/drava-world) repo, so a change is only ever
made there.

- `post-commit` runs `tools/sync-drava-world.mjs --ref HEAD --commit` after every
  drava-world commit: it copies the commit into `packages/drava-world`, re-applies the
  nex-only edits (paths under `/drava-world/`), and commits the result in drava-nex on
  `sufiyan`, with the drava-world commit's message.
- `pre-push` pushes drava-nex's `sufiyan` along with the drava-world push.

A sync that fails never blocks the drava-world commit or push; it prints why, and nex
is left as it was.

## Turn it on (once per drava-world clone)

```sh
cd drava-world
git config core.hooksPath ../drava-nex/tools/githooks/drava-world
```

The hooks live here rather than in drava-world, so drava-world needs no changes and
they work on any of its branches. drava-nex must be checked out on `sufiyan`.

## By hand

```sh
pnpm sync:drava-world                      # from ../drava-world's working tree
pnpm sync:drava-world --ref HEAD --commit  # its last commit, committed here
pnpm sync:drava-world --watch              # re-sync on every save
```

If drava-world changes in a way the rules don't cover (a new page, a new way of
building a path from the site root), the sync stops and names the file. Fix the rule
in `tools/sync-drava-world.mjs`; don't edit `packages/drava-world` by hand.
