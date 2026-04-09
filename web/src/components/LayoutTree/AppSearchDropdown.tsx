import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppEntry } from '../../types';
import { useApps } from '../../api/hooks';

interface AppSearchDropdownProps {
  /** Called when an app is selected from the dropdown */
  onSelect: (bundleId: string, app: AppEntry) => void;
  /** Called when the dropdown is dismissed without selection */
  onClose: () => void;
}

/**
 * Searchable dropdown for selecting an app from the registry.
 * Uses TanStack Query to fetch apps (shared cache with sidebar AppRegistry).
 * Used by the "+ Add app" button in TreeActions.
 */
export function AppSearchDropdown({ onSelect, onClose }: AppSearchDropdownProps) {
  const { data: apps = {}, isLoading } = useApps();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelect = useCallback(
    (bundleId: string, app: AppEntry) => {
      onSelect(bundleId, app);
      onClose();
    },
    [onSelect, onClose],
  );

  const searchLower = search.toLowerCase();
  const filteredEntries = Object.entries(apps)
    .filter(
      ([bundleId, app]) =>
        app.name.toLowerCase().includes(searchLower) ||
        bundleId.toLowerCase().includes(searchLower),
    )
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  return (
    <div
      ref={containerRef}
      className="absolute z-50 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden"
    >
      <div className="p-2 border-b border-gray-700">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search apps..."
          className="w-full px-2 py-1.5 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="max-h-48 overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
        )}

        {!isLoading && filteredEntries.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-500">
            {search ? 'No apps match' : 'No apps in registry'}
          </div>
        )}

        {!isLoading &&
          filteredEntries.map(([bundleId, app]) => (
            <button
              key={bundleId}
              type="button"
              onClick={() => handleSelect(bundleId, app)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
              title={bundleId}
            >
              <span className="text-blue-400 flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 2v8h10V5H3z" />
                </svg>
              </span>
              <span className="truncate flex-1">{app.name}</span>
              <span className="text-[10px] text-gray-500 truncate max-w-[120px]">
                {bundleId}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
