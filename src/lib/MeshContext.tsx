
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Peer, MeshMessage, FlagEntry, NetworkState, MapItem } from './mesh-types';
import { toast } from 'sonner';
import { WebRTCMesh } from './webrtc-mesh';

interface MeshContextType {
  socket: Socket | null;
  me: Peer | null;
  peers: Peer[];
  ghostPeers: Peer[];
  messages: MeshMessage[];
  flags: Map<string, FlagEntry[]>;
  verifiedPeerIds: Set<string>;
  broadcast: (content: string, type?: MeshMessage['type'], metadata?: MeshMessage['metadata']) => void;
  sendDirect: (to: string, content: string, replyTo?: { id: string, content: string }) => void;
  submitFlag: (targetMessageId: string, vote: 'confirm' | 'dispute', note: string) => void;
  verifyPeer: (id: string) => void;
  isConnected: boolean;
  /** Number of open WebRTC DataChannel connections (true P2P, no server). */
  directPeerCount: number;
  ledgerIntegrity: boolean;
  isStealthMode: boolean;
  setStealthMode: (val: boolean) => void;
  selectedMapItem: MapItem | null;
  setSelectedMapItem: (item: MapItem | null) => void;
}

const MeshContext = createContext<MeshContextType | undefined>(undefined);

const RANDOM_NAMES = ['Kestrel', 'Badger', 'Raven', 'Fox', 'Owl', 'Wolf', 'Bear', 'Lynx', 'Hawk', 'Otter'];
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ── Crypto Helpers ──────────────────────────────────────────────────────────

const exportKey = async (key: CryptoKey) => {
  const exported = await crypto.subtle.exportKey('jwk', key);
  return btoa(JSON.stringify(exported));
};

const importKey = async (jwkB64: string, type: 'signing' | 'encryption' | 'aes', use: 'public' | 'private' | 'secret') => {
  const jwk = JSON.parse(atob(jwkB64));
  if (type === 'signing') {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      use === 'public' ? ['verify'] : ['sign']
    );
  } else if (type === 'encryption') {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      use === 'public' ? [] : ['deriveKey']
    );
  } else {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }
};

