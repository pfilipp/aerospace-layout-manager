#!/bin/bash
# =============================================================================
# Input pre-normalization for aerospace-layout-manager
#
# Applies AeroSpace tree normalization rules to the layout JSON BEFORE
# Phase 1 processing. This ensures ALM works with the tree structure
# that AeroSpace will actually produce.
#
# Normalization rules:
# 1. Same-orientation flip: If a child container has the same orientation
#    as its parent, flip the child's orientation (h<->v) and update the
#    layout name prefix accordingly.
# 2. Single-child flattening: If a container has exactly 1 child, replace
#    the container with its child in the parent's children array.
#    Root container is exempt from flattening.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_JSON_NORMALIZE_LOADED:-}" ]] && return 0
_ALM_JSON_NORMALIZE_LOADED=1

# Normalize a layout tree (root-container JSON) according to AeroSpace rules.
# Input: root-container JSON object (from get_root_container)
# Output: normalized root-container JSON object
normalize_layout_tree() {
    local root_container="$1"

    local result
    result=$(echo "$root_container" | jq -c '
        # Helper: get orientation from layout name
        def orientation:
            if startswith("h_") then "horizontal"
            elif startswith("v_") then "vertical"
            else "unknown"
            end;

        # Helper: flip layout prefix h_ <-> v_
        def flip_layout:
            if startswith("h_") then "v_" + ltrimstr("h_")
            elif startswith("v_") then "h_" + ltrimstr("v_")
            else .
            end;

        # Helper: flip orientation string
        def flip_orientation:
            if . == "horizontal" then "vertical"
            elif . == "vertical" then "horizontal"
            else .
            end;

        # Recursive normalization function
        # Arguments: parent_layout (string or null for root)
        def normalize(parent_layout):
            if .type != "container" then .
            else
                # Step 1: Flip orientation if same as parent
                (if parent_layout != null and
                    (.layout | orientation) == (parent_layout | orientation)
                then
                    .layout as $old_layout |
                    (.layout | flip_layout) as $new_layout |
                    .layout = $new_layout |
                    .orientation = (.orientation // "" | flip_orientation) |
                    . + {"_normalized_flip": ($old_layout + " -> " + $new_layout)}
                else .
                end) |

                # Step 2: Recursively normalize children
                .layout as $my_layout |
                if .children then
                    .children = [.children[] | normalize($my_layout)]
                else .
                end |

                # Step 3: Flatten single-child containers (non-root only)
                # This is applied to children, not to self (root calls this on children)
                if .children and (.children | length) > 0 then
                    .children = [
                        .children[] |
                        if .type == "container" and .children and (.children | length) == 1 then
                            . + {"_normalized_flatten": true} |
                            .children[0]
                        else .
                        end
                    ]
                else .
                end
            end;

        # Start normalization from root (null parent = root level)
        normalize(null)
    ')

    # Log any normalization changes at debug level
    local flips
    flips=$(echo "$result" | jq -r '
        [.. | objects | select(._normalized_flip) | ._normalized_flip] | .[]
    ' 2>/dev/null || true)

    local flattens
    flattens=$(echo "$result" | jq -r '
        [.. | objects | select(._normalized_flatten) | "single-child container flattened"] | .[]
    ' 2>/dev/null || true)

    if [[ -n "$flips" ]]; then
        while IFS= read -r flip; do
            debug "Normalization: orientation flip applied: $flip"
        done <<< "$flips"
    fi

    if [[ -n "$flattens" ]]; then
        while IFS= read -r flat; do
            debug "Normalization: $flat"
        done <<< "$flattens"
    fi

    # Strip internal normalization markers from output
    result=$(echo "$result" | jq -c '
        walk(if type == "object" then del(._normalized_flip, ._normalized_flatten) else . end)
    ')

    echo "$result"
}
