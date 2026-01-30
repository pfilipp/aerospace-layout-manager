#!/usr/bin/env bash
#
# Aerospace Layout Recreation Test Harness
# Tests atomic operations to understand aerospace behavior before
# building complex layout recreation functionality.
#
# Usage:
#   ./aerospace-layout-tests.sh           # Run all Phase 1 tests
#   ./aerospace-layout-tests.sh 1.1       # Run specific test
#   ./aerospace-layout-tests.sh --list    # List available tests
#

set -euo pipefail

# Configuration
TEST_WS="${TEST_WS:-t}"  # Workspace to use for testing
VERBOSE="${VERBOSE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

#---------------------------------------------------------------------------
# Utility Functions
#---------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $*"
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[VERB]${NC} $*"
    fi
}

# Get current workspace tree as JSON using dump-tree
get_tree() {
    aerospace dump-tree --workspace "$TEST_WS" 2>/dev/null
}

# Get focused workspace tree
get_workspace_tree() {
    local ws="${1:-$TEST_WS}"
    aerospace dump-tree --workspace "$ws" 2>/dev/null
}

# Pretty print tree for debugging
print_tree() {
    log_info "Current tree structure:"
    get_workspace_tree | jq -r '.' 2>/dev/null || echo "Failed to get tree"
}

# Get the root container layout from dump-tree output
get_root_layout() {
    get_workspace_tree | jq -r '.[0]."root-container".layout // "unknown"' 2>/dev/null
}

