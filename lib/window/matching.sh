#!/bin/bash
# =============================================================================
# Window matching logic for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_MATCHING_LOADED:-}" ]] && return 0
_ALM_WINDOW_MATCHING_LOADED=1

# Check if a window ID is in a space-separated exclusion list
# Returns 0 (true) if excluded, 1 (false) if not
_is_excluded() {
    local wid="$1"
    local exclude_list="$2"
    [[ -z "$exclude_list" ]] && return 1
    local excluded
    for excluded in $exclude_list; do
        [[ "$wid" == "$excluded" ]] && return 0
    done
    return 1
}

# Find a window by bundle-id with flexible title matching
# Matching priority:
#   1. If title is empty -> return first window with this bundle-id
#   2. Exact title match
#   3. Substring match (title contained in window title)
#   4. Case-insensitive substring match
# Optional: source_workspace - if provided and title is empty, only search this workspace
# Optional: exclude_ids - space-separated list of window IDs to skip (already claimed)
# Returns window-id or empty string
find_window_by_bundle_and_title() {
    local bundle_id="$1"
    local title="$2"
    local source_workspace="${3:-}"
    local exclude_ids="${4:-}"

    debug "Looking for window: bundle='$bundle_id' title='$title' source_workspace='$source_workspace' exclude='$exclude_ids'"

    # Get windows with this bundle id
    # If title is empty AND source_workspace is specified, only search that workspace
    local windows
    if [[ -z "$title" && -n "$source_workspace" ]]; then
        windows=$(aerospace_list_windows --workspace "$source_workspace" --app-bundle-id "$bundle_id" --format "%{window-id}|%{window-title}")
    else
        windows=$(aerospace_list_windows --monitor all --app-bundle-id "$bundle_id" --format "%{window-id}|%{window-title}")
    fi

    if [[ -z "$windows" ]]; then
        debug "No windows found for bundle: $bundle_id"
        echo ""
        return
    fi

    # If title is empty, return first unclaimed window with this bundle-id
    if [[ -z "$title" ]]; then
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local wid="${line%%|*}"
            if _is_excluded "$wid" "$exclude_ids"; then
                debug "Empty title - skipping excluded window: $wid"
                continue
            fi
            debug "Empty title - returning first unclaimed window: $wid"
            echo "$wid"
            return
        done <<< "$windows"
        debug "Empty title - all windows excluded"
        echo ""
        return
    fi

    # Collect windows for multi-pass matching
    local -a wids=()
    local -a wtitles=()
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        wids+=("${line%%|*}")
        wtitles+=("${line#*|}")
    done <<< "$windows"

    # Pass 1: Exact match
    for i in "${!wids[@]}"; do
        if [[ "${wtitles[$i]}" == "$title" ]]; then
            if _is_excluded "${wids[$i]}" "$exclude_ids"; then
                debug "Exact match excluded: window-id=${wids[$i]}"
                continue
            fi
            debug "Found exact match: window-id=${wids[$i]}"
            echo "${wids[$i]}"
            return
        fi
    done

    # Pass 2: Substring match (title contained in window title)
    for i in "${!wids[@]}"; do
        if [[ "${wtitles[$i]}" == *"$title"* ]]; then
            if _is_excluded "${wids[$i]}" "$exclude_ids"; then
                debug "Substring match excluded: window-id=${wids[$i]}"
                continue
            fi
            debug "Found substring match: window-id=${wids[$i]} (title contains '$title')"
            echo "${wids[$i]}"
            return
        fi
    done

    # Pass 3: Case-insensitive substring match
    local title_lower
    title_lower=$(echo "$title" | tr '[:upper:]' '[:lower:]')
    for i in "${!wids[@]}"; do
        local wtitle_lower
        wtitle_lower=$(echo "${wtitles[$i]}" | tr '[:upper:]' '[:lower:]')
        if [[ "$wtitle_lower" == *"$title_lower"* ]]; then
            if _is_excluded "${wids[$i]}" "$exclude_ids"; then
                debug "Case-insensitive match excluded: window-id=${wids[$i]}"
                continue
            fi
            debug "Found case-insensitive match: window-id=${wids[$i]}"
            echo "${wids[$i]}"
            return
        fi
    done

    debug "No match found for '$title'"
    echo ""
}
