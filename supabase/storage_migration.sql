-- Run once on an existing Subtitle Companion Supabase project.
begin;

alter table public.subtitle_tracks
  add column if not exists storage_path text;
create unique index if not exists subtitle_tracks_storage_path_key
  on public.subtitle_tracks(storage_path)
  where storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subtitle-files', 'subtitle-files', false, 5242880,
  array['application/x-subrip', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists subtitle_files_select_authorized on storage.objects;
create policy subtitle_files_select_authorized on storage.objects
for select to authenticated
using (
  bucket_id = 'subtitle-files'
  and (
    private.is_subtitle_admin()
    or exists (
      select 1 from public.subtitle_tracks track
      where track.storage_path = name
        and private.can_access_subtitle(track.id)
    )
  )
);

drop policy if exists subtitle_files_admin_insert on storage.objects;
create policy subtitle_files_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'subtitle-files' and private.is_subtitle_admin());

drop policy if exists subtitle_files_admin_update on storage.objects;
create policy subtitle_files_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'subtitle-files' and private.is_subtitle_admin())
with check (bucket_id = 'subtitle-files' and private.is_subtitle_admin());

drop policy if exists subtitle_files_admin_delete on storage.objects;
create policy subtitle_files_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'subtitle-files' and private.is_subtitle_admin());

commit;
