import net from 'node:net'

// TCP endpoints that stand in for a Redis server in each state the cache has to survive.

const listen = (server: net.Server, port = 0): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve((server.address() as net.AddressInfo).port)
    })
  })

// A port nothing listens on: connecting is refused, as with a stopped Redis.
export const refusedPort = async (): Promise<number> => {
  const server = net.createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  return port
}

// Accepts connections and never answers: the handshake never completes, as with a Redis that
// hangs or a host whose packets are dropped after the TCP connect.
export const silentServer = async () => {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
  })
  const port = await listen(server)
  const close = async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  return { port, close }
}

// Accepts every connection and closes it at once, counting connection attempts.
export const closingServer = async () => {
  let connections = 0
  const server = net.createServer((socket) => {
    connections++
    socket.destroy()
  })
  const port = await listen(server)
  const close = () => new Promise((resolve) => server.close(resolve))
  return { port, connections: () => connections, close }
}

// Forwards to a real Redis and can drop every connection (Redis going away), hold the requests
// it receives (a command in flight when the connection drops), and come back on the same port.
export const redisProxy = async (target: { host: string; port: number }) => {
  const sockets = new Set<net.Socket>()
  let held = false
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host)
    sockets.add(client)
    sockets.add(upstream)
    const end = () => {
      client.destroy()
      upstream.destroy()
      sockets.delete(client)
      sockets.delete(upstream)
    }
    client.on('data', (data) => {
      if (!held) upstream.write(data)
    })
    upstream.pipe(client)
    client.on('error', end).on('close', end)
    upstream.on('error', end).on('close', end)
  })
  const port = await listen(server)
  return {
    port,
    hold: () => {
      held = true
    },
    drop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
    restore: async () => {
      held = false
      await listen(server, port)
    },
  }
}
