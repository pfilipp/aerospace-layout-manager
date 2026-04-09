#!/usr/bin/env bash
# =============================================================================
# Layout generation engine for alm-config
#
# Pure transformation functions: template reading, variable substitution,
# app filtering, container pruning/collapse, window-id renumbering,
# and JSON validation. No TUI dependency.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_CONFIG_GENERATE_LOADED:-}" ]] && return 0
_ALM_CONFIG_GENERATE_LOADED=1

# Resolve the ALM repo root (follows symlinks)
_GENERATE_SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ALM_REPO_ROOT="${ALM_REPO_ROOT:-$(cd "$_GENERATE_SCRIPT_DIR/../.." && pwd)}"

# Output directories
ALM_CONFIG_DIR="${ALM_CONFIG_DIR:-$HOME/.config/aerospace}"
ALM_LAYOUTS_DIR="${ALM_LAYOUTS_DIR:-$ALM_CONFIG_DIR/layouts}"
ALM_PROJECTS_FILE="${ALM_PROJECTS_FILE:-$ALM_CONFIG_DIR/projects.json}"

# =============================================================================
# generate_layout <workspace> <mode>
#
# Main entry point. Reads template, reads project data from projects.json,
# runs the transformation pipeline, writes output JSON atomically.
#   workspace: code, code2, code3, homelab
#   mode: dual or avp
#
# Returns 0 on success, 1 on error.
# =============================================================================
generate_layout() {
    local workspace="$1"
    local mode="$2"

    if [[ -z "$workspace" || -z "$mode" ]]; then
        echo "[ERROR] generate_layout requires <workspace> <mode>" >&2
        return 1
    fi

    # Resolve template path
    local template_dir="$ALM_REPO_ROOT/templates/$mode"
    local template_file="$template_dir/$workspace.json"

    if [[ ! -f "$template_file" ]]; then
        echo "[ERROR] Template not found: $template_file" >&2
        return 1
    fi

    # Read project data from projects.json
    if [[ ! -f "$ALM_PROJECTS_FILE" ]]; then
        echo "[ERROR] Projects file not found: $ALM_PROJECTS_FILE" >&2
        return 1
    fi

    local project_name
    project_name=$(jq -r --arg ws "$workspace" '.workspaces[$ws].project // empty' "$ALM_PROJECTS_FILE")

    if [[ -z "$project_name" ]]; then
        echo "[ERROR] No project assigned to workspace '$workspace'" >&2
        return 1
    fi

    local project_json
    project_json=$(jq --arg name "$project_name" '.projects[$name] // empty' "$ALM_PROJECTS_FILE")

    if [[ -z "$project_json" || "$project_json" == "null" ]]; then
        echo "[ERROR] Project '$project_name' not found in projects.json" >&2
        return 1
    fi

    # Extract project fields
    local project_dir project_subdir project_iterm_cmd project_xcodeproj
    project_dir=$(echo "$project_json" | jq -r '.dir // ""')
    project_subdir=$(echo "$project_json" | jq -r '.subdir // ""')
    project_iterm_cmd=$(echo "$project_json" | jq -r '.iterm_cmd // ""')
    project_xcodeproj=$(echo "$project_json" | jq -r '.xcodeproj // ""')

    # Expand tilde in project_dir
    project_dir="${project_dir/#\~/$HOME}"

    # Build apps list as JSON array
    local apps_json
    apps_json=$(echo "$project_json" | jq -c '.apps // []')

    # Default iterm_cmd if empty
    if [[ -z "$project_iterm_cmd" ]]; then
        if [[ -n "$project_subdir" ]]; then
            project_iterm_cmd="cd $project_dir/$project_subdir && claude --dangerously-skip-permissions"
        else
            project_iterm_cmd="cd $project_dir && claude --dangerously-skip-permissions"
        fi
    fi

    # Read template
    local json
    json=$(cat "$template_file")

    # Run transformation pipeline
    json=$(substitute_vars "$json" "$project_name" "$project_dir" "$project_subdir" "$project_iterm_cmd" "$project_xcodeproj") || return 1
    json=$(filter_apps "$json" "$apps_json" "$project_xcodeproj") || return 1
    json=$(prune_containers "$json") || return 1
    json=$(collapse_containers "$json") || return 1
    json=$(renumber_windows "$json") || return 1

    # Validate output
    validate_output "$json" || return 1

    # Determine output path
    local output_dir="$ALM_LAYOUTS_DIR"
    [[ "$mode" == "avp" ]] && output_dir="$ALM_LAYOUTS_DIR/avp"

    # Ensure output directory exists
    mkdir -p "$output_dir"

    # Atomic write: write to temp file, then rename
    local output_file="$output_dir/$workspace.json"
    local tmp_file="$output_file.tmp.$$"

    if echo "$json" | jq '.' > "$tmp_file" 2>/dev/null; then
        mv -f "$tmp_file" "$output_file"
        echo "Generated: $output_file" >&2
        return 0
    else
        rm -f "$tmp_file"
        echo "[ERROR] Failed to write output file: $output_file" >&2
        return 1
    fi
}

