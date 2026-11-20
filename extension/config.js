// Fill these from Supabase → Project Settings → API.
// The anon key is public by design; Row Level Security protects the data.
const DESKSYNC_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  CLIP_MAX_LENGTH: 20000,      // ignore copies longer than this
  VAULT_AUTOLOCK_MINUTES: 15,
  // Where "Send feedback" writes to, and where the privacy policy lives.
  // Filled from .env by `make ext`; left as is, the links are not shown.
  SUPPORT_EMAIL: 'YOUR-SUPPORT-EMAIL',
  PRIVACY_URL: 'YOUR-PRIVACY-URL',
  // The page that explains Pro (the site's #pro section). Left as is, Settings
  // describes Pro without a link.
  PRO_URL: 'YOUR-PRO-URL'
};
