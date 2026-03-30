'use client';

import { cn } from '@/lib/utils';

type IllustrationType =
  | 'no-jobs'
  | 'no-bids'
  | 'no-messages'
  | 'no-contracts'
  | 'no-notifications'
  | 'no-properties'
  | 'no-recurring'
  | 'search-empty'
  | 'error';

interface AnimatedIllustrationProps {
  type: IllustrationType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP: Record<
  NonNullable<AnimatedIllustrationProps['size']>,
  { width: number; height: number }
> = {
  sm: { width: 80, height: 80 },
  md: { width: 120, height: 120 },
  lg: { width: 160, height: 160 },
};

// ---------------------------------------------------------------
// No Jobs — Clipboard with floating animation + shimmering lines
// ---------------------------------------------------------------
function NoJobsIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No jobs found"
      className="illustration-float"
    >
      {/* Clipboard body */}
      <rect
        x="28"
        y="24"
        width="64"
        height="80"
        rx="8"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      {/* Clipboard clip */}
      <rect
        x="44"
        y="18"
        width="32"
        height="14"
        rx="4"
        className="fill-muted stroke-muted-foreground/30"
        strokeWidth="1.5"
      />
      {/* Clip hole */}
      <circle cx="60" cy="25" r="3" className="fill-background" />

      {/* Shimmering lines */}
      <rect x="40" y="48" width="40" height="4" rx="2" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0.15;0.35;0.15"
          dur="2.5s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="40" y="58" width="32" height="4" rx="2" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0.15;0.35;0.15"
          dur="2.5s"
          begin="0.3s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="40" y="68" width="36" height="4" rx="2" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0.15;0.35;0.15"
          dur="2.5s"
          begin="0.6s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="40" y="78" width="24" height="4" rx="2" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0.15;0.35;0.15"
          dur="2.5s"
          begin="0.9s"
          repeatCount="indefinite"
        />
      </rect>

      {/* Emerald accent checkmark circle (faded) */}
      <circle cx="60" cy="95" r="0" className="fill-emerald-500/20">
        <animate attributeName="r" values="0;6;0" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.3;0" dur="4s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Bids — Price tag with pendulum swing
// ---------------------------------------------------------------
function NoBidsIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No bids placed"
      className="illustration-swing"
    >
      {/* String */}
      <line
        x1="60"
        y1="10"
        x2="60"
        y2="30"
        className="stroke-muted-foreground/20"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Price tag body - hangs from string */}
      <g className="illustration-pendulum" style={{ transformOrigin: '60px 10px' }}>
        <line
          x1="60"
          y1="10"
          x2="60"
          y2="35"
          className="stroke-muted-foreground/20"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Tag shape */}
        <path
          d="M40 38 L80 38 L80 82 L60 96 L40 82 Z"
          className="fill-muted/60 stroke-muted-foreground/20"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Hole at top */}
        <circle
          cx="60"
          cy="46"
          r="4"
          className="fill-background stroke-muted-foreground/20"
          strokeWidth="1"
        />

        {/* Dollar sign */}
        <text
          x="60"
          y="72"
          textAnchor="middle"
          className="fill-muted-foreground/30"
          fontSize="20"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          $
        </text>

        {/* Subtle gold accent pulse */}
        <circle cx="60" cy="46" r="4" fill="none" strokeWidth="1">
          <animate attributeName="r" values="4;8;4" dur="3s" repeatCount="indefinite" />
          <animate
            attributeName="stroke"
            values="rgba(201,168,76,0);rgba(201,168,76,0.3);rgba(201,168,76,0)"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate attributeName="opacity" values="0;0.5;0" dur="3s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Messages — Speech bubble with typing dots
