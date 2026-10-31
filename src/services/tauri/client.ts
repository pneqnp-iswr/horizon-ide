import { invoke } from '@tauri-apps/api/core';
import type { BuildResult, DocumentSnapshot, FileEntry, GameStatus, HorizonInstallationReport } from '../../types/app';

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
