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

export const AUCTION_TYPE = {
  SEALED: 'sealed',
  LIVE: 'live',
} as const;
export type AuctionType = (typeof AUCTION_TYPE)[keyof typeof AUCTION_TYPE];

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

// MFA types
export interface EnableMFAResponse {
  secret: string;
  qr_code_url: string;
  backup_codes: string[];
}

export interface ConfirmMFASetupInput {
  totp_code: string;
  backup_codes: string[];
}

export interface VerifyMFALoginInput {
  mfa_challenge_token: string;
  totp_code: string;
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
  parent_name: string | null;
}

export interface PortfolioImage {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
}

export interface ProviderProfile {
  id: string;
  user_id: string;
  business_name: string | null;
  bio: string | null;
  service_address: string | null;
  service_location: { latitude: number; longitude: number } | null;
  service_radius_km: number;
  default_payment_timing: PaymentTiming;
  default_milestones: MilestoneTemplate[];
  cancellation_policy: string | null;
  warranty_terms: string | null;
  instant_enabled: boolean;
  instant_available: boolean;
  jobs_completed: number;
  avg_response_time_minutes: number | null;
  on_time_rate: number | null;
  profile_completeness: number;
  stripe_onboarding_complete: boolean;
  service_categories: ServiceCategorySummary[];
  portfolio: PortfolioImage[];
  member_since: string;
  response_time_label?: string;
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

// Market = one city/region NoMarkup can operate in (craigslist-style coverage).
// Served by GET /api/v1/markets (gateway markets handler, table from migration
// 051). Field names are snake_case to match the raw JSON — the API client does
// NOT case-transform responses.
export interface Market {
  id: string;
  slug: string; // craigslist subdomain, e.g. 'sfbay'
  name: string; // display name, e.g. 'SF bay area'
  region: string | null; // US state name / 'Territories'; null for MX
  region_code: string | null; // 2-letter US state code; null otherwise
  country: 'US' | 'MX';
  is_active: boolean; // launched here yet? (catalog markets default false)
  lat: number | null;
  lng: number | null;
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
  auction_type: AuctionType;
  snipe_extension_count: number;
  original_auction_ends_at: string | null;
  created_at: string;
  updated_at: string;
  // Wave 5 services-polish (Section H). Optional because legacy
  // payloads pre-migration 046 omit them; the form treats undefined as
  // false / null.
  is_hourly?: boolean;
  hourly_rate_cents?: number | null;
  same_day_requested?: boolean;
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
  auction_type?: AuctionType;
  photo_urls?: string[];
  publish?: boolean;
  // Wave 5 services-polish (Section H). is_hourly toggles the form
  // between flat-rate and hourly billing; hourly_rate_cents carries
  // the rate when is_hourly=true. same_day_requested is the Thumbtack-
  // style "I need this today" SLA flag.
  is_hourly?: boolean;
  hourly_rate_cents?: number;
  same_day_requested?: boolean;
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

export interface AuctionBidEvent {
  job_id: string;
  amount_cents: number;
  event_type: 'bid_placed' | 'bid_updated' | 'bid_withdrawn';
  created_at: string;
}

export interface LiveAuctionState {
  job_id: string;
  lowest_bid_cents: number;
  bid_count: number;
  auction_ends_at: string | null;
  snipe_extension_count: number;
  max_snipe_extensions: number;
  recent_events: AuctionBidEvent[];
}

export interface UserSavings {
  id: string;
  user_id: string;
  job_id: string;
  awarded_cents: number;
  market_median_cents: number;
  savings_cents: number;
  created_at: string;
}

export interface ProviderStreak {
  id: string;
  provider_id: string;
  category_id: string | null;
  current_streak: number;
  longest_streak: number;
  total_wins: number;
  category_rank: number | null;
  updated_at: string;
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
  job_title: string;
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
  // Wave 5 services-polish (Section H). Post-completion gratuity. 0
  // means "no tip yet"; once non-zero the tip widget hides.
  tip_amount_cents?: number;
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
  // Lead-gen fee — additive fee on won contracts. Zero when not applicable.
  lead_gen_fee_cents: number;
  lead_gen_percentage: number;
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
  PRE_AWARD: 'pre_award',
  CONTRACT: 'contract',
  SUPPORT: 'support',
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

// Communication polish (Wave 5 / Agent P) — chat relay aliases, user
// blocks, quick-reply templates. Mirror the JSON shapes returned by the
// gateway handlers (chat_relay.go / user_blocks.go / chat_templates.go).
export interface ChatAlias {
  id: string;
  user_id: string;
  context_type: 'listing' | 'job';
  context_id: string;
  email_alias: string;
  twilio_proxy_phone: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface ChatAliasesResponse {
  aliases: ChatAlias[];
  twilio_configured: boolean;
}

export interface CreateChatAliasInput {
  context_type: 'listing' | 'job';
  context_id: string;
}

export interface UserBlock {
  blocked_id: string;
  display_name: string;
  avatar_url: string | null;
  reason: string | null;
  blocked_at: string;
}

export interface UserBlocksResponse {
  blocks: UserBlock[];
  pagination: PaginationResponse;
}

export interface MessageTemplate {
  id: string;
  body: string;
  use_count: number;
  created_at: string;
}

export interface MessageTemplatesResponse {
  templates: MessageTemplate[];
  defaults: string[];
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

// Fraud Detection types
export const FRAUD_SIGNAL_TYPE = {
  VELOCITY: 'velocity',
  GEO_MISMATCH: 'geo_mismatch',
  DEVICE_FINGERPRINT: 'device_fingerprint',
  SHILL_BID: 'shill_bid',
  ACCOUNT_TAKEOVER: 'account_takeover',
  PAYMENT_FRAUD: 'payment_fraud',
  FAKE_REVIEW: 'fake_review',
  MULTI_ACCOUNT: 'multi_account',
  BOT_BEHAVIOR: 'bot_behavior',
} as const;
export type FraudSignalType = (typeof FRAUD_SIGNAL_TYPE)[keyof typeof FRAUD_SIGNAL_TYPE];

export const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type RiskLevel = (typeof RISK_LEVEL)[keyof typeof RISK_LEVEL];

export const FRAUD_DECISION = {
  ALLOW: 'allow',
  ALLOW_WITH_REVIEW: 'allow_with_review',
  CHALLENGE: 'challenge',
  BLOCK: 'block',
} as const;
export type FraudDecision = (typeof FRAUD_DECISION)[keyof typeof FRAUD_DECISION];

export const ALERT_STATUS = {
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  RESOLVED_FRAUD: 'resolved_fraud',
  RESOLVED_LEGITIMATE: 'resolved_legitimate',
  DISMISSED: 'dismissed',
} as const;
export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

export interface FraudSignal {
  id: string;
  user_id: string;
  signal_type: FraudSignalType;
  confidence: number;
  risk_level: RiskLevel;
  ip_address: string;
  device_fingerprint: string;
  description: string;
  reference_entity_type: string;
  reference_entity_id: string;
  created_at: string;
}

export interface FraudAlert {
  id: string;
  user_id: string;
  signals: FraudSignal[];
  aggregate_risk_level: RiskLevel;
  status: AlertStatus;
  assigned_admin_id: string;
  resolution_notes: string;
  auto_resolved: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface UserRiskProfile {
  user_id: string;
  overall_risk_score: number;
  risk_level: RiskLevel;
  total_signals: number;
  active_alerts: number;
  recent_signal_types: FraudSignalType[];
  is_restricted: boolean;
  last_checked_at: string;
}

export interface FraudAlertsResponse {
  alerts: FraudAlert[];
  pagination: PaginationResponse;
}

export interface ReviewAlertInput {
  status: AlertStatus;
  resolution_notes: string;
  restrict_user: boolean;
}

// Notification types
export const NOTIFICATION_TYPE = {
  NEW_BID: 'new_bid',
  BID_AWARDED: 'bid_awarded',
  BID_NOT_SELECTED: 'bid_not_selected',
  AUCTION_CLOSING_SOON: 'auction_closing_soon',
  AUCTION_CLOSED: 'auction_closed',
  OFFER_ACCEPTED: 'offer_accepted',
  CONTRACT_CREATED: 'contract_created',
  CONTRACT_ACCEPTED: 'contract_accepted',
  WORK_STARTED: 'work_started',
  MILESTONE_SUBMITTED: 'milestone_submitted',
  MILESTONE_APPROVED: 'milestone_approved',
  REVISION_REQUESTED: 'revision_requested',
  WORK_COMPLETED: 'work_completed',
  COMPLETION_APPROVED: 'completion_approved',
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_RELEASED: 'payment_released',
  PAYMENT_FAILED: 'payment_failed',
  PAYOUT_SENT: 'payout_sent',
  NEW_MESSAGE: 'new_message',
  REVIEW_RECEIVED: 'review_received',
  REVIEW_REMINDER: 'review_reminder',
  DISPUTE_OPENED: 'dispute_opened',
  DISPUTE_RESOLVED: 'dispute_resolved',
  TIER_UPGRADE: 'tier_upgrade',
  TIER_DOWNGRADE: 'tier_downgrade',
  // Pre-matching
  JOB_MATCHED: 'job_matched',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

export const NOTIFICATION_CHANNEL = {
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in_app',
} as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

export interface Notification {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  action_url: string;
  data: Record<string, string>;
  is_read: boolean;
  channels_sent: NotificationChannel[];
  created_at: string;
  read_at: string | null;
}

export interface NotificationPreference {
  notification_type: NotificationType;
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  in_app_enabled: boolean;
}

export interface NotificationsResponse {
  notifications: Notification[];
  pagination: PaginationResponse;
}

export interface NotificationUnreadCountResponse {
  count: number;
}

export interface PreferencesResponse {
  preferences: NotificationPreference[];
  global_push_enabled: boolean;
  global_email_enabled: boolean;
  global_sms_enabled: boolean;
}

export interface UpdatePreferencesInput {
  preferences: NotificationPreference[];
  global_push_enabled?: boolean;
  global_email_enabled?: boolean;
  global_sms_enabled?: boolean;
}

// Image Pipeline types
export const UPLOAD_CONTEXT = {
  AVATAR: 'avatar',
  PORTFOLIO: 'portfolio',
  JOB_PHOTO: 'job_photo',
  DOCUMENT: 'document',
  REVIEW_PHOTO: 'review_photo',
  LISTING: 'listing',
} as const;
export type UploadContext = (typeof UPLOAD_CONTEXT)[keyof typeof UPLOAD_CONTEXT];

export interface ImageVariant {
  url: string;
  width: number;
  height: number;
  format: string;
  size_bytes: number;
  variant_name: string;
}

export interface UploadURLResponse {
  upload_url: string;
  object_key: string;
  expires_at: string;
}

export interface ConfirmUploadResponse {
  confirmed_url: string;
  content_type_valid: boolean;
  actual_content_type: string;
}

export interface ProcessImageResponse {
  variant: ImageVariant;
  blur_hash: string | null;
}

// Subscription types
export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  TRIALING: 'trialing',
} as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const BILLING_INTERVAL = {
  MONTHLY: 'monthly',
  ANNUAL: 'annual',
} as const;
export type BillingInterval = (typeof BILLING_INTERVAL)[keyof typeof BILLING_INTERVAL];

export interface SubscriptionTier {
  id: string;
  name: string;
  slug: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  fee_discount_percentage: number;
  max_active_bids: number;
  max_service_categories: number;
  portfolio_image_limit: number;
  featured_placement: boolean;
  analytics_access: boolean;
  priority_support: boolean;
  verified_badge_boost: boolean;
  instant_enabled: boolean;
  sort_order: number;
}

export interface Subscription {
  id: string;
  user_id: string;
  tier_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_price_cents: number;
  current_period_start: string;
  current_period_end: string;
  trial_end?: string;
  cancelled_at?: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  subscription_id: string;
  stripe_invoice_id: string;
  amount_cents: number;
  status: string;
  pdf_url: string;
  period_start: string;
  period_end: string;
  paid_at?: string;
}

export interface SubscriptionUsage {
  active_bids: number;
  max_active_bids: number;
  service_categories: number;
  max_service_categories: number;
  portfolio_images: number;
  max_portfolio_images: number;
  current_fee_percentage: number;
}

export interface CreateSubscriptionInput {
  tier_id: string;
  billing_interval: BillingInterval;
  payment_method_id: string;
}

export interface CancelSubscriptionInput {
  reason: string;
  cancel_immediately: boolean;
}

export interface ChangeTierInput {
  new_tier_id: string;
  billing_interval: BillingInterval;
}

// Analytics types
export interface AnalyticsMarketRange {
  category_id: string;
  subcategory_id: string;
  service_type_id: string;
  region: string;
  low_cents: number;
  median_cents: number;
  high_cents: number;
  data_points: number;
  source: string;
  confidence: number;
  computed_at: string;
}

export interface ProviderAnalytics {
  total_bids: number;
  bids_won: number;
  win_rate: number;
  average_bid_cents: number;
  jobs_completed: number;
  jobs_in_progress: number;
  on_time_rate: number;
  completion_rate: number;
  total_earnings_cents: number;
  average_job_value_cents: number;
  average_rating: number;
  total_reviews: number;
  rating_trend: number;
  avg_response_time_minutes: number;
  category_breakdown: CategoryEarnings[];
}

export interface CategoryEarnings {
  category_id: string;
  category_name: string;
  jobs_completed: number;
  total_earnings_cents: number;
  average_rating: number;
}

export interface EarningsDataPoint {
  period_start: string;
  earnings_cents: number;
  fees_cents: number;
  job_count: number;
}

export interface ProviderEarningsResponse {
  data_points: EarningsDataPoint[];
  total_earnings_cents: number;
  total_fees_cents: number;
  net_earnings_cents: number;
  total_jobs: number;
}

export interface SpendingDataPoint {
  period_start: string;
  amount_cents: number;
  job_count: number;
}

export interface CategorySpending {
  category_id: string;
  category_name: string;
  total_spent_cents: number;
  job_count: number;
}

export interface CustomerSpendingResponse {
  data_points: SpendingDataPoint[];
  total_spent_cents: number;
  total_jobs: number;
  average_job_cost_cents: number;
  total_savings_cents: number;
  category_breakdown: CategorySpending[];
}

// ────────────────────────────────────────
// Admin Dashboard types
// ────────────────────────────────────────

export const DISPUTE_STATUS = {
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
} as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[keyof typeof DISPUTE_STATUS];

export const DISPUTE_RESOLUTION_TYPE = {
  FAVOR_CUSTOMER: 'favor_customer',
  FAVOR_PROVIDER: 'favor_provider',
  SPLIT: 'split',
  DISMISSED: 'dismissed',
} as const;
export type DisputeResolutionType =
  (typeof DISPUTE_RESOLUTION_TYPE)[keyof typeof DISPUTE_RESOLUTION_TYPE];

export const FLAG_STATUS = {
  PENDING: 'pending',
  UPHELD: 'upheld',
  DISMISSED: 'dismissed',
} as const;
export type FlagStatus = (typeof FLAG_STATUS)[keyof typeof FLAG_STATUS];

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  phone: string;
  roles: string[];
  status: UserStatus;
  avatar_url: string;
  email_verified?: boolean;
  phone_verified?: boolean;
  created_at: string;
  last_login_at?: string;
  last_active_at?: string;
  provider_profile?: AdminProviderProfile;
}

export interface AdminProviderProfile {
  display_name: string;
  business_name: string;
  bio: string;
  trust_score?: number;
  trust_tier?: string;
  jobs_completed: number;
  average_rating: number;
  total_reviews: number;
}

export interface VerificationDocument {
  id: string;
  user_id: string;
  user_name: string;
  document_type: string;
  status: string;
  submitted_at: string;
  reviewed_at?: string;
  reviewer_notes?: string;
}

export interface Dispute {
  id: string;
  contract_id: string;
  initiated_by: string;
  initiator_name?: string;
  respondent_name?: string;
  reason: string;
  status: DisputeStatus;
  resolution_type?: DisputeResolutionType;
  resolution_notes?: string;
  refund_amount_cents?: number;
  is_guarantee_claim: boolean;
  guarantee_outcome?: string;
  guarantee_payout_cents?: number;
  created_at: string;
  resolved_at?: string;
}

export interface GuaranteeClaim {
  id: string;
  contract_id: string;
  opened_by: string;
  dispute_type: string;
  description: string;
  evidence_urls: string[];
  status: DisputeStatus;
  is_guarantee_claim: true;
  guarantee_outcome?: string;
  resolution_type?: string;
  resolution_notes?: string;
  refund_amount_cents?: number;
  created_at: string;
  resolved_at?: string;
}

export interface FlaggedReview {
  id: string;
  review_id: string;
  flagged_by: string;
  reason: string;
  status: FlagStatus;
  review_content: string;
  reviewer_name: string;
  review_rating: number;
  created_at: string;
}

export interface RevenueReport {
  data_points: RevenueDataPoint[];
  total_gmv_cents: number;
  total_revenue_cents: number;
  total_guarantee_fund_cents: number;
  effective_take_rate: number;
}

export interface RevenueDataPoint {
  period_start: string;
  gmv_cents: number;
  revenue_cents: number;
  transaction_count: number;
}

export interface PlatformMetrics {
  total_gmv_cents: number;
  total_revenue_cents: number;
  total_guarantee_fund_cents: number;
  effective_take_rate: number;
  total_users: number;
  active_users: number;
  new_users: number;
  total_jobs_posted: number;
  total_jobs_completed: number;
  job_fill_rate: number;
  job_completion_rate: number;
  total_bids: number;
  avg_bids_per_job: number;
  disputes_opened: number;
  disputes_resolved: number;
  dispute_rate: number;
  guarantee_claims: number;
  guarantee_payouts_cents: number;
}

export interface GrowthDataPoint {
  period_start: string;
  new_users: number;
  new_providers: number;
  jobs_posted: number;
  jobs_completed: number;
  gmv_cents: number;
  revenue_cents: number;
}

export interface GrowthMetrics {
  data_points: GrowthDataPoint[];
  gmv_growth_rate: number;
  user_growth_rate: number;
  job_growth_rate: number;
}

export interface CategoryMetric {
  category_id: string;
  category_name: string;
  jobs_posted: number;
  jobs_completed: number;
  total_gmv_cents: number;
  avg_bid_cents: number;
  avg_bids_per_job: number;
}

export interface AdminSearchParams {
  query?: string;
  status?: string;
  role?: string;
  page?: number;
  page_size?: number;
}

export interface AdminJobSearchParams {
  status?: string;
  customer_id?: string;
  category_id?: string;
  page?: number;
  page_size?: number;
}

export interface AdminPaymentSearchParams {
  user_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: PaginationResponse;
}

export interface AdminJobsResponse {
  jobs: Job[];
  pagination: PaginationResponse;
}

export interface AdminDisputesResponse {
  disputes: Dispute[];
  pagination: PaginationResponse;
}

export interface AdminFlaggedReviewsResponse {
  flags: FlaggedReview[];
  pagination: PaginationResponse;
}

export interface AdminPaymentsResponse {
  payments: Payment[];
  pagination: PaginationResponse;
}

export interface FeeConfig {
  category_id: string;
  fee_percentage: number;
  guarantee_percentage: number;
  min_fee_cents: number;
  max_fee_cents: number;
  // Lead-gen fee — an ADDITIVE fee charged on won contracts, on top of the
  // platform + guarantee fees. Sent/returned in the same units as the sibling
  // fields above: whole-number percentage (e.g. 10.0 means 10%) and integer
  // cents. `lead_gen_max_fee_cents` is null when there is no cap.
  lead_gen_enabled: boolean;
  lead_gen_percentage: number;
  lead_gen_min_fee_cents: number;
  lead_gen_max_fee_cents: number | null;
}

export interface CategoryMetricsResponse {
  categories: CategoryMetric[];
}

// ────────────────────────────────────────
// Platform banking (admin) — where all platform fees route
// ────────────────────────────────────────

export const BANK_ACCOUNT_HOLDER_TYPE = {
  INDIVIDUAL: 'individual',
  COMPANY: 'company',
} as const;
export type BankAccountHolderType =
  (typeof BANK_ACCOUNT_HOLDER_TYPE)[keyof typeof BANK_ACCOUNT_HOLDER_TYPE];

export interface PlatformBankAccount {
  id: string;
  bank_name: string;
  account_holder_name: string;
  account_holder_type: BankAccountHolderType;
  last4: string;
  routing_last4: string;
  currency: string;
  country: string;
  status: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformBankingResponse {
  account: PlatformBankAccount | null;
}

// Sent to our backend AFTER tokenizing with Stripe.js. Raw account/routing
// numbers MUST NOT appear here — only the Stripe bank-account token (btok_...).
export interface CreatePlatformBankAccountInput {
  bank_account_token: string;
  account_holder_name: string;
  account_holder_type: BankAccountHolderType;
}

// ────────────────────────────────────────
// Working Capital types
// ────────────────────────────────────────

export const ADVANCE_STATUS = {
  REQUESTED: 'requested',
  APPROVED: 'approved',
  DISBURSED: 'disbursed',
  REPAYING: 'repaying',
  REPAID: 'repaid',
  DEFAULTED: 'defaulted',
  REJECTED: 'rejected',
} as const;
export type AdvanceStatus = (typeof ADVANCE_STATUS)[keyof typeof ADVANCE_STATUS];

export interface WorkingCapitalAdvance {
  id: string;
  provider_id: string;
  contract_id: string;
  contract_number?: string;
  advance_amount_cents: number;
  fee_cents: number;
  repaid_cents: number;
  status: AdvanceStatus;
  reviewed_at?: string;
  rejection_reason?: string;
  disbursed_at?: string;
  repaid_at?: string;
  stripe_transfer_id?: string;
  created_at: string;
}

export interface CreditLimit {
  max_advance_cents: number;
  total_outstanding_cents: number;
  available_cents: number;
  risk_score: number;
}

export interface AdvancesResponse {
  advances: WorkingCapitalAdvance[];
  pagination: PaginationResponse;
}

// ────────────────────────────────────────
// Expense types
// ────────────────────────────────────────

export const EXPENSE_CATEGORY = {
  MATERIALS: 'materials',
  TOOLS: 'tools',
  TRANSPORTATION: 'transportation',
  INSURANCE: 'insurance',
  LICENSING: 'licensing',
  MARKETING: 'marketing',
  SUBCONTRACTOR: 'subcontractor',
  OFFICE: 'office',
  OTHER: 'other',
} as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORY)[keyof typeof EXPENSE_CATEGORY];

export interface ProviderExpense {
  id: string;
  provider_id: string;
  category: ExpenseCategory;
  description: string;
  amount_cents: number;
  receipt_url?: string;
  expense_date: string;
  created_at: string;
}

export interface ExpensesResponse {
  expenses: ProviderExpense[];
  total_cents: number;
}

// ────────────────────────────────────────
// Installment types
// ────────────────────────────────────────

export interface InstallmentInfo {
  installment_number: number;
  total_installments: number;
  amount_cents: number;
  status: string;
  due_date?: string;
  paid_at?: string;
}

// ────────────────────────────────────────
// BNPL / Installment Plan types
// ────────────────────────────────────────

export const INSTALLMENT_PLAN_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DEFAULTED: 'defaulted',
  CANCELLED: 'cancelled',
} as const;
export type InstallmentPlanStatus =
  (typeof INSTALLMENT_PLAN_STATUS)[keyof typeof INSTALLMENT_PLAN_STATUS];

export const SCHEDULED_INSTALLMENT_STATUS = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  RETRYING: 'retrying',
} as const;
export type ScheduledInstallmentStatus =
  (typeof SCHEDULED_INSTALLMENT_STATUS)[keyof typeof SCHEDULED_INSTALLMENT_STATUS];

export interface InstallmentPlan {
  id: string;
  contract_id: string;
  customer_id: string;
  provider_id: string;
  total_amount_cents: number;
  bnpl_fee_cents: number;
  total_with_fee_cents: number;
  installment_count: number;
  per_installment_cents: number;
  fee_rate: number;
  status: InstallmentPlanStatus;
  provider_paid_at: string | null;
  installments: ScheduledInstallment[];
  created_at: string;
}

export interface ScheduledInstallment {
  id: string;
  installment_number: number;
  amount_cents: number;
  due_date: string;
  status: ScheduledInstallmentStatus;
  payment_id: string | null;
  paid_at: string | null;
}

export interface CreateInstallmentPlanInput {
  contract_id: string;
  customer_id: string;
  provider_id: string;
  total_amount_cents: number;
  installment_count: 3 | 6;
  payment_method_id: string;
  idempotency_key: string;
}

export interface InstallmentPlansResponse {
  plans: InstallmentPlan[];
  pagination: PaginationResponse;
}

// ────────────────────────────────────────
// Company Employee types
// ────────────────────────────────────────

export const EMPLOYEE_ROLE = {
  TECHNICIAN: 'technician',
  LEAD: 'lead',
  MANAGER: 'manager',
  APPRENTICE: 'apprentice',
} as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLE)[keyof typeof EMPLOYEE_ROLE];

export const EMPLOYEE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
} as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[keyof typeof EMPLOYEE_STATUS];

export const BACKGROUND_CHECK_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
} as const;
export type BackgroundCheckStatus =
  (typeof BACKGROUND_CHECK_STATUS)[keyof typeof BACKGROUND_CHECK_STATUS];

