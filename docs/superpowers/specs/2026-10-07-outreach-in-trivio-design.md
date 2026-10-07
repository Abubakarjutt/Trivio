# Outreach in Trivio — Design

Agreed 2026-10-07 in a brainstorming session, approved section by section. This is the source of truth the implementation plan works from.

## Purpose

Bring the standalone LinkedIn outreach assistant (`~/projects/linkedin-outreach`, Python + FastAPI + SQLite) into Trivio as a built-in feature for every organisation. It helps a freelancer or small business find and warm up B2B prospects they source from Sales Navigator. It scores each prospect, drafts messages, tracks the stage and reminds them what to do next. **There is no LinkedIn automation:** Trivio never contacts LinkedIn and never sends anything. The user copies drafts and sends them by hand.

When a prospect turns into real business, they move into Trivio's existing CRM. A booked teardown becomes a `CrmLead`; a started pilot becomes a `Contact` plus a `CrmDeal`.

## Decisions

| Area | Decision |
|---|---|
| Audience | Every Trivio organisation. The user's own setup (from `seller.md`) is seeded as the first configured organisation |
| CRM relationship | A separate outreach pipeline with its own stages. `teardown_booked` creates or links a `CrmLead`; `pilot_started` creates a Contact and a `CrmDeal` in the default pipeline. One-way handoff |
| Scope | All of V1 and V2 in the first release. V3 (insights, cleanup flags) stays out |
| Gating | Available on every plan, no plan check |
| Python app | Retired and kept as the reference implementation. Its tests are the porting checklist. `seller.md` becomes the user's organisation settings |
| Approach | Full TypeScript port into Trivio's stack: Prisma models, tRPC routers, services, React/shadcn pages and Vitest tests. Drafting uses Trivio's AI settings (Ollama `gemma4:e4b` by default, Gemini when a key is set) |

## 1. Data model

Every model has `organisationId` (relation to `Organisation`, `onDelete: Cascade`) and an index that starts with it. Money is `Decimal @db.Decimal(19,4)`. One migration: `add_outreach`.

Enums:
- `OutreachStage`: `QUEUED, REQUEST_SENT, CONNECTED, VALUE_SENT, ENGAGED, TEARDOWN, PILOT, WON, LOST, NURTURE, DNC`
- `OutreachDraftKind`: `CONNECTION_NOTE, VALUE_MESSAGE, REPLY`. Today's action types (`light_touch`, `second_value`, `follow_up`, `nurture_touch`, …) are not draft kinds; `today.ts` maps them to one, as `outreach/today.py` does (for example `second_value` uses `VALUE_MESSAGE`).
- `OutreachDocKind`: `TEARDOWN_PREP, PROPOSAL`

Signals are a fixed set in code: `hiring, pain_post, funding, demo_stage, warm_path, stack_match`. Weights are set per organisation.

| Model | Fields | Notes |
|---|---|---|
| `OutreachSettings` | `organisationId @unique`, `sellerProfile` (Markdown text), `signalWeights` (Json, `{signal: int}`), `dailyCap` (20), `weeklyCap` (100), `cadence` (Json, days: requestWithin 2, withdrawAfter 21, lightTouch 5, secondValue 7, nurtureEvery 30, teardownFollowUp 3) | One row per organisation. No row means the feature isn't set up yet (first-run card). Default weights: hiring 3, pain_post 3, funding 2, demo_stage 2, warm_path 2, stack_match 1 |
| `OutreachOffer` | `name`, `description`, `price Decimal(19,4)?`, `fittingSignals String[]`, `archived Boolean` | Replaces the hard-coded pilots and the `OUTREACH_PRICE_*` settings. If `price` is empty, proposals show `[price]` |
| `OutreachProspect` | `profileUrl` (normalised), `name`, `title`, `company`, `companyWebsite?`, `companySize?`, `location?`, `profileText`, `stack String[]`, `signals Json` (`[{name, evidence}]`), `score Int`, `primarySignal?`, `scoreReasons String[]`, `enrichmentStatus`, `stage OutreachStage`, `stageChangedAt`, `unansweredCount`, `lightTouchDone`, `awaitingReply`, `lastMessageAt?`, `lastReplyAt?`, `lastTouchAt?`, `source`, `crmLeadId? @unique`, `crmDealId? @unique` | `@@unique([organisationId, profileUrl])`. Adding a URL that's already there updates the existing prospect and records a `refreshed` event. CRM links use `onDelete: SetNull` |
| `OutreachEvent` | `prospectId?`, `kind`, `at`, `meta Json` | Append-only log. `prospectId` is set to null when the prospect is deleted. `meta` never holds personal data (scores, signal names and stage names only) |
| `OutreachDraft` | `prospectId`, `kind OutreachDraftKind`, `variant` (`A`/`B`), `body`, `violations String[]` | Regenerating replaces the drafts of that kind. Cascades with the prospect |
| `OutreachConversation` | `prospectId`, `thread` (text), `analysis Json` | The latest pasted thread per prospect. Cascades |
| `OutreachDoc` | `prospectId`, `kind OutreachDocKind`, `body Json` | One per kind per prospect. Cascades |
| `OutreachVoiceExample` | `prospectId?`, `body` | What the user actually sent, with the prospect's name replaced by "X". `prospectId` is set to null on delete, so the anonymised text survives |
| `OutreachDnc` | `profileUrl`, `addedAt`, `reason` | `@@unique([organisationId, profileUrl])`. Checked before any prospect is saved |

