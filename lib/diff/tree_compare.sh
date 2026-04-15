#!/bin/bash
# =============================================================================
# Tree structure comparison for aerospace-layout-manager
#
# Compares a layout definition (normalized root-container JSON) against the
# live aerospace tree output, producing a structural diff. Structure = layout
# type, nesting, and window counts per container; individual window identity
# is intentionally ignored.
#
# Reusable from bin/ (user-facing verify) and from tests/.
# =============================================================================

[[ -n "${_ALM_DIFF_TREE_COMPARE_LOADED:-}" ]] && return 0
_ALM_DIFF_TREE_COMPARE_LOADED=1

# Fallback logging shims so this module works outside the test harness.
# Tests define colored log_fail / log_verbose in test-helpers.sh; those
# definitions load first there, so these no-op over them.
if ! declare -F log_fail >/dev/null 2>&1; then
    log_fail() { echo "[FAIL] $*" >&2; }
fi
if ! declare -F log_verbose >/dev/null 2>&1; then
    log_verbose() { [[ "${VERBOSE:-false}" == "true" ]] && echo "[VERB] $*" >&2 || true; }
fi

# Extract a normalized structural representation from aerospace tree JSON.
# Output: a JSON object with layout, children (recursive), window_count per
# container, and total_windows. Window identity is ignored -- only counts
# and structure matter.
#
# Usage: echo "$tree_json" | extract_tree_structure
extract_tree_structure() {
    jq '
        def structure:
            if .type == "workspace" then
                ."root-container" | structure
            elif .type == "container" then
                {
                    type: "container",
                    layout: .layout,
                    children: [(.children // []) | .[] | select(.type == "container") | structure],
                    window_count: [(.children // []) | .[] | select(.type == "window")] | length
                }
            else
                empty
            end;

        def count_all_windows:
            if .type == "container" then
                .window_count + ([.children[] | count_all_windows] | add // 0)
            else
                0
            end;

        .[0] | structure | . + { total_windows: count_all_windows }
    '
}

# Build expected tree structure from a definition/fixture JSON (array form).
# Same extraction as extract_tree_structure so both sides compare equally.
#
# Usage: build_expected_structure < definition.json
build_expected_structure() {
    jq '
        def structure:
            if .type == "workspace" then
                ."root-container" | structure
            elif .type == "container" then
                {
                    type: "container",
                    layout: .layout,
                    children: [(.children // []) | .[] | select(.type == "container") | structure],
                    window_count: [(.children // []) | .[] | select(.type == "window")] | length
                }
            else
                empty
            end;

        def count_all_windows:
            if .type == "container" then
                .window_count + ([.children[] | count_all_windows] | add // 0)
            else
                0
            end;

        .[0] | structure | . + { total_windows: count_all_windows }
    '
}

# Internal: compare a single field and report
_compare_field() {
    local label="$1"
    local expected="$2"
    local actual="$3"

    if [[ "$expected" == "$actual" ]]; then
        log_verbose "  $label: $expected (match)"
    else
        log_fail "  $label: expected=$expected actual=$actual"
    fi
}

# Compare actual aerospace tree output against an expected JSON structure.
#
# Arguments:
#   $1 - expected structure JSON (inline string or file path)
#   $2 - actual aerospace tree JSON (inline string or file path)
#
# If $1/$2 start with '/' or './' they are treated as file paths; otherwise
# as inline JSON strings.
#
# Returns 0 on match, 1 on mismatch. On failure, prints a diff showing
# where expected and actual diverge.
compare_tree_structure() {
    local expected_input="$1"
    local actual_input="$2"

    local expected_raw actual_raw
    if [[ "$expected_input" == /* ]] || [[ "$expected_input" == ./* ]]; then
        expected_raw=$(cat "$expected_input")
    else
        expected_raw="$expected_input"
    fi
    if [[ "$actual_input" == /* ]] || [[ "$actual_input" == ./* ]]; then
        actual_raw=$(cat "$actual_input")
    else
        actual_raw="$actual_input"
    fi

    local expected_struct actual_struct
    expected_struct=$(echo "$expected_raw" | build_expected_structure 2>/dev/null) || {
        log_fail "Failed to parse expected tree structure"
        return 1
    }
    actual_struct=$(echo "$actual_raw" | extract_tree_structure 2>/dev/null) || {
        log_fail "Failed to parse actual tree structure"
        return 1
    }

    local expected_norm actual_norm
    expected_norm=$(echo "$expected_struct" | jq -S '.')
    actual_norm=$(echo "$actual_struct" | jq -S '.')

    if [[ "$expected_norm" == "$actual_norm" ]]; then
        log_verbose "Tree structures match"
        return 0
    fi

    log_fail "Tree structure mismatch"

    echo ""
    echo "--- Expected ---"
    echo "$expected_norm" | jq '.'
    echo ""
    echo "--- Actual ---"
    echo "$actual_norm" | jq '.'
    echo ""

    _compare_field "root layout" \
        "$(echo "$expected_struct" | jq -r '.layout')" \
        "$(echo "$actual_struct" | jq -r '.layout')"

    _compare_field "total windows" \
        "$(echo "$expected_struct" | jq -r '.total_windows')" \
        "$(echo "$actual_struct" | jq -r '.total_windows')"

    _compare_field "child container count" \
        "$(echo "$expected_struct" | jq -r '.children | length')" \
        "$(echo "$actual_struct" | jq -r '.children | length')"

    _compare_field "root window count" \
        "$(echo "$expected_struct" | jq -r '.window_count')" \
        "$(echo "$actual_struct" | jq -r '.window_count')"

    local expected_child_count actual_child_count
    expected_child_count=$(echo "$expected_struct" | jq '.children | length')
    actual_child_count=$(echo "$actual_struct" | jq '.children | length')

    local max_children=$expected_child_count
    if [[ $actual_child_count -gt $max_children ]]; then
        max_children=$actual_child_count
    fi

    for ((i = 0; i < max_children; i++)); do
        if [[ $i -ge $expected_child_count ]]; then
            log_fail "  child[$i]: unexpected extra container in actual"
            continue
        fi
        if [[ $i -ge $actual_child_count ]]; then
            log_fail "  child[$i]: missing container in actual (expected: $(echo "$expected_struct" | jq -r ".children[$i].layout"))"
            continue
        fi

        _compare_field "child[$i] layout" \
            "$(echo "$expected_struct" | jq -r ".children[$i].layout")" \
            "$(echo "$actual_struct" | jq -r ".children[$i].layout")"

        _compare_field "child[$i] window count" \
            "$(echo "$expected_struct" | jq -r ".children[$i].window_count")" \
            "$(echo "$actual_struct" | jq -r ".children[$i].window_count")"
    done

    return 1
}
