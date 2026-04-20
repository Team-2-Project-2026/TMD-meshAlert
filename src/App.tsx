import React, { useState } from 'react';
import { MeshProvider } from '@/lib/MeshContext';
import { StatusToolbar } from '@/components/StatusToolbar';
import { BroadcastHub } from '@/components/BroadcastHub';
import { MeshMap } from '@/components/MeshMap';
import { SupportResources } from '@/components/SupportResources';
import { PeersList } from '@/components/PeersList';
import { Toaster } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Radio, Map as MapIcon, Shield, Menu, MessageSquare, Users } from 'lucide-react';
import { HostModePanel } from '@/components/HostModePanel';
import { motion } from 'framer-motion';

import { useMesh } from '@/lib/MeshContext';

export default function App() {
  return (
    <MeshProvider>
      <AppInner />
    </MeshProvider>
  );
}

function AppInner() {
  const [activeTab, setActiveTab] = useState('broadcast');
  const { isConnected } = useMesh();

  return (
    <>
    <div className={`flex flex-col h-screen bg-black text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200 transition-all duration-1000 ${!isConnected ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.15)] ring-1 ring-inset ring-red-500/10' : ''}`}>
      <StatusToolbar />

        <main className="flex-1 flex overflow-hidden p-2 md:p-4 gap-4">
          {/* Desktop Sidebar - Mesh Info / Resources */}
          <div className="hidden lg:flex flex-col w-[300px] shrink-0 gap-4">
             <SupportResources />
             <HostModePanel />
             <div className="p-4 bg-zinc-950/50 border border-white/5 rounded-xl">
                <h3 className="text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-widest mb-2">Protocol Status</h3>
                <div className="space-y-1.5">
                   <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-500">ENCRYPTION</span>
                      <span className="text-zinc-300">P2P_RSA_4096</span>
                   </div>
                   <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-500">ROUTING</span>
                      <span className="text-zinc-300">GOSSIP_V2.1</span>
                   </div>
                   <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-zinc-500">MAX_HOPS</span>
                      <span className="text-zinc-300">7_RELAYS</span>
                   </div>
                </div>
             </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 flex flex-col min-w-0 gap-4 pb-14 lg:pb-0">
             <div className="flex-1 lg:h-[40%] xl:h-[45%] shrink-0">
                <MeshMap />
             </div>
             
             <div className="flex-1 flex flex-col min-h-0 bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                  <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between bg-black/20">
                    <TabsList className="bg-transparent h-auto p-0 gap-6">
                      <TabsTrigger 
                        value="broadcast" 
                        className="p-0 text-zinc-500 data-[state=active]:text-emerald-500 bg-transparent h-auto border-none shadow-none font-mono text-[10px] uppercase font-bold tracking-widest flex items-center gap-2"
                      >
                        <Radio className="w-3.5 h-3.5" />
                        Airwaves
                      </TabsTrigger>
                      <TabsTrigger 
                        value="peers" 
                        className="p-0 text-zinc-500 data-[state=active]:text-blue-500 bg-transparent h-auto border-none shadow-none font-mono text-[10px] uppercase font-bold tracking-widest flex items-center gap-2"
                      >
                        <Users className="w-3.5 h-3.5" />
                        Nearby Nodes
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  
                  <div className="flex-1 overflow-hidden">
                    <TabsContent value="broadcast" className="h-full m-0 p-0">
                      <BroadcastHub />
                    </TabsContent>
                    <TabsContent value="peers" className="h-full m-0 p-0">
                      <PeersList />
                    </TabsContent>
                  </div>
                </Tabs>
             </div>
          </div>

          {/* Mobile Bottom Navigation (Conceptual for responsiveness) */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 h-14 bg-black/80 backdrop-blur-xl border-t border-white/10 flex items-center justify-around px-4 z-50">
             <button className={`p-2 ${activeTab === 'broadcast' ? 'text-emerald-500' : 'text-zinc-500'}`} onClick={() => setActiveTab('broadcast')}><Radio className="w-5 h-5" /></button>
             <button className={`p-2 ${activeTab === 'peers' ? 'text-blue-500' : 'text-zinc-500'}`} onClick={() => setActiveTab('peers')}><Users className="w-5 h-5" /></button>
             <button className="p-2 text-zinc-500"><Shield className="w-5 h-5" /></button>
             <button className="p-2 text-zinc-500"><Menu className="w-5 h-5" /></button>
          </div>
        </main>

        <Toaster theme="dark" position="top-right" expand={false} />
      </div>
      
      {/* Visual background elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-red-500/5 blur-[120px] rounded-full" />
      </div>
    </>
  );
}