export interface CompanyEmployee {
  id: string;
  provider_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  role: EmployeeRole;
  status: EmployeeStatus;
  hire_date: string | null;
  background_check_status: BackgroundCheckStatus;
  background_check_date: string | null;
  license_number: string | null;
  license_state: string | null;
  license_expiry: string | null;
  insurance_policy_number: string | null;
  insurance_expiry: string | null;
  created_at: string;
}

export interface AddEmployeeInput {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  role: EmployeeRole;
  license_number?: string;
  license_state?: string;
  license_expiry?: string;
}

// Challenge types
export const CHALLENGE_TYPE = {
  JOBS_COMPLETED: 'jobs_completed',
  FIVE_STAR_REVIEWS: 'five_star_reviews',
  RESPONSE_TIME: 'response_time',
  BID_WIN_RATE: 'bid_win_rate',
  REVENUE_MILESTONE: 'revenue_milestone',
  CATEGORY_SPECIALIST: 'category_specialist',
} as const;
export type ChallengeType = (typeof CHALLENGE_TYPE)[keyof typeof CHALLENGE_TYPE];

export const REWARD_TYPE = {
  BADGE: 'badge',
  PRIORITY_PLACEMENT: 'priority_placement',
  FEE_DISCOUNT: 'fee_discount',
  PROFILE_HIGHLIGHT: 'profile_highlight',
} as const;
export type RewardType = (typeof REWARD_TYPE)[keyof typeof REWARD_TYPE];

