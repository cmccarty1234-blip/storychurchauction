-- Chili Cook-Off: its own feature (not auction items). Guests give $1 per vote to the chili they like; the chili with the most
-- dollars wins and every dollar goes to the fundraiser. Votes are owed at checkout (paid at the desk, recorded here). ADDITIVE.
create table chili_entries (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id),
  entry_number  integer not null,
  name          text not null,
  cook          text,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (event_id, entry_number)
);

create table chili_votes (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id),
  entry_id         uuid not null references chili_entries(id),
  bidder_id        uuid not null references bidders(id),
  amount_cents     integer not null check (amount_cents > 0 and amount_cents % 100 = 0),
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  void_reason      text,
  voided_by_admin_id uuid references admin_users(id),
  paid_at          timestamptz,
  paid_method      text check (paid_method in ('cash', 'check', 'card_terminal')),
  paid_by_admin_id uuid references admin_users(id)
);
create index chili_votes_bidder_idx on chili_votes (bidder_id);
create index chili_votes_entry_idx on chili_votes (entry_id);

alter table chili_entries enable row level security;
alter table chili_votes enable row level security;

-- off = hidden, open = guests can vote, closed = voting over (the projector shows the winner)
alter table events add column chili_voting text not null default 'off' check (chili_voting in ('off', 'open', 'closed'));

alter table events drop constraint events_display_mode_check;
alter table events add constraint events_display_mode_check
  check (display_mode in ('auto', 'dashboard', 'live', 'message', 'welcome', 'thanks', 'pie', 'chili'));

-- The six entries for the night (edit names in Supabase if needed). Skipped when there is no event yet.
insert into chili_entries (event_id, entry_number, name, cook)
select e.id, v.n, v.name, v.cook
  from (select id from events order by created_at desc limit 1) e
 cross join (values
   (1, 'Dee''s Sweet and Swaggy Chili', 'Dee'),
   (2, 'Brandon''s Spicy Chicken Chili', 'Brandon'),
   (3, 'Lisa''s Dragon Chili', 'Lisa'),
   (4, 'Mr. Ed''s Magic Chili', 'Mr. Ed'),
   (5, 'Nicole''s Veggie Chili', 'Nicole'),
   (6, 'Reyna''s Chicken Verde Pozole', 'Reyna')
 ) as v(n, name, cook)
on conflict (event_id, entry_number) do nothing;
