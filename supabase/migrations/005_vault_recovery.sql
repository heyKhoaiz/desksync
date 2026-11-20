-- Migration 005 — vault recovery key and master password change.
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Safe to run twice.
-- Run it BEFORE releasing the extension version that sets a recovery key or
-- changes a master password: those upload these columns.
--
-- The key every vault item is encrypted with stays the same; these hold copies
-- of it, encrypted on the device (extension/lib/crypto.js has the format):
--   pw_*  by the master password
--   rk_*  by the recovery key, when the user made one
-- The server can read neither. A vault made before this migration has nulls
-- here, and its key is still derived from the master password and `salt`.

alter table public.vault_meta
  add column if not exists pw_salt    text,   -- base64, 16 bytes
  add column if not exists pw_wrap_iv text,   -- base64, 12 bytes
  add column if not exists pw_wrap_ct text,   -- base64 AES-GCM ciphertext of the vault key
  add column if not exists rk_salt    text,
  add column if not exists rk_wrap_iv text,
  add column if not exists rk_wrap_ct text;
