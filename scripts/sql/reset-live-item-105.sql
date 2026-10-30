-- Puts live item #105 "Royal Gorge Train: 2 Experience Tickets" back in the Up next queue, as if it had never been started.
-- It stops any commercial that is playing or waiting for it. The history of the accidental start stays in the item's log.
-- It REFUSES to run if anyone has already bid on the item (a bid can't be taken back this way) - nothing is changed then.
do $$
declare it uuid; ev uuid; n int;
begin
  select id, event_id into it, ev from auction_items
   where event_id = (select id from events order by created_at desc limit 1) and item_number = 105 and title = 'Royal Gorge Train: 2 Experience Tickets';
  if it is null then
    raise exception 'No item #105 titled Royal Gorge Train found - nothing was changed.';
  end if;

  select (select count(*) from live_accepted_bids where item_id = it)
       + (select count(*) from live_bid_requests where item_id = it)
       + (select count(*) from silent_bids where item_id = it)
       + (select count(*) from winning_results where item_id = it)
    into n;
  if n > 0 then
    raise exception 'This item already has % bid(s) or results - nothing was changed. Ask for help.', n;
  end if;

  update auction_items
     set status = 'upcoming', timed = false, timer_phase = null, deadline_at = null, started_at = null,
         halt_kind = null, pause_remaining_ms = null, provisional_until = null, reopened_at = null,
         current_bid_cents = null, current_bidder_id = null, bid_count = 0, updated_at = now()
   where id = it;

  -- a commercial playing or waiting to open this item is cancelled
  update events set commercial_started_at = null, commercial_start_item_id = null
   where id = ev and (commercial_item_id = it or commercial_start_item_id = it);

  insert into audit_logs (event_id, actor_type, action, entity_type, entity_id, details)
  values (ev, 'system', 'live.reset', 'auction_item', it, '{"reason":"started by mistake, put back in the queue"}');
end $$;
