import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import {
  Play, Pause, SkipForward, Trash2, ListMusic, QrCode,
  Tv, Volume2, Database, Disc, Sparkles, Lock
} from 'lucide-react';

const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

export default function PlayerDashboard() {
  const [isAuthorized, setIsAuthorized] = useState(() => {
    return localStorage.getItem('admin_authorized') === 'true';
  });
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(50);
  const [completedCount, setCompletedCount] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => {
    return localStorage.getItem('admin_autoplay_enabled') !== 'false';
  });
  const [autoplayKeywords, setAutoplayKeywords] = useState(() => {
    return localStorage.getItem('admin_autoplay_keywords') || 'Latest trending pop song Indonesia';
  });

  const isAutoplayingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('admin_autoplay_enabled', autoplayEnabled.toString());
  }, [autoplayEnabled]);

  useEffect(() => {
    localStorage.setItem('admin_autoplay_keywords', autoplayKeywords);
  }, [autoplayKeywords]);

  const handleAuthorize = (e) => {
    e.preventDefault();
    const adminSecret = import.meta.env.VITE_ADMIN_SECRET || 'admin123';
    if (password === adminSecret) {
      setIsAuthorized(true);
      localStorage.setItem('admin_authorized', 'true');
      setAuthError('');
      setPassword('');
    } else {
      setAuthError('Incorrect admin password.');
    }
  };

  const handleLock = () => {
    setIsAuthorized(false);
    localStorage.removeItem('admin_authorized');
  };

  const playerRef = useRef(null);
  const queueRef = useRef([]);

  // Find currently playing/paused song from queue
  const currentSong = queue.find(s => s.status === 'playing' || s.status === 'paused') || null;
  const currentSongRef = useRef(null);
  const loadedVideoIdRef = useRef('');

  // Sync references to avoid stale closures in YouTube event callbacks
  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const triggerAutoplay = async (force = false) => {
    if (!force && isAutoplayingRef.current) return;
    isAutoplayingRef.current = true;

    try {
      const userKeywords = autoplayKeywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

      const defaultPool = [
        'Jay Chou',
        'Lofi hip hop beats chill',
        'Synthwave retro beats',
        'Guzheng traditional Chinese instrumental',
        'Chinese pop songs classic',
        'Chill cafe background music',
        'Acoustic guitar covers',
        'Tiger and Dragon drum music'
      ];

      const activePool = userKeywords.length > 0 ? userKeywords : defaultPool;
      const randomKeyword = activePool[Math.floor(Math.random() * activePool.length)];
      console.log('Autoplay fallback triggered (forced:', force, '). Querying search for:', randomKeyword);

      const searchRes = await fetch(`${backendUrl}/api/search-songs?q=${encodeURIComponent(randomKeyword)}`);
      if (!searchRes.ok) throw new Error('Search failed');
      const results = await searchRes.json();

      if (results && results.length > 0) {
        const randomTrack = results[Math.floor(Math.random() * Math.min(results.length, 3))];
        console.log('Autoplay selected song:', randomTrack.title, 'by', randomTrack.artist);

        const queueRes = await fetch(`${backendUrl}/api/queue-song`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            link: `https://www.youtube.com/watch?v=${randomTrack.id}`,
            requestedBy: 'Autoplay'
          })
        });

        if (!queueRes.ok) {
          throw new Error('Failed to queue fallback song');
        }
      }
    } catch (err) {
      console.error('Autoplay fallback queue error:', err);
    } finally {
      setTimeout(() => {
        isAutoplayingRef.current = false;
      }, 5000);
    }
  };

  const getNextSong = (trackList) => {
    let next = trackList.find(s => s.status === 'queued' && s.requested_by !== 'Autoplay');
    if (!next) {
      next = trackList.find(s => s.status === 'queued');
    }
    return next;
  };

  // Fetch queue initially and count completed songs
  const fetchQueue = async () => {
    const { data, error } = await supabase
      .from('songs_queue')
      .select('*')
      .in('status', ['queued', 'playing', 'paused'])
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching queue:', error);
      return;
    }

    setQueue(data);

    const playingSong = data.find(s => s.status === 'playing' || s.status === 'paused');
    const hasGuestRequest = data.some(s => s.status === 'queued' && s.requested_by !== 'Autoplay');

    if (playingSong) {
      // Immediate transition: guest requested a song while autoplay fallback is active
      if (playingSong.requested_by === 'Autoplay' && hasGuestRequest) {
        console.log('Immediate transition: guest requested a song while fallback is active. Skipping:', playingSong.title);
        try {
          await fetch(`${backendUrl}/api/admin/skip-song`, {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ id: playingSong.id }),
          });

          const oldestQueued = getNextSong(data);
          if (oldestQueued) {
            await startSong(oldestQueued.id);
          }
        } catch (err) {
          console.error('Failed to immediately skip fallback song:', err);
        }
      }
    } else {
      const oldestQueued = getNextSong(data);
      if (oldestQueued) {
        await startSong(oldestQueued.id);
      } else if (autoplayEnabled) {
        await triggerAutoplay();
      }
    }
  };

  const fetchCompletedCount = async () => {
    const { count, error } = await supabase
      .from('songs_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    if (!error) {
      setCompletedCount(count || 0);
    }
  };

  const getAdminHeaders = () => {
    const secret = import.meta.env.VITE_ADMIN_SECRET || 'admin123';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`
    };
  };

  const startSong = async (id) => {
    try {
      await fetch(`${backendUrl}/api/admin/start-song`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error('Failed to start song:', err);
    }
  };

  // Setup initial fetch and real-time subscription
  useEffect(() => {
    fetchQueue();
    fetchCompletedCount();

    const channel = supabase
      .channel('songs_queue_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'songs_queue' },
        (payload) => {
          console.log('Realtime Queue Update:', payload);
          fetchQueue();
          fetchCompletedCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (autoplayEnabled && queue.length === 0) {
      fetchQueue();
    }
  }, [autoplayEnabled]);

  // --- YouTube IFrame API Initialization ---
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    window.onYouTubeIframeAPIReady = () => {
      initPlayer();
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  const initPlayer = () => {
    if (playerRef.current) return;

    playerRef.current = new window.YT.Player('yt-player', {
      height: '100%',
      width: '100%',
      videoId: '',
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: (event) => {
          console.log('YouTube Player Ready');
          event.target.setVolume(volume);
          if (currentSongRef.current) {
            event.target.loadVideoById(currentSongRef.current.youtube_video_id);
            event.target.playVideo();
            loadedVideoIdRef.current = currentSongRef.current.youtube_video_id;
            setIsPlaying(true);
          }
        },
        onStateChange: (event) => {
          // 0 = ENDED
          if (event.data === window.YT.PlayerState.ENDED) {
            handleSongEnded();
          } else if (event.data === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true);
          } else if (event.data === window.YT.PlayerState.PAUSED) {
            setIsPlaying(false);
          }
        },
        onError: (event) => {
          console.error('YouTube Player error details:', event.data);
          // Auto skip in case the video is copy-protected, restricted or deleted
          handleSkip();
        }
      }
    });
  };

  // Watch currentSong changes to load corresponding YouTube ID and control play/pause
  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById && currentSong) {
      if (loadedVideoIdRef.current !== currentSong.youtube_video_id) {
        playerRef.current.loadVideoById(currentSong.youtube_video_id);
        loadedVideoIdRef.current = currentSong.youtube_video_id;
      }

      if (currentSong.status === 'playing') {
        playerRef.current.playVideo();
        setIsPlaying(true);
      } else if (currentSong.status === 'paused') {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      }
    } else if (!currentSong && playerRef.current && playerRef.current.stopVideo) {
      playerRef.current.stopVideo();
      loadedVideoIdRef.current = '';
      setIsPlaying(false);
    }
  }, [currentSong]);

  // Adjust volume
  const handleVolumeChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setVolume(val);
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(val);
    }
  };

  // Playback Control actions
  const handlePlayPause = async () => {
    if (!currentSong) return;
    const endpoint = currentSong.status === 'playing' ? 'pause-song' : 'resume-song';
    try {
      await fetch(`${backendUrl}/api/admin/${endpoint}`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ id: currentSong.id }),
      });
    } catch (err) {
      console.error('Failed to toggle play/pause:', err);
    }
  };

  const handleSongEnded = async () => {
    const active = currentSongRef.current;
    if (active) {
      try {
        await fetch(`${backendUrl}/api/admin/end-song`, {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ id: active.id }),
        });

        const activeQueue = queueRef.current;
        const nextSong = getNextSong(activeQueue);
        if (nextSong) {
          await startSong(nextSong.id);
        }
      } catch (err) {
        console.error('Failed to complete song:', err);
      }
    }
  };

  const handleSkip = async () => {
    const active = currentSongRef.current;
    if (active) {
      try {
        await fetch(`${backendUrl}/api/admin/skip-song`, {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ id: active.id }),
        });

        const activeQueue = queueRef.current;
        const nextSong = getNextSong(activeQueue);
        if (nextSong) {
          await startSong(nextSong.id);
        }
      } catch (err) {
        console.error('Failed to skip song:', err);
      }
    }
  };

  const handleDeleteSong = async (id) => {
    if (currentSong && currentSong.id === id) {
      await handleSkip();
    } else {
      try {
        await fetch(`${backendUrl}/api/admin/song/${id}`, {
          method: 'DELETE',
          headers: getAdminHeaders(),
        });
      } catch (err) {
        console.error('Failed to delete song:', err);
      }
    }
  };

  const handleClearQueue = async () => {
    if (window.confirm('Are you sure you want to clear the entire queue?')) {
      try {
        await fetch(`${backendUrl}/api/admin/queue`, {
          method: 'DELETE',
          headers: getAdminHeaders(),
        });
      } catch (err) {
        console.error('Failed to clear queue:', err);
      }
    }
  };

  // Generate dynamic QR code targeting the request app homepage
  const qrTargetUrl = window.location.origin;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrTargetUrl)}&color=0B0F19&bgcolor=ffffff`;

  const queuedTracks = queue.filter(s => s.status === 'queued');

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] px-4">
        <div className="w-full max-w-md glass rounded-2xl p-8 glass-glow-pink text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-brand-pink/10 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none"></div>

          <div className="inline-flex items-center justify-center p-3.5 bg-brand-pink/25 text-brand-pink rounded-full mb-5 animate-pulse-slow">
            <Lock className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Admin Panel Locked</h2>
          <p className="text-xs text-slate-400 max-w-xs mx-auto mb-6">
            Please enter the administrator secret key to unlock playback controls and queue management.
          </p>

          <form onSubmit={handleAuthorize} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="block w-full rounded-xl border border-dark-border bg-dark/50 py-3.5 px-4 text-center text-sm text-white placeholder-slate-500 focus:border-brand-pink focus:outline-none focus:ring-1 focus:ring-brand-pink transition-colors"
              />
            </div>

            {authError && (
              <div className="text-red-400 text-xs font-semibold animate-shake">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-pink to-brand-purple text-white font-bold rounded-xl shadow-lg shadow-brand-pink/20 hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
            >
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Top Admin Dashboard Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="glass rounded-xl p-5 border border-dark-border/40 relative overflow-hidden flex items-center gap-4">
          <div className="p-3 bg-brand-purple/20 text-brand-purple rounded-lg">
            <ListMusic className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Queue Length</p>
            <h3 className="text-2xl font-bold text-white mt-0.5">{queuedTracks.length} tracks</h3>
          </div>
        </div>

        <div className="glass rounded-xl p-5 border border-dark-border/40 relative overflow-hidden flex items-center gap-4">
          <div className="p-3 bg-brand-cyan/20 text-brand-cyan rounded-lg">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Completed Tracks</p>
            <h3 className="text-2xl font-bold text-white mt-0.5">{completedCount} songs</h3>
          </div>
        </div>

        <div className="glass rounded-xl p-5 border border-dark-border/40 relative overflow-hidden flex items-center gap-4">
          <div className="p-3 bg-brand-emerald/20 text-brand-emerald rounded-lg">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sync Connection</p>
            <h3 className="text-md font-bold text-brand-emerald mt-1 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-emerald animate-pulse"></span>
              Live Realtime
            </h3>
          </div>
        </div>

        <div className="glass rounded-xl p-5 border border-dark-border/40 relative overflow-hidden flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-pink/20 text-brand-pink rounded-lg">
              <Tv className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Player Mode</p>
              <h3 className="text-2xl font-bold text-white mt-0.5">Central Screen</h3>
            </div>
          </div>
          <button
            onClick={handleLock}
            title="Lock admin controls"
            className="p-2 bg-dark/40 border border-dark-border/50 text-slate-400 hover:text-brand-pink hover:bg-brand-pink/10 rounded-lg transition-all cursor-pointer"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Panel grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

        {/* Left 2 Columns: Player Container */}
        <div className="md:col-span-1 lg:col-span-2 space-y-6">
          <div className="glass rounded-2xl p-6 glass-glow-cyan border border-brand-cyan/25 overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Disc className={`w-6 h-6 text-brand-cyan ${isPlaying ? 'animate-spin-slow' : ''}`} />
              Now Playing
            </h2>

            {/* Aspect Widescreen Video Embed Container */}
            <div className="aspect-video w-full bg-dark/80 rounded-xl overflow-hidden border border-dark-border relative">
              <div id="yt-player" className="w-full h-full"></div>

              {!currentSong && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-dark/95 z-10">
                  <div className="w-16 h-16 rounded-full bg-dark-accent/40 flex items-center justify-center mb-4 text-slate-500 border border-dark-border">
                    <ListMusic className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-white">Queue is Empty</h4>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Scan the QR code to request a song, and it will start playing automatically.
                  </p>
                </div>
              )}
            </div>

            {/* Current Song Details and Active Playback Controls */}
            {currentSong && (
              <div className="mt-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="min-w-0">
                  <span className="text-[10px] font-extrabold tracking-widest text-brand-cyan bg-brand-cyan/15 px-2.5 py-1 rounded-full uppercase">
                    Playing Live
                  </span>
                  <h3 className="text-xl font-bold text-white mt-2 truncate">{currentSong.title}</h3>
                  <p className="text-sm text-slate-400 truncate mt-0.5">{currentSong.artist}</p>
                </div>

                {/* Control Panel */}
                <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
                  {/* Volume Slider */}
                  <div className="flex items-center gap-2 mr-3 bg-dark/40 border border-dark-border/40 rounded-xl px-3 py-2 shrink-0">
                    <Volume2 className="w-4 h-4 text-slate-400" />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-20 accent-brand-cyan h-1 cursor-pointer bg-dark-border"
                    />
                  </div>

                  <button
                    onClick={handlePlayPause}
                    className="p-3 bg-white text-dark hover:scale-105 active:scale-95 rounded-full transition-all shadow-md cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                  </button>

                  <button
                    onClick={handleSkip}
                    title="Skip current song"
                    className="p-3 bg-brand-cyan/20 text-brand-cyan hover:bg-brand-cyan hover:text-white active:scale-95 rounded-full transition-all cursor-pointer"
                  >
                    <SkipForward className="w-5 h-5 fill-current" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Column: Queue List & QR Code panel */}
        <div className="space-y-6">

          {/* QR Code Container */}
          <div className="glass rounded-2xl p-6 border border-dark-border/40 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-16 h-16 bg-brand-purple/5 rounded-full blur-xl -ml-4 -mt-4"></div>
            <h2 className="text-md font-bold text-white mb-4 flex items-center justify-center gap-2">
              <QrCode className="w-5 h-5 text-brand-purple" />
              Request Portal QR Code
            </h2>
            <div className="inline-block bg-white p-3 rounded-xl shadow-lg border border-slate-200">
              <img
                src={qrCodeUrl}
                alt="Scan here to request songs"
                className="w-40 h-40 object-cover"
              />
            </div>
            <p className="text-[10px] text-brand-purple font-semibold tracking-wider uppercase mt-4">
              Scan to request songs
            </p>
            <p className="text-[10px] text-slate-500 font-medium truncate mt-1">
              {qrTargetUrl}
            </p>
          </div>

          {/* Queue List Panel */}
          <div className="glass rounded-2xl p-6 border border-dark-border/40 flex flex-col min-h-[400px]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-md font-bold text-white flex items-center gap-2">
                <ListMusic className="w-5 h-5 text-slate-400" />
                Up Next ({queuedTracks.length})
              </h2>
              {queuedTracks.length > 0 && (
                <button
                  onClick={handleClearQueue}
                  className="text-xs text-red-400 hover:text-red-300 font-bold tracking-wide uppercase transition-colors cursor-pointer"
                >
                  Clear Queue
                </button>
              )}
            </div>

            {/* Autoplay Fallback Toggle */}
            <div className="mb-4 bg-dark/30 border border-dark-border/40 rounded-xl p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">Autoplay Fallback</span>
                  <span className="text-[10px] text-slate-400">Play fallback songs when queue is empty</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoplayEnabled}
                    onChange={(e) => setAutoplayEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-dark-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-pink peer-checked:after:bg-white peer-checked:after:border-transparent"></div>
                </label>
              </div>

              {autoplayEnabled && (
                <div className="space-y-1.5 border-t border-dark-border/20 pt-2.5">
                  <label htmlFor="autoplay-keywords" className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
                    Fallback Keywords (comma-separated)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="autoplay-keywords"
                      value={autoplayKeywords}
                      onChange={(e) => setAutoplayKeywords(e.target.value)}
                      placeholder="e.g. Jay Chou, Lofi beats, Synthwave"
                      className="block flex-1 rounded-lg border border-dark-border bg-dark/50 py-1.5 px-3 text-xs text-white placeholder-slate-500 focus:border-brand-pink focus:outline-none focus:ring-1 focus:ring-brand-pink transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => triggerAutoplay(true)}
                      className="px-3 py-1.5 bg-brand-pink/20 hover:bg-brand-pink hover:text-white text-brand-pink rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0"
                      title="Trigger autoplay search immediately"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Queue Now
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Tracks container */}
            <div className="flex-1 overflow-y-auto space-y-3 max-h-[300px] pr-1.5">
              {queuedTracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
                  <Disc className="w-8 h-8 opacity-20 mb-2 animate-spin-slow" />
                  <p className="text-xs font-semibold">No songs in line</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Submit via QR code code to queue up.</p>
                </div>
              ) : (
                queuedTracks.map((song, idx) => (
                  <div
                    key={song.id}
                    className="flex items-center justify-between gap-3 p-3 bg-dark/40 border border-dark-border/50 rounded-xl glass-card-hover group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500">
                          #{idx + 1}
                        </span>
                        <h4 className="text-sm font-bold text-white truncate">{song.title}</h4>
                      </div>
                      <p className="text-xs text-brand-purple font-medium truncate ml-5">{song.artist}</p>
                    </div>

                    <button
                      onClick={() => handleDeleteSong(song.id)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-2 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
