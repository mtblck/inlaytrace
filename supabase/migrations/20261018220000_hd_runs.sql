-- HD runs: one row per paid server-side job, and a private storage bucket for
-- the image going in and the result coming out, in parts of at most 4 MB
-- (Vercel's request and response limit is 4.5 MB). Inputs are deleted when the
-- run ends; results when they've been fetched, or after an hour at most.
-- Only the server touches either: RLS on, no policies, no grants to the browser roles.

create table public.hd_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('trace', 'background', 'upscale')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  credits integer not null check (credits > 0),
  -- The input's parts and content type, as announced at start.
  parts_in integer not null check (parts_in between 1 and 32),
  content_type text not null,
  -- Options for the job (trace settings), never image data.
  options jsonb not null default '{}'::jsonb,
  status text not null default 'uploading' check (status in ('uploading', 'running', 'done', 'failed')),
  -- The ledger row that paid for it (spend_credits), refunded on failure.
  use_id bigint references public.credit_ledger (id),
  parts_out integer,
  result_type text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Set once the run's files are gone from storage.
  cleaned_at timestamptz
);

create index hd_runs_user_created on public.hd_runs (user_id, created_at desc);
create index hd_runs_uncleaned on public.hd_runs (created_at) where cleaned_at is null;

alter table public.hd_runs enable row level security;
revoke all on public.hd_runs from anon, authenticated;
grant select, insert, update on public.hd_runs to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('hd', 'hd', false, 4194304)
on conflict (id) do nothing;
