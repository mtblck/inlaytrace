-- HD credits: one append-only ledger per account, in the Inlay Supabase project.
--
-- Only the server touches this: Vercel Functions with the service-role key, which
-- bypasses row-level security. RLS is on with no policies and the browser roles
-- (anon, authenticated) have no privileges at all, so the publishable key reads
-- and writes nothing here. The functions below are the only way balances change.

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Positive: a purchase or a refund of a use. Negative: an HD trace or a reversed purchase.
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'use', 'refund_use', 'reversal', 'adjustment')),
  -- Paddle's transaction id (txn_…) for purchases and reversals: makes webhooks idempotent.
  paddle_transaction_id text,
  -- For 'refund_use': the use it gives back.
  refunds bigint references public.credit_ledger (id),
  -- Image size, price id and the like. Never image content.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (paddle_transaction_id, reason),
  unique (refunds)
);

create index credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
revoke all on public.credit_ledger from anon, authenticated;

-- A user's balance: the sum of their ledger.
create function public.credit_balance(p_user uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = p_user;
$$;

-- Add a purchase once per Paddle transaction. Returns the balance afterwards;
-- a repeated webhook adds nothing and returns the balance as it stands.
create function public.grant_purchase(p_user uuid, p_transaction text, p_credits integer, p_details jsonb default '{}'::jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, paddle_transaction_id, details)
  values (p_user, p_credits, 'purchase', p_transaction, p_details)
  on conflict (paddle_transaction_id, reason) do nothing;
  return public.credit_balance(p_user);
end;
$$;

-- Spend credits for one HD trace, or refuse. Serialised per user so two traces
-- at once can't both spend the last credits. Returns the new ledger row's id,
-- or null when the balance is too low.
create function public.spend_credits(p_user uuid, p_credits integer, p_details jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  if public.credit_balance(p_user) < p_credits then
    return null;
  end if;
  insert into public.credit_ledger (user_id, delta, reason, details)
  values (p_user, -p_credits, 'use', p_details)
  returning id into v_id;
  return v_id;
end;
$$;

-- Give back a use whose trace failed. Once per use. Returns the balance afterwards.
create function public.refund_use(p_use bigint)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid;
  v_delta integer;
begin
  select user_id, delta into v_user, v_delta
  from public.credit_ledger where id = p_use and reason = 'use';
  if v_user is null then
    raise exception 'no such use';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, refunds)
  values (v_user, -v_delta, 'refund_use', p_use)
  on conflict (refunds) do nothing;
  return public.credit_balance(v_user);
end;
$$;

-- Only the server may call these.
revoke execute on function public.credit_balance(uuid) from public, anon, authenticated;
revoke execute on function public.grant_purchase(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.spend_credits(uuid, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.refund_use(bigint) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid) to service_role;
grant execute on function public.grant_purchase(uuid, text, integer, jsonb) to service_role;
grant execute on function public.spend_credits(uuid, integer, jsonb) to service_role;
grant execute on function public.refund_use(bigint) to service_role;
grant select, insert on public.credit_ledger to service_role;
