import { createClient } from "@supabase/supabase-js";

// The Supabase URL and anon key are PUBLIC values (safe in client code) — your
// data is protected by Row Level Security, not by hiding these. We keep known-good
// constants here as a fallback so a mistyped/corrupted Vercel env var can't break
// the app. If a valid env var is present it takes precedence.
const FALLBACK_URL = "https://wtmsukjnuqsprtvfytin.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXN1a2pudXFzcHJ0dmZ5dGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTE4OTUsImV4cCI6MjA5ODQyNzg5NX0.Ul2Vly-p_KzMuiNCkRIhyv0JYP8vLPTtPKp3mXAEjOk";

const clean = (v) => (typeof v === "string" ? v.trim() : "");
// A JWT / URL must be plain ASCII. Reject anything with stray/invisible chars so a
// bad paste in Vercel can't cause "String contains non ISO-8859-1 code point".
const isAscii = (v) => /^[\x21-\x7E]+$/.test(v);

const envUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const envKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

const url = /^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(envUrl) ? envUrl : FALLBACK_URL;
const anonKey = envKey && isAscii(envKey) && envKey.split(".").length === 3 ? envKey : FALLBACK_ANON_KEY;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
