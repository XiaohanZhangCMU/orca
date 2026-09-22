import { ipcRenderer } from 'electron'
import type { BasetenHostsApi } from '../../shared/baseten-hosts'

export const basetenHostsApi: BasetenHostsApi = {
  defaults: () => ipcRenderer.invoke('basetenHosts:request', { operation: 'defaults' }),
  list: () => ipcRenderer.invoke('basetenHosts:request', { operation: 'list' }),
  check: (setup) => ipcRenderer.invoke('basetenHosts:request', { operation: 'check', setup }),
  create: (ticket, consent) =>
    ipcRenderer.invoke('basetenHosts:request', { operation: 'create', ticket, consent }),
  access: (name) => ipcRenderer.invoke('basetenHosts:request', { operation: 'access', name }),
  connect: (name) => ipcRenderer.invoke('basetenHosts:request', { operation: 'connect', name }),
  phone: (name) => ipcRenderer.invoke('basetenHosts:request', { operation: 'phone', name }),
  enablePhone: (name, allowedIps) =>
    ipcRenderer.invoke('basetenHosts:request', { operation: 'enablePhone', name, allowedIps }),
  release: (name, instance, confirmation) =>
    ipcRenderer.invoke('basetenHosts:request', {
      operation: 'release',
      name,
      instance,
      confirmation
    })
}
