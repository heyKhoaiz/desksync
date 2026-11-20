-- Migration 002 — notes are plain text.
-- Run in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to run twice. New projects get all of this from schema.sql and can skip it.
--
-- Why: the note editor no longer formats anything. A note is stored exactly as it
-- was typed, with format = 'plain'. Rows written earlier keep their format
-- ('html' or 'markdown'); the extension and the phone flatten them to text when
-- shown, and save them back as 'plain' the first time they are edited.
-- Needs 001 first: that is where the `format` column comes from.

alter table public.notes drop constraint if exists notes_format_check;
alter table public.notes
  add constraint notes_format_check check (format in ('plain', 'html', 'markdown'));

-- The default stays 'html' on purpose: the only writer that leaves `format` out is
-- an older build of the phone app, and what that build writes is HTML.