**Deleting a prospect** removes the prospect, its drafts, conversation and docs. Its URL stays in `OutreachDnc` with the reason "deleted on request". A `deleted` event is recorded with no prospect reference.

**Seed:** `scripts/seed-outreach.ts --org <id> --seller <path to seller.md>` creates `OutreachSettings` (the profile Markdown and default weights) plus the two offers (RAG Audit + Eval Harness, Agent Reliability Sprint) with no prices. It copies the bullets under "Voice examples" in `seller.md` into `OutreachVoiceExample`. It can be run again safely: it updates the settings and skips offers and examples that already exist.

## 2. AI layer

All files below are in `server/services/outreach/`.

**`llm.ts`: one function, `generateJson<T>(schema: ZodType<T>, prompt, { creative })`**
- Picks the provider with `resolveProvider()` from `server/services/ai-status.ts`, and the model and host with `ollamaModel`, `ollamaHost` and `geminiModel`. Outreach always uses the organisation's AI setup.
- Ollama: `POST {host}/api/chat`, `stream: false`, `format: <JSON Schema>`, `options.temperature`.
- Gemini: `generateContent` with `generationConfig.responseMimeType: "application/json"` and `responseSchema`, called with plain `fetch` like the other Gemini services in Trivio.
- The JSON Schema comes from the zod schema through **`zod-to-json-schema`**, the one new dependency.
- Every reply goes through `schema.parse()`. If it fails, one retry, then an `OutreachAiError` with a message the user can read. No mock fallback and no regex pulling JSON out of free text.
- Temperature is 0 when `creative` is false (extraction, conversation analysis) and 0.7 when it's true (drafts, teardown prep, proposals).

**Pure modules ported from the Python app** (no I/O, tested directly):
- `rules.ts`: the draft rule checker. Connection note: at most 300 characters, no links. Value message: at most 80 words, at most 1 link, ends with a question. Reply: at most 100 words, at most 1 link. For every kind: the banned phrases ("hope this finds you well", "came across your profile", "synergy", "quick call"), no exclamation marks, no emojis, and no `$` (a message must never mention a price). Messages match `outreach/rules.py` word for word.
- `scoring.ts`: score is the sum of the organisation's weights for the signals present. The primary signal is the highest-weight one. Produces the reasons as `"name (+w): evidence"`.
- `pipeline.ts`: `RULES`, `transition()` and `eventsFor()` exactly as in `outreach/pipeline.py`, including `MAX_UNANSWERED = 2`.
- `today.ts`: buckets and due dates from the organisation's cadence settings.
- `caps.ts`: daily and weekly counts from `OutreachEvent`.
- `urls.ts`: normalising profile URLs.
- `voice.ts`: anonymising names.
- `prompts.ts`: builds each prompt from `OutreachSettings.sellerProfile`, the 8 most recent voice examples and the fields the task needs.

**Prices** are inserted into proposals by code from `OutreachOffer.price`, formatted in the organisation's currency, and never by the model.

**`website.ts`: website check**
- Fetches only the prospect's own `companyWebsite` and its careers page.
- Refuses `linkedin.com`, `*.linkedin.com` and `lnkd.in` before resolving the name.
- Resolves the name, refuses anything that isn't a public address (private, loopback, link-local, CGNAT, multicast, unspecified, IPv6 ULA and IPv4-mapped forms), then **connects to the checked IP** with the original `Host` header and TLS server name. This closes the DNS race the Python version had.
- Follows at most 3 redirects, checking each one again. 1 MB response cap, 8-second timeout, text and HTML only.
- A failure doesn't block saving: the prospect gets the matching `enrichmentStatus` and is scored from the pasted text alone.

