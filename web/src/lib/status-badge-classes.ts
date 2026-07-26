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
