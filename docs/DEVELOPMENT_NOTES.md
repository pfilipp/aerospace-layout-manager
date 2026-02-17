# Layout Recreation from Tree - Development Notes

## Goal
Recreate exact window layouts from `aerospace tree` JSON output.

## Test Case
```
v_accordion (root):
├── h_tiles [Code, Xcode, Code]     ← 3-window container
├── Safari                           ← standalone window
└── h_tiles:                         ← nested container
    ├── iTerm2
    └── v_tiles [iTerm2, iTerm2]     ← 3-level nesting
```

---

## Approach 1: join-with --window-id

**Theory**: Use `aerospace join-with --window-id X direction` to join focused window with specific target.

**Result**: ❌ FAILED

**Conclusion**: Misunderstood the command. `--window-id X direction` means "take window X and join it with whatever is in that direction", NOT "join focused window with X".

---

## Approach 2: Sequential join-with direction

**Theory**: Focus first window, use `join-with direction` repeatedly.

**Result**: ❌ FAILED - "No windows in the specified direction"

**Conclusion**: On portrait monitor, windows stack vertically even with h_tiles. `join-with right` looks spatially, but windows are up/down.

---

## Approach 3: Set workspace layout first

**Setup**:
```bash
aerospace workspace test
aerospace layout h_tiles
aerospace focus --window-id 17470
aerospace join-with right
```

**Result**: ❌ UNEXPECTED
- Created v_tiles instead of h_tiles
- Joined wrong windows (1 with 3, skipping 2)
- Order scrambled

**Conclusion**: join-with is spatial, not structural. Portrait monitor arrangement doesn't match tree order.

---

## Approach 4: Testing join-with Directions

**Setup**: Flatten workspace, test each direction systematically.

**Results** (h_tiles base - windows side by side):
| Command | Result |
|---------|--------|
| `join-with left` | v_tiles ✓ |
| `join-with right` | v_tiles ✓ |
| `join-with down` | FAIL - no window |
| `join-with up` | FAIL - no window |

**Results** (v_tiles base - windows stacked):
| Command | Result |
|---------|--------|
| `join-with left` | FAIL - no window |
| `join-with up` | h_tiles ✓ |
| `join-with down` | h_tiles ✓ |

**Critical Discovery**:
- `join-with left/right` → creates **v_tiles**
- `join-with up/down` → creates **h_tiles**
- Direction must match actual spatial arrangement!

---

## Approach 5: Change Layout After Join

**Theory**: Create container with join-with, then change its layout type.

**Setup**:
```bash
aerospace join-with --window-id 4137 left  # Creates v_tiles
aerospace focus --window-id 4137
aerospace layout h_tiles                    # Change to h_tiles
```

**Result**: ✅ WORKS - Layout successfully changed after container creation.

---

## Approach 6: Full Algorithm Test

**Setup**:
```bash
# Flatten and set horizontal
aerospace flatten-workspace-tree --workspace temp
aerospace layout tiles horizontal

# Join windows
aerospace join-with --window-id 20071 left
# Result: v_tiles [113, 20071], 17570, 4137

# Change to h_tiles
aerospace focus --window-id 20071
aerospace layout h_tiles
# ⚠️ ROOT LAYOUT CHANGED from h_tiles to v_tiles!

# Try next join
aerospace join-with --window-id 4137 left
# FAILS: "No windows in the specified direction"
```

**Result**: ❌ FAILED

**Issues Discovered**:
1. **Layout side effects**: Setting layout on nested container changed root layout
2. **Cascading failures**: Root change broke spatial arrangement for subsequent joins
3. **No container targeting**: Can only operate through windows

---

## Approach 7: Two-Phase Algorithm

**Theory**: Separate structural changes (joins) from layout changes.

**Phase 1**: Create all containers via join-with (no layout changes)
**Phase 2**: Apply layouts after structure is stable

**2-Level Nesting Test**:
```
Target:
v_accordion:
  Xcode
  h_tiles [App Store, Calendar]
  Code
  Figma
```
**Result**: ✅ EXACT MATCH

**3-Level Nesting Test** (First attempt):
```
Target:
v_tiles:
  h_tiles [Xcode, App Store]
  Calendar
  Code
  h_tiles:
    Figma
    v_tiles [Code, Code]    ← innermost
```
**Result**: ⚠️ PARTIAL - Innermost v_tiles failed

**Root Cause**: Algorithm used target parent layout (h_tiles → right) instead of root layout (v_tiles → down). Windows are stacked vertically, so `join-with right` found nothing.

**Fix**: Always use ROOT layout for join direction since windows are at flattened root level.

**3-Level Nesting Test** (Second attempt):
**Result**: ⚠️ PARTIAL - Structure corrupted

**Root Cause**: Layout changes in Phase 2 still cascading and affecting structure.