// ---------------------------------------------------------------
function NoMessagesIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No messages"
      className="illustration-bounce"
    >
      {/* Speech bubble */}
      <path
        d="M20 30 C20 24 25 20 32 20 L88 20 C95 20 100 24 100 30 L100 70 C100 76 95 80 88 80 L52 80 L36 96 L36 80 L32 80 C25 80 20 76 20 70 Z"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Typing dots */}
      <circle cx="46" cy="50" r="4" className="fill-muted-foreground/25">
        <animate attributeName="r" values="3;4.5;3" dur="1.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="50" r="4" className="fill-muted-foreground/25">
        <animate
          attributeName="r"
          values="3;4.5;3"
          dur="1.2s"
          begin="0.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.2;0.5;0.2"
          dur="1.2s"
          begin="0.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="74" cy="50" r="4" className="fill-muted-foreground/25">
        <animate
          attributeName="r"
          values="3;4.5;3"
          dur="1.2s"
          begin="0.4s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.2;0.5;0.2"
          dur="1.2s"
          begin="0.4s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Contracts — Handshake with pulse
// ---------------------------------------------------------------
function NoContractsIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No contracts"
      className="illustration-pulse"
    >
      {/* Document base */}
      <rect
        x="30"
        y="16"
        width="60"
        height="76"
        rx="6"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      {/* Document fold */}
      <path d="M72 16 L90 34" className="stroke-muted-foreground/10" strokeWidth="1.5" />
      <path
        d="M72 16 L72 34 L90 34"
        className="fill-muted/40 stroke-muted-foreground/15"
        strokeWidth="1"
      />

      {/* Handshake icon in center */}
      <g transform="translate(42, 44)">
        {/* Left hand */}
        <path
          d="M0 18 L8 10 L16 14 L22 10 L28 14"
          className="stroke-muted-foreground/30"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Right hand */}
        <path
          d="M36 18 L28 10 L22 14 L16 10 L8 14"
          className="stroke-muted-foreground/30"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Center clasp */}
        <circle cx="18" cy="14" r="3" className="fill-muted-foreground/15" />
      </g>

      {/* Signature line */}
      <line
        x1="40"
        y1="76"
        x2="80"
        y2="76"
        className="stroke-muted-foreground/15"
        strokeWidth="1"
        strokeDasharray="3 2"
      />

      {/* Subtle pulse ring */}
      <circle cx="60" cy="56" r="16" fill="none" strokeWidth="1">
        <animate attributeName="r" values="16;28;16" dur="3.5s" repeatCount="indefinite" />
        <animate
          attributeName="stroke"
          values="rgba(16,185,129,0);rgba(16,185,129,0.15);rgba(16,185,129,0)"
          dur="3.5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// Search Empty — Magnifying glass with search motion
// ---------------------------------------------------------------
function SearchEmptyIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No results found"
      className="illustration-search"
    >
      {/* Magnifying glass body */}
      <g className="illustration-search-motion" style={{ transformOrigin: '54px 54px' }}>
        <circle
          cx="54"
          cy="50"
          r="24"
          className="fill-muted/40 stroke-muted-foreground/25"
          strokeWidth="2.5"
        />
        {/* Glass shine */}
        <path
          d="M42 38 Q46 34 52 36"
          className="stroke-white/10"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Handle */}
        <line
          x1="72"
          y1="68"
          x2="90"
          y2="86"
          className="stroke-muted-foreground/25"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Handle grip */}
        <line
          x1="86"
          y1="82"
          x2="94"
          y2="90"
          className="stroke-muted-foreground/15"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Question mark or X inside */}
        <text
          x="54"
          y="56"
          textAnchor="middle"
          className="fill-muted-foreground/20"
          fontSize="18"
          fontWeight="600"
          fontFamily="system-ui, sans-serif"
        >
          ?
        </text>
      </g>

      {/* Scattered tiny dots — search particles */}
      <circle cx="24" cy="30" r="2" className="fill-muted-foreground/10">
        <animate attributeName="opacity" values="0;0.2;0" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="96" cy="36" r="1.5" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0;0.2;0"
          dur="3s"
          begin="0.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="18" cy="72" r="1.5" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0;0.2;0"
          dur="3s"
          begin="1s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="100" cy="70" r="2" className="fill-muted-foreground/10">
        <animate
          attributeName="opacity"
          values="0;0.2;0"
          dur="3s"
          begin="1.5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Notifications — Bell with gentle rock + silent waves
