// Fill these from Supabase → Project Settings → API.
// The anon key is public by design; Row Level Security protects the data.
const DESKSYNC_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  CLIP_MAX_LENGTH: 20000,      // ignore copies longer than this
  CLIP_HISTORY_LIMIT: 200,     // how many clips the popup loads
  VAULT_AUTOLOCK_MINUTES: 15
};
