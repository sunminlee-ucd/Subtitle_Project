-- Applied to subtitle-companion on 2026-08-19.
-- Adds an admin-only usage snapshot and closes advisor findings discovered during the audit.

begin;

create or replace function public.admin_usage_snapshot()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_subtitle_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', (
      select coalesce(sum(
        case
          when metadata ->> 'size' ~ '^[0-9]+$' then (metadata ->> 'size')::bigint
          else 0
        end
      ), 0)
      from storage.objects
      where bucket_id = 'subtitle-files'
    ),
    'storage_objects', (
      select count(*) from storage.objects where bucket_id = 'subtitle-files'
    ),
    'registered_users', (select count(*) from public.profiles),
    'subtitle_tracks', (select count(*) from public.subtitle_tracks),
    'legacy_tracks', (
      select count(*) from public.subtitle_tracks
      where storage_path is null or storage_path = ''
    ),
    'tracks_with_storage', (
      select count(*) from public.subtitle_tracks
      where storage_path is not null and storage_path <> ''
    ),
    'cues_json_bytes', (
      select coalesce(sum(pg_column_size(cues)), 0) from public.subtitle_tracks
    ),
    'active_grants', (
      select count(*) from public.subtitle_grants
      where expires_at is null or expires_at > now()
    ),
    'generated_at', now()
  );
end;
$$;

revoke all on function public.admin_usage_snapshot() from public, anon;
grant execute on function public.admin_usage_snapshot() to authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists error_reports_subtitle_track_id_idx
  on public.error_reports(subtitle_track_id);
create index if not exists subtitle_grants_granted_by_idx
  on public.subtitle_grants(granted_by);

commit;
