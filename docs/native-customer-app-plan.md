# Native Customer App — Web Parity Plan

> **Status (1 Aug 2026):** Phases 0–3 implemented on `soroman_frontend_new` branch `feat/native-parity` and smoke-tested in the iOS Simulator against the local backend (session restore, live catalog, dashboard, orders list/detail with dedicated account + timeline, prices board, account screen, order wizard). Remaining: Phase 4 (Dangote), Phase 5 (LPG), Phase 6 (push + release), plus profile/security edit forms and universal links.

Bring `apps/native` (Expo SDK 57, React Native 0.86, React 19.2) to full feature parity with the customer web portal (`apps/web`), using Expo Router for navigation and `@expo/ui` (SwiftUI on iOS, Jetpack Compose on Android) for native UI.

**Where things stand today**

- `apps/native` already exists on the latest SDK with `expo-router ~57`, `@expo/ui ~57.0.1`, `@tanstack/react-query`, `expo-secure-store`, `react-native-worklets`, and Reanimated 4 installed.
- Built so far: onboarding, `(auth)` login/register/forgot-password screens, `(app)/(tabs)/(index,orders,account)` shared tab group, a 4-step order wizard (`components/order/*`), and `lib/session.tsx`.
- Almost none of it talks to the real backend — `lib/mock-catalog.ts` feeds the wizard, and the tabs render mock data.
- The backend customer API (`/api/customer/*`, `/api/catalog`, `/api/tracking/:ref`) is complete and already supports native token transport (`X-Auth-Transport: body`).

**Guiding rules** (from the Expo skills)

- Keep the existing `app/` layout convention (routes only in `app/`, screen bodies and components in sibling folders); do not restructure to `src/`.
- `@expo/ui` universal components first (`Host`, `Column`, `Row`, `List`, `FieldGroup`, `Picker`, `Switch`, `BottomSheet`, `TextInput` + `useNativeState`); drop to `@expo/ui/swift-ui` / `jetpack-compose` only when universal lacks something, isolated in `.ios.tsx`/`.android.tsx` under `components/`.
- `NativeTabs` from `expo-router/unstable-native-tabs`; native `Stack` with large titles; modals via `presentation: "modal"` and pickers/confirmations via `presentation: "formSheet"` (transparent content style for liquid glass on iOS 26).
- Semantic colors via `Color` from `expo-router` centralized in `theme/colors.ts` (`Color.ios.*` / `Color.android.dynamic.*` + web hex fallback).
- SF Symbols via `expo-image` `source="sf:name"`; `expo-haptics` on meaningful state changes; every stack route starts with `<ScrollView contentInsetAdjustmentBehavior="automatic">`.
- Networking with `expo/fetch` + TanStack Query (no axios); tokens in `expo-secure-store`; `EXPO_PUBLIC_SERVER_URL` via `packages/env/src/native.ts`.
- Develop in Expo Go / the existing dev client; no new native modules are required for parity.

---

## Libraries by phase

✅ = already in `apps/native/package.json` · ➕ = needs installing (`bunx expo install …` so versions match SDK 57)

### Used everywhere (Phases 0–6)

| Library | Purpose | Link |
|---|---|---|
| ✅ `expo` (SDK 57) | Framework runtime | https://docs.expo.dev/versions/latest/ |
| ✅ `expo-router` | File-based navigation, `NativeTabs`, `Stack`, semantic `Color` | https://docs.expo.dev/router/introduction/ |
| ✅ `@expo/ui` | Native UI — SwiftUI (iOS) / Jetpack Compose (Android): `Host`, `List`, `FieldGroup`, `Picker`, `Switch`, `BottomSheet`, `TextInput` | https://docs.expo.dev/versions/latest/sdk/ui/universal/ |
| ✅ `@tanstack/react-query` | Server state: queries, mutations, polling, infinite lists | https://tanstack.com/query/latest |
| ✅ `zod` | Schema validation (shared contract with web) | https://zod.dev |
| ✅ `react-native-reanimated` + `react-native-worklets` | Animations; worklets also power `@expo/ui` `useNativeState` inputs | https://docs.swmansion.com/react-native-reanimated/ |
| ✅ `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler` | Native navigation primitives | https://docs.expo.dev/versions/latest/sdk/screens/ |
| ➕ `expo-image` | Images + SF Symbols (`source="sf:…"`) | https://docs.expo.dev/versions/latest/sdk/image/ |
| ➕ `expo-haptics` | Haptic feedback on payments/stage changes | https://docs.expo.dev/versions/latest/sdk/haptics/ |

