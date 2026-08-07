-- =====================================================
-- CHAMPAGNE HOUSE — Schéma base de données Supabase
-- À coller dans supabase.com -> SQL Editor puis "Run"
-- =====================================================

-- ---------- Tables ----------
create table public.brands (
  id text primary key,
  name text not null,
  emoji text not null default '🥂',
  created_at timestamptz not null default now()
);

create table public.etats (
  id text primary key,
  name text not null,
  color text not null default '#2980b9',
  created_at timestamptz not null default now()
);

create table public.products (
  id text primary key,
  name text not null,
  ref text not null unique,
  brand_id text references public.brands(id) on delete restrict,
  etat_id text references public.etats(id) on delete set null,
  qty integer not null default 0 check (qty >= 0),
  threshold integer not null default 10 check (threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Données initiales ----------
insert into public.etats (id, name, color) values
  ('e101', 'Sur latte', '#2980b9'),
  ('e102', 'Dégorgé', '#e67e22'),
  ('e103', 'Prête à habiller', '#27ae60')
on conflict (id) do nothing;

insert into public.brands (id, name, emoji) values
  ('b101', 'Moët & Chandon', '🦬'),
  ('b102', 'Veuve Clicquot', '🥂'),
  ('b103', 'Dom Pérignon', '🍇')
on conflict (id) do nothing;

-- ---------- Sécurité : accès aux utilisateurs connectés ----------
alter table public.brands enable row level security;
alter table public.etats enable row level security;
alter table public.products enable row level security;

create policy "brands_auth_all" on public.brands
  for all to authenticated using (true) with check (true);
create policy "etats_auth_all" on public.etats
  for all to authenticated using (true) with check (true);
create policy "products_auth_all" on public.products
  for all to authenticated using (true) with check (true);

-- ---------- Temps réel (optionnel mais recommandé) ----------
-- supabase.com -> Database -> Replication -> activer "Realtime"
-- sur les tables : brands, etats, products
-- (pour que chaque téléphone voie les changements en direct)