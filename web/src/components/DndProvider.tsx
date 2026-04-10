/**
 * Shared DnD context provider that wraps both the sidebar and tree editor.
 * This allows sidebar app items (useDraggable) to be dropped into the
 * tree editor's sortable nodes, all through dnd-kit's unified system.
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
import type { CollisionDetection } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export interface DndState {
  /** ID of the currently dragged item (null when idle) */
  activeDragId: string | null;
  /** Type of the drag source: 'tree' for internal reorder, 'app' for sidebar */
  activeDragType: 'tree' | 'app' | null;
  /** App data when dragging from sidebar */
  activeDragAppData: { bundleId: string; app: { name: string; defaultStartup?: string; source?: string } } | null;
}

interface DndContextValue extends DndState {
  /** Register a callback to handle drag-end events (set by TreeEditor) */
  registerDragEndHandler: (handler: ((event: DragEndEvent) => void) | null) => void;
  /** Register a callback to handle drag-over events */
  registerDragOverHandler: (handler: ((event: DragOverEvent) => void) | null) => void;
  /** Register collision detection (set by TreeEditor) */
  registerCollisionDetection: (cd: Parameters<typeof DndContext>[0]['collisionDetection']) => void;
}

const DndCtx = createContext<DndContextValue>({
  activeDragId: null,
  activeDragType: null,
  activeDragAppData: null,
  registerDragEndHandler: () => {},
  registerDragOverHandler: () => {},
  registerCollisionDetection: () => {},
});

export function useDndState(): DndState {
  const ctx = useContext(DndCtx);
  return {
    activeDragId: ctx.activeDragId,
    activeDragType: ctx.activeDragType,
    activeDragAppData: ctx.activeDragAppData,
  };
}

export function useDndRegistration() {
  const ctx = useContext(DndCtx);
  return {
    registerDragEndHandler: ctx.registerDragEndHandler,
    registerDragOverHandler: ctx.registerDragOverHandler,
    registerCollisionDetection: ctx.registerCollisionDetection,
  };
}

export function DndProvider({ children }: { children: React.ReactNode }) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'tree' | 'app' | null>(null);
  const [activeDragAppData, setActiveDragAppData] = useState<DndState['activeDragAppData']>(null);

  // TreeEditor registers its handlers so we can forward events
  const dragEndHandlerRef = useRef<((event: DragEndEvent) => void) | null>(null);
  const dragOverHandlerRef = useRef<((event: DragOverEvent) => void) | null>(null);
  const collisionDetectionRef = useRef<Parameters<typeof DndContext>[0]['collisionDetection']>(undefined);

  const registerDragEndHandler = useCallback((handler: ((event: DragEndEvent) => void) | null) => {
    dragEndHandlerRef.current = handler;
  }, []);

  const registerDragOverHandler = useCallback((handler: ((event: DragOverEvent) => void) | null) => {
    dragOverHandlerRef.current = handler;
  }, []);

  const registerCollisionDetection = useCallback((cd: Parameters<typeof DndContext>[0]['collisionDetection']) => {
    collisionDetectionRef.current = cd;
  }, []);

  // Stable wrapper that delegates to the ref on every call.
  // DndContext captures this function once at mount, but the function
  // always reads the CURRENT ref value, so it works after TreeEditor registers.
  const stableCollisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (collisionDetectionRef.current) {
        const result = collisionDetectionRef.current(args);
        // Debug: expose to Playwright
        (window as unknown as Record<string, unknown>).__DEBUG_COLLISION = {
          hasRef: true,
          resultCount: result.length,
          result: result.map(c => ({ id: c.id, data: c.data })),
        };
        return result;
      }
      (window as unknown as Record<string, unknown>).__DEBUG_COLLISION = { hasRef: false };
      return [];
    },
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
    } else {
      setActiveDragType('tree');
      setActiveDragAppData(null);
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    dragOverHandlerRef.current?.(event);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    dragEndHandlerRef.current?.(event);
    setActiveDragId(null);
    setActiveDragType(null);
    setActiveDragAppData(null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragType(null);
    setActiveDragAppData(null);
  }, []);

  const ctxValue = useMemo<DndContextValue>(() => ({
    activeDragId,
    activeDragType,
    activeDragAppData,
    registerDragEndHandler,
    registerDragOverHandler,
    registerCollisionDetection,
  }), [activeDragId, activeDragType, activeDragAppData, registerDragEndHandler, registerDragOverHandler, registerCollisionDetection]);

  return (
    <DndCtx.Provider value={ctxValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={stableCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay>
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
  );
}