### Phase 0 — Foundation

| Library | Purpose | Link |
|---|---|---|
| ✅ `expo/fetch` (built into `expo`) | WinterCG-compliant HTTP client — no axios | https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api |
| ✅ `expo-secure-store` | Refresh token + device token (Keychain/Keystore) | https://docs.expo.dev/versions/latest/sdk/securestore/ |
| ✅ `expo-network` | Offline detection for friendly error states | https://docs.expo.dev/versions/latest/sdk/network/ |
| ➕ `expo-sqlite` (`expo-sqlite/kv-store`) | AsyncStorage-compatible KV store for drafts, preferences, resume pointers | https://docs.expo.dev/versions/latest/sdk/sqlite/#key-value-storage |
| ✅ `@sorooman-customer/env` (`@t3-oss/env-core`) | Typed `EXPO_PUBLIC_*` env | https://env.t3.gg |

### Phase 1 — Auth

| Library | Purpose | Link |
|---|---|---|
| ➕ `libphonenumber-js` | Phone parsing/formatting (same as web `lib/phone.ts`) | https://www.npmjs.com/package/libphonenumber-js |
| ➕ `expo-local-authentication` | Optional Face ID / fingerprint gate on PIN login | https://docs.expo.dev/versions/latest/sdk/local-authentication/ |
| ✅ `expo-crypto` | Random device-name/nonce generation | https://docs.expo.dev/versions/latest/sdk/crypto/ |
| RN core `TextInput` `textContentType="oneTimeCode"` | iOS SMS OTP autofill (no lib needed) | https://reactnative.dev/docs/textinput#textcontenttype-ios |

### Phase 2 — Order wizard

| Library | Purpose | Link |
|---|---|---|
| ➕ `@tanstack/react-form` | Wizard form state + Zod adapter (monorepo standard) | https://tanstack.com/form/latest |
| ➕ `expo-sqlite/kv-store` | Order draft persistence (from Phase 0) | https://docs.expo.dev/versions/latest/sdk/sqlite/#key-value-storage |
| ✅ `expo-linking` | `?depot=` deep links into the wizard | https://docs.expo.dev/versions/latest/sdk/linking/ |
| RN core `AppState` | Pause/resume the 8 s payment poll in background | https://reactnative.dev/docs/appstate |

### Phase 3 — Dashboard, orders, tracking, account

| Library | Purpose | Link |
|---|---|---|
| ➕ `@shopify/flash-list` | Order history list (perf; `@expo/ui` `List` is JS-thread-bound) | https://shopify.github.io/flash-list/ |
| ➕ `expo-clipboard` | Copy-row for account numbers / references | https://docs.expo.dev/versions/latest/sdk/clipboard/ |
| ➕ `react-native-svg` | Spend sparkline on Home | https://docs.expo.dev/versions/latest/sdk/svg/ |
| RN core `Share` | Share public tracking link | https://reactnative.dev/docs/share |
| ✅ `expo-linking` + app config | Universal/App Links for `https://…/t/REF` | https://docs.expo.dev/linking/android-app-links/ · https://docs.expo.dev/linking/ios-universal-links/ |
| ✅ `expo-web-browser` | Open FAQ/contact/terms without leaving the app | https://docs.expo.dev/versions/latest/sdk/webbrowser/ |

### Phase 4 — Dangote Delivery

| Library | Purpose | Link |
|---|---|---|
| ➕ `expo-document-picker` | Pick the DPR/NUPRC license PDF | https://docs.expo.dev/versions/latest/sdk/document-picker/ |
| ➕ `expo-image-picker` | License as JPG/PNG from camera/library | https://docs.expo.dev/versions/latest/sdk/imagepicker/ |
| ➕ `expo-file-system` | Download/cache signed documents & agreements | https://docs.expo.dev/versions/latest/sdk/filesystem/ |
| ➕ `expo-sharing` | Open/share downloaded documents | https://docs.expo.dev/versions/latest/sdk/sharing/ |
| `FormData` via `expo/fetch` | Multipart upload (no extra lib) | https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api |