export interface ChallengeProgress {
  current_progress: number;
  percent_complete: number;
  completed: boolean;
  reward_claimed: boolean;
  completed_at?: string;
  joined_at?: string;
}

export interface LeaderboardEntry {
  rank: number;
  provider_id: string;
  display_name: string;
  avatar_url: string | null;
  current_progress: number;
  percent_complete: number;
  completed: boolean;
  completed_at?: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  challenge_type: ChallengeType;
  target_value: number;
  reward_type: RewardType;
  reward_value: string;
  starts_at: string;
  ends_at: string;
  is_seasonal: boolean;
  season_name: string | null;
  max_participants: number | null;
  participant_count: number;
  joined: boolean;
  my_progress?: ChallengeProgress;
  time_remaining_seconds: number;
}

export interface ChallengeDetail extends Challenge {
  leaderboard: LeaderboardEntry[];
  created_at: string;
}

export interface MyChallengeProgress {
  id: string;
  title: string;
  description: string;
  challenge_type: ChallengeType;
  target_value: number;
  reward_type: RewardType;
  reward_value: string;
  starts_at: string;
  ends_at: string;
  is_seasonal: boolean;
  season_name: string | null;
  current_progress: number;
  percent_complete: number;
  completed: boolean;
  reward_claimed: boolean;
  joined_at: string;
  completed_at?: string;
  time_remaining_seconds: number;
}