**User confirmation (Trivio's rule that AI output needs confirming)**
- Extracted prospect fields appear in an editable form; nothing is saved until the user confirms.
- Stage changes suggested from a conversation do nothing until the user clicks **Apply**. Suggestions not allowed from the current stage (applied in order) are dropped before they're shown.
- Drafts, teardown prep and proposals are saved straight away. They're only text for the user to copy and they change no state.

**AI not ready:** if `ai-status` reports no working provider, AI buttons are disabled and Trivio's existing "AI not ready" notice is shown. Adding a prospect by hand (filling the fields and signals yourself), logging events and the whole pipeline still work.

## 3. Screens and navigation

A new **"Outreach"** group in `app/(app)/_components/sidebar.tsx`, right after CRM: Today (`/outreach`, exact match), Prospects, Voice. Pages live in `app/(app)/outreach/`.

| Route | Content |
|---|---|
| `/outreach` (Today) | Buckets in this order: replies waiting, teardowns and pilots, new connections, follow-ups, new requests, housekeeping. Only buckets with items are shown; empty ones are listed on one "idle" line, with an empty state when all are empty. A cap meter at the top. Each card shows the score chip, who and what's next, the reason tag, drafts with Copy, **Mark done** (with an optional "what you actually sent" box that saves a voice example), Generate/Regenerate, and Open in Sales Navigator. A gear button opens settings |
| `/outreach/prospects` | Table: score, name and company, stage badge, primary signal. Filter by stage. The whole row opens the prospect |
| `/outreach/prospects/new` | Profile URL and pasted profile text, then **Extract**, then an editable review form (fields, signals with evidence, website check result), then **Save prospect**. Without AI, the same form is filled in by hand |
| `/outreach/prospects/[id]` | Main column: next-step strip; drafts for each kind ("Not drafted yet" hint); conversation paste with analysis, suggested events, **Apply** and reply drafts, plus a prominent Do-not-contact button when the analysis flags an opt-out; teardown prep (on engaged, teardown and pilot); proposal with a "what you learned on the call" box and offer picker (on teardown and pilot). Side column: Why this score; Log what happened (only `eventsFor(stage)`); CRM card (Section 4); Privacy (DNC, Delete with a confirm dialog) |
| `/outreach/voice` | Voice examples, newest first, with delete |
| `/outreach/settings` | Tabs: Seller profile (Markdown), Offers (create, edit, archive; price), Signal weights, Limits and timing. Also linked from an Outreach card on the main Settings page |

**UI conventions:** copy the existing CRM pages. Use `page-header.tsx`, shadcn `Card`/`Table`/`Badge`/`Tabs`/`Textarea`/`Dialog` (delete confirmation only), lucide icons and Trivio's theme tokens. The Python CSS isn't carried over; only the information layout is. Mutations go through tRPC with React Query and invalidate only the affected query.

- Loading shows skeletons shaped like the content. AI buttons show a busy label ("Drafting…") and disable while running.
- Errors appear inline in the section that failed, with the `OutreachAiError` message.
- **First run:** with no `OutreachSettings` row, every Outreach page shows a setup card (seller profile and one offer). Saving it opens Today.
- **Sales Navigator links** open in the system browser through Trivio's existing external-link handling (`shell.openExternal` in the desktop app). Trivio never loads LinkedIn inside the app.

## 4. CRM handoff

The handoff goes one way, outreach to CRM, in `server/services/outreach/crm-handoff.ts`. It reuses `convertLeadToContact` from `server/services/crm.service.ts`, which needs a `QUALIFIED` lead and creates a Contact and a deal in the first stage of the default (or first) pipeline in one transaction.

**On `teardown_booked`, link or create a `CrmLead`**, in the same transaction as the stage change:
- If `prospect.crmLeadId` is already set, do nothing.
- Otherwise look for a `CrmLead` in the organisation with the same first name, last name and companyName. If found, link it.
- Otherwise create one: names split from `prospect.name` (the first word is the first name, the rest is the last name, empty if there's only one word), `companyName`, `jobTitle`, `source: COLD_OUTREACH`, `status: CONTACTED`, and notes "Added from Outreach. Primary signal: ‹signal›, score ‹n›."
- Store `prospect.crmLeadId`.

**On `pilot_started`, create the Contact and Deal.** This runs after the stage change has committed:
1. If there's no linked lead, create one as above.
2. Set the lead to `QUALIFIED` and call `convertLeadToContact`.
3. Update the deal it created: name "‹Offer name› — ‹Company›" (the offer on the latest proposal, or "Pilot" if there's none), `value` from that offer's `price` (Decimal, 0 if empty), `source: "Outreach"`.
4. Add a `CrmActivity` NOTE "Pilot started via Outreach", linked to the deal and the contact, `createdById` = the current user.
5. Store `prospect.crmDealId`.

If step 2 fails (no pipeline with stages, or anything else), the stage change is kept. The prospect's CRM card shows the reason ("Not in CRM yet: create a pipeline first" for a missing pipeline), a link to Settings → Pipelines and a **Retry** button (`retryCrmHandoff`). Retrying is safe to repeat: steps whose ids are already stored are skipped, and a lead that's already `CONVERTED` with no stored deal id is reported instead of converted twice.

**After the handoff the CRM owns the deal.** Outreach never moves or closes a `CrmDeal`. Logging `won`/`lost` in outreach updates only outreach's funnel; with a linked deal, the card says "Update the deal in CRM →".

**CRM card:** shows the linked lead or deal with a link to it, or "Will be added to CRM when a teardown is booked".

**Deleting a prospect or marking it do-not-contact** leaves CRM records alone: they're business records and may be invoiced. When records are linked, the confirm dialog or notice says so and links to them, so the user can erase them by hand if needed.

**Scoping:** every lookup and write filters by `ctx.organisationId`. `assertOwnCrmRefs` checks ids that come from other tables before they're linked.

## 5. Safety, privacy and testing

**Rules**
- **No LinkedIn automation.** The server never sends a request to a LinkedIn host. The only LinkedIn links are Sales Navigator links that the user clicks.
- **Nothing is sent for the user.** No email, message or scheduled send. Mark done only records what the user did.
- **Caps** are a warning shown on Today and on the request action, not a hard stop.
- **Do-not-contact:** URLs are normalised, then checked against `OutreachDnc` before any save. A URL on the list can't be added again, including after deletion.

**Privacy**
- Data lives in Trivio's Postgres (the embedded database on desktop) and is covered by Trivio's existing backups.
- Only the text a task needs is sent to the AI. With Ollama nothing leaves the machine. With Gemini, Outreach settings show "Prospect text is sent to Google Gemini".
- `OutreachEvent.meta` never holds personal data.
- Voice examples are anonymised before saving.
- Deletion works as in Section 1.

**Security**
- All routers use `orgProcedure`. Inputs are validated with zod. Pasted text is limited to 50 KB per field and never rendered as HTML.
- The website check is hardened as in Section 2.

**Routers** (`server/routers/outreach*.ts`, registered in the app router):
- `outreachSettings`: get, upsert, offers CRUD
- `outreachProspects`: list, get, extract, create, update, logEvent, applySuggestions, markDnc, delete, retryCrmHandoff
- `outreachDrafts`: generate, list
- `outreachDocs`: analyseConversation, teardown, proposal
- `outreachToday`: buckets and caps
- `outreachVoice`: list, delete

**Testing** (Vitest, `tests/unit/outreach/`, using a `vi.fn()` database the way `tests/unit/chat-actions.test.ts` does):
1. **Pure modules:** port each Python test in `linkedin-outreach/tests/` case by case. Every test gets a TypeScript twin, or a line in the plan saying why it doesn't apply (for example the SQLite-specific `test_db.py`, or the HTTP-layer tests in `test_web.py`, which the router tests replace).
2. **AI layer** with a fake `fetch`: the schema reaches Ollama as `format` and Gemini as `responseSchema`; one retry when a reply fails the schema check, then `OutreachAiError`; provider picked through `ai-status`.
3. **Routers and handoff:** every query filters by organisation; a DNC URL is blocked; delete keeps the URL on the DNC list and sets the event's prospect to null; a booked teardown creates the lead or links an existing one; a started pilot converts the lead and sets the deal value from the offer; with no pipeline the stage still changes and a retry later completes the handoff.
4. **Website guard:** refuses private, loopback, link-local and IPv4-mapped IPv6 addresses, LinkedIn hosts and redirects to private addresses; connects to the checked IP.
5. **Done means:** `npm run test` and `npm run typecheck` pass, plus a manual walkthrough in the desktop app with the gstack `/browse` skill (Trivio's `CLAUDE.md` rules out claude-in-chrome).

## Out of scope

- V3 insights and the 12-month cleanup flag.
- Team features (assigning prospects to users, sharing between users).
- Plan gating.
- Importing the Python app's SQLite data (only `seller.md` is imported, through the seed script).
- Any two-way sync with the CRM.
