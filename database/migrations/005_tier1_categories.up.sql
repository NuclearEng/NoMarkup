-- NoMarkup: Tier 1 Direct Adjacencies
-- 4 categories with subcategories and service types (3-level hierarchy)

-- ============================================================
-- AUTO REPAIR & MAINTENANCE
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Auto Repair & Maintenance', 'auto-repair', 1, 17, 'Vehicle repair, maintenance, and bodywork')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Engine & Transmission', 'auto-engine', 2, 1),
  ((SELECT id FROM cat), 'Brakes & Suspension', 'auto-brakes', 2, 2),
  ((SELECT id FROM cat), 'Tires & Wheels', 'auto-tires', 2, 3),
  ((SELECT id FROM cat), 'Body & Paint', 'auto-body', 2, 4),
  ((SELECT id FROM cat), 'Electrical Systems', 'auto-electrical', 2, 5);

-- Engine & Transmission service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'auto-engine')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Oil Change', 'auto-oil-change', 3, 1),
  ((SELECT id FROM sub), 'Engine Tune-Up', 'auto-engine-tuneup', 3, 2),
  ((SELECT id FROM sub), 'Transmission Repair', 'auto-transmission-repair', 3, 3),
  ((SELECT id FROM sub), 'Engine Rebuild', 'auto-engine-rebuild', 3, 4);

-- Brakes & Suspension service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'auto-brakes')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Brake Pad Replacement', 'auto-brake-pads', 3, 1),
  ((SELECT id FROM sub), 'Rotor Resurfacing', 'auto-rotor-resurface', 3, 2),
  ((SELECT id FROM sub), 'Shock & Strut Replacement', 'auto-shocks-struts', 3, 3),
  ((SELECT id FROM sub), 'Alignment', 'auto-alignment', 3, 4);

-- Tires & Wheels service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'auto-tires')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Tire Replacement', 'auto-tire-replace', 3, 1),
  ((SELECT id FROM sub), 'Tire Rotation & Balance', 'auto-tire-rotation', 3, 2),
  ((SELECT id FROM sub), 'Flat Tire Repair', 'auto-flat-repair', 3, 3);

-- Body & Paint service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'auto-body')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Dent Repair', 'auto-dent-repair', 3, 1),
  ((SELECT id FROM sub), 'Paint Touch-Up', 'auto-paint-touchup', 3, 2),
  ((SELECT id FROM sub), 'Full Body Repaint', 'auto-body-repaint', 3, 3),
  ((SELECT id FROM sub), 'Scratch Removal', 'auto-scratch-removal', 3, 4);

-- Electrical Systems service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'auto-electrical')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Battery Replacement', 'auto-battery-replace', 3, 1),
  ((SELECT id FROM sub), 'Alternator Repair', 'auto-alternator', 3, 2),
  ((SELECT id FROM sub), 'Starter Motor Repair', 'auto-starter-motor', 3, 3);

-- ============================================================
-- MOVING SERVICES
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Moving Services', 'moving', 1, 18, 'Local, long distance, packing, and specialty moving')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Local Moving', 'moving-local', 2, 1),
  ((SELECT id FROM cat), 'Long Distance', 'moving-long-distance', 2, 2),
  ((SELECT id FROM cat), 'Packing & Unpacking', 'moving-packing', 2, 3),
  ((SELECT id FROM cat), 'Storage', 'moving-storage', 2, 4),
  ((SELECT id FROM cat), 'Specialty Moving', 'moving-specialty', 2, 5);

-- Local Moving service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'moving-local')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Apartment Move', 'moving-apartment', 3, 1),
  ((SELECT id FROM sub), 'House Move', 'moving-house', 3, 2),
  ((SELECT id FROM sub), 'Office Move', 'moving-office', 3, 3);

-- Long Distance service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'moving-long-distance')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Interstate Move', 'moving-interstate', 3, 1),
  ((SELECT id FROM sub), 'Cross-Country Move', 'moving-cross-country', 3, 2),
  ((SELECT id FROM sub), 'Vehicle Shipping', 'moving-vehicle-ship', 3, 3);

-- Packing & Unpacking service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'moving-packing')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Full Packing Service', 'moving-full-pack', 3, 1),
  ((SELECT id FROM sub), 'Partial Packing', 'moving-partial-pack', 3, 2),
  ((SELECT id FROM sub), 'Unpacking Service', 'moving-unpack', 3, 3),
  ((SELECT id FROM sub), 'Packing Supplies', 'moving-supplies', 3, 4);

-- Storage service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'moving-storage')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Short-Term Storage', 'moving-short-storage', 3, 1),
  ((SELECT id FROM sub), 'Long-Term Storage', 'moving-long-storage', 3, 2),
  ((SELECT id FROM sub), 'Climate-Controlled Storage', 'moving-climate-storage', 3, 3);

-- Specialty Moving service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'moving-specialty')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Piano Moving', 'moving-piano', 3, 1),
  ((SELECT id FROM sub), 'Hot Tub Moving', 'moving-hot-tub', 3, 2),
  ((SELECT id FROM sub), 'Antique & Art Moving', 'moving-antique-art', 3, 3),
  ((SELECT id FROM sub), 'Gun Safe Moving', 'moving-gun-safe', 3, 4);

