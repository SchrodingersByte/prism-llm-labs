-- Organization "type" (Personal / Team / Business / Education) — collected by the
-- create-organization modal. Defaults to 'personal'; constrained to a known set.
alter table public.organizations
  add column if not exists type text not null default 'personal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_type_check'
  ) then
    alter table public.organizations
      add constraint organizations_type_check
      check (type in ('personal', 'team', 'business', 'education'));
  end if;
end $$;
