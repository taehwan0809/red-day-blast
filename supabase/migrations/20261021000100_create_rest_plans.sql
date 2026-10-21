create table if not exists public.rest_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  start_date date not null,
  end_date date not null,
  plan_type text not null check (plan_type in ('여행','휴식','공부','기타')),
  memo text not null default '' check (char_length(memo) <= 600),
  created_at timestamptz not null default now(),
  constraint rest_plans_valid_range check (end_date >= start_date)
);
create index if not exists rest_plans_user_start_idx on public.rest_plans(user_id, start_date);
alter table public.rest_plans enable row level security;
drop policy if exists "Users can read own rest plans" on public.rest_plans;
drop policy if exists "Users can create own rest plans" on public.rest_plans;
drop policy if exists "Users can update own rest plans" on public.rest_plans;
drop policy if exists "Users can delete own rest plans" on public.rest_plans;
create policy "Users can read own rest plans" on public.rest_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own rest plans" on public.rest_plans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own rest plans" on public.rest_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own rest plans" on public.rest_plans for delete to authenticated using ((select auth.uid()) = user_id);
