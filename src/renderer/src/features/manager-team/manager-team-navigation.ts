import { create } from 'zustand'

export const useManagerTeamNavigation = create<{
  worktreeId: string | null
  open: (worktreeId: string) => void
  close: () => void
}>((set) => ({
  worktreeId: null,
  open: (worktreeId) => set({ worktreeId }),
  close: () => set({ worktreeId: null })
}))

export function openManagerTeam(worktreeId: string): void {
  useManagerTeamNavigation.getState().open(worktreeId)
}
