create table if not exists public.translation_feedback (
  report_id uuid primary key references public.error_reports(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  subtitle_track_id uuid not null references public.subtitle_tracks(id) on delete cascade,
  issue_reason text not null check (issue_reason in ('wrong_meaning','unnatural','name_term','context','grammar','missing_words','other')),
  current_text text not null check (length(btrim(current_text)) > 0),
  suggested_text text not null default '',
  source_surface text not null default 'web' check (source_surface in ('web','android','chrome','other')),
  dataset_status text not null default 'unreviewed' check (dataset_status in ('unreviewed','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists translation_feedback_customer_id_idx on public.translation_feedback(customer_id);
create index if not exists translation_feedback_track_id_idx on public.translation_feedback(subtitle_track_id);
create index if not exists translation_feedback_dataset_status_idx on public.translation_feedback(dataset_status);
create index if not exists translation_feedback_issue_reason_idx on public.translation_feedback(issue_reason);

alter table public.translation_feedback enable row level security;

drop policy if exists translation_feedback_select_own_or_admin on public.translation_feedback;
create policy translation_feedback_select_own_or_admin on public.translation_feedback
for select to authenticated
using (customer_id = (select auth.uid()) or private.is_subtitle_admin());

drop policy if exists translation_feedback_insert_own on public.translation_feedback;
create policy translation_feedback_insert_own on public.translation_feedback
for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and private.can_access_subtitle(subtitle_track_id)
  and exists (
    select 1
    from public.error_reports report
    where report.id = report_id
      and report.customer_id = (select auth.uid())
      and report.subtitle_track_id = translation_feedback.subtitle_track_id
      and report.category = 'translation'
  )
);

drop policy if exists translation_feedback_admin_update on public.translation_feedback;
create policy translation_feedback_admin_update on public.translation_feedback
for update to authenticated
using (private.is_subtitle_admin())
with check (private.is_subtitle_admin());

revoke all on public.translation_feedback from anon, authenticated;
grant select, insert, update on public.translation_feedback to authenticated;

create or replace function public.submit_translation_feedback(
  p_subtitle_track_id uuid,
  p_video_url text,
  p_cue_time_seconds numeric,
  p_issue_reason text,
  p_current_text text,
  p_suggested_text text default '',
  p_message text default '',
  p_source_surface text default 'web'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_report_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_subtitle_track_id is null then
    raise exception 'Choose the subtitle you are reporting.' using errcode = '22023';
  end if;
  if p_cue_time_seconds is null or p_cue_time_seconds < 0 then
    raise exception 'Enter the approximate subtitle time.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_current_text, ''))) = 0 then
    raise exception 'Enter the subtitle text that looks wrong.' using errcode = '22023';
  end if;
  if p_issue_reason not in ('wrong_meaning','unnatural','name_term','context','grammar','missing_words','other') then
    raise exception 'Choose a valid translation issue reason.' using errcode = '22023';
  end if;
  if p_source_surface not in ('web','android','chrome','other') then
    raise exception 'Invalid feedback source.' using errcode = '22023';
  end if;

  insert into public.error_reports (
    customer_id, subtitle_track_id, video_url, category, message, cue_time_seconds
  ) values (
    (select auth.uid()), p_subtitle_track_id, coalesce(p_video_url, ''), 'translation',
    coalesce(p_message, ''), p_cue_time_seconds
  ) returning id into new_report_id;

  insert into public.translation_feedback (
    report_id, customer_id, subtitle_track_id, issue_reason, current_text,
    suggested_text, source_surface
  ) values (
    new_report_id, (select auth.uid()), p_subtitle_track_id, p_issue_reason,
    btrim(p_current_text), btrim(coalesce(p_suggested_text, '')), p_source_surface
  );

  return new_report_id;
end;
$$;

revoke all on function public.submit_translation_feedback(uuid,text,numeric,text,text,text,text,text) from public, anon;
grant execute on function public.submit_translation_feedback(uuid,text,numeric,text,text,text,text,text) to authenticated;
