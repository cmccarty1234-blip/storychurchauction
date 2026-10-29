-- Adds the six chili entries as silent items that are VISIBLE but not open for bidding ("Opens soon").
-- $20 start, $10 raises (edit the numbers if you like). Safe to run twice: a chili that already exists is skipped.
insert into auction_items (event_id, item_number, kind, title, description, donor_name, starting_bid_cents, increment_cents, status)
select e.id,
       (select coalesce(max(item_number), 0) from auction_items where event_id = e.id and kind = 'silent') + row_number() over (order by v.ord),
       'silent', v.title, 'A chili entry for the night.', v.donor, 2000, 1000, 'upcoming'
  from (select id from events order by created_at desc limit 1) e
 cross join (values
   (1, 'Dee''s Sweet and Swaggy Chili', 'Dee'),
   (2, 'Brandon''s Spicy Chicken Chili', 'Brandon'),
   (3, 'Lisa''s Dragon Chili', 'Lisa'),
   (4, 'Mr. Ed''s Magic Chili', 'Mr. Ed'),
   (5, 'Nicole''s Veggie Chili', 'Nicole'),
   (6, 'Reyna''s Chicken Verde Pozole', 'Reyna')
 ) as v(ord, title, donor)
 where not exists (select 1 from auction_items x where x.event_id = e.id and x.title = v.title);

-- confirms it: the six chili items
select item_number, title, status from auction_items where title ilike '%chili%' or title ilike '%pozole%' order by item_number;
