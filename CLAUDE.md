# aerospace-layout-manager — project guide for Claude

This file is the starting point for any session working in this repo. It
exists so layout investigations do not restart from zero.

## What this is

**ALM** applies declarative AeroSpace window-manager layouts. Three parts:

- `bin/aerospace-layout-manager` + `lib/` — bash driver. Reads a JSON
  layout definition, rebuilds the live AeroSpace tree to match.
- `web/src/` — React UI for editing layout definitions.
- `web/server/` — Node server: serves the UI, dispatches modes, wraps the
  bash driver.

Depends on a [custom AeroSpace fork](https://github.com/pfilipp/AeroSpace)
that adds `aerospace tree --json` (see `README.md`). Without `--json`,
live-tree inspection (and all comparison/diff tooling) does not work.

## The apply pipeline (12 stages)

`bin/aerospace-layout-manager:main` runs these in order. Each bullet
points to the function and file that owns it — jump there first when
debugging a specific stage.

1. `check_dependencies` — `lib/core/dependencies.sh`
2. Parse args, read JSON from file or stdin — `bin/aerospace-layout-manager`
3. `get_root_container` — `lib/json/parsing.sh`
4. `normalize_layout_tree` — `lib/json/normalize.sh` (see invariants below)
5. `clear_workspace_to_temp` — `lib/window/movement.sh`
6. `create_window_mapping` — `lib/window/matching.sh`
7. `clear_dump_windows_to_temp` — `lib/window/movement.sh`
8. `aerospace_workspace` switch — `lib/aerospace/commands.sh`
9. `move_windows_to_workspace` — `lib/window/movement.sh`
10. `aerospace_flatten_workspace_tree` + set root layout — `lib/aerospace/commands.sh`
11. `reorder_windows_to_dfs` — `lib/window/movement.sh` (spatial order must
    match DFS order before joins can work)
12. **Phase 1** `apply_layout` — `lib/layout/phase1_joins.sh`: build nested
    containers via `aerospace join-with`
13. `set_root_layout` — `lib/layout/phase2_layouts.sh`
14. **Phase 2** `apply_layouts` — `lib/layout/phase2_layouts.sh`: apply
    each container's layout type
15. `set_root_layout` — final safety net

## AeroSpace invariants (silent tree-collapsers)

AeroSpace auto-normalizes the tree after every mutation. These rules are
invisible in our code but will actively collapse containers:

1. **Same-orientation flatten.** A nested container with the same
   orientation as its parent is auto-flattened into the parent. Example:
   parent `h_tiles` containing `h_accordion` → the accordion is dissolved,
   its children lifted up.
2. **Single-child flatten.** A container with exactly one child is
   replaced by its child. Root is exempt.

`lib/json/normalize.sh` mirrors both rules *pre-apply* so our idea of the
tree matches what AeroSpace will produce. The web UI's
`web/src/utils/normalization.ts` also enforces rule 1 at edit time via
`fixChildViolations` / `enforceOppositeOrientation`.

**Rule of thumb when debugging "my nested container vanished":** check
orientation of container vs. parent first. Same orientation = AeroSpace
flattens.

## Join direction ↔ container layout mapping

From `lib/layout/direction.sh` (confirmed by tests):

- `join-with left` or `right` → creates `v_tiles` container
- `join-with up` or `down` → creates `h_tiles` container

Phase 1 uses `get_live_join_direction` to read the *live* parent layout
(accounts for prior joins having mutated the tree). A stale/empty live
query falls back to `"tiles"` which then resolves to vertical — that was
the root cause of commit `233e108`.

## File map (one line each)

| Path | Role |
|------|------|
| `lib/core/config.sh` | env-driven constants (TEMP_WORKSPACE, DEBUG, startup polling) |
| `lib/core/logging.sh` | `log` / `debug` / `error` (all to stderr; debug gated on `DEBUG=1`) |
| `lib/core/dependencies.sh` | `check_dependencies` (aerospace, jq) |
| `lib/aerospace/commands.sh` | thin wrappers over the `aerospace` CLI |
| `lib/json/parsing.sh` | `get_root_container`, `get_workspace_from_dump` |
| `lib/json/normalize.sh` | pre-apply normalization (orientation flip + single-child flatten) |
| `lib/tree/traversal.sh` | `get_first_window_id`, `get_last_window_id` (DFS) |
| `lib/window/matching.sh` | map definition-window-id → live-window-id by app+title |
| `lib/window/discovery.sh` | enumerate live windows |
| `lib/window/movement.sh` | `clear_workspace_to_temp`, `move_windows_to_workspace`, `reorder_windows_to_dfs` |
| `lib/window/startup.sh` | launch startup apps + poll until present |
| `lib/layout/phase1_joins.sh` | build nested containers via `join-with` |
| `lib/layout/phase2_layouts.sh` | apply layout types post-join; `set_root_layout` |
| `lib/layout/direction.sh` | layout → join direction; live-tree parent-layout query |
| `lib/diff/tree_compare.sh` | `compare_tree_structure` — structural diff (used by `verify`) |
| `tests/test-helpers.sh` | test runner + window provisioning; re-exports diff helpers |
| `tests/test-join-fix.sh`, `tests/complex-layout-tests.sh` | integration suites |
| `web/src/utils/normalization.ts` | client-side same-orientation fixer |
| `web/server/routes/modes.ts` | `resolveMode` — dispatch layout per detected mode |

## Reproducing "definition does not match applied tree"

Use the built-in verifier:

```bash
# compare only, no apply
aerospace-layout-manager verify <workspace> path/to/layout.json

# apply, then compare
aerospace-layout-manager apply-verify <workspace> path/to/layout.json

# full trace of every stage
DEBUG=1 aerospace-layout-manager apply-verify <ws> layout.json 2>&1 | tee trace.log
```

The diff prints expected vs actual structure + per-field mismatches. In
`trace.log`, search for:

- `single-child container flattened` — pre-normalize dissolved something
- `Join direction for creating X: join=Y opposite=Z` — Phase 1 creating a
  nested container; if the resulting orientation matches the parent,
  AeroSpace will auto-flatten it
- `set_root_layout: no root-level windows, skipping` — all windows ended
  up in nested containers, root layout not re-applied
- `get_live_parent_layout: ... layout=tiles` — live query fell back;
  check that `aerospace tree --json` is available

## Conventions

- Every `lib/*.sh` module starts with a double-source guard:
  `[[ -n "${_ALM_X_LOADED:-}" ]] && return 0; _ALM_X_LOADED=1`
- `log` goes to stderr; stdout is reserved for piped data.
- `debug` messages are only emitted when `DEBUG=1`.
- New lib modules must be sourced from `lib/init.sh` in dependency order.
- Commit format (from global): `feat|fix|chore|docs(<scope>): <desc>`.

## Testing

- Bash integration: `tests/test-join-fix.sh`, `tests/complex-layout-tests.sh`
  — both use `compare_tree_structure`. Need a running AeroSpace + iTerm2.
- Web unit: `web/tests/` (vitest).
- Web e2e: `web/e2e/*.spec.ts` (Playwright; `web/playwright.config.ts`).

## Known failure modes

- Nested container with same orientation as parent → silently flattened
  by AeroSpace. Pre-normalize should catch it; if not, check whether the
  definition orientation got mutated after normalize.
- `aerospace tree` without `--json` returns text, not JSON. `jq` then
  returns empty and live-tree queries fall through to defaults. See
  commit `233e108`.
- Phase 2 re-applies layout targeting focused window's *parent*. If that
  parent was auto-flattened between Phase 1 and Phase 2, the layout
  applies to the wrong container.
