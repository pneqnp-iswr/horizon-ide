import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { cancelBuild, listDirectory, readTextFile, runBuild, runGameItemSmoke, saveTextFile } from './services/tauri/client';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea aria-label="Monaco mock document" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
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
  readTextFile: vi.fn().mockResolvedValue({ contents: '', revision: 'a'.repeat(64) }),
  runBuild: vi.fn().mockResolvedValue({
    success: true, cancelled: false, timedOut: false, outputTruncated: false,
    output: 'ok', diagnostics: [],
  }),
  cancelBuild: vi.fn().mockResolvedValue(true),
  runGameItemSmoke: vi.fn().mockResolvedValue({
    schema: 'horizon-ide.item-smoke/1',
    level: 'inventory-observed',
    itemId: 'ruby:ruby',
    packageSha256: 'a'.repeat(64),
    packageItemOriginVerified: false,
    gameVersion: 'test',
    launchAccepted: true,
    negativeControlRefused: true,
    exactSlotDelta: true,
    before: 0, after: 1,
    changedSlots: [0],
    sessionCleaned: true,
    notes: ['Not proof of package origin'],
  }),
  saveTextFile: vi.fn().mockResolvedValue({ contents: '', revision: 'b'.repeat(64) }),
  setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  stopGame: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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
  it('refuses game item testing without an explicit approval', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-ctl.exe'), { target: { value: 'C:/Horizon/horizon-ctl.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod'), { target: { value: 'C:/dev/mod/target/mod.hmod' } });
    fireEvent.change(screen.getByPlaceholderText('ruby:ruby'), { target: { value: 'ruby:ruby' } });
    fireEvent.click(screen.getByText('Test item in disposable world'));
    expect(vi.mocked(runGameItemSmoke)).not.toHaveBeenCalled();
  });

  it('reports only inventory observation, not package provenance', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-ctl.exe'), { target: { value: 'C:/Horizon/horizon-ctl.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod'), { target: { value: 'C:/dev/mod/target/mod.hmod' } });
    fireEvent.change(screen.getByPlaceholderText('ruby:ruby'), { target: { value: 'ruby:ruby' } });
    fireEvent.click(screen.getByText('Test item in disposable world'));
    expect(await screen.findByText(/Package origin NOT verified/)).toBeTruthy();
    expect(vi.mocked(runGameItemSmoke)).toHaveBeenCalledWith(
      'C:/Horizon/horizon-ctl.exe',
      'C:/Horizon/horizon-client.exe',
      'C:/dev/mod/target/mod.hmod',
      'ruby:ruby', true,
    );
  });

  it('never builds untrusted project code after consent is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: '/tmp/user-project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Build' }));
    expect(vi.mocked(runBuild)).not.toHaveBeenCalled();
    expect(vi.mocked(cancelBuild)).not.toHaveBeenCalled();
  });

  it('requests a user-approved bounded build and displays diagnostics', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: '/tmp/user-project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Build' }));
    expect(await screen.findByText('ok')).toBeTruthy();
    expect(vi.mocked(runBuild)).toHaveBeenCalledWith('/tmp/user-project', true);
  });

  it('keeps unsaved code on a stale revision instead of silently overwriting the disk', async () => {
    vi.mocked(listDirectory).mockResolvedValueOnce([{
      path: '/tmp/ide/main.rs', name: 'main.rs', is_dir: false,
    }]);
    vi.mocked(readTextFile).mockResolvedValueOnce({
      contents: 'original', revision: 'a'.repeat(64),
    });
    vi.mocked(saveTextFile).mockRejectedValueOnce(new Error('the file changed since it was opened'));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: '/tmp/ide' },
    });
    fireEvent.click(screen.getByText('Load Files'));
    fireEvent.click(await screen.findByRole('button', { name: /main.rs/ }));
    const code = await screen.findByRole('textbox', { name: 'Monaco mock document' });
    fireEvent.change(code, { target: { value: 'changed in IDE' } });
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Save refused:/)).toBeTruthy();
    expect((code as HTMLTextAreaElement).value).toBe('changed in IDE');
    expect(vi.mocked(saveTextFile)).toHaveBeenCalledWith('/tmp/ide/main.rs', 'changed in IDE', 'a'.repeat(64));
  });

  it('advances the revision after a successful atomic save', async () => {
    vi.mocked(listDirectory).mockResolvedValueOnce([{
      path: '/tmp/ide/mod.rs', name: 'mod.rs', is_dir: false,
    }]);
    vi.mocked(readTextFile).mockResolvedValueOnce({
      contents: 'before', revision: 'c'.repeat(64),
    });
    vi.mocked(saveTextFile).mockResolvedValueOnce({
      contents: 'after', revision: 'd'.repeat(64),
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: '/tmp/ide' },
    });
    fireEvent.click(screen.getByText('Load Files'));
    fireEvent.click(await screen.findByRole('button', { name: /mod.rs/ }));
    const code = await screen.findByRole('textbox', { name: 'Monaco mock document' });
    fireEvent.change(code, { target: { value: 'after' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved to disk')).toBeTruthy();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    expect(vi.mocked(saveTextFile)).toHaveBeenCalledWith('/tmp/ide/mod.rs', 'after', 'c'.repeat(64));
  });
});
