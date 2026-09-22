// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerTeamDialogProps } from './ManagerTeamDialog'
import type { ManagerTeamDefinition } from '../../../../shared/manager-team-contract'

const mocks = vi.hoisted(() => ({ call: vi.fn(), openReport: vi.fn(), resolve: vi.fn() }))
const team: ManagerTeamDefinition = {
  objective: 'Fixture only',
  manager: 'codex',
  workers: [{ name: 'Reviewer', provider: 'claude', model: 'test-model' }]
}
vi.mock('./manager-team-client', () => ({
  callManagerTeam: mocks.call,
  resolveManagerTeamTarget: mocks.resolve,
  managerTeamError: (error: Error) => error.message
}))
vi.mock('@/lib/file-preview', () => ({ openFileInBrowserTab: mocks.openReport }))
vi.mock('./ManagerTeamDialog', () => ({
  ManagerTeamDialog: (props: ManagerTeamDialogProps) => (
    <div>
      <button onClick={() => props.onCreate(team)}>Create fixture</button>
      <button onClick={props.onInspect}>Inspect fixture</button>
      <button onClick={() => props.onOpenChange(false)}>Close fixture</button>
      <span>{props.error}</span>
      <span>{props.status}</span>
      <span>{props.attempted ? 'Attempt saved' : 'No attempt'}</span>
    </div>
  )
}))
import { ManagerTeamButton } from './ManagerTeamButton'
import { readPendingTeam } from './manager-team-pending'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.resolve.mockReturnValue({ target: { kind: 'local' }, label: 'This computer' })
  mocks.openReport.mockReturnValue({ status: 'doc-preview' })
})
afterEach(cleanup)

describe('team creation receipts', () => {
  it('opens from navigation without rendering the old standalone Team button', () => {
    const close = vi.fn()
    render(<ManagerTeamButton worktreeId="folder:one" autoOpen onClose={close} />)
    expect(screen.queryByRole('button', { name: 'New manager team' })).toBeNull()
    expect(screen.getByText('Create fixture')).toBeTruthy()
    fireEvent.click(screen.getByText('Close fixture'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('ignores double submission and opens the report only after the launch call', async () => {
    mocks.call.mockImplementation(async (_host, action) => ({
      run: '/run',
      report: '/report.html',
      stage: action === 'launch' ? 'prompt-accepted' : 'prepared'
    }))
    render(<ManagerTeamButton worktreeId="folder:one" />)
    fireEvent.click(screen.getByRole('button', { name: 'New manager team' }))
    fireEvent.click(screen.getByText('Create fixture'))
    fireEvent.click(screen.getByText('Create fixture'))
    await waitFor(() => expect(mocks.openReport).toHaveBeenCalledTimes(1))
    expect(mocks.call.mock.calls.map((call) => call[1])).toEqual(['prepare', 'launch'])
    expect(mocks.call.mock.calls[0][3]).toEqual(team)
    expect(mocks.call.mock.calls[1][2]).toEqual(mocks.call.mock.calls[0][2])
    expect(screen.queryByText('Create fixture')).toBeNull()
    expect(readPendingTeam('folder:one')).toBeNull()
  })

  it('retains an ambiguous launch across remounts and only inspects it', async () => {
    mocks.call
      .mockResolvedValueOnce({ run: '/run', report: '/report.html', stage: 'prepared' })
      .mockRejectedValueOnce(new Error('Disconnected'))
    const view = render(<ManagerTeamButton worktreeId="folder:one" />)
    fireEvent.click(screen.getByRole('button', { name: 'New manager team' }))
    fireEvent.click(screen.getByText('Create fixture'))
    await screen.findByText('Disconnected')
    const saved = readPendingTeam('folder:one')
    expect(saved?.team).toEqual(team)
    view.unmount()
    mocks.call.mockResolvedValue({
      run: '/run',
      report: '/report.html',
      stage: 'submitting-prompt'
    })
    render(<ManagerTeamButton worktreeId="folder:one" />)
    fireEvent.click(screen.getByRole('button', { name: 'New manager team' }))
    fireEvent.click(screen.getByText('Create fixture'))
    fireEvent.click(screen.getByText('Inspect fixture'))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(3))
    expect(mocks.call.mock.calls[2][1]).toBe('inspect')
    expect(mocks.call.mock.calls[2][2]).toEqual(saved?.run)
    expect(mocks.openReport).not.toHaveBeenCalled()
  })

  it('does not launch when preparation fails and leaves the form usable', async () => {
    mocks.call.mockRejectedValue(new Error('Update this server'))
    render(<ManagerTeamButton worktreeId="folder:one" />)
    fireEvent.click(screen.getByRole('button', { name: 'New manager team' }))
    fireEvent.click(screen.getByText('Create fixture'))
    await screen.findByText('Preparation did not finish. No manager launch was requested.')
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(readPendingTeam('folder:one')).toBeNull()
  })
})
