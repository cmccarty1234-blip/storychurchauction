-- "Pie Brandon in the Face": sign-ups sold at the Bid Desk all night (small $100 / large $200), thrown at the finale.
-- ADDITIVE ONLY. Sold through the same desk records as Power-Ups, but kept in their own ledger line.
alter table powerup_defs add column category text not null default 'powerup' check (category in ('powerup', 'pie'));

insert into powerup_defs (code, name, description, icon, price_cents, enabled, kinds, max_per_bidder_item, max_per_item, max_per_bidder, config, sort, category) values
 ('pie_small', 'Pie Brandon in the Face — Small', 'Sign up to throw a small pie at Brandon''s face at the end of the night.', 'cake', 10000, true, '{}', null, null, null, '{}', 20, 'pie'),
 ('pie_large', 'Pie Brandon in the Face — Large', 'Sign up to throw a LARGE pie at Brandon''s face at the end of the night.', 'cake', 20000, true, '{}', null, null, null, '{}', 21, 'pie');

-- One row per pie actually thrown at the finale (append-only). Each consumes one unit of the guest's sign-ups.
create table pie_throws (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references events(id),
  bidder_id            uuid not null references bidders(id),
  powerup_code         text not null references powerup_defs(code),
  thrown_by_admin_id   uuid not null references admin_users(id),
  created_at           timestamptz not null default now()
);
create index pie_throws_bidder_idx on pie_throws (bidder_id, powerup_code);
create trigger pie_throws_immutable before update or delete on pie_throws
  for each row execute function forbid_mutation();
alter table pie_throws enable row level security;

-- Host-selectable projector screen for the finale.
alter table events drop constraint events_display_mode_check;
alter table events add constraint events_display_mode_check
  check (display_mode in ('auto', 'dashboard', 'live', 'message', 'welcome', 'thanks', 'pie'));
