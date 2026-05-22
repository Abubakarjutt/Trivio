# PathSwitch Design System

> Career-transition mentorship marketplace. The design communicates: "Finally, someone gets it."

## Brand Personality

- **Warm** — not corporate, not sterile
- **Trustworthy** — verified paths, real people, visible credentials
- **Personal** — one human helping another, not a platform
- **Specific** — "Accounting → DevOps," not "find a mentor"

## Color Palette

### Semantic Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#0D9488` | Buttons, links, active states, focus rings |
| `--color-primary-hover` | `#0F766E` | Primary button hover |
| `--color-primary-light` | `#CCFBF1` | Primary badges, subtle highlights |
| `--color-accent` | `#D97706` | Timeline dots, highlights, verification badges |
| `--color-accent-hover` | `#B45309` | Accent hover states |
| `--color-accent-light` | `#FEF3C7` | Accent backgrounds, notification badges |
| `--color-background` | `#FFFBF5` | Page background (warm off-white) |
| `--color-surface` | `#FEF7ED` | Card backgrounds, elevated surfaces |
| `--color-surface-hover` | `#FDF2E3` | Card hover state |
| `--color-text` | `#1C1917` | Primary text (warm black) |
| `--color-text-secondary` | `#78716C` | Secondary text, metadata, captions |
| `--color-text-muted` | `#A8A29E` | Placeholder text, disabled labels |
| `--color-border` | `#E7E5E4` | Card borders, dividers |
| `--color-border-strong` | `#D6D3D1` | Input borders, focused separators |
| `--color-error` | `#DC2626` | Error states, destructive actions |
| `--color-success` | `#16A34A` | Success confirmations, verified states |
| `--color-info` | `#0EA5E9` | Informational notices |

### Usage Rules

- **Never** use amber on large surfaces (backgrounds, full-width sections) — it reads as "warning"
- Primary (teal) carries CTAs and navigation. Accent (amber) highlights and draws the eye to small elements.
- Background is warm off-white (`#FFFBF5`), **never** pure white (`#FFFFFF`)
- Text is warm black (`#1C1917`), **never** pure black (`#000000`)
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text (WCAG AA)

## Typography

### Font

**DM Sans** (Google Fonts) — all weights (400, 500, 600, 700).

```css
font-family: 'DM Sans', sans-serif;
```

Load via `next/font/google` for zero layout shift:
```typescript
import { DM_Sans } from 'next/font/google'
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })
```

### Type Scale

| Token | Size/Line-height | Weight | Usage |
|-------|-----------------|--------|-------|
| `--text-display` | 48px / 56px | 700 | Hero headlines only |
| `--text-h1` | 36px / 40px | 700 | Page titles |
| `--text-h2` | 28px / 32px | 600 | Section headings |
| `--text-h3` | 22px / 28px | 600 | Card titles, subsections |
| `--text-body` | 16px / 24px | 400 | Default body text |
| `--text-body-medium` | 16px / 24px | 500 | Emphasized body (nav links, labels) |
| `--text-small` | 14px / 20px | 400 | Captions, metadata, timestamps |
| `--text-tiny` | 12px / 16px | 500 | Badges, labels, tags |

### Mobile Adjustments

- Display: 36px / 42px (down from 48px)
- H1: 28px / 34px (down from 36px)
- H2: 24px / 30px (down from 28px)
- Body: 15px / 22px (down from 16px)

### Rules

- **One typeface only.** Never introduce a second font.
- Headlines use weight 600-700. Body uses 400. Navigation/labels use 500.
- Letter-spacing: -0.02em on display/h1, 0 elsewhere.
- **Never** use system-ui, Inter, Roboto, or Arial as fallback visible to users.

## Spacing

### Scale (4px base)

| Token | Value | Common Usage |
|-------|-------|--------------|
| `--space-1` | 4px | Tight gaps (icon-to-text) |
| `--space-2` | 8px | Internal padding (badges, chips) |
| `--space-3` | 12px | Compact form gaps |
| `--space-4` | 16px | Default component padding, mobile gutters |
| `--space-5` | 20px | Medium gaps |
| `--space-6` | 24px | Desktop gutters, card padding |
| `--space-8` | 32px | Between related sections |
| `--space-10` | 40px | Between section heading and content |
| `--space-12` | 48px | Section padding (mobile) |
| `--space-16` | 64px | Section separation (desktop) |
| `--space-20` | 80px | Major section breaks |
| `--space-24` | 96px | Hero padding, page-level breathing room |

