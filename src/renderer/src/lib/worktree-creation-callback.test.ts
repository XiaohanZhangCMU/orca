import { afterEach, expect, it, vi } from 'vitest'
import type { PendingWorktreeCreation, WorktreeCreationRequest } from './pending-worktree-creation'

const creations: Record<string, PendingWorktreeCreation> = {}
const store = {
  pendingWorktreeCreations: creations,
  activeView: 'terminal',
  activePendingCreationId: 'callback-test',
  beginPendingWorktreeCreation: (entry: PendingWorktreeCreation) => {
    creations[entry.creationId] = entry
  },
  updatePendingWorktreeCreation: (id: string, patch: Partial<PendingWorktreeCreation>) => {
    creations[id] = { ...creations[id], ...patch }
  },
  setActivePendingWorktreeCreation: vi.fn(),
  setActiveView: vi.fn(),
  setSidebarOpen: vi.fn()
}
vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('./browser-uuid', () => ({ createBrowserUuid: () => 'callback-test' }))
vi.mock('./worktree-creation-flow-startup', () => ({
  getInitialWorktreeCreationPhase: () => 'fetching',
  getWorktreeCreationIndeterminate: () => false
}))
vi.mock('./worktree-creation-flow-execute', () => ({ executeWorktreeCreation: vi.fn() }))

import { executeWorktreeCreation } from './worktree-creation-flow-execute'
import {
  retryBackgroundWorktreeCreation,
  runBackgroundWorktreeCreation
} from './worktree-creation-flow'

afterEach(() => vi.restoreAllMocks())

it('delivers the exact created workspace ID after a retry, once, without using focus', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const request: WorktreeCreationRequest = {
    repoId: 'repo-1',
    name: 'feature',
    setupDecision: 'inherit',
    agent: null,
    pendingFirstAgentMessageRename: false,
    note: '',
    startupPlan: null,
    quickPrompt: '',
    quickTelemetry: null
  }
  const onCreated = vi.fn()
  vi.mocked(executeWorktreeCreation).mockRejectedValueOnce(new Error('Temporary create failure'))
  const creationId = runBackgroundWorktreeCreation(request, onCreated)
  await vi.waitFor(() => expect(creations[creationId]?.status).toBe('error'))
  expect(onCreated).not.toHaveBeenCalled()
  vi.mocked(executeWorktreeCreation).mockImplementationOnce(async (_id, _request, completed) => {
    completed?.('created-workspace')
    completed?.('created-workspace')
  })
  retryBackgroundWorktreeCreation(creationId)
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith('created-workspace'))
})
