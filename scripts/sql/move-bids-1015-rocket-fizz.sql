-- Moves bidder #1015's bid(s) from item #80 "Rocket Fizz 2" to item #8 "Rocket Fizz 1", then fixes both items' high bid and bid count.
-- It stops (and changes nothing) if: either item is already closed or has a result, bidder #1015 has no bid on #80,
-- or #8 already has a bid for the same dollar amount (the system doesn't allow two equal bids on one item).
-- The move is written to the audit log. Bids are normally locked, so this unlocks that one table for the duration of the move.
do $$
declare ev uuid; i_from uuid; i_to uuid; b uuid; moved int; clash int; bad int;
begin
  select id into ev from events order by created_at desc limit 1;
  select id into i_from from auction_items where event_id = ev and item_number = 80 and title = 'Rocket Fizz 2';
  select id into i_to   from auction_items where event_id = ev and item_number = 8  and title = 'Rocket Fizz 1';
  select id into b      from bidders       where event_id = ev and bidder_number = 1015;
  if i_from is null or i_to is null or b is null then
    raise exception 'Could not find item #80 Rocket Fizz 2, item #8 Rocket Fizz 1, or bidder #1015 - nothing was changed.';
  end if;

  select count(*) into bad from auction_items where id in (i_from, i_to) and status <> 'open';
  if bad > 0 or exists (select 1 from winning_results where item_id in (i_from, i_to)) then
    raise exception 'One of the two items is no longer open or already has a result - nothing was changed. Ask for help.';
  end if;

  select count(*) into moved from silent_bids where item_id = i_from and bidder_id = b;
  if moved = 0 then
    raise exception 'Bidder #1015 has no bid on item #80 - nothing was changed.';
  end if;

  select count(*) into clash from silent_bids s
   where s.item_id = i_to and s.amount_cents in (select amount_cents from silent_bids where item_id = i_from and bidder_id = b);
  if clash > 0 then
    raise exception 'Item #8 already has a bid for the same amount - nothing was changed. Ask for help.';
  end if;

  alter table silent_bids disable trigger silent_bids_immutable;
  update silent_bids set item_id = i_to where item_id = i_from and bidder_id = b;
  alter table silent_bids enable trigger silent_bids_immutable;

  -- the high bid and bid count on each item are kept on the item itself: recompute both from the bids
  update auction_items i
     set bid_count = (select count(*) from silent_bids s where s.item_id = i.id),
         current_bid_cents = (select max(amount_cents) from silent_bids s where s.item_id = i.id),
         current_bidder_id = (select bidder_id from silent_bids s where s.item_id = i.id order by amount_cents desc limit 1),
         updated_at = now()
   where i.id in (i_from, i_to);

  insert into audit_logs (event_id, actor_type, action, entity_type, entity_id, details)
  values (ev, 'system', 'bid.moved', 'auction_item', i_to,
          jsonb_build_object('bidderNumber', 1015, 'from', 'item 80 Rocket Fizz 2', 'to', 'item 8 Rocket Fizz 1', 'bids', moved));
end $$;
