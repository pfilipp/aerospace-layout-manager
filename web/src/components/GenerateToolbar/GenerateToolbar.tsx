/**
 * GenerateToolbar — toolbar component for triggering layout generation.
 *
 * Provides:
 * - "Generate All" button that calls useGenerate()
 * - Per-mode generation dropdown using useGenerateMode()
 * - Success toast showing list of generated file paths
 * - Error display for generation failures
 * - Loading spinner during generation
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGenerate, useGenerateMode, useModes } from '../../api/hooks';
import { addToast } from '../Toast';

export function GenerateToolbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: modes } = useModes();
  const generateAll = useGenerate();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const handleGenerateAll = useCallback(() => {
    generateAll.mutate(undefined, {
      onSuccess: (data) => {
        const files = data.generatedFiles ?? [];
        const count = files.length;
        const fileList = files.length > 5
          ? files.slice(0, 5).join('\n') + `\n... and ${files.length - 5} more`
          : files.join('\n');
        addToast(
          'success',
          `Generated ${count} file${count !== 1 ? 's' : ''}${count > 0 ? ':\n' + fileList : ''}`,
          8000,
        );
      },
      onError: (err) => {
        addToast('error', `Generation failed: ${err.message}`);
      },
    });
  }, [generateAll]);

  const isGenerating = generateAll.isPending;

  return (
    <div className="flex items-center gap-2" ref={dropdownRef}>
      {/* Generate All button */}
      <button
        onClick={handleGenerateAll}
        disabled={isGenerating}
        className="px-3 py-1.5 text-sm rounded bg-green-700 text-green-100 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isGenerating && <LoadingSpinner />}
        Generate All
      </button>

      {/* Per-mode dropdown */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          disabled={isGenerating}
          className="px-2 py-1.5 text-sm rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Generate per mode"
          aria-expanded={dropdownOpen}
        >
          <ChevronDownIcon />
        </button>

        {dropdownOpen && modes && modes.length > 0 && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded border border-gray-700 bg-gray-800 shadow-lg z-50">
            <div className="py-1">
              {modes.map((mode) => (
                <PerModeButton
                  key={mode.name}
                  modeName={mode.name}
                  onClose={() => setDropdownOpen(false)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Individual per-mode generate button inside the dropdown. */
function PerModeButton({ modeName, onClose }: { modeName: string; onClose: () => void }) {
  const generateMode = useGenerateMode(modeName);

  const handleClick = useCallback(() => {
    onClose();
    generateMode.mutate(undefined, {
      onSuccess: (data) => {
        const files = data.generatedFiles ?? [];
        const count = files.length;
        addToast(
          'success',
          `Generated ${count} file${count !== 1 ? 's' : ''} for "${modeName}"`,
          6000,
        );
      },
      onError: (err) => {
        addToast('error', `Generation failed for "${modeName}": ${err.message}`);
      },
    });
  }, [generateMode, modeName, onClose]);

  return (
    <button
      onClick={handleClick}
      disabled={generateMode.isPending}
      className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
    >
      {generateMode.isPending && <LoadingSpinner />}
      Generate "{modeName}"
    </button>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
