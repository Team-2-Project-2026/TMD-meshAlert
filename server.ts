
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import os from 'os';
import { Bonjour } from 'bonjour-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Return all non-internal IPv4 addresses for this machine. */
function getLocalIPs(): string[] {
  const results: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) results.push(iface.address);
    }
  }
  return results;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const PORT = 3000;

  // ── Mesh State ────────────────────────────────────────────────────────────
  const peers = new Map<string, any>();
  let stats = {
    messagesSeen: 0,
    broadcastsPropagated: 0,
    startTime: Date.now(),
  };

  // ── Socket.io Events ──────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log('Peer connected:', socket.id);

    socket.on('peer:join', (peer) => {
      peers.set(socket.id, { ...peer, socketId: socket.id, lastSeen: Date.now() });
      io.emit('mesh:peers', Array.from(peers.values()));
    });

    socket.on('peer:update', (update) => {
      if (peers.has(socket.id)) {
        peers.set(socket.id, { ...peers.get(socket.id), ...update, lastSeen: Date.now() });
        io.emit('mesh:peers', Array.from(peers.values()));
      }
    });

    socket.on('mesh:broadcast', (data) => {
      stats.messagesSeen++;
      stats.broadcastsPropagated++;
      socket.broadcast.emit('mesh:receive_broadcast', data);
    });

    socket.on('mesh:direct', ({ to, msg, replyToId, isEncrypted, iv, wrappedKey }) => {
      stats.messagesSeen++;
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('mesh:receive_direct', {
          from: peers.get(socket.id)?.id || socket.id,
          msg,
          replyToId,
          isEncrypted,
          iv,
          wrappedKey,
        });
      }
    });

    socket.on('mesh:sync_request', ({ to, lastHash }) => {
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('mesh:receive_sync_request', {
          from: peers.get(socket.id)?.id || socket.id,
          lastHash,
        });
      }
    });

    socket.on('mesh:sync_response', ({ to, history }) => {
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('mesh:receive_sync_response', {
          from: peers.get(socket.id)?.id || socket.id,
          history,
        });
      }
    });

    // ── WebRTC Signaling (pure relay — server never inspects offer/answer) ──
    socket.on('webrtc:offer', ({ to, offer }) => {
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('webrtc:offer', {
          from: peers.get(socket.id)?.id,
          offer,
        });
      }
    });

    socket.on('webrtc:answer', ({ to, answer }) => {
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('webrtc:answer', {
          from: peers.get(socket.id)?.id,
          answer,
        });
      }
    });

    socket.on('webrtc:ice', ({ to, candidate }) => {
      const recipient = Array.from(peers.values()).find((p) => p.id === to);
      if (recipient?.socketId) {
        socket.to(recipient.socketId).emit('webrtc:ice', {
          from: peers.get(socket.id)?.id,
          candidate,
        });
      }
    });

    socket.on('disconnect', () => {
      peers.delete(socket.id);
      io.emit('mesh:peers', Array.from(peers.values()));
    });
  });

  // ── REST API ──────────────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      peers: peers.size,
      stats: { ...stats, uptime: Math.floor((Date.now() - stats.startTime) / 1000) },
    });
  });

  app.get('/api/network-info', (_req, res) => {
    const ips = getLocalIPs();
    res.json({ ips, port: PORT });
  });

  // ── Vite (dev) / Static (prod) ────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log(`\n🔴 Beacon Mesh server running`);
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const ip of ips) {
      console.log(`   Network: http://${ip}:${PORT}`);
    }
    console.log('');

    // Advertise via mDNS so devices on the same LAN can discover without knowing the IP.
    // Resolves as beacon-mesh.local on macOS/iOS/Linux (Avahi).
    try {
      const bonjour = new Bonjour();
      bonjour.publish({ name: 'beacon-mesh', type: 'http', port: PORT });
      console.log(`   mDNS:    http://beacon-mesh.local:${PORT}  (LAN devices only)\n`);
    } catch (e) {
      // mDNS is best-effort — never block server startup
      console.warn('   mDNS unavailable:', (e as Error).message);
    }
  });
}

startServer();