### Phase 5 — Cooking gas (LPG)

No new libraries — reuses the wizard stack (TanStack Form, kv-store, `@expo/ui`) behind a swappable API module.

### Phase 6 — Native extras + release

| Library | Purpose | Link |
|---|---|---|
| ➕ `expo-notifications` | Push registration + display (client) | https://docs.expo.dev/versions/latest/sdk/notifications/ |
| ➕ `expo-server-sdk` (backend, Node) | Send Expo push from the event bus | https://github.com/expo/expo-server-sdk-node |
| ➕ `expo-quick-actions` | Home-screen shortcuts (New order, Track) | https://github.com/EvanBacon/expo-quick-actions |
| ➕ `expo-local-authentication` | (from Phase 1) biometric candidates: passkeys prep | https://docs.expo.dev/versions/latest/sdk/local-authentication/ |
| ➕ `expo-apple-authentication` | Apple sign-in (if social login ships — App Store requirement) | https://docs.expo.dev/versions/latest/sdk/apple-authentication/ |
| EAS CLI (`eas-cli`) | Build / Submit / Update pipelines | https://docs.expo.dev/eas/ |
| ✅ `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `expo-font`, `@expo/vector-icons` | App shell polish (already installed) | https://docs.expo.dev/versions/latest/sdk/splash-screen/ |

Deliberately **not** used: axios (`expo/fetch` instead), Redux/Zustand (React Query + small stores), `@react-native-async-storage/async-storage` (superseded by `expo-sqlite/kv-store`), react-native-paper / NativeBase / Tamagui (`@expo/ui` renders real SwiftUI/Compose instead of imitations).

---

## Phase 0 — Foundation: real API client, session, theme

The single prerequisite for everything else.

### 0.1 HTTP client (`lib/http.ts`)

Port `apps/web/src/lib/http.ts` semantics to native transport:

- Access token: JWT, 15 min, **in-memory only**, sent as `Authorization: Bearer`.
- Refresh token: stored in `expo-secure-store` (never AsyncStorage), sent in the body with header `X-Auth-Transport: body` — the backend already supports this; no cookies, **no CSRF needed** on native.
- Single-flight refresh on 401 (serialize exactly like the web `refreshInFlight` — parallel refreshes look like token theft and revoke all sessions), one retry per request.
- Device token (trusted-device proof for PIN login and password step-up skip): `expo-secure-store`, mirroring web's `soroman.device`.
- Typed `ApiError` with status/code; offline detection via `expo-network` for friendly error states.

### 0.2 API layer (`lib/api/`)

The web `apps/web/src/lib/api.ts` is the contract source of truth (endpoints, `ORDER_STATUS`, `TRUCK_CAPACITY_LITRES`, tracking stages, Zod schemas). Two options:

- **Preferred:** extract the transport-agnostic parts (types, Zod schemas, endpoint paths, status maps, formatting helpers) into `packages/api` consumed by both `apps/web` and `apps/native`, each injecting its own `http` implementation.
- Fallback: copy into `apps/native/lib/api/` and keep in lockstep manually.

Wire TanStack Query provider in `app/_layout.tsx` (staleTime 30 s, no retry on 401 — same defaults as web).

### 0.3 Session store (`lib/session.tsx` rewrite)

- `ensureBootstrapped()` on app start: attempt refresh from SecureStore, then render `(auth)` or `(app)` group accordingly (guard in `app/_layout.tsx` / `(app)/_layout.tsx`).
- Logout → `POST /api/customer/auth/logout` then local clear.

### 0.4 Theme + design primitives

- `theme/colors.ts` with `Color.ios.*` / `Color.android.dynamic.*` per the palette pattern; delete ad-hoc color values in `lib/use-theme.ts` or make it delegate to the palette.
- Shared primitives in `components/ui/`: status chip (order/truck/Dangote statuses with tone colors), amount text (`fontVariant: tabular-nums`, ₦ formatting, `selectable`), copy-row (tap to copy + haptic + toast), empty/error/loading states, section card.
- Replace `lib/mock-catalog.ts` with `useCatalog()` over public `GET /api/catalog` (React Query, shared with the price screens).

**Exit criteria:** app boots, restores a session from SecureStore, and renders the live catalog.

---

## Phase 1 — Auth parity

Match the web's three sign-in methods and phone-first registration exactly (`docs/CUSTOMER_AUTH.md`).

| Flow | Endpoints | Native UI |
|---|---|---|
| Register (3 steps: details → OTP → optional PIN) | `POST /register`, `POST /verify-otp`, `POST /pin` | Stack of form-sheet-style steps; `FieldGroup` + `@expo/ui` `TextInput` with `useNativeState`; 6-digit OTP boxes with `textContentType="oneTimeCode"` (iOS SMS autofill) / Android SMS Retriever; 60 s resend cooldown; dev-code hint in dev builds |
| Phone OTP login | `POST /request-otp`, `POST /verify-otp` | Same OTP component; "trust this device" `Switch` → stores device token |
| PIN login (trusted device) | `POST /login/pin` | Offered first when a device token exists; native number pad; **optional native win:** gate PIN autofill behind Face ID/Touch ID via `expo-local-authentication` |
| Email + password (+ step-up) | `POST /login/password`, `POST /login/password/verify` | Handle `stepUpRequired: true` → OTP sheet |
| Forgot password | none | Explainer screen routing to phone OTP (exists; keep) |

Notes:

- Phone input: reuse `libphonenumber-js` formatting from web (`lib/phone.ts`) in the shared package.
- **Backend coordination item:** register verifies Cloudflare Turnstile in production. Turnstile is a web widget — native needs either an exemption for `X-Auth-Transport: body` clients, or app attestation (DeviceCheck/Play Integrity) later. Flag before shipping; nothing to build client-side for now.
- Google/Apple sign-in and passkeys exist server-side but are not in the web UI either — out of parity scope (listed in Phase 6 as candidates, Apple sign-in matters for App Store review if any social login ships).

**Exit criteria:** all three login methods + registration work against the real backend; session survives app restarts; logout works.

---

## Phase 2 — PMS/AGO order wizard (the money path)

The wizard skeleton exists (`components/order/{stepper,order-step,loading-step,verify-step,invoice-step}.tsx`); rewire every step to the real API and web business rules.

1. **Order step** — depot + per-product quantity from live catalog. Depot picker as a form sheet (`presentation: "formSheet"`, detents `[0.5, 1.0]`); quantities with unit formatting; live line totals.
2. **Loading step** — pickup vs delivery segmented control. Pickup: per-truck plate + litres split, enforcing the 60,000 L tanker cap and exact-sum rule (`TRUCK_CAPACITY_LITRES`). Delivery: state `Picker` + address field.
3. **Verify step** — phone OTP gate that doubles as account creation (same `request-otp`/`verify-otp` components as Phase 1); skipped when already signed in.
4. **Invoice step** — `POST /api/customer/orders` (one order per cart line, presented as one invoice), dedicated virtual account panel with copy-all, **1-hour price-lock countdown** with re-quote on expiry, and payment watcher polling `GET /api/customer/orders/:id` every 8 s (port `watchCredits`; pause on background via AppState, resume on foreground). Success → haptic + confetti-free native transition to the order detail.
5. **Draft persistence** — port `lib/order-draft.ts` to `expo-sqlite/kv-store` (drafts are not secrets); resume on relaunch; support `?depot=` param for deep links from the price board.
6. Product front door (parity with `/order/new`): four tiles — PMS, AGO, Dangote Delivery, Cooking gas — each with a live "from ₦X/unit" hint from the catalog (Dangote tiles from `GET /api/catalog/dangote-products`, which the web doesn't use yet — the native app should).

Dev-only: `simulate-payment` button gated by env flag, mirroring `VITE_ENABLE_DEV_PAYMENT`.

**Exit criteria:** end-to-end real order placed from the app, paid via simulated transfer in dev, status flips without manual refresh.

---

## Phase 3 — Signed-in dashboard: tabs, orders, tracking, account

### 3.1 Tab structure

Extend the existing shared group to four `NativeTabs` triggers, each an SF Symbol/Material icon pair:

```
app/(app)/(tabs)/(home,orders,prices,account)/
  _layout.tsx        — shared Stack (large titles, per-segment title)
  home.tsx           — overview
  orders.tsx         — order history
  prices.tsx         — depot price board
  account.tsx        — profile + settings
  orders/[ref].tsx   — order detail (pushable from any tab via the shared group)
  dangote/…          — Phase 4 screens
