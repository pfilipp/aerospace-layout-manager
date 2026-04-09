import { create } from 'zustand';
import type { ContainerNode, TreeNode, LayoutType, Orientation } from '../types';

// --- Tree manipulation helpers ---

const MAX_UNDO_STACK = 50;

let _nextId = 1;

/** Generate a unique ID for tree nodes. */
export function generateNodeId(): string {
  return `node-${Date.now()}-${_nextId++}`;
}

/** Deep clone a tree, preserving all properties including _nodeId. */
export function cloneTree<T extends TreeNode>(node: T): T {
  return structuredClone(node);
}

/**
 * Get the _nodeId from a tree node. The _nodeId is injected at runtime by assignNodeIds
 * and is not part of the base TreeNode type, so we access it via unknown cast.
 */
export function getNodeId(node: TreeNode): string | undefined {
  return (node as unknown as Record<string, unknown>)['_nodeId'] as string | undefined;
}

/** Set the _nodeId on a tree node. */
function setNodeId(node: TreeNode, id: string): void {
  (node as unknown as Record<string, unknown>)['_nodeId'] = id;
}

/**
 * Assign unique IDs to every node in a tree.
 * Containers get IDs (they don't have them natively).
 * Windows keep their window-id but also get a stable node ID.
 * Returns a new tree with `_nodeId` fields injected.
 */
export function assignNodeIds(node: TreeNode): TreeNode {
  const cloned = cloneTree(node);
  function walk(n: TreeNode): void {
    if (!getNodeId(n)) {
      setNodeId(n, generateNodeId());
    }
    if (n.type === 'container') {
      for (const child of n.children) {
        walk(child);
      }
    }
  }
  walk(cloned);
  return cloned;
}

