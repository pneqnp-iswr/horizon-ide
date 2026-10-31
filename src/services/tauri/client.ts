import { invoke } from '@tauri-apps/api/core';
import type { BuildResult, FileEntry, GameStatus } from '../../types/app';

export async function setWorkspaceRoot(path: string): Promise<void> {
  await invoke('set_workspace_root', { path });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { path });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path });
}

export async function saveTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_text_file', { path, contents });
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

export async function runBuild(workspacePath: string): Promise<BuildResult> {
  return invoke<BuildResult>('run_build', { workspacePath });
}
