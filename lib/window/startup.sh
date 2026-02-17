#!/bin/bash
# =============================================================================
# Window startup functions for aerospace-layout-manager
#
# Handles launching missing windows via startup commands and identifying
# newly created windows using a staging workspace approach.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_STARTUP_LOADED:-}" ]] && return 0
_ALM_WINDOW_STARTUP_LOADED=1

# Execute a startup command for a missing window
# Prepends the project's bin/ dir to PATH so helpers like iterm-open are found
# Args: startup_cmd, bundle_id, title
# Returns: 0 on success, 1 on failure
execute_startup_command() {
    local startup_cmd="$1"
    local bundle_id="$2"
    local title="$3"

    debug "Executing startup command for $bundle_id '$title': $startup_cmd"

    # Prepend project's bin/ dir to PATH so helpers like iterm-open are found
    local project_bin
    project_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin"
    local original_path="$PATH"
    export PATH="$project_bin:$PATH"

    if eval "$startup_cmd" > /dev/null 2>/dev/null; then
        export PATH="$original_path"
        debug "Startup command succeeded for $bundle_id '$title'"
        return 0
    else
        export PATH="$original_path"
        debug "Startup command failed for $bundle_id '$title'"
        return 1
    fi
}

# Snapshot window IDs in the staging workspace for a given bundle_id
# Switches to the staging workspace and captures current window IDs (the "before" state)
# Args: bundle_id
# Outputs: newline-separated list of window IDs (may be empty)
snapshot_staging_windows() {
    local bundle_id="$1"

    # Switch to the staging workspace
    aerospace_workspace "$STARTUP_WORKSPACE"

    # List all window IDs across all monitors for this bundle_id
    aerospace_list_windows --monitor all --app-bundle-id "$bundle_id" --format "%{window-id}"
}

# Poll for a new window by diffing all monitors against a before snapshot
# If title is provided, matches among new windows; otherwise takes first new window
# Args: bundle_id, before_snapshot (newline-separated window IDs), title (optional)
# Outputs: the new window-id on stdout (empty string on timeout)
poll_for_new_window() {
    local bundle_id="$1"
    local before_snapshot="$2"
    local title="$3"

    local elapsed=0

    while (( elapsed < STARTUP_POLL_TIMEOUT )); do
        sleep "$STARTUP_POLL_INTERVAL"
        elapsed=$(( elapsed + STARTUP_POLL_INTERVAL ))

        # Get current windows across all monitors
        local current_windows
        current_windows=$(aerospace_list_windows --monitor all --app-bundle-id "$bundle_id" --format "%{window-id}")

        # Find new window IDs by diffing
        local new_ids
        new_ids=$(comm -23 <(echo "$current_windows" | sort) <(echo "$before_snapshot" | sort))

        if [[ -z "$new_ids" ]]; then
            debug "Polling for new window ($elapsed/${STARTUP_POLL_TIMEOUT}s)..."
            continue
        fi

        # If no title to match, return first new window
        if [[ -z "$title" ]]; then
            local new_id
            new_id=$(echo "$new_ids" | head -1)
            debug "Found new window $new_id (no title filter) after ${elapsed}s"
            echo "$new_id"
            return 0
        fi

        # Title matching among new windows
        for new_id in $new_ids; do
            local win_title
            win_title=$(aerospace_list_windows --monitor all --app-bundle-id "$bundle_id" --format "%{window-id}|%{window-title}" \
                | grep "^${new_id}|" | cut -d'|' -f2-)

            # Exact match
            if [[ "$win_title" == "$title" ]]; then
                debug "Found new window $new_id (exact title match) after ${elapsed}s"
                echo "$new_id"
                return 0
            fi
            # Substring match
            if [[ "$win_title" == *"$title"* ]]; then
                debug "Found new window $new_id (substring title match) after ${elapsed}s"
                echo "$new_id"
                return 0
            fi
            # Case-insensitive substring
            local title_lower win_title_lower
            title_lower=$(echo "$title" | tr '[:upper:]' '[:lower:]')
            win_title_lower=$(echo "$win_title" | tr '[:upper:]' '[:lower:]')
            if [[ "$win_title_lower" == *"$title_lower"* ]]; then
                debug "Found new window $new_id (case-insensitive match) after ${elapsed}s"
                echo "$new_id"
                return 0
            fi
        done

        debug "New windows found but no title match yet ($elapsed/${STARTUP_POLL_TIMEOUT}s)..."
    done

    debug "Timeout waiting for new window from $bundle_id"
    echo ""
    return 0
}
