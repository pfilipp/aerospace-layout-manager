# aerospace-layout-manager

Apply AeroSpace window layouts from JSON. Save arrangements, apply with one command.

## Requirements

- [AeroSpace](https://github.com/nikitabobko/AeroSpace) window manager
- Bash 4.0+
- [jq](https://stedolan.github.io/jq/)

**Optional**: [pfilipp/AeroSpace fork](https://github.com/pfilipp/AeroSpace) adds the `tree` command to export existing layouts to JSON (proposed for upstream inclusion). Without it, you'll need to write layout files manually.

## Installation

### Nix Flake

```nix
# flake.nix inputs
aerospace-layout-manager = {
  url = "github:pfilipp/aerospace-layout-manager";
  flake = false;
};

# home-manager config
home.file.".local/bin/aerospace-layout-manager" = {
  source = "${aerospace-layout-manager}/bin/aerospace-layout-manager";
  executable = true;
};
```

### Manual

```bash
git clone https://github.com/pfilipp/aerospace-layout-manager.git
# Main script (required)
cp aerospace-layout-manager/bin/aerospace-layout-manager ~/.local/bin/
chmod +x ~/.local/bin/aerospace-layout-manager

# Optional helpers for startup commands (only needed if you use them in your layouts)
cp aerospace-layout-manager/bin/safari-profile ~/.local/bin/
cp aerospace-layout-manager/bin/safari-new ~/.local/bin/
chmod +x ~/.local/bin/safari-profile ~/.local/bin/safari-new
```

## Usage

```bash
# From file
aerospace-layout-manager <workspace> <layout.json>

# From stdin
aerospace-layout-manager <workspace> < layout.json

# Pipe from tree
aerospace tree --workspace src | aerospace-layout-manager dest
```

### Flags

| Flag | Description |
|------|-------------|
| `--allow-missing` | Continue even if some windows can't be found or launched |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEROSPACE_TEMP_WORKSPACE` | `temp` | Workspace used during layout recreation |
| `STARTUP_WORKSPACE` | `startup` | Workspace switched to before launching apps |
| `STARTUP_POLL_INTERVAL` | `2` | Seconds between polls when waiting for a new window |
| `STARTUP_POLL_TIMEOUT` | `30` | Max seconds to wait for a launched window to appear |
| `DEBUG` | `0` | Set to `1` for verbose output |

## JSON Structure

The layout JSON is an array with one workspace object. Extra fields from `tree` output (like `app-name`, `orientation`) are ignored and can be left in.

```json
[
  {
    "name": "workspace-name",
    "type": "workspace",
    "root-container": { ... }
  }
]
```

### Node Types

There are two node types: **container** and **window**.

#### Container

```json
{
  "type": "container",
  "layout": "h_tiles",
  "children": [ ... ]
}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `type` | Yes | `"container"` | Node type |
| `layout` | Yes | See below | Container layout |
| `children` | Yes | Array | Child nodes (containers or windows) |

**Layout values:**
- `h_tiles` - Horizontal tiles (windows side by side)
- `v_tiles` - Vertical tiles (windows stacked)
- `h_accordion` - Horizontal accordion
- `v_accordion` - Vertical accordion

#### Window

```json
{
  "type": "window",
  "app-bundle-id": "com.apple.Safari",
  "title": "GitHub",
  "window-id": 12345,
  "startup": "open -b com.apple.Safari https://github.com"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"window"` |
| `app-bundle-id` | Yes | macOS bundle identifier |
| `title` | No | Window title for matching |
| `window-id` | No | Original window ID (ignored during restore) |
| `startup` | No | Shell command to launch the window if not found (see [Startup Commands](#startup-commands)) |
| `source-workspace` | No | Restrict matching to a specific workspace (useful for untitled windows) |

### Complete Example

```json
[
  {
    "name": "dev",
    "type": "workspace",
    "root-container": {
      "type": "container",
      "layout": "h_tiles",
      "children": [
        {
          "type": "window",
          "app-bundle-id": "com.microsoft.VSCode",
          "title": "my-project"
        },
        {
          "type": "container",
          "layout": "v_tiles",
          "children": [
            {
              "type": "window",
              "app-bundle-id": "com.apple.Terminal"
            },
            {
              "type": "window",
              "app-bundle-id": "com.apple.Safari",
              "title": "Documentation"
            }
          ]
        }
      ]
    }
  }
]
```

This creates:
```
h_tiles
├── VSCode (my-project)
└── v_tiles
    ├── Terminal
    └── Safari (Documentation)
```

### Advanced Example

The tool handles complex nested layouts. This 7-window, 3-level deep structure was used during development testing:

```json
[
  {
    "name": "complex",
    "type": "workspace",
    "root-container": {
      "type": "container",
      "layout": "v_accordion",
      "children": [
        {
          "type": "container",
          "layout": "h_tiles",
          "children": [
            { "type": "window", "app-bundle-id": "com.brave.Browser" },
            { "type": "window", "app-bundle-id": "com.apple.dt.Xcode" },
            { "type": "window", "app-bundle-id": "com.figma.Desktop" }
          ]
        },
        { "type": "window", "app-bundle-id": "com.apple.iCal" },
        {
          "type": "container",
          "layout": "h_tiles",
          "children": [
            { "type": "window", "app-bundle-id": "com.apple.AppStore" },
            {
              "type": "container",
              "layout": "v_tiles",
              "children": [
                { "type": "window", "app-bundle-id": "com.apple.mail" },
                { "type": "window", "app-bundle-id": "com.apple.MobileSMS" }
              ]
            }
          ]
        }
      ]
    }
  }
]
```

Result:
```
v_accordion
├── h_tiles [Brave, Xcode, Figma]    ← 3-window container
├── Calendar                          ← standalone window
└── h_tiles                           ← nested container
    ├── App Store
    └── v_tiles [Mail, Messages]      ← 3-level nesting
```

## Window Matching

Windows are matched by bundle ID and title with fallbacks:

1. **Empty title**: First window with matching bundle ID
2. **Exact match**: Title equals window title
3. **Substring**: Title contained in window title
4. **Case-insensitive**: Substring match ignoring case

This handles changing titles (document names, git branches, etc.).

## Startup Commands

When a window can't be found by bundle ID and title, the tool can launch it automatically using the `startup` field. This lets you define fully self-contained layouts that set up an entire workspace from scratch.

### How it works

Window discovery runs in two passes:

1. **Match existing windows** — search all monitors for each window by bundle ID and title
2. **Launch missing windows** — for any window not found in pass 1, execute its `startup` command and wait for the new window to appear

The tool detects newly launched windows by taking a snapshot of all window IDs before the command runs, then polling until a new ID appears. When a `title` is set, the tool matches it against the new windows (exact, substring, then case-insensitive) to pick the right one. When `title` is empty, the first new window is used.

If a window has no `startup` field and can't be found, it's treated as an error (unless `--allow-missing` is passed).

### Writing startup commands

The `startup` value is a shell command evaluated with `bash`. It should open exactly one new window and return immediately — the tool handles waiting.

```json
{
  "type": "window",
  "app-bundle-id": "com.microsoft.VSCode",
  "title": "my-project",
  "startup": "code ~/Projects/my-project"
}
```

Common patterns:

```jsonc
// Open an app by bundle ID
"startup": "open -b com.apple.Safari https://localhost:3000"

// Open a file or project
"startup": "code ~/Projects/my-project"
"startup": "open ~/Documents/notes.md"

// Open a terminal
"startup": "open -a iTerm"

// Use a bundled helper (see below)
"startup": "safari-profile Work"
```

### Bundled helpers (optional)

These helpers are included in `bin/` for convenience — you don't need to install them unless your layouts use them. The `bin/` directory is automatically added to `PATH` when startup commands run, so bundled helpers are available without a full path.

#### `safari-profile`

Opens a new Safari window in a named profile. Safari doesn't support profile selection via CLI flags, so this uses AppleScript to navigate the menu.

```bash
safari-profile Personal
safari-profile Work
```

#### `safari-new`

Opens a new Safari window. Unlike `open -b com.apple.Safari` which activates an existing window, this creates a fresh one via AppleScript.

```bash
safari-new
```

### Tuning poll behavior

When a startup command runs, the tool polls for the new window to appear. You can adjust timing via environment variables:

```bash
# Wait up to 60 seconds, checking every 5 seconds (for slow apps like Xcode)
STARTUP_POLL_TIMEOUT=60 STARTUP_POLL_INTERVAL=5 aerospace-layout-manager dev layout.json
```

### Full example

A layout that sets up a dev workspace with an editor, browser, and two terminals:

```json
[
  {
    "name": "dev",
    "type": "workspace",
    "root-container": {
      "type": "container",
      "layout": "h_tiles",
      "children": [
        {
          "type": "window",
          "app-bundle-id": "com.microsoft.VSCode",
          "title": "my-project",
          "startup": "code ~/Projects/my-project"
        },
        {
          "type": "container",
          "layout": "v_tiles",
          "children": [
            {
              "type": "window",
              "app-bundle-id": "com.apple.Safari",
              "title": "",
              "startup": "open -b com.apple.Safari https://localhost:3000"
            },
            {
              "type": "window",
              "app-bundle-id": "com.googlecode.iterm2",
              "title": "shell",
              "startup": "open -a iTerm"
            },
            {
              "type": "window",
              "app-bundle-id": "com.googlecode.iterm2",
              "title": "logs",
              "startup": "open -a iTerm"
            }
          ]
        }
      ]
    }
  }
]
```

```
h_tiles
├── VSCode (my-project)
└── v_tiles
    ├── Safari (localhost:3000)
    ├── iTerm (shell)
    └── iTerm (logs)
```

Running `aerospace-layout-manager dev layout.json` will find or launch each window, then arrange them into this layout.

> **Tip**: The startup commands above use basic `open -a` invocations. If you need app-specific launch behavior (e.g., opening iTerm with a particular command, or launching a specific VS Code workspace), write your own helper scripts and place them in the `bin/` directory — they'll be available to startup commands automatically.

### Writing your own helpers

You can add custom helpers to the project's `bin/` directory. They'll be available to startup commands automatically. A helper should:

- Open exactly one new window
- Return immediately (don't block waiting for the app)
- Exit 0 on success, non-zero on failure

## Limitations

- Unmatched windows without a `startup` command cause errors (use `--allow-missing` to skip them)
- Works best with same apps running as when saved, though `startup` can fill in gaps
- **Duplicate window matching**: When multiple JSON entries share the same `app-bundle-id` and empty `title`, the engine may match the same physical window for both. Workaround: give each window a distinct `title`, or use `source-workspace` to restrict matching to a specific workspace.
- **Layout ordering in complex nesting**: In some deeply nested layouts, layout types may be applied to the wrong container level. This is a known issue being investigated.

## How It Works

1. Parse JSON layout and clear the target workspace
2. **Discover windows** — match each window by bundle ID + title across all monitors
3. **Launch missing windows** — run `startup` commands for anything not found, detect new windows by diffing window IDs before and after
4. Move all matched windows to the target workspace in DFS order
5. Create nested containers via `join-with` commands (Phase 1)
6. Apply layout types to each container (Phase 2)

See [docs/DEVELOPMENT_NOTES.md](docs/DEVELOPMENT_NOTES.md) for algorithm details.

## Tests

```bash
./tests/aerospace-layout-tests.sh          # Run all
./tests/aerospace-layout-tests.sh 1.3      # Run specific test
./tests/aerospace-layout-tests.sh --list   # List tests
```

## License

MIT
