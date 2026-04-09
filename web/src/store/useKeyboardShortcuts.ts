import { useEffect } from 'react';
import { useEditorStore } from './editorStore';

/**
 * Hook that registers global keyboard shortcuts for undo/redo.
 * - Cmd+Z (Mac) or Ctrl+Z (other) -> undo
 * - Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (other) -> redo
 *
 * Should be called once at the app root level.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const modKey = e.metaKey || e.ctrlKey;

      if (modKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { canUndo, undo } = useEditorStore.getState();
        if (canUndo()) {
          undo();
        }
      }

      if (modKey && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        const { canRedo, redo } = useEditorStore.getState();
        if (canRedo()) {
          redo();
        }
      }

      // Also support Ctrl+Y for redo (Windows convention)
      if (modKey && e.key === 'y' && !e.shiftKey) {
        e.preventDefault();
        const { canRedo, redo } = useEditorStore.getState();
        if (canRedo()) {
          redo();
        }
      }

      // Delete key deletes selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && !modKey && !e.shiftKey) {
        // Only handle if no input/textarea is focused
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          return;
        }

        e.preventDefault();
        const { selectedNodeId, deleteNode } = useEditorStore.getState();
        if (selectedNodeId) {
          deleteNode(selectedNodeId);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
