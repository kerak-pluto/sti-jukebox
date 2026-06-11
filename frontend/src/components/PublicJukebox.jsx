import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Disc, ListMusic, Volume2, Sparkles, Tv, Music, QrCode } from 'lucide-react';

// Helper to clean uploader/video titles from YouTube links to get high-accuracy matches on LRCLIB
const cleanLyricsSearchQuery = (artist, title, sourceType) => {
  let queryArtist = artist;
  let queryTitle = title;

  if (sourceType === 'youtube') {
    const hyphenIndex = title.indexOf('-');
    if (hyphenIndex !== -1) {
      queryArtist = title.substring(0, hyphenIndex).trim();
      queryTitle = title.substring(hyphenIndex + 1).trim();
    }
    
    const isVevoOrLyricChannel = /vevo|lyrics|music|records|audio|channel|upload/i.test(artist);
    if (isVevoOrLyricChannel && hyphenIndex !== -1) {
      // Trust split title artist over vevo channel title
    } else if (isVevoOrLyricChannel && hyphenIndex === -1) {
      queryArtist = artist.replace(/vevo/i, '').trim();
    }
  }

  const cleanString = (str) => {
    return str
      .replace(/\s*[\(\[][^)]*official[^)]*[\)\]]/gi, '')
      .replace(/\s*[\(\[][^)]*lyrics[^)]*[\)\]]/gi, '')
      .replace(/\s*[\(\[][^)]*music video[^)]*[\)\]]/gi, '')
      .replace(/\s*[\(\[][^)]*audio[^)]*[\)\]]/gi, '')
      .replace(/\s*[\(\[][^)]*video[^)]*[\)\]]/gi, '')
      .replace(/\s*[\(\[]ft\..*?[\)\]]/gi, '')
      .replace(/\s*[\(\[]feat\..*?[\)\]]/gi, '')
      .replace(/\s*ft\..*?$/i, '')
      .replace(/\s*feat\..*?$/i, '')
      .trim();
  };

  const finalArtist = cleanString(queryArtist);
  const finalTitle = cleanString(queryTitle);

  return `${finalArtist} ${finalTitle}`;
};

