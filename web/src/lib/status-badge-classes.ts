/**
 * Glass-styled status badge classes for dark UI.
 *
 * Semantic design-system tokens (trust / bid / status / brand) only —
 * no raw emerald/blue/amber hex utilities on chrome badges.
 */

/** User account status */
export const USER_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  suspended: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  banned: 'bg-destructive/10 text-destructive border-destructive/30',
  deactivated: 'bg-muted text-muted-foreground border-border',
};

/** Dispute status */
export const DISPUTE_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-status-open/10 text-status-open border-status-open/30',
  investigating: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  resolved: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  escalated: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
};

/** Guarantee claim status (reuses dispute statuses) */
export const GUARANTEE_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-status-open/10 text-status-open border-status-open/30',
  under_review: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  investigating: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  resolved: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  escalated: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  approved: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  denied: 'bg-destructive/10 text-destructive border-destructive/30',
  paid: 'bg-bid-winning/10 text-bid-winning border-bid-winning/30',
  closed: 'bg-muted text-muted-foreground border-border',
};

/** Job status */
export const JOB_STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  active: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  open: 'bg-status-open/10 text-status-open border-status-open/30',
  bidding: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
  awarded: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  contract_pending: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  in_progress: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
  completed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  reviewed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  disputed: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  reposted: 'bg-bid-active/10 text-bid-active border-bid-active/30',
  closed: 'bg-muted text-muted-foreground border-border',
  closed_zero_bids: 'bg-muted text-muted-foreground border-border',
  expired: 'bg-bid-expired/10 text-bid-expired border-bid-expired/30',
  suspended: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Contract status */
export const CONTRACT_STATUS_CLASSES: Record<string, string> = {
  pending_acceptance: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  active: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  completed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
  voided: 'bg-destructive/10 text-destructive border-destructive/30',
  abandoned: 'bg-destructive/10 text-destructive border-destructive/30',
  disputed: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  suspended: 'bg-muted text-muted-foreground border-border',
  expired: 'bg-muted text-muted-foreground border-border',
};

/** Milestone solid timeline-dot colors (filled circles, not glass badges) */
export const MILESTONE_STATUS_DOT_CLASSES: Record<string, string> = {
  pending: 'bg-muted-foreground',
  in_progress: 'bg-status-open',
  submitted: 'bg-trust-medium',
  approved: 'bg-status-completed',
  revision_requested: 'bg-status-disputed',
  disputed: 'bg-destructive',
};

/** Payment status */
export const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  processing: 'bg-status-open/10 text-status-open border-status-open/30',
  escrow: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  released: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  completed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  refunded: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  partially_refunded: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  disputed: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  chargeback: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Advance (working capital) status */
export const ADVANCE_STATUS_CLASSES: Record<string, string> = {
  requested: 'bg-status-open/10 text-status-open border-status-open/30',
  approved: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  disbursed: 'bg-bid-winning/10 text-bid-winning border-bid-winning/30',
  repaying: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
  repaid: 'bg-muted text-muted-foreground border-border',
  defaulted: 'bg-destructive/10 text-destructive border-destructive/30',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Review flag status */
export const FLAG_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  upheld: 'bg-destructive/10 text-destructive border-destructive/30',
  dismissed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
};

/** Verification status */
export const VERIFICATION_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  approved: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
  expired: 'bg-muted text-muted-foreground border-border',
};

/** Fraud alert risk level */
export const FRAUD_RISK_CLASSES: Record<string, string> = {
  low: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  medium: 'bg-trust-medium/10 text-trust-medium border-trust-medium/30',
  high: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Fraud alert status */
export const FRAUD_ALERT_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-status-open/10 text-status-open border-status-open/30',
  investigating: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  resolved_fraud: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  resolved_legitimate: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  dismissed: 'bg-muted text-muted-foreground border-border',
};

/** Insurance policy status */
export const INSURANCE_POLICY_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  expired: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
  claimed: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
};

/** Insurance claim status */
export const INSURANCE_CLAIM_STATUS_CLASSES: Record<string, string> = {
  filed: 'bg-status-open/10 text-status-open border-status-open/30',
  under_review: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  approved: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  denied: 'bg-destructive/10 text-destructive border-destructive/30',
  paid: 'bg-bid-winning/10 text-bid-winning border-bid-winning/30',
};

/** Installment plan status */
export const INSTALLMENT_PLAN_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-status-open/10 text-status-open border-status-open/30',
  completed: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  defaulted: 'bg-destructive/10 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

/** Scheduled installment status */
export const SCHEDULED_INSTALLMENT_STATUS_CLASSES: Record<string, string> = {
  scheduled: 'bg-muted text-muted-foreground border-border',
  processing: 'bg-status-open/10 text-status-open border-status-open/30',
  paid: 'bg-status-completed/10 text-status-completed border-status-completed/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  retrying: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
};

/** Expense category */
export const EXPENSE_CATEGORY_CLASSES: Record<string, string> = {
  materials: 'bg-status-open/10 text-status-open border-status-open/30',
  tools: 'bg-trust-elite/10 text-trust-elite border-trust-elite/30',
  transportation: 'bg-status-in-progress/10 text-status-in-progress border-status-in-progress/30',
  insurance: 'bg-trust-high/10 text-trust-high border-trust-high/30',
  licensing: 'bg-bid-active/10 text-bid-active border-bid-active/30',
  marketing: 'bg-brand-gold/10 text-brand-gold border-brand-gold/30',
  subcontractor: 'bg-status-disputed/10 text-status-disputed border-status-disputed/30',
  office: 'bg-muted text-muted-foreground border-border',
  other: 'bg-muted text-muted-foreground border-border',
};

/** Default muted badge when status is unknown */
export const DEFAULT_STATUS_CLASS =
  'bg-muted text-muted-foreground border-border';
