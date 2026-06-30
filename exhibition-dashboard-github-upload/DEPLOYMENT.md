# Online Deployment Guide

There are two deployment options.

## Option A: Fast Online Demo

Use this if you want a public/private web link quickly.

This deploys the current dashboard to Vercel. It works online, but data is saved in each browser's local storage, so it is not yet shared between multiple users.

1. Create a GitHub repository.
2. Upload/push this `exhibition-dashboard` folder to GitHub.
3. Go to Vercel and choose **Add New Project**.
4. Import the GitHub repository.
5. Use these settings:

```text
Framework Preset: Vite
Build Command: pnpm build
Output Directory: dist
Install Command: pnpm install
```

6. Click **Deploy**.
7. Vercel will give you a web link like:

```text
https://your-project-name.vercel.app
```

## Option B: Shared Team Dashboard

Use this if multiple team members need the same shared project/task/update data.

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run `supabase/team_sync.sql`.
4. Go to Supabase **Project Settings > API** and copy:
   - Project URL
   - anon public key
5. In Vercel, open your project settings.
6. Add environment variables:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

7. Redeploy from Vercel.
8. In Supabase, enable Realtime for `dashboard_state`:
   - Database > Replication
   - Enable `dashboard_state`

After this, every team member who opens the same Vercel link will share the same dashboard data. When one person edits a task, sub task, update history, blocker, category, project, or team member, the shared state is saved to Supabase and other browsers receive the new data.

## Option C: Full Production Database

Use this later if you want every table normalized for auditing, permissions, and reporting.

1. Run `supabase/schema.sql`.
2. Connect every React CRUD action to the normalized Supabase tables.
3. Add Supabase Auth or Google Login.
4. Keep Row Level Security policies active for role-based access.

## Current Status

The current MVP is ready for Vercel deployment as an online demo and now includes shared team sync support through `supabase/team_sync.sql`.

For full production-grade auth, auditing, and normalized reporting, use `supabase/schema.sql` as the next implementation step.

## Recommended Next Step

Deploy Option B if you want your team to start sharing updates from the same live dashboard.

## Troubleshooting: White Blank Page After Deploy

If the deployed Vercel page is blank white:

1. Check Vercel environment variables:
   - `VITE_SUPABASE_URL` must be the Supabase Project URL, starting with `https://`
   - `VITE_SUPABASE_ANON_KEY` must be the anon/publishable key
   - Do not use the service role or secret key
2. Run `supabase/team_sync.sql` in Supabase SQL Editor.
3. Redeploy the Vercel project after saving environment variables.
4. Make sure your GitHub repo has the latest files:
   - `src/App.jsx`
   - `src/supabaseClient.js`

The app now catches bad Supabase configuration and should show a setup status instead of crashing to a blank page.
