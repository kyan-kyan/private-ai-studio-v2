create schema if not exists studio_private;
revoke all on schema studio_private from public, anon, authenticated;

create table studio_private.jobs (
  id uuid primary key,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  check ((record->>'id')::uuid = id),
  check (record->>'status' in ('submitting','unknown','queued','running','finishing','completed','failed')),
  check (not (record ? 'imageBase64'))
);
alter table studio_private.jobs enable row level security;
revoke all on studio_private.jobs from public, anon, authenticated;

create table studio_private.config (
  singleton boolean primary key default true check (singleton),
  token_hash text check (token_hash ~ '^[a-f0-9]{64}$'),
  kaggle_username text not null default 'yyykan',
  kaggle_secret_id uuid references vault.secrets(id),
  active_id uuid references studio_private.jobs(id)
);
alter table studio_private.config enable row level security;
revoke all on studio_private.config from public, anon, authenticated;
insert into studio_private.config(singleton) values(true);
