-- Reopens every silent item that ended with NO bids, until the closing time below. Items that got a bid are never touched.
-- CHANGE THE TIME on the line marked  <<< HERE  if you want a different closing time (keep the -06 for Mountain time, daylight saving ended Nov 1).
do $$
declare
  new_close timestamptz := '2026-10-30 21:00:00-06';   -- <<< HERE: 9:00 PM tonight
  ev uuid; n int;
begin
  if new_close <= now() then
    raise exception 'That closing time has already passed - nothing was changed. Change the time on the line marked HERE.';
  end if;
  select id into ev from events order by created_at desc limit 1;

  with reopened as (
    update auction_items i
       set status = 'open', closes_at = new_close, updated_at = now()
     where i.event_id = ev and i.kind = 'silent' and i.status in ('closed', 'finalized')
       and not exists (select 1 from silent_bids b where b.item_id = i.id)
       and not exists (select 1 from winning_results w where w.item_id = i.id and w.voided_at is null)
    returning i.id, i.item_number
  ), logged as (
    insert into audit_logs (event_id, actor_type, action, entity_type, entity_id, details)
    select ev, 'system', 'item.reopened', 'auction_item', id, jsonb_build_object('reason', 'reopened: no bids were placed', 'closesAt', new_close)
      from reopened
    returning 1
  )
  select count(*) into n from reopened;

  raise notice 'Reopened % item(s) until %.', n, new_close;
end $$;
