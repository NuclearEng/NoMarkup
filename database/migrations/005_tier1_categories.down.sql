-- Rollback: remove Tier 1 Direct Adjacency categories
-- Delete children first (level 3), then subcategories (level 2), then top-level (level 1)

-- AUTO REPAIR & MAINTENANCE
DELETE FROM service_categories WHERE slug IN (
  'auto-oil-change', 'auto-engine-tuneup', 'auto-transmission-repair', 'auto-engine-rebuild',
  'auto-brake-pads', 'auto-rotor-resurface', 'auto-shocks-struts', 'auto-alignment',
  'auto-tire-replace', 'auto-tire-rotation', 'auto-flat-repair',
  'auto-dent-repair', 'auto-paint-touchup', 'auto-body-repaint', 'auto-scratch-removal',
  'auto-battery-replace', 'auto-alternator', 'auto-starter-motor'
);
DELETE FROM service_categories WHERE slug IN (
  'auto-engine', 'auto-brakes', 'auto-tires', 'auto-body', 'auto-electrical'
);
DELETE FROM service_categories WHERE slug = 'auto-repair';

-- MOVING SERVICES
DELETE FROM service_categories WHERE slug IN (
  'moving-apartment', 'moving-house', 'moving-office',
  'moving-interstate', 'moving-cross-country', 'moving-vehicle-ship',
  'moving-full-pack', 'moving-partial-pack', 'moving-unpack', 'moving-supplies',
  'moving-short-storage', 'moving-long-storage', 'moving-climate-storage',
  'moving-piano', 'moving-hot-tub', 'moving-antique-art', 'moving-gun-safe'
);
DELETE FROM service_categories WHERE slug IN (
  'moving-local', 'moving-long-distance', 'moving-packing', 'moving-storage', 'moving-specialty'
);
DELETE FROM service_categories WHERE slug = 'moving';

-- PET SERVICES
DELETE FROM service_categories WHERE slug IN (
  'pet-dog-grooming', 'pet-cat-grooming', 'pet-nail-trim', 'pet-deshedding',
  'pet-in-home-sit', 'pet-overnight-board', 'pet-drop-in',
  'pet-daily-walk', 'pet-group-walk', 'pet-puppy-walk',
  'pet-obedience', 'pet-puppy-training', 'pet-behavior-training', 'pet-agility',
  'pet-wellness-check', 'pet-vaccinations', 'pet-dental-clean'
);
DELETE FROM service_categories WHERE slug IN (
  'pet-grooming', 'pet-sitting', 'pet-dog-walking', 'pet-training', 'pet-veterinary'
);
DELETE FROM service_categories WHERE slug = 'pet-services';

-- COMMERCIAL CLEANING
DELETE FROM service_categories WHERE slug IN (
  'comclean-daily-office', 'comclean-carpet-upholstery', 'comclean-restroom', 'comclean-window',
  'comclean-storefront', 'comclean-floor-maint', 'comclean-display',
  'comclean-warehouse', 'comclean-degreasing', 'comclean-pressure-wash',
  'comclean-rough-clean', 'comclean-final-clean', 'comclean-debris', 'comclean-touchup',
  'comclean-medical', 'comclean-data-center', 'comclean-kitchen-exhaust'
);
DELETE FROM service_categories WHERE slug IN (
  'comclean-office', 'comclean-retail', 'comclean-industrial', 'comclean-post-construction', 'comclean-specialized'
);
DELETE FROM service_categories WHERE slug = 'commercial-cleaning';
