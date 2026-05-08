drop policy if exists "Avatars are publicly readable" on storage.objects;

-- Public read of individual avatar files (direct URL access still works without listing)
create policy "Avatar files readable by owner"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Note: bucket remains public so getPublicUrl works for displaying avatars in chat without listing.