import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceSettings {
  theme: 'dark' | 'light';
  workspaceRoot: string;
  setTheme: (theme: 'dark' | 'light') => void;
  setWorkspaceRoot: (path: string) => void;
}

export const useWorkspaceStore = create<WorkspaceSettings>()(
  persist(
    (set) => ({
      theme: 'dark',
      workspaceRoot: '',
      setTheme: (theme) => set({ theme }),
      setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
    }),
    { name: 'horizon-ide-settings' },
  ),
);