/** Find a node by its _nodeId within the tree. */
export function findNodeById(
  tree: TreeNode,
  nodeId: string,
): TreeNode | null {
  if (getNodeId(tree) === nodeId) return tree;
  if (tree.type === 'container') {
    for (const child of tree.children) {
      const found = findNodeById(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/** Find the parent container of a node by its _nodeId. */
export function findParent(
  tree: ContainerNode,
  nodeId: string,
): { parent: ContainerNode; index: number } | null {
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (getNodeId(child) === nodeId) {
      return { parent: tree, index: i };
    }
    if (child.type === 'container') {
      const result = findParent(child, nodeId);
      if (result) return result;
    }
  }
  return null;
}

/** Remove a node from the tree by its _nodeId. Returns the removed node or null. */
export function removeNode(
  tree: ContainerNode,
  nodeId: string,
): TreeNode | null {
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (getNodeId(child) === nodeId) {
      return tree.children.splice(i, 1)[0];
    }
    if (child.type === 'container') {
      const removed = removeNode(child, nodeId);
      if (removed) return removed;
    }
  }
  return null;
}

/** Insert a node into a container at the given index. */
export function insertNode(
  tree: ContainerNode,
  parentId: string,
  node: TreeNode,
  index: number,
): boolean {
  if (getNodeId(tree) === parentId) {
    tree.children.splice(index, 0, node);
    return true;
  }
  for (const child of tree.children) {
    if (child.type === 'container') {
      if (insertNode(child, parentId, node, index)) return true;
    }
  }
  return false;
}

/** Find a container node by its _nodeId. */
function findContainerById(
  tree: ContainerNode,
  nodeId: string,
): ContainerNode | null {
  if (getNodeId(tree) === nodeId) return tree;
  for (const child of tree.children) {
    if (child.type === 'container') {
      const found = findContainerById(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

// --- Editor state interface ---

export interface EditorState {
  // Current layout tree being edited
  tree: ContainerNode | null;

  // Selected node ID (_nodeId, not dnd-kit id)
  selectedNodeId: string | null;

  // Collapsed container IDs (using _nodeId)
  collapsedIds: Set<string>;

  // Undo/redo stacks
  undoStack: ContainerNode[];
  redoStack: ContainerNode[];

  // Current mode and workspace
  activeMode: string | null;
  activeWorkspace: string | null;

  // Actions
  setTree: (tree: ContainerNode) => void;
  selectNode: (id: string | null) => void;
  toggleCollapse: (id: string) => void;

  // Tree mutations (all push to undo stack)
  moveNode: (nodeId: string, targetParentId: string, targetIndex: number) => void;
  addNode: (parentId: string, node: TreeNode) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  wrapNodes: (nodeIds: string[], containerLayout: LayoutType) => void;
  updateNode: (nodeId: string, updates: Partial<TreeNode>) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Workspace navigation
  setActiveWorkspace: (mode: string, workspace: string, tree: ContainerNode) => void;
}

/**
 * Push the current tree onto the undo stack and clear the redo stack.
 * Returns the new undo stack (capped at MAX_UNDO_STACK).
 */
export function pushUndo(
  currentTree: ContainerNode,
  undoStack: ContainerNode[],
): { undoStack: ContainerNode[]; redoStack: ContainerNode[] } {
  const newUndo = [...undoStack, cloneTree(currentTree)];
  if (newUndo.length > MAX_UNDO_STACK) {
    newUndo.shift();
  }
  return { undoStack: newUndo, redoStack: [] };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tree: null,
  selectedNodeId: null,
  collapsedIds: new Set(),
  undoStack: [],
  redoStack: [],
  activeMode: null,
  activeWorkspace: null,

  setTree: (tree: ContainerNode) => {
    const withIds = assignNodeIds(tree) as ContainerNode;
    set({
      tree: withIds,
      selectedNodeId: null,
      collapsedIds: new Set(),
      undoStack: [],
      redoStack: [],
    });
  },

  selectNode: (id: string | null) => {
    set({ selectedNodeId: id });
  },

  toggleCollapse: (id: string) => {
    set((state) => {
      const next = new Set(state.collapsedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { collapsedIds: next };
    });
  },

  moveNode: (nodeId: string, targetParentId: string, targetIndex: number) => {
    const { tree, undoStack } = get();
    if (!tree) return;

    const stacks = pushUndo(tree, undoStack);
    const newTree = cloneTree(tree);

    const removed = removeNode(newTree, nodeId);
    if (!removed) return;

    const inserted = insertNode(newTree, targetParentId, removed, targetIndex);
    if (!inserted) return;

    set({ tree: newTree, ...stacks });
  },

  addNode: (parentId: string, node: TreeNode) => {
    const { tree, undoStack } = get();
    if (!tree) return;

    const stacks = pushUndo(tree, undoStack);
    const newTree = cloneTree(tree);
    const nodeWithId = assignNodeIds(node);

    const parent = findContainerById(newTree, parentId);
    if (!parent) return;

    parent.children.push(nodeWithId);
    set({ tree: newTree, ...stacks });
  },

  deleteNode: (nodeId: string) => {
    const { tree, undoStack, selectedNodeId } = get();
    if (!tree) return;

    // Don't allow deleting the root
    if (getNodeId(tree) === nodeId) return;

    const stacks = pushUndo(tree, undoStack);
    const newTree = cloneTree(tree);
    removeNode(newTree, nodeId);

    const newSelected = selectedNodeId === nodeId ? null : selectedNodeId;
    set({ tree: newTree, selectedNodeId: newSelected, ...stacks });
  },

  duplicateNode: (nodeId: string) => {
    const { tree, undoStack } = get();
    if (!tree) return;

    // Don't allow duplicating the root
    if (getNodeId(tree) === nodeId) return;

    const stacks = pushUndo(tree, undoStack);
    const newTree = cloneTree(tree);

    const parentInfo = findParent(newTree, nodeId);
    if (!parentInfo) return;

    const original = parentInfo.parent.children[parentInfo.index];
    const duplicate = assignNodeIds(cloneTree(original));

    parentInfo.parent.children.splice(parentInfo.index + 1, 0, duplicate);

    set({ tree: newTree, ...stacks });
  },

  wrapNodes: (nodeIds: string[], containerLayout: LayoutType) => {
    const { tree, undoStack } = get();
    if (!tree || nodeIds.length === 0) return;

    const newTree = cloneTree(tree);
    const firstParent = findParent(newTree, nodeIds[0]);
    if (!firstParent) return;

    // Verify all nodes share the same parent
    const firstParentId = getNodeId(firstParent.parent);
    for (const nid of nodeIds) {
      const p = findParent(newTree, nid);
      if (!p || getNodeId(p.parent) !== firstParentId) {
        return; // Can't wrap nodes from different parents
      }
    }

    const stacks = pushUndo(tree, undoStack);

    // Collect the nodes to wrap (in their current order)
    const parent = firstParent.parent;
    const indicesToRemove: number[] = [];
    const nodesToWrap: TreeNode[] = [];

    for (let i = 0; i < parent.children.length; i++) {
      if (nodeIds.includes(getNodeId(parent.children[i]) ?? '')) {
        indicesToRemove.push(i);
        nodesToWrap.push(parent.children[i]);
      }
    }

    if (nodesToWrap.length === 0) return;

    // Determine orientation from layout
    const orientation: Orientation =
      containerLayout.startsWith('h_') ? 'horizontal' : 'vertical';

    // Create the wrapper container
    const wrapper: ContainerNode = {
      type: 'container',
      layout: containerLayout,
      orientation,
      children: nodesToWrap,
    };
    setNodeId(wrapper, generateNodeId());

    // Remove the original nodes (in reverse order to preserve indices)
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      parent.children.splice(indicesToRemove[i], 1);
    }

    // Insert the wrapper at the position of the first removed node
    parent.children.splice(indicesToRemove[0], 0, wrapper);

    set({ tree: newTree, ...stacks });
  },

  updateNode: (nodeId: string, updates: Partial<TreeNode>) => {
    const { tree, undoStack } = get();
    if (!tree) return;

    const stacks = pushUndo(tree, undoStack);
    const newTree = cloneTree(tree);

    const node = findNodeById(newTree, nodeId);
    if (!node) return;

    // Apply updates to the found node
    Object.assign(node, updates);

    set({ tree: newTree, ...stacks });
  },

  undo: () => {
    const { tree, undoStack, redoStack } = get();
    if (!tree || undoStack.length === 0) return;

    const newUndo = [...undoStack];
    const previousTree = newUndo.pop()!;
    const newRedo = [...redoStack, cloneTree(tree)];

    set({
      tree: previousTree,
      undoStack: newUndo,
      redoStack: newRedo,
    });
  },

  redo: () => {
    const { tree, undoStack, redoStack } = get();
    if (!tree || redoStack.length === 0) return;

    const newRedo = [...redoStack];
    const nextTree = newRedo.pop()!;
    const newUndo = [...undoStack, cloneTree(tree)];

    set({
      tree: nextTree,
      undoStack: newUndo,
      redoStack: newRedo,
    });
  },

  canUndo: () => get().undoStack.length > 0,

  canRedo: () => get().redoStack.length > 0,

  setActiveWorkspace: (mode: string, workspace: string, tree: ContainerNode) => {
    const withIds = assignNodeIds(tree) as ContainerNode;
    set({
      activeMode: mode,
      activeWorkspace: workspace,
      tree: withIds,
      selectedNodeId: null,
      collapsedIds: new Set(),
      undoStack: [],
      redoStack: [],
    });
  },
}));
