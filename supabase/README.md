# Supabase (HD credits)

The Inlay Supabase project (`hjmhsrxagrquqgtfzyfx`, East US, free plan) holds
accounts and the HD credit ledger. Nothing else: images are never stored.

`migrations/` is applied in order. Only the server (Vercel Functions with the
service-role key) reads or writes; the browser roles have no access, and the
app talks only to `/api`. See [docs/hd-mode.md](../docs/hd-mode.md).
