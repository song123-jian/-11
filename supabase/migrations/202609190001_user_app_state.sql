-- Optional cloud sync for the local-first efficiency toolbox.
-- The client only uses the publishable/anon key; service_role is never needed.
create table if not exists public.user_app_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  namespace text not null check (namespace in ('assistant', 'tasks', 'ui-prefs')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  schema_version integer not null default 1 check (schema_version > 0 and schema_version < 100),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, namespace)
);

-- Keep the server-side limit aligned with the client UTF-8 byte limit. The
-- DO block also applies the guard when this migration is re-run after a table
-- was created by an earlier local preview.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_app_state_payload_size_check'
      and conrelid = 'public.user_app_state'::regclass
  ) then
    alter table public.user_app_state
      add constraint user_app_state_payload_size_check
      check (octet_length(payload::text) <= 1500000);
  end if;
end $$;

create index if not exists user_app_state_user_updated_idx
  on public.user_app_state (user_id, updated_at desc);

alter table public.user_app_state enable row level security;

drop policy if exists "user_app_state_select_own" on public.user_app_state;
create policy "user_app_state_select_own"
  on public.user_app_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_insert_own" on public.user_app_state;
create policy "user_app_state_insert_own"
  on public.user_app_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_update_own" on public.user_app_state;
create policy "user_app_state_update_own"
  on public.user_app_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_delete_own" on public.user_app_state;
create policy "user_app_state_delete_own"
  on public.user_app_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.touch_user_app_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_app_state_touch_updated_at on public.user_app_state;
create trigger user_app_state_touch_updated_at
  before update on public.user_app_state
  for each row execute function public.touch_user_app_state_updated_at();

revoke all on table public.user_app_state from anon;
grant select, insert, update, delete on table public.user_app_state to authenticated;
