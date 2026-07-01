create type user_role as enum ('Admin', 'Project Manager', 'Team Member', 'Viewer');
create type task_status as enum ('Not Started', 'In Progress', 'Pending', 'On Hold', 'Completed', 'Cancelled');
create type task_priority as enum ('Low', 'Medium', 'High', 'Urgent');
create type blocker_severity as enum ('Low', 'Medium', 'High', 'Critical');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role user_role not null default 'Viewer',
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#64748b',
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  start_date date,
  owner_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.main_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  category_id uuid references public.categories(id),
  owner_id uuid references public.users(id),
  status task_status not null default 'Not Started',
  due_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sub_tasks (
  id uuid primary key default gen_random_uuid(),
  main_task_id uuid not null references public.main_tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  category_id uuid references public.categories(id),
  owner_id uuid references public.users(id),
  status task_status not null default 'Not Started',
  priority task_priority not null default 'Medium',
  due_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  latest_update text,
  attachment_url text,
  blocker_status boolean not null default false,
  blocker_detail text,
  blocker_category text,
  blocker_owner_id uuid references public.users(id),
  blocker_expected_resolution_date date,
  blocker_severity blocker_severity,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  sub_task_id uuid not null references public.sub_tasks(id) on delete cascade,
  update_detail text not null,
  next_action text,
  blocker text,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.projects enable row level security;
alter table public.main_tasks enable row level security;
alter table public.sub_tasks enable row level security;
alter table public.task_updates enable row level security;

create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
as $$
  select role from public.users where id = auth.uid()
$$;

create policy "authenticated users can read users"
on public.users for select
to authenticated
using (true);

create policy "admins manage users"
on public.users for all
to authenticated
using (public.current_user_role() = 'Admin')
with check (public.current_user_role() = 'Admin');

create policy "authenticated users read categories"
on public.categories for select
to authenticated
using (true);

create policy "admins and project managers manage categories"
on public.categories for all
to authenticated
using (public.current_user_role() in ('Admin', 'Project Manager'))
with check (public.current_user_role() in ('Admin', 'Project Manager'));

create policy "authenticated users read projects"
on public.projects for select
to authenticated
using (true);

create policy "admins and project managers manage projects"
on public.projects for all
to authenticated
using (public.current_user_role() in ('Admin', 'Project Manager'))
with check (public.current_user_role() in ('Admin', 'Project Manager'));

create policy "authenticated users read main tasks"
on public.main_tasks for select
to authenticated
using (true);

create policy "admins and project managers manage main tasks"
on public.main_tasks for all
to authenticated
using (public.current_user_role() in ('Admin', 'Project Manager'))
with check (public.current_user_role() in ('Admin', 'Project Manager'));

create policy "authenticated users read sub tasks"
on public.sub_tasks for select
to authenticated
using (true);

create policy "admins and project managers manage sub tasks"
on public.sub_tasks for all
to authenticated
using (public.current_user_role() in ('Admin', 'Project Manager'))
with check (public.current_user_role() in ('Admin', 'Project Manager'));

create policy "team members update assigned sub tasks"
on public.sub_tasks for update
to authenticated
using (
  public.current_user_role() in ('Admin', 'Project Manager')
  or (public.current_user_role() = 'Team Member' and owner_id = auth.uid())
)
with check (
  public.current_user_role() in ('Admin', 'Project Manager')
  or (public.current_user_role() = 'Team Member' and owner_id = auth.uid())
);

create policy "authenticated users read updates"
on public.task_updates for select
to authenticated
using (true);

create policy "contributors insert task updates"
on public.task_updates for insert
to authenticated
with check (public.current_user_role() in ('Admin', 'Project Manager', 'Team Member'));

insert into public.categories (name, color) values
  ('Documentation', '#4f46e5'),
  ('Construction / Installation', '#0f766e'),
  ('Marketing', '#db2777'),
  ('Supply Chain', '#0891b2'),
  ('Licensing / IP Approval', '#7c3aed'),
  ('Finance / Payment', '#ca8a04'),
  ('Legal / Contract', '#475569'),
  ('Vendor Management', '#ea580c'),
  ('Operation', '#16a34a'),
  ('Ticketing', '#2563eb'),
  ('Merchandise', '#c026d3'),
  ('Partnership / Sponsorship', '#0d9488'),
  ('Design / Creative', '#e11d48'),
  ('Event Production', '#9333ea'),
  ('Other', '#64748b')
on conflict (name) do nothing;

-- Create the two default projects after adding at least one real user row.
-- Replace owner_id with an Admin or Project Manager id from public.users.
-- insert into public.projects (name, description, start_date, owner_id) values
--   ('One Piece Emotion Exhibition', 'Immersive exhibition project workspace.', '2026-10-15', '00000000-0000-0000-0000-000000000000'),
--   ('Pursuit of Jade Exhibition', 'Cultural exhibition project workspace.', '2026-11-20', '00000000-0000-0000-0000-000000000000');
