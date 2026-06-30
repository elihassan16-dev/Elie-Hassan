import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced clearly so a missing Vercel env var is obvious instead of a blank screen.
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(in .env.local for local dev, and in Vercel → Project → Settings → Environment Variables)."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
