-- Resets the Square test: clears the old "TEST - delete me" item and the test guest's win/payments, KEEPS the guest
-- "Square Test" (same bidder number and PIN), and creates a fresh open $1 test item. Refuses if the test guest did
-- anything else (power-ups, pies, teams, bids on real items).
do $$
declare it uuid; b uuid; n int;
begin
  select id into it from auction_items where title = 'TEST - delete me';
  select id into b from bidders where name = 'Square Test';
  if b is null then
    raise exception 'The test guest "Square Test" was not found - nothing was changed.';
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

  if it is not null then
    delete from item_collections where winning_result_id in (select id from winning_results where item_id = it);
    delete from winning_results where item_id = it;

    alter table silent_bids disable trigger silent_bids_immutable;
    delete from silent_bids where item_id = it;
    alter table silent_bids enable trigger silent_bids_immutable;

    alter table item_transitions disable trigger item_transitions_immutable;
    delete from item_transitions where item_id = it;
    alter table item_transitions enable trigger item_transitions_immutable;

    delete from announcements where item_id = it;
    delete from auction_items where id = it;
  end if;

  insert into auction_items (event_id, item_number, kind, title, description, donor_name, starting_bid_cents, increment_cents, status)
  select e.id,
         (select coalesce(max(item_number), 0) from auction_items where event_id = e.id and kind = 'silent') + 1,
         'silent', 'TEST - delete me', 'Square payment test. Not a real item.', 'Test', 100, 100, 'open'
    from (select id from events order by created_at desc limit 1) e;
end $$;

-- confirms it: one open test item, and the test guest still there
select 'item' as what, item_number::text as number, title as name, status from auction_items where title = 'TEST - delete me'
union all
select 'guest', bidder_number::text, name, null from bidders where name = 'Square Test';
