UPDATE subscriptions SET status = 'expired', updated_at = now()
 WHERE status = 'incomplete';

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN (
    'trialing', 'active', 'past_due', 'cancelled', 'expired'
  ));
