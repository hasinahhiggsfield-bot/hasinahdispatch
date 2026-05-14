create extension if not exists pgcrypto;

create table if not exists public.hasinah_state (
  id text primary key,
  data jsonb not null default '{"users":[],"orders":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.hasinah_state enable row level security;

drop policy if exists "service role can manage hasinah state" on public.hasinah_state;
create policy "service role can manage hasinah state"
on public.hasinah_state
for all
to service_role
using (true)
with check (true);

insert into public.hasinah_state (id, data)
values (
  'dispatch',
  jsonb_build_object(
    'users',
    jsonb_build_array(
      jsonb_build_object(
        'id', 'usr-yahya-admin',
        'role', 'admin',
        'name', 'yahya',
        'username', 'yahya',
        'password', '123123',
        'phone', ''
      )
    ),
    'orders',
    '[]'::jsonb
  )
)
on conflict (id) do nothing;
