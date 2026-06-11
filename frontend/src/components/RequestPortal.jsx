import React, { useState } from 'react';
import { Music, AlertCircle, CheckCircle, Flame, Send, Link2 } from 'lucide-react';

export default function RequestPortal() {
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const YOUTUBE_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
  const SPOTIFY_REGEX = /open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedLink = link.trim();
    if (!trimmedLink) {
      setError('Please paste a link to get started!');
      return;
    }

    const isYT = YOUTUBE_REGEX.test(trimmedLink);
    const isSp = SPOTIFY_REGEX.test(trimmedLink);

    if (!isYT && !isSp) {
      setError('Invalid link. Paste a valid Spotify Track or YouTube URL (e.g. open.spotify.com/track/... or youtube.com/watch?v=...)');
      return;
    }

    setLoading(true);

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const response = await fetch(`${backendUrl}/api/queue-song`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ link: trimmedLink }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add track to the queue.');
      }

      setSuccess(data.song);
      setLink('');
    } catch (err) {
      setError(err.message || 'Error occurred while contacting the server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] px-4 py-8">
      {/* Brand Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-3 mb-3 bg-brand-purple/20 rounded-full text-brand-purple animate-pulse-slow">
          <Music className="w-8 h-8" />
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          STI <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-purple to-brand-pink text-glow">Jukebox</span>
        </h1>
        <p className="mt-2 text-sm text-slate-400 max-w-xs mx-auto">
          Scan the QR, request your favorite track, and hear it live on the main stage.
        </p>
      </div>

      {/* Main Request Form Card */}
      <div className="w-full max-w-md glass rounded-2xl p-6 glass-glow-purple relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 w-24 h-24 bg-brand-cyan/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-brand-purple/10 rounded-full blur-2xl -ml-6 -mb-6"></div>

        {success ? (
          /* Success State View */
          <div className="text-center py-4 animate-fade-in">
            <div className="inline-flex items-center justify-center p-3 bg-brand-emerald/20 text-brand-emerald rounded-full mb-4">
              <CheckCircle className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Song Queued Successfully!</h3>
            <div className="bg-dark/60 border border-dark-border/40 rounded-xl p-4 mb-6 text-left">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Requested Track</p>
              <h4 className="text-lg font-bold text-white mt-1 truncate">{success.title}</h4>
              <p className="text-sm text-brand-purple font-medium truncate">{success.artist}</p>
            </div>
            <button
              onClick={() => setSuccess(null)}
              className="w-full py-3 px-4 bg-gradient-to-r from-brand-purple to-brand-pink text-white font-bold rounded-xl shadow-lg shadow-brand-purple/30 hover:opacity-90 active:scale-[0.98] transition-all"
            >
              Request Another Song
            </button>
          </div>
        ) : (
          /* Input Request Form */
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <div>
              <label htmlFor="song-link" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Paste Song Link
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Link2 className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  name="song-link"
                  id="song-link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  disabled={loading}
                  placeholder="Spotify track or YouTube video URL..."
                  className="block w-full rounded-xl border border-dark-border bg-dark/50 py-3.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-brand-purple focus:outline-none focus:ring-1 focus:ring-brand-purple disabled:opacity-50 transition-colors"
                />
              </div>
            </div>

            {/* Badge Info Section */}
            <div className="flex justify-between items-center text-[10px] font-bold tracking-wider text-slate-400 bg-dark/40 border border-dark-border/40 rounded-lg p-2.5">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-emerald"></span>
                SPOTIFY LINK RESOLVED
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                YOUTUBE COMPATIBLE
              </span>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-gradient-to-r from-brand-purple to-brand-pink text-white font-bold rounded-xl shadow-lg shadow-brand-purple/20 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Syncing to STI Jukebox...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Request</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Floating Info Guide */}
      <div className="mt-8 flex items-center gap-2 text-xs text-slate-500 max-w-xs text-center leading-relaxed">
        <Flame className="w-4 h-4 text-brand-pink shrink-0 animate-pulse" />
        <span>Tip: Simply copy the share link of a track in Spotify and paste it here. We'll find the video for you!</span>
      </div>
    </div>
  );
}
