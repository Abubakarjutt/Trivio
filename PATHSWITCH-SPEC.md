# PathSwitch — Build Specification

> A career-transition mentorship marketplace where career switchers pay for 1:1 sessions with mentors who made their EXACT same career transition.

## What to Build

A web application with these pages:
1. Landing page (marketing)
2. Mentor listing with search/filters
3. Mentor profile with booking
4. Payment flow (Stripe Checkout)
5. Post-session review submission
6. Mentor onboarding (sign up + profile creation)
7. Admin dashboard (founder verifies mentors)
8. Auth (magic link sign-in)

**This is a NEW project — build from scratch. Ignore any existing code in the repo.**

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 15 (App Router) + TypeScript | Use `src/app/` directory structure |
| Database | PostgreSQL + Prisma ORM | Hosted on Neon, Supabase, or Railway |
| Auth | NextAuth.js v5 | Magic link only (via Resend). No passwords. |
| UI | Tailwind CSS + shadcn/ui | Custom theme in `DESIGN.md` |
| Payments | Stripe (Checkout Sessions + Connect Express) | Platform collects, auto-pays mentors |
| Scheduling | Cal.com embed | Mentors use their own Cal.com accounts |
| Email | Resend | Magic links, confirmations, review requests |
| Deployment | Vercel | Auto-deploy on push |
| Cron | Vercel Cron Jobs | Review email scheduling (every 15 min) |

---

