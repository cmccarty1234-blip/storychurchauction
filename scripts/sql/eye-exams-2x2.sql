-- Turns the four "Eye Exam (n of 4)" items into two items of two exams each, starting at $75, $10 raises.
-- Refuses (and changes nothing) if any of the four is missing or already has a bid.
do $$
declare ev uuid; a uuid; b uuid; c uuid; d uuid; n int;
begin
  select id into ev from events order by created_at desc limit 1;
  select id into a from auction_items where event_id = ev and title = 'Eye Exam (1 of 4)';
  select id into b from auction_items where event_id = ev and title = 'Eye Exam (2 of 4)';
  select id into c from auction_items where event_id = ev and title = 'Eye Exam (3 of 4)';
  select id into d from auction_items where event_id = ev and title = 'Eye Exam (4 of 4)';
  if a is null or b is null or c is null or d is null then
    raise exception 'The four Eye Exam (n of 4) items were not all found - nothing was changed.';
  end if;
  select count(*) into n from auction_items where id in (a, b, c, d) and bid_count > 0;
  if n > 0 then
    raise exception 'An eye exam already has bids - nothing was changed.';
  end if;

  update auction_items set title = 'Eye Exams for Two (1 of 2)', description = 'Two eye exams.', starting_bid_cents = 7500, increment_cents = 1000, updated_at = now() where id = a;
  update auction_items set title = 'Eye Exams for Two (2 of 2)', description = 'Two eye exams.', starting_bid_cents = 7500, increment_cents = 1000, updated_at = now() where id = b;

  -- the other two are no longer needed (they never had bids)
  alter table item_transitions disable trigger item_transitions_immutable;
  delete from item_transitions where item_id in (c, d);
  alter table item_transitions enable trigger item_transitions_immutable;
  delete from announcements where item_id in (c, d);
  delete from auction_items where id in (c, d);
end $$;

-- confirms it: two eye-exam items
select item_number, title, starting_bid_cents / 100 as start_dollars, status from auction_items where title ilike 'Eye Exam%' order by item_number;