const hashMessage = async (msg: Partial<MeshMessage>): Promise<string> => {
  const kernel = `${msg.senderId}|${msg.content}|${msg.timestamp}|${msg.prevHash}`;
  const msgUint8 = new TextEncoder().encode(kernel);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── Provider ────────────────────────────────────────────────────────────────

export const MeshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [me, setMe] = useState<Peer | null>(() => {
    const saved = localStorage.getItem('mesh_me');
    return saved ? JSON.parse(saved) : null;
  });
  const [peers, setPeers] = useState<Peer[]>([]);
  const [ghostPeers, setGhostPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>(() => {
    try {
      const saved = localStorage.getItem('mesh_ledger');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (e) {
      console.error('Critical: Failed to load mesh ledger from storage', e);
      return [];
    }
  });
  const [verifiedPeerIds, setVerifiedPeerIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('mesh_verified_peers');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [verifiedPeerKeys, setVerifiedPeerKeys] = useState<Record<string, { signingKey: string, encryptionKey: string }>>(() => {
    const saved = localStorage.getItem('mesh_verified_peer_keys');
    return saved ? JSON.parse(saved) : {};
  });
  const [flags, setFlags] = useState<Map<string, FlagEntry[]>>(() => {
    try {
      const saved = localStorage.getItem('mesh_flags');
      if (saved) {
        const arr: [string, FlagEntry[]][] = JSON.parse(saved);
        return new Map(arr);
      }
    } catch {}
    return new Map<string, FlagEntry[]>();
  });
  const [isConnected, setIsConnected] = useState(false);
  const [directPeerCount, setDirectPeerCount] = useState(0);
  const [ledgerIntegrity, setLedgerIntegrity] = useState(true);
  const [isStealthMode, setStealthMode] = useState(() => {
    return localStorage.getItem('mesh_stealth') === 'true';
  });
  const [selectedMapItem, setSelectedMapItem] = useState<MapItem | null>(null);

  // Tactical Key Store (in-memory, loaded from storage)
  const signingKeyPair = useRef<{ public: CryptoKey, private: CryptoKey } | null>(null);
  const encryptionKeyPair = useRef<{ public: CryptoKey, private: CryptoKey } | null>(null);
  const sharedSecrets = useRef<Map<string, CryptoKey>>(new Map());

  // WebRTC mesh layer (null until socket is connected)
  const webrtcRef = useRef<WebRTCMesh | null>(null);

  // Stable refs to mutable state (avoids stale closures in socket/webrtc callbacks)
  const socketRef = useRef<Socket | null>(null);
  const meRef = useRef<Peer | null>(me);
  const peersRef = useRef<Peer[]>(peers);
  const messagesRef = useRef<MeshMessage[]>(messages);
  const verifiedPeerIdsRef = useRef<Set<string>>(verifiedPeerIds);
  const flagsRef = useRef<Map<string, FlagEntry[]>>(flags);

  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { verifiedPeerIdsRef.current = verifiedPeerIds; }, [verifiedPeerIds]);
  useEffect(() => { flagsRef.current = flags; }, [flags]);

  // Re-broadcast identity when signingKey/encryptionKey arrive (async after socket connects)
  useEffect(() => {
    if (me?.signingKey && socketRef.current?.connected) {
      socketRef.current.emit('peer:update', {
        signingKey: me.signingKey,
        encryptionKey: me.encryptionKey,
      });
    }
  }, [me?.signingKey]);

  // ── Persistence ───────────────────────────────────────────────────────────

  useEffect(() => { localStorage.setItem('mesh_stealth', isStealthMode.toString()); }, [isStealthMode]);
  useEffect(() => { localStorage.setItem('mesh_ledger', JSON.stringify(messages)); }, [messages]);
  useEffect(() => { localStorage.setItem('mesh_verified_peers', JSON.stringify(Array.from(verifiedPeerIds))); }, [verifiedPeerIds]);
  useEffect(() => { localStorage.setItem('mesh_verified_peer_keys', JSON.stringify(verifiedPeerKeys)); }, [verifiedPeerKeys]);
  useEffect(() => { localStorage.setItem('mesh_flags', JSON.stringify(Array.from(flags.entries()))); }, [flags]);

  // ── Identity Init ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (me) return;
    const myId = Math.random().toString(36).substr(2, 9);
    const myName = `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}-${Math.floor(Math.random() * 1000)}`;
    const myPeer: Peer = {
      id: myId,
      name: myName,
      status: 'online',
      battery: 80 + Math.floor(Math.random() * 20),
      lastSeen: Date.now(),
      location: { x: 30 + Math.random() * 40, y: 30 + Math.random() * 40 },
      role: Math.random() > 0.8 ? 'coordinator' : 'node',
      isVerified: true
    };
    setMe(myPeer);
    localStorage.setItem('mesh_me', JSON.stringify(myPeer));
  }, [me]);

  // ── Crypto Key Lifecycle ──────────────────────────────────────────────────

  useEffect(() => {
    const initCrypto = async () => {
      let savedSig = localStorage.getItem('mesh_sig_keys');
      let savedEnc = localStorage.getItem('mesh_enc_keys');

      if (!savedSig || !savedEnc) {
        toast.info('Generating Tactical Identity Keys...');
        const sig = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const enc = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);

        signingKeyPair.current = { public: sig.publicKey, private: sig.privateKey };
        encryptionKeyPair.current = { public: enc.publicKey, private: enc.privateKey };

        const sigPub = await exportKey(sig.publicKey);
        const sigPriv = await exportKey(sig.privateKey);
        const encPub = await exportKey(enc.publicKey);
        const encPriv = await exportKey(enc.privateKey);

        localStorage.setItem('mesh_sig_keys', JSON.stringify({ public: sigPub, private: sigPriv }));
        localStorage.setItem('mesh_enc_keys', JSON.stringify({ public: encPub, private: encPriv }));

        setMe(prev => prev ? { ...prev, signingKey: sigPub, encryptionKey: encPub } : null);
      } else {
        const sigData = JSON.parse(savedSig);
        const encData = JSON.parse(savedEnc);

        signingKeyPair.current = {
          public: await importKey(sigData.public, 'signing', 'public'),
          private: await importKey(sigData.private, 'signing', 'private')
        };
        encryptionKeyPair.current = {
          public: await importKey(encData.public, 'encryption', 'public'),
          private: await importKey(encData.private, 'encryption', 'private')
        };

        for (const [id, keys] of Object.entries(verifiedPeerKeys) as [string, { signingKey: string, encryptionKey: string }][]) {
          try {
            const peerEncKey = await importKey(keys.encryptionKey, 'encryption', 'public');
            const sharedSecret = await crypto.subtle.deriveKey(
              { name: 'ECDH', public: peerEncKey },
              encryptionKeyPair.current!.private,
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
            );
            sharedSecrets.current.set(id, sharedSecret);
          } catch (e) {
            console.error(`Failed to restore secure channel for ${id}`, e);
          }
        }

        if (me && (!me.signingKey || !me.encryptionKey)) {
          setMe(prev => prev ? { ...prev, signingKey: sigData.public, encryptionKey: encData.public } : null);
        }
      }
    };
    initCrypto();
  }, []);

  // ── Battery Drain ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!me) return;
    const interval = setInterval(() => {
      setMe(prev => prev ? { ...prev, battery: Math.max(0, prev.battery - 0.01) } : null);
    }, 10000);
    return () => clearInterval(interval);
  }, [me]);

  useEffect(() => {
    if (me) localStorage.setItem('mesh_me', JSON.stringify(me));
  }, [me]);

  // ── Incoming Message Processor ────────────────────────────────────────────
  // Defined once; only accesses refs and stable setters so no stale closure risk.

  const processIncoming = useCallback(async (msg: MeshMessage) => {
    const expectedHash = await hashMessage(msg);
    if (msg.hash !== expectedHash) {
      // Flags use GENESIS_HASH as prevHash and don't participate in the chain — skip integrity fail for them
      if (msg.type !== 'flag') {
        setLedgerIntegrity(false);
        toast.error('Security Warning: Mesh integrity compromised.');
        return;
      }
    }

    const sender = peersRef.current.find(p => p.id === msg.senderId);
    if (sender?.signingKey && msg.signature) {
      try {
        const pubKey = await importKey(sender.signingKey, 'signing', 'public');
        const isValid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: { name: 'SHA-256' } },
          pubKey,
          new Uint8Array(msg.signature.split(',').map(Number)),
          new TextEncoder().encode(msg.hash)
        );
        if (!isValid) {
          toast.error(`Spoof Detected: Identity mismatch for ${sender.name}`);
          return;
        }
      } catch (e) {
        console.error('Signature verification error', e);
      }
    }

    // Flag messages go into the flags Map, not the message ledger
    if (msg.type === 'flag' && msg.metadata?.flagTarget && msg.metadata?.flagVote) {
      const entry: FlagEntry = {
        id: msg.id,
        targetMessageId: msg.metadata.flagTarget,
        senderId: msg.senderId,
        senderName: msg.senderName,
        vote: msg.metadata.flagVote,
        note: msg.content,
        timestamp: msg.timestamp,
      };
      setFlags(prev => {
        const next = new Map<string, FlagEntry[]>(prev);
        const existing: FlagEntry[] = next.get(entry.targetMessageId) ?? [];
        const filtered = existing.filter(f => f.senderId !== entry.senderId);
        next.set(entry.targetMessageId, [...filtered, entry]);
        return next;
      });
      return;
    }

    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev; // dedup
      return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp).slice(-500);
    });
    if (msg.type === 'alert') toast.error(`ALERT: ${msg.content}`);
  }, []);

  const processIncomingRef = useRef(processIncoming);
  useEffect(() => { processIncomingRef.current = processIncoming; }, [processIncoming]);

  // ── Socket + WebRTC Setup ─────────────────────────────────────────────────

  useEffect(() => {
    if (!me?.id) return;

    const s = io('/', { transports: ['websocket'], reconnection: true });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => {
      setIsConnected(true);

      // ── Boot WebRTC mesh ──────────────────────────────────────────────────
      webrtcRef.current?.destroy();
      const rtc = new WebRTCMesh(s, me.id);
      webrtcRef.current = rtc;

      // Route WebRTC broadcast/alert messages through the same handler as Socket.io
      rtc.onMessage((_from, data) => {
        const msg = data as MeshMessage;
        if (msg?.type === 'broadcast' || msg?.type === 'alert') {
          processIncomingRef.current(msg);
        }
        // Direct messages over WebRTC are handled by the same receive_direct logic
        // but sent as a structured envelope so we handle them here too.
        if (msg?.type === 'direct' && msg?.metadata?.isIncoming) {
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg].slice(-500);
          });
        }
      });

      rtc.onStateChange((_peerId, connected) => {
        setDirectPeerCount(rtc.directCount);
        if (connected) toast.success('P2P Direct Channel Open', { description: 'Messages now bypass the hub' });
      });

      if (meRef.current) {
        s.emit('peer:join', meRef.current);
        s.emit('mesh:broadcast', { type: 'sync_invitation', senderId: meRef.current.id });

        // Flush offline pending messages
        const pending = messagesRef.current.filter(m => m.isPending);
        if (pending.length > 0) {
          toast.info(`Synchronizing ${pending.length} offline transmissions...`);
          pending.forEach(m => {
            if (m.type === 'direct') {
              s.emit('mesh:direct', {
                to: m.metadata?.replyToId || '',
                msg: m.content,
                replyToId: m.metadata?.replyToId
              });
            } else {
              s.emit('mesh:broadcast', { ...m, isPending: false });
            }
          });
          setMessages(prev => prev.map(m => m.isPending ? { ...m, isPending: false } : m));
        }
      }
    });

    s.on('disconnect', () => {
      setIsConnected(false);
      // Don't destroy webrtcRef here — open DataChannels survive Socket.io disconnects
    });

    s.on('mesh:peers', (updatedPeers: Peer[]) => {
      const activePeerIds = new Set(updatedPeers.map(p => p.id));

      setGhostPeers(prev => {
        const currentPeers = peersRef.current;
        const disappearedPeers = currentPeers.filter(p => !activePeerIds.has(p.id) && p.id !== meRef.current?.id);
        return [...prev, ...disappearedPeers]
          .filter(g => Date.now() - (g.lastSeen || Date.now()) < 120000)
          .slice(-5);
      });

      const mappedPeers = updatedPeers
        .filter(p => p.id !== meRef.current?.id)
        .map(p => {
          const m = meRef.current!;
          const dist = Math.hypot(p.location.x - m.location.x, p.location.y - m.location.y);
          const rssi = -30 - (dist * 0.8);
          return {
            ...p,
            rssi,
            isVerified: verifiedPeerIdsRef.current.has(p.id),
            lastSeen: Date.now()
          };
        });
      setPeers(mappedPeers);

      // Initiate WebRTC connections to any newly seen peers
      const rtc = webrtcRef.current;
      if (rtc) {
        for (const peer of mappedPeers) {
          if (!rtc.isDirectTo(peer.id)) {
            rtc.connect(peer.id).catch(() => {}); // non-blocking, best-effort
          }
        }
        setDirectPeerCount(rtc.directCount);
      }
    });

    s.on('mesh:receive_broadcast', (msg: any) => {
      if (msg.type === 'sync_invitation' && msg.senderId !== meRef.current?.id) {
        s.emit('mesh:sync_response', {
          to: msg.senderId,
          history: messagesRef.current.filter(m => m.type !== 'direct'),
          flagHistory: Array.from(flagsRef.current.entries()),
        });
        return;
      }
      if (msg.type === 'broadcast' || msg.type === 'alert' || msg.type === 'flag') {
        processIncomingRef.current(msg);
      }
    });

    s.on('mesh:receive_sync_response', ({ history, flagHistory }: { history: MeshMessage[], flagHistory?: Array<[string, FlagEntry[]]> }) => {
      setMessages(prev => {
        const combined = [...prev, ...history];
        const unique = Array.from(new Map(combined.map(m => [m.id, m])).values());
        return unique.sort((a, b) => a.timestamp - b.timestamp).slice(-500);
      });
      if (flagHistory) {
        setFlags(prev => {
          const next = new Map<string, FlagEntry[]>(prev);
          for (const [msgId, entries] of flagHistory) {
            const existing: FlagEntry[] = next.get(msgId) ?? [];
            const merged = new Map<string, FlagEntry>([...existing, ...entries].map(f => [f.senderId, f]));
            // keep latest per sender
            for (const entry of entries) {
              const cur = merged.get(entry.senderId);
              if (!cur || entry.timestamp > cur.timestamp) merged.set(entry.senderId, entry);
            }
            next.set(msgId, Array.from(merged.values()));
          }
          return next;
        });
      }
      toast.success('Mesh History Synced');
    });

    s.on('mesh:receive_direct', async ({ from, msg, replyToId, isEncrypted, iv, wrappedKey }: {
      from: string; msg: string; replyToId?: string;
      isEncrypted?: boolean; iv?: string; wrappedKey?: string
    }) => {
      const sender = peersRef.current.find(p => p.id === from);
      let decryptedContent = msg;

      if (isEncrypted && iv && wrappedKey) {
        const sharedSecret = sharedSecrets.current.get(from);
        if (sharedSecret) {
          try {
            const ivArray = new Uint8Array(atob(iv).split('').map(c => c.charCodeAt(0)));
            const encryptedBuffer = new Uint8Array(atob(msg).split('').map(c => c.charCodeAt(0)));
            const wrappedKeyBuffer = new Uint8Array(atob(wrappedKey).split('').map(c => c.charCodeAt(0)));

            const sessionKey = await crypto.subtle.unwrapKey(
              'jwk',
              wrappedKeyBuffer,
              sharedSecret,
              'AES-GCM',
              'AES-GCM',
              true,
              ['decrypt']
            );

            const decryptedBuffer = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: ivArray },
              sessionKey,
              encryptedBuffer
            );
            decryptedContent = new TextDecoder().decode(decryptedBuffer);
          } catch (e) {
            console.error('Decryption failed', e);
            decryptedContent = '[DECRYPTION FAILED: VERIFY HANDSHAKE]';
          }
        } else {
          decryptedContent = '[ENCRYPTED: HANDSHAKE REQUIRED]';
        }
      }

      const originalMessage = messagesRef.current.find(m => m.id === replyToId);

      const directMsg: MeshMessage = {
        id: Math.random().toString(36).substr(2, 9),
        senderId: from,
        senderName: sender?.name || 'Unknown Peer',
        content: decryptedContent,
        timestamp: Date.now(),
        type: 'direct',
        hops: 1,
        hash: '',
        prevHash: '',
        metadata: {
          isIncoming: true,
          replyToId,
          replyToContent: originalMessage?.content,
          isEncrypted: isEncrypted
        }
      };
      setMessages(prev => [...prev, directMsg].slice(-500));
      toast.info(`Secure DM: ${sender?.name || 'Peer'}`, { description: isEncrypted ? 'E2EE Decrypted' : decryptedContent });
    });

    return () => {
      webrtcRef.current?.destroy();
      webrtcRef.current = null;
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [me?.id]);

  // ── Broadcast ─────────────────────────────────────────────────────────────

  const broadcast = useCallback(async (content: string, type: MeshMessage['type'] = 'broadcast', metadata?: MeshMessage['metadata']) => {
    if (!me) return;

    const prevHash = messages.length > 0 ? messages[messages.length - 1].hash : GENESIS_HASH;

    const msgTemplate: Partial<MeshMessage> = {
      id: Math.random().toString(36).substr(2, 9),
      senderId: me.id,
      senderName: me.name,
      content,
      timestamp: Date.now(),
      type,
      hops: 1,
      prevHash,
      metadata,
      isPending: !socket || !isConnected
    };

    const hash = await hashMessage(msgTemplate);

    let signature = '';
    if (signingKeyPair.current) {
      const signatureBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        signingKeyPair.current.private,
        new TextEncoder().encode(hash)
      );
      signature = Array.from(new Uint8Array(signatureBuffer)).join(',');
    }

    const finalMsg: MeshMessage = { ...msgTemplate, hash, signature } as MeshMessage;

    setMessages(prev => [...prev, finalMsg].slice(-500));

    if (socket && isConnected) {
      // Primary path: Socket.io (server relays)
      socket.emit('mesh:broadcast', finalMsg);
    } else {
      toast.warning('Node Offline: Storing signed transmission in queue...');
    }

    // Secondary path: WebRTC broadcast for redundancy + server-down resilience.
    // Dedup at receiver via message ID ensures no duplicate display.
    webrtcRef.current?.broadcast(finalMsg);
  }, [socket, isConnected, me, messages]);

  // ── Direct Message ────────────────────────────────────────────────────────

  const sendDirect = useCallback(async (to: string, content: string, replyTo?: { id: string, content: string }) => {
    if (!me || !signingKeyPair.current) return;

    const recipient = peers.find(p => p.id === to);
    let finalContent = content;
    let ivB64: string | undefined;
    let wrappedKeyB64: string | undefined;
    let encrypted = false;

    const sharedSecret = sharedSecrets.current.get(to);
    if (sharedSecret) {
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const sessionKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );

        const encryptedBuffer = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          sessionKey,
          new TextEncoder().encode(content)
        );

        const wrappedKeyBuffer = await crypto.subtle.wrapKey(
          'jwk',
          sessionKey,
          sharedSecret,
          'AES-GCM'
        );

        finalContent = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
        ivB64 = btoa(String.fromCharCode(...iv));
        wrappedKeyB64 = btoa(String.fromCharCode(...new Uint8Array(wrappedKeyBuffer)));
        encrypted = true;
      } catch (e) {
        console.error('Encryption failed', e);
      }
    }

    const directMsgTemplate: Partial<MeshMessage> = {
      id: Math.random().toString(36).substr(2, 9),
      senderId: me.id,
      senderName: 'Me',
      content: finalContent,
      timestamp: Date.now(),
      type: 'direct',
      hops: 1,
      hash: '',
      prevHash: '',
      isPending: !socket || !isConnected,
      metadata: {
        recipientName: recipient?.name || 'Unknown',
        isIncoming: false,
        replyToId: replyTo?.id,
        replyToContent: replyTo?.content,
        isEncrypted: encrypted,
        iv: ivB64,
        wrappedKey: wrappedKeyB64
      }
    };

    const directMsg = directMsgTemplate as MeshMessage;
    setMessages(prev => [...prev, directMsg].slice(-500));

    const payload = { to, msg: finalContent, replyToId: replyTo?.id, isEncrypted: encrypted, iv: ivB64, wrappedKey: wrappedKeyB64 };

    // Prefer direct WebRTC channel (true P2P — never touches server)
    const sentViaWebRTC = webrtcRef.current?.send(to, { ...directMsg, metadata: { ...directMsg.metadata, isIncoming: true } }) ?? false;

    if (!sentViaWebRTC) {
      // Fall back to Socket.io relay
      if (socket && isConnected) {
        socket.emit('mesh:direct', payload);
      } else {
        toast.warning('Node Offline: Secure Tactical DM queued...');
      }
    }
  }, [socket, isConnected, me, peers]);

  // ── Peer Verification ─────────────────────────────────────────────────────

  const verifyPeer = useCallback(async (idOrData: string | any) => {
    let id = typeof idOrData === 'string' ? idOrData : idOrData.id;
    let peerData = typeof idOrData === 'object' ? idOrData : null;

    if (peerData?.signingKey && peerData?.encryptionKey) {
      try {
        const peerEncKey = await importKey(peerData.encryptionKey, 'encryption', 'public');
        const sharedSecret = await crypto.subtle.deriveKey(
          { name: 'ECDH', public: peerEncKey },
          encryptionKeyPair.current!.private,
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
        );
        sharedSecrets.current.set(id, sharedSecret);

        setVerifiedPeerKeys(prev => ({
          ...prev,
          [id]: { signingKey: peerData.signingKey, encryptionKey: peerData.encryptionKey }
        }));

        toast.success(`Secure Tactical Channel Established with ${peerData.name}`);
      } catch (e) {
        console.error('Shared secret derivation failed', e);
      }
    }

    setVerifiedPeerIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    setPeers(prev => prev.map(p => p.id === id ? {
      ...p,
      isVerified: true,
      verifiedAt: Date.now(),
      signingKey: peerData?.signingKey || p.signingKey,
      encryptionKey: peerData?.encryptionKey || p.encryptionKey
    } : p));
    toast.success('Peer Identity Verified');
  }, []);

  // ── Submit Flag ───────────────────────────────────────────────────────────

  const submitFlag = useCallback(async (targetMessageId: string, vote: 'confirm' | 'dispute', note: string) => {
    if (!me) return;

    // Optimistically add own flag locally — always, even if signing keys aren't ready yet
    const localEntry: FlagEntry = {
      id: Math.random().toString(36).substr(2, 9),
      targetMessageId,
      senderId: me.id,
      senderName: me.name,
      vote,
      note,
      timestamp: Date.now(),
    };
    setFlags(prev => {
      const next = new Map<string, FlagEntry[]>(prev);
      const existing: FlagEntry[] = next.get(targetMessageId) ?? [];
      const filtered = existing.filter(f => f.senderId !== me.id);
      next.set(targetMessageId, [...filtered, localEntry]);
      return next;
    });

    if (!signingKeyPair.current) return; // can't broadcast without keys, but local state is updated

    // Broadcast the flag as a signed mesh message (prevHash = GENESIS — not in the chain)
    const msgTemplate: Partial<MeshMessage> = {
      id: localEntry.id,
      senderId: me.id,
      senderName: me.name,
      content: note,
      timestamp: localEntry.timestamp,
      type: 'flag',
      hops: 1,
      prevHash: GENESIS_HASH,
      metadata: { flagTarget: targetMessageId, flagVote: vote },
    };

    const hash = await hashMessage(msgTemplate);
    const signatureBuffer = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      signingKeyPair.current.private,
      new TextEncoder().encode(hash)
    );
    const signature = Array.from(new Uint8Array(signatureBuffer)).join(',');
    const finalMsg: MeshMessage = { ...msgTemplate, hash, signature } as MeshMessage;

    if (socket && isConnected) {
      socket.emit('mesh:broadcast', finalMsg);
    }
    webrtcRef.current?.broadcast(finalMsg);
  }, [me, socket, isConnected]);

  // ── Memoized Context Value ────────────────────────────────────────────────

  const memoedValue = useMemo(() => ({
    socket, me, peers, ghostPeers, messages, flags, verifiedPeerIds, broadcast, sendDirect,
    submitFlag, verifyPeer, isConnected, directPeerCount, ledgerIntegrity, isStealthMode,
    setStealthMode, selectedMapItem, setSelectedMapItem
  }), [
    socket, me, peers, ghostPeers, messages, flags, verifiedPeerIds, broadcast, sendDirect,
    submitFlag, verifyPeer, isConnected, directPeerCount, ledgerIntegrity, isStealthMode, selectedMapItem
  ]);

  return (
    <MeshContext.Provider value={memoedValue}>
      <div className={isStealthMode ? 'stealth-filter h-full flex flex-col' : 'h-full flex flex-col'}>
        {!isConnected && (
          <div className="absolute top-0 left-0 right-0 z-[100] h-1 bg-red-600 animate-pulse" />
        )}
        {children}
      </div>
    </MeshContext.Provider>
  );
};

export const useMesh = () => {
  const context = useContext(MeshContext);
  if (context === undefined) {
    throw new Error('useMesh must be used within a MeshProvider');
  }
  return context;
};
