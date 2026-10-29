-- Removes the Square test data: the item "TEST - delete me" and the guest named "Square Test" with everything attached
-- (bid, win, payments, online payment). Refuses to run if the test guest did anything else (power-ups, pies, teams…).
do $$
declare it uuid; b uuid; n int;
begin
  select id into it from auction_items where title = 'TEST - delete me';
  select id into b from bidders where name = 'Square Test';
  if it is null and b is null then
    raise exception 'No test item or test guest found - nothing was changed.';
  end if;

  select (select count(*) from powerup_purchases where bidder_id = b)
       + (select count(*) from powerup_activations where bidder_id = b)
       + (select count(*) from pie_throws where bidder_id = b)
       + (select count(*) from room_teams where bidder_id = b)
       + (select count(*) from silent_bids where bidder_id = b and item_id is distinct from it)
    into n;
  if n > 0 then
    raise exception 'The test guest has other activity (% rows) - nothing was changed. Ask for help.', n;
  end if;

  delete from payment_allocations where payment_id in (select id from payments where bidder_id = b);
  delete from online_payments where bidder_id = b;
  delete from payments where bidder_id = b;
  delete from item_collections where winning_result_id in (select id from winning_results where item_id = it);
  delete from winning_results where item_id = it;

  alter table silent_bids disable trigger silent_bids_immutable;
  delete from silent_bids where item_id = it or bidder_id = b;
  alter table silent_bids enable trigger silent_bids_immutable;

  alter table item_transitions disable trigger item_transitions_immutable;
  delete from item_transitions where item_id = it;
  alter table item_transitions enable trigger item_transitions_immutable;

  delete from announcements where item_id = it;
  delete from bidder_sessions where bidder_id = b;
  delete from auction_items where id = it;
  delete from bidders where id = b;
end $$;
