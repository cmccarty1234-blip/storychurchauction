-- Item #109 "Peppertree: $300 Gift (1 of 2)": the winning $320 bid was entered under bidder #1045 (Dawn Kuster). It was bidder #1031 (Allison).
-- This voids that $320 bid (it stays in the history, marked void, with the reason) and records $320 for #1031, paddle, as the top bid.
-- If the item was already finalized, the old result is voided (kept for history) and a new result is made for #1031 at $320,
-- with a fresh checkout record. It REFUSES to run if a payment is already recorded against the old result, or if a higher bid exists.
do $$
declare ev uuid; it uuid; allison uuid; bad_id uuid; bad_seq int; adm uuid; new_id uuid; old_wr uuid; new_wr uuid; n int;
begin
  select event_id, id into ev, it from auction_items
   where event_id = (select id from events order by created_at desc limit 1) and item_number = 109 and title = 'Peppertree: $300 Gift (1 of 2)';
  if it is null then
    raise exception 'No item #109 Peppertree found - nothing was changed.';
  end if;
  select id into allison from bidders where event_id = ev and bidder_number = 1031;
  if allison is null then
    raise exception 'No bidder #1031 found - nothing was changed.';
  end if;

  -- the $320 bid that was entered under #1045, and still counts
  select b.id, b.seq, b.entered_by_admin_id into bad_id, bad_seq, adm
    from live_accepted_bids b join bidders d on d.id = b.bidder_id
   where b.item_id = it and d.bidder_number = 1045 and b.amount_cents = 32000
     and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)
   order by b.seq desc limit 1;
  if bad_id is null then
    raise exception 'Could not find the $320 bid from #1045 on item #109 (already fixed?) - nothing was changed.';
  end if;
  if exists (select 1 from live_accepted_bids b where b.item_id = it and b.seq > bad_seq and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)) then
    raise exception 'A higher bid exists after the $320 - nothing was changed. Ask for help.';
  end if;

  -- a phone bid that was auto-accepted has no admin on it: use the admin who entered another bid on this item, else any host or admin
  if adm is null then
    select entered_by_admin_id into adm from live_accepted_bids where item_id = it and entered_by_admin_id is not null order by seq desc limit 1;
  end if;
  if adm is null then
    select id into adm from admin_users where role in ('admin', 'host') order by created_at limit 1;
  end if;
  if adm is null then
    raise exception 'No admin account found to record this correction under - nothing was changed.';
  end if;

  select id into old_wr from winning_results where item_id = it and voided_at is null;
  if old_wr is not null then
    select count(*) into n from payment_allocations a join payments p on p.id = a.payment_id where a.winning_result_id = old_wr and p.voided_at is null;
    if n > 0 then
      raise exception 'A payment is already recorded against this win (% rows) - nothing was changed. Void that payment in Checkout first.', n;
    end if;
  end if;

  insert into live_bid_voids (accepted_bid_id, voided_by, reason)
  values (bad_id, adm, 'Entered under the wrong paddle number: the $320 bid was bidder #1031, not #1045');

  insert into live_accepted_bids (item_id, seq, bidder_id, amount_cents, source, entered_by_admin_id)
  select it, coalesce(max(seq), 0) + 1, allison, 32000, 'paddle', adm from live_accepted_bids where item_id = it
  returning id into new_id;

  update auction_items set current_bid_cents = 32000, current_bidder_id = allison, updated_at = now() where id = it; -- bid count is unchanged: one voided, one added

  if old_wr is not null then
    update winning_results set voided_at = now(), voided_by_admin_id = adm, void_reason = 'Wrong paddle number entered: winner is #1031 at $320'
     where id = old_wr;
    insert into winning_results (item_id, bidder_id, amount_cents, source, source_bid_id, finalized_by_admin_id)
    values (it, allison, 32000, 'live_bid', new_id, adm) returning id into new_wr;
    insert into item_collections (winning_result_id) values (new_wr);
  end if;

  insert into audit_logs (event_id, actor_type, action, entity_type, entity_id, details)
  values (ev, 'system', 'live.winner_corrected', 'auction_item', it,
          jsonb_build_object('from', 'bidder 1045 at $320', 'to', 'bidder 1031 at $320', 'resultFixed', old_wr is not null));
end $$;
