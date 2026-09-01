-- Kolofon: adds the product background image column
-- Run once in the Supabase SQL Editor.
--
-- Stores the full public URL of a background image uploaded through the
-- admin panel, in the same 'images' bucket as product photos.

ALTER TABLE products ADD COLUMN IF NOT EXISTS background TEXT;