# Find a window in the tree and return its parent container info
# Returns: layout|children_count
find_window_parent() {
    local window_id="$1"
    local tree
    tree=$(get_workspace_tree)

    # Use jq to recursively search for the window and get parent info
    echo "$tree" | jq -r --arg wid "$window_id" '
        # Recursive function to find parent container of a window
        def find_parent:
            if type == "object" then
                if .type == "workspace" then
                    ."root-container" | find_parent
                elif .type == "container" then
                    # Check if any direct child is our window
                    if (.children // []) | any(.type == "window" and (."window-id" | tostring) == $wid) then
                        {layout: .layout, children_count: (.children | length), found: true}
                    else
                        # Recurse into child containers
                        (.children // []) | map(select(.type == "container")) | map(find_parent) | map(select(.found == true)) | first // {found: false}
                    end
                else
                    {found: false}
                end
            elif type == "array" then
                map(find_parent) | map(select(.found == true)) | first // {found: false}
            else
                {found: false}
            end;

        .[0] | find_parent | if .found then "\(.layout)|\(.children_count)" else "not_found|0" end
    ' 2>/dev/null || echo "error|0"
}

# Get the full tree structure in a readable format
dump_tree_summary() {
    local tree
    tree=$(get_workspace_tree)

    echo "$tree" | jq -r '
        def summarize(depth):
            (("  " * depth) +
            (if .type == "workspace" then
                "workspace: \(.name)\n" + (."root-container" | summarize(depth + 1))
            elif .type == "container" then
                "container(\(.layout)):\n" + ((.children // []) | map(summarize(depth + 1)) | join(""))
            elif .type == "window" then
                "window(\(."window-id")): \(."app-name")\n"
            else
                "unknown\n"
            end));

        .[0] | summarize(0)
    ' 2>/dev/null || echo "Failed to summarize tree"
}

# Get window IDs in workspace
get_window_ids() {
    aerospace list-windows --workspace "$TEST_WS" --format '%{window-id}' 2>/dev/null
}

# Count windows in workspace
count_windows() {
    get_window_ids | wc -l | tr -d ' '
}

# Get currently focused window ID
get_focused_window() {
    aerospace list-windows --focused --format '%{window-id}' 2>/dev/null
}

# Move windows from current workspace to test workspace
setup_test_windows() {
    local count="${1:-3}"

    # First, flatten and set base layout
    aerospace workspace "$TEST_WS"
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true

    # Get available windows (prefer Code, Xcode, Safari, iTerm)
    local windows
    windows=$(aerospace list-windows --all --format '%{window-id}|%{app-name}' 2>/dev/null)

    log_verbose "Available windows:"
    echo "$windows" | while read -r line; do
        log_verbose "  $line"
    done

    # Move first N windows to test workspace
    local moved=0
    while IFS='|' read -r wid app; do
        if [[ $moved -ge $count ]]; then
            break
        fi
        if [[ -n "$wid" ]]; then
            aerospace move-node-to-workspace --window-id "$wid" "$TEST_WS" 2>/dev/null && {
                log_verbose "Moved window $wid ($app) to $TEST_WS"
                ((moved++))
            }
        fi
    done <<< "$windows"

    # Verify
    local actual
    actual=$(count_windows)
    if [[ "$actual" -lt "$count" ]]; then
        log_warn "Only have $actual windows (requested $count)"
    fi

    # Focus workspace and flatten
    aerospace workspace "$TEST_WS"
    sleep 0.3  # Give aerospace time to settle
}

# Clean reset of test workspace
reset_test_workspace() {
    log_verbose "Resetting test workspace $TEST_WS"
    aerospace workspace "$TEST_WS"
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    sleep 0.2
}

#---------------------------------------------------------------------------
# Test Framework
#---------------------------------------------------------------------------

run_test() {
    local test_id="$1"
    local test_name="$2"
    local test_func="$3"

    echo ""
    echo "=============================================="
    echo "Test $test_id: $test_name"
    echo "=============================================="

    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset workspace before each test
    reset_test_workspace

    # Run the test
    if $test_func; then
        log_pass "Test $test_id PASSED"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_fail "Test $test_id FAILED"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

#---------------------------------------------------------------------------
# Phase 1: Atomic Tests
#---------------------------------------------------------------------------

test_1_0_workspace_memory() {
    # Test: Does an empty workspace remember its layout type?
    log_info "Testing workspace memory behavior..."

    # Get a window to work with
    local wid
    wid=$(aerospace list-windows --all --format '%{window-id}' | head -1)
    if [[ -z "$wid" ]]; then
        log_fail "No windows available"
        return 1
    fi

    # Move window out of test workspace
    aerospace move-node-to-workspace --window-id "$wid" "1" 2>/dev/null

    # Set layout on empty workspace (this may not work)
    aerospace workspace "$TEST_WS"
    aerospace layout v_accordion 2>/dev/null || log_warn "layout on empty workspace may not work"

    # Move window in
    aerospace move-node-to-workspace --window-id "$wid" "$TEST_WS"
    aerospace workspace "$TEST_WS"
    sleep 0.3

    # Check layout using dump-tree
    local layout
    layout=$(get_root_layout)

    log_info "Result: Root layout after moving to 'pre-set' workspace: $layout"
    log_info "Tree structure:"
    dump_tree_summary

    # For now, just observe - no strict pass/fail
    return 0
}

test_1_1_three_window_h_tiles() {
    # Test: Can we create h_tiles with 3 windows at same level?
    log_info "Testing 3-window h_tiles..."

    setup_test_windows 3

    # Set layout to h_tiles
    aerospace layout h_tiles
    sleep 0.3

    # Get tree and check structure
    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 3 ]]; then
        log_fail "Need at least 3 windows, have ${#wids[@]}"
        return 1
    fi

    log_info "Tree structure:"
    dump_tree_summary

    # Get root layout
    local layout
    layout=$(get_root_layout)

    log_info "Root layout: $layout"

    # Check window's parent layout
    local parent_info
    parent_info=$(find_window_parent "${wids[0]}")
    local parent_layout="${parent_info%%|*}"
    local children_count="${parent_info##*|}"

    log_info "Window ${wids[0]} parent: layout=$parent_layout, children=$children_count"

    if [[ "$parent_layout" == "h_tiles" ]]; then
        if [[ "$children_count" -ge 3 ]]; then
            log_pass "3 windows successfully in h_tiles container"
            return 0
        else
            log_warn "Only $children_count children in h_tiles container"
            return 0
        fi
    else
        log_warn "Expected h_tiles, got '$parent_layout'"
        return 0
    fi
}

test_1_2_join_with_left_creates_v_tiles() {
    # Test: Does join-with left create v_tiles container?
    log_info "Testing: join-with left creates v_tiles"

    setup_test_windows 2

    # Flatten and set base layout
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout h_tiles  # Windows side by side
    sleep 0.3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 2 ]]; then
        log_fail "Need 2 windows"
        return 1
    fi

    log_info "Windows: ${wids[*]}"
    log_info "Before join:"
    dump_tree_summary

    # Focus first window
    aerospace focus --window-id "${wids[0]}"
    sleep 0.2

    # Join with left
    log_info "Executing: join-with left"
    aerospace join-with left 2>&1 || log_warn "join-with left may have failed"
    sleep 0.3

    log_info "After join-with left:"
    dump_tree_summary

    # Check window's parent layout
    local parent_info
    parent_info=$(find_window_parent "${wids[0]}")
    local parent_layout="${parent_info%%|*}"

    log_info "Window parent layout: $parent_layout"

    # Per the notes: left/right creates v_tiles
    if [[ "$parent_layout" == "v_tiles" ]]; then
        log_pass "join-with left created v_tiles container"
        return 0
    elif [[ "$parent_layout" == "tiles" ]]; then
        log_pass "join-with left created tiles container"
        return 0
    else
        log_warn "Expected v_tiles, got '$parent_layout'"
        return 0  # Observation
    fi
}

test_1_3_join_with_down_creates_h_tiles() {
    # Test: Does join-with down create h_tiles container?
    log_info "Testing: join-with down creates h_tiles"

    setup_test_windows 2

    # Start with v_tiles so windows are stacked vertically
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout v_tiles
    sleep 0.3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 2 ]]; then
        log_fail "Need 2 windows"
        return 1
    fi

    log_info "Windows: ${wids[*]}"
    log_info "Before join:"
    dump_tree_summary

    # Focus first window
    aerospace focus --window-id "${wids[0]}"
    sleep 0.2

    # Join with down
    log_info "Executing: join-with down"
    aerospace join-with down 2>&1 || log_warn "join-with down may have failed"
    sleep 0.3

    log_info "After join-with down:"
    dump_tree_summary

    # Check window's parent layout
    local parent_info
    parent_info=$(find_window_parent "${wids[0]}")
    local parent_layout="${parent_info%%|*}"

    log_info "Window parent layout: $parent_layout"

    # Per the notes: up/down creates h_tiles
    if [[ "$parent_layout" == "h_tiles" ]]; then
        log_pass "join-with down created h_tiles container"
        return 0
    elif [[ "$parent_layout" == "tiles" ]]; then
        log_pass "join-with down created tiles container"
        return 0
    else
        log_warn "Expected h_tiles, got '$parent_layout'"
        return 0  # Observation
    fi
}

