# Exhibition Project Tracking Dashboard

React + Tailwind MVP for tracking exhibition projects online. It includes the two requested default projects, role-aware demo login, project workspaces, main task CRUD, sub task CRUD, update history, progress calculations, blockers, filters, calendar/overdue/urgent views, CSV exports, and print-to-PDF summary export.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

## Supabase Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Google provider in Supabase Auth if Google login is desired.
4. Copy `.env.example` to `.env.local` and fill in:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The current MVP runs from local state for immediate testing. `src/supabaseClient.js` is ready for replacing the local persistence methods in `src/App.jsx` with Supabase queries and realtime subscriptions.

## Deploy To Vercel

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full online deployment guide.

Fast demo deployment:

1. Push this folder to GitHub.
2. Import the repository in Vercel.
3. Use `pnpm build` as the build command.
4. Use `dist` as the output directory.

Shared team deployment:

1. Create Supabase project.
2. Run `supabase/team_sync.sql`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel.
4. Enable Realtime for `dashboard_state`.
5. Redeploy Vercel.

Full production database:

1. Run `supabase/schema.sql`.
2. Connect the React screens to the normalized tables.
3. Add Supabase Auth or Google Login.

## Demo Users

- `admin@example.com`: Admin
- `pm@example.com`: Project Manager
- `team@example.com`: Team Member
- `viewer@example.com`: Viewer

## MVP Coverage

- Login page with role selection
- Main summary dashboard for both projects
- Project detail/workspace tabs
- Main task and sub task CRUD
- Status, category, owner, priority, due date, overdue, urgent, and blocker filters
- Progress calculated from sub tasks
- Countdown to exhibition start date
- Colored progress bars with a walking-person journey marker
- Sub task update history with latest update shown in task rows
- Blocker / issue dashboard with critical and overdue logic
- Admin user management page
- Export summary to PDF via print dialog
- Export task list and blocker list to CSV
