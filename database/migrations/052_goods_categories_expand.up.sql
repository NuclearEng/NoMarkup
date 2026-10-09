-- Expand the Goods taxonomy to mirror Facebook Marketplace's category tree.
-- Adds new level-2 goods categories (children of the existing 'goods' root from
-- migration 036) plus their level-3 subcategories. Also lands `goods-baby-kids`,
-- which the web UI (ListingPostingForm/ListingFilters) already referenced but
-- migration 036 never seeded — closing that SQL/TS sync gap.
--
-- All inserts are idempotent (ON CONFLICT (slug) DO NOTHING). is_goods=true so
-- the /marketplace filters pick these up. Down migration deletes them by slug.

WITH goods_root AS (SELECT id FROM service_categories WHERE slug = 'goods' AND level = 1)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods, description)
SELECT goods_root.id, v.name, v.slug, 2, v.sort_order, true, v.description
  FROM goods_root,
       (VALUES
           ('Baby & Kids', 'goods-baby-kids', 11, 'Baby & Kids — goods marketplace category'),
           ('Property Rentals', 'goods-property-rentals', 12, 'Property Rentals — goods marketplace category'),
           ('Property For Sale', 'goods-property-for-sale', 13, 'Property For Sale — goods marketplace category'),
           ('Free Stuff', 'goods-free-stuff', 14, 'Free Stuff — goods marketplace category'),
           ('Apparel', 'goods-apparel', 15, 'Apparel — goods marketplace category'),
           ('Bags & Luggage', 'goods-bags-luggage', 16, 'Bags & Luggage — goods marketplace category'),
           ('Jewelry & Watches', 'goods-jewelry-watches', 17, 'Jewelry & Watches — goods marketplace category'),
           ('Health & Beauty', 'goods-health-beauty', 18, 'Health & Beauty — goods marketplace category'),
           ('Cell Phones & Accessories', 'goods-cell-phones', 19, 'Cell Phones & Accessories — goods marketplace category'),
           ('Computers & Accessories', 'goods-computers', 20, 'Computers & Accessories — goods marketplace category'),
           ('Cameras & Photo', 'goods-cameras-photo', 21, 'Cameras & Photo — goods marketplace category'),
           ('TVs & Video', 'goods-tvs-video', 22, 'TVs & Video — goods marketplace category'),
           ('Audio Equipment', 'goods-audio', 23, 'Audio Equipment — goods marketplace category'),
           ('Video Games & Consoles', 'goods-video-games', 24, 'Video Games & Consoles — goods marketplace category'),
           ('Entertainment', 'goods-entertainment', 25, 'Entertainment — goods marketplace category'),
           ('Musical Instruments', 'goods-musical-instruments', 26, 'Musical Instruments — goods marketplace category'),
           ('Major Appliances', 'goods-major-appliances', 27, 'Major Appliances — goods marketplace category'),
           ('Small Appliances', 'goods-small-appliances', 28, 'Small Appliances — goods marketplace category'),
           ('Home Improvement', 'goods-home-improvement', 29, 'Home Improvement — goods marketplace category'),
           ('Home Goods', 'goods-home-goods', 30, 'Home Goods — goods marketplace category'),
           ('Office Supplies', 'goods-office-supplies', 31, 'Office Supplies — goods marketplace category'),
           ('Pet Supplies', 'goods-pet-supplies', 32, 'Pet Supplies — goods marketplace category'),
           ('Toys & Games', 'goods-toys-games', 33, 'Toys & Games — goods marketplace category'),
           ('Arts & Crafts', 'goods-arts-crafts', 34, 'Arts & Crafts — goods marketplace category'),
           ('Antiques & Collectibles', 'goods-antiques', 35, 'Antiques & Collectibles — goods marketplace category'),
           ('Hobbies', 'goods-hobbies', 36, 'Hobbies — goods marketplace category'),
           ('Family', 'goods-family', 37, 'Family — goods marketplace category'),
           ('Auto Parts & Accessories', 'goods-auto-parts', 38, 'Auto Parts & Accessories — goods marketplace category'),
           ('Classifieds & Misc', 'goods-classifieds', 39, 'Classifieds & Misc — goods marketplace category')
       ) AS v(name, slug, sort_order, description)
ON CONFLICT (slug) DO NOTHING;