```

A prominent "New order" button lives in the Home hero and as a toolbar button on Orders (web's sidebar CTA equivalent). Consider `Stack.SearchBar` on Orders for reference search.

### 3.2 Home (overview — parity with `/dashboard`)

- Greeting header + New order CTA.
- Adaptive hero card for the most urgent order (unpaid → virtual account shortcut; in motion → stage).
- Wallet card with dedicated account (3 states: complete-profile → assigning → copyable).
- Reorder chips; month stats + spend sparkline (Reanimated or lightweight SVG); prices snapshot; recent orders.
- Data: `GET /api/customer/dashboard`; poll 10 s while any order is `awaiting_payment` (refetchInterval conditional), pause when backgrounded.

### 3.3 Orders list + detail

- List: filter tabs (All / In motion / Completed / Cancelled) as native segmented control; `FlatList` + `useInfiniteQuery` over `GET /api/customer/orders?page…` (25/page); pull-to-refresh; rows via `Link` with `Link.Preview` and a context menu (Track live / Reorder / Copy reference).
- Detail (`by-ref/:ref`): priced summary, 6-stage progress timeline, payment panel when unpaid, truck panel with **editable pickup truck declaration** (`PATCH …/trucks`) while loads are pending — edit in a form sheet, Reorder + Track live actions, share sheet (`expo-sharing` / native Share) for the public tracking link.

### 3.4 Public tracking (parity with `/t/$ref`)

- `app/track/[ref].tsx` outside the authed group — works signed out.
- Plain-language headline, 6-stage timeline with timestamps, truck pills, not-found state with re-search.
- **Deep links:** configure the app scheme + Android App Links / iOS Universal Links so `https://<site>/t/REF` opens this screen; `GET /app` store-redirect already exists backend-side for the landing page's app promo.

