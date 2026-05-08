-- Create chat-media bucket for image/video/document attachments
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their own folder
create policy "Users can upload their own chat media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow public read (bucket is public, but explicit policy for safety)
create policy "Chat media is publicly readable"
on storage.objects
for select
using (bucket_id = 'chat-media');

-- Allow uploaders to delete their own files
create policy "Users can delete their own chat media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and auth.uid()::text = (storage.foldername(name))[1]
);