### Rules

- Minimum internal padding on any component: 8px
- Card padding: 24px (desktop), 16px (mobile)
- Section separation: 64-96px (desktop), 48-64px (mobile)
- Form field gap: 16px between fields, 24px between field groups

## Layout

### Grid

- **Columns:** 12
- **Max-width:** 1200px (centered)
- **Gutters:** 24px (desktop), 16px (mobile)
- **Content max-width (prose):** 680px

### Breakpoints

| Token | Value | Target |
|-------|-------|--------|
| `--bp-mobile` | 375px | Phone (design target) |
| `--bp-tablet` | 768px | Tablet / small laptop |
| `--bp-desktop` | 1024px | Desktop |

### Layout Patterns

- **Landing page sections:** Alternate 60/40 and 40/60 splits (NOT centered-everything)
- **Content pages:** Single column, max-width 680px for readability
- **Listing pages:** Single column cards (NOT grid mosaics)
- **Profile pages:** Stacked sections, full-width timeline at top

### Rules

- **Never** center all content on a page. Left-align body text. Center only hero headlines and CTAs.
- Use asymmetric splits for visual interest on marketing pages.
- Cards stack vertically on mobile — no horizontal card carousels.

## Decoration & Visual Interest

### What PathSwitch USES

- **Timeline connecting lines:** 1px strokes in `--color-border` connecting career timeline nodes. These are meaningful (they represent the career path), not decorative noise.
- **Timeline dots:** 8px circles in `--color-accent` marking career milestones.
- **Hero gradient:** Single subtle gradient from `rgba(217, 119, 6, 0.05)` to `transparent` on hero section only. NOT a full-bleed color gradient.
- **Card elevation:** Single shadow `0 1px 3px rgba(0,0,0,0.08)` — one level only.
- **Verification badge:** Small teal checkmark icon next to mentor names.

### What PathSwitch BANS (AI Slop Patterns)

- ❌ Purple or indigo gradients
- ❌ 3-column icon grids (the "features section" cliché)
- ❌ Icons inside colored circles
- ❌ Decorative blobs, waves, or floating shapes
- ❌ Emoji as design elements
- ❌ Generic hero illustrations (abstract people shapes)
- ❌ Multi-layer box shadows
- ❌ Parallax scrolling
- ❌ Spring/bounce animations
- ❌ Pure white backgrounds
- ❌ Stock photography

## Motion

### Timing

| Interaction | Duration | Easing | Property |
|-------------|----------|--------|----------|
| Button hover/press | 100ms | ease-out | transform (scale 0.98) |
| Card hover | 150ms | ease-out | transform (translateY -2px), box-shadow |
| Scroll reveal | 200ms | ease-out | opacity, transform (translateY 8px → 0) |
| Page transitions | 400ms | ease-out | opacity |
| Loading skeletons | 1.5s | ease-in-out | opacity (pulse) |

### Rules

- Maximum animation duration: 400ms. Nothing should feel slow.
- **Never** use bounce, spring, or elastic easing.
- **Never** use parallax scrolling.
- Scroll reveals: fade-up only (translateY 8px → 0). Never slide in from sides.
- Respect `prefers-reduced-motion` — disable all transforms, keep opacity transitions.
- Loading states use skeleton pulse, never spinners (except inline submit buttons).

## Border Radius

| Element | Radius |
|---------|--------|
| Cards | 12px |
| Buttons | 8px |
| Inputs | 8px |
| Pills / Badges | 24px (full round) |
| Avatars | 50% (circle) |
| Modals / Dialogs | 16px |

## Shadows

One level only. No shadow hierarchy.

```css
--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
```

Hover state adds slight elevation:
```css
--shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.1);
```

## Icons

**Lucide React** (ships with shadcn/ui).

- Default size: 20px
- Navigation size: 24px
- Style: Stroke only, never filled
- Stroke width: 1.5px (default Lucide)
- Color: inherit from parent text color

## Components

### Buttons

| Variant | Background | Text | Border | Usage |
|---------|-----------|------|--------|-------|
| Primary | `--color-primary` | white | none | Main CTAs ("Book Session", "Find Mentor") |
| Secondary | transparent | `--color-primary` | 1px `--color-primary` | Secondary actions ("Learn More") |
| Ghost | transparent | `--color-text` | none | Tertiary actions (nav links) |
| Destructive | `--color-error` | white | none | Cancel booking, reject mentor |

