-- A commercial can play right before a live item opens for bidding: the host taps Start, the commercial plays, and the item
-- opens the moment it ends (or when the host skips it). These two columns hold that pending start. ADDITIVE.
alter table events
  add column commercial_start_item_id uuid references auction_items(id) on delete set null,
  add column commercial_admin_id      uuid references admin_users(id) on delete set null;