**3-Level Nesting Test** (Third attempt with proper two-phase):
**Result**: ✅ EXACT MATCH

---

## Approach 8: Containers with 3+ Windows

**Problem**: `join-with` always creates 2-element containers. Adding third window extracts it from existing container.

**Setup**:
```bash
# [A, B, C] flat in v_tiles
aerospace focus --window-id A
aerospace join-with down
# Result: [h_tiles[A, B], C]

# Try to add C
aerospace focus --window-id A  # inside container
aerospace join-with down
# Result: [B, h_tiles[A, C]]  ← A extracted!
```

**Solution**: Use `move` to add windows after initial join.

```bash
# Create initial container
aerospace focus --window-id A
aerospace join-with down
# Result: [h_tiles[A, B], C, D]

# Move C into container
aerospace focus --window-id C
aerospace move up  # toward container
# Result: [h_tiles[A, B, C], D]

# Move D into container
aerospace focus --window-id D
aerospace move up
# Result: [h_tiles[A, B, C, D]]
```

**Move Direction Rules**:
| Root Layout | Join Direction | Move Direction |
|-------------|----------------|----------------|
| v_tiles/v_accordion | down | up |
| h_tiles/h_accordion | right | left |

---

## Approach 9: Window Order Fix

**Problem**: 3+ window containers had wrong order.
- Target: `h_tiles[A, B, C]`
- Got: `h_tiles[A, C, B]`

**Root Cause**: When `join-with <direction>` executes:
- **FOUND** window (in that direction) becomes **FIRST**
- **SOURCE** window (focused) becomes **SECOND**

**Old algorithm** for [A, B, C]:
1. Focus B, `join-with down` → finds C → creates `[C, B]`
2. Move A down → enters at position 0 → `[A, C, B]` ❌

**New algorithm** for [A, B, C]:
1. Focus B (second), `join-with up` → finds A → creates `[A, B]`
2. Move C up → enters at END → `[A, B, C]` ✓

**Special case**: Containers with nested container children (already processed):
- Focus FIRST window, join FORWARD direction
- Avoids extracting windows from nested containers

**Final Test** (7-window, 3-level nesting, 3-window container):
```
Target:                              Result:
v_accordion                          v_accordion
├── h_tiles[Brave,Xcode,Figma]       ├── h_tiles[Brave,Xcode,Figma] ✓
├── Calendar                         ├── Calendar                   ✓
└── h_tiles                          └── h_tiles                    ✓
    ├── AppStore                         ├── AppStore               ✓
    └── v_tiles[Mail,Messages]           └── v_tiles[Mail,Messages] ✓
```

---

## Critical Discoveries Summary

### 1. Join Direction Creates Opposite Container Type
| Join Direction | Creates Container |
|----------------|-------------------|
| `join-with left/right` | v_tiles |
| `join-with up/down` | h_tiles |

### 2. Join-with is Spatial, Not Structural
Finds windows based on **screen position**, not tree order.

### 3. Layout Commands Have Side Effects
Can cascade to parent containers (opposite orientation rule).

### 4. Windows Are at Root Level During Joins
ROOT layout determines spatial arrangement, not target parent's layout.

### 5. Join-with Creates 2-Element Containers
Use `move` to add more windows.

### 6. Join Order Affects Window Positioning
- FOUND window → FIRST in container
- SOURCE window → SECOND in container

---

## Final Working Algorithm

```
1. Parse tree JSON, create window mapping (original_id → new_id)
2. Move all windows to temp workspace
3. Move all windows to target workspace in DFS order
4. Flatten workspace, set root layout

5. Phase 1 - Create containers (post-order traversal):
   For each non-root container:
   - Windows-only: focus SECOND child, join-with OPPOSITE direction
   - Has nested containers: focus FIRST child, join-with FORWARD direction
   - Use `move` to add remaining children (3+)
   - Direction based on ROOT layout

6. Phase 2 - Apply layouts (post-order traversal):
   For each non-root container:
   - Focus first window, set layout

7. Done
```

### Why Two-Phase Works
1. Completes ALL structural changes (joins) first
2. Applies layouts when structure is stable
3. Even if layouts cascade, all containers already exist

---

## Commands Reference

```bash
aerospace flatten-workspace-tree --workspace <name>
aerospace join-with [--window-id <wid>] <left|right|up|down>
aerospace move <left|right|up|down>
aerospace layout <h_tiles|v_tiles|h_accordion|v_accordion>
aerospace focus --window-id <id>
aerospace move-node-to-workspace --window-id <id> <workspace>
aerospace list-windows --workspace <name> --format '%{window-id}|%{app-name}'
aerospace tree --workspace <name>
```

---

## Window Matching

Windows matched by **bundle ID + title** with fallback:
1. Exact title match
2. Substring match
3. Case-insensitive substring match

If `source-workspace` in dump (custom fork), searches that workspace first for empty titles.