- Height: 44px (touch target minimum)
- Padding: 16px 24px
- Font: 16px / 500 weight
- Press state: scale(0.98)

### Cards (Mentor Card)

```
┌─────────────────────────────────┐
│ [Timeline: Role A → Role B → C] │  ← Primary visual (NOT an avatar)
│                                   │
│ Name              Verified ✓      │
│ "Accounting → DevOps in 3 years" │  ← Transition summary
│                                   │
│ ★ 4.8 (12 sessions)  │  $50/hr  │
│                                   │
│ [        Book Session          ] │  ← Primary CTA
└─────────────────────────────────┘
```

- Background: `--color-surface`
- Border: 1px `--color-border`
- Radius: 12px
- Padding: 24px
- Shadow: `--shadow-card`
- Hover: translateY(-2px) + `--shadow-card-hover`
- Mobile: Full-width, no horizontal margins

### Timeline Component

The signature brand element. Horizontal on desktop, horizontal-scroll on mobile.

```
●─────────●─────────●─────────●
2019      2020      2022      2024
Accountant  IT Support  Cloud Eng  DevOps Lead
```

- Dots: 8px circles, `--color-accent`
- Connecting line: 1px `--color-border`, vertically centered on dots
- Labels below: `--text-small`, `--color-text-secondary`
- Roles below labels: `--text-body-medium`, `--color-text`
- Mobile: horizontal scroll with `overflow-x: auto`, `-webkit-overflow-scrolling: touch`
- Touch target on dots: 44px (invisible expanded hit area)

### Forms

- Label: always visible above input (never placeholder-as-label)
- Input height: 44px
- Border: 1px `--color-border-strong`
- Focus: 2px ring `--color-primary` with 2px offset
- Error: border turns `--color-error`, message in `--text-small` below
- Field gap: 16px

### Navigation

```
┌──────────────────────────────────────────────────┐
│ [Logo]    Browse Mentors    How It Works    Sign In │
└──────────────────────────────────────────────────┘
```

- Height: 64px
- Background: `--color-background` with bottom border 1px `--color-border`
- Logo: left-aligned
- Links: right-aligned, `--text-body-medium`
- Active page: underline 2px `--color-primary`, offset 4px below text
- Mobile: Logo + "Browse" + "Sign In" visible. Hamburger reveals full menu.
- Sticky on scroll (no hide-on-scroll behavior)

### Empty States

Always warm, always with an action.

```
┌─────────────────────────────────────────┐
│                                           │
│   No exact match for Accounting → DevOps  │
│                                           │
│   Here are mentors with similar paths:    │
│   [Adjacent mentor cards]                 │
│                                           │
│   ─── or ───                              │
│                                           │
│   Get notified when a match joins         │
│   [email input] [Notify Me]              │
│                                           │
└─────────────────────────────────────────┘
```

- Tone: Helpful, never apologetic
- Always show adjacent/alternative content
- Always include a forward-action CTA

## Page Templates

### Landing Page (Marketing)

```
[Nav]
[Hero: Pain headline + real transition example] ← 60/40 split
[Featured mentors: 2-3 cards with timelines]   ← Full-width
[Social proof: sessions count + trust signals] ← 40/60 split
[CTA: "Find Your Mentor" button]               ← Centered
[Footer]
```

### Mentor Profile

```
[Nav + Breadcrumb: Home > Mentors > Name]
[Section 1: Name + Badge + Career Timeline]    ← Full-width timeline
[Section 2: Bio + "Why I Mentor"]              ← Max-width 680px
[Section 3: Price + Cal.com embed + Book CTA]  ← Full-width embed
[Section 4: Reviews]                           ← Max-width 680px
[Footer]
```

### Mentor Listing

```
[Nav]
[Page title: "Find Your Career Match"]
[Filters: FROM + TO + Country + Price]  ← Collapsible on mobile
[Results: Stacked mentor cards]         ← Single column
[Empty state if no results]
[Footer]
```

## Accessibility

- Color contrast: minimum 4.5:1 body text, 3:1 large text (WCAG AA)
- Focus indicators: 2px `--color-primary` ring, 2px offset, visible on all interactive elements
- Touch targets: 44px minimum on all buttons, links, form controls
- Keyboard navigation: Tab order follows visual order. All interactive elements reachable.
- ARIA landmarks: `<main>`, `<nav>`, `<header>`, `<footer>` on all pages
- Form labels: Always visible text labels. No placeholder-as-label.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables transforms, keeps opacity.
- Skip link: "Skip to main content" as first focusable element

