alter table studio_private.config
  add column pair_code_hash text check (pair_code_hash ~ '^[a-f0-9]{64}$'),
  add column pair_expires_at timestamptz,
  add column pair_attempts integer not null default 0 check (pair_attempts between 0 and 10);
create table studio_private.device_keys (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 days')
);
alter table studio_private.device_keys enable row level security;
revoke all on studio_private.device_keys from public,anon,authenticated;