export interface AdminChallenge {
  id: string;
  title: string;
  description: string;
  challenge_type: ChallengeType;
  target_value: number;
  reward_type: RewardType;
  reward_value: string;
  starts_at: string;
  ends_at: string;
  is_seasonal: boolean;
  season_name: string | null;
  max_participants: number | null;
  participant_count: number;
  completed_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateChallengeInput {
  title: string;
  description: string;
  challenge_type: ChallengeType;
  target_value: number;
  reward_type: RewardType;
  reward_value: string;
  starts_at: string;
  ends_at: string;
  is_seasonal: boolean;
  season_name?: string;
  max_participants?: number;
}

// ────────────────────────────────────────
// Insurance types
// ────────────────────────────────────────

export const INSURANCE_POLICY_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  CLAIMED: 'claimed',
} as const;
export type InsurancePolicyStatus =
  (typeof INSURANCE_POLICY_STATUS)[keyof typeof INSURANCE_POLICY_STATUS];

export const INSURANCE_CLAIM_STATUS = {
  FILED: 'filed',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  DENIED: 'denied',
  PAID: 'paid',
} as const;
export type InsuranceClaimStatus =
  (typeof INSURANCE_CLAIM_STATUS)[keyof typeof INSURANCE_CLAIM_STATUS];

