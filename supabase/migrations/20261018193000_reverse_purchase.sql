-- Take credits back when Paddle refunds a purchase or it's charged back.
-- Once per Paddle transaction (unique (paddle_transaction_id, reason)); never
-- more than the purchase granted. The balance may go below zero if the credits
-- were already spent: that's the honest record, and spending stops until it's
-- back above zero. Returns the user's balance afterwards, or null when there's
-- no purchase for that transaction (nothing to reverse).

create function public.reverse_purchase(p_transaction text, p_credits integer, p_details jsonb default '{}'::jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid;
  v_granted integer;
begin
  if p_transaction is null or p_transaction = '' then
    raise exception 'a Paddle transaction id is required';
  end if;
  select user_id, delta into v_user, v_granted
  from public.credit_ledger where paddle_transaction_id = p_transaction and reason = 'purchase';
  if v_user is null then
    return null;
  end if;
  if p_credits > 0 then
    insert into public.credit_ledger (user_id, delta, reason, paddle_transaction_id, details)
    values (v_user, -least(p_credits, v_granted), 'reversal', p_transaction, p_details)
    on conflict (paddle_transaction_id, reason) do nothing;
  end if;
  return public.credit_balance(v_user);
end;
$$;

revoke execute on function public.reverse_purchase(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reverse_purchase(text, integer, jsonb) to service_role;
