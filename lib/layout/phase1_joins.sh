#!/bin/bash
# =============================================================================
# Phase 1: Container creation via joins for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LAYOUT_PHASE1_LOADED:-}" ]] && return 0
_ALM_LAYOUT_PHASE1_LOADED=1

# Apply layout operations recursively (post-order: children first)
#
# UPDATED ALGORITHM based on Phase 1 test findings:
#
# After moving windows in DFS order, they are spatially adjacent.
# The spatial arrangement depends on the CURRENT layout of their parent.
#
# Key insight: Focus the LAST window of a group and join toward the first.
# This works because:
# - In v_* layout: last window is at bottom, join-with up finds previous
# - In h_* layout: last window is at right, join-with left finds previous
#
# Join direction rules (CONFIRMED BY TESTS):
# - join-with left/right -> creates v_tiles container
# - join-with up/down -> creates h_tiles container
apply_layout() {
    local node="$1"
    local mapping="$2"
    local workspace="$3"
    local root_layout="${4:-}"    # The ROOT container's layout (for spatial arrangement)
    local is_root="${5:-false}"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" != "container" ]]; then
        return
    fi

    local layout
    layout=$(echo "$node" | jq -r '.layout // empty')

    local children_json
    children_json=$(echo "$node" | jq -c '.children // []')

    local num_children
    num_children=$(echo "$children_json" | jq 'length')

    debug "Processing container: layout=$layout, children=$num_children, root_layout=$root_layout, is_root=$is_root"

    if [[ "$num_children" -eq 0 ]]; then
        return
    fi

    # First, recursively process all child containers (post-order traversal)
    # This creates the deepest containers first
    # Pass root_layout unchanged - all joins use the root's spatial arrangement
    local child_idx=0
    while [[ $child_idx -lt $num_children ]]; do
        local child
        child=$(echo "$children_json" | jq -c ".[$child_idx]")
        local child_type
        child_type=$(echo "$child" | jq -r '.type // empty')

        if [[ "$child_type" == "container" ]]; then
            apply_layout "$child" "$mapping" "$workspace" "$root_layout" "false"
        fi

        ((child_idx++))
    done

    # Skip joining for root container - its children are already at root level
    # We only need to set the root layout (done separately in main)
    if [[ "$is_root" == "true" ]]; then
        debug "Skipping join for root container (children already at root level)"
        return
    fi

    # Now join children together to form this NESTED container
    if [[ "$num_children" -gt 1 ]]; then
        # Determine join direction based on ROOT's spatial arrangement
        local join_direction
        join_direction=$(get_join_direction "$root_layout" "$layout")

        debug "Join direction for creating $layout (root=$root_layout): $join_direction"

        # ALGORITHM: Build container with correct window order
        #
        # Key insight: When join-with is executed, the FOUND window (in that
        # direction) becomes FIRST in the container, and the SOURCE window
        # (focused) becomes SECOND.
        #
        # For windows-only container [A, B, C]:
        # - Focus B (second), join up -> finds A -> creates [A, B]
        # - Focus C (third), move up -> C enters container at END -> [A, B, C]
        #
        # For container with nested containers, we need special handling:
        # - If second child is a container (already processed), it has been moved
        # - We use FIRST child as anchor, join in FORWARD direction to grab second
        # - This avoids extracting windows from already-created nested containers

        # Get first child info
        local first_child
        first_child=$(echo "$children_json" | jq -c ".[0]")
        local first_child_type
        first_child_type=$(echo "$first_child" | jq -r '.type // empty')
        local first_window_id
        first_window_id=$(get_first_window_id "$first_child" "$mapping")

        # Get second child info
        local second_child
        second_child=$(echo "$children_json" | jq -c ".[1]")
        local second_child_type
        second_child_type=$(echo "$second_child" | jq -r '.type // empty')
        local second_window_id
        second_window_id=$(get_first_window_id "$second_child" "$mapping")

        # Check if any child is a container (already processed in post-order)
        local has_container_children=false
        local child_idx=0
        while [[ $child_idx -lt $num_children ]]; do
            local child_type
            child_type=$(echo "$children_json" | jq -r ".[$child_idx].type // empty")
            if [[ "$child_type" == "container" ]]; then
                has_container_children=true
                break
            fi
            ((child_idx++))
        done

        local opposite_direction
        opposite_direction=$(get_opposite_join_direction "$root_layout")

        if [[ "$has_container_children" == "true" ]]; then
            # Special handling: has nested containers (already created)
            # Focus FIRST window and join FORWARD to avoid extracting from nested containers
            debug "Container has nested container children - using FIRST window as anchor"
            debug "Focusing first window (idx=0): $first_window_id"
            aerospace_focus --window-id "$first_window_id"

            debug "Executing: aerospace join-with $join_direction (joining with $second_window_id)"
            aerospace_join_with "$join_direction"

            # For 3+ children, use move to add remaining
            if [[ "$num_children" -gt 2 ]]; then
                local child_idx=2
                while [[ $child_idx -lt $num_children ]]; do
                    local target_child
                    target_child=$(echo "$children_json" | jq -c ".[$child_idx]")
                    local target_window_id
                    target_window_id=$(get_first_window_id "$target_child" "$mapping")

                    if [[ -n "$target_window_id" ]]; then
                        debug "Executing: aerospace move $join_direction for window $target_window_id (idx=$child_idx)"
                        aerospace_focus --window-id "$target_window_id"
                        aerospace_move "$join_direction"
                    fi

                    ((child_idx++))
                done
            fi
        else
            # Normal case: all children are windows
            # Focus SECOND, join OPPOSITE to get correct order [first, second]
            debug "Focusing second window (idx=1): $second_window_id"
            aerospace_focus --window-id "$second_window_id"

            debug "Executing: aerospace join-with $opposite_direction (joining with $first_window_id)"
            aerospace_join_with "$opposite_direction"

            # For 3+ children, use MOVE to add remaining windows
            if [[ "$num_children" -gt 2 ]]; then
                local child_idx=2
                while [[ $child_idx -lt $num_children ]]; do
                    local target_child
                    target_child=$(echo "$children_json" | jq -c ".[$child_idx]")
                    local target_window_id
                    target_window_id=$(get_first_window_id "$target_child" "$mapping")

                    if [[ -n "$target_window_id" ]]; then
                        debug "Executing: aerospace move $opposite_direction for window $target_window_id (idx=$child_idx)"
                        aerospace_focus --window-id "$target_window_id"
                        aerospace_move "$opposite_direction"
                    fi

                    ((child_idx++))
                done
            fi
        fi
    fi

    # NOTE: Layout is NOT set here anymore - it's done in a separate pass
    # This prevents cascading layout changes during the join phase
    debug "Container joined, layout will be set in second pass"
}