## Database Schema (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  role          Role      @default(MENTEE)
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  mentor        Mentor?
  sessions      Session[] @relation("MenteeSessions")
  reviews       Review[]
  accounts      Account[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model Mentor {
  id                String        @id @default(cuid())
  userId            String        @unique
  bio               String
  whyMentor         String?
  linkedinUrl       String
  transitionFrom    String        // Primary FROM field (drives search)
  transitionTo      String        // Primary TO field (drives search)
  country           String
  pricePerSession   Int           // In cents (USD)
  calcomUsername    String        // Cal.com username for embed
  calcomEventSlug  String        // Cal.com event type slug
  verified          Boolean       @default(false)
  verifiedAt        DateTime?
  rejectedAt        DateTime?
  rejectionReason   String?
  stripeAccountId   String?       // Stripe Connect Express account
  stripeOnboarded   Boolean       @default(false)
  active            Boolean       @default(true)
  noShowCount       Int           @default(0)
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  user              User          @relation(fields: [userId], references: [id])
  careerSteps       CareerStep[]
  sessions          Session[]
  reviews           Review[]

  @@index([transitionFrom, transitionTo])
  @@index([country])
  @@index([verified, active])
}

model CareerStep {
  id        String   @id @default(cuid())
  mentorId  String
  title     String   // Job title (e.g., "Accountant")
  company   String?  // Optional company name
  year      Int      // Year started this role
  order     Int      // Display order in timeline

  mentor    Mentor   @relation(fields: [mentorId], references: [id], onDelete: Cascade)

  @@index([mentorId])
}

model Session {
  id                  String        @id @default(cuid())
  menteeId            String
  mentorId            String
  status              SessionStatus @default(PENDING_PAYMENT)
  scheduledAt         DateTime      // When the session is booked for
  durationMinutes     Int           @default(45)
  priceCharged        Int           // In cents, locked at booking time
  platformFee         Int           // 20% of priceCharged
  stripeCheckoutId    String?       @unique
  stripePaymentIntent String?
  calcomBookingId     String?
  calcomBookingUid    String?
  meetingLink         String?       // Google Meet/Zoom link
  cancelledAt         DateTime?
  cancelledBy         String?       // "mentee" | "mentor" | "admin"
  refundedAt          DateTime?
  completedAt         DateTime?
  reviewEmailSentAt   DateTime?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  mentee              User          @relation("MenteeSessions", fields: [menteeId], references: [id])
  mentor              Mentor        @relation(fields: [mentorId], references: [id])
  review              Review?

  @@index([menteeId])
  @@index([mentorId])
  @@index([status])
  @@index([stripeCheckoutId])
}

model Review {
  id                  String   @id @default(cuid())
  sessionId           String   @unique
  mentorId            String
  userId              String   // Reviewer (mentee)
  sessionHappened     Boolean  // "Did the session happen?"
  rating              Int?     // 1-5 stars (null if session didn't happen)
  relevantMentor      Boolean? // "Was this mentor relevant to your transition?"
  decisionChanged     String?  // "What decision changed after this call?"
  wouldRecommend      Boolean? // "Would you recommend this mentor?"
  decisionConfidence  Int?     // 1-10: "How confident in your career decision now?"
  createdAt           DateTime @default(now())

  session             Session  @relation(fields: [sessionId], references: [id])
  mentor              Mentor   @relation(fields: [mentorId], references: [id])
  user                User     @relation(fields: [userId], references: [id])

  @@index([mentorId])
}

model WebhookEvent {
  id          String   @id @default(cuid())
  eventId     String   @unique // Stripe event ID for idempotency
  type        String
  processedAt DateTime @default(now())
}

model WaitlistEntry {
  id              String   @id @default(cuid())
  email           String
  transitionFrom  String
  transitionTo    String
  createdAt       DateTime @default(now())

  @@unique([email, transitionFrom, transitionTo])
}

enum Role {
  MENTEE
  MENTOR
  ADMIN
}

enum SessionStatus {
  PENDING_PAYMENT
  CONFIRMED
  COMPLETED
  REVIEWED
  CANCELLED
  NO_SHOW
  PAYMENT_EXPIRED
  REFUNDED
}
```

---

## Pages & Routes

### Public Pages (no auth required)

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Landing page | Hero + featured mentors + CTA |
| `/mentors` | Mentor listing | Search with FROM/TO/country/price filters |
| `/mentors/[id]` | Mentor profile | Timeline, bio, Cal.com embed, reviews |
| `/how-it-works` | How It Works | 3-step explanation page |
| `/terms` | Terms of Service | Legal disclaimer about career advice |

### Auth Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/auth/signin` | Sign in | Email input → magic link sent |
| `/auth/verify` | Verify | Magic link landing → session created |

### Authenticated Pages (mentee)

| Route | Page | Purpose |
|-------|------|---------|
| `/book/[sessionId]` | Payment | Stripe Checkout redirect + confirmation |
| `/reviews/[token]` | Review form | Post-session review submission |
| `/my-sessions` | My sessions | List of booked/completed sessions |

### Mentor Pages (authenticated + role=MENTOR)

| Route | Page | Purpose |
|-------|------|---------|
| `/mentor/onboarding` | Onboarding | Profile form (bio, timeline, LinkedIn, Cal.com, pricing) |
| `/mentor/dashboard` | Dashboard | Upcoming sessions, earnings summary |
| `/mentor/stripe-onboarding` | Stripe Connect | Onboarding redirect for payouts |

### Admin Pages (authenticated + ADMIN_EMAIL check)

| Route | Page | Purpose |
|-------|------|---------|
| `/admin/mentors` | Mentor verification | List pending mentors, approve/reject |
| `/admin/sessions` | Session overview | Monitor bookings, handle disputes |

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth.js handlers |
| `/api/webhooks/stripe` | POST | Stripe webhook (checkout.session.completed, etc.) |
| `/api/cron/review-emails` | GET | Vercel Cron: find completed sessions, send review emails |
| `/api/stripe/create-checkout` | POST | Create Stripe Checkout Session for a booking |
| `/api/stripe/connect-onboarding` | POST | Create Stripe Connect onboarding link for mentor |
| `/api/mentors` | GET | List/search mentors (public) |
| `/api/mentors/[id]` | GET | Single mentor profile (public) |
| `/api/mentor/profile` | POST/PUT | Create/update mentor profile (authenticated) |
| `/api/reviews` | POST | Submit a review |
| `/api/admin/mentors/[id]/verify` | POST | Approve a mentor |
| `/api/admin/mentors/[id]/reject` | POST | Reject a mentor |
| `/api/waitlist` | POST | Add to waitlist for a missing transition path |

---

## Core User Flows

### Flow 1: Mentee Books a Session

```
1. Mentee browses /mentors, applies filters (FROM: Accounting, TO: DevOps)
2. Clicks on a mentor card → /mentors/[id]
3. Sees career timeline, bio, reviews, price ($50)
4. Scrolls to Cal.com embed, selects a time slot
5. Cal.com redirects to /book/[sessionId] (Cal.com in requires-confirmation mode)
6. PathSwitch creates a Session (PENDING_PAYMENT) and Stripe Checkout Session
7. Mentee completes payment on Stripe
8. Stripe webhook fires → Session status → CONFIRMED
9. PathSwitch sends confirmation email with meeting link
10. Cal.com booking is auto-confirmed via API
```

### Flow 2: Post-Session Review

```
1. Vercel Cron runs every 15 minutes
2. Finds sessions where: status=CONFIRMED AND scheduledAt + duration < now - 1 hour AND reviewEmailSentAt IS NULL
3. Sends review email via Resend with unique token link
4. Mentee clicks link → /reviews/[token]
5. Submits review (did it happen? rating, relevance, decision change)
6. Session status → REVIEWED
```

### Flow 3: Mentor Onboarding

```
1. Mentor signs up via magic link at /auth/signin
2. Redirected to /mentor/onboarding
3. Fills: bio, "why I mentor", LinkedIn URL, career steps (timeline), FROM/TO dropdowns, country, price, Cal.com username + event slug
4. Submits → Mentor record created (verified: false)
5. Founder sees pending mentor in /admin/mentors
6. Founder checks LinkedIn URL, approves or rejects
7. Approved: "Verified by PathSwitch" badge appears on profile
8. Mentor completes Stripe Connect Express onboarding for payouts
```

### Flow 4: Cancellation

```
- >24h before: Full refund via Stripe, session → CANCELLED, Cal.com booking cancelled
- <24h before: No refund, session → CANCELLED
- No-show reported: Founder manually issues refund, session → NO_SHOW, mentor noShowCount++
```

---

## Stripe Integration

### Checkout Session (Booking)

```typescript
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  payment_method_types: ['card'],
  line_items: [{
    price_data: {
      currency: 'usd',
      unit_amount: mentor.pricePerSession, // cents
      product_data: {
        name: `45-min session with ${mentor.user.name}`,
        description: `Career transition mentorship: ${mentor.transitionFrom} → ${mentor.transitionTo}`,
      },
    },
    quantity: 1,
  }],
  payment_intent_data: {
    application_fee_amount: Math.round(mentor.pricePerSession * 0.20), // 20% platform fee
    transfer_data: {
      destination: mentor.stripeAccountId,
    },
  },
  metadata: {
    sessionId: session.id,
    mentorId: mentor.id,
    menteeId: user.id,
    calcomBookingUid: calcomBookingUid,
  },
  success_url: `${baseUrl}/book/${session.id}?status=success`,
  cancel_url: `${baseUrl}/mentors/${mentor.id}?booking=cancelled`,
});
```

### Webhook Handler

```
Event: checkout.session.completed
→ Look up Session by stripeCheckoutId
→ Update status: PENDING_PAYMENT → CONFIRMED
→ Auto-confirm Cal.com booking via API
→ Send confirmation email via Resend

Idempotency: Check WebhookEvent table for event ID before processing.
Retry: Exponential backoff (1s, 5s, 30s) + dead letter email to ADMIN_EMAIL on final failure.
```

### Connect Express (Mentor Payouts)

```
- On mentor approval: Create Connect Express account
- Redirect mentor to Stripe onboarding URL
- On onboarding complete: stripeOnboarded = true
- Payouts happen automatically via Stripe (payments go directly to mentor minus platform fee)
```

---

## Cal.com Integration

- Each mentor has their own Cal.com account (free tier)
- They create an event type (e.g., "Career Mentorship Session - 45min")
- PathSwitch embeds their booking page: `https://cal.com/{username}/{event-slug}`
- **Mode: requires-confirmation** — booking is pending until PathSwitch confirms it
- After Stripe payment succeeds, PathSwitch auto-confirms via Cal.com API
- **Embed styling:** Match PathSwitch theme via Cal.com embed parameters (primaryColor, fontFamily)

```typescript
// Cal.com embed on mentor profile
<Cal
  calLink={`${mentor.calcomUsername}/${mentor.calcomEventSlug}`}
  config={{
    theme: 'light',
    styles: { branding: { brandColor: '#0D9488' } },
    hideEventTypeDetails: false,
  }}
/>
```

---

## Auth Configuration

```typescript
// NextAuth.js v5 config
export const authOptions = {
  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER, // Resend SMTP
      from: 'PathSwitch <noreply@pathswitch.com>',
    }),
  ],
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify',
  },
}
```

- Magic link expires after 24 hours
- Expired link shows friendly message + "Send a new one" button
- No passwords, no OAuth (LinkedIn OAuth deferred to v2)

---

## Admin Access

Simple env-var check, no role system:

```typescript
// middleware.ts or per-route check
const ADMIN_EMAIL = process.env.ADMIN_EMAIL // founder's email

function isAdmin(session) {
  return session?.user?.email === ADMIN_EMAIL
}
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_URL=https://pathswitch.com
NEXTAUTH_SECRET=...

# Email (Resend)
EMAIL_SERVER=smtp://resend:re_xxx@smtp.resend.com:465
RESEND_API_KEY=re_xxx

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Cal.com
CALCOM_API_KEY=cal_...

# Admin
ADMIN_EMAIL=founder@pathswitch.com

# App
NEXT_PUBLIC_APP_URL=https://pathswitch.com
```

---

## Design System

See `DESIGN.md` for the complete design system including:
- Color palette (teal primary + amber accent on warm off-white)
- Typography (DM Sans, 7-step scale)
- Spacing (4px base, 13-step scale)
- Component specs (mentor cards, timeline, buttons, forms)
- Tailwind configuration (ready to paste)
- Motion/animation specs
- Accessibility requirements

**Key visual rules:**
- Background is warm off-white `#FFFBF5`, never pure white
- Career timeline is the signature brand element — prominent on every mentor card and profile
- No purple, no blob decorations, no 3-column icon grids
- Asymmetric layouts (60/40 splits on landing page)
- Single box-shadow level only

---

## Search / Filtering

### Curated Dropdown Values

**Transition FROM:**
Accounting, Mechanical Engineering, Civil Engineering, Biology, Business Administration, Teaching/Education, Nursing/Healthcare, Law, Marketing, Hospitality, Retail, Military, Finance, Journalism, Architecture, Psychology, Other

**Transition TO:**
Software Engineering, Data Analytics/Science, Cloud/DevOps, Product Management, UX/UI Design, Cybersecurity, AI/Machine Learning, Technical Writing, IT Support/SysAdmin, QA/Testing, Other

### Search Logic

```
1. Exact match: FROM AND TO both match → show first
2. Adjacent match: FROM matches OR TO matches → show second (labeled "Similar paths")
3. No match: Show empty state with waitlist capture
```

---

## Email Templates (Resend)

| Email | Trigger | Content |
|-------|---------|---------|
| Magic link | Auth request | "Sign in to PathSwitch" + magic link button |
| Booking confirmed | Payment success | Session details, meeting link, mentor name, "what to expect" |
| Review request | 1h after session | "How was your session with [mentor]?" + review link |
| Mentor approved | Admin approves | "You're verified! Complete your Stripe setup to receive payments" |
| Mentor rejected | Admin rejects | "We couldn't verify your profile" + reason |
| Waitlist match | New mentor matches | "A mentor for [FROM → TO] just joined!" |

---

## Cancellation Policy

- **Free cancellation:** > 24 hours before scheduled time
- **No refund:** < 24 hours before (slot is committed)
- **No-show:** Full refund (founder manually processes after mentee reports)
- **Mentor deactivation:** 3 no-show reports → account deactivated

---

## Success Metrics (for reference, not to build)

- Referral rate (mentees sharing with friends)
- Decision confidence score (from review form)
- Kill metric: <3 paid bookings from 100 targeted visitors = pivot needed

---

## What NOT to Build (v2 / deferred)

- Mobile app
- Group sessions
- Subscription plans
- AI-powered matching
- In-app messaging/chat
- In-app video calls
- Custom earnings dashboard
- Content/course creation
- Referral system with tracking
- LinkedIn OAuth verification

---

## Build Order (suggested)

```
Phase 1: Foundation
  - Next.js project setup + Prisma schema + DB
  - Auth (NextAuth + magic link via Resend)
  - Tailwind config from DESIGN.md

Phase 2: Core Pages
  - Landing page (hero + featured mentors)
  - Mentor listing + search/filters
  - Mentor profile + Cal.com embed

Phase 3: Transactions
  - Stripe Checkout integration
  - Webhook handler (checkout.session.completed)
  - Session status machine
  - Stripe Connect (mentor payouts)

Phase 4: Supporting Features
  - Mentor onboarding flow
  - Admin dashboard (verify/reject)
  - Review system (cron + form + display)
  - Email templates

Phase 5: Polish
  - Empty states (adjacent matches + waitlist)
  - Payment states (all 5)
  - Mobile responsive
  - Terms of Service page
  - Error handling + logging
```

---

## File Structure

```
src/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx              # Landing page
│   │   ├── how-it-works/page.tsx
│   │   └── terms/page.tsx
│   ├── (auth)/
│   │   ├── auth/signin/page.tsx
│   │   └── auth/verify/page.tsx
│   ├── mentors/
│   │   ├── page.tsx              # Mentor listing
│   │   └── [id]/page.tsx         # Mentor profile
│   ├── book/
│   │   └── [sessionId]/page.tsx  # Payment confirmation
│   ├── reviews/
│   │   └── [token]/page.tsx      # Review form
│   ├── my-sessions/page.tsx
│   ├── mentor/
│   │   ├── onboarding/page.tsx
│   │   ├── dashboard/page.tsx
│   │   └── stripe-onboarding/page.tsx
│   ├── admin/
│   │   ├── mentors/page.tsx
│   │   └── sessions/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── webhooks/stripe/route.ts
│   │   ├── cron/review-emails/route.ts
│   │   ├── stripe/
│   │   │   ├── create-checkout/route.ts
│   │   │   └── connect-onboarding/route.ts
│   │   ├── mentors/route.ts
│   │   ├── mentor/profile/route.ts
│   │   ├── reviews/route.ts
│   │   ├── admin/mentors/[id]/verify/route.ts
│   │   ├── admin/mentors/[id]/reject/route.ts
│   │   └── waitlist/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn/ui (restyled)
│   ├── career-timeline.tsx       # Signature brand component
│   ├── mentor-card.tsx
│   ├── verified-badge.tsx
│   ├── empty-state.tsx
│   ├── filter-panel.tsx
│   ├── review-card.tsx
│   ├── nav.tsx
│   └── footer.tsx
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── db.ts                     # Prisma client
│   ├── stripe.ts                 # Stripe client + helpers
│   ├── calcom.ts                 # Cal.com API helpers
│   ├── email.ts                  # Resend helpers
│   └── utils.ts
└── prisma/
    ├── schema.prisma
    └── seed.ts                   # Seed data for development
```

---

*This spec consolidates decisions from: /office-hours, /plan-eng-review, /plan-ceo-review, /plan-design-review, and /design-consultation — all completed 2026-05-21.*
