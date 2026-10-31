import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div>Monaco Editor Mock</div>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    writeln() {}
    dispose() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock('./services/tauri/client', () => ({
  getGameStatus: vi.fn().mockResolvedValue('disconnected'),
  launchGame: vi.fn().mockResolvedValue('running'),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
  runBuild: vi.fn().mockResolvedValue({ success: true, output: 'ok', diagnostics: [] }),
  saveTextFile: vi.fn().mockResolvedValue(undefined),
  setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  stopGame: vi.fn().mockResolvedValue(undefined),
}));

describe('App', () => {
  it('renders core workspace panels', () => {
    render(<App />);
    expect(screen.getByText('Horizon IDE')).toBeTruthy();
    expect(screen.getByText('Horizon Game')).toBeTruthy();
    expect(screen.getByText('Code Editor')).toBeTruthy();
    expect(screen.getByText('Build, Diagnostics, Console')).toBeTruthy();
  });
});
