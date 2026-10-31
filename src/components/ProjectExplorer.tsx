import { useState } from 'react';
import { listDirectory } from '../services/tauri/client';
import type { FileEntry } from '../types/app';

interface ExplorerProps {
  entries: FileEntry[];
  selectedPath: string;
  onOpenFile: (path: string) => void | Promise<void>;
}

interface NodeProps extends Pick<ExplorerProps, 'selectedPath' | 'onOpenFile'> {
  entry: FileEntry;
  depth: number;
}

const MAX_DEPTH = 24;

function EntryNode({ entry, depth, selectedPath, onOpenFile }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggleFolder() {
    if (loading || !entry.is_dir || depth >= MAX_DEPTH) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children !== null) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      // The Tauri backend canonicalizes every folder against the configured
      // workspace root. The UI never recursively scans entire workspaces.
      const result = await listDirectory(entry.path);
      setChildren(result);
      setExpanded(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }

  const folder = entry.is_dir;
  const disabled = folder && (loading || depth >= MAX_DEPTH);
  return (
    <li role="treeitem" aria-expanded={folder ? expanded : undefined} aria-selected={!folder && selectedPath === entry.path}>
      <button
        type="button"
        className="explorer-entry"
        style={{ paddingInlineStart: `${8 + depth * 13}px` }}
        onClick={() => { if (folder) void toggleFolder(); else void onOpenFile(entry.path); }}
        disabled={disabled}
        aria-label={folder ? `${expanded ? 'Collapse' : 'Expand'} folder ${entry.name}` : `Open file ${entry.name}`}
        title={entry.path}
      >
        <span className="explorer-marker" aria-hidden="true">
          {folder ? loading ? '…' : expanded ? '▾' : '▸' : '·'}
        </span>
        <span className="explorer-filename">{entry.name}</span>
      </button>
      {error && <p className="explorer-error" role="alert">{error}</p>}
      {folder && expanded && children !== null && (
        <ul role="group" className="explorer-children">
          {children.length ? children.map((item) => (
            <EntryNode key={item.path} entry={item} depth={depth + 1}
              selectedPath={selectedPath} onOpenFile={onOpenFile} />
          )) : <li className="explorer-empty" role="none">Empty folder</li>}
        </ul>
      )}
    </li>
  );
}

/** Lazy workspace tree; folders remain interactive and source files open in Monaco. */
export default function ProjectExplorer({ entries, selectedPath, onOpenFile }: ExplorerProps) {
  return (
    <ul className="file-tree" role="tree" aria-label="Workspace files">
      {entries.map((entry) => (
        <EntryNode key={entry.path} entry={entry} depth={0}
          selectedPath={selectedPath} onOpenFile={onOpenFile} />
      ))}
      {entries.length === 0 && <li className="explorer-empty" role="none">No files loaded</li>}
    </ul>
  );
}
