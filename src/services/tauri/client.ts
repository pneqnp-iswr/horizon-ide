import { invoke } from '@tauri-apps/api/core';
import type { BuildResult, ContentAttestation, ContentBuildResult, CreatedContentProject, DocumentSnapshot, FileEntry, GameItemSmokeReport, GameStatus, HorizonInstallationReport, LocalAiAnswer, LocalAiModels } from '../../types/app';

export async function setWorkspaceRoot(path: string): Promise<void> {
  await invoke('set_workspace_root', { path });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { path });
}

export async function readTextFile(path: string): Promise<DocumentSnapshot> {
  return invoke<DocumentSnapshot>('read_document', { path });
}

export async function saveTextFile(path: string, contents: string, expectedRevision: string): Promise<DocumentSnapshot> {
  return invoke<DocumentSnapshot>('write_document', { path, contents, expectedRevision });
}

export async function inspectHorizonClient(executablePath: string): Promise<HorizonInstallationReport> {
  return invoke<HorizonInstallationReport>('inspect_horizon_client', { executablePath });
}

export async function launchGame(executablePath: string, args: string[]): Promise<GameStatus> {
  return invoke<GameStatus>('launch_game', { request: { executablePath, args } });
}

export async function stopGame(): Promise<void> {
  await invoke('stop_game');
}

export async function getGameStatus(): Promise<GameStatus> {
  return invoke<GameStatus>('get_game_status');
}

export async function runBuild(workspacePath: string, approved: boolean): Promise<BuildResult> {
  return invoke<BuildResult>('run_build', { workspacePath, approved });
}

export async function cancelBuild(): Promise<boolean> {
  return invoke<boolean>('cancel_build');
}

export async function runGameItemSmoke(
  ctlPath: string,
  gamePath: string,
  checkerPath: string,
  packagePath: string,
  itemId: string,
  resourcesPath: string | null,
  approved: boolean,
): Promise<GameItemSmokeReport> {
  return invoke<GameItemSmokeReport>('run_game_item_smoke', {
    ctlPath, gamePath, checkerPath, packagePath, itemId, resourcesPath, approved,
  });
}

/** Run the trusted official package checker without starting a game. */
export async function checkHmodPackage(
  checkerPath: string,
  packagePath: string,
  itemId: string,
  approved: boolean,
): Promise<ContentAttestation> {
  return invoke<ContentAttestation>('check_hmod_package', {
    checkerPath, packagePath, itemId, approved,
  });
}

export async function createContentStarter(
  toolPath: string,
  parentWorkspace: string,
  name: string,
  approved: boolean,
): Promise<CreatedContentProject> {
  return invoke<CreatedContentProject>('create_content_starter', {
    toolPath, parentWorkspace, name, approved,
  });
}

export async function buildContentMod(toolPath: string, workspacePath: string, approved: boolean): Promise<ContentBuildResult> {
  return invoke<ContentBuildResult>('build_content_mod', { toolPath, workspacePath, approved });
}

/** Native loopback-only inference (LM Studio or Ollama), never hosted by IDE. */
export async function askLocalAi(
  provider: 'lmstudio' | 'ollama',
  model: string,
  prompt: string,
  document: string | null,
  approved: boolean,
): Promise<LocalAiAnswer> {
  return invoke<LocalAiAnswer>('ask_local_ai', {
    provider, model, prompt, document, approved,
  });
}

/** Discovers IDs from the selected loopback provider, without editor content. */
export async function listLocalAiModels(provider: 'lmstudio' | 'ollama'): Promise<LocalAiModels> {
  return invoke<LocalAiModels>('list_local_ai_models', { provider });
}
