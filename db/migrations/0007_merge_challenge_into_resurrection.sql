-- The Challenge Flag is folded into Resurrection: one reopening per item, optionally with the guest's own bid.
-- Resurrection is for live items only (silent items never have a last-chance window). The Flag is switched off, not deleted,
-- so any already-recorded purchases/uses keep their history.
update powerup_defs
   set kinds = '{live}',
       description = 'Bring a just-ended live auction back for 60 seconds, once per item. Add your own bid to take the lead — or reopen it and let everyone bid.'
 where code = 'resurrection';

update powerup_defs set enabled = false where code = 'challenge_flag';
