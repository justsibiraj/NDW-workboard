# Workboard — Office Task Portal

A small static task management app designed for GitHub Pages + Supabase.

## Included
- Kanban by employee
- Separate unassigned column
- Kanban by task status
- Drag tasks between people/status columns
- Persistent ordering
- Projects with muted colour accents
- Mandatory project per task
- Optional assignee
- Team management
- Project archiving
- Search + project filtering
- Due dates
- Responsive mobile layout
- Single-user Supabase login
- Cross-device database sync

## Files
- `index.html` — app shell
- `styles.css` — responsive visual design
- `app.js` — application logic
- `config.js` — your Supabase project URL + publishable key
- `supabase-setup.sql` — database tables, grants and RLS policies

## Setup summary
1. Create a Supabase project.
2. Create one Auth user for yourself.
3. Run `supabase-setup.sql` in the Supabase SQL Editor.
4. Put your Supabase URL and publishable key in `config.js`.
5. Upload these files to a GitHub repository.
6. Enable GitHub Pages from the `main` branch / root folder.
7. Open your Pages URL and sign in.

Important: use only the **publishable / anon client key** in `config.js`. Never place a service-role or secret key in this frontend.
