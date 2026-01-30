# aerospace-layout-manager

Apply AeroSpace window layouts from JSON. Save arrangements, apply with one command.

## Requirements

- [AeroSpace](https://github.com/nikitabobko/AeroSpace) window manager
- Bash 4.0+
- [jq](https://stedolan.github.io/jq/)

**Optional**: [pfilipp/AeroSpace fork](https://github.com/pfilipp/AeroSpace) adds the `dump-tree` command to export existing layouts to JSON. Without it, you'll need to write layout files manually.

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
cp aerospace-layout-manager/bin/aerospace-layout-manager ~/.local/bin/
chmod +x ~/.local/bin/aerospace-layout-manager
```

## Usage

```bash
# From file
aerospace-layout-manager <workspace> <layout.json>

# From stdin
aerospace-layout-manager <workspace> < layout.json

# Pipe from dump-tree
aerospace dump-tree --workspace src | aerospace-layout-manager dest
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEROSPACE_TEMP_WORKSPACE` | `temp` | Workspace used during layout recreation |
| `DEBUG` | `0` | Set to `1` for verbose output |

## JSON Structure

The layout JSON is an array with one workspace object:

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
  "window-id": 12345
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"window"` |
| `app-bundle-id` | Yes | macOS bundle identifier |
| `title` | No | Window title for matching |
| `window-id` | No | Original window ID (ignored during restore) |

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

## Limitations

- Windows must already exist (doesn't launch apps)
- Unmatched windows cause errors
- Works best with same apps running as when saved

## How It Works

1. Parse JSON, map windows by bundle ID + title
2. Move existing windows to temp workspace
3. Move matched windows to target in DFS order
4. Create nested containers via `join-with` commands
5. Apply layout types to each container

See [docs/DEVELOPMENT_NOTES.md](docs/DEVELOPMENT_NOTES.md) for algorithm details.

## Tests

```bash
./tests/aerospace-layout-tests.sh          # Run all
./tests/aerospace-layout-tests.sh 1.3      # Run specific test
./tests/aerospace-layout-tests.sh --list   # List tests
```

## License

MIT
