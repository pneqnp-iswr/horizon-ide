import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectExplorer from './ProjectExplorer';
import { listDirectory } from '../services/tauri/client';

vi.mock('../services/tauri/client', () => ({
  listDirectory: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectExplorer', () => {
  const entries = [
    { path: '/project/data', name: 'data', is_dir: true },
    { path: '/project/horizon-mod.toml', name: 'horizon-mod.toml', is_dir: false },
  ];

  it('loads a directory lazily and opens a deeply nested file', async () => {
    const openFile = vi.fn();
    vi.mocked(listDirectory)
      .mockResolvedValueOnce([{ path: '/project/data/ruby', name: 'ruby', is_dir: true }])
      .mockResolvedValueOnce([{ path: '/project/data/ruby/item.json', name: 'item.json', is_dir: false }]);
    render(<ProjectExplorer entries={entries} selectedPath="" onOpenFile={openFile} />);
    expect(vi.mocked(listDirectory)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder data' }));
    expect(await screen.findByRole('button', { name: 'Expand folder ruby' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder ruby' }));
    const child = await screen.findByRole('button', { name: 'Open file item.json' });
    fireEvent.click(child);
    expect(openFile).toHaveBeenCalledWith('/project/data/ruby/item.json');
    expect(vi.mocked(listDirectory)).toHaveBeenNthCalledWith(1, '/project/data');
    expect(vi.mocked(listDirectory)).toHaveBeenNthCalledWith(2, '/project/data/ruby');
  });

  it('caches folder children and handles collapse without scanning again', async () => {
    vi.mocked(listDirectory).mockResolvedValueOnce([]);
    render(<ProjectExplorer entries={entries} selectedPath="" onOpenFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder data' }));
    expect(await screen.findByText('Empty folder')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse folder data' }));
    expect(screen.queryByText('Empty folder')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder data' }));
    expect(await screen.findByText('Empty folder')).toBeTruthy();
    expect(vi.mocked(listDirectory)).toHaveBeenCalledTimes(1);
  });

  it('surfaces folder access refusal without disclosing an invented tree', async () => {
    vi.mocked(listDirectory).mockRejectedValueOnce(new Error('path is outside configured workspace'));
    render(<ProjectExplorer entries={entries} selectedPath="" onOpenFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder data' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Error: path is outside configured workspace');
    expect(screen.queryByRole('button', { name: 'Open file item.json' })).toBeNull();
  });

  it('highlights the selected document and opens root files', () => {
    const openFile = vi.fn();
    render(<ProjectExplorer entries={entries} selectedPath="/project/horizon-mod.toml" onOpenFile={openFile} />);
    const selected = screen.getByRole('treeitem', { selected: true });
    expect(selected.textContent).toContain('horizon-mod.toml');
    fireEvent.click(screen.getByRole('button', { name: 'Open file horizon-mod.toml' }));
    expect(openFile).toHaveBeenCalledWith('/project/horizon-mod.toml');
  });
});
