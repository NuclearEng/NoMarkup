-- NoMarkup: Seed service taxonomy
-- 16 categories with subcategories and service types (3-level hierarchy)

-- ============================================================
-- HVAC
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('HVAC', 'hvac', 1, 1, 'Heating, ventilation, and air conditioning')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Heating', 'hvac-heating', 2, 1),
  ((SELECT id FROM cat), 'Cooling', 'hvac-cooling', 2, 2),
  ((SELECT id FROM cat), 'Ventilation', 'hvac-ventilation', 2, 3),
  ((SELECT id FROM cat), 'Ductwork', 'hvac-ductwork', 2, 4);

-- Heating service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'hvac-heating')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Furnace Installation', 'hvac-furnace-install', 3, 1),
  ((SELECT id FROM sub), 'Furnace Repair', 'hvac-furnace-repair', 3, 2),
  ((SELECT id FROM sub), 'Heat Pump Installation', 'hvac-heat-pump-install', 3, 3),
  ((SELECT id FROM sub), 'Heat Pump Repair', 'hvac-heat-pump-repair', 3, 4),
  ((SELECT id FROM sub), 'Boiler Installation', 'hvac-boiler-install', 3, 5),
  ((SELECT id FROM sub), 'Boiler Repair', 'hvac-boiler-repair', 3, 6),
  ((SELECT id FROM sub), 'Thermostat Installation', 'hvac-thermostat-install', 3, 7),
  ((SELECT id FROM sub), 'Radiant Floor Heating', 'hvac-radiant-floor', 3, 8);

-- Cooling service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'hvac-cooling')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'AC Installation', 'hvac-ac-install', 3, 1),
  ((SELECT id FROM sub), 'AC Repair', 'hvac-ac-repair', 3, 2),
  ((SELECT id FROM sub), 'AC Maintenance', 'hvac-ac-maintenance', 3, 3),
  ((SELECT id FROM sub), 'Mini-Split Installation', 'hvac-mini-split-install', 3, 4),
  ((SELECT id FROM sub), 'Evaporative Cooler', 'hvac-evap-cooler', 3, 5);

-- Ventilation service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'hvac-ventilation')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Bathroom Fan Installation', 'hvac-bath-fan-install', 3, 1),
  ((SELECT id FROM sub), 'Range Hood Installation', 'hvac-range-hood-install', 3, 2),
  ((SELECT id FROM sub), 'Whole-House Fan', 'hvac-whole-house-fan', 3, 3),
  ((SELECT id FROM sub), 'Attic Ventilation', 'hvac-attic-vent', 3, 4);

-- Ductwork service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'hvac-ductwork')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Duct Cleaning', 'hvac-duct-cleaning', 3, 1),
  ((SELECT id FROM sub), 'Duct Repair', 'hvac-duct-repair', 3, 2),
  ((SELECT id FROM sub), 'Duct Installation', 'hvac-duct-install', 3, 3),
  ((SELECT id FROM sub), 'Duct Sealing', 'hvac-duct-sealing', 3, 4);

-- ============================================================
-- PLUMBING
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Plumbing', 'plumbing', 1, 2, 'Pipes, fixtures, water heaters, and drains')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Pipes', 'plumbing-pipes', 2, 1),
  ((SELECT id FROM cat), 'Fixtures', 'plumbing-fixtures', 2, 2),
  ((SELECT id FROM cat), 'Water Heaters', 'plumbing-water-heaters', 2, 3),
  ((SELECT id FROM cat), 'Drains', 'plumbing-drains', 2, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'plumbing-pipes')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Leak Repair', 'plumbing-leak-repair', 3, 1),
  ((SELECT id FROM sub), 'Pipe Replacement', 'plumbing-pipe-replacement', 3, 2),
  ((SELECT id FROM sub), 'Sewer Line Repair', 'plumbing-sewer-repair', 3, 3),
  ((SELECT id FROM sub), 'Pipe Insulation', 'plumbing-pipe-insulation', 3, 4),
  ((SELECT id FROM sub), 'Gas Line Installation', 'plumbing-gas-line', 3, 5);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'plumbing-fixtures')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Faucet Installation', 'plumbing-faucet-install', 3, 1),
  ((SELECT id FROM sub), 'Toilet Installation', 'plumbing-toilet-install', 3, 2),
  ((SELECT id FROM sub), 'Sink Installation', 'plumbing-sink-install', 3, 3),
  ((SELECT id FROM sub), 'Garbage Disposal', 'plumbing-disposal', 3, 4),
  ((SELECT id FROM sub), 'Shower/Tub Installation', 'plumbing-shower-install', 3, 5);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'plumbing-water-heaters')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Water Heater Installation', 'plumbing-wh-install', 3, 1),
  ((SELECT id FROM sub), 'Water Heater Repair', 'plumbing-wh-repair', 3, 2),
  ((SELECT id FROM sub), 'Tankless Water Heater', 'plumbing-tankless', 3, 3);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'plumbing-drains')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Drain Clearing', 'plumbing-drain-clearing', 3, 1),
  ((SELECT id FROM sub), 'Drain Camera Inspection', 'plumbing-drain-camera', 3, 2),
  ((SELECT id FROM sub), 'French Drain Installation', 'plumbing-french-drain', 3, 3);

