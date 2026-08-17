-- Subtitle Project customer access schema.
-- Run once in Supabase Dashboard > SQL Editor on a new project.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('netflix', 'disney', 'youtube', 'other')),
  provider_video_key text not null,
  title text not null,
  episode_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_video_key)
);

create table if not exists public.subtitle_tracks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  language_code text not null,
  language_name text not null,
  label text not null default 'Default',
  storage_path text unique,
  cues jsonb not null check (jsonb_typeof(cues) = 'array'),
  cue_count integer generated always as (jsonb_array_length(cues)) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, language_code, label)
);

create table if not exists public.subtitle_grants (
  customer_id uuid not null references auth.users(id) on delete cascade,
  subtitle_track_id uuid not null references public.subtitle_tracks(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (customer_id, subtitle_track_id)
);

create table if not exists public.video_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('netflix', 'disney', 'youtube', 'other')),
  video_url text not null,
  requested_language text not null,
  notes text not null default '',
  status text not null default 'new' check (status in ('new', 'reviewing', 'completed', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  subtitle_track_id uuid references public.subtitle_tracks(id) on delete set null,
  video_url text not null,
  category text not null check (category in ('timing', 'translation', 'missing', 'display', 'other')),
  message text not null,
  cue_time_seconds numeric(12,3),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subtitle_tracks_video_id_idx on public.subtitle_tracks(video_id);
create index if not exists subtitle_grants_customer_id_idx on public.subtitle_grants(customer_id);
create index if not exists subtitle_grants_track_id_idx on public.subtitle_grants(subtitle_track_id);
create index if not exists video_requests_customer_id_idx on public.video_requests(customer_id);
create index if not exists error_reports_customer_id_idx on public.error_reports(customer_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subtitle-files',
  'subtitle-files',
  false,
  5242880,
  array['application/x-subrip', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function private.handle_new_user();

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos
for each row execute function private.set_updated_at();
drop trigger if exists subtitle_tracks_set_updated_at on public.subtitle_tracks;
create trigger subtitle_tracks_set_updated_at before update on public.subtitle_tracks
for each row execute function private.set_updated_at();
drop trigger if exists video_requests_set_updated_at on public.video_requests;
create trigger video_requests_set_updated_at before update on public.video_requests
for each row execute function private.set_updated_at();
drop trigger if exists error_reports_set_updated_at on public.error_reports;
create trigger error_reports_set_updated_at before update on public.error_reports
for each row execute function private.set_updated_at();

create or replace function private.is_subtitle_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

create or replace function private.can_access_subtitle(requested_track_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_subtitle_admin() or exists (
    select 1
    from public.subtitle_grants grant_row
    join public.subtitle_tracks track on track.id = grant_row.subtitle_track_id
    where grant_row.customer_id = (select auth.uid())
      and grant_row.subtitle_track_id = requested_track_id
      and track.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
  );
$$;

create or replace function private.can_access_video(requested_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_subtitle_admin() or exists (
    select 1
    from public.subtitle_tracks track
    join public.subtitle_grants grant_row on grant_row.subtitle_track_id = track.id
    where track.video_id = requested_video_id
      and grant_row.customer_id = (select auth.uid())
      and track.is_active
      and (grant_row.expires_at is null or grant_row.expires_at > now())
  );
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_subtitle_admin() from public, anon, authenticated;
revoke all on function private.can_access_subtitle(uuid) from public, anon, authenticated;
revoke all on function private.can_access_video(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_subtitle_admin() to authenticated;
grant execute on function private.can_access_subtitle(uuid) to authenticated;
grant execute on function private.can_access_video(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.videos enable row level security;
alter table public.subtitle_tracks enable row level security;
alter table public.subtitle_grants enable row level security;
alter table public.video_requests enable row level security;
alter table public.error_reports enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.is_subtitle_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists admin_users_select_own on public.admin_users;
create policy admin_users_select_own on public.admin_users for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists videos_select_authorized on public.videos;
create policy videos_select_authorized on public.videos for select to authenticated
using (private.can_access_video(id));
drop policy if exists videos_admin_insert on public.videos;
create policy videos_admin_insert on public.videos for insert to authenticated
with check (private.is_subtitle_admin());
drop policy if exists videos_admin_update on public.videos;
create policy videos_admin_update on public.videos for update to authenticated
using (private.is_subtitle_admin()) with check (private.is_subtitle_admin());
drop policy if exists videos_admin_delete on public.videos;
create policy videos_admin_delete on public.videos for delete to authenticated
using (private.is_subtitle_admin());

drop policy if exists tracks_select_authorized on public.subtitle_tracks;
create policy tracks_select_authorized on public.subtitle_tracks for select to authenticated
using (private.can_access_subtitle(id));
drop policy if exists tracks_admin_insert on public.subtitle_tracks;
create policy tracks_admin_insert on public.subtitle_tracks for insert to authenticated
with check (private.is_subtitle_admin());
drop policy if exists tracks_admin_update on public.subtitle_tracks;
create policy tracks_admin_update on public.subtitle_tracks for update to authenticated
using (private.is_subtitle_admin()) with check (private.is_subtitle_admin());
drop policy if exists tracks_admin_delete on public.subtitle_tracks;
create policy tracks_admin_delete on public.subtitle_tracks for delete to authenticated
using (private.is_subtitle_admin());

drop policy if exists grants_select_own_or_admin on public.subtitle_grants;
create policy grants_select_own_or_admin on public.subtitle_grants for select to authenticated
using (customer_id = (select auth.uid()) or private.is_subtitle_admin());
drop policy if exists grants_admin_insert on public.subtitle_grants;
create policy grants_admin_insert on public.subtitle_grants for insert to authenticated
with check (private.is_subtitle_admin() and granted_by = (select auth.uid()));
drop policy if exists grants_admin_update on public.subtitle_grants;
create policy grants_admin_update on public.subtitle_grants for update to authenticated
using (private.is_subtitle_admin()) with check (private.is_subtitle_admin());
drop policy if exists grants_admin_delete on public.subtitle_grants;
create policy grants_admin_delete on public.subtitle_grants for delete to authenticated
using (private.is_subtitle_admin());

drop policy if exists requests_select_own_or_admin on public.video_requests;
create policy requests_select_own_or_admin on public.video_requests for select to authenticated
using (customer_id = (select auth.uid()) or private.is_subtitle_admin());
drop policy if exists requests_insert_own on public.video_requests;
create policy requests_insert_own on public.video_requests for insert to authenticated
with check (customer_id = (select auth.uid()));
drop policy if exists requests_admin_update on public.video_requests;
create policy requests_admin_update on public.video_requests for update to authenticated
using (private.is_subtitle_admin()) with check (private.is_subtitle_admin());

drop policy if exists reports_select_own_or_admin on public.error_reports;
create policy reports_select_own_or_admin on public.error_reports for select to authenticated
using (customer_id = (select auth.uid()) or private.is_subtitle_admin());
drop policy if exists reports_insert_own on public.error_reports;
create policy reports_insert_own on public.error_reports for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and (subtitle_track_id is null or private.can_access_subtitle(subtitle_track_id))
);
drop policy if exists reports_admin_update on public.error_reports;
create policy reports_admin_update on public.error_reports for update to authenticated
using (private.is_subtitle_admin()) with check (private.is_subtitle_admin());

drop policy if exists subtitle_files_select_authorized on storage.objects;
create policy subtitle_files_select_authorized on storage.objects
for select to authenticated
using (
  bucket_id = 'subtitle-files'
  and (
    private.is_subtitle_admin()
    or exists (
      select 1
      from public.subtitle_tracks track
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

revoke all on all tables in schema public from anon, authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.videos to authenticated;
grant select, insert, update, delete on public.subtitle_tracks to authenticated;
grant select, insert, update, delete on public.subtitle_grants to authenticated;
grant select, insert, update on public.video_requests to authenticated;
grant select, insert, update on public.error_reports to authenticated;

commit;

-- Bootstrap the first administrator after creating that Auth user:
-- insert into public.admin_users (user_id) values ('ADMIN_AUTH_USER_UUID');
