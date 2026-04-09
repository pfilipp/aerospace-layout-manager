import { useProjects, useDeleteProject } from '../../api/hooks';
import { addToast } from '../Toast';
import type { Project } from '../../types';

interface ProjectListProps {
  onSelectProject: (project: Project) => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
}

export function ProjectList({
  onSelectProject,
  onAddProject,
  onEditProject,
}: ProjectListProps) {
  const { data: projects, isLoading, error } = useProjects();
  const deleteProjectMutation = useDeleteProject();

  const handleDelete = (name: string) => {
    deleteProjectMutation.mutate(name, {
      onError: (err) => {
        addToast('error', `Failed to delete project: ${err.message}`);
      },
    });
  };

  const projectList = projects ? Object.values(projects) : [];

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Projects
        </h3>
        <button
          type="button"
          onClick={onAddProject}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          title="Add project"
        >
          + Add
        </button>
      </div>

      {isLoading && (
        <div className="space-y-1">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">Failed to load projects</p>
      )}

      {!isLoading && !error && projectList.length === 0 && (
        <p className="text-xs text-gray-500">No projects defined</p>
      )}

      {!isLoading && !error && (
        <ul className="space-y-0.5">
          {projectList.map((project) => (
            <li key={project.name} className="group">
              <button
                type="button"
                onClick={() => onSelectProject(project)}
                className="w-full text-left px-3 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2 transition-colors"
              >
                <span className="truncate flex-1">{project.name}</span>
                <span className="text-[10px] text-gray-500 truncate max-w-[80px]">
                  {project.dir.replace(/^~\/Projects\//, '')}
                </span>
                <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditProject(project);
                    }}
                    className="text-[10px] text-gray-500 hover:text-gray-300"
                    title="Edit project"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project.name);
                    }}
                    className="text-[10px] text-red-500 hover:text-red-400"
                    title="Delete project"
                  >
                    del
                  </button>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
