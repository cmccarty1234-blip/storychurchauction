-- A "Power-Ups" screen the host can put on the projector: the three Power-Ups explained.
alter table events drop constraint events_display_mode_check;
alter table events add constraint events_display_mode_check
  check (display_mode in ('auto', 'dashboard', 'live', 'message', 'welcome', 'thanks', 'pie', 'chili', 'powerups'));