-- Level-3 subcategories, one block per parent goods category.

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-baby-kids')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Strollers & Car Seats', 'goods-baby-kids-strollers-and-car-seats', 1),
  ('Cribs & Nursery', 'goods-baby-kids-cribs-and-nursery', 2),
  ('Baby Clothing', 'goods-baby-kids-baby-clothing', 3),
  ('Toys', 'goods-baby-kids-toys', 4),
  ('Feeding', 'goods-baby-kids-feeding', 5),
  ('Baby Gear', 'goods-baby-kids-baby-gear', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-property-rentals')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Apartments for Rent', 'goods-property-rentals-apartments-for-rent', 1),
  ('Houses for Rent', 'goods-property-rentals-houses-for-rent', 2),
  ('Rooms for Rent', 'goods-property-rentals-rooms-for-rent', 3),
  ('Sublets & Temporary', 'goods-property-rentals-sublets-and-temporary', 4),
  ('Vacation Rentals', 'goods-property-rentals-vacation-rentals', 5),
  ('Commercial & Office Space', 'goods-property-rentals-commercial-and-office-space', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-property-for-sale')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Houses for Sale', 'goods-property-for-sale-houses-for-sale', 1),
  ('Land for Sale', 'goods-property-for-sale-land-for-sale', 2),
  ('Apartments & Condos for Sale', 'goods-property-for-sale-apartments-and-condos-for-sale', 3),
  ('Manufactured Homes', 'goods-property-for-sale-manufactured-homes', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-free-stuff')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Free Furniture', 'goods-free-stuff-free-furniture', 1),
  ('Free Electronics', 'goods-free-stuff-free-electronics', 2),
  ('Free Household Items', 'goods-free-stuff-free-household-items', 3),
  ('Free Building Materials', 'goods-free-stuff-free-building-materials', 4),
  ('Free Yard Waste & Firewood', 'goods-free-stuff-free-yard-waste-and-firewood', 5),
  ('Free Pet Supplies', 'goods-free-stuff-free-pet-supplies', 6),
  ('Curb Alert', 'goods-free-stuff-curb-alert', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-apparel')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Women''s Clothing', 'goods-apparel-women-s-clothing', 1),
  ('Men''s Clothing', 'goods-apparel-men-s-clothing', 2),
  ('Women''s Shoes', 'goods-apparel-women-s-shoes', 3),
  ('Men''s Shoes', 'goods-apparel-men-s-shoes', 4),
  ('Bags & Luggage', 'goods-apparel-bags-and-luggage', 5),
  ('Jewelry & Watches', 'goods-apparel-jewelry-and-watches', 6),
  ('Women''s Accessories', 'goods-apparel-women-s-accessories', 7),
  ('Men''s Accessories', 'goods-apparel-men-s-accessories', 8),
  ('Kids'' Clothing', 'goods-apparel-kids-clothing', 9),
  ('Costumes', 'goods-apparel-costumes', 10)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-bags-luggage')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Handbags & Purses', 'goods-bags-luggage-handbags-and-purses', 1),
  ('Backpacks', 'goods-bags-luggage-backpacks', 2),
  ('Suitcases & Travel Luggage', 'goods-bags-luggage-suitcases-and-travel-luggage', 3),
  ('Duffel Bags', 'goods-bags-luggage-duffel-bags', 4),
  ('Wallets', 'goods-bags-luggage-wallets', 5),
  ('Briefcases', 'goods-bags-luggage-briefcases', 6),
  ('Diaper Bags', 'goods-bags-luggage-diaper-bags', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-jewelry-watches')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Watches', 'goods-jewelry-watches-watches', 1),
  ('Rings', 'goods-jewelry-watches-rings', 2),
  ('Necklaces', 'goods-jewelry-watches-necklaces', 3),
  ('Earrings', 'goods-jewelry-watches-earrings', 4),
  ('Bracelets', 'goods-jewelry-watches-bracelets', 5),
  ('Fine Jewelry', 'goods-jewelry-watches-fine-jewelry', 6),
  ('Fashion Jewelry', 'goods-jewelry-watches-fashion-jewelry', 7),
  ('Loose Gemstones', 'goods-jewelry-watches-loose-gemstones', 8),
  ('Jewelry Boxes', 'goods-jewelry-watches-jewelry-boxes', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-health-beauty')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Makeup & Cosmetics', 'goods-health-beauty-makeup-and-cosmetics', 1),
  ('Skincare', 'goods-health-beauty-skincare', 2),
  ('Hair Care & Styling Tools', 'goods-health-beauty-hair-care-and-styling-tools', 3),
  ('Fragrances & Perfume', 'goods-health-beauty-fragrances-and-perfume', 4),
  ('Nail Care', 'goods-health-beauty-nail-care', 5),
  ('Health Care & Supplements', 'goods-health-beauty-health-care-and-supplements', 6),
  ('Personal Care Appliances', 'goods-health-beauty-personal-care-appliances', 7),
  ('Massage & Relaxation', 'goods-health-beauty-massage-and-relaxation', 8),
  ('Bath & Body', 'goods-health-beauty-bath-and-body', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-cell-phones')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Smartphones', 'goods-cell-phones-smartphones', 1),
  ('Cell Phone Cases & Covers', 'goods-cell-phones-cell-phone-cases-and-covers', 2),
  ('Chargers & Cables', 'goods-cell-phones-chargers-and-cables', 3),
  ('Screen Protectors', 'goods-cell-phones-screen-protectors', 4),
  ('Smartwatches', 'goods-cell-phones-smartwatches', 5),
  ('Phone Accessories', 'goods-cell-phones-phone-accessories', 6),
  ('Prepaid Phones & SIM Cards', 'goods-cell-phones-prepaid-phones-and-sim-cards', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-computers')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Laptops', 'goods-computers-laptops', 1),
  ('Desktop Computers', 'goods-computers-desktop-computers', 2),
  ('Computer Monitors', 'goods-computers-computer-monitors', 3),
  ('Keyboards & Mice', 'goods-computers-keyboards-and-mice', 4),
  ('Printers & Scanners', 'goods-computers-printers-and-scanners', 5),
  ('Computer Components', 'goods-computers-computer-components', 6),
  ('Networking & Routers', 'goods-computers-networking-and-routers', 7),
  ('External Drives & Storage', 'goods-computers-external-drives-and-storage', 8),
  ('Tablets', 'goods-computers-tablets', 9),
  ('Webcams', 'goods-computers-webcams', 10),
  ('Software', 'goods-computers-software', 11)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-cameras-photo')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Digital Cameras', 'goods-cameras-photo-digital-cameras', 1),
  ('DSLR & Mirrorless Cameras', 'goods-cameras-photo-dslr-and-mirrorless-cameras', 2),
  ('Camera Lenses', 'goods-cameras-photo-camera-lenses', 3),
  ('Camcorders', 'goods-cameras-photo-camcorders', 4),
  ('Drones', 'goods-cameras-photo-drones', 5),
  ('Tripods & Supports', 'goods-cameras-photo-tripods-and-supports', 6),
  ('Camera Flashes & Lighting', 'goods-cameras-photo-camera-flashes-and-lighting', 7),
  ('Film Cameras', 'goods-cameras-photo-film-cameras', 8),
  ('Camera Accessories', 'goods-cameras-photo-camera-accessories', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-tvs-video')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Televisions', 'goods-tvs-video-televisions', 1),
  ('TV Mounts & Stands', 'goods-tvs-video-tv-mounts-and-stands', 2),
  ('Streaming Devices', 'goods-tvs-video-streaming-devices', 3),
  ('Projectors', 'goods-tvs-video-projectors', 4),
  ('Blu-ray & DVD Players', 'goods-tvs-video-blu-ray-and-dvd-players', 5),
  ('Home Theater Systems', 'goods-tvs-video-home-theater-systems', 6),
  ('Soundbars', 'goods-tvs-video-soundbars', 7),
  ('Cables & Connectors', 'goods-tvs-video-cables-and-connectors', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-audio')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Headphones & Earbuds', 'goods-audio-headphones-and-earbuds', 1),
  ('Speakers', 'goods-audio-speakers', 2),
  ('Home Audio Receivers', 'goods-audio-home-audio-receivers', 3),
  ('Turntables & Vinyl Players', 'goods-audio-turntables-and-vinyl-players', 4),
  ('Microphones', 'goods-audio-microphones', 5),
  ('Car Audio', 'goods-audio-car-audio', 6),
  ('Amplifiers', 'goods-audio-amplifiers', 7),
  ('DJ Equipment', 'goods-audio-dj-equipment', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-video-games')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Video Game Consoles', 'goods-video-games-video-game-consoles', 1),
  ('Video Games', 'goods-video-games-video-games', 2),
  ('Controllers & Accessories', 'goods-video-games-controllers-and-accessories', 3),
  ('VR Headsets', 'goods-video-games-vr-headsets', 4),
  ('Handheld Consoles', 'goods-video-games-handheld-consoles', 5),
  ('Retro & Vintage Gaming', 'goods-video-games-retro-and-vintage-gaming', 6),
  ('Gaming Headsets', 'goods-video-games-gaming-headsets', 7),
  ('Gaming Chairs', 'goods-video-games-gaming-chairs', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-entertainment')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Movies & DVDs', 'goods-entertainment-movies-and-dvds', 1),
  ('Music CDs & Vinyl', 'goods-entertainment-music-cds-and-vinyl', 2),
  ('Books', 'goods-entertainment-books', 3),
  ('Concert & Event Tickets', 'goods-entertainment-concert-and-event-tickets', 4),
  ('Board Games & Puzzles', 'goods-entertainment-board-games-and-puzzles', 5),
  ('Trading Cards', 'goods-entertainment-trading-cards', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-musical-instruments')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Guitars', 'goods-musical-instruments-guitars', 1),
  ('Pianos & Keyboards', 'goods-musical-instruments-pianos-and-keyboards', 2),
  ('Drums & Percussion', 'goods-musical-instruments-drums-and-percussion', 3),
  ('Brass & Woodwind Instruments', 'goods-musical-instruments-brass-and-woodwind-instruments', 4),
  ('String Instruments', 'goods-musical-instruments-string-instruments', 5),
  ('DJ & Recording Equipment', 'goods-musical-instruments-dj-and-recording-equipment', 6),
  ('Amplifiers & Effects', 'goods-musical-instruments-amplifiers-and-effects', 7),
  ('Instrument Accessories', 'goods-musical-instruments-instrument-accessories', 8),
  ('Sheet Music', 'goods-musical-instruments-sheet-music', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-major-appliances')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Refrigerators & Freezers', 'goods-major-appliances-refrigerators-and-freezers', 1),
  ('Washers & Dryers', 'goods-major-appliances-washers-and-dryers', 2),
  ('Dishwashers', 'goods-major-appliances-dishwashers', 3),
  ('Ovens, Ranges & Stoves', 'goods-major-appliances-ovens-ranges-and-stoves', 4),
  ('Microwaves', 'goods-major-appliances-microwaves', 5),
  ('Air Conditioners', 'goods-major-appliances-air-conditioners', 6),
  ('Water Heaters', 'goods-major-appliances-water-heaters', 7),
  ('Range Hoods', 'goods-major-appliances-range-hoods', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-small-appliances')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Coffee Makers', 'goods-small-appliances-coffee-makers', 1),
  ('Blenders & Juicers', 'goods-small-appliances-blenders-and-juicers', 2),
  ('Toasters & Toaster Ovens', 'goods-small-appliances-toasters-and-toaster-ovens', 3),
  ('Air Fryers', 'goods-small-appliances-air-fryers', 4),
  ('Vacuum Cleaners', 'goods-small-appliances-vacuum-cleaners', 5),
  ('Slow Cookers & Pressure Cookers', 'goods-small-appliances-slow-cookers-and-pressure-cookers', 6),
  ('Stand & Hand Mixers', 'goods-small-appliances-stand-and-hand-mixers', 7),
  ('Space Heaters', 'goods-small-appliances-space-heaters', 8),
  ('Fans', 'goods-small-appliances-fans', 9),
  ('Humidifiers & Dehumidifiers', 'goods-small-appliances-humidifiers-and-dehumidifiers', 10)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-home-improvement')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Building Materials & Lumber', 'goods-home-improvement-building-materials-and-lumber', 1),
  ('Plumbing Fixtures', 'goods-home-improvement-plumbing-fixtures', 2),
  ('Electrical & Lighting', 'goods-home-improvement-electrical-and-lighting', 3),
  ('Doors & Windows', 'goods-home-improvement-doors-and-windows', 4),
  ('Flooring & Tile', 'goods-home-improvement-flooring-and-tile', 5),
  ('Paint & Supplies', 'goods-home-improvement-paint-and-supplies', 6),
  ('Kitchen & Bath Fixtures', 'goods-home-improvement-kitchen-and-bath-fixtures', 7),
  ('Hardware & Fasteners', 'goods-home-improvement-hardware-and-fasteners', 8),
  ('Heating & Cooling', 'goods-home-improvement-heating-and-cooling', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-home-goods')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Kitchen & Dining', 'goods-home-goods-kitchen-and-dining', 1),
  ('Bedding & Linens', 'goods-home-goods-bedding-and-linens', 2),
  ('Bath', 'goods-home-goods-bath', 3),
  ('Home Decor', 'goods-home-goods-home-decor', 4),
  ('Rugs', 'goods-home-goods-rugs', 5),
  ('Curtains & Window Treatments', 'goods-home-goods-curtains-and-window-treatments', 6),
  ('Lamps & Lighting', 'goods-home-goods-lamps-and-lighting', 7),
  ('Storage & Organization', 'goods-home-goods-storage-and-organization', 8),
  ('Wall Art & Mirrors', 'goods-home-goods-wall-art-and-mirrors', 9),
  ('Clocks', 'goods-home-goods-clocks', 10),
  ('Candles & Home Fragrance', 'goods-home-goods-candles-and-home-fragrance', 11),
  ('Tableware & Dishes', 'goods-home-goods-tableware-and-dishes', 12)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-office-supplies')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Office Furniture', 'goods-office-supplies-office-furniture', 1),
  ('Desks & Chairs', 'goods-office-supplies-desks-and-chairs', 2),
  ('Filing & Storage', 'goods-office-supplies-filing-and-storage', 3),
  ('Printers & Ink', 'goods-office-supplies-printers-and-ink', 4),
  ('Office Electronics', 'goods-office-supplies-office-electronics', 5),
  ('Stationery & Paper', 'goods-office-supplies-stationery-and-paper', 6),
  ('Whiteboards & Boards', 'goods-office-supplies-whiteboards-and-boards', 7),
  ('Shredders & Laminators', 'goods-office-supplies-shredders-and-laminators', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-pet-supplies')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Dog Supplies', 'goods-pet-supplies-dog-supplies', 1),
  ('Cat Supplies', 'goods-pet-supplies-cat-supplies', 2),
  ('Aquariums & Fish Supplies', 'goods-pet-supplies-aquariums-and-fish-supplies', 3),
  ('Bird Supplies', 'goods-pet-supplies-bird-supplies', 4),
  ('Small Animal & Reptile Supplies', 'goods-pet-supplies-small-animal-and-reptile-supplies', 5),
  ('Pet Crates & Carriers', 'goods-pet-supplies-pet-crates-and-carriers', 6),
  ('Pet Beds', 'goods-pet-supplies-pet-beds', 7),
  ('Pet Food & Treats', 'goods-pet-supplies-pet-food-and-treats', 8),
  ('Pet Grooming', 'goods-pet-supplies-pet-grooming', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-toys-games')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Action Figures', 'goods-toys-games-action-figures', 1),
  ('Dolls & Stuffed Animals', 'goods-toys-games-dolls-and-stuffed-animals', 2),
  ('Building Sets & Blocks', 'goods-toys-games-building-sets-and-blocks', 3),
  ('Board Games & Puzzles', 'goods-toys-games-board-games-and-puzzles', 4),
  ('Educational Toys', 'goods-toys-games-educational-toys', 5),
  ('Outdoor & Ride-On Toys', 'goods-toys-games-outdoor-and-ride-on-toys', 6),
  ('RC & Drones', 'goods-toys-games-rc-and-drones', 7),
  ('Puzzles', 'goods-toys-games-puzzles', 8),
  ('Card Games', 'goods-toys-games-card-games', 9),
  ('Pretend Play', 'goods-toys-games-pretend-play', 10)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-arts-crafts')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Craft Supplies', 'goods-arts-crafts-craft-supplies', 1),
  ('Sewing & Fabric', 'goods-arts-crafts-sewing-and-fabric', 2),
  ('Knitting & Yarn', 'goods-arts-crafts-knitting-and-yarn', 3),
  ('Beads & Jewelry Making', 'goods-arts-crafts-beads-and-jewelry-making', 4),
  ('Painting & Drawing Supplies', 'goods-arts-crafts-painting-and-drawing-supplies', 5),
  ('Scrapbooking', 'goods-arts-crafts-scrapbooking', 6),
  ('Sewing Machines', 'goods-arts-crafts-sewing-machines', 7),
  ('Art Easels & Canvas', 'goods-arts-crafts-art-easels-and-canvas', 8)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-antiques')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Antique Furniture', 'goods-antiques-antique-furniture', 1),
  ('Coins & Currency', 'goods-antiques-coins-and-currency', 2),
  ('Stamps', 'goods-antiques-stamps', 3),
  ('Vintage & Retro Items', 'goods-antiques-vintage-and-retro-items', 4),
  ('Memorabilia', 'goods-antiques-memorabilia', 5),
  ('Trading Cards', 'goods-antiques-trading-cards', 6),
  ('Comic Books', 'goods-antiques-comic-books', 7),
  ('Vinyl Records', 'goods-antiques-vinyl-records', 8),
  ('Figurines & Statues', 'goods-antiques-figurines-and-statues', 9),
  ('Vintage Toys', 'goods-antiques-vintage-toys', 10),
  ('Militaria', 'goods-antiques-militaria', 11)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-hobbies')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Models & Kits', 'goods-hobbies-models-and-kits', 1),
  ('Trains & Railroads', 'goods-hobbies-trains-and-railroads', 2),
  ('RC Vehicles', 'goods-hobbies-rc-vehicles', 3),
  ('Drones', 'goods-hobbies-drones', 4),
  ('Fishing', 'goods-hobbies-fishing', 5),
  ('Hunting', 'goods-hobbies-hunting', 6),
  ('Camping & Hiking', 'goods-hobbies-camping-and-hiking', 7),
  ('Telescopes & Binoculars', 'goods-hobbies-telescopes-and-binoculars', 8),
  ('Metal Detecting', 'goods-hobbies-metal-detecting', 9),
  ('Coin & Stamp Collecting', 'goods-hobbies-coin-and-stamp-collecting', 10)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-family')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Maternity & Pregnancy', 'goods-family-maternity-and-pregnancy', 1),
  ('Health & Personal Care', 'goods-family-health-and-personal-care', 2),
  ('Diapering & Potty', 'goods-family-diapering-and-potty', 3),
  ('Feeding & Nursing', 'goods-family-feeding-and-nursing', 4),
  ('Baby Safety', 'goods-family-baby-safety', 5),
  ('Childcare & Education', 'goods-family-childcare-and-education', 6),
  ('Parenting Essentials', 'goods-family-parenting-essentials', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-auto-parts')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Car & Truck Parts', 'goods-auto-parts-car-and-truck-parts', 1),
  ('Tires & Wheels', 'goods-auto-parts-tires-and-wheels', 2),
  ('Car Electronics & GPS', 'goods-auto-parts-car-electronics-and-gps', 3),
  ('Car Audio', 'goods-auto-parts-car-audio', 4),
  ('Interior Accessories', 'goods-auto-parts-interior-accessories', 5),
  ('Exterior Accessories', 'goods-auto-parts-exterior-accessories', 6),
  ('Tools & Garage Equipment', 'goods-auto-parts-tools-and-garage-equipment', 7),
  ('Motorcycle Parts', 'goods-auto-parts-motorcycle-parts', 8),
  ('Performance Parts', 'goods-auto-parts-performance-parts', 9),
  ('Car Care', 'goods-auto-parts-car-care', 10)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'goods-classifieds')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT sub.id, v.name, v.slug, 3, v.sort_order, true FROM sub, (VALUES
  ('Garage & Estate Sales', 'goods-classifieds-garage-and-estate-sales', 1),
  ('Lost & Found', 'goods-classifieds-lost-and-found', 2),
  ('General Items', 'goods-classifieds-general-items', 3),
  ('Wanted Items', 'goods-classifieds-wanted-items', 4),
  ('Tickets', 'goods-classifieds-tickets', 5),
  ('Gift Cards', 'goods-classifieds-gift-cards', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;
