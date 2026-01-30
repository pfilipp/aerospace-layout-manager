#!/bin/bash
# =============================================================================
# Aerospace CLI command wrappers
#
# These wrappers provide a single point of indirection for all aerospace
# CLI calls, enabling:
# - Easy mocking for tests
# - Consistent error handling
# - Debug logging of all commands
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_COMMANDS_LOADED:-}" ]] && return 0
_ALM_COMMANDS_LOADED=1

# List windows with optional filtering
# Usage: aerospace_list_windows [--workspace WS] [--monitor MON] [--app-bundle-id ID] [--format FMT]
aerospace_list_windows() {
    aerospace list-windows "$@" 2>/dev/null || echo ""
}

# Move a window to a workspace
# Usage: aerospace_move_node_to_workspace --window-id WID WORKSPACE
aerospace_move_node_to_workspace() {
    aerospace move-node-to-workspace "$@" 2>/dev/null || true
}

# Focus a specific window
# Usage: aerospace_focus --window-id WID
aerospace_focus() {
    aerospace focus "$@" 2>/dev/null || true
}

# Switch to a workspace
# Usage: aerospace_workspace WORKSPACE
aerospace_workspace() {
    aerospace workspace "$@" 2>/dev/null || true
}

# Flatten the workspace tree
# Usage: aerospace_flatten_workspace_tree --workspace WS
aerospace_flatten_workspace_tree() {
    aerospace flatten-workspace-tree "$@" 2>/dev/null || true
}

# Set the layout for the current container
# Usage: aerospace_layout LAYOUT
aerospace_layout() {
    aerospace layout "$@" 2>/dev/null || true
}

# Join the focused window with a neighbor
# Usage: aerospace_join_with DIRECTION
aerospace_join_with() {
    aerospace join-with "$@" 2>/dev/null || true
}

# Move the focused window in a direction
# Usage: aerospace_move DIRECTION
aerospace_move() {
    aerospace move "$@" 2>/dev/null || true
}
