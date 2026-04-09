import { useEffect, useRef } from 'react';

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
  /** Whether this action is disabled */
  disabled?: boolean;
  /** Optional separator before this item */
  separator?: boolean;
  /** Keyboard shortcut hint to display */
  shortcut?: string;
}

interface ContextMenuProps {
  /** Screen x coordinate */
  x: number;
  /** Screen y coordinate */
  y: number;
  /** Available actions */
  actions: ContextMenuAction[];
  /** Called when the menu should close */
  onClose: () => void;
}

/**
 * Right-click context menu for tree nodes.
 * Renders a floating menu at the specified position with actions
 * like Delete, Duplicate, and Wrap in Container.
 */
export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout to avoid the click that opened the menu from closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    if (x > maxX) {
      menuRef.current.style.left = `${maxX}px`;
    }
    if (y > maxY) {
      menuRef.current.style.top = `${maxY}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl shadow-black/50 py-1 overflow-hidden"
      style={{ left: x, top: y }}
    >
      {actions.map((action, index) => (
        <div key={action.label}>
          {action.separator && index > 0 && (
            <div className="my-1 border-t border-gray-700" />
          )}
          <button
            type="button"
            onClick={() => {
              if (!action.disabled) {
                action.onClick();
                onClose();
              }
            }}
            disabled={action.disabled}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-4 transition-colors ${
              action.disabled
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>{action.label}</span>
            {action.shortcut && (
              <span className="text-[10px] text-gray-500">{action.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
