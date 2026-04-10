/**
 * Composed collision detection strategy for nested container tree structures.
 *
 * Uses dnd-kit's built-in algorithms as building blocks:
 * 1. pointerWithin() — find all droppables the pointer is inside
 * 2. closestCenter() — fallback for nearby targets when pointer is not inside any
 *
 * Then applies custom logic to resolve before/after/inside semantics:
 * - body:{id} droppables -> resolve as "inside" the container
 * - empty:{id} droppables -> resolve as "inside" the container at index 0
 * - Node droppables -> resolve based on pointer Y position within the rect:
 *   - Top 25%: before
 *   - Bottom 25%: after
 *   - Middle 50% on container: inside (with positional index)
 *   - Middle 50% on window: after (windows cannot have children)
 *
 * When both a body droppable and a node droppable overlap under the pointer,
 * the body droppable takes priority for "inside" resolution; the node droppable
 * is used for "before/after" resolution only.
 */

import {
  pointerWithin,
  closestCenter,
} from '@dnd-kit/core';
import type {
  CollisionDetection,
  Collision,
  ClientRect,
  UniqueIdentifier,
  DroppableContainer,
} from '@dnd-kit/core';
import type { FlatNode } from '../types';
import type { DropTarget } from './types';

/**
 * Create a composed collision detection function for the tree layout.
 *
 * The resolved drop target is attached to the collision's `data.dropTarget` field.
 * The caller (DndProvider's onDragOver) reads this and writes it to DropTargetContext.
 *
 * @param flatNodesGetter - A getter for the current flat nodes list (must be fresh on each call)
 * @param activeDragIdGetter - A getter for the currently dragged node ID
 * @returns A CollisionDetection function compatible with dnd-kit's DndContext
 */
export function createTreeCollisionDetection(
  flatNodesGetter: () => FlatNode[],
  activeDragIdGetter: () => string | null,
): CollisionDetection {
  return function composedTreeCollision(args) {
    const activeId = activeDragIdGetter();
    if (!activeId) {
      return [];
    }

    const flatNodes = flatNodesGetter();
    const isAppDrag = activeId.startsWith('app-entry:');

    // Filter out the active node and its descendants from droppable containers
    // to prevent cycle creation (dropping a node into its own subtree).
    const filteredContainers = filterDroppableContainers(
      args.droppableContainers,
      activeId,
      isAppDrag,
      flatNodes,
    );

    const filteredArgs = {
      ...args,
      droppableContainers: filteredContainers,
    };

    // Step 1: Use pointerWithin to find all droppables the pointer is inside
    const pointerCollisions = pointerWithin(filteredArgs);

    // Step 2: If pointerWithin found nothing, fall back to closestCenter
    const collisions = pointerCollisions.length > 0
      ? pointerCollisions
      : closestCenter(filteredArgs);

    if (collisions.length === 0) {
      return [];
    }

    // Step 3: Resolve the drop target from the matched droppables
    const dropTarget = resolveFromCollisions(
      collisions,
      args.droppableRects,
      args.pointerCoordinates,
      args.collisionRect,
      flatNodes,
    );

    if (!dropTarget) {
      return [];
    }

    // Return the first collision with the resolved drop target attached
    const result: Collision[] = [
      {
        id: collisions[0].id,
        data: {
          dropTarget,
        },
      },
    ];

    return result;
  };
}

/**
 * Filter droppable containers to exclude the active drag node and its descendants.
 * This prevents dropping a node into its own subtree (cycle prevention).
 */
function filterDroppableContainers(
  containers: DroppableContainer[],
  activeId: string,
  isAppDrag: boolean,
  flatNodes: FlatNode[],
): DroppableContainer[] {
  return containers.filter((container) => {
    const id = String(container.id);

    // Never drop onto yourself
    if (id === activeId) return false;

    // App drags from sidebar are never in the tree, so no descendant check needed
    if (isAppDrag) return true;

    // For node droppables, check descendant relationship directly
    if (!id.startsWith('body:') && !id.startsWith('empty:')) {
      return !isDescendantOf(id, activeId, flatNodes);
    }

    // For body: and empty: droppables, extract the container ID and check
    const containerId = id.startsWith('body:')
      ? id.slice('body:'.length)
      : id.slice('empty:'.length);

    // Don't allow dropping into your own body or into a descendant's body
    if (containerId === activeId) return false;
    return !isDescendantOf(containerId, activeId, flatNodes);
  });
}

/**
 * Resolve the drop target from collision results.
 *
 * Priority rules for overlapping droppables:
 * - empty:{id} -> always resolves as "inside" at index 0
 * - body:{id} -> resolves as "inside" (body takes priority for "inside" targeting)
 * - node droppable -> resolves before/after/inside based on pointer Y position
 *   (but if a body droppable is also hit, node droppable only resolves before/after)
 */
