-- Game Portal expansion (Power-Ups, automated live timer, provisional closing, Room Events, projector).
-- ADDITIVE ONLY: nothing is dropped; every new switch defaults to OFF so an event behaves exactly as before
-- until an administrator turns game mode on.

-- ───────────────────────── event configuration ─────────────────────────
alter table events
  add column game_mode              boolean not null default false,
  add column auto_accept_live       boolean not null default false,   -- phone bids on live items accepted by the server
  add column provisional_silent     boolean not null default false,   -- silent items get the provisional window too
  add column provisional_seconds    integer not null default 300 check (provisional_seconds between 30 and 3600),
  add column live_initial_seconds   integer not null default 60  check (live_initial_seconds between 10 and 600),
  add column live_inactivity_seconds integer not null default 15 check (live_inactivity_seconds between 5 and 120),
  add column live_warning_seconds   integer not null default 10  check (live_warning_seconds between 3 and 60),
  add column live_max_seconds       integer check (live_max_seconds is null or live_max_seconds >= 30),
  add column min_reopen_seconds     integer not null default 10  check (min_reopen_seconds between 3 and 120),
  add column emergency_stop_at      timestamptz,                      -- set while an emergency stop is in force
  add column emergency_reason       text,
  add column display_mode           text not null default 'auto' check (display_mode in ('auto', 'dashboard', 'live', 'message')),
  add column display_message        text;

-- ───────────────────────── item lifecycle ─────────────────────────
alter table auction_items drop constraint auction_items_status_check;
alter table auction_items add constraint auction_items_status_check
  check (status in ('draft', 'upcoming', 'open', 'paused', 'closed', 'finalized', 'provisional', 'reopened', 'cancelled'));

alter table auction_items
  add column timed                     boolean not null default false,   -- live item runs on the automated timer
  add column timer_phase               text check (timer_phase in ('initial', 'countdown', 'reopen', 'challenge')),
  add column deadline_at               timestamptz,                      -- end of the current timer phase (server clock)
  add column provisional_until         timestamptz,                      -- fixed once; never reset
  add column pause_remaining_ms        integer,
  add column halt_kind                 text check (halt_kind in ('pause', 'emergency')),
  add column started_at                timestamptz,
  add column reopened_at               timestamptz,                      -- set when the single reopening is used
  add column min_qualifying_bid_cents  integer check (min_qualifying_bid_cents is null or min_qualifying_bid_cents >= 0);

-- Every status change made by the lifecycle engine. Append-only.
create table item_transitions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references auction_items(id),
  from_status text not null,
  to_status   text not null,
  reason      text not null,
  actor_type  text not null check (actor_type in ('admin', 'bidder', 'system')),
  actor_id    uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index item_transitions_item_idx on item_transitions (item_id, created_at);
create trigger item_transitions_immutable before update or delete on item_transitions
  for each row execute function forbid_mutation();

-- Auto-accepted phone bids have no clerk.
alter table live_accepted_bids alter column entered_by_admin_id drop not null;

-- Staff role for the show hosts (can run /admin/show; cannot change settings).
alter table admin_users drop constraint admin_users_role_check;
alter table admin_users add constraint admin_users_role_check check (role in ('admin', 'host', 'volunteer'));

-- ───────────────────────── Power-Ups ─────────────────────────
create table powerup_defs (
  code           text primary key,
  name           text not null,
  description    text not null,
  icon           text not null,
  price_cents    integer not null check (price_cents >= 0),
  enabled        boolean not null default true,
  kinds          text[] not null default '{silent,live}',     -- auction types it may be used on
  max_per_bidder_item integer check (max_per_bidder_item is null or max_per_bidder_item > 0),
  max_per_item   integer check (max_per_item is null or max_per_item > 0),
  max_per_bidder integer check (max_per_bidder is null or max_per_bidder > 0),   -- most a bidder may own/buy
  config         jsonb not null default '{}',
  sort           integer not null default 0
);
insert into powerup_defs (code, name, description, icon, price_cents, enabled, kinds, max_per_bidder_item, max_per_item, config, sort) values
 ('resurrection',   'Resurrection',   'Reopen an auction that just closed — for 60 seconds, once per item.',                         'skull',  3000, true,  '{silent,live}', 1, 1, '{"seconds":60}', 1),
 ('final_call',     'Final Call',     'Add 30 seconds to a running auction timer.',                                                  'timer',  1500, true,  '{silent,live}', 1, 2, '{"seconds":30}', 2),
 ('knockout',       'The Knockout',   'End bidding now. The leader becomes the provisional winner (you can still be beaten in the last-chance window).', 'swords', 3000, true, '{silent,live}', 1, 1, '{}', 3),
 ('challenge_flag', 'Challenge Flag', 'Challenge a live item''s provisional winner with a higher bid. 20 seconds for everyone to respond.', 'flag', 2000, true, '{live}', 1, 1, '{"seconds":20}', 4),
 ('block',          'Block',          'Pause one rival''s bidding on one live item for 30 seconds. (Disabled until the hosts rehearse it.)', 'ban', 5000, false, '{live}', 1, 1, '{"seconds":30}', 5),
 ('back_in',        'Back-In',        'Instantly lift a Block placed on you.',                                                       'undo-2', 1500, false, '{live}', 1, null, '{}', 6);

