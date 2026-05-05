create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'member')) default 'member',
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create table if not exists public.babies (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  birthday date not null,
  gender text not null check (gender in ('unknown', 'boy', 'girl')) default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feeding_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  baby_id uuid not null references public.babies(id) on delete cascade,
  recorder_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('breast', 'bottle_breast', 'formula')),
  fed_at timestamptz not null default now(),
  left_minutes integer not null default 0,
  right_minutes integer not null default 0,
  amount_ml integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.growth_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  baby_id uuid not null references public.babies(id) on delete cascade,
  recorder_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null default current_date,
  height_cm numeric(5, 1) not null,
  weight_kg numeric(5, 2) not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.babies enable row level security;
alter table public.feeding_records enable row level security;
alter table public.growth_records enable row level security;

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists babies_touch_updated_at on public.babies;
create trigger babies_touch_updated_at before update on public.babies
for each row execute function public.touch_updated_at();

drop trigger if exists feeding_touch_updated_at on public.feeding_records;
create trigger feeding_touch_updated_at before update on public.feeding_records
for each row execute function public.touch_updated_at();

drop trigger if exists growth_touch_updated_at on public.growth_records;
create trigger growth_touch_updated_at before update on public.growth_records
for each row execute function public.touch_updated_at();

drop policy if exists "profiles select self" on public.profiles;
create policy "profiles select self" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "families select member" on public.families;
create policy "families select member" on public.families
for select using (auth.uid() is not null);

drop policy if exists "families insert owner" on public.families;
create policy "families insert owner" on public.families
for insert with check (owner_id = auth.uid());

drop policy if exists "families update admin" on public.families;
create policy "families update admin" on public.families
for update using (
  exists (
    select 1 from public.family_members fm
    where fm.family_id = id and fm.user_id = auth.uid() and fm.role = 'admin'
  )
);

drop policy if exists "members select family" on public.family_members;
create policy "members select family" on public.family_members
for select using (public.is_family_member(family_id) or user_id = auth.uid());

drop policy if exists "members insert self or admin" on public.family_members;
create policy "members insert self or admin" on public.family_members
for insert with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.family_members fm
    where fm.family_id = family_id and fm.user_id = auth.uid() and fm.role = 'admin'
  )
);

drop policy if exists "members update admin" on public.family_members;
create policy "members update admin" on public.family_members
for update using (
  exists (
    select 1 from public.family_members fm
    where fm.family_id = family_id and fm.user_id = auth.uid() and fm.role = 'admin'
  )
);

drop policy if exists "babies member all" on public.babies;
create policy "babies member all" on public.babies
for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

drop policy if exists "feeding member all" on public.feeding_records;
create policy "feeding member all" on public.feeding_records
for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

drop policy if exists "growth member all" on public.growth_records;
create policy "growth member all" on public.growth_records
for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
