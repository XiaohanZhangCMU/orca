import { listEnvironments, resolveEnvironment } from '../../shared/runtime-environment-store'
import type {
  BasetenHost,
  BasetenHostRegistration,
  BasetenHostsApi
} from '../../shared/baseten-hosts'
import {
  isRuntimeEnvironmentManuallyDisconnected,
  markRuntimeEnvironmentManuallyDisconnected,
  onRuntimeEnvironmentConnectionIntent,
  onRuntimeEnvironmentConnectionPreparation
} from '../ipc/runtime-environment-manual-disconnect'
import { connectBasetenHost } from './host-connection'
import {
  connectionEnvironment,
  HostConnectionRegistry,
  type HostConnection
} from './host-connection-registry'
import { closeHostTunnel } from './host-tunnels'

type HostService = Pick<BasetenHostsApi, 'access'> & {
  registrations(): Promise<BasetenHostRegistration[]>
}

export class BasetenHostReconnection {
  private readonly registry: HostConnectionRegistry
  private registrations: BasetenHostRegistration[] = []
  private registrationTask: Promise<void> | null = null
  private readonly pending = new Map<string, ReturnType<BasetenHostsApi['connect']>>()
  private readonly intent = new Map<string, boolean>()
  private readonly epochs = new Map<string, number>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly unsubscribe: () => void
  private readonly unprepare: () => void
  private closed = false

  constructor(
    private readonly userDataPath: string,
    private readonly service: HostService
  ) {
    this.registry = new HostConnectionRegistry(userDataPath)
    const environments = listEnvironments(userDataPath)
    for (const connection of this.registry.list()) {
      if (!connection.reconnect && connectionEnvironment(connection, environments)) {
        markRuntimeEnvironmentManuallyDisconnected(connection.environmentId)
      }
    }
    this.unsubscribe = onRuntimeEnvironmentConnectionIntent((id, disconnected) => {
      this.intent.set(id, !disconnected)
      const affected = this.registry.list().filter((connection) => connection.environmentId === id)
      this.registry.setIntent(id, !disconnected, listEnvironments(this.userDataPath))
      for (const connection of affected) {
        if (disconnected || !this.binding(connection.name)) {
          this.epochs.set(connection.name, (this.epochs.get(connection.name) ?? 0) + 1)
          this.cancelRetry(connection.name)
          closeHostTunnel(connection.name)
        }
      }
    })
    this.unprepare = onRuntimeEnvironmentConnectionPreparation(async (id) => {
      if (
        !this.registry
          .list()
          .some((host) => host.environmentId === id && host.management === 'installer')
      ) {
        return
      }
      await this.refreshRegistrations()
      const connection = this.registry
        .list()
        .find(
          (host) =>
            host.environmentId === id && host.management === 'installer' && this.binding(host.name)
        )
      if (connection) {
        await this.connect(connection.name)
      }
    })
  }

  async refreshRegistrations(): Promise<void> {
    if (!this.registrationTask) {
      this.registrationTask = this.service
        .registrations()
        .then((registrations) => {
          if (this.closed) {
            return
          }
          this.registrations = registrations
          this.registry.reconcile(
            registrations,
            listEnvironments(this.userDataPath),
            (id) =>
              this.intent.get(id) ??
              (isRuntimeEnvironmentManuallyDisconnected(id) ? false : undefined)
          )
        })
        .finally(() => {
          this.registrationTask = null
        })
    }
    await this.registrationTask
  }

  private binding(name: string): HostConnection | undefined {
    const registration = this.registrations.find((host) => host.name === name)
    const connection = this.registry.list().find((host) => host.name === name)
    return registration &&
      connection &&
      registration.instance === connection.instance &&
      registration.management === connection.management &&
      (!registration.publicKeyB64 || registration.publicKeyB64 === connection.publicKeyB64) &&
      connectionEnvironment(connection, listEnvironments(this.userDataPath))
      ? connection
      : undefined
  }

