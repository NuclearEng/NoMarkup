-- Expand the service taxonomy to mirror Angi's home-services category tree.
-- Adds new level-1 service categories plus their level-2 subcategories,
-- deduped against the existing categories from migrations 002/005/006/009.
--
-- sort_order starts at 100 so these sort after the original curated set without
-- renumbering it. All inserts idempotent. Down migration deletes them by slug.

-- Additions & Remodeling
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Additions & Remodeling', 'remodeling-additions', 1, 100, 'Home additions and whole-home/room remodels')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Home Additions', 'remodeling-additions-home-additions', 1),
  ('Whole-House Remodel', 'remodeling-additions-whole-house-remodel', 2),
  ('Bathroom Remodeling', 'remodeling-additions-bathroom-remodeling', 3),
  ('Kitchen Remodeling', 'remodeling-additions-kitchen-remodeling', 4),
  ('Basement Remodeling', 'remodeling-additions-basement-remodeling', 5),
  ('Attic Remodeling', 'remodeling-additions-attic-remodeling', 6),
  ('Sunrooms & Patio Enclosures', 'remodeling-additions-sunrooms-and-patio-enclosures', 7),
  ('Accessory Dwelling Units', 'remodeling-additions-accessory-dwelling-units', 8),
  ('Accessibility Remodeling', 'remodeling-additions-accessibility-remodeling', 9)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Air Duct Cleaning
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Air Duct Cleaning', 'air-duct-cleaning', 1, 101, 'Air duct and dryer vent cleaning')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Air Duct Cleaning', 'air-duct-cleaning-air-duct-cleaning', 1),
  ('Dryer Vent Cleaning', 'air-duct-cleaning-dryer-vent-cleaning', 2),
  ('HVAC Vent Sanitizing', 'air-duct-cleaning-hvac-vent-sanitizing', 3)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Asbestos Removal
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Asbestos Removal', 'asbestos-removal', 1, 102, 'Asbestos testing and abatement')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Asbestos Testing', 'asbestos-removal-asbestos-testing', 1),
  ('Asbestos Abatement', 'asbestos-removal-asbestos-abatement', 2),
  ('Popcorn Ceiling Removal', 'asbestos-removal-popcorn-ceiling-removal', 3)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Basement Waterproofing
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Basement Waterproofing', 'basement-waterproofing', 1, 103, 'Waterproofing, sump pumps, drainage')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Basement Waterproofing', 'basement-waterproofing-basement-waterproofing', 1),
  ('Sump Pump Installation', 'basement-waterproofing-sump-pump-installation', 2),
  ('Egress Window Installation', 'basement-waterproofing-egress-window-installation', 3),
  ('Crawl Space Encapsulation', 'basement-waterproofing-crawl-space-encapsulation', 4),
  ('French Drain Installation', 'basement-waterproofing-french-drain-installation', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Foundation Repair
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Foundation Repair', 'foundation-repair', 1, 104, 'Foundation and structural repair')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Foundation Repair', 'foundation-repair-foundation-repair', 1),
  ('Foundation Leveling', 'foundation-repair-foundation-leveling', 2),
  ('Slab Repair', 'foundation-repair-slab-repair', 3),
  ('Crawl Space Repair', 'foundation-repair-crawl-space-repair', 4),
  ('Structural Engineering', 'foundation-repair-structural-engineering', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Carpentry
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Carpentry', 'carpentry', 1, 105, 'Finish carpentry, framing, custom woodwork')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Finish Carpentry', 'carpentry-finish-carpentry', 1),
  ('Trim & Molding', 'carpentry-trim-and-molding', 2),
  ('Framing', 'carpentry-framing', 3),
  ('Custom Built-Ins', 'carpentry-custom-built-ins', 4),
  ('Wood Repair', 'carpentry-wood-repair', 5),
  ('Stair Building', 'carpentry-stair-building', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Cabinets & Refinishing
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Cabinets & Refinishing', 'cabinets', 1, 106, 'Cabinet making, refacing, refinishing')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Cabinet Making', 'cabinets-cabinet-making', 1),
  ('Cabinet Refacing', 'cabinets-cabinet-refacing', 2),
  ('Cabinet Refinishing', 'cabinets-cabinet-refinishing', 3),
  ('Cabinet Installation', 'cabinets-cabinet-installation', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Countertops
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Countertops', 'countertops', 1, 107, 'Stone, quartz, laminate countertops')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Granite Countertops', 'countertops-granite-countertops', 1),
  ('Quartz Countertops', 'countertops-quartz-countertops', 2),
  ('Marble Countertops', 'countertops-marble-countertops', 3),
  ('Laminate Countertops', 'countertops-laminate-countertops', 4),
  ('Countertop Installation', 'countertops-countertop-installation', 5),
  ('Countertop Repair', 'countertops-countertop-repair', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Carpet Cleaning
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Carpet Cleaning', 'carpet-cleaning', 1, 108, 'Carpet, rug, upholstery cleaning')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Carpet Cleaning', 'carpet-cleaning-carpet-cleaning', 1),
  ('Upholstery Cleaning', 'carpet-cleaning-upholstery-cleaning', 2),
  ('Rug Cleaning', 'carpet-cleaning-rug-cleaning', 3),
  ('Carpet Stretching & Repair', 'carpet-cleaning-carpet-stretching-and-repair', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Drywall
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Drywall', 'drywall', 1, 109, 'Drywall install, repair, plaster, texture')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Drywall Installation', 'drywall-drywall-installation', 1),
  ('Drywall Repair', 'drywall-drywall-repair', 2),
  ('Plastering', 'drywall-plastering', 3),
  ('Texturing', 'drywall-texturing', 4),
  ('Acoustic Ceiling', 'drywall-acoustic-ceiling', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Insulation
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Insulation', 'insulation', 1, 110, 'Attic, wall, spray-foam insulation')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Attic Insulation', 'insulation-attic-insulation', 1),
  ('Spray Foam Insulation', 'insulation-spray-foam-insulation', 2),
  ('Blown-In Insulation', 'insulation-blown-in-insulation', 3),
  ('Wall Insulation', 'insulation-wall-insulation', 4),
  ('Radiant Barrier', 'insulation-radiant-barrier', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Ceiling Fans
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Ceiling Fans', 'ceiling-fans', 1, 111, 'Ceiling fan and fixture install/repair')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Ceiling Fan Installation', 'ceiling-fans-ceiling-fan-installation', 1),
  ('Ceiling Fan Repair', 'ceiling-fans-ceiling-fan-repair', 2),
  ('Lighting Fixture Installation', 'ceiling-fans-lighting-fixture-installation', 3)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Chimney & Fireplace
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Chimney & Fireplace', 'chimney-fireplace', 1, 112, 'Chimney sweep, repair, fireplace install')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Chimney Sweep', 'chimney-fireplace-chimney-sweep', 1),
  ('Chimney Repair', 'chimney-fireplace-chimney-repair', 2),
  ('Chimney Cap Installation', 'chimney-fireplace-chimney-cap-installation', 3),
  ('Fireplace Installation', 'chimney-fireplace-fireplace-installation', 4),
  ('Fireplace Repair', 'chimney-fireplace-fireplace-repair', 5),
  ('Wood Stove Installation', 'chimney-fireplace-wood-stove-installation', 6),
  ('Gas Log Installation', 'chimney-fireplace-gas-log-installation', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Gutters
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Gutters', 'gutters', 1, 113, 'Gutter cleaning, install, repair, guards')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Gutter Cleaning', 'gutters-gutter-cleaning', 1),
  ('Gutter Installation', 'gutters-gutter-installation', 2),
  ('Gutter Repair', 'gutters-gutter-repair', 3),
  ('Gutter Guard Installation', 'gutters-gutter-guard-installation', 4),
  ('Downspout Repair', 'gutters-downspout-repair', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Siding
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Siding', 'siding', 1, 114, 'Vinyl, fiber-cement, wood siding, stucco')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Vinyl Siding', 'siding-vinyl-siding', 1),
  ('Fiber Cement Siding', 'siding-fiber-cement-siding', 2),
  ('Wood Siding', 'siding-wood-siding', 3),
  ('Siding Repair', 'siding-siding-repair', 4),
  ('Stucco', 'siding-stucco', 5),
  ('Exterior Trim', 'siding-exterior-trim', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Pressure Washing
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Pressure Washing', 'pressure-washing', 1, 115, 'Exterior pressure and soft washing')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('House Washing', 'pressure-washing-house-washing', 1),
  ('Driveway Cleaning', 'pressure-washing-driveway-cleaning', 2),
  ('Deck & Patio Cleaning', 'pressure-washing-deck-and-patio-cleaning', 3),
  ('Roof Cleaning', 'pressure-washing-roof-cleaning', 4),
  ('Soft Washing', 'pressure-washing-soft-washing', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Window Cleaning
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Window Cleaning', 'window-cleaning', 1, 116, 'Interior/exterior window cleaning')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Interior Window Cleaning', 'window-cleaning-interior-window-cleaning', 1),
  ('Exterior Window Cleaning', 'window-cleaning-exterior-window-cleaning', 2),
  ('Screen Cleaning', 'window-cleaning-screen-cleaning', 3),
  ('Skylight Cleaning', 'window-cleaning-skylight-cleaning', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Decks & Patios
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Decks & Patios', 'deck-patio', 1, 117, 'Deck and patio build, repair, refinish')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Deck Building', 'deck-patio-deck-building', 1),
  ('Deck Repair', 'deck-patio-deck-repair', 2),
  ('Deck Staining & Refinishing', 'deck-patio-deck-staining-and-refinishing', 3),
  ('Patio Construction', 'deck-patio-patio-construction', 4),
  ('Pergola & Gazebo', 'deck-patio-pergola-and-gazebo', 5),
  ('Screened Porch', 'deck-patio-screened-porch', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Pavers & Hardscaping
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Pavers & Hardscaping', 'pavers-hardscaping', 1, 118, 'Pavers, retaining walls, outdoor living')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Paver Installation', 'pavers-hardscaping-paver-installation', 1),
  ('Retaining Walls', 'pavers-hardscaping-retaining-walls', 2),
  ('Walkways', 'pavers-hardscaping-walkways', 3),
  ('Outdoor Kitchens', 'pavers-hardscaping-outdoor-kitchens', 4),
  ('Fire Pits', 'pavers-hardscaping-fire-pits', 5),
  ('Stone Hardscaping', 'pavers-hardscaping-stone-hardscaping', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Lawn Care
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Lawn Care', 'lawn-care', 1, 119, 'Mowing, fertilization, irrigation')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Mowing & Maintenance', 'lawn-care-mowing-and-maintenance', 1),
  ('Fertilization', 'lawn-care-fertilization', 2),
  ('Aeration', 'lawn-care-aeration', 3),
  ('Seeding & Sod', 'lawn-care-seeding-and-sod', 4),
  ('Weed Control', 'lawn-care-weed-control', 5),
  ('Leaf Removal', 'lawn-care-leaf-removal', 6),
  ('Sprinkler / Irrigation Systems', 'lawn-care-sprinkler-irrigation-systems', 7)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Tree Service
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Tree Service', 'tree-service', 1, 120, 'Tree removal, trimming, stump grinding')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Tree Removal', 'tree-service-tree-removal', 1),
  ('Tree Trimming & Pruning', 'tree-service-tree-trimming-and-pruning', 2),
  ('Stump Grinding', 'tree-service-stump-grinding', 3),
  ('Emergency Tree Removal', 'tree-service-emergency-tree-removal', 4),
  ('Arborist Services', 'tree-service-arborist-services', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Snow Removal
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Snow Removal', 'snow-removal', 1, 121, 'Snow plowing, de-icing, ice dams')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Snow Plowing', 'snow-removal-snow-plowing', 1),
  ('Driveway Snow Removal', 'snow-removal-driveway-snow-removal', 2),
  ('Roof Snow Removal', 'snow-removal-roof-snow-removal', 3),
  ('Ice Dam Removal', 'snow-removal-ice-dam-removal', 4),
  ('De-Icing', 'snow-removal-de-icing', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Pool & Spa Service
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Pool & Spa Service', 'pool-spa', 1, 122, 'Pool/spa install, cleaning, repair')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Pool Installation', 'pool-spa-pool-installation', 1),
  ('Pool Cleaning & Maintenance', 'pool-spa-pool-cleaning-and-maintenance', 2),
  ('Pool Repair', 'pool-spa-pool-repair', 3),
  ('Pool Opening & Closing', 'pool-spa-pool-opening-and-closing', 4),
  ('Hot Tub / Spa Service', 'pool-spa-hot-tub-spa-service', 5),
  ('Pool Deck Resurfacing', 'pool-spa-pool-deck-resurfacing', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Junk Removal & Hauling
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Junk Removal & Hauling', 'junk-removal-hauling', 1, 123, 'Junk removal, hauling, cleanouts')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Junk Removal', 'junk-removal-hauling-junk-removal', 1),
  ('Furniture Removal', 'junk-removal-hauling-furniture-removal', 2),
  ('Appliance Removal', 'junk-removal-hauling-appliance-removal', 3),
  ('Construction Debris Hauling', 'junk-removal-hauling-construction-debris-hauling', 4),
  ('Estate Cleanout', 'junk-removal-hauling-estate-cleanout', 5),
  ('Dumpster Rental', 'junk-removal-hauling-dumpster-rental', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Water Damage Restoration
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Water Damage Restoration', 'water-damage-restoration', 1, 124, 'Water/fire/storm damage restoration')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Water Damage Restoration', 'water-damage-restoration-water-damage-restoration', 1),
  ('Flood Cleanup', 'water-damage-restoration-flood-cleanup', 2),
  ('Fire & Smoke Damage Restoration', 'water-damage-restoration-fire-and-smoke-damage-restoration', 3),
  ('Storm Damage Repair', 'water-damage-restoration-storm-damage-repair', 4),
  ('Sewage Cleanup', 'water-damage-restoration-sewage-cleanup', 5),
  ('Structural Drying', 'water-damage-restoration-structural-drying', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Mold Removal
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Mold Removal', 'mold-removal', 1, 125, 'Mold testing and remediation')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Mold Testing & Inspection', 'mold-removal-mold-testing-and-inspection', 1),
  ('Mold Remediation', 'mold-removal-mold-remediation', 2),
  ('Air Quality Testing', 'mold-removal-air-quality-testing', 3)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Radon Mitigation
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Radon Mitigation', 'radon-mitigation', 1, 126, 'Radon testing and mitigation')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Radon Testing', 'radon-mitigation-radon-testing', 1),
  ('Radon Mitigation System Installation', 'radon-mitigation-radon-mitigation-system-installation', 2)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Lead Paint Removal
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Lead Paint Removal', 'lead-paint-removal', 1, 127, 'Lead testing and abatement')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Lead Testing', 'lead-paint-removal-lead-testing', 1),
  ('Lead Paint Abatement', 'lead-paint-removal-lead-paint-abatement', 2)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Home Inspection
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Home Inspection', 'home-inspection', 1, 128, 'Pre-purchase and specialty inspections')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Pre-Purchase Home Inspection', 'home-inspection-pre-purchase-home-inspection', 1),
  ('Pre-Sale Inspection', 'home-inspection-pre-sale-inspection', 2),
  ('Pest / Termite Inspection', 'home-inspection-pest-termite-inspection', 3),
  ('Roof Inspection', 'home-inspection-roof-inspection', 4),
  ('Sewer Scope Inspection', 'home-inspection-sewer-scope-inspection', 5),
  ('Energy Audit', 'home-inspection-energy-audit', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Land Surveying
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Land Surveying', 'land-surveying', 1, 129, 'Boundary, topographic, site surveys')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Boundary Survey', 'land-surveying-boundary-survey', 1),
  ('Topographic Survey', 'land-surveying-topographic-survey', 2),
  ('Property Line Survey', 'land-surveying-property-line-survey', 3),
  ('Plot Plan / Site Survey', 'land-surveying-plot-plan-site-survey', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Excavating & Grading
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Excavating & Grading', 'excavating-grading', 1, 130, 'Excavation, grading, demolition, drainage')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Excavation', 'excavating-grading-excavation', 1),
  ('Land Grading', 'excavating-grading-land-grading', 2),
  ('Land Clearing', 'excavating-grading-land-clearing', 3),
  ('Trenching', 'excavating-grading-trenching', 4),
  ('Demolition', 'excavating-grading-demolition', 5),
  ('Drainage Solutions', 'excavating-grading-drainage-solutions', 6)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Septic Tank Service
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Septic Tank Service', 'septic-service', 1, 131, 'Septic pumping, install, repair')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Septic Tank Pumping', 'septic-service-septic-tank-pumping', 1),
  ('Septic Tank Cleaning', 'septic-service-septic-tank-cleaning', 2),
  ('Septic System Installation', 'septic-service-septic-system-installation', 3),
  ('Septic Repair', 'septic-service-septic-repair', 4),
  ('Septic Inspection', 'septic-service-septic-inspection', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Well & Pump Service
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Well & Pump Service', 'well-pump', 1, 132, 'Well drilling, pumps, water treatment')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Well Drilling', 'well-pump-well-drilling', 1),
  ('Well Pump Installation', 'well-pump-well-pump-installation', 2),
  ('Well Pump Repair', 'well-pump-well-pump-repair', 3),
  ('Water Filtration / Treatment', 'well-pump-water-filtration-treatment', 4),
  ('Water Testing', 'well-pump-water-testing', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Water Heater Service
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Water Heater Service', 'water-heaters', 1, 133, 'Water heater install/repair, softeners')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Water Heater Installation', 'water-heaters-water-heater-installation', 1),
  ('Water Heater Repair', 'water-heaters-water-heater-repair', 2),
  ('Tankless Water Heater Installation', 'water-heaters-tankless-water-heater-installation', 3),
  ('Water Softener Installation', 'water-heaters-water-softener-installation', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Solar Panels
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Solar Panels', 'solar', 1, 134, 'Solar install, repair, battery storage')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Solar Panel Installation', 'solar-solar-panel-installation', 1),
  ('Solar Repair & Maintenance', 'solar-solar-repair-and-maintenance', 2),
  ('Solar Battery / Storage', 'solar-solar-battery-storage', 3),
  ('Solar Inspection', 'solar-solar-inspection', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Home Theater & AV
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Home Theater & AV', 'home-theater-av', 1, 135, 'Home theater, TV mounting, smart home')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Home Theater Installation', 'home-theater-av-home-theater-installation', 1),
  ('TV Mounting', 'home-theater-av-tv-mounting', 2),
  ('Surround Sound / Audio', 'home-theater-av-surround-sound-audio', 3),
  ('Smart Home Wiring', 'home-theater-av-smart-home-wiring', 4),
  ('Network / Wi-Fi Setup', 'home-theater-av-network-wi-fi-setup', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Locksmith
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Locksmith', 'locksmith', 1, 136, 'Locks, rekeying, lockout, safes')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Lock Installation', 'locksmith-lock-installation', 1),
  ('Lock Repair & Rekeying', 'locksmith-lock-repair-and-rekeying', 2),
  ('Emergency Lockout', 'locksmith-emergency-lockout', 3),
  ('Safe Installation', 'locksmith-safe-installation', 4),
  ('Smart Lock Installation', 'locksmith-smart-lock-installation', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Interior Design
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Interior Design', 'interior-design', 1, 137, 'Design, staging, color, space planning')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Interior Design', 'interior-design-interior-design', 1),
  ('Home Staging', 'interior-design-home-staging', 2),
  ('Color Consultation', 'interior-design-color-consultation', 3),
  ('Space Planning', 'interior-design-space-planning', 4),
  ('Closet & Storage Design', 'interior-design-closet-and-storage-design', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Window Treatments
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Window Treatments', 'window-treatments', 1, 138, 'Blinds, shades, drapery, shutters')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Blinds & Shades', 'window-treatments-blinds-and-shades', 1),
  ('Curtains & Drapery', 'window-treatments-curtains-and-drapery', 2),
  ('Shutters', 'window-treatments-shutters', 3),
  ('Motorized Window Treatments', 'window-treatments-motorized-window-treatments', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Tile Work
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Tile Work', 'tile-work', 1, 139, 'Tile install, backsplash, grout')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Tile Installation', 'tile-work-tile-installation', 1),
  ('Backsplash Installation', 'tile-work-backsplash-installation', 2),
  ('Grout Repair & Sealing', 'tile-work-grout-repair-and-sealing', 3),
  ('Shower Tile', 'tile-work-shower-tile', 4),
  ('Tile Repair', 'tile-work-tile-repair', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Upholstery & Furniture Repair
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Upholstery & Furniture Repair', 'upholstery', 1, 140, 'Upholstery, refinishing, assembly')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Furniture Upholstery', 'upholstery-furniture-upholstery', 1),
  ('Furniture Refinishing', 'upholstery-furniture-refinishing', 2),
  ('Antique Restoration', 'upholstery-antique-restoration', 3),
  ('Furniture Assembly', 'upholstery-furniture-assembly', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Home Builders
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Home Builders', 'home-builders', 1, 141, 'Custom homes, general contracting')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Custom Home Building', 'home-builders-custom-home-building', 1),
  ('Modular / Manufactured Homes', 'home-builders-modular-manufactured-homes', 2),
  ('General Contracting', 'home-builders-general-contracting', 3),
  ('Garage Building', 'home-builders-garage-building', 4),
  ('Shed / Outbuilding Construction', 'home-builders-shed-outbuilding-construction', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Decorative Concrete
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Decorative Concrete', 'decorative-concrete', 1, 142, 'Stamped, stained, epoxy concrete')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Stamped Concrete', 'decorative-concrete-stamped-concrete', 1),
  ('Concrete Staining', 'decorative-concrete-concrete-staining', 2),
  ('Epoxy Floor Coating', 'decorative-concrete-epoxy-floor-coating', 3),
  ('Concrete Resurfacing', 'decorative-concrete-concrete-resurfacing', 4),
  ('Polished Concrete', 'decorative-concrete-polished-concrete', 5)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Photography
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Photography', 'photography', 1, 143, 'Real estate, event, portrait photo')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Real Estate Photography', 'photography-real-estate-photography', 1),
  ('Event Photography', 'photography-event-photography', 2),
  ('Portrait Photography', 'photography-portrait-photography', 3),
  ('Drone / Aerial Photography', 'photography-drone-aerial-photography', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Catering
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Catering', 'catering', 1, 144, 'Event catering and private chefs')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Event Catering', 'catering-event-catering', 1),
  ('Private Chef', 'catering-private-chef', 2),
  ('Wedding Catering', 'catering-wedding-catering', 3),
  ('Corporate Catering', 'catering-corporate-catering', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Auto Detailing
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Auto Detailing', 'auto-detailing', 1, 145, 'Car detailing and ceramic coating')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Car Detailing', 'auto-detailing-car-detailing', 1),
  ('Mobile Detailing', 'auto-detailing-mobile-detailing', 2),
  ('Ceramic Coating', 'auto-detailing-ceramic-coating', 3),
  ('Interior Detailing', 'auto-detailing-interior-detailing', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- Computer & Electronics Repair
WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Computer & Electronics Repair', 'computer-repair', 1, 146, 'Computer, phone, network repair')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order)
SELECT cat.id, v.name, v.slug, 2, v.sort_order FROM cat, (VALUES
  ('Computer Repair', 'computer-repair-computer-repair', 1),
  ('Data Recovery', 'computer-repair-data-recovery', 2),
  ('Phone / Tablet Repair', 'computer-repair-phone-tablet-repair', 3),
  ('Network Setup', 'computer-repair-network-setup', 4)
       ) AS v(name, slug, sort_order)
ON CONFLICT (slug) DO NOTHING;
