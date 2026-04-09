import { useState, useEffect, useCallback } from 'react';

export interface ToastMessage {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
}

// Global toast state — simple pub/sub pattern
type Listener = (toasts: ToastMessage[]) => void;
let toasts: ToastMessage[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  for (const listener of listeners) {
    listener([...toasts]);
  }
}

export function addToast(type: ToastMessage['type'], message: string, durationMs = 5000) {
  const id = `toast-${nextId++}`;
  toasts = [...toasts, { id, type, message }];
  notify();

  if (durationMs > 0) {
    setTimeout(() => {
      removeToast(id);
    }, durationMs);
  }
}

export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/** Hook to subscribe to toast state. */
function useToasts(): ToastMessage[] {
  const [current, setCurrent] = useState<ToastMessage[]>(toasts);

  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  return current;
}

/** Toast container — renders at the top-right of the screen. */
export function ToastContainer() {
  const currentToasts = useToasts();

  const handleDismiss = useCallback((id: string) => {
    removeToast(id);
  }, []);

  if (currentToasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {currentToasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg px-4 py-3 text-sm shadow-lg flex items-start gap-3 animate-in slide-in-from-right ${
            toast.type === 'error'
              ? 'bg-red-900/90 text-red-100 border border-red-700'
              : toast.type === 'success'
                ? 'bg-green-900/90 text-green-100 border border-green-700'
                : 'bg-gray-800/90 text-gray-100 border border-gray-700'
          }`}
          role="alert"
        >
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => handleDismiss(toast.id)}
            className="flex-shrink-0 text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
