/**
 * Custom collision detection algorithm for nested container tree structures.
 *
 * Unlike dnd-kit's built-in closestCenter, this algorithm:
 * 1. Uses proximity-based detection considering the pointer position
 * 2. Resolves whether a drop targets BEFORE, AFTER, or INSIDE a node
 *    based on the Y-position within the node's bounds:
 *    - Top 25%: insert before this node
 *    - Bottom 25%: insert after this node
 *    - Middle 50% on a container: insert as child (inside) of this container
 *    - Middle 50% on a window: insert after this node (windows can't have children)
 * 3. Handles collapsed containers: dropping on them targets the container itself
 * 4. Handles deeply nested targets: resolved by proximity to pointer
 */

import type {
  CollisionDetection,
  Collision,
  UniqueIdentifier,
} from '@dnd-kit/core';
import type { FlatNode } from '../types';
import type { DropTarget } from './types';

/**
 * Store for communicating the resolved drop target to the UI.
 * Updated by the collision detection algorithm, read by DropIndicator.
 */
let _currentDropTarget: DropTarget | null = null;

export function getCurrentDropTarget(): DropTarget | null {
  return _currentDropTarget;
}

export function setCurrentDropTarget(target: DropTarget | null): void {
  _currentDropTarget = target;
}

/**
 * Create a custom collision detection function that resolves nested container targets.
 *
 * @param flatNodesRef - A getter for the current flat nodes list (must be fresh on each call)
 * @param activeIdRef - A getter for the currently dragged node ID
 * @returns A CollisionDetection function compatible with dnd-kit's DndContext
 */
export function createTreeCollisionDetection(
  flatNodesRef: () => FlatNode[],
  activeIdRef: () => string | null,
): CollisionDetection {
  return function treeCollisionDetection({
    droppableRects,
    droppableContainers,
    pointerCoordinates,
    collisionRect,
  }) {
    const activeId = activeIdRef();
    if (!activeId) {
      setCurrentDropTarget(null);
      return [];
    }

    // Use pointer position if available, otherwise fall back to collision rect center
    const pointerY = pointerCoordinates
      ? pointerCoordinates.y
      : collisionRect.top + collisionRect.height / 2;
    const pointerX = pointerCoordinates
      ? pointerCoordinates.x
      : collisionRect.left + collisionRect.width / 2;

    const flatNodes = flatNodesRef();

    // Score each droppable container by distance to pointer
    const candidates: Array<{
      id: UniqueIdentifier;
      distance: number;
      rect: { top: number; bottom: number; left: number; right: number; height: number };
      flatNode: FlatNode;
    }> = [];

    for (const container of droppableContainers) {
      const id = container.id;

      // Skip the actively dragged node and its descendants
      if (String(id) === activeId) continue;
      if (isDescendantOf(String(id), activeId, flatNodes)) continue;

      const rect = droppableRects.get(id);
      if (!rect) continue;

      // Calculate distance from pointer to the center of the rect
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.sqrt(
        Math.pow(pointerX - centerX, 2) + Math.pow(pointerY - centerY, 2),
      );

      const flatNode = flatNodes.find((n) => n.id === String(id));
      if (!flatNode) continue;

      candidates.push({
        id,
        distance,
        rect: {
          top: rect.top,
          bottom: rect.top + rect.height,
          left: rect.left,
          right: rect.left + rect.width,
          height: rect.height,
        },
        flatNode,
      });
    }

    if (candidates.length === 0) {
      setCurrentDropTarget(null);
      return [];
    }

    // Sort by distance (closest first)
    candidates.sort((a, b) => a.distance - b.distance);

    // Find the closest candidate where the pointer is within (or very near) its bounds
    let best = candidates[0];

    // Prefer candidates where the pointer is actually inside the rect
    for (const candidate of candidates) {
      if (
        pointerY >= candidate.rect.top &&
        pointerY <= candidate.rect.bottom &&
        pointerX >= candidate.rect.left - 50 && // allow some horizontal slack
        pointerX <= candidate.rect.right + 50
      ) {
        best = candidate;
        break;
      }
    }

    // Resolve the drop target type based on Y-position within the node bounds
    const dropTarget = resolveDropTarget(
      best.flatNode,
      best.rect,
      pointerY,
    );

    setCurrentDropTarget(dropTarget);

    // Return the collision in dnd-kit's expected format
    const collisions: Collision[] = [
      {
        id: best.id,
        data: {
          dropTarget,
        },
      },
    ];

    return collisions;
  };
}

/**
 * Resolve the drop target type based on the pointer's Y position within the node bounds.
 *
 * - Top 25%: insert before this node
 * - Bottom 25%: insert after this node
 * - Middle 50% on a container: insert as child (inside)
 * - Middle 50% on a window: insert after (windows can't have children)
 */
function resolveDropTarget(
  flatNode: FlatNode,
  rect: { top: number; bottom: number; height: number },
  pointerY: number,
): DropTarget {
  const relativeY = pointerY - rect.top;
  const proportion = relativeY / rect.height;

  const isContainer = flatNode.node.type === 'container';

  if (proportion <= 0.25) {
    return { type: 'before', targetId: flatNode.id };
  }

  if (proportion >= 0.75) {
    return { type: 'after', targetId: flatNode.id };
  }

  // Middle 50%
  if (isContainer) {
    // Drop into the container (even if collapsed — the container itself is the target)
    return { type: 'inside', targetId: flatNode.id };
  }

  // Windows can't have children, so treat middle as "after"
  return { type: 'after', targetId: flatNode.id };
}

/**
 * Check if nodeId is a descendant of ancestorId in the flat node list.
 */
function isDescendantOf(
  nodeId: string,
  ancestorId: string,
  flatNodes: FlatNode[],
): boolean {
  let current = flatNodes.find((n) => n.id === nodeId);
  while (current && current.parentId) {
    if (current.parentId === ancestorId) return true;
    current = flatNodes.find((n) => n.id === current!.parentId);
  }
  return false;
}
