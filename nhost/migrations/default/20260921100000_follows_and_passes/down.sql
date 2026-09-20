ALTER TABLE public.space_invites
  DROP COLUMN IF EXISTS use_count,
  DROP COLUMN IF EXISTS invite_kind;

DROP TABLE IF EXISTS public.pass_ledger;
DROP TABLE IF EXISTS public.pass_balances;
DROP TABLE IF EXISTS public.space_follows;

DROP TYPE IF EXISTS public.pass_ledger_reason;
DROP TYPE IF EXISTS public.space_invite_kind;