  decorate(hosts: BasetenHost[]): BasetenHost[] {
    return hosts.map((host) => {
      const connection = this.binding(host.name)
      return {
        ...host,
        ...(connection?.verified ? { environmentId: connection.environmentId } : {}),
        reconnecting: this.pending.has(host.name)
      }
    })
  }

  async start(): Promise<void> {
    await this.refreshRegistrations()
    if (this.closed) {
      return
    }
    const hosts = this.registry
      .list()
      .filter(
        (connection) =>
          connection.management === 'installer' &&
          connection.reconnect &&
          this.binding(connection.name)
      )
    const drain = async () => {
      for (let host = hosts.shift(); host && !this.closed; host = hosts.shift()) {
        await this.restore(host.name, 0)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, hosts.length) }, drain))
  }

  private async restore(name: string, attempt: number): Promise<void> {
    const connection = this.binding(name)
    if (
      this.closed ||
      !connection?.reconnect ||
      isRuntimeEnvironmentManuallyDisconnected(connection.environmentId)
    ) {
      return
    }
    try {
      await this.connect(name, false)
    } catch {
      if (this.closed || !this.binding(name)?.reconnect) {
        return
      }
      // Never log worker errors here: a failed access operation can carry a private pairing link.
      console.warn(
        `[baseten-hosts] Could not restore ${name}; use Connect if retries do not recover it.`
      )
      if (attempt < 2) {
        const timer = setTimeout(
          () => {
            this.retries.delete(name)
            void this.restore(name, attempt + 1)
          },
          attempt === 0 ? 10_000 : 30_000
        )
        timer.unref()
        this.retries.set(name, timer)
      }
    }
  }

  connect(name: string, explicit = true): ReturnType<BasetenHostsApi['connect']> {
    const pending = this.pending.get(name)
    if (pending) {
      return pending
    }
    this.cancelRetry(name)
    const task = this.connectOnce(name, explicit).finally(() => this.pending.delete(name))
    this.pending.set(name, task)
    return task
  }

  private async connectOnce(
    name: string,
    explicit: boolean
  ): ReturnType<BasetenHostsApi['connect']> {
    const epoch = this.epochs.get(name) ?? 0
    await this.refreshRegistrations()
    const registration = this.registrations.find((host) => host.name === name)
    if (!registration || this.closed) {
      throw new Error('Host registration is unavailable. Refresh and try again.')
    }
    const connection = this.binding(name)
    if (
      !explicit &&
      (!connection?.reconnect || isRuntimeEnvironmentManuallyDisconnected(connection.environmentId))
    ) {
      throw new Error('Host connection was cancelled.')
    }
    const isCurrent = () =>
      !this.closed &&
      (this.epochs.get(name) ?? 0) === epoch &&
      (!connection ||
        Boolean(connectionEnvironment(connection, listEnvironments(this.userDataPath)))) &&
      (explicit || Boolean(this.binding(name)?.reconnect))
    try {
      const result = await connectBasetenHost(
        this.userDataPath,
        name,
        () => this.service.access(name),
        {
          environmentId: connection?.environmentId,
          isCurrent
        }
      )
      if (!isCurrent()) {
        throw new Error('Host connection was cancelled.')
      }
      this.registry.remember(
        registration,
        resolveEnvironment(this.userDataPath, result.environment.id)
      )
      return result
    } finally {
      if (!isCurrent()) {
        closeHostTunnel(name)
      }
    }
  }

  disconnect(name: string): void {
    const connection = this.binding(name)
    this.epochs.set(name, (this.epochs.get(name) ?? 0) + 1)
    this.cancelRetry(name)
    if (connection) {
      markRuntimeEnvironmentManuallyDisconnected(connection.environmentId)
    }
    closeHostTunnel(name)
  }

  private cancelRetry(name: string): void {
    clearTimeout(this.retries.get(name))
    this.retries.delete(name)
  }

  dispose(): void {
    this.closed = true
    this.unsubscribe()
    this.unprepare()
    for (const name of this.retries.keys()) {
      this.cancelRetry(name)
    }
  }
}
