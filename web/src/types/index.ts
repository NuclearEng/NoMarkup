// Uses const objects + type extraction per CLAUDE.md (no TypeScript enum)

export const USER_ROLE = {
  CUSTOMER: 'customer',
  PROVIDER: 'provider',
  ADMIN: 'admin',
  SUPPORT: 'support',
  ANALYST: 'analyst',
} as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const USER_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  DEACTIVATED: 'deactivated',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const JOB_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  CLOSED: 'closed',
  CLOSED_ZERO_BIDS: 'closed_zero_bids',
  AWARDED: 'awarded',
  CONTRACT_PENDING: 'contract_pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REVIEWED: 'reviewed',
  CANCELLED: 'cancelled',
  REPOSTED: 'reposted',
  EXPIRED: 'expired',
  SUSPENDED: 'suspended',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const BID_STATUS = {
  ACTIVE: 'active',
  AWARDED: 'awarded',
  NOT_SELECTED: 'not_selected',
  WITHDRAWN: 'withdrawn',
  EXPIRED: 'expired',
} as const;
export type BidStatus = (typeof BID_STATUS)[keyof typeof BID_STATUS];

export const CONTRACT_STATUS = {
  PENDING_ACCEPTANCE: 'pending_acceptance',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  VOIDED: 'voided',
  DISPUTED: 'disputed',
  ABANDONED: 'abandoned',
  SUSPENDED: 'suspended',
} as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  ESCROW: 'escrow',
  RELEASED: 'released',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  DISPUTED: 'disputed',
  CHARGEBACK: 'chargeback',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const TRUST_TIER = {
  UNDER_REVIEW: 'under_review',
  NEW: 'new',
  RISING: 'rising',
  TRUSTED: 'trusted',
  TOP_RATED: 'top_rated',
} as const;
export type TrustTier = (typeof TRUST_TIER)[keyof typeof TRUST_TIER];

export const PAYMENT_TIMING = {
  UPFRONT: 'upfront',
  MILESTONE: 'milestone',
  COMPLETION: 'completion',
  PAYMENT_PLAN: 'payment_plan',
  RECURRING: 'recurring',
} as const;
export type PaymentTiming = (typeof PAYMENT_TIMING)[keyof typeof PAYMENT_TIMING];

export const SCHEDULE_TYPE = {
  SPECIFIC_DATE: 'specific_date',
  DATE_RANGE: 'date_range',
  FLEXIBLE: 'flexible',
} as const;
export type ScheduleType = (typeof SCHEDULE_TYPE)[keyof typeof SCHEDULE_TYPE];

// Domain interfaces
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: UserRole[];
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface PaginationRequest {
  page: number;
  pageSize: number;
}

export interface PaginationResponse {
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
}

// Auth types
export interface AuthResponse {
  user_id: string;
  access_token: string;
  access_token_expires_at: string;
}

export interface LoginResponse extends AuthResponse {
  mfa_required: boolean;
  mfa_challenge_token: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  display_name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface VerifyEmailResponse {
  verified: boolean;
}
