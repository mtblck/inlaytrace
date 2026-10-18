-- Idempotency rests on unique (paddle_transaction_id, reason), and Postgres treats
-- NULLs as distinct: a purchase or reversal without a Paddle transaction id would
-- be granted again on every webhook retry. Require the id, in the table and in
-- grant_purchase (which raises instead of quietly granting).
-- (Checked: a null id raises, a raw insert hits the check, a repeat grant adds nothing.)

alter table public.credit_ledger
  add constraint credit_ledger_paddle_transaction_required
  check (reason not in ('purchase', 'reversal') or paddle_transaction_id is not null);

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
  on conflict (paddle_transaction_id, reason) do nothing;
  return public.credit_balance(p_user);
end;
$$;

revoke execute on function public.grant_purchase(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.grant_purchase(uuid, text, integer, jsonb) to service_role;
