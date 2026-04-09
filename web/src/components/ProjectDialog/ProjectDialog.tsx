import { useState, useEffect } from 'react';
import type { Project, AppEntry } from '../../types';
import { useSaveProject } from '../../api/hooks';
import { addToast } from '../Toast';

interface ProjectDialogProps {
  /** Existing project to edit, or null for create */
  project: Project | null;
  apps: Record<string, AppEntry>;
  onClose: () => void;
}

const EMPTY_PROJECT: Project = {
  name: '',
  dir: '',
  subdir: '',
  iterm_cmd: '',
  xcodeproj: '',
  apps: [],
};

export function ProjectDialog({ project, apps, onClose }: ProjectDialogProps) {
  const [form, setForm] = useState<Project>(project ?? EMPTY_PROJECT);
  const isEdit = project !== null;
  const saveProject = useSaveProject();

  // Reset form when project prop changes
  useEffect(() => {
    setForm(project ?? EMPTY_PROJECT);
  }, [project]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!form.dir.trim()) return;

    saveProject.mutate(form, {
      onSuccess: () => {
        addToast('success', `Project "${form.name}" ${isEdit ? 'updated' : 'created'}`);
        onClose();
      },
      onError: (err) => {
        addToast('error', `Failed to save project: ${err.message}`);
      },
    });
  };

  const toggleApp = (bundleId: string) => {
    setForm((prev) => ({
      ...prev,
      apps: prev.apps.includes(bundleId)
        ? prev.apps.filter((id) => id !== bundleId)
        : [...prev.apps, bundleId],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">
          {isEdit ? `Edit Project: ${project.name}` : 'New Project'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="proj-name" className="block text-sm font-medium text-gray-400">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              id="proj-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              disabled={isEdit}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              placeholder="my-project"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="proj-dir" className="block text-sm font-medium text-gray-400">
              Directory <span className="text-red-400">*</span>
            </label>
            <input
              id="proj-dir"
              type="text"
              value={form.dir}
              onChange={(e) => setForm((p) => ({ ...p, dir: e.target.value }))}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none"
              placeholder="~/Projects/my-project"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="proj-subdir" className="block text-sm font-medium text-gray-400">
                Subdirectory
              </label>
              <input
                id="proj-subdir"
                type="text"
                value={form.subdir}
                onChange={(e) => setForm((p) => ({ ...p, subdir: e.target.value }))}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="proj-iterm" className="block text-sm font-medium text-gray-400">
                iTerm Command
              </label>
              <input
                id="proj-iterm"
                type="text"
                value={form.iterm_cmd}
                onChange={(e) => setForm((p) => ({ ...p, iterm_cmd: e.target.value }))}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none"
                placeholder="tmux-myproject"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="proj-xcode" className="block text-sm font-medium text-gray-400">
              Xcode Project
            </label>
            <input
              id="proj-xcode"
              type="text"
              value={form.xcodeproj}
              onChange={(e) => setForm((p) => ({ ...p, xcodeproj: e.target.value }))}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none"
              placeholder="MyApp.xcodeproj"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-gray-400">Apps</span>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
              {Object.entries(apps).map(([bundleId, app]) => (
                <label
                  key={bundleId}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={form.apps.includes(bundleId)}
                    onChange={() => toggleApp(bundleId)}
                    className="rounded border-gray-600"
                  />
                  <span className="text-gray-200">{app.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || !form.dir.trim() || saveProject.isPending}
              className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saveProject.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
