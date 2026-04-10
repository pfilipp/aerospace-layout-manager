import { useState, useMemo, useCallback, useEffect } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDndMonitor } from '@dnd-kit/core';
import type { ContainerNode, WindowNode } from '../../../types';
import type { FlatNode } from '../types';
import { flattenTree } from './flattenTree';
import { SortableNodeWrapper } from './TreeNode';
import { RecursiveContainer } from '../Recursive/RecursiveContainer';
import { useDropTarget, useDropTargetActions } from '../Collision/DropTargetContext';
import { TreeActions } from '../TreeActions';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';
import { useEditorStore } from '../../../store';
import { useDndState, useDndFlatNodesRef } from '../../DndProvider';

interface TreeEditorProps {
  /** The root container of the layout tree */
  layout: ContainerNode;
  /** Callback when the layout tree changes (reorder, etc.) */
  onLayoutChange: (newLayout: ContainerNode) => void;
  /** Currently selected node ID */
  selectedNodeId: string | null;
  /** Callback when a node is selected */
  onSelectNode: (id: string | null) => void;
}

/** Represents the state of the right-click context menu */
interface ContextMenuState {
  x: number;
  y: number;
  /** The flat path ID of the right-clicked node */
  flatId: string;
}

/**
 * Get the _nodeId from a tree node (runtime-injected by assignNodeIds).
 */
function getNodeIdFromTreeNode(node: { type: string }): string | null {
  return (node as unknown as Record<string, unknown>)['_nodeId'] as string | null;
}

/**
 * Resolve a flat path ID (e.g., "root/c-0/w-1") to the _nodeId used by the Zustand store.
 * Returns null if the flat node is not found.
 */
function resolveStoreNodeId(flatId: string, flatNodes: FlatNode[]): string | null {
  const flatNode = flatNodes.find((n) => n.id === flatId);
  if (!flatNode) return null;
  return getNodeIdFromTreeNode(flatNode.node);
}