test_1_4_change_container_layout() {
    # Test: Can we change a container's layout after creation?
    log_info "Testing: change container layout after join"

    setup_test_windows 2

    # Flatten and create a container via join
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout h_tiles
    sleep 0.2

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 2 ]]; then
        log_fail "Need 2 windows"
        return 1
    fi

    # Focus and join - use 'right' since windows are side-by-side in h_tiles
    aerospace focus --window-id "${wids[0]}"
    aerospace join-with right 2>&1 || log_warn "join-with right may have failed"
    sleep 0.3

    log_info "After join:"
    dump_tree_summary

    # Get initial layout
    local parent_before
    parent_before=$(find_window_parent "${wids[0]}")
    local layout_before="${parent_before%%|*}"

    log_info "Layout before change: $layout_before"

    # Now change the layout (focused window should still be in the container)
    aerospace layout h_accordion
    sleep 0.3

    log_info "After layout change:"
    dump_tree_summary

    # Get new layout
    local parent_after
    parent_after=$(find_window_parent "${wids[0]}")
    local layout_after="${parent_after%%|*}"

    log_info "Layout after change: $layout_after"

    if [[ "$layout_before" != "$layout_after" ]]; then
        log_pass "Layout successfully changed from '$layout_before' to '$layout_after'"
        return 0
    else
        log_warn "Layout did not change (still '$layout_after')"
        return 0  # Observation
    fi
}

