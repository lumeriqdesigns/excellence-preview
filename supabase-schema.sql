-- MeritScholars – Supabase schema
-- Run in: Supabase Dashboard → SQL Editor → New query → Run

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_premium boolean default false,
  premium_until timestamptz,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Quiz attempts
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  subject text not null,
  exam_type text,
  mode text default 'practice',
  total int not null,
  correct int not null,
  score_pct int not null,
  duration_sec int,
  topic_breakdown jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists attempts_user_idx on public.attempts(user_id, created_at desc);

-- Leaderboard scores (best per user)
create table if not exists public.leaderboard (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text,
  best_score int default 0,
  attempts int default 0,
  updated_at timestamptz default now()
);

-- Quality flags
create table if not exists public.question_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  subject text,
  question_text text not null,
  reason text not null,
  note text,
  status text default 'open',
  created_at timestamptz default now()
);

-- Payments (optional log)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  amount_kobo int,
  reference text unique,
  status text default 'success',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.attempts enable row level security;
alter table public.leaderboard enable row level security;
alter table public.question_flags enable row level security;
alter table public.payments enable row level security;

-- Profiles policies
drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Attempts
drop policy if exists "Users CRUD own attempts" on public.attempts;
create policy "Users CRUD own attempts" on public.attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Leaderboard: anyone can read; users upsert own row
drop policy if exists "Public read leaderboard" on public.leaderboard;
drop policy if exists "Users upsert own leaderboard" on public.leaderboard;
create policy "Public read leaderboard" on public.leaderboard for select using (true);
create policy "Users upsert own leaderboard" on public.leaderboard
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Flags
drop policy if exists "Users insert flags" on public.question_flags;
drop policy if exists "Users read own flags" on public.question_flags;
create policy "Users insert flags" on public.question_flags for insert with check (auth.uid() = user_id);
create policy "Users read own flags" on public.question_flags for select using (auth.uid() = user_id);

-- Payments
drop policy if exists "Users read own payments" on public.payments;
create policy "Users read own payments" on public.payments for select using (auth.uid() = user_id);

-- Auto profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  insert into public.leaderboard (user_id, display_name, best_score, attempts)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    0, 0
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
