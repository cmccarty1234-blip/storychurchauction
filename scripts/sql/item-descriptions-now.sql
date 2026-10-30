-- Beefed-up descriptions (warm and fun), ONLY the ones that need no confirming. This REPLACES the current description of each item listed.
-- Safe by design: an item is only changed when its number AND exact title match, so nothing else can be touched.
-- Run it in this order, one statement block at a time:
--   1) the backup (keeps the old text so you can undo)
--   2) the update
--   3) (only if you want to undo) the restore at the bottom
-- Lines marked  -- confirm  are rough drafts: check the wording first and edit it here if it is wrong.

-- 1) BACKUP
create table if not exists item_description_backup as
  select id, item_number, title, description, now() as saved_at from auction_items where false;
insert into item_description_backup (id, item_number, title, description)
  select id, item_number, title, description from auction_items
   where event_id = (select id from events order by created_at desc limit 1);

-- 2) UPDATE
update auction_items i
   set description = v.d, updated_at = now()
  from (values
    (102, 'Mercy Me / Jeremy Camp: 2 Tickets', 'Two tickets to see MercyMe and Jeremy Camp live at the Broadmoor World Arena. Bring your best friend and your biggest singing voice for an unforgettable night of worship and music.'),
    (103, 'Third Day: 2 Tickets', 'Two tickets to see Third Day on their 30th Anniversary Tour at the Broadmoor World Arena. Grab a friend and sing along to the songs you grew up on.'),
    (105, 'Royal Gorge Train: 2 Experience Tickets', 'Two experience tickets on the Royal Gorge Route Railroad, a scenic train ride through the Royal Gorge canyon along the Arkansas River. Sit back, enjoy the view, and let the train do the driving.'),
    (107, 'Horseback Riding Adventure for 2', 'A horseback riding adventure for two people. Saddle up with someone you love and see Colorado from a whole new view.'),
    (109, 'Peppertree: $300 Gift (1 of 2)', 'A $300 gift certificate to Peppertree Restaurant, a Colorado Springs favorite. Dinner for the whole family, or a date night with extra dessert.'),
    (112, 'Handyman: 3 Hours', 'Three hours of handyman work from BC. Finally cross off the honey-do list: the wobbly shelf, the sticky door, the thing you keep meaning to fix.'),
    (113, 'Books Basket', 'A basket of books from The Shupps. Curl up with a blanket and get lost in a good story.'),
    (114, 'Spa Basket', 'A spa basket from Marina, made for a relaxing night in. Light a candle, take a deep breath, and treat yourself.'),
    (115, '4 Hours of Christmas Wrapping', 'Four hours of Christmas wrapping from Shaunte, so every present under your tree looks professionally done. Hand off the tape and the scissors and enjoy the holidays.'),
    (1, 'IHOP: 4 Free Entrees', 'Four free entrees at IHOP in Stetson Hills. Pancakes for everybody!'),
    (3, 'Massage at Hand and Stone', 'A massage at Hand and Stone. Unwind, melt the stress away, and walk out feeling like a whole new person.'),
    (4, 'Big O Tires: 1 Oil Change + 1 Alignment (1 of 2)', 'One oil change and one alignment from Big O Tires. Keep your car running smooth and your tires wearing evenly.'),
    (6, 'Il Vicino: $50 Gift + Bottle of Hot Oil', 'A $50 gift to Il Vicino, plus a bottle of their hot oil to spice up dinner at home. Wood-fired pizza with a little heat.'),
    (7, 'Chick-fil-A: 15 Sandwiches (1 of 2)', 'Fifteen Chick-fil-A sandwiches. Feed the whole crew, or be the hero of your next party.'),
    (10, 'Peppertree: $300 Gift (2 of 2)', 'A $300 gift certificate to Peppertree Restaurant, a Colorado Springs favorite. Dinner for the whole family, or a date night with extra dessert.'),
    (13, 'Taekwondo: 2-Hour Self-Defense Class (10 People)', 'A two-hour self-defense class for 10 people with Master Kunkel. Perfect for a group of friends, a family or a team: confidence, fitness and fun.'),
    (14, 'Eye Exams for Two (1 of 2)', 'Two eye exams. See the world more clearly, and give your eyes a checkup.'),
    (18, 'Large Bundt Cake', 'A large Bundt cake from Nothing Bundt Cakes. Dessert is handled, and everyone will think you baked it.'),
    (20, 'Paintball: 10 Players (1 of 3)', 'A paintball package for 10 players from APC Paintball. Gather your group and get ready for some friendly battle.'),
    (33, '6 Movie Tickets', 'Six movie tickets. Popcorn night for the whole family!'),
    (36, 'Bonny and Read: $100 Gift', 'A $100 gift to Bonny and Read. Treat yourself, or someone you love.'),
    (37, 'Christmas Stockings, Placemats, & Ornaments, & Heidrich''s Christmas Tree Farm $50 Gift Card', 'A Christmas bundle: stockings, placemats and ornaments, plus a $50 gift card to Heidrich''s Christmas Tree Farm. Everything for a cozy start to the holidays.'),
    (38, '5 Free Barber Cuts', 'Five free barber cuts from Will. Look sharp all season long.'),
    (39, '5 Homemade Soaps', 'Five homemade soaps from Will. Handmade, great smelling and gift-ready.'),
    (43, 'Counseling Sessions (3 Sessions)', 'Three counseling sessions from Nicole and Lawrence. A gift of support, a listening ear and a fresh start.'),
    (44, 'Original Painting (2-piece)', 'An original two-piece painting. One of a kind and made to be displayed.'),
    (54, 'Worship Piano or Drum Lessons', 'Five sessions of worship piano or drum lessons ($100 per hour) from Dee. Learn to lead worship, or take your playing to the next level.'),
    (55, 'Paintball: 10 Players (2 of 3)', 'A paintball package for 10 players from APC Paintball. Gather your group and get ready for some friendly battle.'),
    (56, 'Paintball: 10 Players (3 of 3)', 'A paintball package for 10 players from APC Paintball. Gather your group and get ready for some friendly battle.'),
    (57, 'Big O Tires: 1 Oil Change + 1 Alignment (2 of 2)', 'One oil change and one alignment from Big O Tires. Keep your car running smooth and your tires wearing evenly.'),
    (58, 'Eye Exams for Two (2 of 2)', 'Two eye exams. See the world more clearly, and give your eyes a checkup.'),
    (61, 'Chick-fil-A: 15 Sandwiches (2 of 2)', 'Fifteen Chick-fil-A sandwiches. Feed the whole crew, or be the hero of your next party.'),
    (62, 'Taekwondo: Birthday Party', 'A taekwondo birthday party with Master Kunkel. Kicks, laughs and a birthday kid who''ll talk about it for months.'),
    (63, 'Taekwondo for a Family', 'Taekwondo for a family with Master Kunkel. Learn together and get strong together.'),
    (64, 'Taekwondo Camp', 'A taekwondo camp with Master Kunkel. A great way for kids to build confidence and burn off some energy.'),
    (65, 'Sheldon Car Detailing', 'A car detailing package valued at $200 from Sheldon Car Detailing. Give your car the spa day it deserves.'),
    (66, 'Nancy''s Winter Health Basket', 'Get over your winter cold or flu in a flash with all these cold and flu supplies. Put together with care by Nancy Harmon.'),
    (67, 'Scheels Gift Card', 'A gift card to Scheels, donated by Leah. Gear up for your next adventure.'),
    (69, 'Colorado Mountain Brewery Gift Card', 'A gift card to Colorado Mountain Brewery. Grab some friends and enjoy a meal together.'),
    (71, 'Texas Roadhouse Dinner for 2', 'Dinner for two at Texas Roadhouse. Hot rolls, a great meal, and a date night to look forward to.'),
    (72, 'Bath & Body Basket', 'A Bath & Body basket featuring 10,000 Wishes. Soak, relax and smell amazing.'),
    (80, 'Rocket Fizz 2', 'A candy basket from Rocket Fizz. Sweet tooth, meet your dream basket.')
  ) as v(n, t, d)
 where i.event_id = (select id from events order by created_at desc limit 1)
   and i.item_number = v.n
   and i.title = v.t;

-- How many matched? (should be 42)
select count(*) as items_with_new_text from auction_items i
  join item_description_backup b on b.id = i.id where i.description is distinct from b.description;

-- 3) UNDO (only if you want the old text back)
-- update auction_items i set description = b.description, updated_at = now() from item_description_backup b where b.id = i.id;
