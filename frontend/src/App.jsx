import React, { useState, useEffect } from 'react';
import RequestPortal from './components/RequestPortal';
import PlayerDashboard from './components/PlayerDashboard';
import PublicJukebox from './components/PublicJukebox';
import { Tv, Music } from 'lucide-react';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('request');

  useEffect(() => {
    // Quick routing check on initial load
    const handleLocationChange = () => {
      const path = window.location.pathname;
      if (path === '/admin') {
        setCurrentView('admin');
      } else if (path === '/live') {
        setCurrentView('live');
      } else {
        setCurrentView('request');
      }
    };

    handleLocationChange();

    // Listen to history pop events
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigateTo = (view, path) => {
    setCurrentView(view);
    window.history.pushState({}, '', path);
  };

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Navigation Top Bar */}
      <header className="glass border-b border-dark-border/40 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-brand-purple to-brand-pink flex items-center justify-center text-white font-extrabold text-sm shadow-md">
            STI
          </div>
          <span className="font-extrabold text-white tracking-wider text-sm hidden sm:inline-block uppercase">
            STI <span className="text-brand-purple">Jukebox</span>
          </span>
        </div>
        
        {/* Router Navigation Tabs */}
        <div className="flex items-center gap-2 bg-dark/60 border border-dark-border/50 rounded-xl p-1">
          <button
            onClick={() => navigateTo('request', '/')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              currentView === 'request'
                ? 'bg-gradient-to-r from-brand-purple to-brand-pink text-white shadow-md shadow-brand-purple/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            Request Portal
          </button>
          <button
            onClick={() => navigateTo('live', '/live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              currentView === 'live'
                ? 'bg-brand-cyan text-white shadow-md shadow-brand-cyan/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            Live Jukebox
          </button>
        </div>
      </header>

      {/* Main Screen Content */}
      <main className="flex-1">
        {currentView === 'request' && <RequestPortal />}
        {currentView === 'live' && <PublicJukebox />}
        {currentView === 'admin' && <PlayerDashboard />}
      </main>

      {/* Brand Footer */}
      <footer className="py-6 text-center text-[10px] text-slate-500 font-semibold border-t border-dark-border/10 uppercase tracking-widest">
        © 2026 STI Jukebox • Real-time Crowdsourced Playback System
      </footer>
    </div>
  );
}

export default App;
