import type { SourceInfo } from "../types";

interface SidebarProps {
  sources: SourceInfo[];
  selectedSource: string | null;
  onSelectSource: (name: string | null) => void;
  projects: Record<string, string[]>;
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
}

export default function Sidebar({
  sources,
  selectedSource,
  onSelectSource,
  projects,
  selectedProject,
  onSelectProject,
}: SidebarProps) {
  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white tracking-tight">
          CCHistory
        </h1>
        <p className="text-xs text-gray-500 mt-1">Universal History Browser</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
          Sources
        </div>
        <button
          onClick={() => {
            onSelectSource(null);
            onSelectProject(null);
          }}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            !selectedSource
              ? "bg-violet-600/20 text-violet-300"
              : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          }`}
        >
          All Sources
        </button>
        {sources.map((src) => (
          <button
            key={src.name}
            onClick={() => {
              onSelectSource(src.name);
              onSelectProject(null);
            }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex justify-between items-center ${
              selectedSource === src.name
                ? "bg-violet-600/20 text-violet-300"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            <span>{src.name}</span>
            {src.entry_count != null && (
              <span className="text-xs text-gray-600">{src.entry_count}</span>
            )}
          </button>
        ))}

        {Object.keys(projects).length > 0 && (
          <>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mt-4 mb-2">
              Projects
            </div>
            <button
              onClick={() => onSelectProject(null)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                !selectedProject
                  ? "text-gray-300"
                  : "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
              }`}
            >
              All Projects
            </button>
            {Object.entries(projects).flatMap(([, projs]) =>
              projs.map((proj) => (
                <button
                  key={proj}
                  onClick={() => onSelectProject(proj)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                    selectedProject === proj
                      ? "bg-violet-600/20 text-violet-300"
                      : "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  }`}
                  title={proj}
                >
                  {proj.split("/").pop()}
                </button>
              ))
            )}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-gray-800 text-xs text-gray-600">
        v0.1.0
      </div>
    </aside>
  );
}
