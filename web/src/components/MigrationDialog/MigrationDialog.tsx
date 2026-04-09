/**
 * MigrationDialog — modal dialog for importing existing AeroSpace layout
 * configurations into the web app's config.json.
 *
 * Two-step flow:
 * 1. Preview: fetches GET /api/migrate/preview and shows a summary
 * 2. Execute: calls POST /api/migrate on confirmation
 *
 * Shows a prominent "Import Existing Configuration" button when no
 * modes/data exist (first-run), and an accessible toolbar button otherwise.
 */

import { useState, useCallback } from 'react';
import {
  useMigrationPreview,
  useMigrate,
  type MigrationPreviewResponse,
  type MigrationResultResponse,
} from '../../api/hooks';
import { addToast } from '../Toast';

type DialogStep = 'closed' | 'loading-preview' | 'preview' | 'migrating' | 'complete';

export function MigrationDialog({ prominent = false }: { prominent?: boolean }) {
  const [step, setStep] = useState<DialogStep>('closed');
  const [previewEnabled, setPreviewEnabled] = useState(false);

  const {
    data: preview,
    isLoading: previewLoading,
    error: previewError,
    refetch: refetchPreview,
  } = useMigrationPreview(previewEnabled);

  const migrate = useMigrate();
  const [migrationResult, setMigrationResult] = useState<MigrationResultResponse | null>(null);

  const handleOpen = useCallback(() => {
    setStep('loading-preview');
    setPreviewEnabled(true);
    setMigrationResult(null);
    refetchPreview();
  }, [refetchPreview]);

  // Transition from loading to preview once data arrives
  if (step === 'loading-preview' && preview && !previewLoading) {
    setStep('preview');
  }
  if (step === 'loading-preview' && previewError && !previewLoading) {
    setStep('closed');
    setPreviewEnabled(false);
    addToast('error', `Failed to load migration preview: ${previewError.message}`);
  }

  const handleClose = useCallback(() => {
    setStep('closed');
    setPreviewEnabled(false);
    setMigrationResult(null);
  }, []);

  const handleConfirm = useCallback(() => {
    setStep('migrating');
    migrate.mutate(undefined, {
      onSuccess: (data) => {
        setMigrationResult(data);
        setStep('complete');
        addToast('success', 'Configuration imported successfully');
      },
      onError: (err) => {
        setStep('preview');
        addToast('error', `Migration failed: ${err.message}`);
      },
    });
  }, [migrate]);

  // --- Trigger button ---
  const triggerButton = prominent ? (
    <button
      type="button"
      onClick={handleOpen}
      className="px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold text-base hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/20"
    >
      Import Existing Configuration
    </button>
  ) : (
    <button
      type="button"
      onClick={handleOpen}
      className="px-3 py-1.5 text-sm rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
      title="Import existing AeroSpace layout configuration"
    >
      Import Config
    </button>
  );

  if (step === 'closed') {
    return triggerButton;
  }

  // --- Modal overlay ---
  return (
    <>
      {/* Keep trigger in place for layout stability */}
      {triggerButton}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div
          className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-800">
            <h2
              id="migration-dialog-title"
              className="text-lg font-semibold text-gray-100"
            >
              {step === 'complete'
                ? 'Import Complete'
                : 'Import Existing Configuration'}
            </h2>
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            {step === 'loading-preview' && (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <svg
                  className="animate-spin h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>Scanning existing configuration...</span>
              </div>
            )}

            {step === 'preview' && preview && (
              <PreviewContent preview={preview} />
            )}

            {step === 'migrating' && (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <svg
                  className="animate-spin h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
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
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>Importing configuration...</span>
              </div>
            )}

            {step === 'complete' && migrationResult && (
              <CompleteContent result={migrationResult} />
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
            {step === 'preview' && (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="px-4 py-2 text-sm rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors"
                >
                  Import
                </button>
              </>
            )}

            {step === 'complete' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors"
              >
                Done
              </button>
            )}

            {(step === 'loading-preview' || step === 'migrating') && (
              <button
                type="button"
                disabled
                className="px-4 py-2 text-sm rounded border border-gray-700 bg-gray-800 text-gray-500 cursor-not-allowed"
              >
                Please wait...
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Sub-components ---

function PreviewContent({ preview }: { preview: MigrationPreviewResponse }) {
  const totalWorkspaces = preview.modes.reduce(
    (sum, m) => sum + m.workspaceCount,
    0,
  );

  return (
    <div className="space-y-4">
      {preview.existingConfigHasData && (
        <div className="rounded-lg bg-yellow-900/30 border border-yellow-700/50 px-4 py-3 text-sm text-yellow-200">
          Your current configuration already has data. Existing entries will
          not be overwritten -- only new items will be added.
        </div>
      )}

      <p className="text-sm text-gray-300">
        The following data was found in your existing AeroSpace configuration:
      </p>

      {/* Modes summary */}
      <div>
        <h3 className="text-sm font-medium text-gray-200 mb-2">
          Modes ({preview.modes.length})
        </h3>
        {preview.modes.length === 0 ? (
          <p className="text-xs text-gray-500 ml-2">No layout files found</p>
        ) : (
          <ul className="space-y-2 ml-2">
            {preview.modes.map((mode) => (
              <li key={mode.name}>
                <div className="text-sm text-gray-300">
                  <span className="font-medium text-gray-100">{mode.name}</span>
                  <span className="text-gray-500 ml-1">
                    -- {mode.workspaceCount} workspace
                    {mode.workspaceCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {mode.workspaces.map((ws) => (
                    <span
                      key={ws}
                      className="px-2 py-0.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300"
                    >
                      {ws}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Projects summary */}
      <div>
        <h3 className="text-sm font-medium text-gray-200 mb-2">
          Projects ({preview.projectCount})
        </h3>
        {preview.projectCount === 0 ? (
          <p className="text-xs text-gray-500 ml-2">No projects.json found</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 ml-2">
            {preview.projects.map((name) => (
              <span
                key={name}
                className="px-2 py-0.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary line */}
      <p className="text-sm text-gray-400 pt-2 border-t border-gray-800">
        This will import {preview.modes.length} mode
        {preview.modes.length !== 1 ? 's' : ''},{' '}
        {totalWorkspaces} workspace{totalWorkspaces !== 1 ? 's' : ''}, and{' '}
        {preview.projectCount} project{preview.projectCount !== 1 ? 's' : ''}.
      </p>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-yellow-300 mb-2">
            Warnings ({preview.warnings.length})
          </h3>
          <ul className="space-y-1 ml-2 max-h-32 overflow-y-auto">
            {preview.warnings.map((w, i) => (
              <li key={i} className="text-xs text-yellow-200/70">
                <span className="text-yellow-400/60">{w.file}:</span>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CompleteContent({ result }: { result: MigrationResultResponse }) {
  const totalWorkspaces = Object.values(result.workspacesImported).reduce(
    (sum, wsNames) => sum + wsNames.length,
    0,
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-green-900/30 border border-green-700/50 px-4 py-3">
        <p className="text-sm text-green-200">
          Successfully imported configuration:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-green-300">
          <li>
            {result.modesCreated.length} mode{result.modesCreated.length !== 1 ? 's' : ''} created
            {result.modesCreated.length > 0 && (
              <span className="text-green-400/70">
                {' '}({result.modesCreated.join(', ')})
              </span>
            )}
          </li>
          <li>
            {totalWorkspaces} workspace{totalWorkspaces !== 1 ? 's' : ''} imported
          </li>
          <li>
            {result.projectsImported.length} project{result.projectsImported.length !== 1 ? 's' : ''} imported
            {result.projectsImported.length > 0 && (
              <span className="text-green-400/70">
                {' '}({result.projectsImported.join(', ')})
              </span>
            )}
          </li>
        </ul>
      </div>

      {result.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-yellow-300 mb-2">
            Warnings ({result.warnings.length})
          </h3>
          <ul className="space-y-1 ml-2 max-h-32 overflow-y-auto">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-yellow-200/70">
                <span className="text-yellow-400/60">{w.file}:</span>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
