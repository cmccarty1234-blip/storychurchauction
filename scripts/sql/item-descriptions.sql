-- Fills in a short description for items that don't have one. It NEVER overwrites a description someone already wrote
-- (only blank ones, plus the one-word "BOGO"), and it only touches items whose title matches exactly.
-- Lines marked "-- confirm" are rough drafts: check them, edit the text if needed, then run.
update auction_items i
   set description = v.d, updated_at = now()
  from (values
    -- gift cards and certificates
    ('Peppertree: $300 Gift (1 of 2)', 'A $300 gift certificate to Peppertree Restaurant.'),
    ('Peppertree: $300 Gift (2 of 2)', 'A $300 gift certificate to Peppertree Restaurant.'),
    ('Bonny and Read: $100 Gift', 'A $100 gift certificate to Bonny and Read.'),
    ('Scheels Gift Card', 'A gift card to Scheels.'),
    ('Colorado Mountain Brewery Gift Card', 'A gift card to Colorado Mountain Brewery.'),
    ('Hacienda Gift Card', 'A gift card to Hacienda.'),
    ('Texas Roadhouse Dinner for 2', 'Dinner for two at Texas Roadhouse.'),
    ('6 Movie Tickets', 'Six movie tickets.'),
    ('Christmas Stockings, Placemats, & Ornaments, & Heidrich''s Christmas Tree Farm $50 Gift Card', 'Christmas stockings, placemats and ornaments, plus a $50 gift card to Heidrich''s Christmas Tree Farm.'),
    -- services and experiences
    ('Counseling Sessions (3 Sessions)', 'Three counseling sessions.'),
    ('The Broadmoor Stay', 'A stay at The Broadmoor, the historic resort in Colorado Springs.'),                      -- confirm: nights / what is included
    ('Sky Diving COS', 'Skydiving in Colorado Springs. BOGO: buy one, get one free.'),                                  -- confirm
    ('Photo Shoot with Thomas Williams', 'A photo shoot with Thomas Williams.'),                                        -- confirm: length, number of photos
    ('The Melting Pot', 'A gift from The Melting Pot, the fondue restaurant.'),                                         -- confirm: gift card or dinner?
    ('Me Gente Car Shop', 'A service from Me Gente Car Shop.'),                                                         -- confirm: what is included
    ('Fallen Heroes Tattoos', 'A tattoo session at Fallen Heroes Tattoo & Piercing.'),                                  -- confirm
    ('Car Detailing', 'A car detailing from CRM Cleaning.'),                                                            -- confirm
    ('House Cleaning', 'A house cleaning from CRM Cleaning.'),                                                          -- confirm: size of home / hours
    -- art, plants and food
    ('Original Painting (2-piece)', 'An original two-piece painting.'),
    ('Alaskan Gold Dust', 'Gold dust from Alaska.'),                                                                    -- confirm
    ('Autumn Plants', 'Autumn plants to brighten your porch or table.'),                                                -- confirm
    ('Pie A', 'A homemade pie from Brenda''s sister.'),                                                                 -- confirm: flavor
    ('Pie B', 'A homemade pie from Brenda''s sister.'),                                                                 -- confirm: flavor
    ('Pie C', 'A homemade pie from Brenda''s sister.'),                                                                 -- confirm: flavor
    ('Pumpkin Bread', 'A loaf of homemade pumpkin bread.'),                                                             -- confirm
    ('Banana Bread', 'A loaf of homemade banana bread.'),                                                               -- confirm
    -- baskets (contents not known: confirm what is in each)
    ('Think Pink Basket', 'A pink-themed gift basket.'),
    ('Games Basket', 'A basket of games for the family.'),
    ('Tools Basket', 'A basket of tools.'),
    ('Ultimate Kids Basket', 'A basket full of fun for kids.'),
    ('Sophie''s Kitchen Basket', 'A basket of kitchen goodies.'),
    ('Coffee Basket', 'A basket for coffee lovers.'),
    ('Aroma Basket', 'A basket of aromas and scents for the home.'),
    ('Books Basket', 'A basket of books.'),
    ('Spa Basket', 'A basket for a relaxing spa night at home.')
  ) as v(t, d)
 where i.event_id = (select id from events order by created_at desc limit 1)
   and i.title = v.t
   and coalesce(i.description, '') in ('', 'BOGO');

-- Not drafted (nothing to go on from the title): "Aleka's Basket", "Leandra's Basket". Tell me what is in them and I'll add them.
-- To see what is still blank afterwards:
--   select item_number, title from auction_items where coalesce(description, '') = '' and status <> 'cancelled' order by item_number;
