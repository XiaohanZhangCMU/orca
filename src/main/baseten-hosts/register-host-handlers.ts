import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { basetenSetupSchema } from '../../shared/baseten-hosts'
import { isTrustedBrowserRenderer } from '../ipc/browser-renderer-trust'
import { basetenHostService } from './host-service'
import { closeHostTunnels } from './host-tunnels'
import { BasetenHostReconnection } from './host-reconnection'

const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('defaults') }).strict(),
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('check'), setup: basetenSetupSchema }).strict(),
  z
    .object({ operation: z.literal('create'), ticket: z.string().uuid(), consent: z.boolean() })
    .strict(),
  z.object({ operation: z.literal('access'), name: basetenSetupSchema.shape.name }).strict(),
  z.object({ operation: z.literal('connect'), name: basetenSetupSchema.shape.name }).strict(),
  z.object({ operation: z.literal('phone'), name: basetenSetupSchema.shape.name }).strict(),
  z
    .object({
      operation: z.literal('release'),
      name: basetenSetupSchema.shape.name,
      instance: z.string().uuid(),
      confirmation: basetenSetupSchema.shape.name
    })
    .strict(),
  z
    .object({
      operation: z.literal('enablePhone'),
      name: basetenSetupSchema.shape.name,
      allowedIps: z.array(z.string().max(64)).min(1).max(16)
    })
    .strict()
])
export function registerBasetenHostHandlers(): void {
  let connections: BasetenHostReconnection | undefined
  try {
    connections = new BasetenHostReconnection(app.getPath('userData'), basetenHostService)
    void connections.start().catch(() => {
      console.warn(
        '[baseten-hosts] Startup reconnection is unavailable. Use Connect in host settings.'
      )
    })
  } catch {
    console.warn(
      '[baseten-hosts] Could not read connection preferences; automatic reconnection is disabled.'
    )
  }
  const connectionManager = () => {
    if (!connections) {
      throw new Error(
        'Could not read Baseten connection preferences. Restore baseten-host-connections.json from a backup before reconnecting.'
      )
    }
    return connections
  }
  ipcMain.removeHandler('basetenHosts:request')
  ipcMain.handle('basetenHosts:request', async (event, input: unknown) => {
    if (!isTrustedBrowserRenderer(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Host setup is only available in the trusted desktop settings window.')
    }
    const request = requestSchema.parse(input)
    switch (request.operation) {
      case 'defaults':
        return basetenHostService.defaults()
      case 'list':
        await connectionManager().refreshRegistrations()
        return connectionManager().decorate(await basetenHostService.list())
      case 'check':
        return basetenHostService.check(request.setup)
      case 'create':
        return basetenHostService.create(request.ticket, request.consent)
      case 'access':
        return basetenHostService.access(request.name)
      case 'connect':
        return connectionManager().connect(request.name)
      case 'phone':
        return basetenHostService.phone(request.name)
      case 'enablePhone':
        return basetenHostService.enablePhone(request.name, request.allowedIps)
      case 'release':
        await basetenHostService.release(request.name, request.instance, request.confirmation)
        connections?.disconnect(request.name)
    }
  })
  app.once('before-quit', () => {
    connections?.dispose()
    closeHostTunnels()
  })
}
