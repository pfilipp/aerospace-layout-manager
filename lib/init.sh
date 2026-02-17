#!/bin/bash
# =============================================================================
# Master sourcing script for aerospace-layout-manager
#
# This script sources all modules in the correct dependency order.
# Source this file to get access to all functionality.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_INIT_LOADED:-}" ]] && return 0
_ALM_INIT_LOADED=1

# Determine the library directory
# This works whether the script is sourced or executed
_ALM_LIB_DIR="${_ALM_LIB_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# =============================================================================
# Source modules in dependency order
# =============================================================================

# Core modules (no dependencies except on each other)
source "$_ALM_LIB_DIR/core/config.sh"
source "$_ALM_LIB_DIR/core/logging.sh"
source "$_ALM_LIB_DIR/core/dependencies.sh"

# Aerospace command wrappers (depends on core)
source "$_ALM_LIB_DIR/aerospace/commands.sh"

# JSON parsing (depends on core)
source "$_ALM_LIB_DIR/json/parsing.sh"

# Tree traversal (depends on core)
source "$_ALM_LIB_DIR/tree/traversal.sh"

# Window modules (depend on core, aerospace/commands)
source "$_ALM_LIB_DIR/window/matching.sh"
source "$_ALM_LIB_DIR/window/startup.sh"
source "$_ALM_LIB_DIR/window/discovery.sh"
source "$_ALM_LIB_DIR/window/movement.sh"

# Layout modules (depend on core, aerospace/commands, tree/traversal)
source "$_ALM_LIB_DIR/layout/direction.sh"
source "$_ALM_LIB_DIR/layout/phase1_joins.sh"
source "$_ALM_LIB_DIR/layout/phase2_layouts.sh"
