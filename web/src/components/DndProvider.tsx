/**
 * Shared DnD context provider that wraps both the sidebar and tree editor.
 * This allows sidebar app items (useDraggable) to be dropped into the
 * tree editor's sortable nodes, all through dnd-kit's unified system.
 *
 * Collision detection is created directly here (no ref-registration indirection).
 * TreeEditor updates flatNodesRef via context so collision detection has fresh data.
 * TreeEditor owns drag-end handling via useDndMonitor (no handler registration).
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  DragOverlay,
} from '@dnd-kit/core';
import type { DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { DropTargetCtx } from './LayoutTree/Collision/DropTargetContext';
import type { DropTargetContextValue } from './LayoutTree/Collision/DropTargetContext';
import type { DropTarget } from './LayoutTree/Collision/types';
import type { FlatNode } from './LayoutTree/types';
import { createTreeCollisionDetection } from './LayoutTree/Collision/collisionDetection';
import { TreeNodeOverlay } from './TreeNodeOverlay';

export interface DndState {
  /** ID of the currently dragged item (null when idle) */
  activeDragId: string | null;
  /** Type of the drag source: 'tree' for internal reorder, 'app' for sidebar */
  activeDragType: 'tree' | 'app' | null;
  /** App data when dragging from sidebar */
  activeDragAppData: { bundleId: string; app: { name: string; defaultStartup?: string; source?: string } } | null;
}

interface DndContextValue extends DndState {
  /**
   * Mutable ref for the current flat nodes list.
   * TreeEditor writes to this so collision detection always has fresh data.
   */
  flatNodesRef: React.MutableRefObject<FlatNode[]>;
}

const DndCtx = createContext<DndContextValue>({
  activeDragId: null,
  activeDragType: null,
  activeDragAppData: null,
  flatNodesRef: { current: [] },
});

export function useDndState(): DndState {
  const ctx = useContext(DndCtx);
  return {
    activeDragId: ctx.activeDragId,
    activeDragType: ctx.activeDragType,
    activeDragAppData: ctx.activeDragAppData,
  };
}

/**
 * Hook for TreeEditor to get the flatNodesRef so it can keep it updated.
 * Collision detection reads from this ref on every pointer move.
 */
export function useDndFlatNodesRef() {
  return useContext(DndCtx).flatNodesRef;
}

export function DndProvider({ children }: { children: React.ReactNode }) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'tree' | 'app' | null>(null);
  const [activeDragAppData, setActiveDragAppData] = useState<DndState['activeDragAppData']>(null);
  const [activeDragTreeNode, setActiveDragTreeNode] = useState<FlatNode | null>(null);
  const [dropTarget, setDropTargetState] = useState<DropTarget | null>(null);

  // Refs for collision detection — kept fresh by TreeEditor (flatNodes)
  // and by DndProvider itself (activeDragId).
  const flatNodesRef = useRef<FlatNode[]>([]);
  const activeDragIdRef = useRef<string | null>(null);

  // Keep activeDragIdRef in sync with state
  activeDragIdRef.current = activeDragId;

  // Create collision detection directly — no ref-registration indirection.
  // The function reads from refs on every call, so it always has fresh data.
  const collisionDetection = useMemo(
    () =>
      createTreeCollisionDetection(
        () => flatNodesRef.current,
        () => activeDragIdRef.current,
      ),
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveDragId(id);

    if (id.startsWith('app-entry:')) {
      setActiveDragType('app');
      const data = event.active.data.current as DndState['activeDragAppData'];
      setActiveDragAppData(data);
      setActiveDragTreeNode(null);
    } else {
      setActiveDragType('tree');
      setActiveDragAppData(null);
      // Read FlatNode data attached by SortableNodeWrapper
      const treeData = event.active.data.current as { type: string; flatNode: FlatNode } | undefined;
      setActiveDragTreeNode(treeData?.flatNode ?? null);
    }
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Extract the resolved drop target from collision data (set by collision detection).
    // The collision detection attaches a DropTarget to collision.data.dropTarget.
    const resolvedTarget = (_event.collisions?.[0]?.data?.dropTarget as DropTarget | undefined) ?? null;
    setDropTargetState(resolvedTarget);
  }, []);

  const handleDragEnd = useCallback(() => {
    // TreeEditor handles the actual drag-end logic via useDndMonitor.
    // DndProvider just clears drag state after all monitors have fired.
    // Note: useDndMonitor handlers fire synchronously before this callback,
    // so TreeEditor's handleDragEnd sees the drop target before it's cleared.
    setActiveDragId(null);
    setActiveDragType(null);
    setActiveDragAppData(null);
    setActiveDragTreeNode(null);
    setDropTargetState(null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragType(null);
    setActiveDragAppData(null);
    setActiveDragTreeNode(null);
    setDropTargetState(null);
  }, []);

  const setDropTarget = useCallback((target: DropTarget | null) => {
    setDropTargetState(target);
  }, []);

  const clearDropTarget = useCallback(() => {
    setDropTargetState(null);
  }, []);

  const dropTargetCtxValue = useMemo<DropTargetContextValue>(() => ({
    dropTarget,
    setDropTarget,
    clearDropTarget,
  }), [dropTarget, setDropTarget, clearDropTarget]);

  const ctxValue = useMemo<DndContextValue>(() => ({
    activeDragId,
    activeDragType,
    activeDragAppData,
    flatNodesRef,
  }), [activeDragId, activeDragType, activeDragAppData]);

  return (
    <DropTargetCtx.Provider value={dropTargetCtxValue}>
      <DndCtx.Provider value={ctxValue}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {children}
          <DragOverlay dropAnimation={null}>
            {activeDragId && activeDragType === 'tree' && activeDragTreeNode && (
              <TreeNodeOverlay flatNode={activeDragTreeNode} />
            )}
            {activeDragId && activeDragType === 'app' && activeDragAppData && (
              <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-gray-800 border border-blue-600 shadow-lg shadow-blue-900/30 opacity-90">
                <span className="text-blue-400">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 2v8h10V5H3z" />
                  </svg>
                </span>
                <span className="text-sm text-gray-200">{activeDragAppData.app.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </DndCtx.Provider>
    </DropTargetCtx.Provider>
  );
}