export default function PublicJukebox() {
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(50);
  const playerRef = useRef(null);
  const loadedVideoIdRef = useRef('');

  // Lyrics and synchronization state
  const [currentTime, setCurrentTime] = useState(0);
  const [lyricsState, setLyricsState] = useState({
    loading: false,
    synced: [],
    plain: '',
    error: null
  });

  const activeLineRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Synced LRC format parser
  const parseSyncedLyrics = (lrcString) => {
    if (!lrcString) return [];
    const lines = lrcString.split('\n');
    const parsed = [];
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;

    for (let line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(regex);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const ms = parseInt(match[3], 10);
        const text = match[4].trim();
        const fractionDivisor = match[3].length === 3 ? 1000 : 100;
        const time = minutes * 60 + seconds + ms / fractionDivisor;
        parsed.push({ time, text });
      }
    }
    return parsed.sort((a, b) => a.time - b.time);
  };

  // Find the currently playing or paused song
  const currentSong = queue.find(s => s.status === 'playing' || s.status === 'paused') || null;

  const fetchQueue = async () => {
    const { data, error } = await supabase
      .from('songs_queue')
      .select('*')
      .in('status', ['queued', 'playing', 'paused'])
      .order('created_at', { ascending: true });

    if (!error) {
      setQueue(data);
    }
  };

  useEffect(() => {
    fetchQueue();

    // Subscribe to queue changes
    const channel = supabase
      .channel('public_queue_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'songs_queue' },
        () => {
          fetchQueue();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Initialize YouTube IFrame Player
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

    playerRef.current = new window.YT.Player('public-yt-player', {
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
          event.target.setVolume(volume);
          if (currentSong) {
            event.target.loadVideoById(currentSong.youtube_video_id);
            loadedVideoIdRef.current = currentSong.youtube_video_id;
            if (currentSong.status === 'playing') {
              event.target.playVideo();
              setIsPlaying(true);
            } else if (currentSong.status === 'paused') {
              event.target.pauseVideo();
              setIsPlaying(false);
            }
          }
        },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true);
          } else if (event.data === window.YT.PlayerState.PAUSED) {
            setIsPlaying(false);
          }
        }
      }
    });
  };

  // Sync loaded video ID with database active playing track and control play/pause
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

  // Fetch lyrics when current song changes
  useEffect(() => {
    if (!currentSong) {
      setLyricsState({ loading: false, synced: [], plain: '', error: null });
      return;
    }

    const fetchLyrics = async () => {
      setLyricsState(prev => ({ ...prev, loading: true, error: null }));
      try {
        const query = cleanLyricsSearchQuery(currentSong.artist, currentSong.title, currentSong.source_type);
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Lyrics search failed');
        const data = await res.json();
        
        if (data && data.length > 0) {
          const match = data.find(track => track.syncedLyrics || track.plainLyrics);
          if (match) {
            setLyricsState({
              loading: false,
              synced: parseSyncedLyrics(match.syncedLyrics),
              plain: match.plainLyrics || '',
              error: null
            });
            return;
          }
        }
        
        setLyricsState({
          loading: false,
          synced: [],
          plain: '',
          error: 'Lyrics not found'
        });
      } catch (err) {
        console.error('Lyrics Fetch Error:', err);
        setLyricsState({
          loading: false,
          synced: [],
          plain: '',
          error: 'Failed to load lyrics'
        });
      }
    };

    fetchLyrics();
  }, [currentSong]);

  // Track YouTube player time when playing
  useEffect(() => {
    let interval = null;
    if (isPlaying && playerRef.current && playerRef.current.getCurrentTime) {
      interval = setInterval(() => {
        try {
          setCurrentTime(playerRef.current.getCurrentTime());
        } catch (e) {
          // Ignore errors from uninitialized player API calls
        }
      }, 250);
    } else {
      setCurrentTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  // Find active synced lyric line index
  const activeLineIndex = lyricsState.synced.findIndex((line, index) => {
    const nextLine = lyricsState.synced[index + 1];
    return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
  });

  // Auto-scroll active lyric line to center of container
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      const activeEl = activeLineRef.current;
      const container = scrollContainerRef.current;
      
      const containerHeight = container.clientHeight;
      const activeOffsetTop = activeEl.offsetTop;
      const activeHeight = activeEl.clientHeight;
      
      container.scrollTo({
        top: activeOffsetTop - containerHeight / 2 + activeHeight / 2,
        behavior: 'smooth'
      });
    }
  }, [activeLineIndex]);

  const handleVolumeChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setVolume(val);
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(val);
    }
  };

  const queuedTracks = queue.filter(s => s.status === 'queued');

  // Generate dynamic QR code targeting the request app homepage
  const qrTargetUrl = window.location.origin;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrTargetUrl)}&color=0B0F19&bgcolor=ffffff`;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Upper Info Banner */}
      <div className="glass rounded-xl p-4 mb-6 border border-brand-purple/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-purple/20 text-brand-purple rounded-lg animate-pulse-slow">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Live Theater Mode</h4>
            <p className="text-xs text-slate-400">Sit back and enjoy! The music auto-plays in sync with the venue.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest bg-dark/50 px-3 py-1.5 rounded-lg border border-dark-border/40">
          <span className="w-2 h-2 rounded-full bg-brand-cyan animate-pulse"></span>
          Live Stream Sync
        </div>
      </div>

      {/* Main Grid: Player vs Queue */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        
        {/* Left Side (2/3): Theater Player */}
        <div className="md:col-span-1 lg:col-span-2 space-y-6">
          <div className="glass rounded-2xl p-6 border border-brand-cyan/20 shadow-[0_0_40px_-10px_rgba(6,182,212,0.15)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-cyan/5 rounded-full blur-3xl -mr-6 -mt-6"></div>
            
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2.5">
              <Tv className="w-6 h-6 text-brand-cyan" />
              Theater Screen
            </h2>

            {/* Giant Theater Mode Aspect Widescreen Player */}
            <div className="aspect-video w-full bg-dark/90 rounded-xl overflow-hidden border-2 border-brand-cyan/30 shadow-[0_0_30px_-5px_rgba(6,182,212,0.25)] relative">
              <div id="public-yt-player" className="w-full h-full"></div>
              
              {!currentSong && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-dark/95 z-10">
                  <div className="w-16 h-16 rounded-full bg-dark-accent/40 flex items-center justify-center mb-4 text-slate-600 border border-dark-border">
                    <Music className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-white">No active track</h4>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Scan the QR code to request a song and trigger live playback.
                  </p>
                </div>
              )}
            </div>

            {/* Theater Mode Metacard (No Admin Play/Pause or Skip Buttons) */}
            {currentSong && (
              <div className="mt-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-cyan/15 border border-brand-cyan/25">
                    <Disc className="w-3.5 h-3.5 text-brand-cyan animate-spin-slow" />
                    <span className="text-[10px] font-extrabold tracking-widest text-brand-cyan uppercase">
                      ON AIR
                    </span>
                  </div>
                  <h3 className="text-2xl font-black text-white mt-3 truncate tracking-tight">{currentSong.title}</h3>
                  <p className="text-sm text-slate-400 truncate mt-1">{currentSong.artist}</p>
                </div>

                {/* Local Spectator Volume Control */}
                <div className="flex items-center gap-2.5 bg-dark/60 border border-dark-border/60 rounded-xl px-4 py-2.5 shrink-0 self-stretch lg:self-auto justify-center">
                  <Volume2 className="w-4 h-4 text-slate-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-24 accent-brand-cyan h-1 cursor-pointer bg-dark-border"
                  />
                  <span className="text-[10px] font-bold text-slate-400 w-6 text-right">{volume}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Lyrics Panel Card */}
          {currentSong && (
            <div className="glass rounded-2xl p-6 border border-brand-purple/20 shadow-[0_0_30px_-5px_rgba(217,37,52,0.1)] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-purple/5 rounded-full blur-2xl -mr-6 -mt-6"></div>
              
              <div className="flex items-center gap-2 mb-4 border-b border-dark-border/30 pb-2">
                <Music className="w-5 h-5 text-brand-pink" />
                <h3 className="text-md font-bold text-white">Song Lyrics</h3>
              </div>

              {lyricsState.loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Disc className="w-8 h-8 animate-spin text-brand-pink mb-3" />
                  <p className="text-xs font-semibold">Searching for lyrics...</p>
                </div>
              ) : lyricsState.error ? (
                <div className="text-center py-12 text-slate-500 text-xs font-semibold">
                  {lyricsState.error}
                </div>
              ) : lyricsState.synced.length > 0 ? (
                /* Synced Lyrics Scroll Area */
                <div 
                  ref={scrollContainerRef}
                  className="h-64 overflow-y-auto pr-2 relative scroll-smooth flex flex-col items-center"
                  style={{ 
                    maskImage: 'linear-gradient(to bottom, transparent, white 20%, white 80%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent, white 20%, white 80%, transparent)'
                  }}
                >
                  <div className="py-24 w-full flex flex-col items-center">
                    {lyricsState.synced.map((line, idx) => {
                      const isActive = idx === activeLineIndex;
                      return (
                        <p
                          key={idx}
                          ref={isActive ? activeLineRef : null}
                          className={`text-center py-3 transition-all duration-300 font-display leading-relaxed tracking-tight ${
                            isActive
                              ? 'text-brand-pink text-2xl font-black scale-105 drop-shadow-[0_0_8px_rgba(212,175,55,0.45)]'
                              : 'text-slate-400 text-base font-bold opacity-30'
                          }`}
                        >
                          {line.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ) : lyricsState.plain ? (
                /* Plain Static Lyrics Scroll Area */
                <div className="h-64 overflow-y-auto pr-2 text-center">
                  <div className="py-4 whitespace-pre-line text-slate-300 text-base font-bold font-display tracking-tight leading-relaxed">
                    {lyricsState.plain}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs font-semibold">
                  No lyrics found for this song.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Side (1/3): QR Code & Read-Only Queue Lineup */}
        <div className="space-y-6 md:sticky md:top-24 h-fit">
          
          {/* QR Code Container */}
          <div className="glass rounded-2xl p-6 border border-dark-border/40 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-16 h-16 bg-brand-purple/5 rounded-full blur-xl -ml-4 -mt-4"></div>
            <h2 className="text-md font-bold text-white mb-4 flex items-center justify-center gap-2">
              <QrCode className="w-5 h-5 text-brand-purple" />
              Request Song Here
            </h2>
            <div className="inline-block bg-white p-3 rounded-xl shadow-lg border border-slate-200">
              <img 
                src={qrCodeUrl} 
                alt="Scan here to request songs"
                className="w-36 h-36 object-cover" 
              />
            </div>
            <p className="text-[10px] text-brand-purple font-semibold tracking-wider uppercase mt-4">
              Scan QR to Request
            </p>
            <p className="text-[10px] text-slate-500 font-medium truncate mt-1">
              {qrTargetUrl}
            </p>
          </div>

          {/* Read-Only Queue Lineup */}
          <div className="glass rounded-2xl p-6 border border-dark-border/40 flex flex-col min-h-[300px]">
            <h2 className="text-md font-bold text-white mb-4 flex items-center gap-2 border-b border-dark-border/30 pb-3">
              <ListMusic className="w-5 h-5 text-slate-400" />
              Playlist Lineup ({queuedTracks.length})
            </h2>

            <div className="flex-1 overflow-y-auto space-y-3 max-h-[300px] pr-1.5">
              {queuedTracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
                  <Disc className="w-8 h-8 opacity-20 mb-2 animate-spin-slow" />
                  <p className="text-xs font-semibold">Lineup is Empty</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Submit your favorites to see them here.</p>
                </div>
              ) : (
                queuedTracks.map((song, idx) => (
                  <div 
                    key={song.id}
                    className="flex items-center justify-between gap-3 p-3.5 bg-dark/30 border border-dark-border/30 rounded-xl"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold text-slate-500 bg-dark-accent/40 w-5 h-5 rounded flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <h4 className="text-sm font-bold text-white truncate">{song.title}</h4>
                      </div>
                      <p className="text-xs text-brand-purple font-medium truncate ml-7 mt-0.5">{song.artist}</p>
                    </div>
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
