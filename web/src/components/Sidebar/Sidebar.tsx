import { useState } from 'react';
import { ModeSelector } from './ModeSelector';
import { WorkspaceList } from './WorkspaceList';
import { ProjectList } from './ProjectList';
import { AppRegistry } from './AppRegistry';
import type { Project, AppEntry } from '../../types';

interface SidebarProps {
  onSelectMode: (mode: string) => void;
  onSelectWorkspace: (mode: string, workspace: string) => void;
  onSelectProject: (project: Project) => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onSelectApp: (bundleId: string, app: AppEntry) => void;
}

export function Sidebar({
  onSelectMode,
  onSelectWorkspace,
  onSelectProject,
  onAddProject,
  onEditProject,
  onSelectApp,
}: SidebarProps) {
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);

  const handleSelectMode = (mode: string) => {
    setSelectedMode(mode);
    setSelectedWorkspace(null);
    onSelectMode(mode);
  };

  const handleSelectWorkspace = (workspace: string) => {
    setSelectedWorkspace(workspace);
    if (selectedMode) {
      onSelectWorkspace(selectedMode, workspace);
    }
  };

  return (
    <aside className="w-[280px] flex-shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <ModeSelector
          selectedMode={selectedMode}
          onSelectMode={handleSelectMode}
        />

        <div className="border-t border-gray-800 pt-2">
          <WorkspaceList
            selectedMode={selectedMode}
            selectedWorkspace={selectedWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
          />
        </div>

        <div className="border-t border-gray-800 pt-2">
          <ProjectList
            onSelectProject={onSelectProject}
            onAddProject={onAddProject}
            onEditProject={onEditProject}
          />
        </div>

        <div className="border-t border-gray-800 pt-2">
          <AppRegistry onSelectApp={onSelectApp} />
        </div>
      </div>
    </aside>
  );
}
