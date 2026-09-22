import type { ClusterConfig } from './cluster-config'

export function clusterResources(config: ClusterConfig, instance: string) {
  const labels = {
    app: config.name,
    'orca.dev/instance': instance,
    'orca.dev/managed-by': 'pod-setup'
  }
  const metadata = (name: string) => ({ name, namespace: config.namespace, labels })
  const home = '/home/orca'
  const initialize = `
const fs = require('node:fs');
const home = ${JSON.stringify(home)};
const owner = home + '/.orca-cluster-owner.json';
const instance = ${JSON.stringify(instance)};
if (fs.existsSync(owner)) {
  if (JSON.parse(fs.readFileSync(owner, 'utf8')).instance !== instance) throw Error('Volume belongs to another installation');
} else {
  if (fs.readdirSync(home).filter(name => name !== 'lost+found').length) throw Error('Refusing a nonempty unmanaged home');
  fs.writeFileSync(owner, JSON.stringify({ instance }), { flag: 'wx', mode: 0o600 });
  fs.chownSync(owner, 1001, 1001);
}
fs.chownSync(home, 1001, 1001); fs.chmodSync(home, 0o700);
for (const [name, row] of [['passwd', 'orca:x:1001:1001:Orca:/home/orca:/bin/bash'], ['group', 'orca:x:1001:']]) {
  const original = fs.readFileSync('/etc/' + name, 'utf8');
  if (original.split('\\n').some(line => line.split(':')[2] === '1001' || line.startsWith('orca:'))) throw Error('Image account collision');
  fs.writeFileSync('/identity/' + name, original.trimEnd() + '\\n' + row + '\\n', { mode: 0o644 });
}
`
  const supervisor = `
const fs = require('node:fs');
const child = require('node:child_process');
const launch = '/home/orca/.local/state/orca-cluster/launch.cjs';
let started = false;
setInterval(() => {
  if (started || !fs.existsSync(launch)) return;
  started = true;
  const process = child.spawn('/usr/local/bin/node', [launch], { stdio: 'inherit' });
  process.on('exit', code => { if (code) console.error('Orca startup failed; run the setup status command.'); });
}, 2000);
`
  return [
    ...(config.persistent
      ? [
          {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: metadata(`${config.name}-home`),
            spec: {
              accessModes: ['ReadWriteOnce'],
              storageClassName: config.storageClass,
              resources: { requests: { storage: config.storage } }
            }
          }
        ]
      : []),
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: metadata(config.name),
      spec: {
        replicas: 1,
        strategy: { type: 'Recreate' },
        selector: { matchLabels: { 'orca.dev/instance': instance } },
        template: {
          metadata: { labels },
          spec: {
            nodeSelector: { 'kubernetes.io/os': 'linux', 'kubernetes.io/arch': 'amd64' },
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1001,
              runAsGroup: 1001,
              seccompProfile: { type: 'RuntimeDefault' }
            },
            initContainers: [
              {
                name: 'initialize-home',
                image: config.image,
                command: ['node', '-e', initialize],
                securityContext: {
                  runAsNonRoot: false,
                  runAsUser: 0,
                  runAsGroup: 0,
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'], add: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'] }
                },
                volumeMounts: [
                  { name: 'home', mountPath: home },
                  { name: 'identity', mountPath: '/identity' }
                ]
              }
            ],
            containers: [
              {
                name: 'orca',
                image: config.image,
                workingDir: home,
                command: ['node', '-e', supervisor],
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'] }
                },
                env: [
                  { name: 'HOME', value: home },
                  { name: 'USER', value: 'orca' },
                  { name: 'LOGNAME', value: 'orca' },
                  { name: 'ORCA_BACKGROUND_LAUNCH', value: '1' }
                ],
                resources: {
                  requests: {
                    cpu: config.cpuRequest,
                    memory: config.memoryRequest,
                    'ephemeral-storage': '20Gi'
                  },
                  limits: {
                    cpu: config.cpuLimit,
                    memory: config.memoryLimit,
                    'ephemeral-storage': '200Gi'
                  }
                },
                volumeMounts: [
                  { name: 'home', mountPath: home },
                  { name: 'identity', mountPath: '/etc/passwd', subPath: 'passwd', readOnly: true },
                  { name: 'identity', mountPath: '/etc/group', subPath: 'group', readOnly: true },
                  { name: 'shm', mountPath: '/dev/shm' }
                ],
                readinessProbe: {
                  exec: {
                    command: [
                      '/usr/local/bin/node',
                      `${home}/.local/share/orca-pod-host/host-control.cjs`,
                      'status'
                    ]
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 20,
                  timeoutSeconds: 25,
                  failureThreshold: 3
                }
              }
            ],
            volumes: [
              config.persistent
                ? { name: 'home', persistentVolumeClaim: { claimName: `${config.name}-home` } }
                : { name: 'home', emptyDir: { sizeLimit: config.storage } },
              { name: 'identity', emptyDir: {} },
              { name: 'shm', emptyDir: { medium: 'Memory', sizeLimit: '2Gi' } }
            ]
          }
        }
      }
    }
  ]
}
