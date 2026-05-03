
import React, { useState, useMemo } from 'react';
import { useMesh } from '@/lib/MeshContext';
import { FlagEntry } from '@/lib/mesh-types';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flag, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  ShieldCheck, ShieldAlert, ShieldQuestion, User
} from 'lucide-react';

// ── Thresholds ────────────────────────────────────────────────────────────────

const CONFIRM_THRESHOLD = 2;
const DISPUTE_THRESHOLD = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

type Verdict = 'confirmed' | 'disputed' | 'review' | 'flagged' | 'none';

interface VerdictInfo {
  verdict: Verdict;
  confirmedCount: number;
  disputedCount: number;
  totalCount: number;
  verifiedConfirms: number;
  verifiedDisputes: number;
}

function computeVerdict(entries: FlagEntry[], verifiedPeerIds: Set<string>, myId: string): VerdictInfo {
  let verifiedConfirms = 0;
  let verifiedDisputes = 0;
  let totalConfirms = 0;
  let totalDisputes = 0;

  for (const f of entries) {
    const isVerified = f.senderId === myId || verifiedPeerIds.has(f.senderId);
    if (f.vote === 'confirm') {
      totalConfirms++;
      if (isVerified) verifiedConfirms++;
    } else {
      totalDisputes++;
      if (isVerified) verifiedDisputes++;
    }
  }

  let verdict: Verdict = 'none';
  if (entries.length === 0) {
    verdict = 'none';
  } else if (verifiedConfirms >= CONFIRM_THRESHOLD && verifiedConfirms > verifiedDisputes) {
    verdict = 'confirmed';
  } else if (verifiedDisputes >= DISPUTE_THRESHOLD && verifiedDisputes > verifiedConfirms) {
    verdict = 'disputed';
  } else if (verifiedConfirms > 0 && verifiedDisputes > 0) {
    verdict = 'review';
  } else {
    verdict = 'flagged';
  }

  return {
    verdict,
    confirmedCount: totalConfirms,
    disputedCount: totalDisputes,
    totalCount: entries.length,
    verifiedConfirms,
    verifiedDisputes,
  };
}

// ── Badge ─────────────────────────────────────────────────────────────────────

const VERDICT_STYLES: Record<Verdict, { bg: string; border: string; text: string; icon: React.ReactNode; label: (v: VerdictInfo) => string }> = {
  confirmed: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    text: 'text-emerald-400',
    icon: <ShieldCheck className="w-3 h-3" />,
    label: v => `CONFIRMED · ${v.verifiedConfirms} VERIFIED NODE${v.verifiedConfirms !== 1 ? 'S' : ''}`,
  },
  disputed: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    text: 'text-red-400',
    icon: <ShieldAlert className="w-3 h-3" />,
    label: v => `DISPUTED · ${v.verifiedDisputes} VERIFIED NODE${v.verifiedDisputes !== 1 ? 'S' : ''}`,
  },
  review: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    text: 'text-amber-400',
    icon: <ShieldQuestion className="w-3 h-3" />,
    label: v => `UNDER REVIEW · ${v.totalCount} NODE${v.totalCount !== 1 ? 'S' : ''}`,
  },
  flagged: {
    bg: 'bg-zinc-800/60',
    border: 'border-zinc-600/50',
    text: 'text-zinc-300',
    icon: <Flag className="w-3 h-3" />,
    label: v => `${v.totalCount} NODE${v.totalCount !== 1 ? 'S' : ''} FLAGGED · UNVERIFIED`,
  },
  none: {
    bg: '',
    border: '',
    text: '',
    icon: null,
    label: () => '',
  },
};

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  messageId: string;
  messageSenderId: string;
}

