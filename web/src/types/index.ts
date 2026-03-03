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

// Contract types
export const MILESTONE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  DISPUTED: 'disputed',
  REVISION_REQUESTED: 'revision_requested',
} as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[keyof typeof MILESTONE_STATUS];

export const CHANGE_ORDER_STATUS = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUS)[keyof typeof CHANGE_ORDER_STATUS];

export interface Milestone {
  id: string;
  contract_id: string;
  description: string;
  amount_cents: number;
  sort_order: number;
  status: string;
  revision_count: number;
  revision_notes: string;
  submitted_at?: string;
  approved_at?: string;
}

export interface Contract {
  id: string;
  contract_number: string;
  job_id: string;
  customer_id: string;
  provider_id: string;
  bid_id: string;
  amount_cents: number;
  payment_timing: string;
  status: string;
  customer_accepted: boolean;
  provider_accepted: boolean;
  acceptance_deadline: string;
  milestones: Milestone[];
  accepted_at?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface ChangeOrder {
  id: string;
  contract_id: string;
  proposed_by: string;
  description: string;
  amount_delta_cents: number;
  status: string;
  created_at: string;
}

export interface ContractDetail {
  contract: Contract;
  change_orders: ChangeOrder[];
}

export interface ContractsResponse {
  contracts: Contract[];
  pagination: PaginationResponse;
}

// Payment types
export interface Payment {
  id: string;
  contract_id: string;
  milestone_id?: string;
  recurring_instance_id?: string;
  customer_id: string;
  provider_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  guarantee_fee_cents: number;
  provider_payout_cents: number;
  status: string;
  failure_reason?: string;
  refund_amount_cents: number;
  refund_reason?: string;
  installment_number?: number;
  total_installments?: number;
  escrow_at?: string;
  released_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface PaymentBreakdown {
  subtotal_cents: number;
  platform_fee_cents: number;
  guarantee_fee_cents: number;
  total_cents: number;
  provider_payout_cents: number;
  fee_percentage: number;
  guarantee_percentage: number;
}

export interface PaymentMethod {
  id: string;
  type: string;
  last_four: string;
  brand: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
}

export interface StripeAccountStatus {
  account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements: string[];
}

export interface PaymentsResponse {
  payments: Payment[];
  pagination: PaginationResponse;
}

export interface CreatePaymentInput {
  contract_id: string;
  milestone_id?: string;
  amount_cents: number;
  payment_method_id: string;
}

export interface FeeCalculationInput {
  amount_cents: number;
  category_id?: string;
}

// Review types
export const REVIEW_DIRECTION = {
  CUSTOMER_TO_PROVIDER: 'customer_to_provider',
  PROVIDER_TO_CUSTOMER: 'provider_to_customer',
} as const;
export type ReviewDirection = (typeof REVIEW_DIRECTION)[keyof typeof REVIEW_DIRECTION];

export const FLAG_REASON = {
  INAPPROPRIATE: 'inappropriate',
  FAKE: 'fake',
  HARASSMENT: 'harassment',
  SPAM: 'spam',
  IRRELEVANT: 'irrelevant',
} as const;
export type FlagReason = (typeof FLAG_REASON)[keyof typeof FLAG_REASON];

export interface Review {
  id: string;
  contract_id: string;
  reviewer_id: string;
  reviewee_id: string;
  direction: string;
  overall_rating: number;
  quality_rating?: number;
  communication_rating?: number;
  timeliness_rating?: number;
  value_rating?: number;
  comment: string;
  photo_urls: string[];
  response?: ReviewResponseData;
  is_flagged: boolean;
  created_at: string;
}

export interface ReviewResponseData {
  id: string;
  review_id: string;
  responder_id: string;
  comment: string;
  created_at: string;
}

export interface ReviewEligibility {
  eligible: boolean;
  already_reviewed: boolean;
  review_window_closes_at: string;
}

export interface ReviewsForUserResponse {
  reviews: Review[];
  pagination: PaginationResponse;
  average_rating: number;
  total_reviews: number;
}

export interface CreateReviewInput {
  overall_rating: number;
  quality_rating?: number;
  communication_rating?: number;
  timeliness_rating?: number;
  value_rating?: number;
  comment: string;
  photo_urls?: string[];
}

// Chat types
export const CHANNEL_TYPE = {
  INQUIRY: 'inquiry',
  BID: 'bid',
  CONTRACT: 'contract',
} as const;
export type ChannelType = (typeof CHANNEL_TYPE)[keyof typeof CHANNEL_TYPE];

export const CHANNEL_STATUS = {
  PENDING_APPROVAL: 'pending_approval',
  ACTIVE: 'active',
  READ_ONLY: 'read_only',
  CLOSED: 'closed',
} as const;
export type ChannelStatus = (typeof CHANNEL_STATUS)[keyof typeof CHANNEL_STATUS];

export const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
  SYSTEM: 'system',
  CONTACT_SHARE: 'contact_share',
} as const;
export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export interface Channel {
  id: string;
  job_id: string;
  customer_id: string;
  provider_id: string;
  status: string;
  channel_type: string;
  last_message?: ChatMessage;
  unread_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  message_type: string;
  content: string;
  attachment_url?: string;
  attachment_name?: string;
  flagged_contact_info: boolean;
  is_deleted: boolean;
  created_at: string;
}

export interface ChannelsResponse {
  channels: Channel[];
  pagination: PaginationResponse;
}

export interface MessagesResponse {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface UnreadCountResponse {
  total_unread: number;
  channels: { channel_id: string; unread_count: number }[];
}

export interface SendMessageInput {
  content: string;
  message_type?: string;
}

// Trust Score types
export interface TrustScore {
  user_id: string;
  overall_score: number; // 0.0-1.0
  tier: TrustTier;
  feedback_score: number; // 0.0-1.0
  volume_score: number;
  risk_score: number;
  fraud_score: number;
  data_points: number;
  computed_at: string;
}

export interface TrustScoreSnapshot {
  score: TrustScore;
  change_reason: string;
  previous_overall: number;
  previous_tier: TrustTier;
  recorded_at: string;
}

export interface TierRequirement {
  tier: TrustTier;
  min_overall_score: number;
  min_completed_jobs: number;
  min_reviews: number;
  min_rating: number;
  requires_verification: boolean;
  description: string;
}

export interface TrustScoreHistoryResponse {
  snapshots: TrustScoreSnapshot[];
  pagination: PaginationResponse;
}

export interface TierRequirementsResponse {
  tiers: TierRequirement[];
}
