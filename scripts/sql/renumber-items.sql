-- Renumbers items so numbering is tidy and accurate:
--   * silent items become 1..N (no gaps), keeping their current order but pulling split sets next to each other
--     (e.g. "(1 of 2)" and "(2 of 2)", and all Taekwondo items)
--   * live items become 101, 102, 103 … in their current order (this is also the live running order)
-- Bids are NOT affected (they belong to the item, not the number). Printed labels/catalogs with old numbers become wrong.
do $$
declare ev uuid;
begin
  select id into ev from events order by created_at desc limit 1;

  create temp table renum on commit drop as
  with s as (
    select id, kind, item_number,
           case when title ilike 'Taekwondo%' then 'Taekwondo'
                else regexp_replace(title, ' \(\d of \d\)$', '') end as set_key
      from auction_items where event_id = ev
  ), a as (
    select s.*, min(item_number) over (partition by kind, set_key) as anchor from s
  )
  select id, kind,
         (case when kind = 'silent'
               then row_number() over (partition by kind order by anchor, item_number)
               else 100 + row_number() over (partition by kind order by item_number) end)::int as new_no
    from a;

  -- Two steps so the "one number per item" rule is never broken half-way.
  update auction_items set item_number = item_number + 100000 where event_id = ev;
  update auction_items i
     set item_number = r.new_no,
         live_order  = case when i.kind = 'live' then r.new_no else null end,
         updated_at  = now()
    from renum r
   where r.id = i.id;

  insert into audit_logs (event_id, actor_type, action, entity_type, details)
  values (ev, 'system', 'items.renumbered_by_sql', 'auction_item', '{"note":"Silent 1..N, live 101..; split sets kept together"}'::jsonb);
end $$;
