export type GameStatus = 'disconnected' | 'launching' | 'running' | 'error';

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
}

export interface BuildDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  file?: string;
  line?: number;
}

export interface BuildResult {
  success: boolean;
  cancelled: boolean;
  timedOut: boolean;
  outputTruncated: boolean;
  output: string;
  diagnostics: BuildDiagnostic[];
}

export interface HorizonInstallationReport {
  launchApi: string;
  horizon: string | null;
  minecraft: string | null;
  compatibleForPreview: boolean;
  gameLoadVerified: false;
  embeddedViewportVerified: false;
}

/** Exact content-addressed revision used for optimistic conflict detection. */
export interface DocumentSnapshot {
  contents: string;
  revision: string;
}
