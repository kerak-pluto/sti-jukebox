-- Create the songs_queue table in the public schema
CREATE TABLE IF NOT EXISTS public.songs_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'playing', 'completed', 'skipped')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create index on created_at for fast, sequential retrieval of oldest songs
CREATE INDEX IF NOT EXISTS songs_queue_created_at_idx ON public.songs_queue (created_at ASC);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_songs_queue_updated_at
    BEFORE UPDATE ON public.songs_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Realtime for the songs_queue table in Supabase
-- Note: Make sure the publication 'supabase_realtime' exists.
-- If it doesn't exist, Supabase enables it in the dashboard.
-- If you run into errors, you can run: ALTER PUBLICATION supabase_realtime ADD TABLE songs_queue;
BEGIN;
  -- Add table to realtime publication
  ALTER PUBLICATION supabase_realtime ADD TABLE public.songs_queue;
EXCEPTION
  WHEN OTHERS THEN
    -- If publication doesn't exist, ignore error or it can be done via Supabase Dashboard
    RAISE NOTICE 'Could not add to supabase_realtime publication automatically. Enable it in your Supabase Dashboard.';
END;
$$;