function resolveFromCollisions(
  collisions: Collision[],
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  pointerCoordinates: { x: number; y: number } | null,
  collisionRect: { top: number; left: number; width: number; height: number },
  flatNodes: FlatNode[],
): DropTarget | null {
  const pointerY = pointerCoordinates
    ? pointerCoordinates.y
    : collisionRect.top + collisionRect.height / 2;

  // Categorize collisions by type
  let emptyCollision: Collision | null = null;
  let bodyCollision: Collision | null = null;
  let nodeCollision: Collision | null = null;

  for (const collision of collisions) {
    const id = String(collision.id);
    if (id.startsWith('empty:')) {
      emptyCollision = collision;
    } else if (id.startsWith('body:')) {
      // When multiple body droppables overlap (nested containers), pick the
      // deepest one — its ID will be a descendant path of the shallower one.
      if (!bodyCollision) {
        bodyCollision = collision;
      } else {
        const existingId = String(bodyCollision.id).slice('body:'.length);
        const newId = id.slice('body:'.length);
        if (newId.startsWith(existingId + '/')) {
          bodyCollision = collision; // newId is deeper
        }
        // else: existingId is deeper or unrelated, keep it
      }
    } else if (!nodeCollision) {
      // Take the first node collision (collisions are already sorted by relevance)
      nodeCollision = collision;
    }
  }

  // Priority 1: empty container placeholder -> always "inside" at index 0
  if (emptyCollision) {
    const containerId = String(emptyCollision.id).slice('empty:'.length);
    const containerFlatNode = flatNodes.find((n) => n.id === containerId);
    if (containerFlatNode) {
      return { type: 'inside', targetId: containerId, insertIndex: 0 };
    }
  }

  // Priority 2: body droppable -> resolve as "inside" with insertion index
  // But first check if a node droppable is also hit and pointer is in its
  // before/after zone (top/bottom 25%). If so, use the node for before/after.
  if (bodyCollision && nodeCollision) {
    const nodeId = String(nodeCollision.id);
    const nodeRect = droppableRects.get(nodeCollision.id);
    if (nodeRect) {
      const relativeY = pointerY - nodeRect.top;
      const proportion = relativeY / nodeRect.height;

      // If pointer is in the top 25% or bottom 25% of a node, use node for before/after
      if (proportion <= 0.25) {
        return { type: 'before', targetId: nodeId };
      }
      if (proportion >= 0.75) {
        return { type: 'after', targetId: nodeId };
      }
    }

    // Pointer is in the middle zone of the node -- body droppable wins for "inside"
    const containerId = String(bodyCollision.id).slice('body:'.length);
    return resolveInsideTarget(containerId, pointerY, droppableRects, flatNodes);
  }

  // Body droppable only (no overlapping node)
  if (bodyCollision) {
    const containerId = String(bodyCollision.id).slice('body:'.length);
    return resolveInsideTarget(containerId, pointerY, droppableRects, flatNodes);
  }

  // Node droppable only (no body droppable overlap)
  if (nodeCollision) {
    const nodeId = String(nodeCollision.id);
    const flatNode = flatNodes.find((n) => n.id === nodeId);
    if (!flatNode) return null;

    const nodeRect = droppableRects.get(nodeCollision.id);
    if (!nodeRect) return null;

    return resolveNodeDropTarget(
      flatNode,
      nodeRect,
      pointerY,
      droppableRects,
      flatNodes,
    );
  }

  return null;
}

/**
 * Resolve an "inside" drop target for a container, computing the insertion
 * index based on pointer Y position relative to child midpoints.
 */
function resolveInsideTarget(
  containerId: string,
  pointerY: number,
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  flatNodes: FlatNode[],
): DropTarget {
  const containerFlatNode = flatNodes.find((n) => n.id === containerId);
  if (!containerFlatNode || containerFlatNode.isCollapsed) {
    return { type: 'inside', targetId: containerId };
  }

  const insertIndex = resolveInsertIndex(
    containerFlatNode,
    pointerY,
    droppableRects,
    flatNodes,
  );

  return { type: 'inside', targetId: containerId, insertIndex };
}

/**
 * Resolve the drop target type based on the pointer's Y position within a node rect.
 *
 * - Top 25%: insert before this node
 * - Bottom 25%: insert after this node
 * - Middle 50% on a container: insert as child (inside) with positional index
 * - Middle 50% on a window: insert after (windows can't have children)
 */
function resolveNodeDropTarget(
  flatNode: FlatNode,
  rect: ClientRect,
  pointerY: number,
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  flatNodes: FlatNode[],
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
    const insertIndex = resolveInsertIndex(
      flatNode,
      pointerY,
      droppableRects,
      flatNodes,
    );
    return { type: 'inside', targetId: flatNode.id, insertIndex };
  }

  // Windows can't have children, so treat middle as "after"
  return { type: 'after', targetId: flatNode.id };
}

/**
 * Determine where within a container's children the pointer is positioned.
 * Returns the insertion index (0 = before first child, N = after last child).
 */
function resolveInsertIndex(
  containerFlatNode: FlatNode,
  pointerY: number,
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  flatNodes: FlatNode[],
): number | undefined {
  if (containerFlatNode.isCollapsed) return undefined;

  // Find direct children of this container in the flat list
  const children = flatNodes.filter((n) => n.parentId === containerFlatNode.id);
  if (children.length === 0) return 0;

  // Find which gap between children the pointer is in
  for (let i = 0; i < children.length; i++) {
    const childRect = droppableRects.get(children[i].id);
    if (!childRect) continue;

    const childMidY = childRect.top + childRect.height / 2;
    if (pointerY < childMidY) {
      return i; // Insert before this child
    }
  }

  // Pointer is below all children -- append to end
  return children.length;
}

/**
 * Check if nodeId is a descendant of ancestorId in the flat node list.
 * Walks up the parent chain from nodeId looking for ancestorId.
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
