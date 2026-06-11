import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Path prefix routing fallback for Vercel Services
app.use((req, res, next) => {
  if (!req.url.startsWith('/api') && req.url !== '/health' && !req.url.startsWith('/health')) {
    req.url = '/api' + req.url;
  }
  next();
});

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL: Supabase credentials are missing in backend environment configuration!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- Spotify Token Management & Caching ---
let spotifyAccessToken = null;
let spotifyTokenExpiresAt = null;

async function getSpotifyAccessToken() {
  // Return cached token if still valid
  if (spotifyAccessToken && spotifyTokenExpiresAt && Date.now() < spotifyTokenExpiresAt) {
    return spotifyAccessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId === 'your_spotify_client_id') {
    throw new Error('Spotify API Client ID or Secret is not configured in .env');
  }

  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    spotifyAccessToken = response.data.access_token;
    // Set expiration with a 1-minute safety buffer
    spotifyTokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 60000;
    return spotifyAccessToken;
  } catch (error) {
    console.error('Spotify Auth Error:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Spotify API');
  }
}

// --- Spotify API Resolvers (using public embed state parser) ---
async function getSpotifyTrackDetails(trackId) {
  try {
    const embedUrl = `https://open.spotify.com/embed/track/${trackId}`;
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const html = response.data;
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    if (!match) {
      throw new Error('Failed to locate __NEXT_DATA__ block in Spotify embed HTML.');
    }

    const jsonData = JSON.parse(match[1]);
    const entity = jsonData.props?.pageProps?.state?.data?.entity;

    if (!entity) {
      throw new Error('Track entity metadata is missing in the JSON payload.');
    }

    const title = entity.name || entity.title;
    const artist = entity.artists && entity.artists.length > 0
      ? entity.artists.map(a => a.name).join(', ')
      : 'Unknown Artist';

    console.log('DEBUG: Resolved details - Title:', title, '| Artist:', artist);
    return { title, artist };
  } catch (error) {
    console.error('Spotify Metadata Fetch Error:', error.message);
    throw new Error('Failed to resolve Spotify track details via embed parsing');
  }
}


// --- YouTube API Resolvers ---
async function searchYouTubeVideo(artist, title) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_api_key') {
    throw new Error('YouTube Data API Key is not configured in .env');
  }

  try {
    // Search query combines artist and title to get a highly relevant match (preferring official audio)
    const searchQuery = `${artist} - ${title} audio`;
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: searchQuery,
        type: 'video',
        maxResults: 1,
        key: apiKey,
      },
    });

    const items = response.data.items;
    if (!items || items.length === 0) {
      throw new Error('No matching videos found on YouTube');
    }

    return items[0].id.videoId;
  } catch (error) {
    console.error('YouTube Search Error:', error.response?.data || error.message);
    throw new Error('Failed to search YouTube for matching video');
  }
}

async function getYouTubeVideoDetails(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_api_key') {
    return { title: 'YouTube Track', artist: 'YouTube' };
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet',
        id: videoId,
        key: apiKey,
      },
    });

    const item = response.data.items?.[0];
    if (!item) {
      return { title: 'YouTube Video', artist: 'YouTube Upload' };
    }

    return {
      title: item.snippet.title,
      artist: item.snippet.channelTitle || 'YouTube Upload',
    };
  } catch (error) {
    console.error('YouTube Video Fetch Error:', error.response?.data || error.message);
    return { title: 'YouTube Video', artist: 'YouTube Upload' };
  }
}

// --- URL Parsing Regex ---
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
const SPOTIFY_REGEX = /open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/;

// --- API Endpoints ---

