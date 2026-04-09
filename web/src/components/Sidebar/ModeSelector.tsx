import { useEffect } from 'react';
import { useModes } from '../../api/hooks';

interface ModeSelectorProps {
  selectedMode: string | null;
  onSelectMode: (mode: string) => void;
}

export function ModeSelector({ selectedMode, onSelectMode }: ModeSelectorProps) {
  const { data: modes, isLoading, error } = useModes();

  // Auto-select first mode if none selected
  useEffect(() => {
    if (!selectedMode && modes && modes.length > 0) {
      onSelectMode(modes[0].name);
    }
  }, [modes, selectedMode, onSelectMode]);

  if (isLoading) {
    return (
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
          Mode
        </label>
        <div className="h-9 bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
          Mode
        </label>
        <p className="text-xs text-red-400">Failed to load modes</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label
        htmlFor="mode-selector"
        className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1"
      >
        Mode
      </label>
      <select
        id="mode-selector"
        value={selectedMode ?? ''}
        onChange={(e) => onSelectMode(e.target.value)}
        className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      >
        {(modes ?? []).map((mode) => (
          <option key={mode.name} value={mode.name}>
            {mode.name}
            {mode.inherits ? ` (inherits ${mode.inherits})` : ''}
            {` — ${mode.workspaceCount} workspaces`}
          </option>
        ))}
      </select>
    </div>
  );
}
