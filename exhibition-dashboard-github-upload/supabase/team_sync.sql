create table if not exists public.dashboard_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_state enable row level security;

drop policy if exists "team dashboard state is readable" on public.dashboard_state;
drop policy if exists "team dashboard state can be inserted" on public.dashboard_state;
drop policy if exists "team dashboard state can be updated" on public.dashboard_state;

create policy "team dashboard state is readable"
on public.dashboard_state for select
to anon, authenticated
using (true);

create policy "team dashboard state can be inserted"
on public.dashboard_state for insert
to anon, authenticated
with check (true);

create policy "team dashboard state can be updated"
on public.dashboard_state for update
to anon, authenticated
using (true)
with check (true);

-- In Supabase Dashboard, also enable Realtime for the dashboard_state table:
-- Database > Replication > enable dashboard_state
