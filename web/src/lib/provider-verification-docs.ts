/**
 * Provider verification document wire values — keep in lockstep with
 * `services/user/internal/domain` DocumentType and iOS `ProviderDocumentType`.
 *
 * Canonical keys: drivers_license, business_license, ein, insurance, trade_license.
 * Legacy aliases (government_id, proof_of_insurance) are normalized server-side.
 */

export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ACCEPTED_DOCUMENT_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.pdf';

/** Matches MAX_FILE_SIZE_BYTES / imaging document context (10 MB). */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export interface DocumentTypeConfig {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

/** Upload types for onboarding + verification center (FR-2.1 / FR-2.2). */
export const PROVIDER_DOCUMENT_TYPES: DocumentTypeConfig[] = [
  {
    key: 'drivers_license',
    label: "Driver's License or Government ID",
    description: "Driver's license, passport, or other government-issued photo ID.",
    required: true,
  },
  {
    key: 'business_license',
    label: 'Business License',
    description: 'Your business registration or license certificate.',
    required: false,
  },
  {
    key: 'ein',
    label: 'EIN / Tax ID Document',
    description: 'EIN letter or tax ID paperwork for your business.',
    required: false,
  },
  {
    key: 'insurance',
    label: 'Proof of Insurance',
    description: 'Liability insurance or bonding documentation.',
    required: false,
  },
  {
    key: 'trade_license',
    label: 'Trade-Specific License',
    description: 'Electrician, plumber, contractor, or other trade license.',
    required: false,
  },
];

export function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatDocStatus(status: string | undefined): string {
  if (!status) return '';
  return status.replace(/_/g, ' ');
}

/** Label for a stored document_type (includes legacy aliases). */
export function documentTypeLabel(key: string | undefined): string {
  if (!key) return 'Document';
  const known = PROVIDER_DOCUMENT_TYPES.find((t) => t.key === key);
  if (known) return known.label;
  if (key === 'government_id') return "Driver's License or Government ID";
  if (key === 'proof_of_insurance') return 'Proof of Insurance';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function daysUntilExpiry(expiresAt: string | undefined | null): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isDocumentExpired(expiresAt: string | undefined | null): boolean {
  const days = daysUntilExpiry(expiresAt);
  return days !== null && days < 0;
}

export function isDocumentExpiringSoon(expiresAt: string | undefined | null): boolean {
  const days = daysUntilExpiry(expiresAt);
  return days !== null && days >= 0 && days <= 30;
}