export interface InsuranceProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverage_type: string;
  base_rate_bps: number;
  min_premium_cents: number;
  max_coverage_cents: number | null;
  coverage_duration_days: number;
  deductible_cents: number;
  terms_markdown: string;
}

export interface InsuranceQuote {
  product_id: string;
  product_name: string;
  premium_cents: number;
  coverage_amount_cents: number;
  deductible_cents: number;
  coverage_duration_days: number;
}

export interface InsurancePolicy {
  id: string;
  policy_number: string;
  product: InsuranceProduct;
  contract_id: string;
  coverage_amount_cents: number;
  premium_cents: number;
  deductible_cents: number;
  effective_date: string;
  expiration_date: string;
  status: string;
  created_at: string;
}

export interface InsuranceClaim {
  id: string;
  claim_number: string;
  policy_id: string;
  claim_type: string;
  description: string;
  evidence_urls: string[];
  claimed_amount_cents: number;
  approved_amount_cents: number | null;
  payout_cents: number | null;
  status: string;
  denial_reason: string | null;
  created_at: string;
}

export interface FileInsuranceClaimInput {
  policy_id: string;
  claim_type: string;
  description: string;
  evidence_urls: string[];
  claimed_amount_cents: number;
}

export interface InsurancePoliciesResponse {
  policies: InsurancePolicy[];
  pagination: PaginationResponse;
}

