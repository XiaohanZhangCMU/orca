import { decodePairingOffer, encodePairingOffer } from '../../../src/shared/pairing'
import { validatePort } from './host-config'

export function tunnelPairingLink(link: string, port: number): string {
  validatePort(port)
  const offer = decodePairingOffer(link.trim())
  if (offer.endpoint !== 'ws://127.0.0.1:6770' || offer.scope !== 'runtime' || offer.relay) {
    throw new Error('Expected this installer’s loopback runtime offer; no credentials were changed')
  }
  return encodePairingOffer({ ...offer, endpoint: `ws://127.0.0.1:${port}` })
}
