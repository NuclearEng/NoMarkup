-- Paid Stripe subscriptions are created with payment_behavior=default_incomplete.
-- The row must not be 'active' (which grants plan caps) before invoice.paid.
-- 'incomplete' is excluded from every entitlement query.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'subscriptions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%trialing%'
    AND pg_get_constraintdef(con.oid) ILIKE '%past_due%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN (
    'trialing', 'active', 'past_due', 'cancelled', 'expired', 'incomplete'
  ));
