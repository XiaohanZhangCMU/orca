import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeSecureJsonFileWithinLimit } from '../../shared/bounded-secure-json-file'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  getPreferredPairingOffer,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type { BasetenHostRegistration } from '../../shared/baseten-hosts'

const schema = z.object({
  version: z.literal(1),
  connections: z.array(
    z.object({
      name: z.string(),
      management: z.enum(['installer', 'legacy']),
      instance: z.string().optional(),
      environmentId: z.string(),
      publicKeyB64: z.string(),
      verified: z.boolean().default(false),
      reconnect: z.boolean()
    })
  )
})
export type HostConnection = z.infer<typeof schema>['connections'][number]
const MAX_BYTES = 1024 * 1024

export function connectionEnvironment(
  connection: HostConnection,
  environments: KnownRuntimeEnvironment[]
): KnownRuntimeEnvironment | undefined {
  return environments.find(
    (environment) =>
      environment.id === connection.environmentId &&
      getPreferredPairingOffer(environment).publicKeyB64 === connection.publicKeyB64
  )
}

export class HostConnectionRegistry {
  private readonly path: string
  private connections: HostConnection[]

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'baseten-host-connections.json')
    this.connections = existsSync(this.path)
      ? schema.parse(
          JSON.parse(readNodeFileSyncWithinLimit(this.path, MAX_BYTES).buffer.toString('utf8'))
        ).connections
      : []
  }

  list(): HostConnection[] {
    return this.connections
  }

  private save(connections: HostConnection[]): void {
    if (JSON.stringify(connections) === JSON.stringify(this.connections)) {
      return
    }
    writeSecureJsonFileWithinLimit(this.path, { version: 1, connections }, MAX_BYTES)
    this.connections = connections
  }

  reconcile(
    registrations: BasetenHostRegistration[],
    environments: KnownRuntimeEnvironment[],
    intent: (id: string) => boolean | undefined
  ): void {
    const connections = this.connections.filter((connection) =>
      connectionEnvironment(connection, environments)
    )
    for (const registration of registrations) {
      const previous = this.connections.find((connection) => connection.name === registration.name)
      if (previous) {
        if (
          previous.instance !== registration.instance ||
          previous.management !== registration.management ||
          !connectionEnvironment(previous, environments) ||
          (registration.publicKeyB64 && registration.publicKeyB64 !== previous.publicKeyB64)
        ) {
          continue
        }
        const index = connections.findIndex((connection) => connection.name === previous.name)
        connections[index] = {
          ...previous,
          verified: previous.verified || registration.publicKeyB64 === previous.publicKeyB64,
          reconnect: intent(previous.environmentId) ?? previous.reconnect
        }
        continue
      }
      const matches = environments.filter((environment) =>
        registration.publicKeyB64
          ? getPreferredPairingOffer(environment).publicKeyB64 === registration.publicKeyB64
          : registration.management === 'installer' && environment.name === registration.name
      )
      const environment = matches.length === 1 ? matches[0] : undefined
      if (!environment || !registration.management) {
        continue
      }
      connections.push({
        ...registration,
        management: registration.management,
        publicKeyB64: getPreferredPairingOffer(environment).publicKeyB64,
        // A name-only candidate must authenticate the saved key before it owns a UI row.
        verified: Boolean(registration.publicKeyB64),
        environmentId: environment.id,
        reconnect: intent(environment.id) ?? environment.lastUsedAt !== null
      })
    }
    this.save(connections)
  }

  remember(registration: BasetenHostRegistration, environment: KnownRuntimeEnvironment): void {
    if (!registration.management) {
      return
    }
    this.save([
      ...this.connections.filter((connection) => connection.name !== registration.name),
      {
        ...registration,
        management: registration.management,
        environmentId: environment.id,
        publicKeyB64: getPreferredPairingOffer(environment).publicKeyB64,
        verified: true,
        reconnect: true
      }
    ])
  }

  setIntent(
    environmentId: string,
    reconnect: boolean,
    environments: KnownRuntimeEnvironment[]
  ): void {
    this.save(
      this.connections
        .filter((connection) => connectionEnvironment(connection, environments))
        .map((connection) =>
          connection.environmentId === environmentId ? { ...connection, reconnect } : connection
        )
    )
  }
}
