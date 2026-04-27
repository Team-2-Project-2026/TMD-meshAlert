
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMesh } from '@/lib/MeshContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Radio, Send, AlertTriangle, MapPin, ShieldCheck,
  Droplets, Utensils, HeartPulse, Home, Reply, X, CornerDownRight, Clock, Lock,
  Hash, Plus, Check
} from 'lucide-react';
import { CommunityNotes } from '@/components/CommunityNotes';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ── Channel definitions ───────────────────────────────────────────────────────

interface Channel {
  id: string;
  label: string;
  color: string; // tailwind color token
}

const BASE_CHANNELS: Channel[] = [
  { id: 'general',   label: 'GENERAL',   color: 'emerald' },
  { id: 'emergency', label: 'EMERGENCY', color: 'red'     },
  { id: 'medical',   label: 'MEDICAL',   color: 'rose'    },
  { id: 'logistics', label: 'LOGISTICS', color: 'amber'   },
];

const CHANNEL_COLORS: Record<string, string> = {
  emerald: 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10',
  red:     'text-red-400     border-red-500/50     bg-red-500/10',
  rose:    'text-rose-400    border-rose-500/50    bg-rose-500/10',
  amber:   'text-amber-400   border-amber-500/50   bg-amber-500/10',
  blue:    'text-blue-400    border-blue-500/50    bg-blue-500/10',
  purple:  'text-purple-400  border-purple-500/50  bg-purple-500/10',
  cyan:    'text-cyan-400    border-cyan-500/50    bg-cyan-500/10',
};

// Cycles through accent colors for user-created channels
const CUSTOM_COLORS = ['blue', 'purple', 'cyan', 'amber'];

