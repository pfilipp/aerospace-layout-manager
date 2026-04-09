/**
 * StaleIndicator — warning banner displayed when configuration has changed
 * since the last successful generation.
 *
 * Uses useConfig() to read lastGeneratedAt from config.json.
 * Shows the banner when:
 * - lastGeneratedAt is null (never generated)
 * - config has been modified since lastGeneratedAt
 *
 * The banner dismisses automatically when generation completes
 * (because useConfig() refetches after generation invalidates the query).
 */

import { useConfig } from '../../api/hooks';

interface StaleIndicatorProps {
  /** Whether config has been modified in the current session (tracked by parent). */
  configModified?: boolean;
}

export function StaleIndicator({ configModified }: StaleIndicatorProps) {
  const { data: config } = useConfig();

  if (!config) return null;

  const { lastGeneratedAt } = config;

  // Show banner if never generated, or if config has been modified since last generation
  const isStale = !lastGeneratedAt || configModified;

  if (!isStale) return null;

  return (
    <div
      className="bg-amber-900/60 border border-amber-700 text-amber-200 px-4 py-2.5 text-sm flex items-center gap-3"
      role="alert"
    >
      <WarningIcon />
      <span>
        {!lastGeneratedAt
          ? 'Layout files have never been generated. Click Generate to create layout files.'
          : 'Configuration has changed since last generation. Click Generate to update layout files.'}
      </span>
    </div>
  );
}

function WarningIcon() {
  return (
    <svg
      className="h-5 w-5 flex-shrink-0 text-amber-400"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}