# =============================================================================
# substitute_vars <json> <name> <dir> <subdir> <iterm_cmd> <xcodeproj>
#
# Replace ${VAR} placeholders with project values using jq.
# Handles empty PROJECT_SUBDIR: ${PROJECT_DIR}/${PROJECT_SUBDIR} becomes
# ${PROJECT_DIR} with no trailing slash.
# All jq operations preserve all existing fields via update operators.
# =============================================================================
substitute_vars() {
    local json="$1"
    local project_name="$2"
    local project_dir="$3"
    local project_subdir="$4"
    local project_iterm_cmd="$5"
    local project_xcodeproj="$6"

    # Build the dir/subdir combined path (no trailing slash when subdir is empty)
    local project_full_path="$project_dir"
    if [[ -n "$project_subdir" ]]; then
        project_full_path="$project_dir/$project_subdir"
    fi

    echo "$json" | jq \
        --arg name "$project_name" \
        --arg dir "$project_dir" \
        --arg subdir "$project_subdir" \
        --arg full_path "$project_full_path" \
        --arg iterm_cmd "$project_iterm_cmd" \
        --arg xcodeproj "$project_xcodeproj" \
        '
        # Recursive function to substitute variables in all string values
        def subst_strings:
            if type == "object" then
                to_entries | map(
                    .value |= subst_strings
                ) | from_entries
            elif type == "array" then
                map(subst_strings)
            elif type == "string" then
                # Replace combined dir/subdir pattern first (before individual replacements)
                gsub("\\$\\{PROJECT_DIR\\}/\\$\\{PROJECT_SUBDIR\\}"; $full_path)
                | gsub("\\$\\{PROJECT_DIR\\}"; $dir)
                | gsub("\\$\\{PROJECT_SUBDIR\\}"; $subdir)
                | gsub("\\$\\{PROJECT_NAME\\}"; $name)
                | gsub("\\$\\{PROJECT_ITERM_CMD\\}"; $iterm_cmd)
                | gsub("\\$\\{PROJECT_XCODEPROJ\\}"; $xcodeproj)
            else
                .
            end;
        subst_strings
        '
}

