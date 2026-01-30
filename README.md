# aerospace-layout-manager

Recreate AeroSpace window layouts from `dump-tree` JSON output. Save your window arrangements and restore them with a single command.

## Requirements

- [AeroSpace](https://github.com/nikitabobko/AeroSpace) window manager with `dump-tree` command support
- Bash 4.0+
- [jq](https://stedolan.github.io/jq/) for JSON parsing

## Installation

### Via Nix Flake

Add to your `flake.nix` inputs:

```nix
aerospace-layout-manager = {
  url = "github:pfilipp/aerospace-layout-manager";
  flake = false;
};
```

Then symlink in your home-manager config:

```nix
home.file.".local/bin/aerospace-layout-manager" = {
  source = "${aerospace-layout-manager}/bin/aerospace-layout-manager";
  executable = true;
};
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/pfilipp/aerospace-layout-manager.git
cd aerospace-layout-manager

# Copy to your PATH
cp bin/aerospace-layout-manager ~/.local/bin/
chmod +x ~/.local/bin/aerospace-layout-manager
```

## Usage

### Basic Usage

```bash
# Recreate layout from a saved JSON file
aerospace-layout-manager <target-workspace> <layout.json>

# Recreate layout from stdin
aerospace-layout-manager <target-workspace> < layout.json

# Pipe directly from aerospace dump-tree
aerospace dump-tree --workspace source | aerospace-layout-manager target
```

### Creating Layout Files

Save your current layout using `aerospace dump-tree`:

```bash
# Save current workspace layout
aerospace dump-tree --workspace main > ~/.config/aerospace/layouts/main.json
```

The JSON format matches the output of `aerospace dump-tree`:

```json
[
  {
    "name": "main",
    "type": "workspace",
    "root-container": {
      "type": "container",
      "layout": "h_accordion",
      "children": [
        {
          "type": "window",
          "app-bundle-id": "com.microsoft.VSCode",
          "title": "my-project",
          "window-id": 1
        },
        {
          "type": "container",
          "layout": "v_tiles",
          "children": [...]
        }
      ]
    }
  }
]
```

### Window Matching

Windows are matched by **bundle ID** and **title** (with fallbacks):

1. If title is empty: matches first window with that bundle ID
2. Exact title match
3. Substring match (title contained in window title)
4. Case-insensitive substring match

This means your layout files stay valid even when window titles change slightly (like document names or branch names in editors).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEROSPACE_TEMP_WORKSPACE` | `temp` | Temporary workspace used during layout recreation |
| `DEBUG` | `0` | Set to `1` for verbose debug output |

### Examples

```bash
# Restore a "daily" workspace layout
aerospace-layout-manager daily ~/.config/aerospace/layouts/daily.json

# Clone current layout to another workspace
aerospace dump-tree --workspace 1 | aerospace-layout-manager 2

# Debug mode for troubleshooting
DEBUG=1 aerospace-layout-manager main layout.json
```

## How It Works

1. **Window Discovery**: Parses the dump-tree JSON and finds matching windows by bundle ID and title
2. **Workspace Clearing**: Moves existing windows to a temp workspace
3. **Window Placement**: Moves windows to the target workspace in DFS order
4. **Container Creation**: Uses `join-with` commands to recreate the nested container structure
5. **Layout Application**: Sets the correct layout type (tiles/accordion) for each container

See [docs/DEVELOPMENT_NOTES.md](docs/DEVELOPMENT_NOTES.md) for detailed algorithm documentation.

## Test Harness

Run the test suite to verify aerospace behavior:

```bash
# Run all tests
./tests/aerospace-layout-tests.sh

# Run a specific test
./tests/aerospace-layout-tests.sh 1.3

# List available tests
./tests/aerospace-layout-tests.sh --list
```

Tests cover atomic operations like join directions, layout changes, and spatial navigation.

## Limitations

- Requires windows to already exist (doesn't launch apps)
- Window matching depends on bundle ID and title - windows that can't be found will cause an error
- Works best when the same apps are running as when the layout was saved

## License

MIT
