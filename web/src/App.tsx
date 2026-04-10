import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode, AppEntry, ContainerNode, LayoutType, Project } from './types';
import { Sidebar } from './components/Sidebar';
import { TreeEditor } from './components/LayoutTree';
import { PropertiesPanel } from './components/PropertiesPanel';
import { GenerateToolbar, StaleIndicator } from './components/GenerateToolbar';
import { MigrationDialog } from './components/MigrationDialog';
import { ProjectDialog } from './components/ProjectDialog';
import { ToastContainer, addToast } from './components/Toast';
import { useEditorStore, useKeyboardShortcuts, pushUndo, findNodeById, findParent, getNodeId, stripNodeIds } from './store';
import { flattenTree } from './components/LayoutTree/FlatSortable/flattenTree';
import { useWorkspace, useApps, useModes, useOptimisticWorkspaceUpdate, useConfig } from './api/hooks';

function App() {
  // Register global keyboard shortcuts (undo/redo, delete)
  useKeyboardShortcuts();

  // Project dialog state: null = closed, undefined = create new, Project = edit
  const [projectDialogState, setProjectDialogState] = useState<Project | null | undefined>(null);

  // Track whether config has been modified since last generation
  useConfig();
  // configModified tracks whether the user has made any mutations in this session
  // that would make the generated files stale
  const configModifiedRef = useRef(false);

  // Zustand store state
  const tree = useEditorStore((s) => s.tree);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const activeWorkspace = useEditorStore((s) => s.activeWorkspace);
  const activeMode = useEditorStore((s) => s.activeMode);
  const selectNode = useEditorStore((s) => s.selectNode);
  const updateNode = useEditorStore((s) => s.updateNode);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setActiveWorkspace = useEditorStore((s) => s.setActiveWorkspace);

  // Check if config has modes defined (for migration button prominence)
  const { data: modes } = useModes();
  const hasNoModes = modes !== undefined && modes.length === 0;

  // Fetch apps for the properties panel
  const { data: apps } = useApps();

  // Fetch workspace data when mode+workspace are selected
  const { data: workspaceData } = useWorkspace(activeMode, activeWorkspace);

  // Optimistic update mutation for saving workspace tree edits
  const saveWorkspace = useOptimisticWorkspaceUpdate(
    activeMode ?? '',
    activeWorkspace ?? '',
  );

  // Auto-save tree changes to backend (covers addNode, deleteNode, etc.)
  const prevTreeRef = useRef<ContainerNode | null>(null);
  useEffect(() => {
    // Skip the initial load and workspace switches (handled by loadedWorkspaceRef)
    if (!tree || !activeMode || !activeWorkspace) {
      prevTreeRef.current = tree;
      return;
    }
    // Skip if this is the first load of a workspace
    if (prevTreeRef.current === null) {
      prevTreeRef.current = tree;
      return;
    }
    // Skip if tree reference hasn't changed
    if (tree === prevTreeRef.current) return;
    prevTreeRef.current = tree;

    configModifiedRef.current = true;
    const cleanTree = stripNodeIds(tree) as ContainerNode;
    saveWorkspace.mutate(
      { layout: cleanTree },
      {
        onError: (err) => {
          addToast('error', `Failed to save layout: ${err.message}`);
        },
      },
    );
  }, [tree, activeMode, activeWorkspace, saveWorkspace]);

  // Resolve the selected TreeNode for the properties panel
  const selectedNode: TreeNode | null =
    tree && selectedNodeId ? findNodeById(tree, selectedNodeId) : null;

  // Find the parent container's layout type for normalization constraints
  const selectedParentLayout: LayoutType | null = useMemo(() => {
    if (!tree || !selectedNodeId) return null;
    // If the selected node IS the root, it has no parent
    if (getNodeId(tree) === selectedNodeId) return null;
    const parentInfo = findParent(tree, selectedNodeId);
    if (!parentInfo) return null;
    return parentInfo.parent.layout;
  }, [tree, selectedNodeId]);

  const handleLayoutChange = useCallback(
    (newLayout: ContainerNode) => {
      const { tree: currentTree, undoStack } = useEditorStore.getState();
      if (currentTree) {
        const stacks = pushUndo(currentTree, undoStack);
        useEditorStore.setState({ tree: newLayout, ...stacks });
      }
      // Save is handled by the tree useEffect above
    },
    [],
  );

  const handleSelectNode = useCallback(
    (id: string | null) => {
      if (!id || !tree) {
        selectNode(null);
        return;
      }
      // The tree editor passes flat path IDs (e.g. "root/w-0").
      // Resolve to the store's _nodeId by finding the FlatNode and reading its node's _nodeId.
      const collapsedIds = useEditorStore.getState().collapsedIds;
      const flatNodes = flattenTree(tree, collapsedIds);
      const flatNode = flatNodes.find((fn) => fn.id === id);
      if (flatNode) {
        const storeId = getNodeId(flatNode.node);
        selectNode(storeId ?? id);
      } else {
        selectNode(id);
      }
    },
    [selectNode, tree],
  );

  const handleNodeUpdate = useCallback(
    (updatedNode: TreeNode) => {
      if (!selectedNodeId) return;
      updateNode(selectedNodeId, updatedNode);
      // Save is handled by the tree useEffect above
    },
    [selectedNodeId, updateNode],
  );

  // Track which workspace's data is currently loaded in the editor
  const loadedWorkspaceRef = useRef<string | null>(null);

  const handleSelectMode = useCallback((mode: string) => {
    loadedWorkspaceRef.current = null;
    useEditorStore.setState({
      activeMode: mode,
      activeWorkspace: null,
      tree: null,
      selectedNodeId: null,
    });
  }, []);

  const handleSelectWorkspace = useCallback(
    (mode: string, workspace: string) => {
      // Store the mode+workspace selection; the useWorkspace query will fetch data
      useEditorStore.setState({ activeMode: mode, activeWorkspace: workspace });
    },
    [],
  );

  // Sync workspace data from API into the editor store
  // Load whenever workspace data arrives for a different workspace than what's loaded
  const workspaceKey = activeMode && activeWorkspace ? `${activeMode}/${activeWorkspace}` : null;

  if (
    workspaceData &&
    workspaceData.layout &&
    activeMode &&
    activeWorkspace &&
    workspaceKey !== loadedWorkspaceRef.current
  ) {
    loadedWorkspaceRef.current = workspaceKey;
    setActiveWorkspace(activeMode, activeWorkspace, workspaceData.layout);
  }

  const handleSelectProject = useCallback((project: Project) => {
    console.log('Selected project:', project.name);
  }, []);

  const handleAddProject = useCallback(() => {
    setProjectDialogState(undefined); // undefined = create new
  }, []);

  const handleEditProject = useCallback((project: Project) => {
    setProjectDialogState(project);
  }, []);

  const handleSelectApp = useCallback((bundleId: string, _app: AppEntry) => {
    console.log('Selected app:', bundleId);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <ToastContainer />
      {projectDialogState !== null && (
        <ProjectDialog
          project={projectDialogState ?? null}
          apps={apps ?? {}}
          onClose={() => setProjectDialogState(null)}
        />
      )}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AeroSpace Layout Manager</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={!canUndo()}
              className="px-3 py-1.5 text-sm rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo (Cmd+Z)"
            >
              Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo()}
              className="px-3 py-1.5 text-sm rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Redo (Cmd+Shift+Z)"
            >
              Redo
            </button>
          </div>
          <div className="w-px h-6 bg-gray-700" />
          <GenerateToolbar />
          <div className="w-px h-6 bg-gray-700" />
          <MigrationDialog prominent={false} />
        </div>
      </header>
      <main className="flex h-[calc(100vh-57px)]">
        <Sidebar
          onSelectMode={handleSelectMode}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onEditProject={handleEditProject}
          onSelectApp={handleSelectApp}
        />
        <section className="flex-1 border-r border-gray-800 flex flex-col">
          <StaleIndicator configModified={configModifiedRef.current} />
          <div className="flex-1 overflow-auto">
            {activeWorkspace && tree ? (
              <TreeEditor
                layout={tree}
                onLayoutChange={handleLayoutChange}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
              />
            ) : hasNoModes ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
                <p className="text-lg">No configuration found</p>
                <p className="text-sm text-gray-600 max-w-md text-center">
                  Import your existing AeroSpace layout files and projects to get
                  started, or create a new mode from the sidebar.
                </p>
                <MigrationDialog prominent />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Select a workspace to edit its layout</p>
              </div>
            )}
          </div>
        </section>
        <aside className="w-72 border-l border-gray-800 p-4 overflow-y-auto">
          <PropertiesPanel
            selectedNode={selectedNode}
            parentLayout={selectedParentLayout}
            onUpdate={handleNodeUpdate}
            apps={apps ?? {}}
          />
        </aside>
      </main>
    </div>
  );
}

export default App;
