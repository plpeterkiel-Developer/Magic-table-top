// The Supabase client. ONE instance, shared across the whole app.
// Importing this module gives every other file the same client, which
// keeps a single auth session and a single realtime websocket.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly with a helpful message if the env vars are missing.
  // Without these, every database call will silently fail later.
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project.'
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Persist the session in localStorage so the user stays logged in across reloads.
    persistSession: true,
    autoRefreshToken: true,
  },
});
