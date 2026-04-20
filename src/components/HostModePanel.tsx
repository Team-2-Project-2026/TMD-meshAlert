import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Wifi, Server, Copy, CheckCheck, Radio } from 'lucide-react';
import { toast } from 'sonner';

interface NetworkInfo {
  ips: string[];
  port: number;
}

/**
 * HostModePanel
 *
 * Displayed when one device is acting as the hub (running the Node.js server).
 * It shows all local network IPs and a QR code so nearby devices can join by
 * scanning — no internet, no configuration needed.
 *
 * Steps for offline LAN mesh:
 *   1. One person starts the app with `npm run dev` (or the built binary).
 *   2. Their device creates / joins a WiFi hotspot.
 *   3. Other devices connect to the same WiFi hotspot.
 *   4. Others scan the QR code shown here — app loads and joins the mesh.
 *   5. Once loaded, the PWA service worker caches the app so it survives
 *      future page loads even if the hub restarts.
 */
export const HostModePanel: React.FC = () => {
  const [netInfo, setNetInfo] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/network-info')
      .then(r => r.json())
      .then((data: NetworkInfo) => {
        setNetInfo(data);
        if (data.ips.length > 0) setSelectedIp(data.ips[0]);
        setLoading(false);
      })
      .catch(() => {
        // Server may not be reachable (pure offline, loaded from cache)
        setLoading(false);
      });
  }, []);

  const copyIp = async (ip: string) => {
    const url = `http://${ip}:${netInfo?.port ?? 3000}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIp(ip);
      toast.success('URL copied to clipboard');
      setTimeout(() => setCopiedIp(null), 2000);
    } catch {
      toast.error('Copy failed');
    }
  };

  const joinUrl = selectedIp ? `http://${selectedIp}:${netInfo?.port ?? 3000}` : null;

  return (
    <div className="p-4 bg-zinc-950/70 border border-emerald-500/20 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <Server className="w-3.5 h-3.5 text-emerald-500" />
        <h3 className="text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-widest">
          Host Mode
        </h3>
      </div>

      {loading && (
        <p className="text-[10px] font-mono text-zinc-500 animate-pulse">Scanning network interfaces…</p>
      )}

      {!loading && (!netInfo || netInfo.ips.length === 0) && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono text-zinc-400">
            No LAN addresses found.
          </p>
          <p className="text-[9px] font-mono text-zinc-600 leading-relaxed">
            Connect to a WiFi network or create a hotspot, then reload this panel.
          </p>
        </div>
      )}

      {!loading && netInfo && netInfo.ips.length > 0 && (
        <>
          <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
            Share an address below with devices on the same WiFi. They scan the QR or type the URL — no internet needed.
          </p>

          {/* IP list */}
          <div className="space-y-1.5">
            {netInfo.ips.map(ip => {
              const url = `http://${ip}:${netInfo.port}`;
              const isSelected = ip === selectedIp;
              return (
                <button
                  key={ip}
                  onClick={() => setSelectedIp(ip)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-white/5 bg-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Wifi className={`w-3 h-3 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    <span className={`text-[10px] font-mono truncate ${isSelected ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {url}
                    </span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); copyIp(ip); }}
                    className="shrink-0 ml-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Copy URL"
                  >
                    {copiedIp === ip
                      ? <CheckCheck className="w-3 h-3 text-emerald-400" />
                      : <Copy className="w-3 h-3" />
                    }
                  </button>
                </button>
              );
            })}
          </div>

          {/* QR Code */}
          {joinUrl && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <div className="p-2 bg-white rounded-lg">
                <QRCodeSVG
                  value={joinUrl}
                  size={120}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-[9px] font-mono text-zinc-600 text-center">
                Scan to join mesh
              </p>
            </div>
          )}

          {/* mDNS hint */}
          <div className="flex items-start gap-1.5 pt-1 border-t border-white/5">
            <Radio className="w-3 h-3 text-zinc-600 shrink-0 mt-0.5" />
            <p className="text-[9px] font-mono text-zinc-600 leading-relaxed">
              Also discoverable as{' '}
              <span className="text-zinc-400">beacon-mesh.local:{netInfo.port}</span>{' '}
              on macOS / iOS (mDNS).
            </p>
          </div>
        </>
      )}
    </div>
  );
};
