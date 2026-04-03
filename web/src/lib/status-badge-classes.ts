/**
 * Glass-styled status badge classes for dark UI.
 *
 * Replaces the old light-first pattern (bg-green-100 dark:bg-green-950) with
 * a glass-tinted pattern that matches the auction/dashboard aesthetic.
 */

/** User account status */
export const USER_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-green-500/10 text-green-300 border-green-500/30',
  suspended: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  banned: 'bg-red-500/10 text-red-300 border-red-500/30',
  deactivated: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

/** Dispute status */
export const DISPUTE_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  investigating: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  resolved: 'bg-green-500/10 text-green-300 border-green-500/30',
  escalated: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Guarantee claim status (reuses dispute statuses) */
export const GUARANTEE_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  under_review: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  investigating: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  resolved: 'bg-green-500/10 text-green-300 border-green-500/30',
  escalated: 'bg-red-500/10 text-red-300 border-red-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  denied: 'bg-red-500/10 text-red-300 border-red-500/30',
  paid: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  closed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

/** Job status */
export const JOB_STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  active: 'bg-green-500/10 text-green-300 border-green-500/30',
  open: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  bidding: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  awarded: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  contract_pending: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  in_progress: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  completed: 'bg-green-500/10 text-green-300 border-green-500/30',
  reviewed: 'bg-green-500/10 text-green-300 border-green-500/30',
  disputed: 'bg-red-500/10 text-red-300 border-red-500/30',
  cancelled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  reposted: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  closed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  closed_zero_bids: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  suspended: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Payment status */
export const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  processing: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  escrow: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  released: 'bg-green-500/10 text-green-300 border-green-500/30',
  completed: 'bg-green-500/10 text-green-300 border-green-500/30',
  failed: 'bg-red-500/10 text-red-300 border-red-500/30',
  refunded: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  partially_refunded: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  disputed: 'bg-red-500/10 text-red-300 border-red-500/30',
  chargeback: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Advance (working capital) status */
export const ADVANCE_STATUS_CLASSES: Record<string, string> = {
  requested: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  disbursed: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  repaying: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  repaid: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  defaulted: 'bg-red-500/10 text-red-300 border-red-500/30',
  rejected: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Review flag status */
export const FLAG_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  upheld: 'bg-red-500/10 text-red-300 border-red-500/30',
  dismissed: 'bg-green-500/10 text-green-300 border-green-500/30',
};

/** Verification status */
export const VERIFICATION_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  rejected: 'bg-red-500/10 text-red-300 border-red-500/30',
  expired: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

/** Fraud alert risk level */
export const FRAUD_RISK_CLASSES: Record<string, string> = {
  low: 'bg-green-500/10 text-green-300 border-green-500/30',
  medium: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  high: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/10 text-red-300 border-red-500/30',
};

/** Fraud alert status */
export const FRAUD_ALERT_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  investigating: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  resolved_fraud: 'bg-green-500/10 text-green-300 border-green-500/30',
  resolved_legitimate: 'bg-green-500/10 text-green-300 border-green-500/30',
  dismissed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

/** Expense category */
export const EXPENSE_CATEGORY_CLASSES: Record<string, string> = {
  materials: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  tools: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  transportation: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  insurance: 'bg-green-500/10 text-green-300 border-green-500/30',
  licensing: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  marketing: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
  subcontractor: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  office: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  other: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
};
