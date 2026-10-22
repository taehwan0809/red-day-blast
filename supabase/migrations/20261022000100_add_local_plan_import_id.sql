alter table public.rest_plans
  add column if not exists local_id text;

create unique index if not exists rest_plans_user_local_id_key
  on public.rest_plans(user_id, local_id);