test_1_5_three_window_join() {
    # Test: Can we join 3 windows into same container?
    log_info "Testing: join 3 windows into same container"

    setup_test_windows 3

    # Start flat with h_tiles
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout h_tiles
    sleep 0.3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 3 ]]; then
        log_fail "Need 3 windows"
        return 1
    fi

    log_info "Windows: ${wids[*]}"
    log_info "Initial tree:"
    dump_tree_summary

    # Join first window with neighbor to the right
    aerospace focus --window-id "${wids[0]}"
    sleep 0.1
    aerospace join-with right 2>&1 || log_warn "first join may have failed"
    sleep 0.3

    log_info "After first join:"
    dump_tree_summary

    # Now try to join the third window
    aerospace focus --window-id "${wids[2]}"
    sleep 0.1

    # Try to join with the container (should be to the left)
    log_info "Attempting to join third window with left..."
    aerospace join-with left 2>&1 || log_warn "second join may have failed"
    sleep 0.3

    log_info "After second join:"
    dump_tree_summary

    # Check how many children in the first window's parent
    local parent_info
    parent_info=$(find_window_parent "${wids[0]}")
    local children_count="${parent_info##*|}"

    log_info "Children in container: $children_count"

    if [[ "$children_count" -ge 3 ]]; then
        log_pass "All 3 windows in same container"
        return 0
    else
        log_warn "Only $children_count windows in container"
        return 0  # Observation
    fi
}

test_1_6_portrait_spatial() {
    # Test: On portrait monitor, what direction finds neighbors in h_tiles?
    log_info "Testing: spatial arrangement and navigation"

    setup_test_windows 2

    # Set h_tiles
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout h_tiles
    sleep 0.3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 2 ]]; then
        log_fail "Need 2 windows"
        return 1
    fi

    log_info "Tree structure:"
    dump_tree_summary

    # Focus first window
    aerospace focus --window-id "${wids[0]}"
    sleep 0.2

    log_info "Testing directional navigation from window ${wids[0]}"

    local working_dirs=""
    # Test each direction
    for dir in left right up down; do
        aerospace focus --window-id "${wids[0]}"
        sleep 0.1

        aerospace focus "$dir" 2>/dev/null || true
        sleep 0.1

        local focused
        focused=$(get_focused_window)

        if [[ "$focused" != "${wids[0]}" ]]; then
            log_info "Direction '$dir' found neighbor (now focused: $focused)"
            working_dirs="$working_dirs $dir"
        else
            log_verbose "Direction '$dir' found nothing"
        fi
    done

    log_info "Working directions in h_tiles:$working_dirs"
    log_info "This tells us which join-with directions will find neighbors"
    return 0
}

test_1_7_focus_verification() {
    # Test: Does focus --window-id reliably focus the correct window?
    log_info "Testing: focus verification"

    setup_test_windows 3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 3 ]]; then
        log_fail "Need 3 windows"
        return 1
    fi

    local all_pass=true

    for wid in "${wids[@]}"; do
        aerospace focus --window-id "$wid"
        sleep 0.2

        local focused
        focused=$(get_focused_window)

        if [[ "$focused" == "$wid" ]]; then
            log_verbose "Focus on $wid: correct"
        else
            log_warn "Focus on $wid: WRONG (got $focused)"
            all_pass=false
        fi
    done

    if $all_pass; then
        log_pass "All focus operations correct"
        return 0
    else
        log_fail "Some focus operations failed"
        return 1
    fi
}

