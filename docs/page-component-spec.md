# NoMarkup Page & Component Specification

**Version:** 1.0
**Date:** March 2, 2026
**Stack:** Next.js 15 (App Router) + TypeScript 5 + Tailwind CSS 4 + shadcn/ui + Zustand + TanStack Query + React Hook Form + Zod + Mapbox GL JS

---

## Table of Contents

1. [Global Architecture](#global-architecture)
2. [(auth) Route Group](#auth-route-group)
3. [(public) Route Group](#public-route-group)
4. [(dashboard) Route Group](#dashboard-route-group)
   - [Customer Pages](#customer-pages)
   - [Provider Pages](#provider-pages)
   - [Shared Pages](#shared-dashboard-pages)
   - [Admin Pages](#admin-pages)

---

## Global Architecture

### Root Layout (`/app/layout.tsx`)

Wraps every page in the application. Provides global providers and error boundaries.

**Component Tree:**
```
<html lang="en">
  <body>
    <QueryClientProvider>         // TanStack Query
      <AuthProvider>              // Zustand auth hydration
        <WebSocketProvider>       // Native WS connection
          <ToastProvider>         // shadcn/ui Toaster
            <SkipNavLink />       // "Skip to main content" (WCAG)
            {children}
            <Toaster />
          </ToastProvider>
        </WebSocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  </body>
</html>
```

**Data Requirements:**
- `GET /api/v1/auth/refresh` on mount to hydrate `useAuthStore` from HTTP-only cookie
- `GET /api/v1/notifications/unread-count` via `NotificationService.GetUnreadCount` (if authenticated)
- WebSocket connection to `/api/v1/ws/notifications` (if authenticated)

**SEO (global `<head>`):**
- `<meta charset="utf-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1">`
- `<link rel="icon" href="/favicon.ico">`
- Default OG tags overridden per-page

### Route Group Layouts

| Route Group | Layout File | Structure | Nav Pattern |
|---|---|---|---|
| `(auth)` | `(auth)/layout.tsx` | Centered single-column, max-w-md | No nav; NoMarkup logo links to `/` |
| `(public)` | `(public)/layout.tsx` | Header + main + footer, max-w-7xl | Top nav bar with CTA |
| `(dashboard)` | `(dashboard)/layout.tsx` | Sidebar + main content area | Collapsible sidebar (desktop), bottom nav (mobile) |

---

## (auth) Route Group

**Layout:** `(auth)/layout.tsx`

```
<div class="min-h-screen flex items-center justify-center bg-muted">
  <div class="w-full max-w-md px-4">
    <LogoLink />             // NoMarkup logo, links to /
    <Card>
      {children}             // Page content
    </Card>
    <AuthFooterLinks />      // "Back to home" / "Need help?"
  </div>
</div>
```

**Responsive:** Single column at all breakpoints. Card gets `mx-4` padding on mobile (< sm), `mx-auto` on sm+. Logo is 40px height on mobile, 48px on sm+.

---

### 1. `/login`

**Route path:** `/login`
**Access control:** Public (redirects to `/dashboard` if already authenticated)
**Layout:** `(auth)` centered single-column

**Components:**
```
LoginPage
  Card
    CardHeader
      h1 "Sign in to NoMarkup"
      p "Enter your credentials to continue"
    CardContent
      LoginForm
        Input [email, type="email", autocomplete="email"]
        Input [password, type="password", autocomplete="current-password"]
        div.flex.justify-between
          Checkbox [rememberMe] + label "Remember me"
          Link [/forgot-password] "Forgot password?"
        Button [submit, full-width] "Sign in"
      OAuthDivider           // "or continue with" horizontal rule
      OAuthButtons
        Button [Google, variant="outline", full-width] icon + "Continue with Google"
        Button [Apple, variant="outline", full-width] icon + "Continue with Apple"
    CardFooter
      p "Don't have an account?" + Link [/register] "Create one"
```

**Data Requirements:**
- `POST /api/v1/auth/login` via `UserService.Login` on form submit
- `POST /api/v1/auth/mfa/verify` via `UserService.VerifyMFA` if MFA is enabled (conditional second step)
- On success: hydrate `useAuthStore`, redirect to `/dashboard`

**Form Schema (Zod):**
```typescript
const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Submit valid credentials (no MFA) | Redirect to `/dashboard` |
| Submit valid credentials (MFA enabled) | Show MFA verification step inline |
| Submit invalid credentials | Inline error: "Invalid email or password" below the form |
| Click "Forgot password?" | Navigate to `/forgot-password` |
| Click OAuth button | Redirect to OAuth provider, return to `/api/auth/callback/{provider}` |
| Press Enter in password field | Submits the form |

**States:**
| State | Appearance |
|---|---|
| Default | Empty form, all buttons enabled |
| Submitting | Button shows Loader2 spinner, all inputs disabled |
| Error | Red border on relevant field, error text below field via `aria-describedby` |
| MFA Required | Form slides to MFA input: 6-digit TOTP code with auto-focus, "Use backup code" link below |

**MFA Step Components (conditional):**
```
MfaVerifyStep
  h2 "Two-factor authentication"
  p "Enter the 6-digit code from your authenticator app"
  InputOTP [6 digits, autoFocus, autocomplete="one-time-code"]
  Button [submit] "Verify"
  Link "Use a backup code instead"
    // Toggles input to single text field for backup code
```

**Responsive:** No layout changes across breakpoints; card width is `max-w-md` at all sizes.

**Accessibility:**
- `<h1>` announces page purpose
- All inputs have associated `<label>` elements
- Error messages linked to fields via `aria-describedby`
- `aria-live="polite"` region for form-level errors
- OAuth buttons have `aria-label` including provider name
- Tab order: email -> password -> remember me -> forgot password -> sign in -> Google -> Apple -> register link
- MFA input uses `inputmode="numeric"` and `pattern="[0-9]*"`

**SEO:** Not indexed (`noindex, nofollow`). Title: "Sign In | NoMarkup"

---

### 2. `/register`

**Route path:** `/register`
**Access control:** Public (redirects to `/dashboard` if already authenticated)
**Layout:** `(auth)` centered single-column

This is a multi-step form. Steps are tracked via `useJobPostingFormStore` pattern: Zustand persists draft data across steps; React Hook Form manages each step's fields.

**Step Indicator Component:**
```
StepIndicator
  ol.flex.items-center [role="list"]
    StepDot [1: "Account Type", active/complete/pending]
    StepConnector
    StepDot [2: "Credentials", active/complete/pending]
    StepConnector
    StepDot [3: "Profile", active/complete/pending]
    StepConnector
    StepDot [4: "Verification", active/complete/pending]
```

**Step 1 -- Account Type:**
```
RegisterStep1
  CardHeader
    h1 "Create your account"
    p "How will you use NoMarkup?"
  CardContent
    RadioGroup [accountType]
      RadioCard [customer]
        icon UserIcon
        h3 "I need services"
        p "Post jobs and get competitive bids from verified providers"
      RadioCard [provider]
        icon WrenchIcon
        h3 "I provide services"
        p "Bid on jobs and grow your business"
      RadioCard [both]
        icon ArrowsRightLeftIcon
        h3 "Both"
        p "Post jobs and provide services"
    Button [next, full-width] "Continue"
  CardFooter
    p "Already have an account?" + Link [/login] "Sign in"
```

**Step 2 -- Credentials:**
```
RegisterStep2
  CardHeader
    h2 "Set up your login"
  CardContent
    Input [firstName, autocomplete="given-name"]
    Input [lastName, autocomplete="family-name"]
    Input [email, type="email", autocomplete="email"]
    Input [password, type="password", autocomplete="new-password"]
      PasswordStrengthMeter    // bar: weak/fair/strong/very strong
    Input [confirmPassword, type="password"]
    OAuthDivider
    OAuthButtons               // Same as login page
    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 3 -- Profile Basics:**
```
RegisterStep3 [varies by role]
  CardHeader
    h2 "Complete your profile"
  CardContent
    // Customer fields:
    Input [phone, type="tel", autocomplete="tel"]
    AddressAutocomplete [address, via Mapbox Geocoding API]
    AvatarUpload [profilePhoto, optional]

    // Provider fields (shown if provider or both):
    Input [businessName, optional if individual]
    Input [phone, type="tel", autocomplete="tel"]
    AddressAutocomplete [serviceAddress]
    ServiceCategoryMultiSelect [categories, from JobService.GetCategoryTree]
    Slider [serviceRadius, 5-100 miles, default 25]
    AvatarUpload [profilePhoto]

    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 4 -- Email Verification Sent:**
```
RegisterStep4
  CardHeader
    icon MailIcon (large, centered)
    h2 "Check your email"
    p "We sent a verification link to {email}"
  CardContent
    p "Click the link in the email to activate your account."
    Button [resend, variant="outline"] "Resend verification email"
    p.text-sm "Didn't receive it? Check your spam folder."
  CardFooter
    Link [/login] "Back to sign in"
```

**Data Requirements:**
- `GET /api/v1/categories/tree` via `JobService.GetCategoryTree` -- for provider category selection (Step 3)
- `POST /api/v1/auth/register` via `UserService.Register` -- on Step 2 completion (account created)
- `PATCH /api/v1/users/me` via `UserService.UpdateUser` -- on Step 3 completion (profile update)
- `POST /api/v1/images/avatar` via `ImagingService.ProcessAvatar` -- if photo uploaded
- TanStack Query keys: `["categories", "tree"]`

**Form Schema (Zod, per step):**
```typescript
const step1Schema = z.object({
  accountType: z.enum(["customer", "provider", "both"]),
});

const step2Schema = z.object({
  firstName: z.string().min(1, "First name is required").max(50),
  lastName: z.string().min(1, "Last name is required").max(50),
  email: z.string().email("Enter a valid email address"),
  password: z.string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "At least one uppercase letter")
    .regex(/[0-9]/, "At least one number")
    .regex(/[^A-Za-z0-9]/, "At least one special character"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const step3CustomerSchema = z.object({
  phone: z.string().regex(/^\+?1?\d{10,14}$/, "Enter a valid phone number"),
  address: addressSchema,
  profilePhoto: z.string().url().optional(),
});

const step3ProviderSchema = z.object({
  businessName: z.string().max(100).optional(),
  phone: z.string().regex(/^\+?1?\d{10,14}$/, "Enter a valid phone number"),
  serviceAddress: addressSchema,
  categories: z.array(z.string()).min(1, "Select at least one category"),
  serviceRadius: z.number().min(5).max(100),
  profilePhoto: z.string().url().optional(),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Select account type, click Continue | Advance to Step 2 |
| Click Back on any step | Return to previous step, form data preserved |
| Submit Step 2 | Account created, advance to Step 3 |
| Submit Step 3 | Profile saved, advance to Step 4 |
| Click Resend on Step 4 | Triggers resend, button disabled 60s with countdown |
| Click OAuth on Step 2 | OAuth flow; returns to Step 3 with email pre-filled |
| Browser back button | Navigates between steps (URL does not change; steps are client-side) |

**States:**
| State | Appearance |
|---|---|
| Step active | Current step dot filled primary, previous dots filled with checkmark, future dots outlined muted |
| Submitting | Current step's submit button shows spinner, inputs disabled |
| Email sent | Step 4 shows animated mail icon, resend button with 60s cooldown timer |
| OAuth error | Toast: "Could not connect to {provider}. Try again or use email." |

**Responsive:** Same single-column layout. On mobile (< sm), RadioCards stack vertically. On sm+, RadioCards can remain vertical (card width is constrained to max-w-md).

**Accessibility:**
- Step indicator uses `aria-current="step"` on active step
- Steps announced to screen readers: "Step 2 of 4: Set up your login"
- PasswordStrengthMeter uses `aria-live="polite"` and `role="status"`
- ServiceCategoryMultiSelect is keyboard navigable with type-ahead search
- Back/Next buttons have clear labels; Enter submits current step

**SEO:** Not indexed. Title: "Create Account | NoMarkup"

---

### 3. `/forgot-password`

**Route path:** `/forgot-password`
**Access control:** Public
**Layout:** `(auth)` centered single-column

**Components:**
```
ForgotPasswordPage
  Card
    CardHeader
      h1 "Reset your password"
      p "Enter your email and we'll send a reset link"
    CardContent
      ForgotPasswordForm
        Input [email, type="email", autocomplete="email"]
        Button [submit, full-width] "Send reset link"
    CardFooter
      Link [/login] "Back to sign in"
```

**Data Requirements:**
- `POST /api/v1/auth/request-password-reset` via `UserService.RequestPasswordReset`

**Form Schema:**
```typescript
const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Submit valid email | Show confirmation state (always, even if email not found -- prevents enumeration) |
| Submit invalid email format | Inline field error |

**States:**
| State | Appearance |
|---|---|
| Default | Empty email input, submit button |
| Submitting | Button spinner, input disabled |
| Confirmation | Form replaced with: MailCheck icon + "If an account exists for {email}, you'll receive a reset link shortly." + "Back to sign in" link |

**Accessibility:** Same patterns as login. Confirmation uses `role="status"` and `aria-live="polite"`.

**SEO:** Not indexed. Title: "Reset Password | NoMarkup"

---

### 4. `/reset-password/[token]`

**Route path:** `/reset-password/[token]`
**Access control:** Public (token validated server-side)
**Layout:** `(auth)` centered single-column

**Components:**
```
ResetPasswordPage
  Card
    CardHeader
      h1 "Set a new password"
      p "Enter your new password below"
    CardContent
      ResetPasswordForm
        Input [password, type="password", autocomplete="new-password"]
          PasswordStrengthMeter
        Input [confirmPassword, type="password"]
        Button [submit, full-width] "Reset password"
```

**Data Requirements:**
- Token extracted from URL `params.token`
- `POST /api/v1/auth/reset-password` via `UserService.ResetPassword` with `{ token, newPassword }`

**Form Schema:**
```typescript
const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "At least one uppercase letter")
    .regex(/[0-9]/, "At least one number")
    .regex(/[^A-Za-z0-9]/, "At least one special character"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
```

**States:**
| State | Appearance |
|---|---|
| Default | Empty password fields |
| Submitting | Button spinner |
| Success | Form replaced with: CheckCircle icon + "Password updated successfully" + Button "Sign in" linking to `/login` |
| Invalid/expired token | Card shows: XCircle icon + "This reset link has expired or is invalid" + Link to `/forgot-password` "Request a new link" |

**Accessibility:** PasswordStrengthMeter uses `aria-live="polite"`. Success/error states announced via `role="alert"`.

**SEO:** Not indexed. Title: "Reset Password | NoMarkup"

---

### 5. `/verify-email/[token]`

**Route path:** `/verify-email/[token]`
**Access control:** Public
**Layout:** `(auth)` centered single-column

**Components:**
```
VerifyEmailPage
  Card
    CardContent
      // Loading state:
      Skeleton [icon] + "Verifying your email..."
      // Success state:
      CheckCircle icon (green)
      h1 "Email verified"
      p "Your email has been confirmed. You can now sign in."
      Button [full-width] "Continue to sign in" -> /login
      // Error state:
      XCircle icon (red)
      h1 "Verification failed"
      p "This link has expired or has already been used."
      Button [variant="outline"] "Resend verification" -> triggers resend
      Link [/login] "Back to sign in"
```

**Data Requirements:**
- `POST /api/v1/auth/verify-email` via `UserService.VerifyEmail` with `{ token }` -- called on mount

**User Interactions:** Page auto-verifies on load. No form input required.

**States:**
| State | Appearance |
|---|---|
| Verifying | Centered spinner + "Verifying your email..." |
| Success | Green check icon, success message, sign-in button |
| Error | Red X icon, error message, resend button |

**Accessibility:** Status announced via `role="status"`. Auto-focus on primary action button after verification completes.

**SEO:** Not indexed. Title: "Verify Email | NoMarkup"

---

### 6. `/mfa/setup`

**Route path:** `/mfa/setup`
**Access control:** Authenticated (any role)
**Layout:** `(auth)` centered single-column

**Components:**
```
MfaSetupPage
  Card
    CardHeader
      h1 "Set up two-factor authentication"
      p "Scan the QR code with your authenticator app"
    CardContent
      MfaSetupFlow
        // Step 1: QR Code
        div.flex.flex-col.items-center
          QRCodeDisplay [otpauth URI, 200x200px]
          details
            summary "Can't scan? Enter this key manually"
            code.select-all [base32 secret, monospace, break-all]
        // Step 2: Verify
        p "Enter the 6-digit code from your app to confirm setup"
        InputOTP [6 digits, autoFocus]
        Button [submit] "Verify and enable"
        // Step 3: Backup Codes
        BackupCodesDisplay
          h2 "Save your backup codes"
          p "Store these codes somewhere safe. Each code can only be used once."
          div.grid.grid-cols-2.gap-2
            code [backup code 1]
            code [backup code 2]
            ... (10 codes total)
          div.flex.gap-2
            Button [variant="outline"] icon CopyIcon "Copy all"
            Button [variant="outline"] icon DownloadIcon "Download"
          Checkbox [confirmed] "I have saved these codes"
          Button [submit, disabled until checkbox] "Done"
```

**Data Requirements:**
- `POST /api/v1/auth/mfa/enable` via `UserService.EnableMFA` -- returns `{ secret, qrCodeUri, backupCodes }`
- `POST /api/v1/auth/mfa/verify` via `UserService.VerifyMFA` -- confirms setup with first TOTP code

**User Interactions:**
| Action | Result |
|---|---|
| Page loads | QR code displayed, secret generated |
| Enter valid 6-digit code | Advance to backup codes step |
| Enter invalid code | Inline error: "Invalid code. Check your authenticator app and try again." |
| Click "Copy all" | All backup codes copied to clipboard, toast: "Backup codes copied" |
| Click "Download" | Downloads `nomarkup-backup-codes.txt` |
| Check "I have saved" + click Done | MFA enabled, redirect to `/dashboard/settings/security` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton for QR code area |
| QR displayed | QR code + manual key collapsed |
| Verifying | Button spinner on "Verify and enable" |
| Backup codes | Grid of monospace codes, copy/download buttons |
| Complete | Redirect to security settings |

**Responsive:** QR code is 200x200 on all sizes. Backup codes grid is 2 columns on sm+, 1 column on mobile.

**Accessibility:**
- QR code has `alt="QR code for authenticator app setup"`
- Manual key is in a `<code>` element with `aria-label="Manual setup key"`
- InputOTP uses `inputmode="numeric"`
- Backup codes grid uses `role="list"` with each code as `role="listitem"`

**SEO:** Not indexed. Title: "Set Up 2FA | NoMarkup"

---

## (public) Route Group

**Layout:** `(public)/layout.tsx`

```
<div class="min-h-screen flex flex-col">
  <Header>
    <nav class="max-w-7xl mx-auto flex items-center justify-between px-4 h-16">
      <LogoLink />                     // NoMarkup logo, links to /
      <NavLinks>                       // Desktop: horizontal links; mobile: hamburger
        Link [/how-it-works] "How It Works"
        Link [/browse] "Browse Providers"
        Link [/pricing] "Pricing"
        Link [/categories] "Categories"
      </NavLinks>
      <div.flex.items-center.gap-3>
        Button [variant="ghost"] "Sign In" -> /login
        Button [variant="default"] "Post a Job" -> /login?redirect=/dashboard/jobs/new
      </div>
      MobileMenuButton                 // Hamburger, visible < lg
    </nav>
  </Header>
  <main class="flex-1">
    {children}
  </main>
  <Footer>
    <div class="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 px-4 py-12">
      FooterColumn ["Product": How It Works, Pricing, Browse Providers, Categories]
      FooterColumn ["Company": About, Contact, Careers]
      FooterColumn ["Legal": Terms of Service, Privacy Policy]
      FooterColumn ["Connect": Twitter, LinkedIn, Facebook icons]
    </div>
    <div class="border-t text-center py-4 text-sm text-muted-foreground">
      "© 2026 NoMarkup. All rights reserved."
    </div>
  </Footer>
</div>
```

**Responsive:** Header collapses NavLinks into a slide-out `Sheet` on mobile (< lg). Footer grid goes from 4 columns (md+) to 2 columns (< md). "Post a Job" CTA hidden on mobile hamburger menu; shown inline in Sheet.

---

### 7. `/` (Landing Page)

**Route path:** `/`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
LandingPage
  HeroSection
    div.max-w-3xl.mx-auto.text-center.py-20
      h1 "Home Services Without the Markup"
      p "Post your job. Get competitive bids. Hire the best provider — no middleman fees."
      div.flex.gap-4.justify-center
        Button [size="lg"] "Post a Job" -> /login?redirect=/dashboard/jobs/new
        Button [size="lg", variant="outline"] "Browse Providers" -> /browse

  HowItWorksSection
    SectionHeading "How It Works"
    div.grid.grid-cols-1.md:grid-cols-3.gap-8
      StepCard [1, icon=ClipboardList, "Post Your Job", description]
      StepCard [2, icon=Gavel, "Get Bids", description]
      StepCard [3, icon=BadgeCheck, "Hire & Pay", description]

  PopularCategoriesSection
    SectionHeading "Popular Categories"
    div.grid.grid-cols-2.md:grid-cols-4.gap-4
      CategoryCard [icon, name, providerCount] x8  // Clickable -> /categories/[slug]

  TrustSection
    SectionHeading "Trust & Safety"
    div.grid.grid-cols-1.md:grid-cols-3.gap-8
      TrustCard [icon=ShieldCheck, "Verified Providers", description]
      TrustCard [icon=Lock, "Secure Payments", description]
      TrustCard [icon=Star, "Guaranteed Quality", description]

  TestimonialsSection
    SectionHeading "What Our Users Say"
    Carousel [autoplay, 5s interval]
      TestimonialCard [avatar, name, role, quote, rating] x3

  FinalCtaSection
    div.bg-primary.text-primary-foreground.text-center.py-16
      h2 "Ready to get started?"
      p "Join thousands of homeowners saving on home services."
      Button [size="lg", variant="secondary"] "Post Your First Job" -> /register
```

**Data Requirements:**
- `GET /api/v1/categories` via `JobService.ListCategories` -- fetches popular categories (top 8 by provider count)
- TanStack Query key: `["categories", "popular"]`
- All other content is static (defined in page or constants)

**User Interactions:**
| Action | Result |
|---|---|
| Click "Post a Job" CTA | Navigate to `/login?redirect=/dashboard/jobs/new` |
| Click "Browse Providers" | Navigate to `/browse` |
| Click a category card | Navigate to `/categories/[slug]` |
| Carousel auto-advances | Next testimonial every 5 seconds; pauses on hover/focus |
| Click carousel dot/arrow | Manual navigation to specific testimonial |

**States:**
| State | Appearance |
|---|---|
| Default | All sections rendered, categories loaded |
| Categories loading | 8 Skeleton cards in category grid |
| Categories error | Section hidden gracefully; page still functional |

**Responsive:** Hero CTA buttons stack vertically on mobile (< sm). Category grid: 2 cols mobile, 4 cols md+. Trust cards and How It Works cards: 1 col mobile, 3 cols md+. Testimonial carousel: single card, swipe-enabled on touch devices.

**Accessibility:**
- `<h1>` is on the hero headline; section headings use `<h2>`
- Carousel has `aria-roledescription="carousel"`, each slide has `aria-roledescription="slide"`
- Carousel pause button for users who prefer reduced motion
- `prefers-reduced-motion`: disables auto-play
- All CTA buttons have descriptive text (no "Click here")
- Category cards use `<a>` with descriptive `aria-label` including category name

**SEO:** Indexed. Title: "NoMarkup | Home Services Without the Markup"

---

### 8. `/how-it-works`

**Route path:** `/how-it-works`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
HowItWorksPage
  PageHeader
    h1 "How NoMarkup Works"
    p "Whether you need a service or provide one, here's how it works."

  div.grid.grid-cols-1.lg:grid-cols-2.gap-12.py-12

    CustomerFlowSection
      h2 "For Homeowners"
      ol.space-y-8
        FlowStep [1, icon=ClipboardList, "Describe your job", description]
        FlowStep [2, icon=Bell, "Receive bids", description]
        FlowStep [3, icon=Search, "Compare providers", description]
        FlowStep [4, icon=Handshake, "Hire your provider", description]
        FlowStep [5, icon=Star, "Rate & review", description]

    ProviderFlowSection
      h2 "For Providers"
      ol.space-y-8
        FlowStep [1, icon=UserPlus, "Create your profile", description]
        FlowStep [2, icon=MapPin, "Set your service area", description]
        FlowStep [3, icon=Search, "Browse open jobs", description]
        FlowStep [4, icon=Gavel, "Submit competitive bids", description]
        FlowStep [5, icon=Briefcase, "Get hired & complete work", description]
        FlowStep [6, icon=DollarSign, "Get paid securely", description]

  FaqSection
    h2 "Frequently Asked Questions"
    Accordion [type="single", collapsible]
      AccordionItem [q: "Is NoMarkup really free?", a: ...]
      AccordionItem [q: "How are providers verified?", a: ...]
      AccordionItem [q: "What if I'm not satisfied?", a: ...]
      AccordionItem [q: "How does bidding work?", a: ...]
      AccordionItem [q: "Can I be both a customer and provider?", a: ...]

  CtaSection
    div.text-center.py-12
      h2 "Ready to get started?"
      div.flex.gap-4.justify-center
        Button "Post a Job" -> /register
        Button [variant="outline"] "Join as a Provider" -> /register
```

**Data Requirements:**
- None. All content is static.

**User Interactions:**
| Action | Result |
|---|---|
| Click FAQ accordion item | Expands/collapses answer; only one open at a time |
| Click CTA button | Navigate to `/register` |

**States:**
| State | Appearance |
|---|---|
| Default | Both flows visible, all FAQ items collapsed |
| FAQ item open | Chevron rotates, answer content slides into view |

**Responsive:** Customer/Provider flows stack vertically on mobile (< lg), side-by-side on lg+. FAQ accordion full-width at all sizes.

**Accessibility:**
- Flow steps use `<ol>` for semantic ordering
- Accordion items use `aria-expanded` and `aria-controls`
- Each flow section has its own `<h2>` landmark
- FAQ content is not hidden from screen readers when collapsed (uses `aria-hidden` correctly via shadcn)

**SEO:** Indexed. Title: "How It Works | NoMarkup"

---

### 9. `/pricing`

**Route path:** `/pricing`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
PricingPage
  PageHeader
    h1 "Simple, Transparent Pricing"
    p "No hidden fees. No markups. Just straightforward plans."

  RoleToggle
    Tabs [defaultValue="customer"]
      TabsTrigger "For Homeowners"
      TabsTrigger "For Providers"

      TabsContent [customer]
        div.grid.grid-cols-1.md:grid-cols-2.gap-8.max-w-3xl.mx-auto
          PricingCard [tier="Free"]
            h3 "Free"
            p.text-3xl "$0" + "/month"
            ul.space-y-2
              FeatureRow [check, "Post unlimited jobs"]
              FeatureRow [check, "Receive up to 10 bids per job"]
              FeatureRow [check, "Basic provider profiles"]
              FeatureRow [x, "Priority support"]
              FeatureRow [x, "Bid analytics"]
            Button [variant="outline", full-width] "Get Started" -> /register
          PricingCard [tier="Pro", highlighted]
            Badge "Most Popular"
            h3 "Pro"
            p.text-3xl "$9.99" + "/month"
            ul.space-y-2
              FeatureRow [check, "Everything in Free"]
              FeatureRow [check, "Unlimited bids per job"]
              FeatureRow [check, "Provider trust score details"]
              FeatureRow [check, "Priority support"]
              FeatureRow [check, "Bid analytics & insights"]
            Button [full-width] "Start Free Trial" -> /register?plan=pro

      TabsContent [provider]
        div.grid.grid-cols-1.md:grid-cols-2.gap-8.max-w-3xl.mx-auto
          PricingCard [tier="Free"]
            h3 "Free"
            p.text-3xl "$0" + "/month"
            ul.space-y-2
              FeatureRow [check, "Bid on up to 5 jobs/month"]
              FeatureRow [check, "Basic profile listing"]
              FeatureRow [check, "Review collection"]
              FeatureRow [x, "Featured placement"]
              FeatureRow [x, "Bid templates"]
            Button [variant="outline", full-width] "Get Started" -> /register
          PricingCard [tier="Pro", highlighted]
            Badge "Most Popular"
            h3 "Pro"
            p.text-3xl "$29.99" + "/month"
            ul.space-y-2
              FeatureRow [check, "Everything in Free"]
              FeatureRow [check, "Unlimited bids"]
              FeatureRow [check, "Featured in search results"]
              FeatureRow [check, "Bid templates & analytics"]
              FeatureRow [check, "Priority support"]
            Button [full-width] "Start Free Trial" -> /register?plan=pro

  FaqSection
    h2 "Billing FAQ"
    Accordion [type="single", collapsible]
      AccordionItem [q: "Can I cancel anytime?", a: ...]
      AccordionItem [q: "Is there a free trial?", a: ...]
      AccordionItem [q: "What payment methods do you accept?", a: ...]
      AccordionItem [q: "Do you offer annual billing?", a: ...]
```

**Data Requirements:**
- None. All pricing tiers defined in `lib/constants/pricing.ts`.

**Form Schema:** None (no form input).

**User Interactions:**
| Action | Result |
|---|---|
| Toggle between Homeowners / Providers | Pricing cards swap with tab transition |
| Click "Get Started" or "Start Free Trial" | Navigate to `/register` (with optional `plan` query param) |
| Click FAQ item | Accordion expands/collapses |

**States:**
| State | Appearance |
|---|---|
| Default | Customer tab active, both pricing cards visible |
| Provider tab | Provider pricing cards visible |

**Responsive:** Pricing cards stack vertically on mobile (< md), side-by-side on md+. "Most Popular" badge positioned at top-right of highlighted card.

**Accessibility:**
- Tabs use `role="tablist"`, `role="tab"`, `role="tabpanel"` (built into shadcn Tabs)
- Pricing feature lists use `<ul>` with check/X icons that have `aria-label="Included"` / `aria-label="Not included"`
- Current tab indicated via `aria-selected`

**SEO:** Indexed. Title: "Pricing | NoMarkup"

---

### 10. `/browse`

**Route path:** `/browse`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
BrowsePage
  PageHeader
    h1 "Browse Providers"
    p "Find trusted professionals in your area"

  div.flex.flex-col.lg:flex-row.gap-6

    FilterSidebar [class="w-full lg:w-80 lg:shrink-0"]
      h2.sr-only "Filters"
      div.space-y-6
        Select [category, placeholder="All Categories"]
          // Options from GET /api/v1/categories
        AddressAutocomplete [location, placeholder="Enter your address"]
        div
          Label "Radius"
          Slider [radius, 5-100 miles, default=25, step=5]
          span "{radius} miles"
        div
          Label "Minimum Trust Score"
          Slider [trustScore, 0-100, default=0, step=10]
        div
          Label "Minimum Rating"
          StarRatingFilter [rating, 0-5]
        div.flex.items-center.gap-2
          Switch [availability]
          Label "Available now"
        Button [variant="outline", full-width] "Reset Filters"

    div.flex-1
      div.flex.items-center.justify-between.mb-4
        p.text-muted-foreground "{count} providers found"
        ViewToggle
          Button [icon=Map, variant=toggle] "Map"
          Button [icon=List, variant=toggle] "List"

      // Map + List views
      div.relative [class toggle based on viewMode]
        MapView [visible when map active]
          MapboxMap [style="mapbox://styles/mapbox/streets-v12"]
            ProviderMarker [forEach provider, onClick -> popover] x N
            MapPopover [avatar, name, rating, trustBadge, "View Profile" link]
        ListView [visible when list active or below map]
          div.grid.grid-cols-1.md:grid-cols-2.xl:grid-cols-3.gap-4
            ProviderCard x N
              Card
                div.flex.gap-4
                  Avatar [src=provider.avatarUrl, fallback=initials]
                  div
                    h3 Link [/providers/{id}] "{provider.name}"
                    div.flex.items-center.gap-1
                      StarRating [rating, read-only]
                      span "({reviewCount})"
                    TrustBadge [score]
                    div.flex.flex-wrap.gap-1
                      Badge [variant="secondary"] x categories

      LoadMoreButton / InfiniteScrollTrigger
        Button "Load more providers"
        // OR IntersectionObserver trigger for infinite scroll
```

**Data Requirements:**
- `GET /api/v1/categories` via `JobService.ListCategories` -- populates category filter
- `GET /api/v1/search/providers` via `SearchService.SearchProviders` -- main provider query
  - Query params: `category`, `lat`, `lng`, `radius`, `min_trust_score`, `min_rating`, `available_now`, `page`, `limit`
- TanStack Query keys: `["categories"]`, `["providers", "search", filterParams]`
- Filters persisted in URL search params via `useSearchParams` for shareability

**User Interactions:**
| Action | Result |
|---|---|
| Change any filter | URL search params update, provider query re-fetches with debounce (300ms) |
| Click "Reset Filters" | All filters cleared, URL params reset, fresh query |
| Toggle Map/List view | View switches; on lg+ both are visible simultaneously (map top, list bottom) |
| Click provider marker on map | Popover appears with provider preview |
| Click "View Profile" in popover or ProviderCard name | Navigate to `/providers/[id]` |
| Scroll to bottom of list | Next page loads (infinite scroll) or "Load more" button appears |
| Enter address in location filter | Mapbox Geocoding API returns coordinates, map re-centers |

**States:**
| State | Appearance |
|---|---|
| Default (no filters) | All providers in default order, map centered on user location or US center |
| Loading | Skeleton cards in grid (6 items), map shows loading overlay |
| Empty results | Illustration + "No providers match your filters" + "Reset Filters" button |
| Error | Toast notification + retry button |
| Paginating | Spinner below existing cards while next page loads |

**Responsive:** On mobile (< lg): FilterSidebar collapses into a `Sheet` triggered by a floating "Filters" button with active filter count badge. Map and List are toggled (not simultaneous). On lg+: sidebar visible, map and list shown together.

**Accessibility:**
- Filter sidebar has `<h2 class="sr-only">` for screen readers
- Map is decorative for screen-reader users; list view is the accessible alternative
- `aria-live="polite"` region announces result count changes: "{count} providers found"
- ProviderCard names are links (keyboard navigable)
- StarRating displays `aria-label="Rated {n} out of 5 stars"`
- Map popover triggered by Enter/Space on marker (keyboard accessible)

**SEO:** Indexed. Title: "Browse Providers | NoMarkup"

---

### 11. `/providers/[id]`

**Route path:** `/providers/[id]`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
ProviderProfilePage
  div.max-w-5xl.mx-auto.py-8

    ProfileHeader
      div.flex.flex-col.sm:flex-row.gap-6.items-start
        Avatar [size="xl", src=provider.avatarUrl, fallback=initials]
        div.flex-1
          h1 "{provider.name}"
          div.flex.items-center.gap-2
            TrustBadge [score]
            StarRating [rating, read-only]
            span "({reviewCount} reviews)"
          div.flex.flex-wrap.gap-2.mt-2
            Badge [variant="secondary"] x provider.categories
          p.text-muted-foreground "Member since {joinDate}"
        Button [size="lg"] "Contact Provider" -> /login?redirect=/dashboard/messages/new?provider={id}

    Tabs [defaultValue="about"]
      TabsList
        TabsTrigger "About"
        TabsTrigger "Services"
        TabsTrigger "Portfolio"
        TabsTrigger "Reviews"
        TabsTrigger "Service Area"

      TabsContent [about]
        AboutSection
          h2 "About"
          p.prose "{provider.bio}"
          div.grid.grid-cols-2.sm:grid-cols-4.gap-4.mt-6
            StatCard ["Jobs Completed", count]
            StatCard ["Response Time", avgTime]
            StatCard ["Completion Rate", pct]
            StatCard ["Years Active", years]

      TabsContent [services]
        ServicesSection
          h2 "Services Offered"
          div.grid.grid-cols-1.md:grid-cols-2.gap-4
            ServiceCard x N
              Card
                h3 "{service.name}"
                p "{service.description}"
                p.text-lg.font-semibold "Starting at ${service.basePrice}"

      TabsContent [portfolio]
        PortfolioSection
          h2 "Portfolio"
          div.grid.grid-cols-2.md:grid-cols-3.gap-2
            PortfolioImage [onClick -> Lightbox] x N
          Lightbox [open, onClose, images, currentIndex]
            // Full-screen image viewer with prev/next navigation

      TabsContent [reviews]
        ReviewsSection
          h2 "Reviews"
          div.flex.items-center.gap-4.mb-6
            RatingSummary [average, distribution histogram]
          div.space-y-4
            ReviewCard x N
              div.flex.gap-3
                Avatar [reviewer]
                div
                  h4 "{reviewer.name}"
                  StarRating [rating]
                  p.text-sm.text-muted-foreground "{timeAgo}"
                  p "{review.content}"
          Pagination [page, totalPages, onPageChange]

      TabsContent [serviceArea]
        ServiceAreaSection
          h2 "Service Area"
          MapboxMap [center=provider.location, radius=provider.serviceRadius]
            Circle [provider.serviceRadius]
            Marker [provider.location]
```

**Data Requirements:**
- `GET /api/v1/users/{id}/public-profile` via `UserService.GetPublicProfile` -- provider details, stats, services
- `GET /api/v1/reviews?provider_id={id}&page={page}&limit=10` via `ReviewService.ListReviews` -- paginated reviews
- TanStack Query keys: `["provider", id]`, `["reviews", id, page]`
- Dynamic params: `params.id`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Tab content switches, URL hash updates (e.g., `#reviews`) |
| Click portfolio image | Lightbox opens at that image |
| Navigate lightbox (arrows/keys) | Previous/next image |
| Close lightbox (X / Escape / backdrop click) | Returns to portfolio grid |
| Click "Contact Provider" | Navigate to login (or direct to messages if authenticated) |
| Click review pagination | Next page of reviews loaded |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton for header, tabs content area |
| Loaded | Full profile with all sections |
| No portfolio images | "No portfolio items yet" empty state in Portfolio tab |
| No reviews | "No reviews yet" empty state in Reviews tab |
| Provider not found (404) | `notFound()` -- renders Next.js 404 page |

**Responsive:** ProfileHeader stacks avatar above name on mobile (< sm). Tabs become horizontally scrollable on mobile. Portfolio grid: 2 cols mobile, 3 cols md+. Stats grid: 2 cols mobile, 4 cols sm+.

**Accessibility:**
- `<h1>` on provider name
- Tabs use `role="tablist"` with `aria-selected` (shadcn built-in)
- Lightbox traps focus, Escape closes it, arrow keys navigate images
- Portfolio images have `alt` text from provider-supplied captions
- Service area map has `aria-label="Provider service area map"`
- Review pagination announces page change via `aria-live="polite"`

**SEO:** Indexed with dynamic OG tags (`generateMetadata`). Title: "{Provider Name} | NoMarkup". OG image uses provider avatar. Description uses provider bio (truncated to 160 chars).

---

### 12. `/categories`

**Route path:** `/categories`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
CategoriesPage
  PageHeader
    h1 "Service Categories"
    p "Browse all available service categories"

  div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-6.py-8
    CategoryCard x 16
      Link [/categories/{slug}]
        Card [class="hover:shadow-md transition-shadow"]
          CardContent.flex.flex-col.items-center.text-center.py-6
            CategoryIcon [icon, size=48, class="text-primary"]
            h2.text-lg.font-semibold "{category.name}"
            p.text-sm.text-muted-foreground "{category.description}"
            p.text-sm.font-medium "{providerCount} providers"
```

**Data Requirements:**
- `GET /api/v1/categories` via `JobService.ListCategories` -- all 16 top-level categories with descriptions and provider counts
- TanStack Query key: `["categories"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click category card | Navigate to `/categories/[slug]` |
| Hover on card | Subtle shadow elevation transition |

**States:**
| State | Appearance |
|---|---|
| Loading | 16 Skeleton cards in grid layout |
| Loaded | All category cards with icons and descriptions |
| Error | Error message with retry button |

**Responsive:** Grid: 1 col mobile, 2 cols sm, 4 cols lg+.

**Accessibility:**
- Each card is a single `<a>` wrapping the card content for clear link semantics
- `<h2>` on each category name
- Icons are decorative (`aria-hidden="true"`), text conveys meaning

**SEO:** Indexed. Title: "Service Categories | NoMarkup"

---

### 13. `/categories/[slug]`

**Route path:** `/categories/[slug]`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
CategoryDetailPage
  CategoryHeader
    div.flex.items-center.gap-4.py-8
      CategoryIcon [icon, size=64, class="text-primary"]
      div
        h1 "{category.name}"
        p.text-lg.text-muted-foreground "{category.description}"

  SubcategoryChips
    div.flex.flex-wrap.gap-2
      Badge [variant="outline", clickable] x subcategories
        // Each filters providers/jobs by subcategory (updates URL param)

  section.py-8
    h2 "Top Providers"
    div.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4
      ProviderCard x N             // Same component as /browse
    Link [/browse?category={slug}] "View all providers in {category.name} →"

  section.py-8
    h2 "Recent Open Jobs"
    div.grid.grid-cols-1.md:grid-cols-2.gap-4
      JobCard x N
        Card
          CardHeader
            h3 "{job.title}"
            Badge [status="open"] "Open"
          CardContent
            p.line-clamp-2 "{job.description}"
            div.flex.items-center.gap-4.text-sm.text-muted-foreground
              span icon=MapPin "{job.location.city}, {job.location.state}"
              span icon=Clock "Posted {timeAgo}"
              span icon=Gavel "{bidCount} bids"
          CardFooter
            p.font-semibold "Budget: ${job.budgetMin} - ${job.budgetMax}"
    Link [/browse?category={slug}] "View all open jobs →"
```

**Data Requirements:**
- `GET /api/v1/categories/{slug}` via `JobService.GetCategory` -- category details + subcategories
- `GET /api/v1/search/providers?category={slug}&limit=6&sort=trust_score` via `SearchService.SearchProviders` -- top providers
- `GET /api/v1/jobs?category={slug}&status=open&limit=4&sort=created_at` via `JobService.ListJobs` -- recent open jobs
- TanStack Query keys: `["category", slug]`, `["providers", "category", slug]`, `["jobs", "category", slug]`

**User Interactions:**
| Action | Result |
|---|---|
| Click subcategory chip | Filters providers and jobs to that subcategory (URL param `sub={subcategorySlug}`) |
| Click ProviderCard | Navigate to `/providers/[id]` |
| Click JobCard | Navigate to `/login?redirect=/dashboard/jobs/{id}` (or job detail if authenticated) |
| Click "View all" links | Navigate to `/browse` with category pre-filtered |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton header, chip placeholders, skeleton cards |
| Loaded | Full category page with providers and jobs |
| No providers | "No providers in this category yet" + CTA to join as provider |
| No open jobs | "No open jobs right now" + CTA to post a job |
| Category not found | `notFound()` -- renders Next.js 404 page |

**Responsive:** Provider grid: 1 col mobile, 2 cols md, 3 cols lg+. Job grid: 1 col mobile, 2 cols md+. Subcategory chips wrap naturally.

**Accessibility:**
- `<h1>` on category name, `<h2>` on section headings
- Subcategory chips use `role="listbox"` with `aria-selected` on active chip
- JobCard links are keyboard navigable; entire card is clickable via wrapping `<a>`

**SEO:** Indexed with dynamic metadata (`generateMetadata`). Title: "{Category Name} Services | NoMarkup". Description generated from `category.description`.

---

### 14. `/terms`

**Route path:** `/terms`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
TermsPage
  div.max-w-4xl.mx-auto.py-8.flex.flex-col.lg:flex-row.gap-8

    TableOfContents [class="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-20 lg:self-start"]
      nav [aria-label="Table of Contents"]
        ul.space-y-2
          li > a [href="#section-id"] "Section Title" x N
          // Active section highlighted via IntersectionObserver

    article.prose.prose-neutral.max-w-none.flex-1
      h1 "Terms of Service"
      p.text-muted-foreground "Last updated: {date}"
      // Sections rendered from MDX or static content
      section [id="acceptance"] h2 + content
      section [id="definitions"] h2 + content
      section [id="user-accounts"] h2 + content
      section [id="services"] h2 + content
      section [id="payments"] h2 + content
      section [id="disputes"] h2 + content
      section [id="liability"] h2 + content
      section [id="termination"] h2 + content
      section [id="changes"] h2 + content
      section [id="contact"] h2 + content
```

**Data Requirements:**
- None. Content is static MDX or hardcoded.

**User Interactions:**
| Action | Result |
|---|---|
| Click TOC link | Smooth scroll to corresponding section |
| Scroll through content | Active TOC item updates via IntersectionObserver |
| On mobile, tap "Table of Contents" toggle | Collapsible TOC expands/collapses above content |

**States:**
| State | Appearance |
|---|---|
| Default | TOC sidebar (desktop) or collapsed toggle (mobile) + full article content |
| Active section | Corresponding TOC link highlighted with `font-semibold text-primary` |

**Responsive:** On lg+: TOC is a sticky sidebar (w-64). On < lg: TOC collapses into a `Collapsible` component above the content, toggled by a button "Table of Contents".

**Accessibility:**
- TOC uses `<nav aria-label="Table of Contents">`
- Sections use `<section>` with `id` attributes for anchor links
- Prose content uses semantic headings (`<h2>`, `<h3>`)
- Scroll-to behavior respects `prefers-reduced-motion` (instant scroll if reduced)

**SEO:** Indexed. Title: "Terms of Service | NoMarkup"

---

### 15. `/privacy`

**Route path:** `/privacy`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
PrivacyPage
  div.max-w-4xl.mx-auto.py-8.flex.flex-col.lg:flex-row.gap-8

    TableOfContents [same pattern as /terms]
      nav [aria-label="Table of Contents"]
        ul.space-y-2
          li > a [href="#section-id"] "Section Title" x N

    article.prose.prose-neutral.max-w-none.flex-1
      h1 "Privacy Policy"
      p.text-muted-foreground "Last updated: {date}"
      section [id="information-we-collect"] h2 + content
      section [id="how-we-use"] h2 + content
      section [id="sharing"] h2 + content
      section [id="cookies"] h2 + content
      section [id="data-retention"] h2 + content
      section [id="your-rights"] h2 + content
      section [id="security"] h2 + content
      section [id="children"] h2 + content
      section [id="changes"] h2 + content
      section [id="contact"] h2 + content
```

**Data Requirements:**
- None. Content is static MDX or hardcoded.

**User Interactions:**
| Action | Result |
|---|---|
| Click TOC link | Smooth scroll to corresponding section |
| Scroll through content | Active TOC item updates via IntersectionObserver |
| On mobile, tap "Table of Contents" toggle | Collapsible TOC expands/collapses above content |

**States:**
| State | Appearance |
|---|---|
| Default | TOC sidebar (desktop) or collapsed toggle (mobile) + full article content |
| Active section | Corresponding TOC link highlighted with `font-semibold text-primary` |

**Responsive:** Same as `/terms` -- sticky sidebar on lg+, collapsible toggle on < lg.

**Accessibility:** Same patterns as `/terms`. `<nav aria-label="Table of Contents">`, semantic sections with `id` anchors, `prefers-reduced-motion` respected for scroll.

**SEO:** Indexed. Title: "Privacy Policy | NoMarkup"

---

### 16. `/contact`

**Route path:** `/contact`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
ContactPage
  div.max-w-4xl.mx-auto.py-8.grid.grid-cols-1.lg:grid-cols-3.gap-8

    div.lg:col-span-2
      h1 "Contact Us"
      p "Have a question or need help? Send us a message."

      ContactForm
        Input [name, autocomplete="name", placeholder="Your name"]
        Input [email, type="email", autocomplete="email", placeholder="Your email"]
        Select [subject, placeholder="Select a subject"]
          SelectItem "General Inquiry"
          SelectItem "Account Issue"
          SelectItem "Billing Question"
          SelectItem "Report a Problem"
          SelectItem "Partnership Inquiry"
          SelectItem "Other"
        Textarea [message, rows=6, placeholder="Your message...", maxLength=2000]
          p.text-sm.text-muted-foreground "{charCount}/2000"
        Button [submit, full-width] "Send Message"

    aside.lg:col-span-1
      Card
        CardHeader
          h2 "Get in Touch"
        CardContent.space-y-4
          div.flex.items-center.gap-3
            MailIcon
            a [href="mailto:support@nomarkup.com"] "support@nomarkup.com"
          div.flex.items-center.gap-3
            MapPinIcon
            address "123 Main St, Austin, TX 78701"
          div.flex.items-center.gap-3
            ClockIcon
            p "Mon-Fri, 9am-6pm CST"
          Separator
          h3 "Follow Us"
          div.flex.gap-3
            IconButton [Twitter, aria-label="Twitter"] -> external
            IconButton [LinkedIn, aria-label="LinkedIn"] -> external
            IconButton [Facebook, aria-label="Facebook"] -> external
```

**Data Requirements:**
- `POST /api/v1/support/contact` via `SupportService.SubmitContactForm` on form submit
- Request body: `{ name, email, subject, message }`

**Form Schema (Zod):**
```typescript
const contactSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Enter a valid email address"),
  subject: z.enum([
    "general",
    "account",
    "billing",
    "report",
    "partnership",
    "other",
  ], { required_error: "Select a subject" }),
  message: z.string()
    .min(10, "Message must be at least 10 characters")
    .max(2000, "Message must be under 2000 characters"),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Fill out form and submit | Message sent, confirmation state shown |
| Submit with validation errors | Inline field errors below each invalid field |
| Click email link | Opens default mail client |
| Click social icon | Opens social profile in new tab |

**States:**
| State | Appearance |
|---|---|
| Default | Empty form, company info sidebar |
| Submitting | Button spinner, inputs disabled |
| Success | Form replaced with: CheckCircle icon + "Message sent!" + "We'll get back to you within 24 hours." + Button "Send another message" (resets form) |
| Error | Toast: "Failed to send message. Please try again." |

**Responsive:** On mobile (< lg): company info card stacks below the form. On lg+: form takes 2/3 width, sidebar takes 1/3.

**Accessibility:**
- All inputs have associated `<label>` elements
- Error messages linked via `aria-describedby`
- Character count uses `aria-live="polite"` to announce remaining characters
- Success state uses `role="status"`
- Social links open in new tab with `rel="noopener noreferrer"` and have `aria-label`

**SEO:** Indexed. Title: "Contact Us | NoMarkup"

---

### 17. `/about`

**Route path:** `/about`
**Access control:** Public
**Layout:** `(public)` Header + main + Footer

**Components:**
```
AboutPage
  MissionSection
    div.max-w-3xl.mx-auto.text-center.py-16
      h1 "About NoMarkup"
      p.text-xl.text-muted-foreground
        "We believe homeowners deserve transparent pricing and providers
         deserve a fair marketplace. NoMarkup connects them — without
         the middleman markup."

  StatsSection
    div.grid.grid-cols-2.md:grid-cols-4.gap-8.py-12.text-center
      StatBlock [value="10,000+", label="Jobs Completed"]
      StatBlock [value="2,500+", label="Verified Providers"]
      StatBlock [value="50+", label="Service Categories"]
      StatBlock [value="4.8/5", label="Average Rating"]

  ValuesSection
    SectionHeading "Our Values"
    div.grid.grid-cols-1.md:grid-cols-3.gap-8
      ValueCard [icon=Eye, "Transparency", "No hidden fees, no markups. What you see is what you pay."]
      ValueCard [icon=ShieldCheck, "Trust", "Every provider is verified. Every review is real."]
      ValueCard [icon=Users, "Community", "We're building a marketplace that works for everyone."]

  TeamSection
    SectionHeading "Meet the Team"
    div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-3.gap-8
      TeamMemberCard x N
        Avatar [size="lg", src=member.photo]
        h3 "{member.name}"
        p.text-muted-foreground "{member.role}"
        p.text-sm "{member.bio}"

  CtaSection
    div.bg-muted.text-center.py-16.rounded-lg
      h2 "Join the NoMarkup Community"
      p "Whether you need a service or provide one, there's a place for you."
      div.flex.gap-4.justify-center
        Button "Get Started" -> /register
        Button [variant="outline"] "Learn More" -> /how-it-works
```

**Data Requirements:**
- None. All content is static. Stats may be fetched from `GET /api/v1/stats/public` if dynamic, otherwise hardcoded in constants.

**User Interactions:**
| Action | Result |
|---|---|
| Click "Get Started" | Navigate to `/register` |
| Click "Learn More" | Navigate to `/how-it-works` |

**States:**
| State | Appearance |
|---|---|
| Default | All sections rendered with static content |

**Responsive:** Stats grid: 2 cols on mobile, 4 cols on md+. Values grid: 1 col mobile, 3 cols md+. Team grid: 1 col mobile, 2 cols sm, 3 cols lg+.

**Accessibility:**
- `<h1>` on "About NoMarkup", section headings use `<h2>`
- StatBlock values use `aria-label` for screen readers (e.g., "Over ten thousand jobs completed")
- Team member photos have `alt="{name}, {role}"`
- All CTA buttons have descriptive text

**SEO:** Indexed. Title: "About | NoMarkup"
## (dashboard) Route Group -- Customer Pages

**Layout:** `(dashboard)/layout.tsx`

```
<div class="flex min-h-screen">
  <Sidebar class="hidden md:flex w-64 shrink-0">  // collapsible, 256px
    LogoLink
    SidebarNav
      NavItem [Home, LayoutDashboard icon, /dashboard]
      NavItem [Jobs, Briefcase icon, /dashboard/jobs]
      NavItem [Messages, MessageSquare icon, /dashboard/messages] + UnreadBadge
      NavItem [Payments, CreditCard icon, /dashboard/payments]
      NavItem [Settings, Settings icon, /dashboard/settings]
    SidebarFooter
      UserMenu [avatar, name, role badge, sign-out]
  </Sidebar>
  <main class="flex-1 overflow-y-auto">
    Breadcrumbs
    {children}
  </main>
  <MobileTabBar class="md:hidden fixed bottom-0">  // 5 tabs
    TabItem [Home] TabItem [Jobs] TabItem [Messages] TabItem [Payments] TabItem [More]
  </MobileTabBar>
</div>
```

**Role switching:** `useAuthStore().roles` determines whether customer or provider sub-routes render. If user has both roles, a role toggle appears in `SidebarFooter`.

**Responsive:** Sidebar visible at `md+` (768px). Below `md`, sidebar is hidden and `MobileTabBar` renders at bottom. Main content gets `pb-16` on mobile for tab bar clearance.

---

### 18. `/dashboard` (Customer Home)

**Route path:** `/dashboard`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
CustomerDashboardPage
  div.space-y-6.p-6
    WelcomeHeader
      h1 "Welcome back, {firstName}"
      p "Here's what's happening with your jobs"
    StatsCardRow.grid.grid-cols-2.lg:grid-cols-4.gap-4
      StatCard [icon=Briefcase, label="Active Jobs", value={count}, href=/dashboard/jobs?status=active]
      StatCard [icon=Gavel, label="Pending Bids", value={count}, href=/dashboard/jobs]
      StatCard [icon=MessageSquare, label="Unread Messages", value={count}, href=/dashboard/messages]
      StatCard [icon=DollarSign, label="Spent This Month", value={formatted$}]
    section
      SectionHeader "Active Jobs" + Link "View all" -> /dashboard/jobs
      ActiveJobsList [max 3 items]
        JobCard [title, category badge, status badge, bid count, posted date]
        // or EmptyState "No active jobs. Post your first job to get started."
    section
      SectionHeader "Recent Activity"
      ActivityFeed
        ActivityItem [icon, description, timestamp]
        // types: bid_received, payment_processed, review_submitted, job_completed
    QuickAction
      Button [variant="default", size="lg"] "Post a New Job" -> /dashboard/jobs/new
```

**Data Requirements:**
- `GET /api/v1/customers/me/jobs?status=active&limit=3` via `JobService.ListCustomerJobs`
- `GET /api/v1/notifications?limit=10` via `NotificationService.ListNotifications` (activity feed)
- `GET /api/v1/chat/unread-count` via `ChatService.GetUnreadCount`
- `GET /api/v1/payments?limit=1&sort=created_at` via `PaymentService.ListPayments` (monthly spend calculated client-side or via aggregated endpoint)
- TanStack Query keys: `["dashboard", "customer"]`, `["jobs", "active"]`, `["notifications"]`, `["chat", "unread"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click stat card | Navigate to corresponding filtered list page |
| Click job card | Navigate to `/dashboard/jobs/{id}` |
| Click activity item | Navigate to relevant resource (job, payment, review) |
| Click "Post a New Job" | Navigate to `/dashboard/jobs/new` |
| Click "View all" on active jobs | Navigate to `/dashboard/jobs?status=active` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards (4), skeleton list (3 rows), skeleton feed (5 rows) |
| Empty (new user) | Stats all show 0, empty state illustration with CTA "Post your first job" |
| Populated | Stats filled, job cards rendered, activity feed populated |
| Error | Toast with retry, stale data shown if cached |

**Responsive:** Stats grid: 2 cols on mobile, 4 cols on `lg+`. Job cards stack vertically at all sizes. Activity feed is full-width.

**Accessibility:** StatCards are `<a>` elements with `aria-label` including count. ActivityFeed uses `<ol>` with `aria-label="Recent activity"`. All timestamps use `<time datetime>`.

**SEO:** Not indexed. Title: "Dashboard | NoMarkup"

---

### 19. `/dashboard/jobs/new` (Post a Job)

**Route path:** `/dashboard/jobs/new`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

Multi-step form (6 steps). State managed by `useJobPostingFormStore` (Zustand, persisted to localStorage). React Hook Form per step with Zod validation.

**Step Indicator:**
```
StepIndicator.flex.items-center.justify-between.mb-8
  StepDot [1: "Category"]
  StepConnector
  StepDot [2: "Details"]
  StepConnector
  StepDot [3: "Location"]
  StepConnector
  StepDot [4: "Photos"]
  StepConnector
  StepDot [5: "Budget"]
  StepConnector
  StepDot [6: "Review"]
```

**Step 1 -- Category:**
```
CategoryStep
  h2 "What service do you need?"
  CategoryTree
    Select [category, placeholder="Select category"]        // top-level
    Select [subcategory, placeholder="Select subcategory"]  // filtered by category
    Select [serviceType, placeholder="Select service type"] // filtered by subcategory
  div.flex.justify-end
    Button [next] "Continue"
```

**Step 2 -- Details:**
```
DetailsStep
  h2 "Describe the job"
  Input [title, maxLength=100, placeholder="e.g. Kitchen sink repair"]
  Textarea [description, minLength=50, maxLength=2000]
    CharacterCount "{current}/2000"
  Select [urgency]
    Option "Flexible - no rush"
    Option "Within a week"
    Option "Urgent - within 48 hours"
    Option "Emergency - ASAP"
  div.flex.justify-between
    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 3 -- Location:**
```
LocationStep
  h2 "Where is the job?"
  // If user has saved properties:
  RadioGroup [locationSource]
    RadioItem [saved] "Use a saved property"
    RadioItem [new] "Enter a new address"
  // If saved selected:
  Select [propertyId, from saved properties]
  // If new or no saved properties:
  AddressAutocomplete [address, via Mapbox Geocoding API]
  MapPreview [pin on selected address, 300px height, Mapbox GL JS]
  div.flex.justify-between
    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 4 -- Photos:**
```
PhotosStep
  h2 "Add photos (optional)"
  p "Help providers understand the job. Up to 10 photos, 10MB each."
  PhotoDropZone [accept="image/*", maxFiles=10, maxSize=10MB]
    // Drag-and-drop area with dashed border
    UploadCloudIcon
    p "Drag photos here or click to browse"
  PhotoPreviewGrid.grid.grid-cols-3.sm:grid-cols-5.gap-2
    PhotoThumbnail [src, reorder handle, delete X button]
    // Sortable via drag; uses @dnd-kit
  div.flex.justify-between
    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 5 -- Budget & Timeline:**
```
BudgetStep
  h2 "Budget and timeline"
  div.grid.grid-cols-2.gap-4
    Input [budgetMin, type="number", prefix="$", placeholder="Min"]
    Input [budgetMax, type="number", prefix="$", placeholder="Max"]
  Select [paymentTerms]
    Option "Upon completion"
    Option "Milestone-based"
    Option "Upfront"
  Input [preferredStartDate, type="date"]
  div.flex.items-center.gap-2
    Switch [recurring]
    label "This is a recurring job"
  // If recurring toggled on:
  Select [recurringFrequency]
    Option "Weekly"  Option "Bi-weekly"  Option "Monthly"  Option "Quarterly"
  div.flex.justify-between
    Button [back, variant="ghost"] "Back"
    Button [next] "Continue"
```

**Step 6 -- Review:**
```
ReviewStep
  h2 "Review your job posting"
  ReviewSection [title="Category"] {category > subcategory > serviceType} + EditButton -> step 1
  ReviewSection [title="Details"] {title, description, urgency} + EditButton -> step 2
  ReviewSection [title="Location"] {address, map thumbnail} + EditButton -> step 3
  ReviewSection [title="Photos"] {photo thumbnails, count} + EditButton -> step 4
  ReviewSection [title="Budget & Timeline"] {range, terms, schedule} + EditButton -> step 5
  div.flex.justify-between
    Button [back, variant="ghost"] "Back"
    Button [submit, variant="default"] "Post Job"
```

**Data Requirements:**
- `GET /api/v1/categories/tree` via `JobService.GetCategoryTree` (step 1)
- `GET /api/v1/properties` via `UserService.ListProperties` (step 3)
- `POST /api/v1/jobs` via `JobService.CreateJob` (on submit)
- Image uploads: `POST /api/v1/images/upload` via `ImagingService.UploadImage` (step 4)
- Draft auto-save to `localStorage` every 30s via `useJobPostingFormStore.persist`
- TanStack Query keys: `["categories", "tree"]`, `["properties"]`

**Form Schema (Zod, per step):**
```typescript
const step1Schema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  subcategoryId: z.string().min(1, "Select a subcategory"),
  serviceTypeId: z.string().min(1, "Select a service type"),
});

const step2Schema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(100),
  description: z.string().min(50, "At least 50 characters").max(2000),
  urgency: z.enum(["flexible", "within_week", "urgent", "emergency"]),
});

const step3Schema = z.object({
  propertyId: z.string().optional(),
  address: addressSchema.optional(),
}).refine((d) => d.propertyId || d.address, {
  message: "Select a property or enter an address",
});

const step4Schema = z.object({
  photos: z.array(z.string().url()).max(10).optional(),
});

const step5Schema = z.object({
  budgetMin: z.number().min(1, "Enter a minimum budget"),
  budgetMax: z.number().min(1, "Enter a maximum budget"),
  paymentTerms: z.enum(["upon_completion", "milestone", "upfront"]),
  preferredStartDate: z.string().optional(),
  recurring: z.boolean().default(false),
  recurringFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly"]).optional(),
}).refine((d) => d.budgetMax >= d.budgetMin, {
  message: "Max budget must be >= min budget",
  path: ["budgetMax"],
}).refine((d) => !d.recurring || d.recurringFrequency, {
  message: "Select a frequency for recurring jobs",
  path: ["recurringFrequency"],
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Click Continue on valid step | Advance to next step, data persisted to Zustand store |
| Click Back | Return to previous step, data preserved |
| Click Edit on review step | Jump to that step, return to review after |
| Drop photos onto zone | Upload begins, thumbnails appear with progress indicator |
| Drag photo thumbnail | Reorder photos via @dnd-kit sortable |
| Click X on photo | Remove photo with confirmation if only photo |
| Toggle recurring switch | Show/hide frequency selector |
| Click "Post Job" on review | Submit to API, redirect to `/dashboard/jobs/{newId}` |
| Close browser mid-flow | Draft auto-saved to localStorage, restored on return |

**States:**
| State | Appearance |
|---|---|
| Step active | Active step dot filled primary, completed steps show checkmark |
| Uploading photos | Thumbnail with overlay progress bar, disabled Continue |
| Submitting | "Post Job" shows spinner, all inputs disabled |
| Draft restored | Toast: "Draft restored. Pick up where you left off." |
| Submit error | Toast with error message, form remains editable |

**Responsive:** Step indicator shows dots only on mobile (< sm), dots + labels on sm+. Photo grid: 3 cols on mobile, 5 cols on sm+. Budget inputs stack on mobile (1 col), side-by-side on sm+.

**Accessibility:**
- Step indicator uses `aria-current="step"` and `aria-label="Step {n} of 6: {name}"`
- All form fields have `<label>` elements; Textarea has `aria-describedby` for character count
- PhotoDropZone has `role="button"` and keyboard activation (Enter/Space)
- Drag-and-drop has keyboard alternatives (arrow keys to reorder)
- Map preview has `aria-label="Job location preview"`

**SEO:** Not indexed. Title: "Post a Job | NoMarkup"

---

### 20. `/dashboard/jobs` (Job List)

**Route path:** `/dashboard/jobs`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
CustomerJobListPage
  div.space-y-4.p-6
    PageHeader
      h1 "My Jobs"
      Button "Post a New Job" -> /dashboard/jobs/new
    Tabs [value from URL searchParam "status"]
      TabsList
        TabsTrigger [all] "All"
        TabsTrigger [active] "Active"
        TabsTrigger [completed] "Completed"
        TabsTrigger [cancelled] "Cancelled"
    SearchInput [placeholder="Search jobs...", debounce 300ms]
    TabsContent
      JobCardList
        JobCard [each]
          div.flex.justify-between
            div
              h3.font-semibold {title}
              div.flex.gap-2
                Badge [variant by category] {categoryName}
                Badge [variant by status] {status}
            div.text-right
              p.text-sm {bidCount} bids
              p.text-sm.text-muted-foreground ${budgetMin}-${budgetMax}
              p.text-xs.text-muted-foreground Posted {relativeDate}
      // or:
      EmptyState [per tab]
        illustration
        p "No {tab} jobs yet"
        Button "Post a Job" (only on "all" tab empty state)
    Pagination [page, totalPages]
```

**Data Requirements:**
- `GET /api/v1/customers/me/jobs?status={tab}&search={query}&page={n}&limit=10` via `JobService.ListCustomerJobs`
- TanStack Query keys: `["jobs", "customer", { status, search, page }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Filter jobs by status, URL searchParam updates, refetch |
| Type in search | Debounced 300ms filter by title, resets to page 1 |
| Click job card | Navigate to `/dashboard/jobs/{id}` |
| Click "Post a New Job" | Navigate to `/dashboard/jobs/new` |
| Click pagination | Load next/prev page |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards (3 rows) |
| Empty (tab) | Illustration + "No {tab} jobs" message |
| Empty (search) | "No jobs matching '{query}'" with clear search button |
| Populated | Job cards rendered in list |

**Responsive:** JobCards are full-width at all breakpoints. Search input spans full width on mobile. Pagination centered below list.

**Accessibility:** Tabs use `role="tablist"` / `role="tab"` / `role="tabpanel"`. Job cards are `<a>` with descriptive `aria-label`. Search input has `aria-label="Search jobs"`. Status badges use `aria-label` for screen readers (not color-only).

**SEO:** Not indexed. Title: "My Jobs | NoMarkup"

---

### 21. `/dashboard/jobs/[id]` (Job Detail)

**Route path:** `/dashboard/jobs/[id]`
**Access control:** `role:customer` (must own job)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
CustomerJobDetailPage
  div.space-y-6.p-6
    JobHeader
      div.flex.justify-between.items-start
        div
          h1 {title}
          div.flex.gap-2.mt-1
            Badge [status]
            Badge [variant="outline"] {categoryName}
            span.text-muted-foreground "Posted {relativeDate}"
        div.flex.gap-2
          Button [variant="outline", if draft/open] "Edit" -> /dashboard/jobs/[id]/edit
          AlertDialog
            Button [variant="destructive", if open/bidding] "Cancel Job"
            AlertDialogContent "Are you sure? This will reject all pending bids."
              Button "Cancel Job" -> POST /api/v1/jobs/{id}/cancel
    Tabs [defaultValue="overview"]
      TabsList
        TabsTrigger "Overview"
        TabsTrigger "Bids" + Badge {bidCount}
        TabsTrigger "Contract"
        TabsTrigger "Activity"
      TabsContent [overview]
        section "Description"
          p {description}
        section "Photos"
          PhotoGallery [lightbox on click, grid of thumbnails]
        section "Location"
          MapDisplay [pin, 200px height, Mapbox GL JS]
          p {formattedAddress}
        section "Budget & Timeline"
          dl
            dt "Budget" dd "${min} - ${max}"
            dt "Payment terms" dd {paymentTerms}
            dt "Timeline" dd {preferredStartDate or "Flexible"}
            dt "Recurring" dd {frequency or "No"}
      TabsContent [bids]
        BidSortControls
          Select [sortBy: "Price (low)", "Trust Score (high)", "Rating (high)"]
        BidCardList
          BidCard [each]
            div.flex.gap-4
              Avatar [provider]
              div
                p.font-semibold {providerName}
                div.flex.gap-2
                  TrustScoreBadge {score}
                  StarRating {rating}
              div.text-right
                p.text-lg.font-bold ${amount}
                p.text-sm.text-muted-foreground {messagePreview, truncated 100 chars}
            Button "View Full Bid" -> /dashboard/jobs/[id]/bids
          // or EmptyState "No bids yet. Providers will start bidding soon."
        SealedBidNotice [if before bidding_ends_at]
          LockIcon + "Bids are sealed until {bidding_ends_at}. You'll see full details after."
      TabsContent [contract]
        // If contract exists:
        ContractSummaryCard [contractNumber, status, provider, amount]
          Button "View Contract" -> /dashboard/jobs/[id]/contract
        // Else:
        EmptyState "No contract yet. Award a bid to create a contract."
      TabsContent [activity]
        ActivityTimeline
          TimelineItem [each, icon by type]
            p {description}
            time {timestamp}
```

**Data Requirements:**
- `GET /api/v1/jobs/{id}` via `JobService.GetJob`
- `GET /api/v1/jobs/{id}/bids?sort={sortBy}` via `BidService.ListBidsForJob`
- `GET /api/v1/jobs/{id}/bids/count` via `BidService.GetBidCount`
- `GET /api/v1/contracts?job_id={id}` via `ContractService.ListContracts`
- TanStack Query keys: `["jobs", id]`, `["bids", { jobId: id }]`, `["contracts", { jobId: id }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Switch tab content, no refetch for overview (cached) |
| Click "Edit" | Navigate to edit form (pre-filled from job data) |
| Click "Cancel Job" | Confirmation dialog, then POST cancel, redirect to job list |
| Click photo thumbnail | Open lightbox gallery |
| Change bid sort | Re-sort bid list (client-side if all loaded, or refetch) |
| Click "View Full Bid" | Navigate to `/dashboard/jobs/[id]/bids` comparison view |
| Click "View Contract" | Navigate to `/dashboard/jobs/[id]/contract` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton header + skeleton tab content |
| Job not found | 404 page: "This job doesn't exist or you don't have access" |
| Sealed bids | Bid tab shows count but amounts hidden, lock icon notice |
| Open bids | Full bid details visible, Award button on each bid card |
| Awarded | Bids tab shows winning bid highlighted, others dimmed |
| Completed | "Edit" and "Cancel" buttons hidden, review CTA shown |

**Responsive:** Tabs are scrollable horizontally on mobile. Photo gallery: 2 cols on mobile, 3 cols on sm+, 4 cols on lg+. Map is full-width at all sizes.

**Accessibility:** Tabs follow WAI-ARIA tabs pattern. Photo gallery lightbox traps focus, Esc closes. AlertDialog traps focus. Map has `role="img"` with `aria-label`.

**SEO:** Not indexed. Title: "{jobTitle} | NoMarkup"

---

### 22. `/dashboard/jobs/[id]/bids` (Bid Comparison)

**Route path:** `/dashboard/jobs/[id]/bids`
**Access control:** `role:customer` (must own job)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
BidComparisonPage
  div.space-y-4.p-6
    PageHeader
      Breadcrumb [Jobs > {jobTitle} > Compare Bids]
      h1 "Compare Bids"
      p.text-muted-foreground "{bidCount} bids for {jobTitle}"
    SealedBidBanner [if before bidding_ends_at]
      AlertTriangle icon
      p "Bids are sealed until {date}. Amounts and details are hidden."
    div.flex.gap-2.mb-4
      Select [sortBy: "Price: Low to High", "Trust Score: Highest", "Rating: Highest"]
      Select [filter: "All", "Within Budget", "Above Budget"]
    div.grid.md:grid-cols-2.xl:grid-cols-3.gap-4
      BidComparisonCard [each]
        Card
          CardHeader
            div.flex.gap-3
              Avatar [provider, size=48]
              div
                p.font-semibold {providerName}
                div.flex.gap-1
                  StarRating [small] {rating} ({reviewCount})
                TrustScoreBadge {trustScore}
          CardContent
            p.text-2xl.font-bold ${amount}
            p.text-sm {message, full text}
            Separator
            dl.grid.grid-cols-2.gap-2.text-sm
              dt "Jobs completed" dd {completedJobsCount}
              dt "Avg rating" dd {avgRating}
              dt "Response time" dd {avgResponseTime}
              dt "Member since" dd {memberSince}
          CardFooter
            AlertDialog
              Button [full-width] "Award this Bid"
              AlertDialogContent
                h3 "Award bid to {providerName}?"
                p "This will create a contract for ${amount}. Other bids will be declined."
                div.flex.gap-2
                  Button [variant="outline"] "Cancel"
                  Button "Confirm Award"
```

**Data Requirements:**
- `GET /api/v1/jobs/{id}/bids` via `BidService.ListBidsForJob`
- `POST /api/v1/bids/{bidId}/award` via `BidService.AwardBid`
- TanStack Query keys: `["bids", { jobId: id }]`

**User Interactions:**
| Action | Result |
|---|---|
| Change sort | Re-sort cards by selected criteria |
| Change filter | Filter visible cards |
| Click "Award this Bid" | Confirmation dialog opens |
| Confirm award | POST award, toast "Bid awarded!", redirect to `/dashboard/jobs/[id]/contract` |
| Cancel dialog | Close dialog, no action |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton grid (3 cards) |
| Sealed | Banner shown, bid amounts replaced with "Sealed", award buttons disabled |
| Open | Full bid details, award buttons enabled |
| Empty | "No bids received yet" with link back to job |
| Awarding | Award button shows spinner, other cards dimmed |

**Responsive:** Grid: 1 col on mobile, 2 cols on md, 3 cols on xl. Cards are equal-height within each row.

**Accessibility:** Each card is a landmark `<article>` with `aria-label="{providerName}'s bid"`. AlertDialog traps focus. Award confirmation is keyboard navigable.

**SEO:** Not indexed. Title: "Compare Bids | NoMarkup"

---

### 23. `/dashboard/jobs/[id]/contract` (Contract View)

**Route path:** `/dashboard/jobs/[id]/contract`
**Access control:** `role:customer` (must own job)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
ContractViewPage
  div.space-y-6.p-6
    ContractHeader
      div.flex.justify-between.items-start
        div
          h1 "Contract #{contractNumber}"
          div.flex.gap-2
            Badge [status]
            span.text-muted-foreground "Created {date}"
        div.flex.gap-2
          Button [variant="outline"] icon Download "Export PDF"
            // GET /api/v1/contracts/{contractId}/pdf
          Button [variant="outline"] "Message Provider" -> /dashboard/messages/{channelId}
    Card "Terms"
      CardContent
        dl.grid.sm:grid-cols-2.gap-4
          dt "Provider" dd {providerName} + Avatar
          dt "Agreed Amount" dd ${amount}
          dt "Payment Type" dd {paymentTerms}
          dt "Start Date" dd {startDate}
          dt "Estimated Completion" dd {estimatedEndDate}
    // If milestone-based:
    Card "Milestones"
      CardContent
        MilestoneList
          MilestoneItem [each]
            div.flex.justify-between.items-center
              div
                p.font-medium {milestoneName}
                p.text-sm.text-muted-foreground "Due {dueDate}"
              div.flex.items-center.gap-3
                Badge [status: pending/submitted/approved/disputed]
                p.font-semibold ${amount}
            // If status=submitted:
            div.flex.gap-2.mt-2
              Button [variant="default"] "Approve"
              Button [variant="outline"] "Request Revision"
    Card "Payment History"
      CardContent
        Table
          TableHeader [Date, Description, Amount, Status, Receipt]
          TableBody
            TableRow [each payment]
              TableCell {date}
              TableCell {description}
              TableCell ${amount}
              TableCell Badge {status}
              TableCell Button [variant="ghost", size="sm"] "Receipt" -> opens PDF
    // Actions (based on contract status):
    div.flex.gap-2
      // If status=in_progress and provider marked complete:
      Button "Approve Completion"
      Button [variant="outline"] "Request Revision"
      // If dispute eligible:
      Button [variant="destructive", variant="outline"] "Open Dispute"
```

**Data Requirements:**
- `GET /api/v1/contracts/{contractId}` via `ContractService.GetContract`
- `GET /api/v1/payments?contract_id={contractId}` via `PaymentService.ListPayments`
- `POST /api/v1/contracts/{contractId}/milestones/{milestoneId}/approve` via `ContractService.ApproveMilestone`
- `POST /api/v1/contracts/{contractId}/milestones/{milestoneId}/revise` via `ContractService.RequestRevision`
- `POST /api/v1/contracts/{contractId}/approve-completion` via `ContractService.ApproveCompletion`
- `POST /api/v1/contracts/{contractId}/disputes` via `ContractService.OpenDispute`
- `GET /api/v1/contracts/{contractId}/pdf` via `ContractService.ExportContractPDF`
- TanStack Query keys: `["contracts", contractId]`, `["payments", { contractId }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Export PDF" | Downloads contract PDF |
| Click "Message Provider" | Navigate to message thread with provider |
| Click "Approve" on milestone | Confirmation dialog, then approve, payment released |
| Click "Request Revision" on milestone | Dialog with textarea for revision notes, then submit |
| Click "Approve Completion" | Confirmation dialog, then mark complete, final payment released |
| Click "Open Dispute" | Dialog with dispute reason textarea + category select, then POST |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards |
| No contract | "No contract yet. Award a bid to create one." with link to bids |
| Pending acceptance | Status "Pending", message "Waiting for provider to accept" |
| Active | Milestones shown with current progress, actions enabled |
| Completed | All milestones approved, "Completed" badge, review CTA |
| Disputed | Dispute badge, dispute details shown, actions disabled |

**Responsive:** Terms grid: 1 col on mobile, 2 cols on sm+. Payment table scrolls horizontally on mobile. Milestone actions stack vertically on mobile.

**Accessibility:** Milestone status badges have `aria-label`. Payment table uses `<caption>`. Action dialogs trap focus. PDF download link has `aria-label="Download contract PDF"`.

**SEO:** Not indexed. Title: "Contract #{number} | NoMarkup"

---

### 24. `/dashboard/messages` (Message List)

**Route path:** `/dashboard/messages`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
MessagesPage
  div.flex.h-[calc(100vh-4rem)]         // full height minus breadcrumb bar
    ChatList.w-full.md:w-80.md:border-r.overflow-y-auto
      SearchInput [placeholder="Search messages..."]
      ChannelPreviewList
        ChannelPreview [each, clickable]
          div.flex.gap-3.p-3
            Avatar [provider, size=40]
            div.flex-1.min-w-0
              div.flex.justify-between
                p.font-semibold.truncate {providerName}
                time.text-xs.text-muted-foreground {lastMessageTime}
              p.text-sm.text-muted-foreground.truncate {lastMessagePreview}
            UnreadBadge [count, if > 0]
        EmptyState [if no channels] "No messages yet"
    // Desktop: right pane placeholder when no channel selected
    div.hidden.md:flex.flex-1.items-center.justify-center.text-muted-foreground
      p "Select a conversation to start messaging"
```

**Data Requirements:**
- `GET /api/v1/chat/channels` via `ChatService.ListChannels`
- WebSocket `/api/v1/ws/chat` for real-time new message and typing indicators
- TanStack Query keys: `["chat", "channels"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click channel preview | Navigate to `/dashboard/messages/{channelId}` |
| Type in search | Filter channels by provider name (client-side) |
| Receive new message (WS) | Channel moves to top, preview updates, unread badge increments |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton list (5 channel previews) |
| Empty | Illustration + "No messages yet. Start a conversation from a job." |
| Populated | Channel list sorted by most recent message |
| Unread | Bold provider name, unread count badge on right |

**Responsive:** On mobile (< md), messages page shows only the channel list (full width). On md+, split pane: channel list (320px) + conversation area. Selected channel on mobile navigates to `/dashboard/messages/[channelId]` as full-screen.

**Accessibility:** Channel list uses `role="listbox"` with `role="option"` items. Unread badge uses `aria-label="{n} unread messages"`. Search input has `aria-label="Search conversations"`.

**SEO:** Not indexed. Title: "Messages | NoMarkup"

---

### 25. `/dashboard/messages/[channelId]` (Chat Thread)

**Route path:** `/dashboard/messages/[channelId]`
**Access control:** `role:customer` (must be channel participant)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
ChatThreadPage
  div.flex.flex-col.h-[calc(100vh-4rem)]
    ChatHeader.border-b.p-4
      div.flex.items-center.gap-3
        Button [variant="ghost", md:hidden] ChevronLeft -> /dashboard/messages
        Avatar [provider]
        div
          p.font-semibold {providerName}
          p.text-xs.text-muted-foreground {jobTitle}
    MessageArea.flex-1.overflow-y-auto.p-4
      MessageList
        DateSeparator [when date changes between messages]
        MessageBubble [each]
          // Sent messages: right-aligned, primary bg
          // Received messages: left-aligned, muted bg
          div.max-w-[70%]
            p {messageText}
            // If has image attachment:
            img.rounded.cursor-pointer [thumbnail, click for lightbox]
            time.text-xs.text-muted-foreground {timestamp}
        TypingIndicator [if provider is typing]
          div.flex.gap-1
            span.animate-bounce "."  span.animate-bounce.delay-100 "."  span.animate-bounce.delay-200 "."
    MessageInput.border-t.p-4
      div.flex.gap-2
        Button [variant="ghost", size="icon"] Paperclip
          // Hidden file input for photo attachment
        Input [placeholder="Type a message...", onEnter=send]
        Button [size="icon"] SendHorizontal
```

**Data Requirements:**
- `GET /api/v1/chat/channels/{channelId}/messages?limit=50&before={cursor}` via `ChatService.ListMessages`
- `POST /api/v1/chat/channels/{channelId}/messages` via `ChatService.SendMessage`
- `POST /api/v1/chat/channels/{channelId}/read` via `ChatService.MarkRead`
- `POST /api/v1/chat/channels/{channelId}/typing` via `ChatService.SendTypingIndicator`
- WebSocket `/api/v1/ws/chat` for real-time incoming messages, typing indicators, read receipts
- TanStack Query keys: `["chat", "messages", channelId]` (infinite query with cursor pagination)

**User Interactions:**
| Action | Result |
|---|---|
| Type message + press Enter or click Send | POST message, append to list, scroll to bottom |
| Click attach (Paperclip) | Open file picker for images |
| Scroll to top | Load older messages (infinite scroll, cursor-based) |
| Click image in message | Open lightbox |
| Click back arrow (mobile) | Navigate to `/dashboard/messages` |
| User is typing | Debounced POST typing indicator every 3s |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton message bubbles |
| Empty thread | "This is the beginning of your conversation with {provider}" |
| Populated | Message bubbles, newest at bottom, auto-scrolled |
| Sending | Message appears immediately (optimistic), faded until confirmed |
| Send failed | Message shows red exclamation + "Retry" button |
| Provider typing | Typing indicator dots at bottom of message area |
| Attachment uploading | Thumbnail with progress overlay |

**Responsive:** On mobile (< md), thread is full-screen with back arrow to channel list. On md+, thread renders in right pane of split layout. Message bubbles max 70% width at all sizes.

**Accessibility:** Message list uses `role="log"` with `aria-live="polite"` for new messages. Each bubble has `aria-label="{sender} at {time}: {message}"`. Input has `aria-label="Type a message"`. Typing indicator uses `aria-live="polite"` and `role="status"`.

**SEO:** Not indexed. Title: "Chat with {providerName} | NoMarkup"

---

### 26. `/dashboard/payments` (Payment List)

**Route path:** `/dashboard/payments`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
PaymentsPage
  div.space-y-4.p-6
    PageHeader
      h1 "Payments"
    div.flex.gap-2.mb-4
      Select [filter: "All", "Completed", "Pending", "Refunded"]
      Select [sort: "Newest", "Oldest", "Amount: High", "Amount: Low"]
    PaymentCardList
      PaymentCard [each, clickable -> /dashboard/payments/{id}]
        div.flex.justify-between.items-center.p-4
          div.flex.gap-3
            div.rounded-full.bg-muted.p-2
              CreditCard icon
            div
              p.font-semibold ${amount}
              p.text-sm.text-muted-foreground {providerName}
              p.text-sm.text-muted-foreground {jobTitle}
          div.text-right
            Badge [status: completed/pending/processing/refunded]
            p.text-xs.text-muted-foreground {date}
    EmptyState [if no payments]
      p "No payments yet. Payments will appear here once you award a job."
    Pagination [page, totalPages]
```

**Data Requirements:**
- `GET /api/v1/payments?role=customer&status={filter}&sort={sort}&page={n}&limit=10` via `PaymentService.ListPayments`
- TanStack Query keys: `["payments", "customer", { status, sort, page }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click payment card | Navigate to `/dashboard/payments/{id}` |
| Change filter | Filter payments, refetch |
| Change sort | Re-sort payments, refetch |
| Click pagination | Load next/prev page |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards (5 rows) |
| Empty | Illustration + "No payments yet" message |
| Populated | Payment cards rendered in list |

**Responsive:** Payment cards are full-width at all breakpoints. Filter/sort controls wrap on mobile (stack vertically).

**Accessibility:** Payment cards are `<a>` elements with `aria-label="Payment of ${amount} to {provider} on {date}"`. Status badges have `aria-label`. Filter/sort selects have visible labels.

**SEO:** Not indexed. Title: "Payments | NoMarkup"

---

### 27. `/dashboard/payments/[id]` (Payment Detail)

**Route path:** `/dashboard/payments/[id]`
**Access control:** `role:customer` (must own payment)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
PaymentDetailPage
  div.space-y-6.p-6
    PageHeader
      Breadcrumb [Payments > Payment #{id}]
      h1 "Payment Details"
      Badge [status]
    Card "Summary"
      CardContent
        dl.grid.sm:grid-cols-2.gap-4
          dt "Provider" dd {providerName}
          dt "Job" dd Link {jobTitle} -> /dashboard/jobs/{jobId}
          dt "Date" dd {paymentDate}
          dt "Payment Method" dd {cardBrand} ending {last4}
    Card "Breakdown"
      CardContent
        div.space-y-2
          div.flex.justify-between
            span "Subtotal"
            span ${subtotal}
          div.flex.justify-between
            span "Platform fee"
            span ${platformFee}
          Separator
          div.flex.justify-between.font-bold
            span "Total"
            span ${total}
    Card "Receipt"
      CardContent
        div.flex.justify-between.items-center
          p "Transaction ID: {transactionId}"
          Button [variant="outline", size="sm"] icon Download "Download Receipt"
    // If refund eligible (within 24h, not already refunded):
    Card "Refund"
      CardContent
        p.text-sm "If there's an issue, you can request a refund within 24 hours."
        AlertDialog
          Button [variant="destructive"] "Request Refund"
          AlertDialogContent
            h3 "Request a refund?"
            p "This will refund ${total} to your {cardBrand} ending {last4}."
            Textarea [reason, placeholder="Reason for refund (optional)"]
            Button "Confirm Refund"
```

**Data Requirements:**
- `GET /api/v1/payments/{paymentId}` via `PaymentService.GetPayment`
- `POST /api/v1/payments/{paymentId}/refund` via `PaymentService.CreateRefund`
- TanStack Query keys: `["payments", paymentId]`

**User Interactions:**
| Action | Result |
|---|---|
| Click job link | Navigate to `/dashboard/jobs/{jobId}` |
| Click "Download Receipt" | Download receipt PDF |
| Click "Request Refund" | Confirmation dialog with optional reason |
| Confirm refund | POST refund, toast "Refund requested", status updates to "refund_pending" |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards |
| Completed | Full details, receipt available, refund button if eligible |
| Refund pending | Status badge "Refund Pending", refund button disabled |
| Refunded | Status badge "Refunded", refund amount shown in breakdown |
| Not found | 404: "Payment not found" |

**Responsive:** Summary grid: 1 col on mobile, 2 cols on sm+. Breakdown is full-width at all sizes.

**Accessibility:** Breakdown uses `<dl>` with associated `<dt>`/`<dd>`. Transaction ID is selectable. AlertDialog traps focus. Download link has `aria-label="Download payment receipt"`.

**SEO:** Not indexed. Title: "Payment #{id} | NoMarkup"

---

### 28. `/dashboard/reviews/new/[contractId]` (Write a Review)

**Route path:** `/dashboard/reviews/new/[contractId]`
**Access control:** `role:customer` (must own contract, contract must be completed)
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
WriteReviewPage
  div.max-w-2xl.mx-auto.space-y-6.p-6
    PageHeader
      h1 "Review {providerName}"
      p "How was your experience with {jobTitle}?"
    ReviewForm
      Card "Overall Rating"
        StarRatingInput [overall, 1-5, required]
      Card "Detailed Ratings"
        div.space-y-4
          RatingRow [label="Quality of work"] StarRatingInput [quality, 1-5]
          RatingRow [label="Communication"] StarRatingInput [communication, 1-5]
          RatingRow [label="Punctuality"] StarRatingInput [punctuality, 1-5]
          RatingRow [label="Value for money"] StarRatingInput [value, 1-5]
      Card "Your Review"
        Textarea [text, minLength=50, maxLength=1000, placeholder="Share your experience..."]
          CharacterCount "{current}/1000"
      Card "Photos (optional)"
        PhotoDropZone [accept="image/*", maxFiles=3, maxSize=10MB]
        PhotoPreviewGrid.flex.gap-2
          PhotoThumbnail [each, delete button]
      // Preview before submit:
      Card "Preview"
        ReviewPreview
          div.flex.gap-2
            StarRating [overall]
            p.text-sm "by You"
          p {text}
          div.flex.gap-2
            img [each photo thumbnail]
      div.flex.justify-between
        Button [variant="ghost"] "Cancel" -> back
        Button [submit] "Submit Review"
```

**Data Requirements:**
- `GET /api/v1/contracts/{contractId}` via `ContractService.GetContract` (to get provider info)
- `GET /api/v1/reviews/eligibility?contract_id={contractId}` via `ReviewService.GetReviewEligibility`
- `POST /api/v1/reviews` via `ReviewService.CreateReview`
- Image uploads via `ImagingService`
- TanStack Query keys: `["contracts", contractId]`, `["reviews", "eligibility", contractId]`

**Form Schema (Zod):**
```typescript
const reviewSchema = z.object({
  contractId: z.string(),
  overall: z.number().min(1).max(5),
  quality: z.number().min(1).max(5),
  communication: z.number().min(1).max(5),
  punctuality: z.number().min(1).max(5),
  value: z.number().min(1).max(5),
  text: z.string().min(50, "At least 50 characters").max(1000),
  photos: z.array(z.string().url()).max(3).optional(),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Click star on any rating | Set rating, update preview |
| Type review text | Live character count updates, preview updates |
| Upload photo | Thumbnail appears in preview grid |
| Click "Submit Review" | POST review, toast "Review submitted!", redirect to `/dashboard/jobs/{id}` |
| Click "Cancel" | Navigate back (with unsaved changes warning if dirty) |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton for provider info |
| Not eligible | "You've already reviewed this contract" or "Contract not yet completed" |
| Default | Empty stars, empty textarea |
| Filling | Stars filled as clicked, character count updates |
| Submitting | Submit button spinner, inputs disabled |
| Error | Toast with error, form remains editable |

**Responsive:** Max width 672px (max-w-2xl) centered. Photo drop zone full-width. Star inputs large enough for touch (44px tap targets).

**Accessibility:** Star rating inputs use `role="radiogroup"` with `role="radio"` per star. Each star has `aria-label="{n} of 5 stars"`. Textarea has `aria-describedby` for character count. Preview section has `aria-live="polite"`.

**SEO:** Not indexed. Title: "Write a Review | NoMarkup"

---

### 29. `/dashboard/settings` (Settings Layout)

**Route path:** `/dashboard/settings`
**Access control:** `role:customer`
**Layout:** `(dashboard)` sidebar + main

**Components:**
```
SettingsLayout
  div.flex.gap-6.p-6
    // Desktop: vertical tab nav
    nav.hidden.md:block.w-48.shrink-0
      SettingsNav
        NavLink [/dashboard/settings] "Profile"
        NavLink [/dashboard/settings/security] "Security"
        NavLink [/dashboard/settings/notifications] "Notifications"
        NavLink [/dashboard/settings/payment-methods] "Payment Methods"
    // Mobile: horizontal scrollable tabs
    div.md:hidden.overflow-x-auto.mb-4
      TabsList [horizontal]
        TabsTrigger "Profile"
        TabsTrigger "Security"
        TabsTrigger "Notifications"
        TabsTrigger "Payment"
    div.flex-1.max-w-2xl
      {children}    // settings sub-page content
```

**Responsive:** Desktop: vertical sidebar nav (192px) + content. Mobile: horizontal scrollable tab bar above content.

---

### 30. `/dashboard/settings` (Profile Settings)

**Route path:** `/dashboard/settings` (index)
**Access control:** `role:customer`
**Layout:** `(dashboard)` > `SettingsLayout`

**Components:**
```
ProfileSettingsPage
  div.space-y-6
    h2 "Profile"
    Card "Personal Information"
      CardContent
        ProfileForm
          AvatarUpload [currentAvatar, click to change]
          div.grid.sm:grid-cols-2.gap-4
            Input [firstName]
            Input [lastName]
          Input [email, type="email"]
            // If email changed, note: "You'll need to verify your new email"
          Input [phone, type="tel"]
          AddressAutocomplete [address]
          div.flex.justify-end
            Button [submit] "Save Changes"
    Card "Properties"
      CardContent
        PropertyList
          PropertyItem [each]
            div.flex.justify-between
              div
                p.font-medium {label} (e.g. "Home", "Office")
                p.text-sm.text-muted-foreground {address}
              div.flex.gap-1
                Button [variant="ghost", size="icon"] Pencil (edit)
                Button [variant="ghost", size="icon"] Trash2 (delete)
          Button [variant="outline"] "+ Add Property"
            // Opens inline form or dialog with label + AddressAutocomplete
```

**Data Requirements:**
- `GET /api/v1/users/me` (from `useAuthStore`, already hydrated)
- `PATCH /api/v1/users/me` via `UserService.UpdateUser`
- `POST /api/v1/images/avatar` via `ImagingService.ProcessAvatar`
- `GET /api/v1/properties` via `UserService.ListProperties`
- `POST /api/v1/properties` via `UserService.CreateProperty`
- `PATCH /api/v1/properties/{id}` via `UserService.UpdateProperty`
- `DELETE /api/v1/properties/{id}` via `UserService.DeleteProperty`
- TanStack Query keys: `["user", "me"]`, `["properties"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click avatar | Open file picker, preview new avatar, upload on save |
| Edit fields + click "Save Changes" | PATCH user, toast "Profile updated" |
| Change email | Warning note shown; after save, verification email sent to new address |
| Click "Add Property" | Inline form or dialog for new property |
| Click edit on property | Inline edit mode for that property |
| Click delete on property | Confirmation dialog, then DELETE |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton form fields |
| Default | Pre-filled with current user data |
| Saving | Button spinner, inputs disabled |
| Saved | Toast "Profile updated", button re-enabled |
| Validation error | Red borders on invalid fields with messages |

**Accessibility:** All inputs have `<label>`. Avatar upload has `aria-label="Change profile photo"`. Property delete has confirmation dialog with focus trap.

**SEO:** Not indexed. Title: "Profile Settings | NoMarkup"

---

### 31. `/dashboard/settings/security` (Security Settings)

**Route path:** `/dashboard/settings/security`
**Access control:** `role:customer`
**Layout:** `(dashboard)` > `SettingsLayout`

**Components:**
```
SecuritySettingsPage
  div.space-y-6
    h2 "Security"
    Card "Change Password"
      CardContent
        ChangePasswordForm
          Input [currentPassword, type="password", autocomplete="current-password"]
          Input [newPassword, type="password", autocomplete="new-password"]
            PasswordStrengthMeter
          Input [confirmPassword, type="password"]
          div.flex.justify-end
            Button [submit] "Update Password"
    Card "Two-Factor Authentication"
      CardContent
        div.flex.justify-between.items-center
          div
            p.font-medium "Authenticator app"
            p.text-sm.text-muted-foreground {mfaEnabled ? "Enabled" : "Not enabled"}
          // If not enabled:
          Button [variant="outline"] "Set up" -> /mfa/setup
          // If enabled:
          AlertDialog
            Button [variant="destructive", variant="outline"] "Disable"
            AlertDialogContent
              p "Enter your password to disable 2FA"
              Input [password, type="password"]
              Button "Disable 2FA" -> POST /api/v1/auth/mfa/disable
    Card "Active Sessions"
      CardContent
        SessionList
          SessionItem [each]
            div.flex.justify-between.items-center
              div
                p.font-medium {deviceName} + Badge [if current] "Current"
                p.text-sm.text-muted-foreground {browser} on {os}
                p.text-xs.text-muted-foreground "Last active {relativeTime} • {ipAddress}"
              Button [variant="ghost", size="sm", if not current] "Revoke"
```

**Data Requirements:**
- `POST /api/v1/auth/reset-password` via `UserService.ResetPassword` (change password -- reuses reset-password with current password verification)
- `POST /api/v1/auth/mfa/disable` via `UserService.DisableMFA`
- Sessions: derived from auth state (session list endpoint TBD)
- TanStack Query keys: `["user", "me"]`, `["sessions"]`

**Form Schema (Zod):**
```typescript
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "At least one uppercase letter")
    .regex(/[0-9]/, "At least one number")
    .regex(/[^A-Za-z0-9]/, "At least one special character"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Submit change password form | Validate, POST, toast "Password updated", clear form |
| Click "Set up" 2FA | Navigate to `/mfa/setup` |
| Click "Disable" 2FA | Dialog with password prompt, POST disable, update toggle |
| Click "Revoke" session | Confirmation, revoke session, remove from list |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton form + session list |
| Default | Password form empty, MFA toggle shows current state, sessions listed |
| Saving password | Button spinner |
| MFA disabling | Dialog button spinner |
| Session revoking | Row fades out |

**Responsive:** All cards full-width. Session list items stack naturally.

**Accessibility:** PasswordStrengthMeter uses `aria-live="polite"`. Session "Current" badge uses `aria-label`. Revoke button has `aria-label="Revoke session on {device}"`. MFA disable dialog traps focus.

**SEO:** Not indexed. Title: "Security Settings | NoMarkup"

---

### 32. `/dashboard/settings/notifications` (Notification Preferences)

**Route path:** `/dashboard/settings/notifications`
**Access control:** `role:customer`
**Layout:** `(dashboard)` > `SettingsLayout`

**Components:**
```
NotificationSettingsPage
  div.space-y-6
    h2 "Notification Preferences"
    p.text-muted-foreground "Choose how you want to be notified about activity."
    Card
      CardContent
        Table
          TableHeader [Notification Type, Email, Push, SMS]
          TableBody
            NotificationRow [label="New bid on your job"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Bid awarded / contract created"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Message received"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Payment processed"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Milestone submitted"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Contract completed"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Review received"]
              Switch [email] Switch [push] Switch [sms]
            NotificationRow [label="Marketing & tips"]
              Switch [email] Switch [push] Switch [sms]
    p.text-sm.text-muted-foreground "Changes are saved automatically."
```

**Data Requirements:**
- `GET /api/v1/notifications/preferences` via `NotificationService.GetPreferences`
- `PATCH /api/v1/notifications/preferences` via `NotificationService.UpdatePreferences` (on each toggle)
- TanStack Query keys: `["notifications", "preferences"]`

**User Interactions:**
| Action | Result |
|---|---|
| Toggle any switch | Optimistic update, PATCH preferences, toast "Preference saved" on success |
| Toggle fails | Revert switch, toast "Failed to update preference" |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton table |
| Default | Switches reflect current preferences |
| Updating | Toggled switch shows subtle loading state (opacity change) |

**Responsive:** Table scrolls horizontally on mobile (< sm). On very small screens, table switches to stacked card layout per notification type.

**Accessibility:** Each Switch has `aria-label="{notificationType} via {channel}"`. Table uses `<th scope="col">` and `<th scope="row">`. Toggle state announced: "Email notifications for new bids: enabled".

**SEO:** Not indexed. Title: "Notification Settings | NoMarkup"

---

### 33. `/dashboard/settings/payment-methods` (Payment Methods)

**Route path:** `/dashboard/settings/payment-methods`
**Access control:** `role:customer`
**Layout:** `(dashboard)` > `SettingsLayout`

**Components:**
```
PaymentMethodsPage
  div.space-y-6
    h2 "Payment Methods"
    Card "Saved Cards"
      CardContent
        PaymentMethodList
          PaymentMethodItem [each]
            div.flex.justify-between.items-center
              div.flex.gap-3
                CardBrandIcon [visa/mastercard/amex]
                div
                  p.font-medium "{brand} ending in {last4}"
                  p.text-sm.text-muted-foreground "Expires {expMonth}/{expYear}"
              div.flex.items-center.gap-2
                Badge [if default] "Default"
                DropdownMenu
                  DropdownMenuTrigger Button [variant="ghost", size="icon"] MoreVertical
                  DropdownMenuContent
                    DropdownMenuItem [if not default] "Set as default"
                    DropdownMenuItem [destructive] "Remove"
        EmptyState [if no cards] "No payment methods saved"
    Card "Add a Card"
      CardContent
        StripeCardForm
          // Stripe Elements: CardNumberElement, CardExpiryElement, CardCvcElement
          // or single CardElement for simplified UI
          div.space-y-4
            label "Card number"
            CardNumberElement
            div.grid.grid-cols-2.gap-4
              div
                label "Expiry"
                CardExpiryElement
              div
                label "CVC"
                CardCvcElement
          div.flex.justify-end.mt-4
            Button [submit] "Add Card"
```

**Data Requirements:**
- `GET /api/v1/payments/methods` via `PaymentService.ListPaymentMethods`
- `POST /api/v1/payments/methods/setup-intent` via `PaymentService.CreateSetupIntent` (returns Stripe client secret)
- `DELETE /api/v1/payments/methods/{paymentMethodId}` via `PaymentService.DeletePaymentMethod`
- Stripe.js `confirmCardSetup` with client secret from setup intent
- TanStack Query keys: `["payments", "methods"]`

**User Interactions:**
| Action | Result |
|---|---|
| Fill card form + click "Add Card" | Create setup intent, confirm with Stripe, card appears in list |
| Click "Set as default" | Update default method, badge moves |
| Click "Remove" | Confirmation dialog, DELETE method, remove from list |
| Stripe validation error | Inline error below card element (from Stripe.js) |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton list + skeleton form |
| Empty | "No payment methods saved", add card form shown |
| Populated | Cards listed, add card form below |
| Adding card | Button spinner, Stripe elements disabled |
| Card added | Toast "Card added", new card appears in list |
| Remove confirming | Dialog: "Remove {brand} ending {last4}?" |

**Responsive:** Card form and list are full-width. Stripe elements auto-size. Card list items stack vertically.

**Accessibility:** Stripe Elements handle their own accessibility (labels, ARIA). Card list uses `role="list"`. Default badge has `aria-label="Default payment method"`. Remove action has confirmation dialog with focus trap. Dropdown menu is keyboard navigable.

**SEO:** Not indexed. Title: "Payment Methods | NoMarkup"
# NoMarkup Page & Component Spec -- (dashboard) Provider + Shared + Admin

**Parent document:** `page-component-spec.md`
**Layout:** `(dashboard)/layout.tsx` -- collapsible Sidebar (desktop) / bottom tab bar (mobile)
**Role detection:** `useAuthStore().roles`

---

## Provider Pages

---

### 34. `/dashboard` (Provider Home)

**Route path:** `/dashboard`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
ProviderDashboardPage
  PageHeader
    h1 "Dashboard"
  div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-4
    StatCard [icon=BriefcaseIcon, label="Available Jobs", value={availableCount}]
    StatCard [icon=GavelIcon, label="Active Bids", value={activeBidCount}]
    StatCard [icon=FileTextIcon, label="Active Contracts", value={activeContractCount}]
    StatCard [icon=DollarSignIcon, label="Earnings (Month)", value={monthEarnings}, format="currency"]
  section "Available Jobs"
    h2 "Nearby Jobs"
    div.grid.grid-cols-1.md:grid-cols-3.gap-4
      JobCard [x3, nearest matching jobs]
    Link [/dashboard/jobs/browse] "Browse all jobs ->"
  section "Upcoming Schedule"
    h2 "Next 7 Days"
    ScheduleList
      ScheduleItem [date, job title, customer name, time] (up to 7)
      EmptyState "No upcoming work scheduled"
  div.flex.gap-2
    Button [asChild] Link [/dashboard/jobs/browse] "Browse Jobs"
```

**Data Requirements:**
- `GET /api/v1/dashboard/provider` or multiple parallel queries:
  - `GET /api/v1/search/jobs?limit=3&sort=distance` via `SearchService.SearchJobs`
  - `GET /api/v1/bids?provider_id=me&status=active` via `BidService.ListBids` (count)
  - `GET /api/v1/contracts?provider_id=me&status=active` via `ContractService.ListContracts` (count)
  - `GET /api/v1/payments/earnings?period=month` via `PaymentService.GetEarnings`
  - `GET /api/v1/contracts?provider_id=me&start_after=now&start_before=+7d` (schedule)
- TanStack Query keys: `["provider", "dashboard"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click stat card | Navigate to corresponding detail page |
| Click a JobCard | Navigate to `/dashboard/jobs/browse` with job selected |
| Click "Browse all jobs" | Navigate to `/dashboard/jobs/browse` |
| Click schedule item | Navigate to `/dashboard/contracts/[id]` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards for stats, skeleton list for jobs and schedule |
| Loaded | Populated stats, job cards, schedule items |
| No available jobs | Jobs section shows EmptyState: "No matching jobs in your area right now" |
| No schedule items | Schedule section shows EmptyState: "No upcoming work scheduled" |

**Responsive:** Stats grid: 1 col mobile, 2 col sm, 4 col lg. Jobs grid: 1 col mobile, 3 col md+. Schedule list is single column at all breakpoints.

**Accessibility:**
- StatCards use `role="status"` with `aria-label` including label and value
- `<h1>` announces page; `<h2>` for each section
- JobCards are keyboard focusable with Enter/Space to activate

**SEO:** Not indexed. Title: "Dashboard | NoMarkup"

---

### 35. `/dashboard/jobs/browse` (Browse Available Jobs)

**Route path:** `/dashboard/jobs/browse`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
BrowseJobsPage
  PageHeader
    h1 "Browse Jobs"
  div.flex.gap-4 [responsive: stack on mobile]
    aside.w-64.shrink-0 [collapsible on mobile via Sheet]
      FilterPanel
        Select [category, from category tree]
        Slider [distance, 5-100mi, default 25, step 5]
        div.flex.gap-2
          Input [budgetMin, type="number", placeholder="Min $"]
          Input [budgetMax, type="number", placeholder="Max $"]
        Select [urgency, options: any/standard/urgent/emergency]
        Select [recurrence, options: any/one-time/recurring]
        Button [variant="ghost"] "Reset filters"
    div.flex-1
      div.flex.gap-2.mb-4
        ToggleGroup [view: "map" | "list" | "split"]
      // Split view (default desktop):
      div.grid.grid-cols-1.lg:grid-cols-2.gap-4
        MapContainer
          MapboxMap [interactive, job pins]
            JobPinPopover [on pin hover/click]
              p.font-semibold {title}
              p {budgetRange}
              p {distance} + p {bidCount} bids
              Button [size="sm"] "View Details"
        div.space-y-3
          JobCard [repeating, infinite scroll]
            div.flex.gap-3
              Avatar [customer, blurred]
              div
                h3 {title}
                Badge {category}
                Badge [variant=urgency] {urgency}
              div.text-right
                p.font-semibold {budgetRange}
                p.text-muted-foreground {distance}
                p.text-sm {timePosted, relative}
          InfiniteScrollTrigger
          // No results:
          EmptyState "No jobs match your filters. Try expanding your search area."
    // Job detail side panel:
    Sheet [side="right", open when job selected]
      JobDetailPanel
        SheetHeader
          h2 {title}
          Badge {category}
        SheetContent
          p {description}
          dl [budget, urgency, recurrence, posted, bid count, distance]
          Button [full-width] "Place Bid" -> opens BidDialog
```

**Data Requirements:**
- `GET /api/v1/search/jobs` via `SearchService.SearchJobs` with query params: `category`, `lat`, `lng`, `radius`, `budget_min`, `budget_max`, `urgency`, `recurrence`, `cursor`, `limit=20`
- `GET /api/v1/categories/tree` via `JobService.GetCategoryTree` for filter Select
- Mapbox GL JS for map rendering with GeoJSON source from job results
- TanStack Query keys: `["jobs", "browse", { filters }]`
- Infinite query with cursor-based pagination

**User Interactions:**
| Action | Result |
|---|---|
| Adjust any filter | Debounced re-fetch (300ms), map pins + list update |
| Click map pin | Popover appears; clicking "View Details" opens side Sheet |
| Click JobCard in list | Opens job detail Sheet on right |
| Click "Place Bid" in Sheet | Opens BidDialog (see bid detail below) |
| Toggle view mode | Switch between map-only, list-only, split |
| Scroll to bottom of list | Next page loaded via infinite scroll |
| Click "Reset filters" | All filters return to defaults, re-fetch |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards in list, map shows loading overlay |
| Loaded | Pins on map, cards in list |
| Empty results | EmptyState with suggestion to expand search area |
| Filter active | Active filter count badge on mobile filter trigger button |
| Job selected | Right Sheet slides in with job detail |

**Responsive:** Mobile: filters in collapsible Sheet (trigger button with filter count badge), list-only view default, map view via toggle. Tablet: split view with smaller map. Desktop: split view 50/50 with sidebar filters visible.

**Accessibility:**
- Map is `aria-hidden="true"` with equivalent data in the list view
- Filter controls have associated labels
- JobCards are `role="article"` with keyboard activation
- Sheet has `aria-label="Job details"` and traps focus when open
- Infinite scroll has `aria-live="polite"` region announcing new results count

**SEO:** Not indexed. Title: "Browse Jobs | NoMarkup"

---

### 36. `/dashboard/bids` (My Bids)

**Route path:** `/dashboard/bids`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
MyBidsPage
  PageHeader
    h1 "My Bids"
  Tabs [defaultValue="active"]
    TabsList
      TabsTrigger [value="active"] "Active" + Badge {activeCount}
      TabsTrigger [value="won"] "Won" + Badge {wonCount}
      TabsTrigger [value="lost"] "Lost"
      TabsTrigger [value="withdrawn"] "Withdrawn"
    TabsContent [value="active"]
      BidCardList
        BidCard [repeating]
          div.flex.justify-between
            div
              h3 {jobTitle}
              p.text-muted-foreground "Submitted {date, relative}"
            div.text-right
              p.font-semibold.text-lg {bidAmount, currency}
              Badge [variant by status] {status}
          Button [variant="ghost", size="sm"] "View Details" -> /dashboard/bids/[id]
        EmptyState [icon=GavelIcon] "No active bids. Browse jobs to start bidding."
    TabsContent [value="won"]
      BidCardList
        BidCard [variant="success"]
        EmptyState "No won bids yet."
    TabsContent [value="lost"]
      BidCardList
        BidCard [variant="muted"]
        EmptyState "No lost bids."
    TabsContent [value="withdrawn"]
      BidCardList
        BidCard [variant="muted"]
        EmptyState "No withdrawn bids."
```

**Data Requirements:**
- `GET /api/v1/bids?provider_id=me&status={tab}` via `BidService.ListBids`
- TanStack Query keys: `["bids", "list", { status }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Switches to filtered bid list; lazy-loads if first visit |
| Click "View Details" on BidCard | Navigate to `/dashboard/bids/[id]` |
| Click BidCard row | Navigate to `/dashboard/bids/[id]` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton BidCards (3) |
| Loaded | BidCard list with status badges |
| Empty tab | EmptyState with contextual message per tab |

**Responsive:** Single column list at all breakpoints. Badge counts in TabsTrigger hidden on mobile (< sm) to save space.

**Accessibility:**
- Tabs use `role="tablist"` / `role="tab"` / `role="tabpanel"` (shadcn/ui default)
- Tab switch announces panel content change via `aria-live`
- BidCards are keyboard navigable; Enter activates

**SEO:** Not indexed. Title: "My Bids | NoMarkup"

---

### 37. `/dashboard/bids/[id]` (Bid Detail)

**Route path:** `/dashboard/bids/[id]`
**Access control:** Authenticated, role: provider (must be bid owner)
**Layout:** Dashboard sidebar

**Components:**
```
BidDetailPage
  PageHeader
    Breadcrumb ["My Bids", "Bid Detail"]
    h1 "Bid for {jobTitle}"
  div.grid.grid-cols-1.lg:grid-cols-3.gap-6
    div.lg:col-span-2
      Card "Bid Information"
        CardContent
          dl.grid.grid-cols-2.gap-4
            dt "Amount" dd {bidAmount, currency}
            dt "Status" dd Badge {status}
            dt "Submitted" dd {submittedDate, formatted}
            dt "Message" dd p {bidMessage}
      Card "Bid History"
        CardContent
          Timeline
            TimelineItem [repeating: created, edited, status changes]
              p {event description}
              p.text-muted-foreground {timestamp}
    aside.lg:col-span-1
      Card "Job Summary"
        CardContent
          h3 {jobTitle}
          Badge {category}
          dl
            dt "Budget" dd {budgetRange}
            dt "Urgency" dd Badge {urgency}
            dt "Customer" dd Avatar [blurred for sealed bids] // no name shown
            dt "Bid Count" dd {bidCount}
          Button [variant="outline", full-width] "View Job" -> opens job detail
      // Actions (conditional on status):
      Card "Actions" [visible if status=active and bidding open]
        CardContent
          Button [full-width] "Edit Bid" -> opens EditBidDialog
          Button [variant="destructive", full-width] "Withdraw Bid"
```

**Data Requirements:**
- `GET /api/v1/bids/{id}` via `BidService.GetBid` (includes job summary, bid history)
- `PATCH /api/v1/bids/{id}` via `BidService.UpdateBid` for edits
- `POST /api/v1/bids/{id}/withdraw` via `BidService.WithdrawBid`
- TanStack Query keys: `["bids", id]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Edit Bid" | Opens EditBidDialog with pre-filled amount and message |
| Submit edited bid | Toast: "Bid updated", data refetched, history updated |
| Click "Withdraw Bid" | Confirmation AlertDialog: "Are you sure? This cannot be undone." |
| Confirm withdrawal | Bid withdrawn, status badge updates, actions card hidden |
| Click "View Job" | Opens job detail Sheet or navigates to browse with job selected |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton layout for cards |
| Active bid | Actions card visible with Edit + Withdraw buttons |
| Won bid | Success banner at top: "You won this bid!" with link to contract |
| Lost bid | Muted styling, no actions |
| Withdrawn bid | Muted styling, no actions, "Withdrawn" badge |

**Responsive:** Single column on mobile (job summary card moves above bid info), 3-col grid on lg+.

**Accessibility:**
- Breadcrumb uses `nav[aria-label="Breadcrumb"]`
- `dl` pairs use proper `dt`/`dd` structure
- AlertDialog traps focus and requires explicit confirm/cancel
- Timeline uses `ol` with `role="list"`

**SEO:** Not indexed. Title: "Bid Detail | NoMarkup"

---

### 38. `/dashboard/contracts` (Provider Contracts)

**Route path:** `/dashboard/contracts`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
ProviderContractsPage
  PageHeader
    h1 "My Contracts"
  Tabs [defaultValue="active"]
    TabsList
      TabsTrigger [value="active"] "Active"
      TabsTrigger [value="completed"] "Completed"
      TabsTrigger [value="disputed"] "Disputed"
    TabsContent [value="active"|"completed"|"disputed"]
      div.space-y-3
        ContractCard [repeating]
          div.flex.justify-between.items-start
            div
              h3 {jobTitle}
              p {customerName}
              p.text-muted-foreground "Started {startDate, relative}"
            div.text-right
              p.font-semibold {agreedAmount, currency}
              Badge [variant by status] {status}
        EmptyState "No {tab} contracts."
```

**Data Requirements:**
- `GET /api/v1/contracts?provider_id=me&status={tab}` via `ContractService.ListContracts`
- TanStack Query keys: `["contracts", "list", { status, role: "provider" }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Switches contract list filter |
| Click ContractCard | Navigate to `/dashboard/contracts/[id]` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton ContractCards (3) |
| Loaded | ContractCard list |
| Empty | EmptyState per tab |

**Responsive:** Single column list. ContractCard layout stacks on mobile (amount moves below title).

**Accessibility:** Same tab and keyboard patterns as My Bids page.

**SEO:** Not indexed. Title: "My Contracts | NoMarkup"

---

### 39. `/dashboard/contracts/[id]` (Provider Contract Detail)

**Route path:** `/dashboard/contracts/[id]`
**Access control:** Authenticated, role: provider (must be contract party)
**Layout:** Dashboard sidebar

**Components:**
```
ProviderContractDetailPage
  PageHeader
    Breadcrumb ["My Contracts", {jobTitle}]
    h1 {jobTitle}
    Badge {status}
  div.grid.grid-cols-1.lg:grid-cols-3.gap-6
    div.lg:col-span-2
      Card "Contract Details"
        CardContent
          dl.grid.grid-cols-2.gap-4
            dt "Agreed Amount" dd {amount, currency}
            dt "Customer" dd div: Avatar + {customerName}
            dt "Start Date" dd {startDate}
            dt "Status" dd Badge {status}
      Card "Milestones"
        CardContent
          MilestoneList
            MilestoneItem [repeating]
              div.flex.items-center.gap-3
                Checkbox [checked={completed}, disabled={not next}]
                div
                  p.font-medium {milestoneTitle}
                  p.text-sm.text-muted-foreground {description}
                Badge {status: pending/in-progress/complete}
              Button [size="sm", visible if milestone is next and in-progress]
                "Mark Complete"
      Card "Activity"
        CardContent
          Timeline [contract events: created, milestones, messages, uploads]
    aside.lg:col-span-1
      Card "Actions"
        CardContent.space-y-2
          Button [full-width] "Upload Evidence" -> opens upload dialog
          Button [full-width] "Mark Job Complete" -> /dashboard/contracts/[id]/complete
          Button [variant="outline", full-width] "Message Customer" -> opens chat
          Button [variant="destructive-outline", full-width] "Open Dispute"
      Card "Attached Files"
        CardContent
          FileList [completion photos, evidence uploads]
```

**Data Requirements:**
- `GET /api/v1/contracts/{id}` via `ContractService.GetContract`
- `PATCH /api/v1/contracts/{id}/milestones/{mid}` via `ContractService.UpdateMilestone`
- `POST /api/v1/contracts/{id}/evidence` via `ContractService.UploadEvidence`
- TanStack Query keys: `["contracts", id]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Mark Complete" on milestone | Confirms via dialog, milestone status updates |
| Click "Upload Evidence" | Opens file upload dialog (images/PDFs, max 10 files, 10MB each) |
| Click "Mark Job Complete" | Navigate to `/dashboard/contracts/[id]/complete` |
| Click "Message Customer" | Opens messaging Sheet or navigates to messages |
| Click "Open Dispute" | Confirmation dialog, then navigate to dispute creation |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards |
| Active | All action buttons visible, milestones interactive |
| Completed | Actions card hidden, milestones all checked, success banner |
| Disputed | Warning banner, dispute link visible, limited actions |

**Responsive:** Single column on mobile, 3-col on lg+. Milestone checkboxes are touch-friendly (44px tap targets).

**Accessibility:**
- Milestones use `role="list"` with checkbox controls
- File upload dialog announces accepted formats and size limits
- Timeline uses semantic `ol` structure

**SEO:** Not indexed. Title: "{jobTitle} Contract | NoMarkup"

---

### 40. `/dashboard/contracts/[id]/complete` (Job Completion Form)

**Route path:** `/dashboard/contracts/[id]/complete`
**Access control:** Authenticated, role: provider (must be contract provider, contract must be active)
**Layout:** Dashboard sidebar

**Components:**
```
JobCompletionPage
  PageHeader
    Breadcrumb ["My Contracts", {jobTitle}, "Complete"]
    h1 "Complete Job"
    p.text-muted-foreground "Submit your completion report for {jobTitle}"
  Card
    CardContent
      CompletionForm
        div.space-y-6
          div
            Label "Summary of Work"
            Textarea [workSummary, rows=5, maxLength=2000]
            p.text-sm.text-muted-foreground "{charCount}/2000"
          div
            Label "Completion Photos (required)"
            p.text-sm.text-muted-foreground "Upload up to 10 photos showing the completed work"
            ImageUploadGrid
              UploadThumbnail [repeating, up to 10]
                img [preview]
                Button [icon=X, remove]
              UploadDropzone [visible if < 10 photos]
                icon CameraIcon
                p "Drop photos or click to upload"
                p.text-sm "JPG, PNG up to 10MB each"
          div
            Label "Notes for Customer (optional)"
            Textarea [customerNotes, rows=3, maxLength=500]
          AlertDialog
            AlertDialogTrigger
              Button [full-width, size="lg"] "Submit Completion Report"
            AlertDialogContent
              AlertDialogTitle "Confirm Job Completion"
              AlertDialogDescription "This will notify the customer that the job is complete. They will review your work and release payment. This action cannot be undone."
              AlertDialogFooter
                AlertDialogCancel "Go Back"
                AlertDialogAction "Confirm & Submit"
```

**Data Requirements:**
- `GET /api/v1/contracts/{id}` via `ContractService.GetContract` (to display job title, validate state)
- `POST /api/v1/images/upload` via `ImagingService.UploadImages` for each photo
- `POST /api/v1/contracts/{id}/complete` via `ContractService.CompleteContract` with `{ summary, photoUrls, notes }`
- TanStack Query keys: `["contracts", id]`

**Form Schema:**
```typescript
const completionSchema = z.object({
  workSummary: z.string().min(20, "Provide at least 20 characters").max(2000),
  photos: z.array(z.string().url()).min(1, "At least one photo is required").max(10),
  customerNotes: z.string().max(500).optional(),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Drop or select photos | Preview thumbnails appear, upload starts immediately |
| Remove a photo | Thumbnail removed, upload cancelled if in progress |
| Click "Submit Completion Report" | Confirmation AlertDialog opens |
| Confirm submission | Form submits, redirect to contract detail with success toast |
| Cancel in dialog | Dialog closes, form preserved |

**States:**
| State | Appearance |
|---|---|
| Default | Empty form, submit button disabled until photo added |
| Uploading photos | Progress bar on each thumbnail |
| Photos uploaded | Thumbnails with checkmark overlay |
| Submitting | Button spinner in confirmation dialog, all inputs disabled |
| Success | Redirect to `/dashboard/contracts/[id]` with toast: "Completion report submitted" |

**Responsive:** Single column. ImageUploadGrid: 2 cols mobile, 3 cols sm, 5 cols md+.

**Accessibility:**
- Textarea has character count announced via `aria-live="polite"` on change
- UploadDropzone is keyboard activatable and accepts drag-and-drop
- Confirmation dialog traps focus
- Photo thumbnails have `alt` text: "Completion photo {n}"

**SEO:** Not indexed. Title: "Complete Job | NoMarkup"

---

### 41. `/dashboard/earnings` (Earnings Dashboard)

**Route path:** `/dashboard/earnings`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
EarningsPage
  PageHeader
    h1 "Earnings"
  div.grid.grid-cols-1.sm:grid-cols-3.gap-4
    StatCard [label="All Time", value={totalEarned}, format="currency"]
    StatCard [label="This Month", value={monthEarned}, format="currency"]
    StatCard [label="This Week", value={weekEarned}, format="currency"]
  Card "Earnings Over Time"
    CardContent
      EarningsChart [Recharts LineChart, last 12 months]
        XAxis [month labels]
        YAxis [currency format]
        Line [earnings amount]
        Tooltip [month + formatted amount]
  Card "Pending Payouts"
    CardContent
      div.space-y-2
        PendingPayoutItem [repeating]
          div.flex.justify-between
            p {description}
            p.font-semibold {amount, currency}
        EmptyState "No pending payouts"
  Card "Payout History"
    CardContent
      Table
        TableHeader
          TableRow
            TableHead "Date"
            TableHead "Amount"
            TableHead "Status"
            TableHead "Stripe Payout ID"
        TableBody
          TableRow [repeating]
            TableCell {date}
            TableCell {amount, currency}
            TableCell Badge {status: paid/pending/failed}
            TableCell code.text-xs {stripePayoutId}
      // Pagination at bottom
      PaginationControls
```

**Data Requirements:**
- `GET /api/v1/payments/earnings` via `PaymentService.GetEarnings` -- returns stats, chart data, pending, history
- TanStack Query keys: `["earnings"]`

**User Interactions:**
| Action | Result |
|---|---|
| Hover chart point | Tooltip shows month + amount |
| Click payout row | Copies Stripe payout ID to clipboard, toast confirms |
| Paginate history | Next/prev page of payout history |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton stat cards, skeleton chart area, skeleton table rows |
| Loaded | Populated stats, chart, and table |
| No earnings | All stats show $0.00, chart is flat, empty table with message |
| Payout failed | Failed row highlighted with red text, retry link if applicable |

**Responsive:** Stat cards: 1 col mobile, 3 col sm+. Chart and table are full width. Table scrolls horizontally on mobile with sticky first column.

**Accessibility:**
- Chart has `aria-label` with summary: "Earnings chart showing last 12 months"
- Table uses proper `<thead>`, `<tbody>`, `<th scope="col">` structure
- StatCards use `role="status"`
- Pagination uses `nav[aria-label="Payout history pagination"]`

**SEO:** Not indexed. Title: "Earnings | NoMarkup"

---

### 42. `/dashboard/portfolio` (Portfolio Gallery)

**Route path:** `/dashboard/portfolio`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
PortfolioPage
  PageHeader
    h1 "Portfolio"
    Button [asChild] Link [/dashboard/portfolio/new] icon PlusIcon "Add Project"
  // Gallery grid with drag-and-drop reorder:
  DndContext [onDragEnd -> reorder]
    SortableContext [items=portfolioItems]
      div.grid.grid-cols-2.sm:grid-cols-3.lg:grid-cols-4.gap-4
        SortablePortfolioCard [repeating, draggable]
          div.relative.aspect-square.overflow-hidden.rounded-lg
            img [thumbnail, object-cover]
            div.absolute.bottom-0.inset-x-0.bg-gradient-to-t.p-3
              h3.text-white.font-medium.text-sm {title}
              Badge.text-xs {category}
          GripVertical [drag handle, top-right]
          DropdownMenu [top-right, over grip when not dragging]
            DropdownMenuItem "Edit" -> /dashboard/portfolio/[id]/edit
            DropdownMenuItem "Delete" -> confirmation dialog
        // Empty state:
        EmptyState [icon=ImageIcon, colSpan=full]
          p "Showcase your work to attract customers"
          Button "Add your first project"
```

**Data Requirements:**
- `GET /api/v1/users/me/portfolio` via `UserService.GetPortfolio`
- `PATCH /api/v1/users/me/portfolio/reorder` via `UserService.ReorderPortfolio` with `{ orderedIds }`
- `DELETE /api/v1/users/me/portfolio/{id}` via `UserService.DeletePortfolioItem`
- TanStack Query keys: `["portfolio"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Add Project" | Navigate to `/dashboard/portfolio/new` |
| Drag and drop card | Reorders gallery, auto-saves new order |
| Click card thumbnail | Opens lightbox / navigate to edit |
| Click "Edit" in dropdown | Navigate to edit form |
| Click "Delete" in dropdown | Confirmation dialog; on confirm, item removed with toast |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton grid of aspect-square cards |
| Loaded | Thumbnail grid with drag handles |
| Empty | Full-width EmptyState with CTA |
| Dragging | Dragged card has elevated shadow, drop target has dashed border |
| Reordering | Brief opacity pulse on reordered items |

**Responsive:** Grid: 2 col mobile, 3 col sm, 4 col lg. Drag-and-drop works on desktop; on mobile, long-press activates drag or use up/down reorder buttons as fallback.

**Accessibility:**
- Drag-and-drop announced via `aria-live`: "Moved {title} from position {n} to position {m}"
- Grid items use `role="listitem"` within `role="list"`
- Keyboard reorder: focus handle, Space to grab, Arrow keys to move, Space to drop
- Images have descriptive `alt` text from portfolio title

**SEO:** Not indexed. Title: "Portfolio | NoMarkup"

---

### 43. `/dashboard/portfolio/new` (Add Portfolio Project)

**Route path:** `/dashboard/portfolio/new`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

Also used for editing at `/dashboard/portfolio/[id]/edit` with pre-filled data.

**Components:**
```
PortfolioFormPage
  PageHeader
    Breadcrumb ["Portfolio", "Add Project" | "Edit Project"]
    h1 "Add Project" | "Edit Project"
  Card
    CardContent
      PortfolioForm
        div.space-y-6
          div
            Label "Photos (up to 20)"
            ImageUploadGrid [max=20]
              UploadThumbnail [repeating]
                img [preview]
                Toggle [beforeAfter] "B" / "A"  // before/after toggle per image
                Button [icon=X, remove]
              UploadDropzone
          Input [title, maxLength=100]
          Textarea [description, rows=4, maxLength=500]
          Select [category, from category tree]
          div.flex.gap-2
            Button [variant="outline"] "Cancel" -> navigate back
            Button [submit] "Save Project"
```

**Data Requirements:**
- `GET /api/v1/categories/tree` via `JobService.GetCategoryTree`
- `POST /api/v1/users/me/portfolio` via `UserService.CreatePortfolioItem` (new)
- `PUT /api/v1/users/me/portfolio/{id}` via `UserService.UpdatePortfolioItem` (edit)
- `POST /api/v1/images/upload` via `ImagingService.UploadImages`
- TanStack Query keys: `["portfolio", id?]`, `["categories", "tree"]`

**Form Schema:**
```typescript
const portfolioSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
  category: z.string().min(1, "Select a category"),
  photos: z.array(z.object({
    url: z.string().url(),
    isBeforeAfter: z.boolean().default(false),
    label: z.enum(["before", "after"]).optional(),
  })).min(1, "At least one photo is required").max(20),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Upload photos | Thumbnails appear with before/after toggle |
| Toggle B/A on photo | Marks photo as before or after shot |
| Submit form | Project saved, navigate to `/dashboard/portfolio` with toast |
| Click "Cancel" | Navigate back to portfolio (confirm if unsaved changes) |

**States:**
| State | Appearance |
|---|---|
| New (empty) | Empty form |
| Edit (pre-filled) | Form populated from existing portfolio item |
| Uploading | Progress bars on photo thumbnails |
| Submitting | Button spinner, inputs disabled |
| Validation error | Red borders on invalid fields with messages |

**Responsive:** Single column. Photo grid: 3 cols mobile, 4 cols sm, 5 cols md+.

**Accessibility:**
- Before/after toggle uses `aria-label="Mark as before photo"` / `aria-label="Mark as after photo"`
- Unsaved changes warning uses `beforeunload` event
- All form fields have associated labels

**SEO:** Not indexed. Title: "Add Project | NoMarkup" or "Edit Project | NoMarkup"

---

### 44. `/dashboard/reviews` (Provider Reviews)

**Route path:** `/dashboard/reviews`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
ProviderReviewsPage
  PageHeader
    h1 "Reviews"
  div.grid.grid-cols-1.md:grid-cols-3.gap-6
    Card.md:col-span-1 "Rating Overview"
      CardContent
        div.flex.flex-col.items-center
          p.text-5xl.font-bold {averageRating}
          StarRating [value={averageRating}, readOnly, size="lg"]
          p.text-muted-foreground "{totalReviews} reviews"
        RatingDistribution
          // 5 bars showing count per star level:
          RatingBar [star=5, count, percentage, filled-width]
          RatingBar [star=4, count, percentage, filled-width]
          RatingBar [star=3, count, percentage, filled-width]
          RatingBar [star=2, count, percentage, filled-width]
          RatingBar [star=1, count, percentage, filled-width]
    div.md:col-span-2.space-y-4
      ReviewCard [repeating]
        div.flex.gap-3
          Avatar [customer]
          div.flex-1
            div.flex.justify-between
              p.font-medium {customerName}
              p.text-sm.text-muted-foreground {date, relative}
            StarRating [value={rating}, readOnly, size="sm"]
            p {reviewText}
            // Response section:
            Collapsible
              CollapsibleTrigger
                Button [variant="ghost", size="sm"]
                  {hasResponse ? "View your response" : "Respond"}
              CollapsibleContent
                // If already responded:
                div.bg-muted.rounded.p-3.mt-2
                  p.text-sm.font-medium "Your response"
                  p {responseText}
                // If not responded:
                div.mt-2
                  Textarea [response, rows=3, maxLength=500]
                  div.flex.justify-end.gap-2.mt-2
                    Button [variant="ghost", size="sm"] "Cancel"
                    Button [size="sm"] "Submit Response"
      EmptyState "No reviews yet. Complete jobs to receive reviews."
```

**Data Requirements:**
- `GET /api/v1/reviews?provider_id=me` via `ReviewService.ListReviews` -- includes average, distribution, paginated reviews
- `POST /api/v1/reviews/{id}/response` via `ReviewService.RespondToReview`
- TanStack Query keys: `["reviews", "provider"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Respond" | Expands inline Textarea |
| Submit response | Response saved, collapsible shows response text, toast confirms |
| Click "Cancel" on response | Collapses Textarea, clears draft |
| Click "View your response" | Expands to show existing response |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton for rating overview + skeleton ReviewCards |
| Loaded | Rating summary + review list |
| Empty | EmptyState with encouragement message |
| Responding | Textarea expanded below review, submit button active |
| Response submitted | Textarea replaced with formatted response text |

**Responsive:** Rating overview: full width on mobile (above reviews), 1/3 width on md+ (sticky sidebar). Review list fills remaining space.

**Accessibility:**
- StarRating uses `aria-label="{n} out of 5 stars"`
- RatingDistribution bars use `role="meter"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Collapsible uses `aria-expanded` on trigger
- Response Textarea has `aria-label="Your response to {customerName}'s review"`

**SEO:** Not indexed. Title: "Reviews | NoMarkup"

---

### 45. `/dashboard/subscription` (Provider Subscription)

**Route path:** `/dashboard/subscription`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
SubscriptionPage
  PageHeader
    h1 "Subscription"
  Card "Current Plan"
    CardContent
      div.flex.justify-between.items-center
        div
          h2 {tierName}
          p.text-muted-foreground {tierDescription}
          ul.mt-2.space-y-1
            li [repeating] icon CheckIcon + {feature}
        div.text-right
          p.text-3xl.font-bold {price}/mo
          p.text-sm.text-muted-foreground "Renews {renewalDate}"
      div.flex.gap-2.mt-4
        Button "Upgrade Plan" [visible if not on highest tier]
        Button [variant="outline"] "Change Plan"
  // Plan comparison (if on free tier or considering change):
  Card "Compare Plans" [collapsible, open if free tier]
    CardContent
      PlanComparisonTable
        Table
          TableHeader
            TableHead ""
            TableHead "Free"
            TableHead "Pro" [highlighted if recommended]
            TableHead "Business"
          TableBody
            TableRow [repeating per feature]
              TableCell {featureName}
              TableCell {free value or icon}
              TableCell {pro value or icon}
              TableCell {business value or icon}
          TableFooter
            TableRow
              TableCell ""
              TableCell Button [variant="outline"] "Current" | "Select"
              TableCell Button "Select"
              TableCell Button "Select"
  Card "Billing History"
    CardContent
      Table
        TableHeader
          TableRow
            TableHead "Date"
            TableHead "Description"
            TableHead "Amount"
            TableHead "Status"
            TableHead "Invoice"
        TableBody
          TableRow [repeating]
            TableCell {date}
            TableCell {description}
            TableCell {amount, currency}
            TableCell Badge {status}
            TableCell Button [variant="ghost", size="sm", icon=DownloadIcon] "PDF"
  // Cancel section:
  div.mt-8
    Button [variant="destructive-outline"] "Cancel Subscription"
```

**Data Requirements:**
- `GET /api/v1/subscriptions/me` via `SubscriptionService.GetSubscription` -- includes plan info, features, billing history
- `POST /api/v1/subscriptions/change` via `SubscriptionService.ChangePlan`
- `POST /api/v1/subscriptions/cancel` via `SubscriptionService.CancelSubscription`
- TanStack Query keys: `["subscription"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Upgrade Plan" or "Select" on a plan | Confirmation dialog with price change details, then Stripe checkout/update |
| Click "Cancel Subscription" | Multi-step AlertDialog: reason select, confirmation text, final confirm |
| Click invoice PDF | Downloads invoice PDF |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards |
| Free tier | Plan card shows free features, comparison table open by default |
| Paid tier | Plan card shows tier info + renewal date, comparison collapsed |
| Cancellation pending | Banner: "Your plan will be cancelled on {date}. You can reactivate anytime." + Button "Reactivate" |
| Processing change | Spinner on selected plan button |

**Responsive:** Single column. Comparison table scrolls horizontally on mobile with sticky feature column.

**Accessibility:**
- Comparison table uses `scope="col"` and `scope="row"` for headers
- Current plan has `aria-current="true"`
- Cancel flow uses multi-step AlertDialog with clear labels
- Invoice download buttons have `aria-label="Download invoice for {date}"`

**SEO:** Not indexed. Title: "Subscription | NoMarkup"

---

### 46. `/dashboard/settings/business` (Business Profile)

**Route path:** `/dashboard/settings/business`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
BusinessSettingsPage
  PageHeader
    h1 "Business Profile"
  div.space-y-6
    Card "Business Information"
      CardContent
        BusinessInfoForm
          Input [businessName]
          Textarea [description, rows=4, maxLength=500]
          Input [licenseNumber, optional]
          Input [additionalLicense, optional] + Button [icon=PlusIcon] "Add License"
          Button [submit] "Save Changes"
    Card "Service Area"
      CardContent
        ServiceAreaEditor
          MapboxMap [interactive, centered on provider address]
            DraggableCircle [radius overlay, adjustable]
          div.flex.items-center.gap-4.mt-4
            Slider [radius, 5-100mi]
            p "{radius} miles"
          Button [variant="outline"] "Add Another Area"
          // Multiple areas listed:
          ServiceAreaList
            ServiceAreaItem [repeating]
              p {areaName} -- {radius}mi
              Button [icon=Trash2, variant="ghost"] remove
          Button [submit] "Save Service Area"
    Card "Availability"
      CardContent
        AvailabilityCalendar
          div.grid.grid-cols-8.gap-2 [header: blank + Mon-Sun]
            // Row per time slot (morning, afternoon, evening) or custom:
            TimeSlotRow [repeating]
              p {slotLabel}
              Checkbox [mon] Checkbox [tue] ... Checkbox [sun]
          // Or detailed view:
          WeeklyScheduleGrid
            DayColumn [repeating, Mon-Sun]
              h3 {dayName}
              Checkbox [available]
              TimeRangePicker [start, end] (visible if available checked)
          Button [submit] "Save Availability"
```

**Data Requirements:**
- `GET /api/v1/users/me/provider-profile` via `UserService.GetProviderProfile`
- `PATCH /api/v1/users/me/provider-profile` via `UserService.UpdateProviderProfile`
- Mapbox GL JS for service area map with circle overlay
- TanStack Query keys: `["provider-profile"]`

**Form Schema:**
```typescript
const businessProfileSchema = z.object({
  businessName: z.string().min(1, "Business name is required").max(100),
  description: z.string().max(500).optional(),
  licenses: z.array(z.string().max(50)).max(5),
  serviceAreas: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    radiusMiles: z.number().min(5).max(100),
    label: z.string().optional(),
  })).min(1, "At least one service area is required"),
  availability: z.object({
    schedule: z.array(z.object({
      day: z.enum(["mon","tue","wed","thu","fri","sat","sun"]),
      available: z.boolean(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    })),
  }),
});
```

**User Interactions:**
| Action | Result |
|---|---|
| Drag circle on map | Radius updates in real-time, slider syncs |
| Adjust radius slider | Circle on map resizes |
| Add another area | New circle + entry in ServiceAreaList |
| Remove area | Circle removed from map, entry removed from list |
| Toggle day availability | TimeRangePicker shows/hides for that day |
| Save any section | PATCH request, toast: "Settings saved" |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton form fields, map loading state |
| Loaded | Pre-filled form, map with service area circles |
| Unsaved changes | "Unsaved changes" indicator near save button |
| Saving | Button spinner on active section's save button |
| Saved | Brief green check animation, toast |

**Responsive:** Single column. Map is full-width, 300px height mobile, 400px sm+. Availability grid scrolls horizontally on mobile.

**Accessibility:**
- Map interactions have keyboard alternatives (slider for radius)
- Availability checkboxes have `aria-label="{day} availability"`
- TimeRangePicker fields have `aria-label="Start time for {day}"` etc.
- Form sections are `<fieldset>` with `<legend>`

**SEO:** Not indexed. Title: "Business Profile | NoMarkup"

---

### 47. `/dashboard/settings/stripe` (Stripe Connect)

**Route path:** `/dashboard/settings/stripe`
**Access control:** Authenticated, role: provider
**Layout:** Dashboard sidebar

**Components:**
```
StripeSettingsPage
  PageHeader
    h1 "Payment Settings"
  Card "Stripe Connect"
    CardContent
      // Not connected state:
      div.flex.flex-col.items-center.text-center.py-8 [if !connected]
        icon CreditCardIcon (large, muted)
        h2 "Connect your Stripe account"
        p.text-muted-foreground "Link your Stripe account to receive payments for completed jobs"
        Button [size="lg"] icon StripeIcon "Connect with Stripe"
      // Connected state:
      div [if connected]
        div.flex.items-center.gap-3
          div.h-3.w-3.rounded-full.bg-green-500 // green dot
          p.font-medium "Stripe account connected"
        dl.mt-4.grid.grid-cols-2.gap-4
          dt "Account" dd {stripeAccountName}
          dt "Status" dd Badge "Active"
          dt "Connected" dd {connectedDate}
        div.flex.gap-2.mt-6
          Button [variant="outline"] icon ExternalLinkIcon "Open Stripe Dashboard"
          Button [variant="destructive-outline"] "Disconnect"
  // Disconnect confirmation:
  AlertDialog [on disconnect click]
    AlertDialogTitle "Disconnect Stripe Account"
    AlertDialogDescription "You will no longer be able to receive payments for completed jobs. Any pending payouts will still be processed. You can reconnect at any time."
    AlertDialogCancel "Keep Connected"
    AlertDialogAction [variant="destructive"] "Disconnect"
```

**Data Requirements:**
- `GET /api/v1/payments/stripe-status` via `PaymentService.GetStripeStatus`
- `POST /api/v1/payments/stripe-connect` via `PaymentService.CreateStripeConnect` -- returns Stripe Connect onboarding URL
- `POST /api/v1/payments/stripe-disconnect` via `PaymentService.DisconnectStripe`
- TanStack Query keys: `["stripe-status"]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Connect with Stripe" | Redirect to Stripe Connect onboarding; return to this page via callback |
| Click "Open Stripe Dashboard" | Opens Stripe dashboard in new tab |
| Click "Disconnect" | AlertDialog opens |
| Confirm disconnect | Stripe disconnected, page shows not-connected state, toast: "Stripe disconnected" |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton card |
| Not connected | CTA card with connect button |
| Connected | Green status dot, account info, dashboard link |
| Connecting (redirect) | Button shows spinner before redirect |
| Disconnecting | Spinner in AlertDialog action button |

**Responsive:** Single column. CTA card content is centered at all breakpoints.

**Accessibility:**
- Connection status announced: `role="status"` with `aria-label="Stripe: Connected"` or `"Stripe: Not connected"`
- "Open Stripe Dashboard" has `aria-label` and `target="_blank"` with `rel="noopener noreferrer"`
- Disconnect AlertDialog traps focus and requires explicit action

**SEO:** Not indexed. Title: "Payment Settings | NoMarkup"

---

## Shared Dashboard Pages

These pages are available to both customer and provider roles.

---

### 48. `/dashboard/notifications`

**Route path:** `/dashboard/notifications`
**Access control:** Authenticated (any role)
**Layout:** Dashboard sidebar

**Components:**
```
NotificationsPage
  PageHeader
    h1 "Notifications"
    div.flex.gap-2
      Select [typeFilter, options: all/bids/contracts/payments/system]
      Button [variant="ghost"] "Mark all as read"
  div.space-y-1
    NotificationItem [repeating]
      div.flex.gap-3.p-3.rounded-lg [class: bg-muted/50 if unread]
        div.shrink-0
          NotificationIcon [type-based: Bell/Gavel/FileText/DollarSign/AlertTriangle]
        div.flex-1.min-w-0
          p [class: font-medium if unread] {message}
          p.text-sm.text-muted-foreground {timestamp, relative}
        div.shrink-0
          div.h-2.w-2.rounded-full.bg-primary [visible if unread]
    EmptyState [icon=BellOffIcon] "No notifications"
    // Pagination:
    Button [variant="ghost", full-width] "Load more"
```

**Data Requirements:**
- `GET /api/v1/notifications?type={filter}&cursor={cursor}&limit=20` via `NotificationService.ListNotifications`
- `PATCH /api/v1/notifications/{id}/read` via `NotificationService.MarkRead`
- `PATCH /api/v1/notifications/read-all` via `NotificationService.MarkAllRead`
- WebSocket: `ws/notifications` pushes new notifications in real-time; prepended to list
- TanStack Query keys: `["notifications", { type }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click notification | Mark as read, navigate to relevant page (job, bid, contract, etc.) |
| Click "Mark all as read" | All notifications marked read, blue dots disappear |
| Change type filter | List filters to selected type |
| Click "Load more" | Next page of notifications appended |
| New notification arrives (WS) | Prepended to top of list with brief highlight animation |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton NotificationItems (5) |
| Loaded | Notification list with read/unread styling |
| Empty | EmptyState: "You're all caught up!" |
| New notification | Item slides in from top with subtle bg pulse |

**Responsive:** Single column, full width at all breakpoints. NotificationIcon hidden on mobile (< sm) to save horizontal space.

**Accessibility:**
- Notification list uses `role="feed"` with `aria-live="polite"` for real-time additions
- Unread indicators: blue dot is decorative; screen reader gets `aria-label` including "unread" prefix
- "Mark all as read" has `aria-label="Mark all notifications as read"`
- Each notification is a focusable link with descriptive text

**SEO:** Not indexed. Title: "Notifications | NoMarkup"

---

### 49. `/dashboard/disputes` (Dispute List)

**Route path:** `/dashboard/disputes`
**Access control:** Authenticated (any role)
**Layout:** Dashboard sidebar

**Components:**
```
DisputesPage
  PageHeader
    h1 "Disputes"
  Tabs [defaultValue="open"]
    TabsList
      TabsTrigger [value="open"] "Open" + Badge {openCount}
      TabsTrigger [value="resolved"] "Resolved"
    TabsContent [value="open"|"resolved"]
      div.space-y-3
        DisputeCard [repeating]
          div.flex.justify-between.items-start
            div
              h3 "Dispute: {contractReference}"
              p.text-muted-foreground "with {otherPartyName}"
              p.text-sm "Opened {openedDate, relative}"
            div.text-right
              Badge [variant by status] {status: open/under-review/awaiting-response/resolved}
        EmptyState [icon=ShieldCheckIcon] "No {tab} disputes"
```

**Data Requirements:**
- `GET /api/v1/disputes?status={tab}` via `DisputeService.ListDisputes`
- TanStack Query keys: `["disputes", { status }]`

**User Interactions:**
| Action | Result |
|---|---|
| Click tab | Filters disputes by status |
| Click DisputeCard | Navigate to `/dashboard/disputes/[id]` |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton DisputeCards (2) |
| Loaded | Dispute list with status badges |
| Empty | EmptyState with reassuring message |

**Responsive:** Single column list at all breakpoints.

**Accessibility:** Same tab + card keyboard patterns as other list pages.

**SEO:** Not indexed. Title: "Disputes | NoMarkup"

---

### 50. `/dashboard/disputes/[id]` (Dispute Detail)

**Route path:** `/dashboard/disputes/[id]`
**Access control:** Authenticated (must be dispute party)
**Layout:** Dashboard sidebar

**Components:**
```
DisputeDetailPage
  PageHeader
    Breadcrumb ["Disputes", "Dispute #{id}"]
    h1 "Dispute: {contractReference}"
    Badge {status}
  div.grid.grid-cols-1.lg:grid-cols-3.gap-6
    div.lg:col-span-2
      Card "Dispute Details"
        CardContent
          dl.grid.grid-cols-2.gap-4
            dt "Reason" dd {reason}
            dt "Filed By" dd {filedByName}
            dt "Against" dd {otherPartyName}
            dt "Contract" dd Link {contractReference} -> /dashboard/contracts/[cid]
            dt "Opened" dd {openedDate}
            dt "Status" dd Badge {status}
      Card "Evidence"
        CardContent
          Tabs [defaultValue="yours"]
            TabsList
              TabsTrigger "Your Evidence"
              TabsTrigger "Their Evidence"
            TabsContent [value="yours"]
              EvidenceList
                EvidenceItem [repeating]
                  div.flex.gap-3
                    FileIcon [by type]
                    div
                      p.font-medium {fileName}
                      p.text-sm.text-muted-foreground {description}
                      p.text-xs {uploadedDate}
                  EmptyState "No evidence submitted yet"
              Button [variant="outline"] icon PaperclipIcon "Submit Evidence"
            TabsContent [value="theirs"]
              EvidenceList [read-only, same structure]
              EmptyState "No evidence submitted by the other party yet"
      Card "Timeline"
        CardContent
          Timeline
            TimelineItem [repeating: opened, evidence submitted, status changes, resolution]
    aside.lg:col-span-1
      Card "Actions"
        CardContent.space-y-2
          Button [full-width] "Submit Evidence" -> opens SubmitEvidenceDialog
          Button [variant="outline", full-width] "View Chat Transcript" -> Link
          Button [variant="outline", full-width] "Respond to Resolution" [visible if resolution proposed]
      Card "Resolution" [visible if resolution proposed or resolved]
        CardContent
          p.font-medium "Proposed Resolution"
          p {resolutionText}
          div.flex.gap-2 [visible if awaiting response]
            Button "Accept"
            Button [variant="destructive-outline"] "Reject"
```

**Submit Evidence Dialog:**
```
SubmitEvidenceDialog
  DialogHeader
    DialogTitle "Submit Evidence"
  DialogContent
    FileUploadDropzone [accept: images, PDFs, max 5 files, 20MB each]
    Textarea [description, rows=3, placeholder="Describe this evidence"]
    DialogFooter
      Button [variant="outline"] "Cancel"
      Button "Submit"
```

**Data Requirements:**
- `GET /api/v1/disputes/{id}` via `DisputeService.GetDispute` -- includes evidence, timeline, resolution
- `POST /api/v1/disputes/{id}/evidence` via `DisputeService.SubmitEvidence`
- `POST /api/v1/disputes/{id}/respond` via `DisputeService.RespondToResolution`
- TanStack Query keys: `["disputes", id]`

**User Interactions:**
| Action | Result |
|---|---|
| Click "Submit Evidence" | Opens dialog with file upload + description |
| Upload files + submit | Evidence added to "Your Evidence" tab, toast confirms |
| Click "Accept" resolution | Confirmation dialog, dispute marked resolved |
| Click "Reject" resolution | Textarea appears for rejection reason, submit re-opens dispute |
| Click "View Chat Transcript" | Opens chat transcript in new panel or page |
| Click contract link | Navigate to contract detail |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton cards |
| Open | All actions available, timeline shows activity |
| Under review | Actions limited, banner: "Under admin review" |
| Awaiting response | Resolution card prominent with accept/reject buttons |
| Resolved | Actions hidden, resolution card shows outcome, timeline complete |

**Responsive:** Single column on mobile, 3-col on lg+. Evidence tabs stack below details.

**Accessibility:**
- Evidence file list uses `role="list"` with descriptive items
- File upload dialog announces accepted formats and limits
- Accept/Reject buttons have descriptive `aria-label` including dispute context
- Timeline uses semantic `ol`

**SEO:** Not indexed. Title: "Dispute #{id} | NoMarkup"

---

### 51. `/dashboard/help`

**Route path:** `/dashboard/help`
**Access control:** Authenticated (any role)
**Layout:** Dashboard sidebar

**Components:**
```
HelpPage
  PageHeader
    h1 "Help & Support"
  div.max-w-3xl.mx-auto.space-y-8
    div
      Input [search, type="search", placeholder="Search help articles...", icon=SearchIcon]
    // FAQ by category:
    div.space-y-6
      FAQCategory [repeating: "Getting Started", "Bidding & Jobs", "Payments", "Account", "Trust & Safety"]
        h2 {categoryName}
        Accordion [type="single", collapsible]
          AccordionItem [repeating]
            AccordionTrigger {question}
            AccordionContent
              div.prose.prose-sm {answer, rendered markdown}
      // No results:
      EmptyState [visible if search yields nothing] "No results for '{query}'. Try a different search term."
    Card "Contact Support"
      CardContent
        ContactSupportForm
          Input [email, pre-filled from auth]
          Select [topic, options: billing/technical/account/other]
          Textarea [message, rows=4]
          Button [submit] "Send Message"
    div.text-center
      p.text-sm.text-muted-foreground "Or visit our"
      Link [/docs, external] "Documentation & Guides"
```

**Data Requirements:**
- FAQ content: static JSON or `GET /api/v1/help/faq` (can be statically generated at build time)
- `POST /api/v1/help/contact` via `SupportService.SubmitContactForm`

**User Interactions:**
| Action | Result |
|---|---|
| Type in search field | FAQ items filter in real-time (client-side) |
| Click AccordionTrigger | Expands/collapses answer |
| Submit contact form | Toast: "Message sent. We'll respond within 24 hours." Form resets. |

**States:**
| State | Appearance |
|---|---|
| Default | All FAQ categories visible, search empty |
| Searching | Only matching FAQ items visible; categories with no matches hidden |
| No results | EmptyState message |
| Submitting contact | Button spinner, inputs disabled |
| Contact sent | Toast confirmation, form resets |

**Responsive:** Single column, max-w-3xl centered. Accordion works identically at all sizes.

**Accessibility:**
- Search input has `role="searchbox"` with `aria-label="Search help articles"`
- Accordion uses `aria-expanded` on triggers (shadcn/ui default)
- FAQ answers rendered as prose use proper heading hierarchy within content
- Contact form fields have associated labels

**SEO:** Not indexed. Title: "Help & Support | NoMarkup"

---

### 52. `/dashboard/trust-score`

**Route path:** `/dashboard/trust-score`
**Access control:** Authenticated (any role)
**Layout:** Dashboard sidebar

**Components:**
```
TrustScorePage
  PageHeader
    h1 "Trust Score"
  div.grid.grid-cols-1.lg:grid-cols-3.gap-6
    div.lg:col-span-1
      Card "Overall Score"
        CardContent.flex.flex-col.items-center.text-center
          div.relative.w-40.h-40
            CircularProgress [value={score}, max=100, size=160]
            p.absolute.inset-0.flex.items-center.justify-center.text-4xl.font-bold {score}
          Badge [variant by tier] {tierName: "Bronze" | "Silver" | "Gold" | "Platinum"}
          p.text-muted-foreground "out of 100"
    div.lg:col-span-2
      Card "Score Breakdown"
        CardContent
          RadarChart [Recharts, 6 dimensions]
            PolarGrid
            PolarAngleAxis [labels: Feedback, Volume, Consistency, Response, Disputes, Fraud]
            Radar [data={dimensionScores}, fill=primary/20, stroke=primary]
          div.grid.grid-cols-2.sm:grid-cols-3.gap-4.mt-6
            DimensionCard [repeating, 6 cards]
              div.flex.items-center.gap-2
                icon [dimension-specific]
                p.font-medium {dimensionName}
              p.text-2xl.font-bold {dimensionScore}
              Progress [value={dimensionScore}, max=100]
              p.text-xs.text-muted-foreground {dimensionLabel}
  Card "Score History"
    CardContent
      ScoreHistoryChart [Recharts LineChart, last 6 months]
        XAxis [month]
        YAxis [0-100]
        Line [overall score]
        Tooltip
  Card "Tips to Improve"
    CardContent
      div.space-y-4
        ImprovementTip [repeating, sorted by lowest dimension first]
          div.flex.gap-3
            div.shrink-0.w-8.h-8.rounded-full.bg-primary/10.flex.items-center.justify-center
              icon {dimensionIcon}
            div
              p.font-medium {dimensionName} -- Score: {score}/100
              p.text-sm.text-muted-foreground {tipText}
```

**Data Requirements:**
- `GET /api/v1/trust-scores/me` via `TrustService.GetTrustScore` -- includes overall, dimensions, history, tips
- TanStack Query keys: `["trust-score", "me"]`

**User Interactions:**
| Action | Result |
|---|---|
| Hover radar chart axis | Highlights dimension, tooltip shows score |
| Hover history chart point | Tooltip shows month + score |
| Click dimension card | Scrolls to corresponding tip section |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton circular progress, skeleton chart, skeleton cards |
| Loaded | All scores and charts populated |
| New user (no data) | Score shows 0 with message: "Complete your first job to start building your trust score" |

**Responsive:** Overall score card: full width on mobile (centered), 1/3 on lg. Dimension cards: 2 col mobile, 3 col sm+. Charts are full width and responsive (Recharts `<ResponsiveContainer>`).

**Accessibility:**
- CircularProgress uses `role="meter"` with `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label="Trust score"`
- Radar chart has `aria-hidden="true"` with equivalent data in DimensionCards
- Progress bars on dimension cards use `role="meter"` with labels
- Tips section uses proper heading structure within each tip

**SEO:** Not indexed. Title: "Trust Score | NoMarkup"

---

## Admin Pages

---

### 53. `/admin` (Admin Dashboard)

**Route path:** `/admin`
**Access control:** Authenticated, role: admin
**Layout:** Separate admin layout (no customer/provider sidebar)

**Admin Layout:**
```
AdminLayout (app/(admin)/layout.tsx)
  div.flex.min-h-screen
    AdminSidebar [fixed, w-64]
      LogoLink [/admin]
      nav
        AdminNavItem [icon=LayoutDashboardIcon] "Overview" -> /admin
        AdminNavItem [icon=UsersIcon] "Users" -> /admin/users
        AdminNavItem [icon=BriefcaseIcon] "Jobs" -> /admin/jobs
        AdminNavItem [icon=AlertTriangleIcon] "Disputes" -> /admin/disputes
        AdminNavItem [icon=ShieldAlertIcon] "Fraud Queue" -> /admin/fraud
        AdminNavItem [icon=TagIcon] "Taxonomy" -> /admin/taxonomy
        AdminNavItem [icon=SettingsIcon] "Settings" -> /admin/settings
      div.mt-auto
        AdminUserMenu [avatar, name, sign-out]
    main.flex-1.p-6
      {children}
```

**Components:**
```
AdminDashboardPage
  PageHeader
    h1 "Admin Dashboard"
  div.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-4.gap-4
    StatCard [icon=UsersIcon, label="Total Users", value={totalUsers}, trend={usersTrend}]
    StatCard [icon=BriefcaseIcon, label="Active Jobs", value={activeJobs}, trend={jobsTrend}]
    StatCard [icon=DollarSignIcon, label="Revenue (Month)", value={monthRevenue}, format="currency", trend={revenueTrend}]
    StatCard [icon=AlertTriangleIcon, label="Open Disputes", value={openDisputes}, variant={openDisputes > 0 ? "warning" : "default"}]
  div.grid.grid-cols-1.lg:grid-cols-2.gap-6.mt-6
    Card "Quick Links"
      CardContent
        div.grid.grid-cols-2.gap-3
          QuickLinkCard [icon=UsersIcon] "User Management" -> /admin/users
          QuickLinkCard [icon=BriefcaseIcon] "Job Management" -> /admin/jobs
          QuickLinkCard [icon=AlertTriangleIcon] "Dispute Queue" -> /admin/disputes
          QuickLinkCard [icon=ShieldAlertIcon] "Fraud Queue" -> /admin/fraud
          QuickLinkCard [icon=TagIcon] "Taxonomy" -> /admin/taxonomy
          QuickLinkCard [icon=SettingsIcon] "Platform Settings" -> /admin/settings
    Card "Recent Activity"
      CardContent
        ActivityFeed
          ActivityItem [repeating, last 10 events]
            div.flex.gap-3
              Avatar [admin/user who acted]
              div
                p {activityDescription}
                p.text-sm.text-muted-foreground {timestamp, relative}
```

**Data Requirements:**
- `GET /api/v1/admin/dashboard` via `AdminService.GetDashboard` -- returns stats, trends, recent activity
- TanStack Query keys: `["admin", "dashboard"]`
- Auto-refresh: stats polled every 60 seconds

**User Interactions:**
| Action | Result |
|---|---|
| Click stat card | Navigate to corresponding management page |
| Click quick link card | Navigate to corresponding admin section |
| Click activity item | Navigate to relevant entity (user, job, dispute) |

**States:**
| State | Appearance |
|---|---|
| Loading | Skeleton stat cards, skeleton quick links, skeleton activity feed |
| Loaded | Populated stats with trend arrows (green up / red down), quick links, activity |
| Open disputes > 0 | Disputes stat card has warning variant (amber background) |
| No recent activity | Activity feed shows "No recent activity" |

**Responsive:** Admin sidebar: visible on lg+, hamburger menu toggle on smaller screens (slides in as Sheet). Stats: 1 col mobile, 2 col sm, 4 col lg. Quick links: 1 col mobile, 2 col sm+.

**Accessibility:**
- Admin sidebar uses `<nav aria-label="Admin navigation">`
- StatCards use `role="status"` with trend described: `aria-label="Total Users: 1,234, up 5%"`
- Quick link cards are keyboard focusable with Enter/Space activation
- Activity feed uses `role="feed"` with `aria-label="Recent admin activity"`
- Active nav item has `aria-current="page"`

**SEO:** Not indexed (`noindex, nofollow`). Title: "Admin Dashboard | NoMarkup". Entire `/admin` route group is protected by middleware redirect.
