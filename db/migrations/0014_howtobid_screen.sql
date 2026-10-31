-- A "How to bid" screen the host can put on the projector. Allows every screen name, so it is safe to run on its own.
alter table events drop constraint events_display_mode_check;
alter table events add constraint events_display_mode_check
  check (display_mode in ('auto', 'dashboard', 'live', 'message', 'welcome', 'thanks', 'pie', 'chili', 'powerups', 'howtobid'));
