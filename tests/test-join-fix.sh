#!/usr/bin/env bash
#
# Focused test for Phase 1 join fix — runs against source binary directly.
# Tests nested container layouts (mixed-children, two-sibling-containers).
#
# Usage:
#   ./tests/test-join-fix.sh              # Run all join tests
#   ./tests/test-join-fix.sh mixed        # Run only mixed-children test
#   ./tests/test-join-fix.sh sibling      # Run only two-sibling-containers test
#   VERBOSE=true ./tests/test-join-fix.sh # With debug output
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

ALM_BIN="$TEST_REPO_ROOT/bin/aerospace-layout-manager"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
TEST_TMP=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

#---------------------------------------------------------------------------
# Setup / Teardown
#---------------------------------------------------------------------------

setup() {
    echo -e "${CYAN}=== Join Fix Test ===${NC}"
    echo "ALM binary: $ALM_BIN (source)"
    echo "Workspace:  $TEST_WS"
    echo ""

    if [[ ! -x "$ALM_BIN" ]]; then
        echo -e "${RED}FATAL: ALM binary not found: $ALM_BIN${NC}"
        exit 1
    fi

    TEST_TMP=$(mktemp -d)
    assert_workspace_empty || exit 1
}

teardown() {
    cleanup_test_windows
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    [[ -n "$TEST_TMP" ]] && [[ -d "$TEST_TMP" ]] && rm -rf "$TEST_TMP"
}

trap teardown EXIT

#---------------------------------------------------------------------------
# Test runner
#---------------------------------------------------------------------------

# Run a single fixture test and print detailed results.
#
# Args:
#   $1 - test label (for output)
#   $2 - fixture filename
#   $3 - number of windows to provision
run_one() {
    local label="$1"
    local fixture_name="$2"
    local window_count="$3"
    local fixture_file="$FIXTURES_DIR/$fixture_name"
    local dynamic_file="$TEST_TMP/dynamic-$fixture_name"

    echo -e "${CYAN}--- $label ---${NC}"

    # Provision fresh windows for this test
    cleanup_test_windows
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    sleep 0.3

    echo "  Provisioning $window_count windows..."
    provision_test_windows "$window_count" || {
        echo -e "${RED}  FAIL: Could not provision windows${NC}"
        ((FAIL_COUNT++))
        return 1
    }

    # Move windows to test workspace
    for wid in "${_PROVISIONED_WINDOW_IDS[@]:0:$window_count}"; do
        aerospace move-node-to-workspace --window-id "$wid" "$TEST_WS" 2>/dev/null || true
    done
    aerospace workspace "$TEST_WS" 2>/dev/null || true
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    sleep 0.3

    local selected_ids=("${_PROVISIONED_WINDOW_IDS[@]:0:$window_count}")

    # Create dynamic fixture mapping synthetic IDs to real IDs
    local mapping_json="{"
    local idx=1
    for wid in "${selected_ids[@]}"; do
        [[ $idx -gt 1 ]] && mapping_json+=","
        mapping_json+="\"$idx\":\"$wid\""
        ((idx++))
    done
    mapping_json+="}"

    echo "  Window mapping: $mapping_json"

    # Replace window-ids with real IDs AND clear titles so matching
    # uses bundle-id only (provisioned windows won't have fixture titles)
    jq --argjson mapping "$mapping_json" --arg ws "$TEST_WS" '
        def remap:
            if type == "object" then
                if .type == "workspace" then
                    .name = $ws | .["root-container"] = (."root-container" | remap)
                elif .type == "container" then
                    .children = [.children[] | remap]
                elif .type == "window" then
                    . as $w |
                    ($w["window-id"] | tostring) as $old_id |
                    if $mapping[$old_id] then
                        $w + {"window-id": ($mapping[$old_id] | tonumber), "title": ""}
                    else
                        $w + {"title": ""}
                    end
                else . end
            elif type == "array" then [.[] | remap]
            else . end;
        remap
    ' < "$fixture_file" > "$dynamic_file"

    # Run ALM from source
    echo "  Running ALM..."
    local alm_output
    alm_output=$("$ALM_BIN" --allow-missing "$TEST_WS" "$dynamic_file" 2>&1) || true

    if [[ "$VERBOSE" == "true" ]]; then
        echo "$alm_output"
    fi

    sleep 0.5

    # Capture actual tree (text for display, JSON for comparison)
    local actual_tree_text
    actual_tree_text=$(aerospace tree --workspace "$TEST_WS" 2>/dev/null || echo "")
    local actual_tree_json
    actual_tree_json=$(aerospace tree --json --workspace "$TEST_WS" 2>/dev/null || echo "[]")

    echo ""
    echo "  ACTUAL:"
    echo "$actual_tree_text" | sed 's/^/    /'
    echo ""

    # Extract expected structure from fixture (layout types + window counts)
    local expected_structure
    expected_structure=$(jq -c '
        def extract:
            if .type == "workspace" then
                .["root-container"] | extract
            elif .type == "container" then
                {layout: .layout, children: [(.children // [])[] | extract]}
            elif .type == "window" then
                {type: "window"}
            else . end;
        .[0] | extract
    ' < "$fixture_file")

    # Extract actual structure from JSON tree
    local actual_structure
    actual_structure=$(echo "$actual_tree_json" | jq -c '
        def extract:
            if .type == "workspace" then
                (.["root-container"] // .children[0] // .) | extract
            elif .type == "container" then
                {layout: .layout, children: [(.children // [])[] | extract]}
            elif .type == "window" then
                {type: "window"}
            else . end;
        if type == "array" then .[0] else . end | extract
    ' 2>/dev/null || echo "{}")

    echo "  Expected structure: $expected_structure"
    echo "  Actual structure:   $actual_structure"
    echo ""

    if [[ "$expected_structure" == "$actual_structure" ]]; then
        echo -e "  ${GREEN}PASS${NC}"
        ((PASS_COUNT++))
        return 0
    else
        echo -e "  ${RED}FAIL — structures differ${NC}"
        # Show detailed diff
        diff <(echo "$expected_structure" | jq .) <(echo "$actual_structure" | jq .) || true
        ((FAIL_COUNT++))
        return 1
    fi
}

#---------------------------------------------------------------------------
# Main
#---------------------------------------------------------------------------

main() {
    local filter="${1:-all}"

    setup

    if [[ "$filter" == "all" || "$filter" == "flat" ]]; then
        run_one "flat-3-windows (regression)" "flat-3-windows.json" 3 || true
        echo ""
    fi

    if [[ "$filter" == "all" || "$filter" == "mixed" ]]; then
        run_one "mixed-children (1 window + 1 container[2])" "mixed-children.json" 3 || true
        echo ""
    fi

    if [[ "$filter" == "all" || "$filter" == "sibling" ]]; then
        run_one "two-sibling-containers (container[3] + container[2])" "two-sibling-containers.json" 5 || true
        echo ""
    fi

    echo -e "${CYAN}=== Results ===${NC}"
    echo -e "  ${GREEN}Pass: $PASS_COUNT${NC}  ${RED}Fail: $FAIL_COUNT${NC}"

    [[ $FAIL_COUNT -eq 0 ]]
}

main "$@"
