-- Kolofon: Storage policies for the "images" bucket
-- Run in Supabase SQL Editor ONLY if uploads fail with a
-- "row-level security" / "Unauthorized" error after creating the bucket.

-- Anyone can view product photos (needed for the storefront)
CREATE POLICY "Public read images"
ON storage.objects FOR SELECT
USING (bucket_id = 'images');

-- Logged-in admin can upload new photos
CREATE POLICY "Authenticated upload images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'images');

-- Logged-in admin can replace a photo (admin.html updates in place)
CREATE POLICY "Authenticated update images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'images');

-- Logged-in admin can delete the old photo when replacing it
-- (admin.html removes the previous file after a successful swap)
CREATE POLICY "Authenticated delete images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'images');
