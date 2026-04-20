
import React from 'react';
import { useMesh } from '@/lib/MeshContext';
import { 
  Wifi, WifiOff, Users, Battery, ShieldAlert, 
  Map as MapIcon, MessageSquare, Radio, Info, Eye, EyeOff
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const StatusToolbar = () => {
  const { isConnected, peers, me, ledgerIntegrity, isStealthMode, setStealthMode, directPeerCount } = useMesh();

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/40 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500" />
          )}
          <span className={`text-xs font-mono font-medium tracking-tighter uppercase ${!isConnected ? 'text-red-500 animate-pulse' : ''}`}>
            {isConnected ? 'Mesh Online' : 'SIGNAL LOST'}
          </span>
          {!isConnected && (
            <Badge variant="outline" className="bg-red-500/10 border-red-500/50 text-red-500 font-mono text-[9px] px-1 py-0 h-4 uppercase animate-pulse">
              OFFLINE
            </Badge>
          )}
        </div>
        <div className="h-4 w-[1px] bg-white/10" />
        <div className="flex items-center gap-2 text-zinc-400">
          <Users className="w-4 h-4" />
          <span className="text-xs font-mono">{peers.length} Nearby</span>
          {directPeerCount > 0 && (
            <Badge variant="outline" className="bg-blue-500/10 border-blue-500/30 text-blue-400 font-mono text-[9px] px-1 py-0 h-4 uppercase">
              {directPeerCount} P2P
            </Badge>
          )}
        </div>
        <div className="h-4 w-[1px] bg-white/10" />
        <div className="flex items-center gap-2">
          <ShieldAlert className={`w-4 h-4 ${ledgerIntegrity ? 'text-emerald-500' : 'text-red-500'}`} />
          <span className={`text-[10px] font-mono uppercase font-bold ${ledgerIntegrity ? 'text-emerald-500/80' : 'text-red-500'}`}>
            {ledgerIntegrity ? 'Chain Intact' : 'Chain Compromised'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setStealthMode(!isStealthMode)}
          className={`h-7 px-2 font-mono text-[9px] uppercase tracking-tighter gap-1.5 border ${
            isStealthMode ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'text-zinc-500 border-white/5'
          }`}
        >
          {isStealthMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {isStealthMode ? 'Stealth Protocol' : 'Standard View'}
        </Button>
        <div className="hidden md:flex items-center gap-2 text-zinc-400">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">Local ID:</span>
          <span className="text-xs font-mono text-emerald-500/80">{me?.id}</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-0.5 rounded border border-white/5 bg-white/5">
          <Battery className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-mono">{Math.round(me?.battery || 0)}%</span>
        </div>
      </div>
    </div>
  );
};
