import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import {
  useApplyProject,
  type ApplyProjectChange,
  type ApplyProjectResponse,
} from '../../api/hooks';
import { addToast } from '../Toast';

interface ApplyProjectDialogProps {
  project: Project;
  modeName: string;
  wsName: string;
  onClose: () => void;
}

export function ApplyProjectDialog({
  project,
  modeName,
  wsName,
  onClose,
}: ApplyProjectDialogProps) {
  const applyMutation = useApplyProject(modeName, wsName);
  const [preview, setPreview] = useState<ApplyProjectResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Fetch preview on mount.
  useEffect(() => {
    let cancelled = false;
    applyMutation
      .mutateAsync({ projectName: project.name })
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setPreviewError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.name, modeName, wsName]);

  const handleApply = async () => {
    setApplying(true);
    try {
      await applyMutation.mutateAsync({
        projectName: project.name,
        confirm: true,
      });
      addToast('success', `Applied project "${project.name}" to ${wsName}`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addToast('error', `Failed to apply project: ${message}`);
      setApplying(false);
    }
  };

  const changes = preview?.changes ?? [];
  const hasChanges = changes.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <header className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-gray-100">
            Apply project{' '}
            <span className="text-blue-400">{project.name}</span> to workspace{' '}
            <span className="text-blue-400">{wsName}</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Mode: {modeName} · Directory: {project.dir}
            {project.subdir ? `/${project.subdir}` : ''}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {previewError && (
            <p className="text-sm text-red-400">
              Failed to load preview: {previewError}
            </p>
          )}

          {!preview && !previewError && (
            <p className="text-sm text-gray-500">Computing preview…</p>
          )}

          {preview && !hasChanges && (
            <p className="text-sm text-gray-400">
              No windows in this workspace match this project's apps
              {project.apps.length > 0 && <> ({project.apps.join(', ')})</>}.
              Assign the project's apps to windows in this workspace first, or
              edit the project's app list.
            </p>
          )}

          {hasChanges && (
            <ul className="space-y-3">
              {changes.map((change, index) => (
                <ChangeRow key={`${change['window-id']}-${index}`} change={change} />
              ))}
            </ul>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-gray-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasChanges || applying || !!previewError}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: ApplyProjectChange }) {
  const unchanged = change.oldStartup === change.newStartup;
  return (
    <li className="rounded border border-gray-800 bg-gray-950/40 p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-100">{change['app-name']}</span>
        <span className="text-gray-500 font-mono">{change['app-bundle-id']}</span>
        {change.incomplete && (
          <span
            className="ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400"
            title="Project has an unset field referenced by this template"
          >
            incomplete
          </span>
        )}
        {unchanged && (
          <span className="ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
            no change
          </span>
        )}
      </div>
      <div className="space-y-1 font-mono">
        <div className="flex gap-2">
          <span className="text-red-400 w-6 flex-shrink-0">-</span>
          <span className="text-gray-400 break-all whitespace-pre-wrap">
            {change.oldStartup || <em className="text-gray-600">(empty)</em>}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-green-400 w-6 flex-shrink-0">+</span>
          <span className="text-gray-200 break-all whitespace-pre-wrap">
            {change.newStartup || <em className="text-gray-600">(empty)</em>}
          </span>
        </div>
      </div>
    </li>
  );
}
