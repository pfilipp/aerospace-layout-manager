#!/bin/bash
# =============================================================================
# Layout direction logic for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LAYOUT_DIRECTION_LOADED:-}" ]] && return 0
_ALM_LAYOUT_DIRECTION_LOADED=1

# Determine the join direction based on the CURRENT spatial arrangement
#
# KEY FINDINGS from testing:
# - join-with left/right -> creates v_tiles (vertical container)
# - join-with up/down -> creates h_tiles (horizontal container)
#
# IMPORTANT: When joining windows to create nested containers, ALL windows are
# still at the FLATTENED ROOT level. The ROOT layout determines their spatial
# arrangement, NOT the target parent's layout.
#
# For v_* root: windows are stacked vertically (DFS order top to bottom)
#   - Focus FIRST window, join-with DOWN -> finds next window below
# For h_* root: windows are side by side (DFS order left to right)
#   - Focus FIRST window, join-with RIGHT -> finds next window to the right
get_join_direction() {
    local current_layout="$1"
    local target_layout="$2"

    # Determine current spatial arrangement based on the CURRENT root layout
    # (not the target parent, since windows are still at root level)
    local is_vertical=false
    case "$current_layout" in
        "v_tiles"|"v_accordion"|"")
            is_vertical=true
            ;;
        "h_tiles"|"h_accordion")
            is_vertical=false
            ;;
    esac

    if $is_vertical; then
        # Windows are stacked vertically, first is at top
        # Focus first, join-with down finds the next window below
        echo "down"
    else
        # Windows are side by side horizontally, first is at left
        # Focus first, join-with right finds the next window to the right
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
#
# This is used for 2+ window joins to ensure correct order.
get_opposite_join_direction() {
    local current_layout="$1"

    local is_vertical=false
    case "$current_layout" in
        "v_tiles"|"v_accordion"|"")
            is_vertical=true
            ;;
        "h_tiles"|"h_accordion")
            is_vertical=false
            ;;
    esac

    if $is_vertical; then
        # Windows stacked vertically, opposite of "down" is "up"
        echo "up"
    else
        # Windows side by side, opposite of "right" is "left"
        echo "left"
    fi
}
