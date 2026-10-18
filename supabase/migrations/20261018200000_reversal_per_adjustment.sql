-- Review on #95: reversals were once per transaction, so a second refund on the
-- same purchase (partial then full, or two partials) reversed nothing. Now each
-- Paddle adjustment reverses at most once, and all of a purchase's reversals
-- together never take back more than it granted.

alter table public.credit_ledger add column paddle_adjustment_id text;
alter table public.credit_ledger add constraint credit_ledger_paddle_adjustment_key unique (paddle_adjustment_id);
alter table public.credit_ledger add constraint credit_ledger_reversal_adjustment_required
  check (reason <> 'reversal' or paddle_adjustment_id is not null);

-- One purchase per transaction (was: one row per transaction and reason).
alter table public.credit_ledger drop constraint credit_ledger_paddle_transaction_id_reason_key;
create unique index credit_ledger_one_purchase_per_transaction on public.credit_ledger (paddle_transaction_id) where reason = 'purchase';

create or replace function public.grant_purchase(p_user uuid, p_transaction text, p_credits integer, p_details jsonb default '{}'::jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;
  if p_transaction is null or p_transaction = '' then
    raise exception 'a Paddle transaction id is required';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, paddle_transaction_id, details)
  values (p_user, p_credits, 'purchase', p_transaction, p_details)
  on conflict (paddle_transaction_id) where reason = 'purchase' do nothing;
  return public.credit_balance(p_user);
end;
$$;

drop function public.reverse_purchase(text, integer, jsonb);

-- Take back up to p_credits of a purchase for one Paddle adjustment (refund or
-- chargeback). Once per adjustment; capped so a purchase's reversals never sum
-- to more than it granted. Serialised per transaction. Returns the balance
-- afterwards, or null when there's no purchase for the transaction.
create function public.reverse_purchase(p_transaction text, p_adjustment text, p_credits integer, p_details jsonb default '{}'::jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid;
  v_granted integer;
  v_reversed integer;
  v_take integer;
begin
  if coalesce(p_transaction, '') = '' or coalesce(p_adjustment, '') = '' then
    raise exception 'a Paddle transaction id and adjustment id are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reverse:' || p_transaction, 0));
  select user_id, delta into v_user, v_granted
  from public.credit_ledger where paddle_transaction_id = p_transaction and reason = 'purchase';
  if v_user is null then
    return null;
  end if;
  select coalesce(-sum(delta), 0) into v_reversed
  from public.credit_ledger where paddle_transaction_id = p_transaction and reason = 'reversal';
  v_take := least(greatest(p_credits, 0), v_granted - v_reversed);
  if v_take > 0 then
    insert into public.credit_ledger (user_id, delta, reason, paddle_transaction_id, paddle_adjustment_id, details)
    values (v_user, -v_take, 'reversal', p_transaction, p_adjustment, p_details)
    on conflict (paddle_adjustment_id) do nothing;
  end if;
  return public.credit_balance(v_user);
end;
$$;

revoke execute on function public.grant_purchase(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.grant_purchase(uuid, text, integer, jsonb) to service_role;
revoke execute on function public.reverse_purchase(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reverse_purchase(text, text, integer, jsonb) to service_role;
