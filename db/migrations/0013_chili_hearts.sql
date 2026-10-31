-- Hearts on chilis: a free "I like this one" tap, one per guest per chili. Separate from votes: no money, no effect on who wins.
create table chili_hearts (
  entry_id    uuid not null references chili_entries(id) on delete cascade,
  bidder_id   uuid not null references bidders(id),
  created_at  timestamptz not null default now(),
  primary key (entry_id, bidder_id)
);
create index chili_hearts_bidder_idx on chili_hearts (bidder_id);
alter table chili_hearts enable row level security;
