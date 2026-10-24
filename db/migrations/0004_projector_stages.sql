-- Projector upgrade: a fundraising goal and two extra host-selectable screens (Welcome, Thank you).
-- ADDITIVE ONLY.
alter table events add column goal_cents integer check (goal_cents is null or goal_cents > 0);
alter table events drop constraint events_display_mode_check;
alter table events add constraint events_display_mode_check
  check (display_mode in ('auto', 'dashboard', 'live', 'message', 'welcome', 'thanks'));
