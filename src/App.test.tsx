import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  inspectHorizonClient: vi.fn().mockResolvedValue({
    launchApi: '0.1.0',
    horizon: 'Horizon test',
    minecraft: '26.3',
    compatibleForPreview: true,
    gameLoadVerified: false,
    embeddedViewportVerified: false,
  }),
  launchGame: vi.fn().mockResolvedValue('running'),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
  runBuild: vi.fn().mockResolvedValue({ success: true, output: 'ok', diagnostics: [] }),
  saveTextFile: vi.fn().mockResolvedValue(undefined),
  setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  stopGame: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

describe('App', () => {
  it('renders core workspace panels', () => {
    render(<App />);
    expect(screen.getByText('Horizon IDE')).toBeTruthy();
    expect(screen.getByText('Horizon Game')).toBeTruthy();
    expect(screen.getByText('Code Editor')).toBeTruthy();
    expect(screen.getByText('Build, Diagnostics, Console')).toBeTruthy();
  });
  it('labels launch API capability without claiming an embedded game', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), {
      target: { value: 'C:/Horizon/horizon-client.exe' },
    });
    fireEvent.click(screen.getByText('Check Horizon'));
    expect(await screen.findByText(/Game load and embedding have NOT been verified/)).toBeTruthy();
  });
});
