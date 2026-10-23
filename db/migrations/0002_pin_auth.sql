-- Guests sign back in with bidder number + 4-digit PIN (shown once at registration; staff can reset).
-- Email/phone are now plain contact records, so verification codes are gone.
alter table bidders
  add column pin_hash          text,
  add column pin_failed        integer not null default 0,
  add column pin_locked_until  timestamptz;

drop table verification_codes;