export interface InsuranceClaimsResponse {
  claims: InsuranceClaim[];
  pagination: PaginationResponse;
}

// ────────────────────────────────────────
// Tax Form types
// ────────────────────────────────────────

export interface TaxForm {
  id: string;
  provider_id: string;
  tax_year: number;
  form_type: string;
  status: string;
  generated_at: string;
  download_url: string | null;
}

export interface TaxFormsResponse {
  forms: TaxForm[];
}

// ────────────────────────────────────────
// Goods Marketplace (Forward Auction) types
// ────────────────────────────────────────

export const LISTING_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  SOLD: 'sold',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;
export type ListingStatus = (typeof LISTING_STATUS)[keyof typeof LISTING_STATUS];

export const LISTING_DURATION_HOURS = {
  DAY: 24,
  TWO_DAYS: 48,
  WEEK: 168,
} as const;
export type ListingDurationHours =
  (typeof LISTING_DURATION_HOURS)[keyof typeof LISTING_DURATION_HOURS];

export const LISTING_ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  PICKED_UP: 'picked_up',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
} as const;
export type ListingOrderStatus =
  (typeof LISTING_ORDER_STATUS)[keyof typeof LISTING_ORDER_STATUS];

export interface ListingPhoto {
  id: string;
  url: string;
  blur_hash: string | null;
  sort_order: number;
}

export interface Listing {
  id: string;
  seller_id: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  title: string;
  description: string;
  status: ListingStatus;
  photos: ListingPhoto[];
  pickup_zip: string;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_address: string | null; // only present after winner is chosen
  pickup_lat: number | null;
  pickup_lng: number | null;
  starting_price_cents: number;
  current_bid_cents: number;
  min_increment_cents: number;
  /** Hidden minimum to actually win. null = no reserve. */
  reserve_price_cents?: number | null;
  /** Optional fixed-price closeout. null = auction-only. */
  buy_now_price_cents?: number | null;
  /**
   * Whether the current high bid meets the reserve. null when the listing
   * has no reserve set (most demo listings); true once `current_bid_cents`
   * crosses `reserve_price_cents`; false until then.
   */
  reserve_met?: boolean | null;
  bidder_count: number;
  bid_count: number;
  auction_duration_hours: number;
  auction_ends_at: string | null;
  snipe_extension_count: number;
  distance_km: number | null;
  is_user_winning: boolean;
  was_outbid: boolean;
  /**
   * StockX-style condition grade. null = seller didn't say. When set the
   * scoreboard surfaces a condition pill on the listing card.
   */
  condition?:
    | 'new'
    | 'like_new'
    | 'very_good'
    | 'good'
    | 'acceptable'
    | 'for_parts'
    | null;
  /**
   * Live spectator count from the gateway's Redis sorted-set aggregator.
   * Optional because legacy responses may omit it; the scoreboard treats
   * undefined as zero.
   */
  watcher_count?: number;
  /**
   * Highest pending Best-Offer + the buyer who made it. null when no
   * pending offer exists. Surfaced inline so the marketplace card and
   * detail page can render the offer banner without a second roundtrip.
   */
  current_offer_amount_cents?: number | null;
  current_offer_buyer_id?: string | null;
  /**
   * Wave 5 power-seller flags. Set when the seller pays for placement
   * via `POST /listings/{id}/promote`. The scoreboard renders a small
   * "Promoted" pill in the corner when both fields are truthy AND
   * `promoted_until` is still in the future.
   */
  is_promoted?: boolean;
  promoted_until?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListingDetail extends Listing {
  seller_display_name: string;
  seller_member_since: string;
  seller_listings_count: number;
  seller_trust_tier: TrustTier | null;
  seller_trust_score: number | null;
}

// ────────────────────────────────────────
// Best-Offer / counter-offer chain
// ────────────────────────────────────────

export const OFFER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  COUNTERED: 'countered',
  WITHDRAWN: 'withdrawn',
  EXPIRED: 'expired',
} as const;
export type OfferStatus = (typeof OFFER_STATUS)[keyof typeof OFFER_STATUS];