export const CommunityNotes = ({ messageId, messageSenderId }: Props) => {
  const { flags, verifiedPeerIds, me, submitFlag } = useMesh();
  const [expanded, setExpanded] = useState(false);
  const [showFlagPanel, setShowFlagPanel] = useState(false);
  const [selectedVote, setSelectedVote] = useState<'confirm' | 'dispute'>('confirm');
  const [noteText, setNoteText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const entries = flags.get(messageId) ?? [];
  const myId = me?.id ?? '';
  const isSelf = messageSenderId === myId;
  const myExistingFlag = entries.find(f => f.senderId === myId);

  const verdictInfo = useMemo(
    () => computeVerdict(entries, verifiedPeerIds, myId),
    [entries, verifiedPeerIds, myId]
  );

  const handleSubmit = () => {
    if (!noteText.trim() && selectedVote === 'dispute') return; // require note for disputes
    submitFlag(messageId, selectedVote, noteText.trim());
    setNoteText('');
    setShowFlagPanel(false);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  const styles = VERDICT_STYLES[verdictInfo.verdict];
  const hasFlags = entries.length > 0;

  return (
    <div className="mt-2 space-y-1.5">
      {/* ── Verdict badge + expand toggle ─────────────────────────────────── */}
      <AnimatePresence>
      {hasFlags && (
        <motion.button
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          onClick={() => setExpanded(e => !e)}
          className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded border text-left transition-all ${styles.bg} ${styles.border}`}
        >
          <div className={`flex items-center gap-1.5 ${styles.text}`}>
            {styles.icon}
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider">
              {styles.label(verdictInfo)}
            </span>
          </div>
          <div className={`${styles.text} opacity-60`}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </div>
        </motion.button>
      )}
      </AnimatePresence>

      {/* ── Expanded notes panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded border border-white/8 bg-black/30 divide-y divide-white/5">
              <div className="px-2.5 py-1.5">
                <p className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">Community Assessment</p>
              </div>
              {entries.map(entry => {
                const isVerified = entry.senderId === myId || verifiedPeerIds.has(entry.senderId);
                return (
                  <div key={entry.id} className="px-2.5 py-2 flex items-start gap-2">
                    <div className={`mt-0.5 shrink-0 ${entry.vote === 'confirm' ? 'text-emerald-500' : 'text-red-400'}`}>
                      {entry.vote === 'confirm'
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <AlertTriangle className="w-3 h-3" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase">
                          {entry.senderId === myId ? 'You' : entry.senderName}
                        </span>
                        {isVerified
                          ? <span className="text-[7px] font-mono text-emerald-600 uppercase">verified</span>
                          : <span className="text-[7px] font-mono text-zinc-700 uppercase">unverified</span>
                        }
                      </div>
                      {entry.note && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug">"{entry.note}"</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Flag button (not shown for own messages) ───────────────────────── */}
      {!isSelf && (
        <div className="flex items-center gap-2">
          {!showFlagPanel && (
            <button
              onClick={() => setShowFlagPanel(true)}
              className="flex items-center gap-1 text-[8px] font-mono text-zinc-700 hover:text-zinc-400 uppercase tracking-wider transition-colors"
            >
              <Flag className="w-2.5 h-2.5" />
              {myExistingFlag ? 'Change assessment' : 'Assess'}
            </button>
          )}
          {submitted && (
            <span className="text-[8px] font-mono text-emerald-600 uppercase">Assessment submitted</span>
          )}
        </div>
      )}

      {/* ── Flag submission panel ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showFlagPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded border border-white/10 bg-zinc-900/60 p-3 space-y-2.5">
              <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Community Assessment</p>

              {/* Vote toggle */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => setSelectedVote('confirm')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border text-[9px] font-mono font-bold uppercase transition-all ${
                    selectedVote === 'confirm'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                      : 'bg-white/5 border-white/10 text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Confirm
                </button>
                <button
                  onClick={() => setSelectedVote('dispute')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border text-[9px] font-mono font-bold uppercase transition-all ${
                    selectedVote === 'dispute'
                      ? 'bg-red-500/15 border-red-500/50 text-red-400'
                      : 'bg-white/5 border-white/10 text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  Dispute
                </button>
              </div>

              {/* Note input */}
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder={
                  selectedVote === 'dispute'
                    ? 'Explain why this is wrong (required)...'
                    : 'Add context (optional)...'
                }
                rows={2}
                maxLength={200}
                className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 outline-none resize-none focus:border-white/20 transition-colors"
              />

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={selectedVote === 'dispute' && !noteText.trim()}
                  className={`h-7 px-3 text-[9px] font-mono font-bold uppercase tracking-wider flex-1 ${
                    selectedVote === 'confirm'
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  Submit Assessment
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowFlagPanel(false); setNoteText(''); }}
                  className="h-7 px-3 text-[9px] font-mono text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </Button>
              </div>

              {selectedVote === 'dispute' && !noteText.trim() && (
                <p className="text-[8px] font-mono text-red-600">A note is required when disputing</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