-- ============================================================
-- PET SERVICES
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Pet Services', 'pet-services', 1, 19, 'Grooming, sitting, walking, training, and veterinary')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Grooming', 'pet-grooming', 2, 1),
  ((SELECT id FROM cat), 'Pet Sitting', 'pet-sitting', 2, 2),
  ((SELECT id FROM cat), 'Dog Walking', 'pet-dog-walking', 2, 3),
  ((SELECT id FROM cat), 'Training', 'pet-training', 2, 4),
  ((SELECT id FROM cat), 'Veterinary', 'pet-veterinary', 2, 5);

-- Grooming service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'pet-grooming')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Dog Grooming', 'pet-dog-grooming', 3, 1),
  ((SELECT id FROM sub), 'Cat Grooming', 'pet-cat-grooming', 3, 2),
  ((SELECT id FROM sub), 'Nail Trimming', 'pet-nail-trim', 3, 3),
  ((SELECT id FROM sub), 'De-Shedding Treatment', 'pet-deshedding', 3, 4);

-- Pet Sitting service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'pet-sitting')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'In-Home Pet Sitting', 'pet-in-home-sit', 3, 1),
  ((SELECT id FROM sub), 'Overnight Boarding', 'pet-overnight-board', 3, 2),
  ((SELECT id FROM sub), 'Drop-In Visits', 'pet-drop-in', 3, 3);

-- Dog Walking service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'pet-dog-walking')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Daily Dog Walking', 'pet-daily-walk', 3, 1),
  ((SELECT id FROM sub), 'Group Dog Walking', 'pet-group-walk', 3, 2),
  ((SELECT id FROM sub), 'Puppy Walking', 'pet-puppy-walk', 3, 3);

-- Training service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'pet-training')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Obedience Training', 'pet-obedience', 3, 1),
  ((SELECT id FROM sub), 'Puppy Training', 'pet-puppy-training', 3, 2),
  ((SELECT id FROM sub), 'Behavioral Training', 'pet-behavior-training', 3, 3),
  ((SELECT id FROM sub), 'Agility Training', 'pet-agility', 3, 4);

-- Veterinary service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'pet-veterinary')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Wellness Checkup', 'pet-wellness-check', 3, 1),
  ((SELECT id FROM sub), 'Vaccinations', 'pet-vaccinations', 3, 2),
  ((SELECT id FROM sub), 'Dental Cleaning', 'pet-dental-clean', 3, 3);

-- ============================================================
-- COMMERCIAL CLEANING
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Commercial Cleaning', 'commercial-cleaning', 1, 20, 'Office, retail, industrial, and specialized cleaning')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Office Cleaning', 'comclean-office', 2, 1),
  ((SELECT id FROM cat), 'Retail Cleaning', 'comclean-retail', 2, 2),
  ((SELECT id FROM cat), 'Industrial Cleaning', 'comclean-industrial', 2, 3),
  ((SELECT id FROM cat), 'Post-Construction', 'comclean-post-construction', 2, 4),
  ((SELECT id FROM cat), 'Specialized', 'comclean-specialized', 2, 5);

-- Office Cleaning service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comclean-office')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Daily Office Cleaning', 'comclean-daily-office', 3, 1),
  ((SELECT id FROM sub), 'Carpet & Upholstery Cleaning', 'comclean-carpet-upholstery', 3, 2),
  ((SELECT id FROM sub), 'Restroom Sanitization', 'comclean-restroom', 3, 3),
  ((SELECT id FROM sub), 'Window Cleaning', 'comclean-window', 3, 4);

-- Retail Cleaning service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comclean-retail')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Storefront Cleaning', 'comclean-storefront', 3, 1),
  ((SELECT id FROM sub), 'Floor Maintenance', 'comclean-floor-maint', 3, 2),
  ((SELECT id FROM sub), 'Display Case Cleaning', 'comclean-display', 3, 3);

-- Industrial Cleaning service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comclean-industrial')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Warehouse Cleaning', 'comclean-warehouse', 3, 1),
  ((SELECT id FROM sub), 'Equipment Degreasing', 'comclean-degreasing', 3, 2),
  ((SELECT id FROM sub), 'Pressure Washing', 'comclean-pressure-wash', 3, 3);

-- Post-Construction service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comclean-post-construction')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Rough Clean', 'comclean-rough-clean', 3, 1),
  ((SELECT id FROM sub), 'Final Clean', 'comclean-final-clean', 3, 2),
  ((SELECT id FROM sub), 'Debris Removal', 'comclean-debris', 3, 3),
  ((SELECT id FROM sub), 'Touch-Up Clean', 'comclean-touchup', 3, 4);

-- Specialized service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comclean-specialized')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Medical Facility Cleaning', 'comclean-medical', 3, 1),
  ((SELECT id FROM sub), 'Data Center Cleaning', 'comclean-data-center', 3, 2),
  ((SELECT id FROM sub), 'Kitchen & Exhaust Cleaning', 'comclean-kitchen-exhaust', 3, 3);