function getChannelStyle(color: string, active: boolean) {
  const base = CHANNEL_COLORS[color] ?? CHANNEL_COLORS['blue'];
  if (active) return `${base} ring-1 ring-inset ring-current`;
  return `text-zinc-500 border-white/10 bg-white/5 hover:bg-white/10 hover:text-zinc-300`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const BroadcastHub = () => {
  const { messages, broadcast, sendDirect, me } = useMesh();

  // ── Channel state ──────────────────────────────────────────────────────────

  const [customChannels, setCustomChannels] = useState<Channel[]>(() => {
    try {
      const saved = localStorage.getItem('mesh_custom_channels');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const newChannelInputRef = useRef<HTMLInputElement>(null);

  // All channels = base + custom + any discovered from incoming messages
  const discoveredChannels = useMemo(() => {
    const known = new Set([...BASE_CHANNELS, ...customChannels].map(c => c.id));
    const discovered: Channel[] = [];
    for (const msg of messages) {
      const ch = msg.metadata?.channel;
      if (ch && !known.has(ch)) {
        known.add(ch);
        discovered.push({ id: ch, label: ch.toUpperCase(), color: 'blue' });
      }
    }
    return discovered;
  }, [messages, customChannels]);

  const allChannels = useMemo(
    () => [...BASE_CHANNELS, ...customChannels, ...discoveredChannels],
    [customChannels, discoveredChannels]
  );

  // Persist custom channels
  useEffect(() => {
    localStorage.setItem('mesh_custom_channels', JSON.stringify(customChannels));
  }, [customChannels]);

  // Track unread counts when messages arrive for inactive channels
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length <= prevMessageCount.current) {
      prevMessageCount.current = messages.length;
      return;
    }
    const newMsgs = messages.slice(prevMessageCount.current);
    prevMessageCount.current = messages.length;

    const delta: Record<string, number> = {};
    for (const msg of newMsgs) {
      if (msg.type === 'direct') continue;
      const ch = msg.metadata?.channel ?? 'general';
      if (ch !== activeChannelId) {
        delta[ch] = (delta[ch] ?? 0) + 1;
      }
    }
    if (Object.keys(delta).length > 0) {
      setUnread(prev => {
        const next = { ...prev };
        for (const [id, count] of Object.entries(delta)) next[id] = (next[id] ?? 0) + count;
        return next;
      });
    }
  }, [messages, activeChannelId]);

  const switchChannel = (id: string) => {
    setActiveChannelId(id);
    setUnread(prev => ({ ...prev, [id]: 0 }));
  };

  const commitNewChannel = () => {
    const slug = newChannelName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    if (!slug) { setIsCreating(false); setNewChannelName(''); return; }
    if (allChannels.find(c => c.id === slug)) {
      toast.error('Channel already exists');
      return;
    }
    const color = CUSTOM_COLORS[customChannels.length % CUSTOM_COLORS.length];
    const newCh: Channel = { id: slug, label: newChannelName.trim().toUpperCase(), color };
    setCustomChannels(prev => [...prev, newCh]);
    setIsCreating(false);
    setNewChannelName('');
    switchChannel(slug);
    toast.success(`Channel #${slug} created`);
  };

  useEffect(() => {
    if (isCreating) newChannelInputRef.current?.focus();
  }, [isCreating]);

  // ── Message state ──────────────────────────────────────────────────────────

  const [content, setContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string, sender: string, content: string, senderId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter messages for the active channel
  const channelMessages = useMemo(() => {
    return messages.filter(msg => {
      if (msg.type === 'direct') return true; // DMs always show
      const ch = msg.metadata?.channel ?? 'general';
      return ch === activeChannelId;
    });
  }, [messages, activeChannelId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [channelMessages]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!content.trim()) return;
    if (replyingTo && replyingTo.senderId) {
      sendDirect(replyingTo.senderId, content, { id: replyingTo.id, content: replyingTo.content });
      setReplyingTo(null);
    } else {
      broadcast(content, 'broadcast', { channel: activeChannelId });
    }
    setContent('');
  };

  const handleAlert = () => {
    if (!content.trim()) return;
    broadcast(content, 'alert', { channel: activeChannelId });
    setContent('');
  };

  const sendEmergency = () => {
    broadcast("EMERGENCY: SOS SIGNAL TRIGGERED! Assistance required at my coordinates.", "alert", { channel: 'emergency' });
    toast.error("SOS BEACON ACTIVE", {
      description: "Emergency pulse broadcasted to all mesh nodes.",
      duration: 5000,
    });
  };

  const reportResource = (type: 'water' | 'food' | 'medical' | 'shelter') => {
    if (!me) return;
    const info = `RESOURCE REPORT: ${type.toUpperCase()} available confirmed by ${me.name}.`;
    broadcast(info, "broadcast", {
      resourceType: type,
      location: me.location,
      intensity: 100,
      channel: activeChannelId,
    });
    toast.success(`${type.toUpperCase()} reported`, {
      description: "Resource coordinates shared with the mesh."
    });
  };

  // ── Active channel metadata ────────────────────────────────────────────────

  const activeChannel = allChannels.find(c => c.id === activeChannelId) ?? BASE_CHANNELS[0];
  const placeholder = activeChannelId === 'general'
    ? 'Broadcast to airwaves...'
    : `Message #${activeChannel.label.toLowerCase()}...`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-zinc-950/50 border border-white/5 rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-white/5 bg-white/5">
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-300">Airwaves</h2>
            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${CHANNEL_COLORS[activeChannel.color] ?? CHANNEL_COLORS['blue']}`}>
              #{activeChannel.id}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger render={<Button variant="outline" size="icon" className="h-7 w-7 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/20" />}>
                <MapPin className="w-3.5 h-3.5 text-emerald-500" />
              </PopoverTrigger>
              <PopoverContent className="w-56 bg-zinc-950 border-white/10 p-2">
                <p className="text-[10px] font-mono text-zinc-500 uppercase mb-2 px-2">Report Resources</p>
                <div className="grid grid-cols-2 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => reportResource('water')} className="h-8 justify-start gap-2 hover:bg-blue-500/10 hover:text-blue-400">
                    <Droplets className="w-3 h-3 text-blue-500" />
                    <span className="text-[10px] font-mono">WATER</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reportResource('food')} className="h-8 justify-start gap-2 hover:bg-amber-500/10 hover:text-amber-400">
                    <Utensils className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] font-mono">FOOD</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reportResource('medical')} className="h-8 justify-start gap-2 hover:bg-red-500/10 hover:text-red-400">
                    <HeartPulse className="w-3 h-3 text-red-500" />
                    <span className="text-[10px] font-mono">MEDIC</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reportResource('shelter')} className="h-8 justify-start gap-2 hover:bg-purple-500/10 hover:text-purple-400">
                    <Home className="w-3 h-3 text-purple-500" />
                    <span className="text-[10px] font-mono">BASE</span>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-3 bg-red-600 hover:bg-red-700 animate-pulse font-mono text-[10px] font-bold tracking-tighter"
              onClick={sendEmergency}
            >
              SOS
            </Button>
          </div>
        </div>

        {/* ── Channel strip ─────────────────────────────────────────────────── */}
        <div className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {allChannels.map(ch => {
            const isActive = ch.id === activeChannelId;
            const count = unread[ch.id] ?? 0;
            return (
              <button
                key={ch.id}
                onClick={() => switchChannel(ch.id)}
                className={`relative flex items-center gap-1 px-2.5 py-1 rounded-md border text-[9px] font-mono font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${getChannelStyle(ch.color, isActive)}`}
              >
                <Hash className="w-2.5 h-2.5 shrink-0" />
                {ch.label}
                {count > 0 && !isActive && (
                  <span className="ml-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-emerald-500 text-black text-[7px] font-bold flex items-center justify-center leading-none">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Create channel */}
          <AnimatePresence>
            {isCreating ? (
              <motion.div
                key="input"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="flex items-center gap-1 overflow-hidden"
              >
                <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/5">
                  <Hash className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                  <input
                    ref={newChannelInputRef}
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitNewChannel();
                      if (e.key === 'Escape') { setIsCreating(false); setNewChannelName(''); }
                    }}
                    placeholder="channel-name"
                    className="w-24 bg-transparent text-[9px] font-mono text-emerald-300 placeholder:text-zinc-600 outline-none uppercase"
                    maxLength={20}
                  />
                  <button onClick={commitNewChannel} className="text-emerald-500 hover:text-emerald-300 transition-colors">
                    <Check className="w-2.5 h-2.5" />
                  </button>
                  <button onClick={() => { setIsCreating(false); setNewChannelName(''); }} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="plus"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-white/15 text-zinc-600 hover:text-zinc-400 hover:border-white/30 transition-all shrink-0"
                title="Create channel"
              >
                <Plus className="w-2.5 h-2.5" />
                <span className="text-[9px] font-mono uppercase">NEW</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0 p-4">
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {channelMessages.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-12 gap-2"
              >
                <Hash className="w-6 h-6 text-zinc-700" />
                <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">No transmissions on #{activeChannelId}</p>
              </motion.div>
            )}
            {channelMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-lg border group/msg transition-all ${
                  msg.type === 'alert'
                    ? 'bg-red-500/10 border-red-500/30'
                    : msg.type === 'direct'
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-white/5 border-white/5'
                }`}
              >
                {msg.metadata?.replyToId && (
                  <div className="mb-2 pl-2 border-l-2 border-blue-500/50 bg-blue-500/5 p-1 rounded r-sm flex items-start gap-1.5 grayscale opacity-70">
                    <CornerDownRight className="w-2.5 h-2.5 text-blue-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-mono font-bold text-blue-400 uppercase truncate">Replying to transmission</p>
                      <p className="text-[10px] text-zinc-400 truncate italic">
                        "{msg.metadata.replyToContent || 'Original message content lost...'}"
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-bold uppercase ${
                      msg.type === 'alert' ? 'text-red-400' : msg.type === 'direct' ? 'text-blue-400' : 'text-emerald-500'
                    }`}>
                      {msg.senderName}
                      {msg.type === 'direct' && !msg.metadata?.isIncoming && ` → ${msg.metadata?.recipientName}`}
                    </span>
                    <div className="flex items-center gap-1 group/hash relative">
                      {msg.type !== 'direct' && <ShieldCheck className="w-2.5 h-2.5 text-zinc-500 hover:text-emerald-500 cursor-help" />}
                      {msg.signature && (
                        <div className="flex items-center bg-emerald-500/10 px-1 rounded border border-emerald-500/20">
                          <span className="text-[7px] font-mono text-emerald-400 font-bold">SIGNED</span>
                        </div>
                      )}
                      {msg.metadata?.isEncrypted && (
                        <div className="flex items-center gap-0.5 bg-blue-500/20 px-1 border border-blue-500/30 rounded">
                          <Lock className="w-2 h-2 text-blue-400" />
                          <span className="text-[7px] font-mono font-bold text-blue-400 uppercase">E2EE</span>
                        </div>
                      )}
                      {msg.isPending && (
                        <div className="flex items-center gap-1 bg-amber-500/20 px-1 border border-amber-500/30 rounded">
                          <Clock className="w-2 h-2 text-amber-500" />
                          <span className="text-[7px] font-mono font-bold text-amber-400 uppercase">QUEUED</span>
                        </div>
                      )}
                      {msg.hash && (
                        <span className="text-[8px] font-mono text-zinc-700 hidden group-hover/hash:inline leading-none">
                          {msg.hash.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">
                      {format(msg.timestamp, 'HH:mm:ss')}
                    </span>
                    {msg.type === 'direct' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover/msg:opacity-100 transition-opacity"
                        onClick={() => setReplyingTo({ id: msg.id, sender: msg.senderName, content: msg.content, senderId: msg.senderId })}
                      >
                        <Reply className="w-3 h-3 text-blue-400" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-zinc-300 font-sans leading-relaxed">{msg.content}</p>

                {/* Community notes — only on broadcast/alert messages */}
                {(msg.type === 'broadcast' || msg.type === 'alert') && (
                  <CommunityNotes messageId={msg.id} messageSenderId={msg.senderId} />
                )}

                {msg.type === 'alert' && (
                  <div className="mt-2 flex items-center gap-1.5 py-0.5 px-2 bg-red-500/20 rounded border border-red-500/30">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <span className="text-[10px] font-mono text-red-300 uppercase font-bold">EMERGENCY BROADCAST</span>
                  </div>
                )}
                {msg.type === 'direct' && (
                  <div className="mt-2 flex items-center gap-1.5 py-0.5 px-2 bg-blue-500/20 rounded border border-blue-500/30">
                    <ShieldCheck className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] font-mono text-blue-300 uppercase font-bold">DIRECT SECURE CHANNEL</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* ── Compose ────────────────────────────────────────────────────────── */}
      <div className="p-4 bg-zinc-900/80 border-t border-white/5 space-y-3">
        <AnimatePresence>
          {replyingTo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mb-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-between">
                <div className="flex items-start gap-2 min-w-0">
                  <Reply className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] font-mono font-bold text-blue-400 uppercase leading-none mb-1">
                      Replying to {replyingTo.sender}
                    </p>
                    <p className="text-[10px] text-zinc-400 truncate font-mono">{replyingTo.content}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 hover:bg-blue-500/20" onClick={() => setReplyingTo(null)}>
                  <X className="w-3 h-3 text-blue-400" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={placeholder}
            className="bg-black/50 border-white/10 text-zinc-300 font-mono text-sm h-10"
          />
          <Button onClick={handleSend} size="icon" variant="secondary" className="h-10 w-10 shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleAlert}
            variant="destructive"
            size="sm"
            className="flex-1 font-mono text-[10px] uppercase font-bold tracking-tighter"
          >
            <AlertTriangle className="w-3 h-3 mr-2" />
            Signal Emergency
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-white/5 border-white/10 font-mono text-[10px] uppercase tracking-tighter"
            onClick={() => broadcast("Current status: Safe. Network operational.", "broadcast", { channel: activeChannelId })}
          >
            <MapPin className="w-3 h-3 mr-2 text-emerald-500" />
            Check-In
          </Button>
        </div>
      </div>
    </div>
  );
};