# =============================================================================
# filter_apps <json> <apps_json_array> <xcodeproj>
#
# Remove window nodes whose app-bundle-id is NOT in the apps list.
# Additionally remove Xcode windows when xcodeproj is empty (startup
# command would be invalid: "open <dir>/").
# Operates recursively on all containers, preserving all fields.
# =============================================================================
filter_apps() {
    local json="$1"
    local apps_json="$2"
    local xcodeproj="$3"

    echo "$json" | jq \
        --argjson apps "$apps_json" \
        --arg xcodeproj "$xcodeproj" \
        '
        def filter_children:
            if type == "object" then
                if .type == "container" and (.children // null) != null then
                    .children |= [
                        .[] | select(
                            if .type == "window" then
                                # Keep window if its app-bundle-id is in the apps list
                                # AND it is not an Xcode window with empty xcodeproj
                                (."app-bundle-id" as $bid |
                                    ($apps | index($bid)) != null
                                    and (if $bid == "com.apple.dt.Xcode" and $xcodeproj == "" then false else true end)
                                )
                            else
                                true  # Keep containers (will be pruned later if empty)
                            end
                        ) | filter_children
                    ]
                elif .type == "workspace" and has("root-container") then
                    ."root-container" |= filter_children
                else
                    .
                end
            elif type == "array" then
                map(filter_children)
            else
                .
            end;
        filter_children
        '
}

# =============================================================================
# prune_containers <json>
#
# Recursively remove containers with 0 children. Re-runs until stable
# (filtering may create cascading empty containers).
# Preserves all fields on remaining objects.
# =============================================================================
prune_containers() {
    local json="$1"
    local prev=""
    local current="$json"

    # Iterate until no changes (stable)
    while [[ "$current" != "$prev" ]]; do
        prev="$current"
        current=$(echo "$current" | jq '
            def prune:
                if type == "object" then
                    if .type == "container" and (.children // null) != null then
                        .children |= [
                            .[] | prune | select(
                                if .type == "container" and (.children // null) != null then
                                    (.children | length) > 0
                                else
                                    true
                                end
                            )
                        ]
                    elif .type == "workspace" and has("root-container") then
                        ."root-container" |= prune
                    else
                        .
                    end
                elif type == "array" then
                    map(prune)
                else
                    .
                end;
            prune
        ')
    done

    echo "$current"
}

# =============================================================================
# collapse_containers <json>
#
# If a container has exactly 1 child that is also a container, replace
# the parent with the child (promote). Repeat until stable.
# Single-child-window containers are left as-is.
# Preserves all fields on remaining objects.
# =============================================================================
collapse_containers() {
    local json="$1"
    local prev=""
    local current="$json"

    while [[ "$current" != "$prev" ]]; do
        prev="$current"
        current=$(echo "$current" | jq '
            def collapse:
                if type == "object" then
                    if .type == "container" and (.children // null) != null then
                        .children |= map(collapse)
                        |
                        if (.children | length) == 1 and (.children[0].type == "container") then
                            .children[0]
                        else
                            .
                        end
                    elif .type == "workspace" and has("root-container") then
                        ."root-container" |= collapse
                    else
                        .
                    end
                elif type == "array" then
                    map(collapse)
                else
                    .
                end;
            collapse
        ')
    done

    echo "$current"
}

# =============================================================================
# renumber_windows <json>
#
# Assign sequential window-id values starting from 1 in DFS order.
# Preserves all fields via update operations.
# =============================================================================
renumber_windows() {
    local json="$1"

    echo "$json" | jq '
        # Collect all window paths in DFS order, then update them
        def window_paths:
            path(.. | select(type == "object" and .type == "window"));

        [window_paths] as $paths
        | reduce range(0; $paths | length) as $i (
            .;
            setpath($paths[$i] + ["window-id"]; $i + 1)
        )
    '
}

# =============================================================================
# validate_output <json>
#
# Verify JSON is valid, has exactly 1 workspace, and the root-container
# has at least 1 window (directly or nested in containers).
# =============================================================================
validate_output() {
    local json="$1"

    # Check valid JSON
    if ! echo "$json" | jq empty 2>/dev/null; then
        echo "[ERROR] Generated JSON is not valid" >&2
        return 1
    fi

    # Check structure: array with exactly 1 workspace element
    local ws_count
    ws_count=$(echo "$json" | jq 'if type == "array" then length else 0 end')
    if [[ "$ws_count" != "1" ]]; then
        echo "[ERROR] Expected exactly 1 workspace, got $ws_count" >&2
        return 1
    fi

    # Check root-container exists
    local has_root
    has_root=$(echo "$json" | jq '.[0] | has("root-container")')
    if [[ "$has_root" != "true" ]]; then
        echo "[ERROR] Workspace is missing root-container" >&2
        return 1
    fi

    # Check at least 1 window exists somewhere in the tree
    local window_count
    window_count=$(echo "$json" | jq '[.. | select(type == "object" and .type == "window")] | length')
    if [[ "$window_count" -lt 1 ]]; then
        echo "[ERROR] Generated layout has no windows" >&2
        return 1
    fi

    return 0
}

# =============================================================================
# delete_layout <workspace> <mode>
#
# Remove a generated layout file for the given workspace and mode.
# =============================================================================
delete_layout() {
    local workspace="$1"
    local mode="$2"

    local output_dir="$ALM_LAYOUTS_DIR"
    [[ "$mode" == "avp" ]] && output_dir="$ALM_LAYOUTS_DIR/avp"

    local output_file="$output_dir/$workspace.json"
    if [[ -f "$output_file" ]]; then
        rm -f "$output_file"
        echo "Removed: $output_file" >&2
    fi
}

# =============================================================================
# generate_workspace_layouts <workspace>
#
# Generate both dual and AVP layouts for a workspace.
# Silently skips a mode if its template does not exist.
# =============================================================================
generate_workspace_layouts() {
    local workspace="$1"
    local errors=0

    for mode in dual avp; do
        local template="$ALM_REPO_ROOT/templates/$mode/$workspace.json"
        if [[ -f "$template" ]]; then
            generate_layout "$workspace" "$mode" || ((errors++))
        fi
    done

    return "$errors"
}

# =============================================================================
# regenerate_all_layouts
#
# Regenerate layouts for all assigned workspaces.
# =============================================================================
regenerate_all_layouts() {
    if [[ ! -f "$ALM_PROJECTS_FILE" ]]; then
        echo "[ERROR] Projects file not found: $ALM_PROJECTS_FILE" >&2
        return 1
    fi

    local errors=0
    local workspaces
    workspaces=$(jq -r '.workspaces | to_entries[] | select(.value.project != null and .value.project != "") | .key' "$ALM_PROJECTS_FILE")

    if [[ -z "$workspaces" ]]; then
        echo "No workspaces have assigned projects." >&2
        return 0
    fi

    while IFS= read -r ws; do
        generate_workspace_layouts "$ws" || ((errors++))
    done <<< "$workspaces"

    if [[ "$errors" -gt 0 ]]; then
        echo "[ERROR] $errors workspace(s) had generation errors" >&2
        return 1
    fi

    return 0
}
