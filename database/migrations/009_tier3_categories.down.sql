-- Rollback: remove Tier 3 Vertical Platform categories
-- Delete children first (level 3), then subcategories (level 2), then top-level (level 1)

-- HEALTHCARE — ELECTIVE
DELETE FROM service_categories WHERE slug IN (
  'health-teeth-whitening', 'health-dental-veneers', 'health-dental-implants', 'health-orthodontics',
  'health-lasik', 'health-eye-exam', 'health-contact-fitting',
  'health-botox-fillers', 'health-chemical-peels', 'health-laser-hair', 'health-microdermabrasion',
  'health-sports-rehab', 'health-post-surgery', 'health-chronic-pain',
  'health-individual-therapy', 'health-couples-counseling', 'health-stress-anxiety',
  'health-acupuncture', 'health-chiropractic', 'health-massage', 'health-naturopathy'
);
DELETE FROM service_categories WHERE slug IN (
  'health-dental', 'health-vision', 'health-cosmetic', 'health-physical-therapy', 'health-mental', 'health-alternative'
);
DELETE FROM service_categories WHERE slug = 'healthcare-elective';

-- COMMERCIAL CONSTRUCTION
DELETE FROM service_categories WHERE slug IN (
  'comcon-new-construction', 'comcon-tenant-buildout', 'comcon-renovation', 'comcon-project-mgmt',
  'comcon-commercial-wiring', 'comcon-panel-switchgear', 'comcon-emergency-lighting',
  'comcon-pipe-install', 'comcon-backflow', 'comcon-grease-trap',
  'comcon-rtu-install', 'comcon-duct-install', 'comcon-building-auto', 'comcon-chiller-boiler',
  'comcon-drywall-framing', 'comcon-flooring', 'comcon-acoustic-ceiling', 'comcon-painting',
  'comcon-excavation', 'comcon-paving', 'comcon-utility-trench'
);
DELETE FROM service_categories WHERE slug IN (
  'comcon-general', 'comcon-electrical', 'comcon-plumbing', 'comcon-hvac', 'comcon-interior', 'comcon-site-work'
);
DELETE FROM service_categories WHERE slug = 'commercial-construction';