-- ============================================================
-- ELECTRICAL
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Electrical', 'electrical', 1, 3, 'Wiring, panels, lighting, and outlets')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Wiring', 'electrical-wiring', 2, 1),
  ((SELECT id FROM cat), 'Panels', 'electrical-panels', 2, 2),
  ((SELECT id FROM cat), 'Lighting', 'electrical-lighting', 2, 3),
  ((SELECT id FROM cat), 'Outlets & Switches', 'electrical-outlets', 2, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'electrical-wiring')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Wiring Repair', 'electrical-wiring-repair', 3, 1),
  ((SELECT id FROM sub), 'Rewiring', 'electrical-rewiring', 3, 2),
  ((SELECT id FROM sub), 'EV Charger Installation', 'electrical-ev-charger', 3, 3),
  ((SELECT id FROM sub), 'Generator Installation', 'electrical-generator', 3, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'electrical-panels')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Panel Upgrade', 'electrical-panel-upgrade', 3, 1),
  ((SELECT id FROM sub), 'Breaker Replacement', 'electrical-breaker', 3, 2),
  ((SELECT id FROM sub), 'Sub-Panel Installation', 'electrical-sub-panel', 3, 3);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'electrical-lighting')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Light Fixture Installation', 'electrical-light-install', 3, 1),
  ((SELECT id FROM sub), 'Recessed Lighting', 'electrical-recessed', 3, 2),
  ((SELECT id FROM sub), 'Landscape Lighting', 'electrical-landscape-light', 3, 3),
  ((SELECT id FROM sub), 'Ceiling Fan Installation', 'electrical-ceiling-fan', 3, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'electrical-outlets')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Outlet Installation', 'electrical-outlet-install', 3, 1),
  ((SELECT id FROM sub), 'GFCI Outlet Installation', 'electrical-gfci', 3, 2),
  ((SELECT id FROM sub), 'Smart Switch Installation', 'electrical-smart-switch', 3, 3),
  ((SELECT id FROM sub), 'USB Outlet Installation', 'electrical-usb-outlet', 3, 4);

-- ============================================================
-- ROOFING
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Roofing', 'roofing', 1, 4, 'Roof repair, replacement, gutters, and inspection')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Repair', 'roofing-repair', 2, 1),
  ((SELECT id FROM cat), 'Replacement', 'roofing-replacement', 2, 2),
  ((SELECT id FROM cat), 'Gutters', 'roofing-gutters', 2, 3),
  ((SELECT id FROM cat), 'Inspection', 'roofing-inspection', 2, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'roofing-repair')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Roof Leak Repair', 'roofing-leak-repair', 3, 1),
  ((SELECT id FROM sub), 'Shingle Repair', 'roofing-shingle-repair', 3, 2),
  ((SELECT id FROM sub), 'Flat Roof Repair', 'roofing-flat-repair', 3, 3),
  ((SELECT id FROM sub), 'Flashing Repair', 'roofing-flashing', 3, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'roofing-replacement')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Full Roof Replacement', 'roofing-full-replace', 3, 1),
  ((SELECT id FROM sub), 'Partial Re-Roof', 'roofing-partial-replace', 3, 2),
  ((SELECT id FROM sub), 'Metal Roof Installation', 'roofing-metal', 3, 3);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'roofing-gutters')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Gutter Cleaning', 'roofing-gutter-clean', 3, 1),
  ((SELECT id FROM sub), 'Gutter Installation', 'roofing-gutter-install', 3, 2),
  ((SELECT id FROM sub), 'Gutter Guard Installation', 'roofing-gutter-guard', 3, 3),
  ((SELECT id FROM sub), 'Gutter Repair', 'roofing-gutter-repair', 3, 4);

WITH sub AS (SELECT id FROM service_categories WHERE slug = 'roofing-inspection')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Roof Inspection', 'roofing-inspect', 3, 1),
  ((SELECT id FROM sub), 'Drone Roof Survey', 'roofing-drone', 3, 2);

-- ============================================================
-- PAINTING, LANDSCAPING, CLEANING, FLOORING, PEST CONTROL,
-- APPLIANCE REPAIR, FENCING, CONCRETE & MASONRY,
-- WINDOWS & DOORS, GARAGE, GENERAL HANDYMAN, SECURITY
-- ============================================================
-- (Abbreviated: top-level + subcategories for remaining 12 categories)

-- PAINTING
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Painting', 'painting', 1, 5, 'Interior and exterior painting, staining, and prep work')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Interior', 'painting-interior', 2, 1),
  ((SELECT id FROM cat), 'Exterior', 'painting-exterior', 2, 2),
  ((SELECT id FROM cat), 'Staining', 'painting-staining', 2, 3),
  ((SELECT id FROM cat), 'Prep Work', 'painting-prep', 2, 4);

