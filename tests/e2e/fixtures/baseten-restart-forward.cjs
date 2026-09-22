#!/usr/bin/env node
const net = require('node:net')
const port = Number(process.argv.at(-1).split(':')[0])
const sockets = new Set()
const server = net.createServer((client) => {
  const target = net.connect(Number(process.env.ORCA_BASETEN_FIXTURE_PORT), '127.0.0.1')
  sockets.add(client)
  sockets.add(target)
  client.once('close', () => {
    sockets.delete(client)
    target.destroy()
  })
  target.once('close', () => {
    sockets.delete(target)
    client.destroy()
  })
  client.on('error', () => target.destroy())
  target.on('error', () => client.destroy())
  client.pipe(target).pipe(client)
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Forwarding from 127.0.0.1:${port}\n`))
process.on('SIGTERM', () => {
  for (const socket of sockets) {
    socket.destroy()
  }
  server.close(() => process.exit(0))
})
