# Supabase Setup

1. Create a new Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy your project URL and keys into `.env` using `.env.example`.

The current app still runs with local preview storage or the Node JSON server. This schema prepares the database shape for the next step: replacing JSON reads/writes with Supabase queries.