/**
 * Represents a single offer (or counter-offer) in the Best-Offer chain.
 * Counter-offers carry parent_offer_id pointing back at the offer they
 * respond to; the parent flips to status='countered' the moment the
 * seller posts the counter.
 */
export interface Offer {
  id: string;
  listing_id: string;
  buyer_id: string;
  amount_cents: number;
  status: OfferStatus;
  parent_offer_id: string | null;
  expires_at: string;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OffersResponse {
  offers: Offer[];
}

// ────────────────────────────────────────
// Auction replay (goods side)
// ────────────────────────────────────────

export type AuctionReplayEventType =
  | 'bid_placed'
  | 'snipe_extension'
  | 'auto_bid_cascade';

export interface AuctionReplayEvent {
  type: AuctionReplayEventType;
  at: string;
  amount_cents?: number;
  anonymized_bidder?: string;
  extended_to?: string;
  from?: number;
  to?: number;
}

export interface ListingAuctionReplay {
  listing_id: string;
  started_at: string;
  ended_at: string | null;
  winner_id: string | null;
  events: AuctionReplayEvent[];
}

export interface ListingBid {
  id: string;
  listing_id: string;
  bidder_id: string;
  bidder_display_name: string;
  amount_cents: number;
  is_winning: boolean;
  created_at: string;
}

export interface ListingBidHistory {
  bids: ListingBid[];
  current_bid_cents: number;
  bidder_count: number;
}

export interface CreateListingInput {
  category_id: string;
  title: string;
  description: string;
  photo_urls: string[];
  pickup_zip: string;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  starting_price_cents: number;
  /** Hidden minimum to actually win. Omit for no-reserve auctions. */
  reserve_price_cents?: number;
  /** Optional fixed-price closeout. Omit for auction-only listings. */
  buy_now_price_cents?: number;
  /** Optional StockX-style condition grade. Omit for "seller didn't say". */
  condition?:
    | 'new'
    | 'like_new'
    | 'very_good'
    | 'good'
    | 'acceptable'
    | 'for_parts'
    | null;
  auction_duration_hours: ListingDurationHours;
  publish?: boolean;
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  photo_urls?: string[];
  pickup_zip?: string;
  pickup_address?: string;
  starting_price_cents?: number;
  auction_duration_hours?: ListingDurationHours;
}

export interface PlaceListingBidInput {
  amount_cents: number;
  max_bid_cents?: number;
}

export interface PlaceListingBidResponse {
  bid: ListingBid;
  current_bid_cents: number;
  bidder_count: number;
  /** New auction end time when a snipe extension was triggered */
  snipe_extension_applied: boolean;
  new_auction_ends_at: string | null;
}

export interface SearchListingsParams {
  query?: string;
  category_id?: string;
  pickup_zip?: string;
  radius_km?: number;
  min_price_cents?: number;
  max_price_cents?: number;
  ending_soon?: boolean;
  sort_by?: 'ending_soon' | 'newest' | 'lowest_price' | 'highest_price' | 'distance' | 'trending';
  lat?: number;
  lng?: number;
  page?: number;
  page_size?: number;
}

export interface ListingsResponse {
  listings: Listing[];
  pagination: PaginationResponse;
}

/**
 * Autocomplete suggestion from /api/v1/listings/autocomplete.
 *
 * Two flavors are returned in a single, sorted list:
 *   - type='category' carries `category_slug` + `label`
 *   - type='listing'  carries `id`, `title`, `category_slug`, `starting_price_cents`
 *
 * The component layer (SearchBar) renders them with different affordances
 * (chip vs. row) but treats the dropdown as a single keyboard list.
 */
export interface AutocompleteSuggestion {
  type: 'listing' | 'category';
  id?: string;
  title?: string;
  category_slug?: string;
  label?: string;
  starting_price_cents?: number;
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
}

/**
 * Response from /api/v1/listings/{id}/similar — up to 12 fully-hydrated
 * Listing rows ranked by Meilisearch relevance against the source.
 */
export interface SimilarListingsResponse {
  listings: Listing[];
}

export interface MyListingsResponse {
  listings: Listing[];
  pagination: PaginationResponse;
}

export interface MyListingBid {
  bid: ListingBid;
  listing: Listing;
}

export interface MyListingBidsResponse {
  bids: MyListingBid[];
  pagination: PaginationResponse;
}

export interface ListingOrder {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_photo_url: string | null;
  buyer_id: string;
  seller_id: string;
  seller_display_name: string;
  pickup_address: string;
  pickup_zip: string;
  pickup_city: string;
  pickup_state: string;
  amount_cents: number;
  platform_fee_cents: number;
  status: ListingOrderStatus;
  channel_id: string | null;
  paid_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
  dispute_window_ends_at: string | null;
  created_at: string;
}

// ────────────────────────────────────────
// AI auto-fill: listing image analysis
// ────────────────────────────────────────

export type ListingAnalysisCondition =
  | 'new'
  | 'like_new'
  | 'very_good'
  | 'good'
  | 'acceptable'
  | 'for_parts';

export type ListingAnalysisConfidence = 'low' | 'medium' | 'high';

export interface ListingImageAnalysisResult {
  categorySlug: string;
  title: string;
  description: string;
  suggestedStartingPriceCents: number;
  condition: ListingAnalysisCondition;
  confidence: ListingAnalysisConfidence;
}

// ────────────────────────────────────────
// Wave 5 — power-seller analytics + paid promotions
// ────────────────────────────────────────

export interface SellerAnalyticsDailyPoint {
  date: string;
  gross_cents: number;
  order_count: number;
}

export interface SellerAnalyticsTopCategory {
  category_id: string;
  category_name: string;
  count: number;
}

export interface SellerAnalytics {
  range_days: number;
  daily_revenue: SellerAnalyticsDailyPoint[];
  sell_through_rate: number;
  avg_sale_price_cents: number;
  total_gross_cents: number;
  total_sold: number;
  total_listed: number;
  top_categories: SellerAnalyticsTopCategory[];
}

export const PROMOTION_DURATION_HOURS = {
  ONE_DAY: 24,
  THREE_DAYS: 72,
  ONE_WEEK: 168,
} as const;
export type PromotionDurationHours =
  (typeof PROMOTION_DURATION_HOURS)[keyof typeof PROMOTION_DURATION_HOURS];

export const PROMOTION_TIERS: ReadonlyArray<{
  duration_hours: PromotionDurationHours;
  amount_cents: number;
  label: string;
}> = [
  { duration_hours: 24, amount_cents: 500, label: '24 hours' },
  { duration_hours: 72, amount_cents: 1200, label: '3 days' },
  { duration_hours: 168, amount_cents: 2500, label: '1 week' },
];

export interface PromoteListingInput {
  duration_hours: PromotionDurationHours;
  payment_method_id?: string;
}

export interface PromoteListingResponse {
  charge_id: string;
  listing_id: string;
  duration_hours: number;
  amount_cents: number;
  stripe_client_secret: string;
  promoted_until_estimate: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
}

export interface ConfirmPromotionResponse {
  charge_id: string;
  listing_id: string;
  is_promoted: boolean;
  promoted_until: string;
  status: 'succeeded';
}

// Wave 5 pickup polish — buyer + seller mutual handshake.
export interface ConfirmPickupInput {
  pickup_code?: string;
  selfie_url?: string;
  handoff_photo_url?: string;
}

export interface ConfirmPickupResponse {
  order_id: string;
  escrow_status: string;
  seller_payout_cents: number;
  pickup_confirmed_at: string;
  both_confirmed: boolean;
}

export interface SellerConfirmResponse {
  order_id: string;
  escrow_status: string;
  seller_confirmed_at: string;
  both_confirmed: boolean;
}

export interface ReportNoShowResponse {
  order_id: string;
  reported_user_id: string;
  new_no_show_count: number;
  cooldown_until: string;
  shadow_ban_triggered: boolean;
}

// ────────────────────────────────────────
// Wave 5 services-polish (Section H)
// ────────────────────────────────────────

export const CATEGORY_QUESTION_TYPE = {
  TEXT: 'text',
  NUMBER: 'number',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  BOOLEAN: 'boolean',
  DATE: 'date',
} as const;
export type CategoryQuestionType =
  (typeof CATEGORY_QUESTION_TYPE)[keyof typeof CATEGORY_QUESTION_TYPE];

/**
 * Pre-quote question tied to a service category. Customers answer
 * these on the post-job form so providers can quote off real scope.
 *
 * `options` is the raw JSONB payload — for select/multiselect it's a
 * string array (e.g. ["Single fixture","Whole bathroom"]); other
 * types ignore it.
 */
export interface CategoryQuestion {
  id: string;
  category_id: string;
  question: string;
  question_type: CategoryQuestionType;
  options?: string[] | null;
  required: boolean;
  display_order: number;
  created_at: string;
}

export interface CategoryQuestionsResponse {
  questions: CategoryQuestion[];
}

/**
 * One customer-submitted answer. Exactly one of answer_text /
 * answer_json is populated — text/select/date use answer_text;
 * multiselect/number/boolean round-trip as answer_json.
 */
export interface JobQuestionAnswer {
  id: string;
  job_id: string;
  question_id: string;
  answer_text?: string | null;
  answer_json?: unknown;
  created_at: string;
}

export interface SubmitAnswerInput {
  question_id: string;
  answer_text?: string;
  answer_json?: unknown;
}

export interface SubmitAnswersInput {
  answers: SubmitAnswerInput[];
}

/** Provider's reusable quote boilerplate. */
export interface QuoteTemplate {
  id: string;
  user_id: string;
  name: string;
  body: string;
  default_amount_cents?: number | null;
  default_duration_hours?: number | null;
  use_count: number;
  created_at: string;
}

export interface QuoteTemplatesResponse {
  templates: QuoteTemplate[];
}

export interface CreateQuoteTemplateInput {
  name: string;
  body: string;
  default_amount_cents?: number;
  default_duration_hours?: number;
}

export interface UpdateQuoteTemplateInput {
  name?: string;
  body?: string;
  default_amount_cents?: number;
  default_duration_hours?: number;
}

export interface ContractTipInput {
  amount_cents: number;
}

export interface ContractTipResponse {
  tip_amount_cents: number;
}