test_1_8_opposite_orientation_rule() {
    # Test: Does aerospace enforce opposite orientations for nested containers?
    log_info "Testing: opposite orientation enforcement"

    setup_test_windows 3

    # Create a v_accordion root
    aerospace flatten-workspace-tree --workspace "$TEST_WS"
    aerospace layout v_accordion
    sleep 0.3

    local wids
    wids=($(get_window_ids))

    if [[ ${#wids[@]} -lt 3 ]]; then
        log_fail "Need 3 windows"
        return 1
    fi

    log_info "Initial tree (v_accordion root):"
    dump_tree_summary

    # Join two windows to create a nested container
    # In v_accordion, windows are stacked vertically, so use 'down' to find neighbor
    aerospace focus --window-id "${wids[0]}"
    aerospace join-with down 2>&1 || log_warn "join-with down may have failed"
    sleep 0.3

    log_info "After join-with down:"
    dump_tree_summary

    # Get root and nested layouts
    local root_layout
    root_layout=$(get_root_layout)

    local parent_info
    parent_info=$(find_window_parent "${wids[0]}")
    local nested_layout="${parent_info%%|*}"

    log_info "Root layout: $root_layout"
    log_info "Nested container layout: $nested_layout"

    # Check if they are opposite
    # v_* with h_* or h_* with v_* is correct
    local is_opposite=false
    if [[ "$root_layout" == v_* ]] && [[ "$nested_layout" == h_* ]]; then
        is_opposite=true
    elif [[ "$root_layout" == h_* ]] && [[ "$nested_layout" == v_* ]]; then
        is_opposite=true
    fi

    if $is_opposite; then
        log_pass "Opposite orientation rule observed: root=$root_layout, nested=$nested_layout"
    else
        log_warn "Orientations may not be opposite: root='$root_layout', nested='$nested_layout'"
    fi

    # Now try to violate the rule: set nested to v_accordion (same as root)
    log_info "Attempting to set nested container to v_accordion (same orientation as root)..."
    aerospace layout v_accordion
    sleep 0.3

    log_info "After attempting v_accordion on nested:"
    dump_tree_summary

    parent_info=$(find_window_parent "${wids[0]}")
    nested_layout="${parent_info%%|*}"

    log_info "Nested layout is now: $nested_layout"

    if [[ "$nested_layout" == "v_accordion" ]]; then
        log_warn "Aerospace allowed same orientation (v_accordion inside v_accordion)"
    else
        log_info "Aerospace corrected/kept as: $nested_layout"
    fi

    return 0
}

#---------------------------------------------------------------------------
# Test Registry
#---------------------------------------------------------------------------

declare -A TESTS
TESTS["1.0"]="test_1_0_workspace_memory:Workspace memory behavior"
TESTS["1.1"]="test_1_1_three_window_h_tiles:3-window h_tiles"
TESTS["1.2"]="test_1_2_join_with_left_creates_v_tiles:join-with left creates v_tiles"
TESTS["1.3"]="test_1_3_join_with_down_creates_h_tiles:join-with down creates h_tiles"
TESTS["1.4"]="test_1_4_change_container_layout:Change container layout after join"
TESTS["1.5"]="test_1_5_three_window_join:Join 3 windows into container"
TESTS["1.6"]="test_1_6_portrait_spatial:Portrait monitor spatial test"
TESTS["1.7"]="test_1_7_focus_verification:Focus verification"
TESTS["1.8"]="test_1_8_opposite_orientation_rule:Opposite orientation rule"

list_tests() {
    echo "Available tests:"
    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort); do
        local info="${TESTS[$id]}"
        local name="${info#*:}"
        echo "  $id: $name"
    done
}

run_single_test() {
    local test_id="$1"
    if [[ -z "${TESTS[$test_id]:-}" ]]; then
        log_fail "Unknown test: $test_id"
        list_tests
        exit 1
    fi

    local info="${TESTS[$test_id]}"
    local func="${info%%:*}"
    local name="${info#*:}"

    run_test "$test_id" "$name" "$func"
}

run_all_phase1() {
    log_info "Running all Phase 1 atomic tests..."
    echo ""

    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort); do
        run_single_test "$id" || true  # Continue on failure
    done

    echo ""
    echo "=============================================="
    echo "SUMMARY"
    echo "=============================================="
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo ""

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

#---------------------------------------------------------------------------
# Main
#---------------------------------------------------------------------------

main() {
    if [[ $# -eq 0 ]]; then
        run_all_phase1
    elif [[ "$1" == "--list" ]] || [[ "$1" == "-l" ]]; then
        list_tests
    elif [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        echo "Usage: $0 [test-id|--list|--help]"
        echo ""
        echo "Options:"
        echo "  test-id   Run specific test (e.g., 1.1)"
        echo "  --list    List available tests"
        echo "  --help    Show this help"
        echo ""
        echo "Environment:"
        echo "  TEST_WS   Workspace to use (default: t)"
        echo "  VERBOSE   Enable verbose output (default: false)"
    else
        run_single_test "$1"
    fi
}

main "$@"