// ---------------------------------------------------------------
function NoNotificationsIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No notifications"
      className="illustration-float"
    >
      {/* Bell body */}
      <path
        d="M40 56 C40 38 48 26 60 26 C72 26 80 38 80 56 L80 68 C80 72 82 76 86 78 L34 78 C38 76 40 72 40 68 Z"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Bell top knob */}
      <circle
        cx="60"
        cy="26"
        r="4"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      {/* Clapper */}
      <path
        d="M52 78 C52 84 56 88 60 88 C64 88 68 84 68 78"
        className="fill-muted/40 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />

      {/* Silent wave arcs */}
      <path
        d="M28 50 C26 54 26 58 28 62"
        className="stroke-muted-foreground/10"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      >
        <animate attributeName="opacity" values="0;0.3;0" dur="3s" repeatCount="indefinite" />
      </path>
      <path
        d="M92 50 C94 54 94 58 92 62"
        className="stroke-muted-foreground/10"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      >
        <animate
          attributeName="opacity"
          values="0;0.3;0"
          dur="3s"
          begin="0.3s"
          repeatCount="indefinite"
        />
      </path>

      {/* Subtle gold pulse at top */}
      <circle cx="60" cy="26" r="4" fill="none" strokeWidth="1">
        <animate attributeName="r" values="4;10;4" dur="3.5s" repeatCount="indefinite" />
        <animate
          attributeName="stroke"
          values="rgba(201,168,76,0);rgba(201,168,76,0.2);rgba(201,168,76,0)"
          dur="3.5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Properties — House with shimmer + address lines
// ---------------------------------------------------------------
function NoPropertiesIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No properties"
      className="illustration-float"
    >
      {/* Roof */}
      <path
        d="M20 56 L60 24 L100 56"
        className="stroke-muted-foreground/25"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* House body */}
      <rect
        x="32"
        y="56"
        width="56"
        height="40"
        rx="4"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      {/* Door */}
      <rect
        x="50"
        y="72"
        width="20"
        height="24"
        rx="2"
        className="fill-muted/40 stroke-muted-foreground/15"
        strokeWidth="1"
      />
      {/* Door knob */}
      <circle cx="66" cy="84" r="1.5" className="fill-muted-foreground/20" />
      {/* Window left */}
      <rect
        x="38"
        y="62"
        width="10"
        height="8"
        rx="1"
        className="fill-background/40 stroke-muted-foreground/15"
        strokeWidth="1"
      />
      {/* Window right */}
      <rect
        x="72"
        y="62"
        width="10"
        height="8"
        rx="1"
        className="fill-background/40 stroke-muted-foreground/15"
        strokeWidth="1"
      />

      {/* Chimney */}
      <rect
        x="76"
        y="32"
        width="8"
        height="20"
        rx="1"
        className="fill-muted/50 stroke-muted-foreground/15"
        strokeWidth="1"
      />

      {/* Smoke particles */}
      <circle cx="80" cy="28" r="2" className="fill-muted-foreground/10">
        <animate attributeName="cy" values="28;18;28" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.1;0.25;0.1" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="84" cy="22" r="1.5" className="fill-muted-foreground/10">
        <animate
          attributeName="cy"
          values="22;12;22"
          dur="4s"
          begin="0.5s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.08;0.2;0.08"
          dur="4s"
          begin="0.5s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Subtle emerald pulse at door */}
      <circle cx="60" cy="84" r="0" fill="none" strokeWidth="1">
        <animate attributeName="r" values="0;14;0" dur="4s" repeatCount="indefinite" />
        <animate
          attributeName="stroke"
          values="rgba(16,185,129,0);rgba(16,185,129,0.12);rgba(16,185,129,0)"
          dur="4s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// No Recurring — Calendar with rotating arrows
