-- Commercial breaks: the host plays a short video takeover on the projector, optionally promoting one silent item.
-- ADDITIVE. The clip list itself lives in code (src/lib/commercials.ts); the event only remembers which one is playing.
alter table events
  add column commercial_key        text,
  add column commercial_item_id    uuid references auction_items(id) on delete set null,
  add column commercial_started_at timestamptz;
