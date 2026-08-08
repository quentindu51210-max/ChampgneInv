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
  type text not null default 'champagne' check (type in ('champagne', 'coteaux')),
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

-- ---------- MIGRATION EXISTANTE : colonne type (Champagne / Coteaux Champenois / Spiritueux) ----------
-- À exécuter aussi sur une base déjà en production (idempotent)
alter table public.products add column if not exists type text not null default 'champagne';
alter table public.products drop constraint if exists products_type_check;
alter table public.products add constraint products_type_check check (type in ('champagne', 'coteaux', 'spiritueux'));

-- ---------- MIGRATION 2 : prix et image ----------
alter table public.products add column if not exists price numeric(10,2) not null default 0;
alter table public.products add column if not exists image_url text;

-- ---------- Import : Maison Jérôme Lefèvre ----------
insert into public.brands (id, name, emoji) values
  ('b201', 'Jérôme Lefèvre', '🍾'),
  ('b202', 'Champagne Delalot', '🥂'),
  ('b203', 'La Conspiration', '🥃')
on conflict (id) do nothing;

insert into public.products (id, name, ref, brand_id, type, price, image_url, qty, threshold, created_at, updated_at) values
  ('p201', 'Ticket d''entrée — As Tongue Meet Ash', 'MJL-AT-001', 'b201', 'champagne', 666, 'gammes/as-tongue.jpg', 0, 0, now(), now()),
  ('p202', 'Champagne Delalot Impressions 2016', 'DLT-IMP-16', 'b202', 'champagne', 714, '', 0, 0, now(), now()),
  ('p203', 'Champagne Delalot Pléiades 2013', 'DLT-PL-13', 'b202', 'champagne', 600, '', 0, 0, now(), now()),
  ('p204', 'Champagne Jérôme Lefèvre Composition #1', 'MJL-C1-01', 'b201', 'champagne', 330, 'gammes/jlf-comp1.jpg', 0, 0, now(), now()),
  ('p205', 'Champagne Jérôme Lefèvre Composition #2', 'MJL-C2-01', 'b201', 'champagne', 330, 'gammes/jlf-comp2.jpg', 0, 0, now(), now()),
  ('p206', 'Champagne Jérôme Lefèvre Rated X', 'MJL-RX-01', 'b201', 'champagne', 714, 'gammes/jlf-ratedx.jpg', 0, 0, now(), now()),
  ('p207', 'Composition #1', 'MJL-C1-B', 'b201', 'champagne', 330, 'gammes/comp1.jpg', 0, 0, now(), now()),
  ('p208', 'Composition #2', 'MJL-C2-B', 'b201', 'coteaux', 84, 'gammes/comp2.jpg', 0, 0, now(), now()),
  ('p209', 'Composition #3', 'MJL-C3-B', 'b201', 'coteaux', 84, 'gammes/comp3.jpg', 0, 0, now(), now()),
  ('p210', 'Composition #4 (for La Monte)', 'MJL-C4-B', 'b201', 'coteaux', 93, 'gammes/comp4.jpg', 0, 0, now(), now()),
  ('p211', 'Hunger For Speed', 'MJL-HS-01', 'b201', 'champagne', 162, 'gammes/hunger-for-speed.jpg', 0, 0, now(), now()),
  ('p212', 'No Title Required (after Robert Ryman)', 'MJL-NT-01', 'b201', 'coteaux', 220, 'gammes/no-title.jpg', 0, 0, now(), now()),
  ('p213', 'Playing with Fire', 'MJL-PF-01', 'b201', 'champagne', 120, 'gammes/playing-with-fire.jpg', 0, 0, now(), now()),
  ('p214', 'Playing with Fire 2', 'MJL-PF-02', 'b201', 'champagne', 144, 'gammes/playing-with-fire.jpg', 0, 0, now(), now()),
  ('p215', 'Rated X', 'MJL-RX-02', 'b201', 'champagne', 120, 'gammes/ratedx.jpg', 0, 0, now(), now()),
  ('p216', 'Sans titre #1 (Chardonnay on Fire)', 'MJL-ST-01', 'b201', 'coteaux', 492, 'gammes/sans-titre-1.jpg', 0, 0, now(), now()),
  ('p217', 'Sans titre #2 (Great Meuniers)', 'MJL-ST-02', 'b201', 'coteaux', 280, 'gammes/sans-titre-2.jpg', 0, 0, now(), now()),
  ('p218', 'Supergroovalasticmacerationstuff', 'MJL-SG-01', 'b201', 'coteaux', 240, 'gammes/supergroovalistic.jpg', 0, 0, now(), now()),
  ('p219', 'Trankill', 'MJL-TR-01', 'b201', 'coteaux', 82, '', 0, 0, now(), now()),
  ('p220', 'La conspiration Alcool de malts', 'LC-AM-01', 'b203', 'spiritueux', 66, 'gammes/alcool-malts.jpg', 0, 0, now(), now()),
  ('p221', 'Gin terroir – Chardonnay', 'LC-GC-01', 'b203', 'spiritueux', 78, 'gammes/gin-chardonnay.jpg', 0, 0, now(), now()),
  ('p222', 'Gin terroir – Meunier', 'LC-GM-01', 'b203', 'spiritueux', 78, 'gammes/gin-meunier.jpg', 0, 0, now(), now()),
  ('p223', 'Gin terroir – Pinot noir', 'LC-GP-01', 'b203', 'spiritueux', 78, 'gammes/gin-pinot.jpg', 0, 0, now(), now())
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