// Resolve and Queue a song
app.post('/api/queue-song', async (req, res) => {
  const { link } = req.body;

  if (!link) {
    return res.status(400).json({ error: 'Song link is required' });
  }

  try {
    let title = '';
    let artist = '';
    let youtubeId = '';

    const ytMatch = link.match(YOUTUBE_REGEX);
    const spMatch = link.match(SPOTIFY_REGEX);

    if (ytMatch) {
      // Direct YouTube Link
      youtubeId = ytMatch[1];
      // Try to fetch YouTube video details (title/uploader) to display nicely in the list
      const details = await getYouTubeVideoDetails(youtubeId);
      title = details.title;
      artist = details.artist;
    } else if (spMatch) {
      // Spotify Link
      const trackId = spMatch[1];
      // 1. Resolve track info from Spotify
      const trackDetails = await getSpotifyTrackDetails(trackId);
      title = trackDetails.title;
      artist = trackDetails.artist;

      // 2. Query YouTube to get closest matching Video ID
      youtubeId = await searchYouTubeVideo(artist, title);
    } else {
      return res.status(400).json({ error: 'Invalid link. Must be a valid Spotify or YouTube track URL.' });
    }

    // Insert into Supabase Table
    const { data, error } = await supabase
      .from('songs_queue')
      .insert([
        {
          title,
          artist,
          youtube_video_id: youtubeId,
          status: 'queued',
          source_type: spMatch ? 'spotify' : 'youtube',
          requested_by: 'Guest',
        }
      ])
      .select();

    if (error) {
      console.error('Supabase Insert Error:', error);
      return res.status(500).json({ error: 'Failed to queue song in database' });
    }

    return res.status(200).json({
      message: 'Song successfully queued!',
      song: data[0]
    });

  } catch (error) {
    console.error('Queue Song Error:', error.message);
    return res.status(500).json({ error: error.message || 'An error occurred while queueing the song' });
  }
});

// --- Admin Authentication Middleware ---
const adminAuth = (req, res, next) => {
  const adminSecret = process.env.ADMIN_SECRET || 'admin123';
  const authHeader = req.headers.authorization;
  
  if (adminSecret && (!authHeader || authHeader !== `Bearer ${adminSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized. Invalid Admin Secret.' });
  }
  next();
};

// --- Secure Admin Control Endpoints ---

// Start playing a song (update status to playing)
app.post('/api/admin/start-song', adminAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Song ID is required' });

  const { data, error } = await supabase
    .from('songs_queue')
    .update({ status: 'playing' })
    .eq('id', id)
    .select();

  if (error) {
    console.error('Start Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to update song status' });
  }
  res.status(200).json({ message: 'Song playback started', song: data[0] });
});

// End a song (update status to completed)
app.post('/api/admin/end-song', adminAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Song ID is required' });

  const { data, error } = await supabase
    .from('songs_queue')
    .update({ status: 'completed' })
    .eq('id', id)
    .select();

  if (error) {
    console.error('End Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to complete song' });
  }
  res.status(200).json({ message: 'Song marked completed', song: data[0] });
});

// Skip a song (update status to skipped)
app.post('/api/admin/skip-song', adminAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Song ID is required' });

  const { data, error } = await supabase
    .from('songs_queue')
    .update({ status: 'skipped' })
    .eq('id', id)
    .select();

  if (error) {
    console.error('Skip Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to skip song' });
  }
  res.status(200).json({ message: 'Song marked skipped', song: data[0] });
});

// Pause a song (update status to paused)
app.post('/api/admin/pause-song', adminAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Song ID is required' });

  const { data, error } = await supabase
    .from('songs_queue')
    .update({ status: 'paused' })
    .eq('id', id)
    .select();

  if (error) {
    console.error('Pause Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to pause song' });
  }
  res.status(200).json({ message: 'Song paused', song: data[0] });
});

// Resume a song (update status to playing)
app.post('/api/admin/resume-song', adminAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Song ID is required' });

  const { data, error } = await supabase
    .from('songs_queue')
    .update({ status: 'playing' })
    .eq('id', id)
    .select();

  if (error) {
    console.error('Resume Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to resume song' });
  }
  res.status(200).json({ message: 'Song resumed', song: data[0] });
});

// Delete an individual song by ID
app.delete('/api/admin/song/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from('songs_queue')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Delete Song DB Error:', error);
    return res.status(500).json({ error: 'Failed to delete song' });
  }
  res.status(200).json({ message: 'Song removed from queue' });
});

// Clear entire queue (deletes queued and playing items)
app.delete('/api/admin/queue', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('songs_queue')
    .delete()
    .in('status', ['queued', 'playing']);

  if (error) {
    console.error('Clear Queue DB Error:', error);
    return res.status(500).json({ error: 'Failed to clear queue' });
  }
  res.status(200).json({ message: 'Queue successfully cleared' });
});

// Health Check Route
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Jukebox backend listening at http://localhost:${PORT}`);
  });
}

export default app;