### 3.5 Prices

Reuse the catalog query: depot × product matrix (state filter, best price highlighted, per-row "Order" deep link into the wizard with `?depot=`). Native rendering as grouped `List` sections per state rather than a wide table.

### 3.6 Account tab

- **Profile:** read-as-record with inline edit (name / company / email) → `PATCH /api/customer/profile`.
- **Payments:** permanent Paystack dedicated account panel (same 3 states, copy-all rows).
- **Preferences:** default depot + default loading method — keep device-local (kv-store) like web's localStorage; note the shared gap (no server-side settings endpoint) and leave a TODO to sync when one exists.
- **Security:** sign-in methods from `GET /auth/identities` — phone verified chip, set/change PIN, add email+password, change password (`POST /auth/password`, `POST /auth/pin`).
- **Devices & sessions:** the web panel is written but disabled; the endpoints (`GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/devices/:id`, `POST /auth/logout-all`) are live. On native this matters more (that's where trusted devices come from) — build it: grouped `List` of sessions with revoke swipe actions, "Sign out everywhere" destructive button.
- Sign out; app version footer; links to FAQ/contact (in-app screens or `expo-web-browser`).

**Exit criteria:** a customer can live entirely in the app: place, pay, track, edit trucks, reorder, manage profile/security.

---

## Phase 4 — Dangote Delivery (wire to the REAL backend)

The web app runs Dangote on a localStorage mock, but the backend is fully implemented (`routes/portal/dangoteDelivery.route.js`). **The native app should skip the mock entirely and be the first client on the real API.** Endpoint names differ from the web mock (`/agreement` not `/generate-agreement`, etc.) — use the backend routes as truth.

1. **Wizard** (3 steps, resumable):
   - Details — product from `GET /api/catalog/dangote-products` (PMS/AGO/LPG with units from the DB), quantity, delivery address + state, contact person/phone → `POST /api/customer/dangote-delivery-orders`, `PATCH` for edits.
   - Company + documents — company name (with reuse via `GET …/reusable-company`), **DPR/NUPRC license upload**: `expo-document-picker` (PDF) + `expo-image-picker` (JPG/PNG), ≤10 MB client-checked, multipart to `POST …/:id/documents`, reuse via `POST …/documents/reuse`, then `POST …/documents/submit`. Terms (`GET /terms`) + e-signature acceptance → `POST …/:id/agreement`.
   - Review → `POST …/:id/submit` → submitted panel.
   - Resume pointer in the kv-store (parity with web's draft pointer).
2. **List + detail** under the dashboard: status timeline (UNDER_REVIEW → APPROVED → PAID → SCHEDULED → DISPATCHED → COMPLETED), documents panel with download, signed agreement view, and exactly one contextual action — **pay the approved quote** (virtual-account transfer + same payment watcher) or **reopen after NEEDS_CHANGES** (`POST …/:id/reopen`); cancel where allowed.
3. Poll detail at a modest interval while in review/payment states (backend is real here — 15–30 s, not the web mock's 4 s).
4. **"My documents"** section in Account backed by the customer license register (`GET/POST/DELETE /api/customer/licenses`) — backend-only today, and it's what makes document reuse work across orders. Small screen, high leverage.

**Exit criteria:** full Dangote request lifecycle from the app against staging, including a document upload and a quote payment.

---

## Phase 5 — Cooking gas (LPG)

**The backend does not exist** (only `docs/lpg-home-delivery-plan.md`). To keep parity with what customers see on web:

- Build the 3-step wizard (cylinder sizes + qty → saved address, empties-returned, deposit → review) and list/tracker screens against an `api` interface with the same signatures the mock documents (`/lpg/cylinder-sizes`, `/lpg/addresses`, `/lpg/orders`, `/lpg/orders/:id/cancel`), backed initially by a device-local mock module — one file swap when the backend lands.
- **Do not ship the web's "Advance status (demo)" button** — it's a customer-visible admin control; dev-build only.
- Alternatively (recommended if store release is near): hide the LPG tile behind a feature flag until the backend exists, rather than shipping a fake flow to real users.

---

## Phase 6 — Native-only value + release engineering

Things the app can do that the web can't, plus shipping.

1. **Push notifications** — the biggest native win, but **greenfield on the backend** (no FCM/APNs/socket/SSE exists; customers get SMS/WhatsApp today). Client: `expo-notifications` token registration + a `POST /api/customer/push-tokens` endpoint; server: subscribe a push consumer to the existing event bus (`services/events.js`) next to `notification.service.js` for payment-confirmed, order-stage, and `dangote_delivery.status_changed` events via `expo-server-sdk`. Until then, the polling from Phases 2–4 is the parity baseline.
2. **Polish pass** (expo-native-ui skill): entering/exiting Reanimated animations on state changes, haptics on payment confirmation and stage advances, `Link.Preview` + context menus everywhere lists link to details, liquid-glass sheets on iOS 26, `borderCurve: "continuous"` cards.
3. Quick actions (Home-screen shortcuts: New order, Track), clipboard-aware tracking (offer to track a copied reference), Live Activity for an in-motion order (iOS, later).
4. Candidates already server-ready: passkeys, Google/Apple sign-in.
5. **Release:** EAS Build profiles (dev client / preview / production) + `eas submit`; EAS Update for OTA JS fixes; point `landing/app-promo.tsx` and `GET /app` env vars at the real store URLs. Store metadata via the `eas-app-stores` skill when ready.

---

## Native design pass (Mobbin-sourced — de-webify the flows)

The parity build reused web layout idioms (bordered input boxes, filter chips, an underlined step rail, multi-field forms). Reference flows pulled from Mobbin show how native apps handle the same moments; refactor toward these:

**Auth — one question per screen** (refs: [Tinder onboarding](https://mobbin.com/flows/f1af7bae-5348-4966-8e49-a1f7581ab3a8), [Corner onboarding](https://mobbin.com/flows/82014fc1-ea4f-455f-90e7-49a11b9804b1), [App Store phone verify](https://mobbin.com/flows/802f05d7-e5c3-43c4-99b4-17db30ddebb6))
- Each step is its own screen: a big bold question as the title ("What's your number?"), ONE input, keyboard already open (`autoFocus`), full-width pill CTA pinned above the keyboard (`KeyboardAvoidingView`).
- Inputs are borderless — an underline or plain field on the background, not a bordered card box.
- Phone entry gets an inline country-code prefix (default 🇳🇬 +234).
- OTP is a dedicated screen: six slots, "Resend code" as a small inline action beneath, auto-submit on sixth digit (already built).
- Kill the three-way method switcher chip row; make it a stack of navigation choices or default-to-PIN with "Use phone code instead" links.

**Quantity & checkout — the value is the screen** (refs: [ANZ Plus transfer](https://mobbin.com/flows/526d53d9-6d75-4809-ae8d-d05a1de39b9d), [OKX P2P payment](https://mobbin.com/flows/6925bcc8-6082-4650-a367-ac1ceb79d1d5))
- Replace the inline right-aligned quantity boxes with a tap-through: product row → quantity screen/sheet with a giant centered value ("33,000 L"), number pad, live line total under it, "Add" CTA (ANZ's amount-entry pattern).
- Invoice screen adopts the OKX bank-transfer anatomy: countdown at the top ("Price locked · 42:10"), then numbered steps — ① "Transfer to these details" as labeled rows (bank / account number / amount) each with its own copy icon, ② "We confirm automatically" with a live status row. Keep the dev "I've paid" as the OKX-style acknowledgment button.
- Payment success = receipt moment: big check, amount, reference chip, Share button (ANZ receipt).

**Tracking — outcome first, dots not rails** (refs: [Walmart order tracking](https://mobbin.com/screens/da5c3b1c-2ff5-424f-ab22-dd8009a58e7f), [Rappi tracking](https://mobbin.com/screens/9632e386-3489-4d57-91bf-1125c5ac9b52), [Baemin timeline](https://mobbin.com/screens/43325ab8-1e21-4d75-b771-f93eb7ca2bab))
- Lead with the outcome, not the stage name: "Loading at Calabar depot" / "Arrives after loading completes" as the headline.
- Compact horizontal progress dots with labels under the headline (Walmart/Rappi); the detailed vertical timeline with timestamps moves lower on the page (Baemin).
- Below: grouped chevron rows (delivery address, trucks, payment) instead of stacked cards.

**General de-webification**
- Orders filter chips → native segmented control.
- Text-link "Edit / Save trucks" actions → toolbar buttons or a form-sheet editor.
- Any remaining bordered `TextInput` boxes → grouped-list rows (`@expo/ui` `FieldGroup`) or borderless fields.

| Topic | Decision |
|---|---|
| Forms | Keep TanStack Form + Zod (already the monorepo standard; works in RN) with `@expo/ui` inputs; plain state for tiny forms |
| Shared code | `packages/api` for contract/types/schemas/formatting; UI stays per-platform (`packages/ui` is web DOM) |
| Secure storage | SecureStore: refresh token, device token. `expo-sqlite/kv-store`: drafts, preferences, resume pointers |
| Real-time | Polling with AppState pause/resume (no sockets exist server-side); push is Phase 6 |
| Lists | `FlatList`/`SectionList` for history (`@expo/ui` `List` is JS-thread-bound — not for large data); `@expo/ui` `List`/`FieldGroup` for settings-style grouped forms |
| Files | `expo-document-picker` + `expo-image-picker`, multipart via `expo/fetch` FormData |
| Env | `EXPO_PUBLIC_SERVER_URL` in `packages/env/src/native.ts`; dev-payment flag as `EXPO_PUBLIC_ENABLE_DEV_PAYMENT` |

## Suggested sequencing

Each phase is independently shippable to TestFlight/internal track:

1. **Phase 0 + 1** — foundation + auth (unblocks everything).
2. **Phase 2** — order wizard (core business value; app is already useful).
3. **Phase 3** — dashboard/tracking/account (daily-driver parity). ← first public store release candidate
4. **Phase 4** — Dangote on the real API.
5. **Phase 5/6** — LPG (flag-gated) + push + polish.

## Open questions for the backend (none block Phases 0–3)

- Turnstile on `POST /register` for native clients (exempt body-transport, or app attestation?).
- Push-token endpoint + Expo push consumer (Phase 6).
- Server-side customer settings endpoint (would let preferences sync across devices).
- LPG backend per `docs/lpg-home-delivery-plan.md` (Phase 5 flips from mock to real).
