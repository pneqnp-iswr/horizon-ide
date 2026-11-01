import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { attachNativeGame, detachNativeGame, askLocalAi, buildContentMod, cancelBuild, checkHmodPackage, createContentStarter, getGameWindowProbe, launchGame, listDirectory, listLocalAiModels, readTextFile, runBuild, runGameItemSmoke, saveTextFile, stopGame } from './services/tauri/client';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea aria-label="Monaco mock document" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <section aria-label="Monaco AI diff mock">
      <pre data-testid="diff-original">{original}</pre>
      <pre data-testid="diff-modified">{modified}</pre>
    </section>
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
  attachNativeGame: vi.fn().mockResolvedValue({
    attachedNativeWindow: true, recoveryRequired: false, playableVerified: false, gamePid: 1234,
    message: 'Win32 child attached; no gameplay evidence',
  }),
  resizeNativeGame: vi.fn().mockResolvedValue({
    attachedNativeWindow: true, recoveryRequired: false, playableVerified: false, gamePid: 1234,
    message: 'Native resized; gameplay unverified',
  }),
  detachNativeGame: vi.fn().mockResolvedValue(undefined),
  getGameWindowProbe: vi.fn().mockResolvedValue({
    status: 'native-window-found',
    processId: 1234,
    selected: {
      title: 'Horizon', width: 1440, height: 900,
      visible: true, topLevel: true, processId: 1234,
      nativeHandle: '0x123',
    },
    candidateCount: 1, embedded: false, playableVerified: false,
    warning: 'Discovery is not rendering or embedding.',
  }),
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
  listLocalAiModels: vi.fn().mockResolvedValue({
    provider: 'lmstudio',
    models: ['huihui-ai/Qwen3-27B', 'small-model'],
  }),
  askLocalAi: vi.fn().mockResolvedValue({
    provider: 'lmstudio',
    model: 'local-model',
    content: 'Reviewable Rust suggestion',
    localEndpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    documentIncluded: false,
    proposedChangesApplied: false,
    commandsExecuted: false,
  }),
  buildContentMod: vi.fn().mockResolvedValue({
    succeeded: true,
    artifactPath: 'C:/dev/mod/target/horizon-mod/ruby.hmod',
    sha256: 'a'.repeat(64),
    modId: 'ruby',
    version: '0.1.0',
    contentApi: '0.2',
    staticCheckPassed: true,
    inGameVerified: false,
  }),
  runBuild: vi.fn().mockResolvedValue({
    success: true, cancelled: false, timedOut: false, outputTruncated: false,
    output: 'ok', diagnostics: [],
  }),
  cancelBuild: vi.fn().mockResolvedValue(true),
  createContentStarter: vi.fn().mockResolvedValue({
    path: 'C:/dev/mod/ruby_mod',
    modId: 'ruby_mod',
    manifestPath: 'C:/dev/mod/ruby_mod/horizon-mod.toml',
    template: 'official-horizon-content',
    gameLoadVerified: false,
  }),
  checkHmodPackage: vi.fn().mockResolvedValue({
    checker: 'cargo-horizon-mod',
    checkerReportKind: 'mod',
    modId: 'ruby',
    version: '0.1.0',
    contentApi: '0.2',
    sha256: 'a'.repeat(64),
    officialStaticCheckPassed: true,
    targetNamespaceMatches: true,
    targetMemberVerified: false,
  }),
  runGameItemSmoke: vi.fn().mockResolvedValue({
    schema: 'horizon-ide.item-smoke/1',
    level: 'inventory-observed',
    itemId: 'ruby:ruby',
    packageSha256: 'a'.repeat(64),
    staticAttestation: {
      checker: 'cargo-horizon-mod',
      checkerReportKind: 'mod',
      modId: 'ruby',
      version: '0.1.0',
      contentApi: '0.2',
      sha256: 'a'.repeat(64),
      officialStaticCheckPassed: true,
      targetNamespaceMatches: true,
      targetMemberVerified: false,
    },
    explicitResourcesSupplied: true,
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

  it('discovers real local model identifiers without sending editor code', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Discover local models' }));
    expect(await screen.findByText(/Found 2 available local model/)).toBeTruthy();
    expect(vi.mocked(listLocalAiModels)).toHaveBeenCalledWith('lmstudio');
    expect(vi.mocked(askLocalAi)).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText('Your local model identifier') as HTMLInputElement).value)
      .toBe('huihui-ai/Qwen3-27B');
    fireEvent.change(screen.getByLabelText('Available local models'), {
      target: { value: 'small-model' },
    });
    expect((screen.getByPlaceholderText('Your local model identifier') as HTMLInputElement).value)
      .toBe('small-model');
  });

  it('shows a real Monaco diff and applies only to the editor buffer after approval', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listDirectory).mockResolvedValueOnce([{ path: 'C:/dev/mod/behavior.rs', name: 'behavior.rs', is_dir: false }]);
    vi.mocked(readTextFile).mockResolvedValueOnce({
      contents: 'fn before() {}', revision: 'a'.repeat(64),
    });
    vi.mocked(askLocalAi).mockResolvedValueOnce({
      provider: 'lmstudio', model: 'local-model',
      content: JSON.stringify({ path: 'C:/dev/mod/behavior.rs', newContent: 'fn after() {}' }),
      localEndpoint: 'http://127.0.0.1:1234/v1/chat/completions',
      documentIncluded: true, proposedChangesApplied: false, commandsExecuted: false,
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load Files' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open file behavior.rs' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('fn before() {}'));
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), { target: { value: 'local-model' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include current editor contents in prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Propose file edit (review diff)' }));
    expect(await screen.findByRole('region', { name: 'Monaco AI diff mock' })).toBeTruthy();
    expect(screen.getByTestId('diff-original').textContent).toBe('fn before() {}');
    expect(screen.getByTestId('diff-modified').textContent).toBe('fn after() {}');
    expect(vi.mocked(saveTextFile)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to editor' }));
    expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('fn after() {}');
    expect(vi.mocked(saveTextFile)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo AI buffer edit' }));
    expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('fn before() {}');
  });

  it('rejects a stale edit when source is changed while model is generating', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listDirectory).mockResolvedValueOnce([{ path: 'C:/dev/mod/behavior.rs', name: 'behavior.rs', is_dir: false }]);
    vi.mocked(readTextFile).mockResolvedValueOnce({ contents: 'old', revision: 'a'.repeat(64) });
    let resolveAi!: (value: Awaited<ReturnType<typeof askLocalAi>>) => void;
    vi.mocked(askLocalAi).mockImplementationOnce(() => new Promise((resolve) => { resolveAi = resolve; }));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load Files' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open file behavior.rs' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('old'));
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), { target: { value: 'local-model' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include current editor contents in prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Propose file edit (review diff)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Monaco mock document' }), { target: { value: 'user has edited since request' } });
    resolveAi({
      provider: 'lmstudio', model: 'local-model',
      content: JSON.stringify({ path: 'C:/dev/mod/behavior.rs', newContent: 'AI stale replacement' }),
      localEndpoint: 'http://127.0.0.1:1234/v1/chat/completions',
      documentIncluded: true, proposedChangesApplied: false, commandsExecuted: false,
    });
    expect(await screen.findByText(/Editor changed while AI was generating/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply to editor' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('user has edited since request');
  });

  it('refuses to propose a code edit without explicit source-context opt-in', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Propose file edit (review diff)' }).hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(askLocalAi)).not.toHaveBeenCalled();
  });

  it('does not send a local AI request without explicit user consent', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), {
      target: { value: 'local-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Local AI' }));
    expect(vi.mocked(askLocalAi)).not.toHaveBeenCalled();
  });

  it('does not expose open document to a local model unless context is opted in', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), {
      target: { value: 'local-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Local AI' }));
    await screen.findByText(/Reviewable Rust suggestion/);
    expect(vi.mocked(askLocalAi)).toHaveBeenCalledWith(
      'lmstudio', 'local-model', 'Create a new mob with custom AI behavior', null, true,
    );
  });

  it('sends selected editor contents to local AI only after opt-in', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listDirectory).mockResolvedValueOnce([
      { path: 'C:/dev/mod/behavior.rs', name: 'behavior.rs', is_dir: false },
    ]);
    vi.mocked(readTextFile).mockResolvedValueOnce({
      contents: 'fn move_mob() {}', revision: 'a'.repeat(64),
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: 'C:/dev/mod' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load Files' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open file behavior.rs' }));
    await waitFor(() => expect(vi.mocked(readTextFile)).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), {
      target: { value: 'local-model' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include current editor contents in prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask Local AI' }));
    await waitFor(() => expect(vi.mocked(askLocalAi)).toHaveBeenCalledWith(
      'lmstudio', 'local-model', 'Create a new mob with custom AI behavior', 'fn move_mob() {}', true,
    ));
  });

  it('reports failed local inference and never replaces it with a mock response', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(askLocalAi).mockRejectedValueOnce(new Error('local server offline'));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Your local model identifier'), {
      target: { value: 'local-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Local AI' }));
    expect(await screen.findByText(/Local AI failed: Error: local server offline/)).toBeTruthy();
    expect(screen.getByText(/No fallback response was generated/)).toBeTruthy();
  });

  it('Ctrl+S saves the active Monaco file through revisioned desktop IPC', async () => {
    vi.mocked(listDirectory).mockResolvedValueOnce([
      { path: 'C:/dev/mod/main.rs', name: 'main.rs', is_dir: false },
    ]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: 'C:/dev/mod' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load Files' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open file main.rs' }));
    await waitFor(() => expect(vi.mocked(readTextFile)).toHaveBeenCalledWith('C:/dev/mod/main.rs'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Monaco mock document' }), {
      target: { value: 'let x = 1;' },
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(vi.mocked(saveTextFile)).toHaveBeenCalledWith(
      'C:/dev/mod/main.rs', 'let x = 1;', 'a'.repeat(64),
    ));
  });

  it('Ctrl+Shift+B invokes only the approved content build, never bypasses consent', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), {
      target: { value: 'C:/dev/mod' },
    });
    fireEvent.change(screen.getByPlaceholderText('C:/Tools/cargo-horizon-mod.exe'), {
      target: { value: 'C:/Tools/cargo-horizon-mod.exe' },
    });
    fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
    expect(vi.mocked(buildContentMod)).not.toHaveBeenCalled();
  });

  it('F5 launches external Horizon with consent and Shift+F5 stops owned game process', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), {
      target: { value: 'C:/Horizon/horizon-client.exe' },
    });
    fireEvent.keyDown(window, { key: 'F5' });
    await waitFor(() => expect(vi.mocked(launchGame)).toHaveBeenCalledWith('C:/Horizon/horizon-client.exe', []));
    await screen.findByText('Running');
    fireEvent.keyDown(window, { key: 'F5', shiftKey: true });
    await waitFor(() => expect(vi.mocked(stopGame)).toHaveBeenCalled());
  });

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
  it('never reparents a game HWND without explicit user approval', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'Experimental native Horizon game host')
        return { left: 200, top: 160, right: 850, bottom: 420, width: 650, height: 260 } as DOMRect;
      if (this.classList.contains('game-panel'))
        return { left: 150, top: 50, right: 1000, bottom: 700, width: 850, height: 650 } as DOMRect;
      return { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 } as DOMRect;
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'),
      { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await screen.findByText('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Find native window' }));
    await screen.findByText(/Found the game window belonging to PID 1234/);
    fireEvent.click(screen.getByRole('button', { name: 'Attach to IDE (experimental)' }));
    expect(vi.mocked(attachNativeGame)).not.toHaveBeenCalled();
  });

  it('attaches a native game HWND and detaches again without any fake-playability claim', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'Experimental native Horizon game host')
        return { left: 200, top: 160, right: 850, bottom: 420, width: 650, height: 260 } as DOMRect;
      if (this.classList.contains('game-panel'))
        return { left: 150, top: 50, right: 1000, bottom: 700, width: 850, height: 650 } as DOMRect;
      return { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 } as DOMRect;
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'),
      { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await screen.findByText('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Find native window' }));
    await screen.findByText(/Found the game window belonging to PID 1234/);
    fireEvent.click(screen.getByRole('button', { name: 'Attach to IDE (experimental)' }));
    await waitFor(() => expect(vi.mocked(attachNativeGame)).toHaveBeenCalledWith(
      { x: 200, y: 160, width: 650, height: 260 }, true,
    ));
    fireEvent.click(await screen.findByRole('button', { name: 'Detach native window' }));
    await waitFor(() => expect(vi.mocked(detachNativeGame)).toHaveBeenCalled());
    expect(screen.getByText(/original desktop parent/)).toBeTruthy();
  });

  it('retains a manual recovery path after partial Win32 reparenting failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(attachNativeGame).mockResolvedValueOnce({
      attachedNativeWindow: false, recoveryRequired: true,
      playableVerified: false, gamePid: 1234,
      message: 'RECOVERY REQUIRED: window placement failed; retry Detach',
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'Experimental native Horizon game host')
        return { left: 200, top: 160, right: 850, bottom: 420, width: 650, height: 260 } as DOMRect;
      if (this.classList.contains('game-panel'))
        return { left: 150, top: 50, right: 1000, bottom: 700, width: 850, height: 650 } as DOMRect;
      return { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 } as DOMRect;
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'),
      { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await screen.findByText('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Find native window' }));
    await screen.findByText(/Found the game window belonging to PID 1234/);
    fireEvent.click(screen.getByRole('button', { name: 'Attach to IDE (experimental)' }));
    expect(await screen.findByText(/RECOVERY REQUIRED/)).toBeTruthy();
    const detach = screen.getByRole('button', { name: 'Detach native window' }) as HTMLButtonElement;
    expect(detach.disabled).toBe(false);
    fireEvent.click(detach);
    await waitFor(() => expect(vi.mocked(detachNativeGame)).toHaveBeenCalled());
  });

  it('finds only the actual owned native game window and does not claim embedded gameplay', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), {
      target: { value: 'C:/Horizon/horizon-client.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(await screen.findByText('Running')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Find native window' }));
    expect(await screen.findByText(/Found the game window belonging to PID 1234/)).toBeTruthy();
    expect(screen.getByText(/game is not yet embedded/)).toBeTruthy();
    expect(vi.mocked(getGameWindowProbe)).toHaveBeenCalledTimes(1);
  });

  it('does not invent a native window when Horizon has no usable HWND', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(getGameWindowProbe).mockResolvedValueOnce({
      status: 'no-native-window', processId: 567,
      selected: null, candidateCount: 0, embedded: false,
      playableVerified: false, warning: 'Not embedded.',
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), {
      target: { value: 'C:/Horizon/horizon-client.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await screen.findByText('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Find native window' }));
    expect(await screen.findByText(/no usable top-level Windows game window/)).toBeTruthy();
  });

  it('does not launch the disposable Horizon session without explicit consent', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), {
      target: { value: 'C:/Horizon/horizon-client.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(vi.mocked(launchGame)).not.toHaveBeenCalled();
  });

  it('refuses official template generation without approval', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Tools/cargo-horizon-mod.exe'), { target: { value: 'C:/Tools/cargo-horizon-mod.exe' } });
    fireEvent.change(screen.getByPlaceholderText('ruby_mod'), { target: { value: 'ruby_mod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create official starter' }));
    expect(vi.mocked(createContentStarter)).not.toHaveBeenCalled();
  });

  it('opens a generated official content manifest without claiming game verification', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listDirectory).mockResolvedValueOnce([{ path: 'C:/dev/mod/ruby_mod/horizon-mod.toml', name: 'horizon-mod.toml', is_dir: false }]);
    vi.mocked(readTextFile).mockResolvedValueOnce({ contents: 'id = "ruby_mod"', revision: 'f'.repeat(64) });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Tools/cargo-horizon-mod.exe'), { target: { value: 'C:/Tools/cargo-horizon-mod.exe' } });
    fireEvent.change(screen.getByPlaceholderText('ruby_mod'), { target: { value: 'ruby_mod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create official starter' }));
    expect(await screen.findByText(/Created ruby_mod: official content template, not yet tested in game/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Monaco mock document' }) as HTMLTextAreaElement).value).toBe('id = "ruby_mod"');
    expect(vi.mocked(createContentStarter)).toHaveBeenCalledWith(
      'C:/Tools/cargo-horizon-mod.exe', 'C:/dev/mod', 'ruby_mod', true,
    );
  });

  it('does not run the native package checker without confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe'), { target: { value: 'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod'), { target: { value: 'C:/dev/mod/target/mod.hmod' } });
    fireEvent.change(screen.getByPlaceholderText('ruby:ruby'), { target: { value: 'ruby:ruby' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify .hmod (no game)' }));
    expect(vi.mocked(checkHmodPackage)).not.toHaveBeenCalled();
  });

  it('shows static verification without asserting an archive member exists', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe'), { target: { value: 'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod'), { target: { value: 'C:/dev/mod/target/mod.hmod' } });
    fireEvent.change(screen.getByPlaceholderText('ruby:ruby'), { target: { value: 'ruby:ruby' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify .hmod (no game)' }));
    expect(await screen.findByText(/Static check passed: ruby 0.1.0/)).toBeTruthy();
    expect(screen.getByText(/exact item file NOT verified/)).toBeTruthy();
    expect(vi.mocked(checkHmodPackage)).toHaveBeenCalledWith(
      'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe', 'C:/dev/mod/target/mod.hmod', 'ruby:ruby', true,
    );
  });

  it('refuses game item testing without an explicit approval', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-client.exe'), { target: { value: 'C:/Horizon/horizon-client.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/horizon-ctl.exe'), { target: { value: 'C:/Horizon/horizon-ctl.exe' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe'), {
      target: { value: 'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe' },
    });
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
    fireEvent.change(screen.getByPlaceholderText('C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe'), {
      target: { value: 'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe' },
    });
    fireEvent.change(screen.getByPlaceholderText('C:/Horizon/prepared/26.3'), {
      target: { value: 'C:/Horizon/prepared/26.3' },
    });
    fireEvent.change(screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod'), { target: { value: 'C:/dev/mod/target/mod.hmod' } });
    fireEvent.change(screen.getByPlaceholderText('ruby:ruby'), { target: { value: 'ruby:ruby' } });
    fireEvent.click(screen.getByText('Test item in disposable world'));
    expect(await screen.findByText(/Package origin NOT verified/)).toBeTruthy();
    expect(vi.mocked(runGameItemSmoke)).toHaveBeenCalledWith(
      'C:/Horizon/horizon-ctl.exe',
      'C:/Horizon/horizon-client.exe',
      'C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe',
      'C:/dev/mod/target/mod.hmod',
      'ruby:ruby', 'C:/Horizon/prepared/26.3', true,
    );
  });

  it('does not build .hmod without explicit native-tool approval', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Tools/cargo-horizon-mod.exe'), {
      target: { value: 'C:/Tools/cargo-horizon-mod.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Build .hmod' }));
    expect(vi.mocked(buildContentMod)).not.toHaveBeenCalled();
  });

  it('attests and selects the actual built archive for game smoke, without claiming gameplay', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('C:/dev/horizon-mod'), { target: { value: 'C:/dev/mod' } });
    fireEvent.change(screen.getByPlaceholderText('C:/Tools/cargo-horizon-mod.exe'), {
      target: { value: 'C:/Tools/cargo-horizon-mod.exe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Build .hmod' }));
    expect(await screen.findByText(/Built ruby .hmod.*NOT yet game-tested/)).toBeTruthy();
    expect((screen.getByPlaceholderText('C:/dev/mod/target/mod.hmod') as HTMLInputElement).value)
      .toBe('C:/dev/mod/target/horizon-mod/ruby.hmod');
    expect(vi.mocked(buildContentMod)).toHaveBeenCalledWith(
      'C:/Tools/cargo-horizon-mod.exe', 'C:/dev/mod', true,
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
