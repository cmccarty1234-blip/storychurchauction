-- Buy Power-Ups on the phone with Square. ADDITIVE; OFF until events.powerups_online_from is set (and it only opens at that time).
-- A guest's Power-Ups are credited only after Square confirms the payment (same rule as paying a balance online).
alter table events add column powerups_online_from timestamptz;

-- Online sales have no volunteer who "received" them, and their own payment method.
alter table powerup_purchases alter column received_by_admin_id drop not null;
alter table powerup_purchases drop constraint powerup_purchases_method_check;
alter table powerup_purchases add constraint powerup_purchases_method_check check (method in ('cash', 'check', 'card_terminal', 'comp', 'online_card'));
-- one credit per Square payment, even if the webhook and the guest's return both arrive
create unique index powerup_purchases_online_uq on powerup_purchases (idempotency_key) where received_by_admin_id is null;

create table powerup_online_orders (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id),
  bidder_id          uuid not null references bidders(id),
  powerup_code       text not null references powerup_defs(code),
  quantity           integer not null check (quantity between 1 and 20),
  unit_price_cents   integer not null check (unit_price_cents >= 0),
  amount_cents       integer not null check (amount_cents > 0),
  status             text not null default 'created' check (status in ('created', 'paid', 'failed', 'amount_mismatch')),
  square_link_id     text,
  square_order_id    text unique,
  square_payment_id  text unique,
  purchase_id        uuid references powerup_purchases(id),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index powerup_online_orders_bidder_idx on powerup_online_orders (bidder_id, created_at desc);
alter table powerup_online_orders enable row level security;
