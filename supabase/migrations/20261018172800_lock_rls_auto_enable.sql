-- The "automatic RLS" project setting adds this event-trigger function in public,
-- where the Data API lists it as an RPC for anon and authenticated. It can't be
-- called directly, but nothing outside the event trigger needs EXECUTE on it.
-- (Checked afterwards: a new table still gets RLS switched on.)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
