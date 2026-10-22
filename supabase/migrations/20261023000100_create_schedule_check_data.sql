create table if not exists public.schedule_check_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schedules jsonb not null default '[]'::jsonb,
  analysis jsonb,
  updated_at timestamptz not null default now(),
  constraint schedule_check_data_schedules_array check (jsonb_typeof(schedules) = 'array' and jsonb_array_length(schedules) <= 50)
);
alter table public.schedule_check_data enable row level security;
grant select, insert, update, delete on public.schedule_check_data to authenticated;
drop policy if exists "Users can read own schedule check data" on public.schedule_check_data;
drop policy if exists "Users can create own schedule check data" on public.schedule_check_data;
drop policy if exists "Users can update own schedule check data" on public.schedule_check_data;
drop policy if exists "Users can delete own schedule check data" on public.schedule_check_data;
create policy "Users can read own schedule check data" on public.schedule_check_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own schedule check data" on public.schedule_check_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own schedule check data" on public.schedule_check_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own schedule check data" on public.schedule_check_data for delete to authenticated using ((select auth.uid()) = user_id);
