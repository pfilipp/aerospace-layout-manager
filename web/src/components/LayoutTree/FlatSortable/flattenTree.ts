import type { TreeNode, ContainerNode } from '../../../types';
import type { FlatNode } from '../types';

/**
 * Flatten a nested tree structure into a flat list with depth information.
 * Collapsed containers have their children omitted from the output.
 *
 * @param root - The root container node of the layout tree
 * @param collapsedIds - Set of FlatNode IDs that are collapsed
 * @returns Flat array of FlatNode objects suitable for dnd-kit SortableContext
 */
export function flattenTree(
  root: ContainerNode,
  collapsedIds: Set<string>,
): FlatNode[] {
  const result: FlatNode[] = [];

  function walk(
    node: TreeNode,
    depth: number,
    parentId: string | null,
    index: number,
    pathPrefix: string,
  ): void {
    const id = node.type === 'container'
      ? `${pathPrefix}c-${index}`
      : `${pathPrefix}w-${index}`;

    const isCollapsed = node.type === 'container' && collapsedIds.has(id);

    result.push({
      id,
      node,
      depth,
      parentId,
      index,
      isCollapsed,
    });

    // Recurse into children if this is an expanded container
    if (node.type === 'container' && !isCollapsed) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth + 1, id, i, `${id}/`);
      }
    }
  }

  // The root container itself is always the first node
  const rootId = 'root';
  const rootCollapsed = collapsedIds.has(rootId);

  result.push({
    id: rootId,
    node: root,
    depth: 0,
    parentId: null,
    index: 0,
    isCollapsed: rootCollapsed,
  });

  // Walk root's children if not collapsed
  if (!rootCollapsed) {
    for (let i = 0; i < root.children.length; i++) {
      walk(root.children[i], 1, rootId, i, 'root/');
    }
  }

  return result;
}

/**
 * Given a flat list reorder (from dnd-kit), reconstruct the tree with the node
 * moved from oldIndex to newIndex within the same parent container.
 *
 * This only handles within-container reorder (T10a scope).
 * Cross-container moves are handled in T10c.
 */
export function reorderWithinParent(
  root: ContainerNode,
  flatNodes: FlatNode[],
  activeId: string,
  overId: string,
): ContainerNode {
  const activeNode = flatNodes.find((n) => n.id === activeId);
  const overNode = flatNodes.find((n) => n.id === overId);

  if (!activeNode || !overNode) return root;

  // Only handle same-parent reorder for T10a
  if (activeNode.parentId !== overNode.parentId) return root;

  // Don't allow moving the root
  if (activeNode.parentId === null) return root;

  const oldIndex = activeNode.index;
  const newIndex = overNode.index;

  if (oldIndex === newIndex) return root;

  // Deep clone the tree and find the parent container to reorder
  const newRoot = structuredClone(root);
  const parent = findContainerById(newRoot, flatNodes, activeNode.parentId);

  if (!parent) return root;

  // Perform the array move
  const children = parent.children;
  const [moved] = children.splice(oldIndex, 1);
  children.splice(newIndex, 0, moved);

  return newRoot;
}

/**
 * Move a node from one parent container to another (or reposition within the same parent
 * when the drop target is in a different position).
 *
 * This is the core T10c cross-container move operation.
 *
 * @param root - The root container (will be deep-cloned)
 * @param flatNodes - Current flat node list for resolving IDs to tree positions
 * @param activeId - FlatNode ID of the node being dragged
 * @param overId - FlatNode ID of the drop target
 * @param insertIndex - Optional: specific position within target container (for 'inside' drops)
 * @returns New root container with the node moved, or the original root if no move was needed
 */
export function moveNodeBetweenContainers(
  root: ContainerNode,
  flatNodes: FlatNode[],
  activeId: string,
  overId: string,
  insertIndex?: number,
): ContainerNode {
  const activeNode = flatNodes.find((n) => n.id === activeId);
  const overNode = flatNodes.find((n) => n.id === overId);

  if (!activeNode || !overNode) return root;

  // Don't allow moving the root
  if (activeNode.parentId === null) return root;

  // Determine the target parent container and insertion index:
  // - If dropping ON a container node -> insert at insertIndex (or last child)
  // - If dropping ON a window/leaf node -> insert next to it in its parent container
  let targetParentId: string;
  let targetIndex: number;

  if (overNode.node.type === 'container' && overNode.id !== activeId) {
    // Dropping on a container: use insertIndex if provided, otherwise append
    targetParentId = overNode.id;
    const overContainer = overNode.node as ContainerNode;

    if (insertIndex !== undefined) {
      targetIndex = insertIndex;
    } else {
      targetIndex = overContainer.children.length;
    }

    // If the active node is currently a child of this container,
    // we need to adjust the index since it will be removed first
    if (activeNode.parentId === overNode.id && activeNode.index < targetIndex) {
      targetIndex = Math.max(0, targetIndex - 1);
    }
  } else {
    // Dropping on a window (or a non-droppable): insert next to it in its parent
    if (overNode.parentId === null) return root; // over node has no parent (shouldn't happen for windows)
    targetParentId = overNode.parentId;
    targetIndex = overNode.index;

    // If same parent and active is before over, adjust for removal
    if (activeNode.parentId === targetParentId && activeNode.index < overNode.index) {
      targetIndex = overNode.index - 1;
    }
  }

  // If we'd end up at the same position, skip
  if (activeNode.parentId === targetParentId && activeNode.index === targetIndex) {
    return root;
  }

  // Deep clone the tree
  const newRoot = structuredClone(root);

  // Find BOTH parents BEFORE any mutations — splice shifts indices and
  // makes flatNode paths stale for findContainerById
  const sourceParent = findContainerById(newRoot, flatNodes, activeNode.parentId);
  const targetParent = findContainerById(newRoot, flatNodes, targetParentId);
  if (!sourceParent || !targetParent) return root;

  // Now remove from source
  const [movedNode] = sourceParent.children.splice(activeNode.index, 1);
  if (!movedNode) return root;

  // Clamp the index in case the removal shifted things
  const clampedIndex = Math.min(targetIndex, targetParent.children.length);
  targetParent.children.splice(clampedIndex, 0, movedNode);

  return newRoot;
}

/**
 * Find a container node in the tree by its FlatNode ID.
 * Walks the tree following the path encoded in the ID.
 */
export function findContainerById(
  root: ContainerNode,
  flatNodes: FlatNode[],
  targetId: string,
): ContainerNode | null {
  if (targetId === 'root') return root;

  // Use the flat nodes to trace the path from root to target
  const targetNode = flatNodes.find((n) => n.id === targetId);
  if (!targetNode || targetNode.node.type !== 'container') return null;

  // Build path from root to target
  const path: FlatNode[] = [];
  let current: FlatNode | undefined = targetNode;
  while (current) {
    path.unshift(current);
    current = current.parentId
      ? flatNodes.find((n) => n.id === current!.parentId)
      : undefined;
  }

  // Walk the cloned tree following the path indices (skip root which is path[0])
  let container: ContainerNode = root;
  for (let i = 1; i < path.length; i++) {
    const child = container.children[path[i].index];
    if (!child || child.type !== 'container') return null;
    container = child;
  }

  return container;
}
