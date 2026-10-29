-- Online card payments (Square). ADDITIVE; off by default (events.online_payments = false).
alter table events add column online_payments boolean not null default false;

-- An online payment has no volunteer who "received" it, and has its own method.
alter table payments alter column received_by_admin_id drop not null;
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash', 'check', 'card_terminal', 'online_card'));

-- One row per "Pay now" tap. Money is only applied to a balance when Square confirms it was really paid.
create table online_payments (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id),
  bidder_id          uuid not null references bidders(id),
  amount_cents       integer not null check (amount_cents > 0),          -- what the guest was asked to pay
  status             text not null default 'created' check (status in ('created', 'paid', 'paid_refund_due', 'failed')),
  square_link_id     text,
  square_order_id    text unique,
  square_payment_id  text unique,
  applied_cents      integer not null default 0,                         -- how much actually went onto their balance
  refund_due_cents   integer not null default 0,                         -- paid more than they owed by then (refund in Square)
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index online_payments_bidder_idx on online_payments (bidder_id, created_at desc);
alter table online_payments enable row level security;