create table powerup_purchases (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(id),
  bidder_id             uuid not null references bidders(id),
  powerup_code          text not null references powerup_defs(code),
  quantity              integer not null check (quantity between 1 and 20),
  unit_price_cents      integer not null check (unit_price_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  method                text not null check (method in ('cash', 'check', 'card_terminal', 'comp')),
  reference             text,
  received_by_admin_id  uuid not null references admin_users(id),
  idempotency_key       text not null,
  created_at            timestamptz not null default now(),
  voided_at             timestamptz,
  voided_by_admin_id    uuid references admin_users(id),
  void_reason           text,
  constraint powerup_purchases_idem_uq unique (received_by_admin_id, idempotency_key)
);
create index powerup_purchases_bidder_idx on powerup_purchases (bidder_id);

-- One row per use; each consumes exactly one unit of the bidder's inventory.
create table powerup_activations (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id),
  item_id          uuid not null references auction_items(id),
  bidder_id        uuid not null references bidders(id),
  powerup_code     text not null references powerup_defs(code),
  target_bidder_id uuid references bidders(id),            -- Block target
  idempotency_key  text not null,
  details          jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  constraint powerup_activations_idem_uq unique (bidder_id, idempotency_key)
);
create index powerup_activations_item_idx on powerup_activations (item_id, created_at);
create index powerup_activations_bidder_idx on powerup_activations (bidder_id);
create trigger powerup_activations_immutable before update or delete on powerup_activations
  for each row execute function forbid_mutation();

create table item_blocks (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references auction_items(id),
  blocker_id  uuid not null references bidders(id),
  blocked_id  uuid not null references bidders(id),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  cleared_at  timestamptz,
  constraint item_blocks_once unique (item_id, blocked_id)   -- never blocked twice on one item
);

-- ───────────────────────── Room Events ─────────────────────────
create table room_event_defs (
  code     text primary key,
  name     text not null,
  enabled  boolean not null default true,
  config   jsonb not null default '{}'
);
insert into room_event_defs (code, name, enabled, config) values
 ('lightning', 'Lightning Round',  true, '{"seconds":60,"incrementCents":100}'),
 ('jackpot',   'Mystery Jackpot',  true, '{"prize":"Mystery prize"}'),
 ('battle',    'Battle of the Room', true, '{"seconds":180,"reward":"Bragging rights"}');

create table room_event_sessions (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id),
  code        text not null references room_event_defs(code),
  status      text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  config      jsonb not null default '{}',
  result      jsonb,
  started_by  uuid references admin_users(id),
  created_at  timestamptz not null default now()
);
create index room_event_sessions_active_idx on room_event_sessions (event_id, code) where status = 'active';

create table room_teams (
  session_id uuid not null references room_event_sessions(id),
  bidder_id  uuid not null references bidders(id),
  team       text not null check (team in ('gold', 'black')),
  primary key (session_id, bidder_id)
);

-- Game points (NOT dollars). bid_id is unique per kind so a bid can never score twice.
create table room_event_scores (
  session_id uuid not null references room_event_sessions(id),
  bid_kind   text not null check (bid_kind in ('silent', 'live')),
  bid_id     uuid not null,
  bidder_id  uuid not null references bidders(id),
  team       text not null check (team in ('gold', 'black')),
  points     integer not null check (points >= 0),
  created_at timestamptz not null default now(),
  primary key (session_id, bid_kind, bid_id)
);

create table jackpot_draws (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references room_event_sessions(id),
  prize            text not null,
  entries          jsonb not null,            -- snapshot of eligible bidder numbers, sorted, at draw time
  entry_count      integer not null,
  winner_bidder_id uuid not null references bidders(id),
  winner_index     integer not null,
  redraw_of        uuid references jackpot_draws(id),
  reason           text,
  drawn_by         uuid not null references admin_users(id),
  created_at       timestamptz not null default now()
);

-- ───────────────────────── projector feed ─────────────────────────
-- Every row is written by the server when the real event happens (or by a host); never invented.
create table announcements (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id),
  kind       text not null,                   -- e.g. powerup.resurrection, room.lightning, bid.lead, host.message, item.sold
  headline   text not null,
  body       text,
  item_id    uuid references auction_items(id),
  payload    jsonb not null default '{}',
  interrupt  boolean not null default false,  -- projector shows it full-screen briefly
  created_at timestamptz not null default now()
);
create index announcements_event_idx on announcements (event_id, created_at desc);

alter table item_transitions    enable row level security;
alter table powerup_defs        enable row level security;
alter table powerup_purchases   enable row level security;
alter table powerup_activations enable row level security;
alter table item_blocks         enable row level security;
alter table room_event_defs     enable row level security;
alter table room_event_sessions enable row level security;
alter table room_teams          enable row level security;
alter table room_event_scores   enable row level security;
alter table jackpot_draws       enable row level security;
alter table announcements       enable row level security;