// ---------------------------------------------------------------
function NoRecurringIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="No recurring jobs"
      className="illustration-pulse"
    >
      {/* Calendar body */}
      <rect
        x="24"
        y="28"
        width="72"
        height="68"
        rx="8"
        className="fill-muted/60 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      {/* Calendar header strip */}
      <rect
        x="24"
        y="28"
        width="72"
        height="18"
        rx="8"
        className="fill-muted/40 stroke-muted-foreground/20"
        strokeWidth="1.5"
      />
      <rect x="24" y="38" width="72" height="8" className="fill-muted/40" />
      {/* Calendar hooks */}
      <line
        x1="44"
        y1="22"
        x2="44"
        y2="34"
        className="stroke-muted-foreground/25"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="76"
        y1="22"
        x2="76"
        y2="34"
        className="stroke-muted-foreground/25"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Circular arrows (recurrence symbol) in center */}
      <g
        transform="translate(60, 70)"
        className="illustration-spin-slow"
        style={{ transformOrigin: '0px 0px' }}
      >
        {/* Circular path */}
        <path
          d="M-12 0 A12 12 0 1 1 0 12"
          className="stroke-muted-foreground/20"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrow head 1 */}
        <path
          d="M-4 10 L0 14 L4 10"
          className="stroke-muted-foreground/20"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Second arc */}
        <path
          d="M12 0 A12 12 0 1 1 0 -12"
          className="stroke-muted-foreground/20"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrow head 2 */}
        <path
          d="M-4 -10 L0 -14 L4 -10"
          className="stroke-muted-foreground/20"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>

      {/* Subtle gold accent pulse */}
      <circle cx="60" cy="70" r="12" fill="none" strokeWidth="1">
        <animate attributeName="r" values="12;22;12" dur="3.5s" repeatCount="indefinite" />
        <animate
          attributeName="stroke"
          values="rgba(201,168,76,0);rgba(201,168,76,0.15);rgba(201,168,76,0)"
          dur="3.5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------
// Error — Warning triangle with pulse
// ---------------------------------------------------------------
function ErrorIllustration({ width, height }: { width: number; height: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Error occurred"
      className="illustration-pulse"
    >
      {/* Triangle */}
      <path
        d="M60 22 L100 92 L20 92 Z"
        className="fill-muted/60 stroke-destructive/30"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Exclamation mark */}
      <line
        x1="60"
        y1="48"
        x2="60"
        y2="70"
        className="stroke-destructive/50"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="60" cy="80" r="2.5" className="fill-destructive/50" />

      {/* Pulsing ring */}
      <circle cx="60" cy="64" r="20" fill="none" strokeWidth="1">
        <animate attributeName="r" values="20;35;20" dur="3s" repeatCount="indefinite" />
        <animate
          attributeName="stroke"
          values="rgba(239,68,68,0);rgba(239,68,68,0.15);rgba(239,68,68,0)"
          dur="3s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

const ILLUSTRATION_MAP: Record<
  IllustrationType,
  (props: { width: number; height: number }) => React.JSX.Element
> = {
  'no-jobs': NoJobsIllustration,
  'no-bids': NoBidsIllustration,
  'no-messages': NoMessagesIllustration,
  'no-contracts': NoContractsIllustration,
  'no-notifications': NoNotificationsIllustration,
  'no-properties': NoPropertiesIllustration,
  'no-recurring': NoRecurringIllustration,
  'search-empty': SearchEmptyIllustration,
  error: ErrorIllustration,
};

export function AnimatedIllustration({ type, size = 'md', className }: AnimatedIllustrationProps) {
  const dimensions = SIZE_MAP[size];
  const Illustration = ILLUSTRATION_MAP[type];

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Illustration width={dimensions.width} height={dimensions.height} />
    </div>
  );
}
