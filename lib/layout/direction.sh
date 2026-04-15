#!/bin/bash
# =============================================================================
# Layout direction logic for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LAYOUT_DIRECTION_LOADED:-}" ]] && return 0
_ALM_LAYOUT_DIRECTION_LOADED=1

# Determine the join direction based on a layout type string.
#
# KEY FINDINGS from testing:
# - join-with left/right -> creates v_tiles (vertical container)
# - join-with up/down -> creates h_tiles (horizontal container)
#
# For v_* layout: windows are stacked vertically (DFS order top to bottom)
#   - Focus FIRST window, join-with DOWN -> finds next window below
# For h_* layout: windows are side by side (DFS order left to right)
#   - Focus FIRST window, join-with RIGHT -> finds next window to the right
get_join_direction() {
    local current_layout="$1"
    local target_layout="${2:-}"  # unused, kept for backward compat

    local is_vertical=false
    case "$current_layout" in
        "v_tiles"|"v_accordion"|"tiles"|"")
            is_vertical=true
            ;;
        "h_tiles"|"h_accordion")
            is_vertical=false
            ;;
    esac

    if $is_vertical; then
        echo "down"
    else
        echo "right"
    fi
}

# Get the OPPOSITE join direction (for initial join to get correct window order)
#
# When join-with is executed, the FOUND window (in that direction) becomes FIRST
# in the container, and the SOURCE window (focused) becomes SECOND.
#
# To get correct order [A, B] when joining A and B:
# - Focus B (last), join opposite direction -> finds A -> creates [A, B]
get_opposite_join_direction() {
    local current_layout="$1"

    local is_vertical=false
    case "$current_layout" in
        "v_tiles"|"v_accordion"|"tiles"|"")
            is_vertical=true
            ;;
        "h_tiles"|"h_accordion")
            is_vertical=false
            ;;
    esac

    if $is_vertical; then
        echo "up"
    else
        echo "left"
    fi
}

# Query the LIVE aerospace tree to determine the layout of the container
# that holds a given window. This is used after tree mutations (joins)
# to get the ACTUAL spatial arrangement rather than assuming it from
# the original root layout.
#
# Usage: get_live_parent_layout <workspace> <window_id>
# Returns: the layout type of the container holding that window, or
#          the workspace root layout if window is at the top level.
get_live_parent_layout() {
    local workspace="$1"
    local window_id="$2"

    local tree_json
    tree_json=$(aerospace tree --json --workspace "$workspace" 2>/dev/null || echo "")

    if [[ -z "$tree_json" ]]; then
        debug "get_live_parent_layout: could not query tree for workspace $workspace"
        echo ""
        return
    fi

    # Find the container that holds this window and return its layout.
    # Walk the tree recursively: if a container's direct children include
    # the target window-id, return that container's layout.
    local parent_layout
    parent_layout=$(echo "$tree_json" | jq -r --argjson wid "$window_id" '
        # Recursive search: find the container whose direct children include wid
        def find_parent:
            if .type == "container" or .type == "workspace" then
                (.children // []) as $kids |
                # Check if any direct child is the target window
                if ($kids | any(select(.type == "window" and .["window-id"] == $wid))) then
                    .layout // "tiles"
                else
                    # Recurse into child containers
                    ($kids | map(select(.type == "container" or .type == "workspace")) | map(find_parent) | map(select(. != null)) | first) // null
                end
            else null
            end;
        if type == "array" then .[0] else . end | find_parent // "tiles"
    ' 2>/dev/null || echo "tiles")

    debug "get_live_parent_layout: window $window_id is in container with layout=$parent_layout"
    echo "$parent_layout"
}

# Determine join direction by querying the LIVE tree state.
# This accounts for tree mutations from prior joins.
#
# Usage: get_live_join_direction <workspace> <window_id>
# Returns: direction string (up/down/left/right) for join-with
get_live_join_direction() {
    local workspace="$1"
    local window_id="$2"

    local live_layout
    live_layout=$(get_live_parent_layout "$workspace" "$window_id")
    get_join_direction "$live_layout"
}

# Get the OPPOSITE of the live join direction
get_live_opposite_join_direction() {
    local workspace="$1"
    local window_id="$2"

    local live_layout
    live_layout=$(get_live_parent_layout "$workspace" "$window_id")
    get_opposite_join_direction "$live_layout"
}
