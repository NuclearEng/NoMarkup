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

// Profile & Provider types
export interface MilestoneTemplate {
  description: string;
  percentage: number;
}

export interface ServiceCategorySummary {
  id: string;
  name: string;
  slug: string;
  level: number;
  parentName: string | null;
}

export interface PortfolioImage {
  id: string;
  imageUrl: string;
  caption: string | null;
  sortOrder: number;
}

export interface ProviderProfile {
  id: string;
  userId: string;
  businessName: string | null;
  bio: string | null;
  serviceAddress: string | null;
  serviceLocation: { latitude: number; longitude: number } | null;
  serviceRadiusKm: number;
  defaultPaymentTiming: PaymentTiming;
  defaultMilestones: MilestoneTemplate[];
  cancellationPolicy: string | null;
  warrantyTerms: string | null;
  instantEnabled: boolean;
  instantAvailable: boolean;
  jobsCompleted: number;
  avgResponseTimeMinutes: number | null;
  onTimeRate: number | null;
  profileCompleteness: number;
  stripeOnboardingComplete: boolean;
  serviceCategories: ServiceCategorySummary[];
  portfolio: PortfolioImage[];
  memberSince: string;
}

export interface ServiceCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  level: number;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  children?: ServiceCategory[];
}

export interface UpdateUserInput {
  display_name?: string;
  phone?: string;
  avatar_url?: string;
  timezone?: string;
}

export interface UpdateProviderInput {
  business_name?: string;
  bio?: string;
  service_address?: string;
  service_location?: { latitude: number; longitude: number };
  service_radius_km?: number;
}

export interface GlobalTermsInput {
  payment_timing: string;
  milestones: MilestoneTemplate[];
  cancellation_policy: string;
  warranty_terms: string;
}

// Job types
export const RECURRENCE_FREQUENCY = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
} as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCY)[keyof typeof RECURRENCE_FREQUENCY];

export interface MarketRange {
  low_cents: number;
  median_cents: number;
  high_cents: number;
  sample_size: number;
}

export interface Job {
  id: string;
  customer_id: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  title: string;
  description: string;
  status: JobStatus;
  schedule_type: ScheduleType;
  scheduled_date: string | null;
  is_recurring: boolean;
  recurrence_frequency: RecurrenceFrequency | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  starting_bid_cents: number | null;
  offer_accepted_cents: number | null;
  auction_duration_hours: number;
  auction_ends_at: string | null;
  bid_count: number;
  lowest_bid_cents: number | null;
  market_range: MarketRange | null;
  created_at: string;
  updated_at: string;
}

export interface JobDetail extends Job {
  customer_display_name: string;
  customer_avatar_url: string | null;
  customer_member_since: string;
  customer_jobs_posted: number;
}

export interface CreateJobInput {
  category_id: string;
  title: string;
  description: string;
  schedule_type: ScheduleType;
  scheduled_date?: string;
  is_recurring: boolean;
  recurrence_frequency?: RecurrenceFrequency;
  location_address?: string;
  location_lat?: number;
  location_lng?: number;
  starting_bid_cents?: number;
  offer_accepted_cents?: number;
  auction_duration_hours: number;
}

export interface UpdateJobInput {
  title?: string;
  description?: string;
  schedule_type?: ScheduleType;
  scheduled_date?: string;
  is_recurring?: boolean;
  recurrence_frequency?: RecurrenceFrequency;
  location_address?: string;
  location_lat?: number;
  location_lng?: number;
  starting_bid_cents?: number;
  offer_accepted_cents?: number;
  auction_duration_hours?: number;
}

export interface SearchJobsParams {
  category_id?: string;
  query?: string;
  schedule_type?: ScheduleType;
  is_recurring?: boolean;
  min_price_cents?: number;
  max_price_cents?: number;
  location_lat?: number;
  location_lng?: number;
  radius_km?: number;
  status?: JobStatus;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface JobsResponse {
  jobs: Job[];
  pagination: PaginationResponse;
}

// Bid types
export interface BidUpdate {
  amount_cents: number;
  updated_at: string;
}

export interface Bid {
  id: string;
  job_id: string;
  provider_id: string;
  amount_cents: number;
  is_offer_accepted: boolean;
  status: BidStatus;
  original_amount_cents: number;
  bid_history: BidUpdate[];
  created_at: string;
  updated_at: string;
  awarded_at: string | null;
  withdrawn_at: string | null;
}

export interface TrustScoreSummary {
  overall_score: number;
  tier: TrustTier;
}

export interface ReviewSummary {
  average_rating: number;
  review_count: number;
  on_time_rate: number;
}

export interface BidWithProvider {
  bid: Bid;
  provider_display_name: string;
  provider_business_name: string;
  provider_avatar_url: string | null;
  trust_score: TrustScoreSummary | null;
  review_summary: ReviewSummary | null;
  jobs_completed: number;
}

export interface PlaceBidInput {
  amount_cents: number;
}

export interface UpdateBidInput {
  new_amount_cents: number;
}

export interface BidAnalytics {
  total_bids: number;
  lowest_bid_cents: number;
  highest_bid_cents: number;
  median_bid_cents: number;
  offer_accepted_count: number;
}

export interface BidsForJobResponse {
  bids: BidWithProvider[];
}

export interface MyBidsResponse {
  bids: Bid[];
  pagination: PaginationResponse;
}

export interface BidCountResponse {
  count: number;
}