-- LANDSCAPING
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Landscaping', 'landscaping', 1, 6, 'Lawn care, tree service, hardscape, and irrigation')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Lawn Care', 'landscaping-lawn', 2, 1),
  ((SELECT id FROM cat), 'Tree Service', 'landscaping-tree', 2, 2),
  ((SELECT id FROM cat), 'Hardscape', 'landscaping-hardscape', 2, 3),
  ((SELECT id FROM cat), 'Irrigation', 'landscaping-irrigation', 2, 4);

-- CLEANING
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Cleaning', 'cleaning', 1, 7, 'Residential cleaning, deep clean, move-in/move-out, and windows')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Residential', 'cleaning-residential', 2, 1),
  ((SELECT id FROM cat), 'Deep Clean', 'cleaning-deep', 2, 2),
  ((SELECT id FROM cat), 'Move-In/Move-Out', 'cleaning-move', 2, 3),
  ((SELECT id FROM cat), 'Windows', 'cleaning-windows', 2, 4);

-- FLOORING
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Flooring', 'flooring', 1, 8, 'Hardwood, tile, carpet, and vinyl flooring')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Hardwood', 'flooring-hardwood', 2, 1),
  ((SELECT id FROM cat), 'Tile', 'flooring-tile', 2, 2),
  ((SELECT id FROM cat), 'Carpet', 'flooring-carpet', 2, 3),
  ((SELECT id FROM cat), 'Vinyl & Laminate', 'flooring-vinyl', 2, 4);

-- PEST CONTROL
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Pest Control', 'pest-control', 1, 9, 'Insects, rodents, wildlife, and prevention')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Insects', 'pest-insects', 2, 1),
  ((SELECT id FROM cat), 'Rodents', 'pest-rodents', 2, 2),
  ((SELECT id FROM cat), 'Wildlife', 'pest-wildlife', 2, 3),
  ((SELECT id FROM cat), 'Prevention', 'pest-prevention', 2, 4);

-- APPLIANCE REPAIR
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Appliance Repair', 'appliance-repair', 1, 10, 'Kitchen, laundry, and HVAC appliance repair')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Kitchen Appliances', 'appliance-kitchen', 2, 1),
  ((SELECT id FROM cat), 'Laundry Appliances', 'appliance-laundry', 2, 2),
  ((SELECT id FROM cat), 'HVAC Appliances', 'appliance-hvac', 2, 3);

-- FENCING
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Fencing', 'fencing', 1, 11, 'Wood, chain link, vinyl, and iron fencing')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Wood Fence', 'fencing-wood', 2, 1),
  ((SELECT id FROM cat), 'Chain Link', 'fencing-chain-link', 2, 2),
  ((SELECT id FROM cat), 'Vinyl Fence', 'fencing-vinyl', 2, 3),
  ((SELECT id FROM cat), 'Iron & Metal', 'fencing-iron', 2, 4);

-- CONCRETE & MASONRY
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Concrete & Masonry', 'concrete-masonry', 1, 12, 'Driveways, patios, foundations, and retaining walls')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Driveways', 'concrete-driveways', 2, 1),
  ((SELECT id FROM cat), 'Patios', 'concrete-patios', 2, 2),
  ((SELECT id FROM cat), 'Foundations', 'concrete-foundations', 2, 3),
  ((SELECT id FROM cat), 'Retaining Walls', 'concrete-retaining', 2, 4);

-- WINDOWS & DOORS
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Windows & Doors', 'windows-doors', 1, 13, 'Installation, repair, sealing, and screens')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Window Installation', 'wd-window-install', 2, 1),
  ((SELECT id FROM cat), 'Window Repair', 'wd-window-repair', 2, 2),
  ((SELECT id FROM cat), 'Door Installation', 'wd-door-install', 2, 3),
  ((SELECT id FROM cat), 'Screens & Sealing', 'wd-screens', 2, 4);

-- GARAGE
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Garage', 'garage', 1, 14, 'Doors, openers, organization, and flooring')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Garage Doors', 'garage-doors', 2, 1),
  ((SELECT id FROM cat), 'Openers', 'garage-openers', 2, 2),
  ((SELECT id FROM cat), 'Organization', 'garage-organization', 2, 3),
  ((SELECT id FROM cat), 'Flooring', 'garage-flooring', 2, 4);

-- GENERAL HANDYMAN
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('General Handyman', 'handyman', 1, 15, 'Minor repairs, assembly, mounting, and miscellaneous')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Minor Repairs', 'handyman-repairs', 2, 1),
  ((SELECT id FROM cat), 'Assembly', 'handyman-assembly', 2, 2),
  ((SELECT id FROM cat), 'Mounting', 'handyman-mounting', 2, 3),
  ((SELECT id FROM cat), 'Miscellaneous', 'handyman-misc', 2, 4);

-- SECURITY
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Security', 'security', 1, 16, 'Cameras, alarms, locks, and lighting')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Cameras', 'security-cameras', 2, 1),
  ((SELECT id FROM cat), 'Alarms', 'security-alarms', 2, 2),
  ((SELECT id FROM cat), 'Locks', 'security-locks', 2, 3),
  ((SELECT id FROM cat), 'Security Lighting', 'security-lighting', 2, 4);
