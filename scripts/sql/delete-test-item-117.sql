-- Deletes the test item "#117 TEST" and everything attached to it (its bids, results, history, power-ups used on it).
-- It refuses to run if the item has a real payment recorded against it, or if no item #117 titled "TEST" exists.
-- Power-Ups that were used on it simply go back to whoever used them. It touches nothing else.
do $$
declare it uuid; n int;
begin
  select id into it from auction_items
   where event_id = (select id from events order by created_at desc limit 1) and item_number = 117 and title = 'TEST';
  if it is null then
    raise exception 'No item #117 titled TEST found - nothing was changed.';
  end if;

  select count(*) into n from payment_allocations pa join winning_results w on w.id = pa.winning_result_id where w.item_id = it;
  if n > 0 then
    raise exception 'A payment is recorded against this item (% rows) - nothing was changed. Ask for help.', n;
  end if;

  alter table live_bid_voids disable trigger live_bid_voids_immutable;
  delete from live_bid_voids where accepted_bid_id in (select id from live_accepted_bids where item_id = it);
  alter table live_bid_voids enable trigger live_bid_voids_immutable;

  alter table live_accepted_bids disable trigger live_accepted_bids_immutable;
  delete from live_accepted_bids where item_id = it;
  alter table live_accepted_bids enable trigger live_accepted_bids_immutable;

  delete from live_bid_requests where item_id = it;

  alter table silent_bids disable trigger silent_bids_immutable;
  delete from silent_bids where item_id = it;
  alter table silent_bids enable trigger silent_bids_immutable;

  alter table powerup_activations disable trigger powerup_activations_immutable;
  delete from powerup_activations where item_id = it;
  alter table powerup_activations enable trigger powerup_activations_immutable;

  delete from item_blocks where item_id = it;
  delete from item_collections where winning_result_id in (select id from winning_results where item_id = it);
  delete from winning_results where item_id = it;

  alter table item_transitions disable trigger item_transitions_immutable;
  delete from item_transitions where item_id = it;
  alter table item_transitions enable trigger item_transitions_immutable;

  delete from announcements where item_id = it;
  delete from auction_items where id = it; -- the projector's commercial link (if any) clears itself
end $$;
