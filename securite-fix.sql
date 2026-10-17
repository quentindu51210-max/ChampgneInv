-- =====================================================
-- CORRECTIF SÉCURITÉ — LISTE BLANCHE DES MEMBRES (2026)
-- À exécuter dans Supabase -> SQL Editor
-- 1) REMPLACEZ l'e-mail ci-dessous par VOTRE e-mail de connexion
-- 2) Réexécutez ensuite si besoin (idempotent)
-- 3) Après exécution : remplacer aussi les autres membres (famille...)
-- =====================================================

-- --------------------------------------------------
-- 1) Table des comptes autorisés (liste blanche)
-- --------------------------------------------------
create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  added_at timestamptz not null default now()
);

alter table public.app_members enable row level security;

-- Chaque membre ne voit que sa propre entrée (évite la fuite des e-mails)
drop policy if exists "app_members_select" on public.app_members;
create policy "app_members_self" on public.app_members
  for select using (user_id = auth.uid());

-- --------------------------------------------------
-- 2) Fonction d'autorisation utilisée par les tables
-- --------------------------------------------------
create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_members where user_id = auth.uid()
  );
$$;

-- --------------------------------------------------
-- 3) Remplacer les policies permissives
--    (avant : n'importe quel compte = accès total)
-- --------------------------------------------------
drop policy if exists "brands_auth_all" on public.brands;
drop policy if exists "etats_auth_all" on public.etats;
drop policy if exists "products_auth_all" on public.products;
drop policy if exists "brands_member_all" on public.brands;
drop policy if exists "etats_member_all" on public.etats;
drop policy if exists "products_member_all" on public.products;

create policy "brands_member_all" on public.brands
  for all using (public.is_app_member()) with check (public.is_app_member());
create policy "etats_member_all" on public.etats
  for all using (public.is_app_member()) with check (public.is_app_member());
create policy "products_member_all" on public.products
  for all using (public.is_app_member()) with check (public.is_app_member());

-- --------------------------------------------------
-- 3bis) Défense en profondeur : format des identifiants
--       (empêche l'injection HTML/XSS via les id)
-- --------------------------------------------------
alter table public.brands   drop constraint if exists brands_id_format;
alter table public.etats    drop constraint if exists etats_id_format;
alter table public.products drop constraint if exists products_id_format;
alter table public.brands   add constraint brands_id_format   check (id ~ '^[A-Za-z0-9_-]{1,64}$');
alter table public.etats    add constraint etats_id_format    check (id ~ '^[A-Za-z0-9_-]{1,64}$');
alter table public.products add constraint products_id_format check (id ~ '^[A-Za-z0-9_-]{1,64}$');

-- --------------------------------------------------
-- 4) Ajouter vos comptes à la liste blanche
--    ⚠  REMPLACEZ useramoncompte@mail.fr par vos adresses
-- --------------------------------------------------
insert into public.app_members (user_id, email)
select id, email from auth.users
where email in (
  'useramoncompte@mail.fr'
)
on conflict (user_id) do nothing;