export function TreeEditor({
  layout,
  onLayoutChange: _onLayoutChange,
  selectedNodeId,
  onSelectNode,
}: TreeEditorProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());

  // Read the current drop target reactively from DropTargetContext
  const dropTarget = useDropTarget();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Shared DnD state from DndProvider
  const { activeDragId } = useDndState();

  // Get the flatNodesRef from DndProvider to keep collision detection data fresh
  const flatNodesRef = useDndFlatNodesRef();

  // Drop target actions for clearing after drag-end
  const { clearDropTarget } = useDropTargetActions();

  // Store actions for context menu and tree manipulation
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const wrapNodes = useEditorStore((s) => s.wrapNodes);
  const addNode = useEditorStore((s) => s.addNode);
  const moveNodeByFlatId = useEditorStore((s) => s.moveNodeByFlatId);

  const flatNodes = useMemo(
    () => flattenTree(layout, collapsedIds),
    [layout, collapsedIds],
  );

  // Keep DndProvider's flatNodesRef in sync so collision detection has fresh data.
  // DndProvider owns the collision detection function and reads flatNodes from this ref.
  useEffect(() => {
    flatNodesRef.current = flatNodes;
  }, [flatNodes, flatNodesRef]);

  const nodeIds = useMemo(
    () => flatNodes.map((n) => n.id),
    [flatNodes],
  );

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Multi-select: Shift+click or Ctrl/Cmd+click toggles selection
  const handleNodeClick = useCallback(
    (id: string, event: React.MouseEvent) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        // Toggle multi-select
        setMultiSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        return;
      }

      // Normal click: clear multi-select and select single node
      setMultiSelectedIds(new Set());
      onSelectNode(id);
    },
    [onSelectNode],
  );

  // Context menu handler
  const handleContextMenu = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ x: event.clientX, y: event.clientY, flatId: id });
    },
    [],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Build context menu actions for the targeted node
  const contextMenuActions: ContextMenuAction[] = useMemo(() => {
    if (!contextMenu) return [];
    const flatId = contextMenu.flatId;
    const isRoot = flatId === 'root';
    const storeId = resolveStoreNodeId(flatId, flatNodes);

    if (!storeId) return [];

    return [
      {
        label: 'Duplicate',
        onClick: () => duplicateNode(storeId),
        disabled: isRoot,
        shortcut: 'Cmd+D',
      },
      {
        label: 'Wrap in Container',
        onClick: () => wrapNodes([storeId], 'h_tiles'),
        disabled: isRoot,
      },
      {
        label: 'Delete',
        onClick: () => deleteNode(storeId),
        disabled: isRoot,
        separator: true,
        shortcut: 'Del',
      },
    ];
  }, [contextMenu, flatNodes, deleteNode, duplicateNode, wrapNodes]);

  // Resolve multi-selected flat IDs to store _nodeIds for tree actions
  const multiSelectedStoreIds = useMemo(() => {
    const storeIds = new Set<string>();
    for (const flatId of multiSelectedIds) {
      const storeId = resolveStoreNodeId(flatId, flatNodes);
      if (storeId) storeIds.add(storeId);
    }
    return storeIds;
  }, [multiSelectedIds, flatNodes]);

  // Resolve selected flat ID to store _nodeId for tree actions
  const selectedStoreNodeId = useMemo(() => {
    if (!selectedNodeId) return null;
    return resolveStoreNodeId(selectedNodeId, flatNodes);
  }, [selectedNodeId, flatNodes]);

  const selectedStoreIsContainer = useMemo(() => {
    if (!selectedNodeId) return false;
    const node = flatNodes.find((n) => n.id === selectedNodeId);
    return node?.node.type === 'container';
  }, [selectedNodeId, flatNodes]);

  const handleClearMultiSelect = useCallback(() => {
    setMultiSelectedIds(new Set());
  }, []);

  // Drop target is now read reactively from DropTargetContext (via useDropTarget above).
  // No need for a drag-over handler to poll the module global.

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Read the final drop target from DropTargetContext (set by DndProvider's onDragOver).
      const resolvedDropTarget = dropTarget;

      const { active, over } = event;

      // Use event.over only as a boolean "did collision occur" check.
      // If null, no collision occurred — abort.
      if (!over) {
        clearDropTarget();
        return;
      }

      const activeId = String(active.id);

      try {
        // Handle app drops from sidebar
        if (activeId.startsWith('app-entry:')) {
          const appData = active.data.current as { bundleId: string; app: { name: string; defaultStartup?: string } } | undefined;
          if (!appData) return;

          // Determine target container from drop target context
          let targetFlatId: string;
          if (resolvedDropTarget) {
            // For 'inside' drops, the target IS the container
            // For 'before'/'after' drops, find the parent of the target node
            if (resolvedDropTarget.type === 'inside') {
              targetFlatId = resolvedDropTarget.targetId;
            } else {
              const targetNode = flatNodes.find((n) => n.id === resolvedDropTarget.targetId);
              targetFlatId = targetNode?.parentId ?? 'root';
            }
          } else {
            // Fallback: use over ID to find a container
            const overId = String(over.id);
            const overNode = flatNodes.find((n) => n.id === overId);
            if (!overNode) return;
            targetFlatId = overNode.node.type === 'container'
              ? overId
              : overNode.parentId ?? 'root';
          }

          const targetStoreId = resolveStoreNodeId(targetFlatId, flatNodes)
            ?? getNodeIdFromTreeNode(layout);
          if (!targetStoreId) return;

          const windowNode: WindowNode = {
            type: 'window',
            'app-bundle-id': appData.bundleId,
            'app-name': appData.app.name,
            startup: appData.app.defaultStartup || '',
            title: '',
            'window-id': 0,
          };

          addNode(targetStoreId, windowNode, resolvedDropTarget?.insertIndex);
          return;
        }

        // Tree node move — use moveNodeByFlatId store action
        if (!resolvedDropTarget) return;

        // Don't move a node onto itself
        if (activeId === resolvedDropTarget.targetId) return;

        moveNodeByFlatId({
          sourceId: activeId,
          targetId: resolvedDropTarget.targetId,
          dropType: resolvedDropTarget.type,
        });
      } finally {
        // Always clear the drop target after handling
        clearDropTarget();
      }
    },
    [layout, flatNodes, addNode, dropTarget, clearDropTarget, moveNodeByFlatId],
  );

  // Listen for drag-end events directly via useDndMonitor.
  // This replaces the old ref-registration pattern (registerDragEndHandler).
  // useDndMonitor handlers fire synchronously before DndContext's onDragEnd,
  // so dropTarget is still available when handleDragEnd reads it.
  useDndMonitor({
    onDragEnd: handleDragEnd,
  });

  /**
   * Render function that wraps content in a dnd-kit SortableNodeWrapper.
   */
  const renderSortableWrapper = useCallback(
    (flatNode: FlatNode, children: React.ReactNode) => (
      <SortableNodeWrapper key={flatNode.id} flatNode={flatNode}>
        {children}
      </SortableNodeWrapper>
    ),
    [],
  );

  if (!layout || !layout.children) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select a workspace to edit its layout</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <h2 className="text-sm font-medium text-gray-300">Layout Tree</h2>
      </div>
      <TreeActions
        selectedStoreNodeId={selectedStoreNodeId}
        selectedIsContainer={selectedStoreIsContainer}
        multiSelectedStoreIds={multiSelectedStoreIds}
        onClearMultiSelect={handleClearMultiSelect}
      />
      <div className="flex-1 overflow-y-auto p-2">
        <SortableContext
          items={nodeIds}
          strategy={verticalListSortingStrategy}
        >
          <RecursiveContainer
            container={layout}
            depth={0}
            flatNodeId="root"
            collapsedIds={collapsedIds}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleNodeClick}
            onToggleCollapse={handleToggleCollapse}
            flatNodes={flatNodes}
            renderSortableWrapper={renderSortableWrapper}
            multiSelectedIds={multiSelectedIds}
            onContextMenu={handleContextMenu}
            activeDragId={activeDragId}
          />
        </SortableContext>
      </div>

      {/* Context menu overlay */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenuActions}
          onClose={handleCloseContextMenu}
        />
      )}
    </div>
  );
}

