/**
 * DropTargetContext — React context for sharing the resolved drop target
 * between collision detection (writer) and UI consumers (readers).
 *
 * Replaces the module-global _currentDropTarget pattern that could not
 * trigger React re-renders.
 *
 * Writer: DndProvider's onDragOver handler sets the drop target by
 *   extracting it from collision data and calling setDropTarget.
 * Readers: DropIndicator, TreeEditor's handleDragEnd, and any component
 *   that needs the current drop target use useDropTarget().
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DropTarget } from './types';

export interface DropTargetContextValue {
  /** The currently resolved drop target, or null when not over any target */
  dropTarget: DropTarget | null;
  /** Update the drop target (called by collision detection via onDragOver) */
  setDropTarget: (target: DropTarget | null) => void;
  /** Clear the drop target (convenience for drag end/cancel) */
  clearDropTarget: () => void;
}

/**
 * The raw context object. Exported so DndProvider can provide it directly
 * (DndProvider manages the dropTarget state and provides the context value).
 */
export const DropTargetCtx = createContext<DropTargetContextValue>({
  dropTarget: null,
  setDropTarget: () => {},
  clearDropTarget: () => {},
});

/**
 * Hook to read the current drop target reactively.
 * Components using this will re-render when the drop target changes.
 */
export function useDropTarget(): DropTarget | null {
  return useContext(DropTargetCtx).dropTarget;
}

/**
 * Hook to get the full context value (read + write).
 * Used by DndProvider to wire up collision detection writing.
 */
export function useDropTargetActions() {
  const ctx = useContext(DropTargetCtx);
  return {
    setDropTarget: ctx.setDropTarget,
    clearDropTarget: ctx.clearDropTarget,
  };
}

/**
 * Standalone provider component that manages drop target state.
 * Useful for testing or when DndProvider is not used. In production,
 * DndProvider provides the DropTargetCtx directly.
 */
export function DropTargetProvider({ children }: { children: ReactNode }) {
  const [dropTarget, setDropTargetState] = useState<DropTarget | null>(null);

  const setDropTarget = useCallback((target: DropTarget | null) => {
    setDropTargetState(target);
  }, []);

  const clearDropTarget = useCallback(() => {
    setDropTargetState(null);
  }, []);

  const value = useMemo<DropTargetContextValue>(
    () => ({ dropTarget, setDropTarget, clearDropTarget }),
    [dropTarget, setDropTarget, clearDropTarget],
  );

  return (
    <DropTargetCtx.Provider value={value}>
      {children}
    </DropTargetCtx.Provider>
  );
}
