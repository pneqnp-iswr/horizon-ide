import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import Editor from '@monaco-editor/react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './App.css';
import { MockAIProvider } from './services/ai/provider';
import { askLocalAi, listLocalAiModels, buildContentMod, cancelBuild, checkHmodPackage, createContentStarter, getGameStatus, inspectHorizonClient, launchGame, listDirectory, readTextFile, runBuild, runGameItemSmoke, saveTextFile, setWorkspaceRoot, stopGame } from './services/tauri/client';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import ProjectExplorer from './components/ProjectExplorer';
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
  const [controlPath, setControlPath] = useState('');
  const [checkerPath, setCheckerPath] = useState('');
  const [starterName, setStarterName] = useState('');
  const [starterBusy, setStarterBusy] = useState(false);
  const [starterStatus, setStarterStatus] = useState('');
  const [packagePath, setPackagePath] = useState('');
  const [preparedResourcesPath, setPreparedResourcesPath] = useState('');
  const [targetItemId, setTargetItemId] = useState('');
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [smokeStatus, setSmokeStatus] = useState('No in-game item observation has been made.');
  const [probing, setProbing] = useState(false);
  const [aiBackend, setAiBackend] = useState<'lmstudio' | 'ollama' | 'mock'>('lmstudio');
  const [aiModel, setAiModel] = useState('');
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiModelsBusy, setAiModelsBusy] = useState(false);
  const [aiModelNotice, setAiModelNotice] = useState('Discover models after starting a local server.');
  const [aiIncludeDocument, setAiIncludeDocument] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Create a new mob with custom AI behavior');
  const [aiResponse, setAiResponse] = useState('');
  const [diagnostics, setDiagnostics] = useState<BuildDiagnostic[]>([]);
  const [buildOutput, setBuildOutput] = useState('Build output will appear here.');
  const [buildBusy, setBuildBusy] = useState(false);
  const [explorerRevision, setExplorerRevision] = useState(0);
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
    setExplorerRevision((revision) => revision + 1);
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

  async function onBuildContentMod() {
    if (!workspaceRoot || !checkerPath || buildBusy) return;
    if (selectedFile && fileContents !== savedContents) {
      setBuildOutput('Save your editor changes before building the content mod.');
      return;
    }
    if (!window.confirm(
      'Run your trusted cargo-horizon-mod executable to BUILD this data-only .hmod and then run its official static checker? ' +
      'This executes the selected native binary with your user permissions. No game will be started.',
    )) return;
    setBuildBusy(true);
    setBuildOutput('Building content .hmod through the official tool…');
    setDiagnostics([]);
    try {
      await setWorkspaceRoot(workspaceRoot);
      const result = await buildContentMod(checkerPath, workspaceRoot, true);
      setPackagePath(result.artifactPath);
      setBuildOutput(JSON.stringify(result, null, 2));
      setSmokeStatus(`Built ${result.modId} .hmod, SHA ${result.sha256.slice(0, 12)}…; selected for isolated game smoke. NOT yet game-tested.`);
      terminalInstanceRef.current?.writeln(`Official content build: ${result.artifactPath} (static check passed, not game tested)`);
    } catch (error) {
      setBuildOutput(`Content .hmod build failed: ${String(error)}`);
      terminalInstanceRef.current?.writeln(`Content build failed: ${String(error)}`);
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

  async function onCreateContentStarter() {
    if (!workspaceRoot || !checkerPath || !starterName || starterBusy) return;
    if (selectedFile && fileContents !== savedContents) {
      setStarterStatus('Save your unsaved editor changes before creating another project.');
      return;
    }
    if (!window.confirm(
      'Create a new official Horizon content mod inside this workspace? The trusted native cargo-horizon-mod generator will execute with your user permissions. ' +
      'The destination must not already exist. This creates a new folder and switches the editor to its generated manifest.',
    )) return;
    setStarterBusy(true);
    setStarterStatus('Generating verified official content project…');
    let generatedPath = '';
    try {
      await setWorkspaceRoot(workspaceRoot);
      const created = await createContentStarter(checkerPath, workspaceRoot, starterName, true);
      generatedPath = created.path;
      // Only switch workspaces after the official generator and manifest check
      // finish. Read the manifest directly; no made-up editor contents.
      await setWorkspaceRoot(created.path);
      const entries = await listDirectory(created.path);
      const manifest = await readTextFile(created.manifestPath);
      persistWorkspaceRoot(created.path);
      setFiles(entries);
      setSelectedFile(created.manifestPath);
      setFileContents(manifest.contents);
      setSavedContents(manifest.contents);
      setDocumentRevision(manifest.revision);
      setSaveNotice('');
      setStarterStatus(`Created ${created.modId}: official content template, not yet tested in game.`);
    } catch (error) {
      setStarterStatus(generatedPath
        ? `Project created at ${generatedPath}, but automatic opening failed: ${String(error)}`
        : `Could not create content project: ${String(error)}`);
    } finally {
      setStarterBusy(false);
    }
  }

  async function onVerifyPackage() {
    if (!checkerPath || !packagePath || !targetItemId || !workspaceRoot || smokeBusy) return;
    if (!window.confirm('Run the trusted official cargo-horizon-mod checker on this workspace package? It executes a selected native binary but does not launch Minecraft.')) return;
    setSmokeBusy(true);
    setSmokeStatus('Running official Horizon content-mod static check…');
    try {
      await setWorkspaceRoot(workspaceRoot);
      const result = await checkHmodPackage(checkerPath, packagePath, targetItemId, true);
      setSmokeStatus(`Static check passed: ${result.modId} ${result.version}, API ${result.contentApi}, SHA ${result.sha256.slice(0, 12)}…; exact item file NOT verified.`);
      setBuildOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      setSmokeStatus(`Static validation failed: ${String(error)}`);
    } finally {
      setSmokeBusy(false);
    }
  }

  async function onGameItemSmoke() {
    if (!gamePath || !controlPath || !checkerPath || !packagePath || !targetItemId || !workspaceRoot || smokeBusy) return;
    if (!window.confirm(
      'Launch your trusted Horizon client and horizon-ctl into a NEW disposable test world? ' +
      'The trusted game and checker are native executables running with your OS user privileges; the .hmod must be data-only. ' +
      'This test attempts give/inventory commands, then quit. No personal saves are deliberately used. ' +
      'The official cargo-horizon-mod checker must validate package SHA, mod ID, API and namespace. ' +
      'Only an inventory observation is verified; individual item membership and gameplay are not.',
    )) return;
    setSmokeBusy(true);
    setSmokeStatus('Running isolated Horizon inventory smoke test…');
    try {
      await setWorkspaceRoot(workspaceRoot);
      const report = await runGameItemSmoke(controlPath, gamePath, checkerPath, packagePath, targetItemId, preparedResourcesPath.trim() || null, true);
      setSmokeStatus(
        `Observed ${report.itemId}: ${report.before} → ${report.after}, slots: ${report.changedSlots.join(', ')}. ` +
        `Official static check passed for ${report.staticAttestation.modId}. ` +
        'Package origin NOT verified.',
      );
      setBuildOutput(JSON.stringify(report, null, 2));
      terminalInstanceRef.current?.writeln('Horizon item smoke: real inventory delta observed; package origin not proven.');
    } catch (error) {
      setSmokeStatus(`In-game smoke failed: ${String(error)}`);
      terminalInstanceRef.current?.writeln(`Horizon smoke failure: ${String(error)}`);
    } finally {
      setSmokeBusy(false);
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

  async function onDiscoverLocalModels() {
    if (aiBackend === 'mock' || aiModelsBusy) return;
    setAiModelsBusy(true);
    setAiModelNotice('Checking the selected local server for available models…');
    try {
      const result = await listLocalAiModels(aiBackend);
      setAiModels(result.models);
      setAiModel((selected) => result.models.includes(selected) ? selected : result.models[0]);
      setAiModelNotice(`Found ${result.models.length} available local model(s).`);
    } catch (error) {
      setAiModels([]);
      setAiModelNotice(`Cannot list local models: ${String(error)}`);
    } finally {
      setAiModelsBusy(false);
    }
  }

  async function onAIRequest() {
    if (aiBusy || !aiPrompt.trim()) return;
    if (aiBackend === 'mock') {
      setAiBusy(true);
      try {
        const response = await mockProvider.generate({ prompt: aiPrompt });
        setAiResponse(`[Demo/mock response — no model inference]\n${response.content}`);
      } finally {
        setAiBusy(false);
      }
      return;
    }
    if (!aiModel.trim()) {
      setAiResponse('Select the exact model ID loaded by your local LM Studio or Ollama server.');
      return;
    }
    const content = aiIncludeDocument && selectedFile ? fileContents : null;
    if (!window.confirm(
      `Send this prompt${content !== null ? ' and the selected editor document' : ''} to the LOCAL ${aiBackend === 'lmstudio' ? 'LM Studio' : 'Ollama'} server on 127.0.0.1? ` +
      'No remote API is contacted by the IDE, but your local server controls its own logging and model routing. ' +
      'The returned suggestion will NOT be automatically applied or executed.',
    )) return;
    setAiBusy(true);
    setAiResponse('Asking the local model…');
    try {
      const result = await askLocalAi(aiBackend, aiModel.trim(), aiPrompt, content, true);
      setAiResponse(`[Local ${result.provider} / ${result.model}; document included: ${result.documentIncluded ? 'yes' : 'no'}]\n\n${result.content}`);
    } catch (error) {
      setAiResponse(`Local AI failed: ${String(error)}. No fallback response was generated.`);
    } finally {
      setAiBusy(false);
    }
  }

  // Editor shortcuts operate inside the actual Tauri workspace, never by
  // silently executing source in a browser. Native process actions retain
  // the same explicit confirmation as their visible buttons.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.altKey) return;
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (commandKey && !event.shiftKey && key === 's') {
        // The WebView's default Save Page dialog must never appear in an IDE.
        event.preventDefault();
        if (selectedFile && !savingFile) void saveCurrentFile();
        return;
      }
      if (commandKey && event.shiftKey && key === 'b') {
        event.preventDefault();
        if (workspaceRoot && checkerPath && !buildBusy) {
          void onBuildContentMod();
        } else if (!checkerPath) {
          setBuildOutput('Choose the trusted cargo-horizon-mod executable in New Horizon Content Mod first.');
        }
        return;
      }
      if (!commandKey && event.key === 'F5') {
        // Prevent a WebView reload, which could destroy unsaved editor state.
        event.preventDefault();
        if (!event.shiftKey && status === 'disconnected') {
          if (gamePath.trim()) void onLaunchGame();
          else setGameProbe('Select your trusted horizon-client executable before pressing F5.');
        } else if (event.shiftKey && (status === 'running' || status === 'launching')) {
          void onStopGame();
        }
      }
    };
    // Capture before Monaco so these workspace shortcuts are consistent in
    // panels, while ordinary editor keystrokes are untouched.
    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  });

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
        <p className="shortcut-legend">Ctrl+S Save · Ctrl+Shift+B Build .hmod · F5 Launch · Shift+F5 Stop</p>
        <label>
          Workspace Root
          <input
            value={workspaceRoot}
            onChange={(event) => persistWorkspaceRoot(event.target.value)}
            placeholder="C:/dev/horizon-mod"
          />
        </label>
        <button onClick={() => void refreshFiles()}>Load Files</button>
        <details className="starter-tools">
          <summary>New Horizon Content Mod</summary>
          <label>
            Official cargo-horizon-mod executable
            <input value={checkerPath} onChange={(event) => setCheckerPath(event.target.value)}
              placeholder="C:/Tools/cargo-horizon-mod.exe" />
          </label>
          <label>
            New project folder
            <input value={starterName} onChange={(event) => setStarterName(event.target.value)}
              placeholder="ruby_mod" />
          </label>
          <button onClick={() => void onCreateContentStarter()} disabled={
            starterBusy || !workspaceRoot || !checkerPath || !starterName
          }>{starterBusy ? 'Generating…' : 'Create official starter'}</button>
          <p role="status" aria-live="polite">{starterStatus}</p>
        </details>
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as 'dark' | 'light')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <h2>Project Explorer</h2>
        <ProjectExplorer key={`${workspaceRoot}:${explorerRevision}`} entries={files}
          selectedPath={selectedFile} onOpenFile={openFile} />
        <h2>Local AI Coding Assistant</h2>
        <label>
          Inference mode
          <select value={aiBackend} onChange={(event) => {
            setAiBackend(event.target.value as 'lmstudio' | 'ollama' | 'mock');
            setAiModel('');
            setAiModels([]);
            setAiModelNotice('Discover models after starting a local server.');
          }}>
            <option value="lmstudio">LM Studio · localhost:1234</option>
            <option value="ollama">Ollama · localhost:11434</option>
            <option value="mock">Demo only (mock, no real AI)</option>
          </select>
        </label>
        {aiBackend !== 'mock' && (
          <label>
            Loaded model ID
            <input value={aiModel} onChange={(event) => setAiModel(event.target.value)}
              placeholder="Your local model identifier" />
          </label>
        )}
        {aiBackend !== 'mock' && (
          <>
            <button type="button" disabled={aiModelsBusy || aiBusy} onClick={() => void onDiscoverLocalModels()}>
              {aiModelsBusy ? 'Discovering models…' : 'Discover local models'}
            </button>
            {aiModels.length > 0 && (
              <label>
                Available local models
                <select value={aiModels.includes(aiModel) ? aiModel : ''} onChange={(event) => setAiModel(event.target.value)}>
                  <option value="" disabled>Choose a discovered model</option>
                  {aiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
            )}
            <p className="local-ai-notice" role="status">{aiModelNotice}</p>
          </>
        )}
        <label className="local-ai-consent">
          <input type="checkbox" checked={aiIncludeDocument}
            onChange={(event) => setAiIncludeDocument(event.target.checked)} />
          Include current editor contents in prompt
        </label>
        <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={4}
          aria-label="Local AI prompt" />
        <button onClick={() => void onAIRequest()} disabled={aiBusy || !aiPrompt.trim()}>
          {aiBusy ? 'Asking local model…' : 'Ask Local AI'}
        </button>
        <pre className="ai-output" role="status" aria-live="polite">
          {aiResponse || 'Local model needed. Start the LM Studio or Ollama API server; suggestions are read-only.'}
        </pre>
      </aside>

      <main className="workspace" style={{ gridTemplateRows: `1fr 6px ${bottomHeight}%` }}>
        <section className="top-panels">
          <article className="panel game-panel" style={{ width: `${leftWidth}%` }}>
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
            <details className="smoke-tools">
              <summary>In-game content smoke test (experimental)</summary>
              <p>Requires trusted Horizon game/control binaries and the official cargo-horizon-mod checker. Checks the .hmod SHA/API/namespace first, then runs a disposable test world and validates inventory slots. Item membership not yet proven. Optionally select a folder prepared by horizon-prepare; otherwise horizon-ctl will try launcher-installed resources.</p>
              <label>
                horizon-ctl path
                <input value={controlPath} onChange={(event) => setControlPath(event.target.value)} placeholder="C:/Horizon/horizon-ctl.exe" />
              </label>
              <label>
                Official cargo-horizon-mod executable
                <input value={checkerPath} onChange={(event) => setCheckerPath(event.target.value)} placeholder="C:/Users/dev/.cargo/bin/cargo-horizon-mod.exe" />
              </label>
              <label>
                Prepared Resources (optional, owner-provided)
                <input value={preparedResourcesPath} onChange={(event) => setPreparedResourcesPath(event.target.value)}
                  placeholder="C:/Horizon/prepared/26.3" />
              </label>
              <label>
                Built .hmod path (inside workspace)
                <input value={packagePath} onChange={(event) => setPackagePath(event.target.value)} placeholder="C:/dev/mod/target/mod.hmod" />
              </label>
              <label>
                Namespaced test item ID
                <input value={targetItemId} onChange={(event) => setTargetItemId(event.target.value)} placeholder="ruby:ruby" />
              </label>
              <button onClick={() => void onVerifyPackage()} disabled={
                smokeBusy || !workspaceRoot || !checkerPath || !packagePath || !targetItemId
              }>Verify .hmod (no game)</button>
              <button onClick={() => void onGameItemSmoke()} disabled={
                smokeBusy || status === 'running' || status === 'launching' ||
                !workspaceRoot || !controlPath || !checkerPath || !gamePath || !packagePath || !targetItemId
              }>
                {smokeBusy ? 'Testing in game…' : 'Test item in disposable world'}
              </button>
              <p role="status" aria-live="polite">{smokeStatus}</p>
            </details>
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
              <button onClick={() => void onBuildContentMod()} disabled={!workspaceRoot || !checkerPath || buildBusy}>
                {buildBusy ? 'Building…' : 'Build .hmod'}
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
