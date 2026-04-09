import { useState, useMemo, useCallback, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  DragOverlay,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import type { ContainerNode, WindowNode, AppEntry } from '../../../types';
import type { FlatNode } from '../types';
import { flattenTree, reorderWithinParent, moveNodeBetweenContainers } from './flattenTree';
import { SortableNodeWrapper } from './TreeNode';
import { RecursiveContainer } from '../Recursive/RecursiveContainer';
import {
  createTreeCollisionDetection,
  getCurrentDropTarget,
  setCurrentDropTarget,
} from '../Collision/collisionDetection';
import type { DropTarget } from '../Collision/types';
import { TreeActions } from '../TreeActions';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';
import { useEditorStore } from '../../../store';

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

/**
 * Resolve a flat path ID to the _nodeId of its parent container.
 * Returns null if no parent found.
 */
function resolveStoreParentId(flatId: string, flatNodes: FlatNode[]): string | null {
  const flatNode = flatNodes.find((n) => n.id === flatId);
  if (!flatNode || !flatNode.parentId) return null;
  return resolveStoreNodeId(flatNode.parentId, flatNodes);
}

export function TreeEditor({
  layout,
  onLayoutChange,
  selectedNodeId,
  onSelectNode,
}: TreeEditorProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Store actions for context menu and tree manipulation
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const wrapNodes = useEditorStore((s) => s.wrapNodes);
  const addNode = useEditorStore((s) => s.addNode);

  const flatNodes = useMemo(
    () => flattenTree(layout, collapsedIds),
    [layout, collapsedIds],
  );

  // Refs for collision detection (must be fresh on each call)
  const flatNodesRef = useRef(flatNodes);
  flatNodesRef.current = flatNodes;
  const activeDragIdRef = useRef(activeDragId);
  activeDragIdRef.current = activeDragId;

  const collisionDetection = useMemo(
    () =>
      createTreeCollisionDetection(
        () => flatNodesRef.current,
        () => activeDragIdRef.current,
      ),
    [],
  );

  const nodeIds = useMemo(
    () => flatNodes.map((n) => n.id),
    [flatNodes],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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

  // Determine if selected node is a container for TreeActions targeting
  const selectedIsContainer = useMemo(() => {
    if (!selectedNodeId) return false;
    const node = flatNodes.find((n) => n.id === selectedNodeId);
    return node?.node.type === 'container';
  }, [selectedNodeId, flatNodes]);

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

  // Handle drag-from-sidebar: native dragover/drop for 'application/x-alm-app'
  const handleNativeDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-alm-app')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleNativeDrop = useCallback(
    (e: React.DragEvent) => {
      const data = e.dataTransfer.getData('application/x-alm-app');
      if (!data) return;

      e.preventDefault();

      let parsed: { bundleId: string; app: AppEntry };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      // Find the closest container at the drop point using DOM data attributes
      const targetFlatId = findDropTargetContainer(e, flatNodes);
      // Resolve to a store _nodeId
      const targetStoreId = targetFlatId
        ? resolveStoreNodeId(targetFlatId, flatNodes)
        : getNodeIdFromTreeNode(layout);

      if (!targetStoreId) return;

      const windowNode: WindowNode = {
        type: 'window',
        'app-bundle-id': parsed.bundleId,
        'app-name': parsed.app.name,
        startup: parsed.app.defaultStartup || '',
        title: '',
        'window-id': 0,
      };

      addNode(targetStoreId, windowNode);
    },
    [layout, flatNodes, addNode],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDropTarget(null);
    setCurrentDropTarget(null);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    const target = getCurrentDropTarget();
    setDropTarget(target);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const resolvedDropTarget = getCurrentDropTarget();
      setActiveDragId(null);
      setDropTarget(null);
      setCurrentDropTarget(null);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      const activeNode = flatNodes.find((n) => n.id === activeId);
      const overNode = flatNodes.find((n) => n.id === overId);

      if (!activeNode || !overNode) return;

      // Use the resolved drop target from collision detection if available
      if (resolvedDropTarget && resolvedDropTarget.targetId === overId) {
        if (resolvedDropTarget.type === 'inside' && overNode.node.type === 'container') {
          const newLayout = moveNodeBetweenContainers(
            layout,
            flatNodes,
            activeId,
            overId,
          );
          if (newLayout !== layout) {
            onLayoutChange(newLayout);
          }
          return;
        }
      }

      // Same-parent reorder (T10a)
      if (activeNode.parentId === overNode.parentId) {
        const newLayout = reorderWithinParent(
          layout,
          flatNodes,
          activeId,
          overId,
        );
        if (newLayout !== layout) {
          onLayoutChange(newLayout);
        }
        return;
      }

      // Cross-container move (T10c)
      const newLayout = moveNodeBetweenContainers(
        layout,
        flatNodes,
        activeId,
        overId,
      );
      if (newLayout !== layout) {
        onLayoutChange(newLayout);
      }
    },
    [layout, flatNodes, onLayoutChange],
  );

  // Find the active drag node for the DragOverlay
  const activeDragNode = activeDragId
    ? flatNodes.find((n) => n.id === activeDragId)
    : null;

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
      <div
        className="flex-1 overflow-y-auto p-2"
        onDragOver={handleNativeDragOver}
        onDrop={handleNativeDrop}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
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
              dropTarget={dropTarget}
              multiSelectedIds={multiSelectedIds}
              onContextMenu={handleContextMenu}
            />
          </SortableContext>
          <DragOverlay>
            {activeDragNode ? (
              <DragOverlayContent flatNode={activeDragNode} />
            ) : null}
          </DragOverlay>
        </DndContext>
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

/**
 * Lightweight overlay shown while dragging a node.
 */
function DragOverlayContent({ flatNode }: { flatNode: FlatNode }) {
  const isContainer = flatNode.node.type === 'container';

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-gray-800 border border-blue-600 shadow-lg shadow-blue-900/30 opacity-90">
      {isContainer ? (
        <>
          <span className="text-yellow-500">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.621 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
            </svg>
          </span>
          <span className="text-sm text-gray-200 font-medium">
            {(flatNode.node as ContainerNode).layout}
          </span>
        </>
      ) : (
        <>
          <span className="text-blue-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 2v8h10V5H3z" />
            </svg>
          </span>
          <span className="text-sm text-gray-200">
            {(flatNode.node as WindowNode)['app-name'] ||
              (flatNode.node as WindowNode)['app-bundle-id']}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Try to find a container node near the native drop point.
 * Walks up the DOM from the drop target to find a data-node-id attribute.
 */
function findDropTargetContainer(
  e: React.DragEvent,
  flatNodes: FlatNode[],
): string | null {
  let el: HTMLElement | null = e.target as HTMLElement;
  while (el) {
    const nodeId = el.getAttribute('data-node-id');
    if (nodeId) {
      const flatNode = flatNodes.find((n) => n.id === nodeId);
      if (flatNode && flatNode.node.type === 'container') {
        return nodeId;
      }
      // If it's a window, use its parent container
      if (flatNode && flatNode.parentId) {
        return flatNode.parentId;
      }
    }
    el = el.parentElement;
  }
  return null;
}
