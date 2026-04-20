import type { Socket } from 'socket.io-client';

type MessageHandler = (from: string, data: unknown) => void;
type StateChangeHandler = (peerId: string, connected: boolean) => void;

/**
 * WebRTCMesh manages direct browser-to-browser DataChannel connections.
 *
 * Architecture:
 *   - Socket.io is used ONLY for signaling (offer/answer/ICE exchange).
 *   - Once a DataChannel is open, messages flow peer-to-peer — no server hop.
 *   - On LAN, ICE "host candidates" (local IPs) are sufficient; no STUN/TURN needed.
 *   - If the central server goes down, open DataChannels keep working.
 *   - All message routing falls back to Socket.io if no DataChannel exists.
 */
export class WebRTCMesh {
  private connections = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private messageHandler: MessageHandler = () => {};
  private stateChangeHandler: StateChangeHandler = () => {};
  private socket: Socket;
  private myId: string;
  private destroyed = false;

  constructor(socket: Socket, myId: string) {
    this.socket = socket;
    this.myId = myId;
    this.setupSignaling();
  }

  // ── Signaling (runs over Socket.io) ──────────────────────────────────────

  private setupSignaling() {
    this.socket.on('webrtc:offer', this.handleOffer);
    this.socket.on('webrtc:answer', this.handleAnswer);
    this.socket.on('webrtc:ice', this.handleIce);
  }

  private teardownSignaling() {
    this.socket.off('webrtc:offer', this.handleOffer);
    this.socket.off('webrtc:answer', this.handleAnswer);
    this.socket.off('webrtc:ice', this.handleIce);
  }

  private handleOffer = async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
    if (this.destroyed) return;
    try {
      const pc = this.getOrCreatePeer(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('webrtc:answer', { to: from, answer });
      // Flush any queued ICE candidates
      const queued = this.pendingCandidates.get(from) ?? [];
      for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      this.pendingCandidates.delete(from);
    } catch (e) {
      console.warn('[WebRTC] handleOffer error', e);
    }
  };

  private handleAnswer = async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
    if (this.destroyed) return;
    try {
      const pc = this.connections.get(from);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (e) {
      console.warn('[WebRTC] handleAnswer error', e);
    }
  };

  private handleIce = async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
    if (this.destroyed) return;
    try {
      const pc = this.connections.get(from);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        // Queue until remote description is set
        const q = this.pendingCandidates.get(from) ?? [];
        q.push(candidate);
        this.pendingCandidates.set(from, q);
      }
    } catch (e) {
      console.warn('[WebRTC] handleIce error', e);
    }
  };

  // ── Peer Connection Management ────────────────────────────────────────────

  private getOrCreatePeer(peerId: string, isInitiator: boolean): RTCPeerConnection {
    const existing = this.connections.get(peerId);
    if (existing && existing.connectionState !== 'failed' && existing.connectionState !== 'closed') {
      return existing;
    }
    existing?.close();

    const pc = new RTCPeerConnection({
      // No STUN/TURN — LAN only. Host ICE candidates are sufficient for local WiFi.
      iceServers: [],
      iceTransportPolicy: 'all',
    });

    this.connections.set(peerId, pc);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.destroyed) {
        this.socket.emit('webrtc:ice', { to: peerId, candidate: candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.stateChangeHandler(peerId, true);
      } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        this.connections.delete(peerId);
        this.channels.delete(peerId);
        this.stateChangeHandler(peerId, false);
      }
    };

    if (isInitiator) {
      // Unreliable, unordered channel = lowest latency for mesh gossip
      const ch = pc.createDataChannel('mesh', { ordered: false, maxRetransmits: 0 });
      this.attachChannel(peerId, ch);
    } else {
      pc.ondatachannel = ({ channel }) => this.attachChannel(peerId, channel);
    }

    return pc;
  }

  private attachChannel(peerId: string, channel: RTCDataChannel) {
    this.channels.set(peerId, channel);

    channel.onopen = () => {
      this.stateChangeHandler(peerId, true);
    };

    channel.onclose = () => {
      this.channels.delete(peerId);
      this.stateChangeHandler(peerId, false);
    };

    channel.onerror = () => {
      this.channels.delete(peerId);
    };

    channel.onmessage = ({ data }) => {
      try {
        this.messageHandler(peerId, JSON.parse(data as string));
      } catch {
        // ignore malformed frames
      }
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Initiate a WebRTC connection to a peer (idempotent). */
  async connect(peerId: string): Promise<void> {
    if (this.destroyed || peerId === this.myId) return;
    const existing = this.channels.get(peerId);
    if (existing?.readyState === 'open') return;

    try {
      const pc = this.getOrCreatePeer(peerId, true);
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc:offer', { to: peerId, offer });
    } catch (e) {
      console.warn('[WebRTC] connect error', e);
    }
  }

  /** Send data to a specific peer via DataChannel. Returns true if sent. */
  send(peerId: string, data: unknown): boolean {
    const ch = this.channels.get(peerId);
    if (ch?.readyState === 'open') {
      try {
        ch.send(JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Broadcast data to all open DataChannels. Returns list of peer IDs reached. */
  broadcast(data: unknown): string[] {
    const reached: string[] = [];
    for (const [peerId, ch] of this.channels) {
      if (ch.readyState === 'open') {
        try {
          ch.send(JSON.stringify(data));
          reached.push(peerId);
        } catch {
          // channel may have just closed
        }
      }
    }
    return reached;
  }

  /** Returns true if an open DataChannel exists to this peer. */
  isDirectTo(peerId: string): boolean {
    return this.channels.get(peerId)?.readyState === 'open';
  }

  /** Number of open direct P2P connections. */
  get directCount(): number {
    let n = 0;
    for (const ch of this.channels.values()) if (ch.readyState === 'open') n++;
    return n;
  }

  onMessage(cb: MessageHandler) {
    this.messageHandler = cb;
  }

  onStateChange(cb: StateChangeHandler) {
    this.stateChangeHandler = cb;
  }

  /** Clean up all connections and remove socket listeners. */
  destroy() {
    this.destroyed = true;
    this.teardownSignaling();
    for (const pc of this.connections.values()) pc.close();
    this.connections.clear();
    this.channels.clear();
    this.pendingCandidates.clear();
  }
}