## Tailwind Configuration

Map design tokens to Tailwind classes:

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#0D9488',
          hover: '#0F766E',
          light: '#CCFBF1',
        },
        accent: {
          DEFAULT: '#D97706',
          hover: '#B45309',
          light: '#FEF3C7',
        },
        background: '#FFFBF5',
        surface: {
          DEFAULT: '#FEF7ED',
          hover: '#FDF2E3',
        },
        foreground: {
          DEFAULT: '#1C1917',
          secondary: '#78716C',
          muted: '#A8A29E',
        },
        border: {
          DEFAULT: '#E7E5E4',
          strong: '#D6D3D1',
        },
        error: '#DC2626',
        success: '#16A34A',
        info: '#0EA5E9',
      },
      borderRadius: {
        card: '12px',
        button: '8px',
        input: '8px',
        pill: '24px',
        modal: '16px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 4px 12px rgba(0, 0, 0, 0.1)',
      },
      maxWidth: {
        content: '1200px',
        prose: '680px',
      },
      spacing: {
        // Extends default Tailwind spacing with our scale
        '18': '4.5rem', // 72px
        '22': '5.5rem', // 88px
      },
      fontSize: {
        display: ['3rem', { lineHeight: '3.5rem', fontWeight: '700', letterSpacing: '-0.02em' }],
        h1: ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700', letterSpacing: '-0.02em' }],
        h2: ['1.75rem', { lineHeight: '2rem', fontWeight: '600' }],
        h3: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        body: ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }],
        small: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        tiny: ['0.75rem', { lineHeight: '1rem', fontWeight: '500' }],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'skeleton-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
      animation: {
        'fade-up': 'fade-up 200ms ease-out',
        'skeleton': 'skeleton-pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

## CSS Variables (globals.css)

```css
@layer base {
  :root {
    --font-dm-sans: 'DM Sans', sans-serif;
    
    --color-primary: #0D9488;
    --color-primary-hover: #0F766E;
    --color-primary-light: #CCFBF1;
    --color-accent: #D97706;
    --color-accent-hover: #B45309;
    --color-accent-light: #FEF3C7;
    --color-background: #FFFBF5;
    --color-surface: #FEF7ED;
    --color-surface-hover: #FDF2E3;
    --color-text: #1C1917;
    --color-text-secondary: #78716C;
    --color-text-muted: #A8A29E;
    --color-border: #E7E5E4;
    --color-border-strong: #D6D3D1;
    --color-error: #DC2626;
    --color-success: #16A34A;
    --color-info: #0EA5E9;
    
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
    --shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.1);
    
    --radius-card: 12px;
    --radius-button: 8px;
    --radius-input: 8px;
    --radius-pill: 24px;
    --radius-modal: 16px;
  }
}
```

## File Naming Conventions

- Components: `PascalCase.tsx` (e.g., `MentorCard.tsx`, `CareerTimeline.tsx`)
- Directories: `kebab-case` (e.g., `career-timeline/`, `mentor-card/`)
- Tokens/styles: `camelCase` in TypeScript, `kebab-case` in CSS
- Page components: Follow Next.js App Router conventions (`page.tsx`, `layout.tsx`)

## Component Inventory (PathSwitch-specific)

| Component | Priority | Status |
|-----------|----------|--------|
| `CareerTimeline` | P0 | To build — signature brand element |
| `MentorCard` | P0 | To build — listing + featured sections |
| `VerifiedBadge` | P0 | To build — trust signal |
| `EmptyState` | P1 | To build — warm empty states |
| `FilterPanel` | P1 | To build — search filters (collapsible mobile) |
| `ReviewCard` | P2 | To build — post-session reviews |
| `SkeletonCard` | P2 | To build — loading states |
| `PaymentStatus` | P2 | To build — 5-state payment feedback |

Existing shadcn/ui components to restyle with PathSwitch tokens:
`Button`, `Card`, `Input`, `Badge`, `Dialog`, `Select`, `Tabs`, `Toast`

---

*Generated by /design-consultation on 2026-05-21. Decisions: D1 (context confirmed), D2 (amber+teal palette), D3 (DM Sans typography), D4 (asymmetric layout + line-art decoration), D5 (direct write).*
