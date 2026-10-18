-- Hold credits while a refund waits for Paddle's approval, so they can't be
-- spent in the meantime; give them back if Paddle rejects the refund.
--
-- The hold is the reversal itself (reverse_purchase, once per adjustment), made
-- as soon as the refund is requested. A rejection adds a row that cancels that
-- reversal: reason 'adjustment', pointing at it through `refunds`, once only.
-- reverse_purchase now counts a cancelled reversal as not reversed, so a later
-- refund on the same purchase can still take the credits back.

create function public.release_reversal(p_adjustment text, p_details jsonb default '{}'::jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_user uuid;
  v_delta integer;
  v_transaction text;
begin
  if coalesce(p_adjustment, '') = '' then
    raise exception 'a Paddle adjustment id is required';
  end if;
  select id, user_id, delta, paddle_transaction_id into v_id, v_user, v_delta, v_transaction
  from public.credit_ledger where paddle_adjustment_id = p_adjustment and reason = 'reversal';
  if v_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reverse:' || v_transaction, 0));
  insert into public.credit_ledger (user_id, delta, reason, refunds, details)
  values (v_user, -v_delta, 'adjustment', v_id, p_details || jsonb_build_object('released_adjustment', p_adjustment))
  on conflict (refunds) do nothing;
  return public.credit_balance(v_user);
end;
$$;

create or replace function public.reverse_purchase(p_transaction text, p_adjustment text, p_credits integer, p_details jsonb default '{}'::jsonb)
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
  -- Reversals still standing: those not cancelled by a released hold.
  select coalesce(-sum(r.delta), 0) into v_reversed
  from public.credit_ledger r
  where r.paddle_transaction_id = p_transaction and r.reason = 'reversal'
    and not exists (select 1 from public.credit_ledger x where x.refunds = r.id and x.reason = 'adjustment');
  v_take := least(greatest(p_credits, 0), v_granted - v_reversed);
  if v_take > 0 then
    insert into public.credit_ledger (user_id, delta, reason, paddle_transaction_id, paddle_adjustment_id, details)
    values (v_user, -v_take, 'reversal', p_transaction, p_adjustment, p_details)
    on conflict (paddle_adjustment_id) do nothing;
  end if;
  return public.credit_balance(v_user);
end;
$$;

revoke execute on function public.release_reversal(text, jsonb) from public, anon, authenticated;
grant execute on function public.release_reversal(text, jsonb) to service_role;
revoke execute on function public.reverse_purchase(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reverse_purchase(text, text, integer, jsonb) to service_role;
