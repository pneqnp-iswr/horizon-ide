import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import Editor from '@monaco-editor/react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './App.css';
import { MockAIProvider } from './services/ai/provider';
import { cancelBuild, getGameStatus, inspectHorizonClient, launchGame, listDirectory, readTextFile, runBuild, saveTextFile, setWorkspaceRoot, stopGame } from './services/tauri/client';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import type { BuildDiagnostic, FileEntry, GameStatus } from './types/app';

const mockProvider = new MockAIProvider();

function App() {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContents, setFileContents] = useState('');
  const [savedContents, setSavedContents] = useState('');
  const [documentRevision, setDocumentRevision] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [status, setStatus] = useState<GameStatus>('disconnected');
  const [gamePath, setGamePath] = useState('');
  const [gameProbe, setGameProbe] = useState('Select your installed horizon-client and check its Launch API.');
  const [probing, setProbing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Create a new mob with custom AI behavior');
  const [aiResponse, setAiResponse] = useState('');
  const [diagnostics, setDiagnostics] = useState<BuildDiagnostic[]>([]);
  const [buildOutput, setBuildOutput] = useState('Build output will appear here.');
  const [buildBusy, setBuildBusy] = useState(false);
  const [leftWidth, setLeftWidth] = useState(45);
  const [bottomHeight, setBottomHeight] = useState(35);

  const { theme, workspaceRoot, setTheme, setWorkspaceRoot: persistWorkspaceRoot } = useWorkspaceStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const term = new Terminal({ convertEol: true, theme: { background: '#10131a' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (terminalRef.current) {
      term.open(terminalRef.current);
      fit.fit();
      term.writeln('Horizon IDE console ready.');
    }
    terminalInstanceRef.current = term;
    fitAddonRef.current = fit;
    return () => term.dispose();
  }, []);

  useEffect(() => {
    const onResize = () => fitAddonRef.current?.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let active = true;
    const check = () => {
      void getGameStatus()
        .then((next) => { if (active) setStatus(next); })
        .catch(() => { if (active) setStatus('error'); });
    };
    check();
    const poll = window.setInterval(check, 1500);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

  const gameLabel = useMemo(() => {
    if (status === 'running') return 'Running';
    if (status === 'launching') return 'Launching';
    if (status === 'error') return 'Error';
    return 'Disconnected';
  }, [status]);

  async function refreshFiles() {
    if (!workspaceRoot) return;
    await setWorkspaceRoot(workspaceRoot);
    const entries = await listDirectory(workspaceRoot);
    setFiles(entries);
  }

  async function openFile(path: string) {
    if (savingFile) return;
    if (selectedFile && fileContents !== savedContents &&
        !window.confirm('Discard unsaved edits and open another file?')) return;
    try {
      const data = await readTextFile(path);
      setSelectedFile(path);
      setFileContents(data.contents);
      setSavedContents(data.contents);
      setDocumentRevision(data.revision);
      setSaveNotice('');
    } catch (error) {
      setSaveNotice(`Open failed: ${String(error)}`);
    }
  }

  async function saveCurrentFile() {
    if (!selectedFile || !documentRevision || savingFile) return;
    const path = selectedFile;
    const contents = fileContents;
    const expectedRevision = documentRevision;
    setSavingFile(true);
    try {
      const saved = await saveTextFile(path, contents, expectedRevision);
      setDocumentRevision(saved.revision);
      setSavedContents(contents);
      setSaveNotice('Saved to disk');
      terminalInstanceRef.current?.writeln(`Saved ${path} [${saved.revision.slice(0,12)}]`);
    } catch (error) {
      setSaveNotice(`Save refused: ${String(error)}. The editor contents remain available.`);
      terminalInstanceRef.current?.writeln(`Save failed: ${String(error)}`);
    } finally {
      setSavingFile(false);
    }
  }

  async function onBuild() {
    if (!workspaceRoot || buildBusy) return;
    if (!window.confirm(
      'Cargo may execute project build.rs scripts and procedural macros with your user privileges. ' +
      'Only build projects you trust. Run cargo check for this workspace?',
    )) return;
    setBuildBusy(true);
    setBuildOutput('Building trusted workspace… (limit: 180 seconds; logs limited to 1 MiB total)');
    setDiagnostics([]);
    try {
      const result = await runBuild(workspaceRoot, true);
      setBuildOutput(result.output);
      setDiagnostics(result.diagnostics);
      terminalInstanceRef.current?.writeln(
        result.cancelled ? 'Build cancelled.' : result.timedOut ? 'Build timed out.' :
        result.success ? 'Build succeeded.' : 'Build failed.',
      );
    } catch (error) {
      setBuildOutput(`Build could not start or finish: ${String(error)}`);
      terminalInstanceRef.current?.writeln(`Build error: ${String(error)}`);
    } finally {
      setBuildBusy(false);
    }
  }

  async function onCancelBuild() {
    try {
      if (await cancelBuild()) {
        terminalInstanceRef.current?.writeln('Build cancellation requested.');
      }
    } catch (error) {
      terminalInstanceRef.current?.writeln(`Could not cancel build: ${String(error)}`);
    }
  }

  async function onInspectHorizon() {
    if (!gamePath.trim()) return;
    setProbing(true);
    setGameProbe('Checking local Horizon Launch API…');
    try {
      const report = await inspectHorizonClient(gamePath);
      setGameProbe(`Launch API ${report.launchApi} · ${report.horizon ?? 'Horizon'} · compatible for preview only. Game load and embedding have NOT been verified.`);
    } catch (error) {
      setGameProbe(`Incompatible or unavailable installation: ${String(error)}`);
    } finally {
      setProbing(false);
    }
  }

  async function onLaunchGame() {
    if (!window.confirm('Start Horizon in a new disposable test directory? Personal saves and game settings will not be used, and the test directory is deleted when the session ends.')) return;
    setStatus('launching');
    try {
      const next = await launchGame(gamePath, []);
      setStatus(next);
      terminalInstanceRef.current?.writeln(`Game status: ${next}`);
    } catch (error) {
      setStatus('error');
      terminalInstanceRef.current?.writeln(`Launch failed: ${String(error)}`);
    }
  }

  async function onStopGame() {
    try {
      await stopGame();
      setStatus('disconnected');
      terminalInstanceRef.current?.writeln('Game process stopped.');
    } catch (error) {
      setStatus('error');
      terminalInstanceRef.current?.writeln(`Stop failed: ${String(error)}`);
    }
  }

  async function onAIRequest() {
    const response = await mockProvider.generate({ prompt: aiPrompt });
    setAiResponse(response.content);
  }

  function attachHorizontalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const start = leftWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const deltaPercent = ((moveEvent.clientX - startX) / window.innerWidth) * 100;
      setLeftWidth(Math.max(20, Math.min(80, start + deltaPercent)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function attachVerticalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const start = bottomHeight;
    const onMove = (moveEvent: MouseEvent) => {
      const deltaPercent = ((startY - moveEvent.clientY) / window.innerHeight) * 100;
      setBottomHeight(Math.max(20, Math.min(50, start + deltaPercent)));
      fitAddonRef.current?.fit();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Horizon IDE</h1>
        <label>
          Workspace Root
          <input
            value={workspaceRoot}
            onChange={(event) => persistWorkspaceRoot(event.target.value)}
            placeholder="C:/dev/horizon-mod"
          />
        </label>
        <button onClick={() => void refreshFiles()}>Load Files</button>
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as 'dark' | 'light')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <h2>Project Explorer</h2>
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.path}>
              <button disabled={file.is_dir} onClick={() => void openFile(file.path)}>
                {file.is_dir ? '📁' : '📄'} {file.name}
              </button>
            </li>
          ))}
        </ul>
        <h2>AI Assistant ({mockProvider.label})</h2>
        <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={4} />
        <button onClick={() => void onAIRequest()}>Run AI Prompt</button>
        <pre className="ai-output">{aiResponse || 'Mock responses are clearly marked and provider is extensible.'}</pre>
      </aside>

      <main className="workspace" style={{ gridTemplateRows: `1fr 6px ${bottomHeight}%` }}>
        <section className="top-panels">
          <article className="panel" style={{ width: `${leftWidth}%` }}>
            <header>
              <h2>Horizon Game</h2>
              <span data-status={status}>{gameLabel}</span>
            </header>
            <label>
              Executable Path
              <input value={gamePath} onChange={(event) => { setGamePath(event.target.value); setGameProbe('Installation not checked.'); }} placeholder="C:/Horizon/horizon-client.exe" />
            </label>
            <div className="button-row">
              <button onClick={() => void onInspectHorizon()} disabled={probing || !gamePath.trim()}>
                {probing ? 'Checking…' : 'Check Horizon'}
              </button>
              <button onClick={() => void onLaunchGame()} disabled={status === 'running' || status === 'launching' || !gamePath.trim()}>Launch</button>
              <button onClick={() => void onStopGame()} disabled={status === 'disconnected'}>Stop</button>
            </div>
            <p role="status">{gameProbe}</p>
            <p>
              Supported today: one explicitly selected horizon-client process in a disposable test game directory, isolated from personal saves. “Running” means the OS process is alive, not that a world or mod has loaded. Native game embedding and in-game testing remain unverified.
            </p>
          </article>
          <div className="splitter vertical" onMouseDown={attachHorizontalResize} />
          <article className="panel editor-panel" style={{ width: `${100 - leftWidth}%` }}>
            <header>
              <h2>Code Editor</h2>
              <button onClick={() => void saveCurrentFile()} disabled={!selectedFile || !documentRevision || savingFile}>
                {savingFile ? 'Saving…' : 'Save'}
              </button>
            </header>
            <p className="current-file">
              {selectedFile || 'Open a file from explorer'}
              {selectedFile && fileContents !== savedContents ? ' • Unsaved changes' : ''}
            </p>
            <p className="file-notice" role="status" aria-live="polite">{saveNotice || "\u00a0"}</p>
            <Editor
              height="100%"
              theme="vs-dark"
              value={fileContents}
              language="rust"
              onChange={(value) => setFileContents(value ?? '')}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          </article>
        </section>
        <div className="splitter horizontal" onMouseDown={attachVerticalResize} />
        <section className="bottom-panel">
          <header>
            <h2>Build, Diagnostics, Console</h2>
            <div className="button-row">
              <button onClick={() => void onBuild()} disabled={!workspaceRoot || buildBusy}>
                {buildBusy ? 'Building…' : 'Run Build'}
              </button>
              <button onClick={() => void onCancelBuild()} disabled={!buildBusy}>Cancel</button>
            </div>
          </header>
          <div className="bottom-grid">
            <pre className="build-output">{buildOutput}</pre>
            <div className="diagnostics">
              {diagnostics.length === 0 ? (
                <p>No diagnostics yet.</p>
              ) : (
                diagnostics.map((diag, index) => (
                  <p key={`${diag.message}-${index}`} data-level={diag.level}>
                    [{diag.level}] {diag.file ?? 'workspace'}:{diag.line ?? 0} {diag.message}
                  </p>
                ))
              )}
            </div>
            <div ref={terminalRef} className="terminal" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
