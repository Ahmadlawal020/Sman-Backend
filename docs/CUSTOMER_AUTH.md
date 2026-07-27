# Customer Authentication — Frontend Integration Guide

*For the Soroman customer portal and mobile app. All endpoints live under `/api/customer/auth`. Verified against the backend code on branch `feat/erp-modules`.*

---

## 1. The model in one paragraph

**Phone + OTP is the default and recommended method — every customer has it, and the phone number is required regardless of how they sign in**, because deliveries and payments need it. On top of that, a customer may link additional sign-in methods to the *same* account: email + password, a 6-digit PIN (device-bound), Google, Apple, and passkeys (Face ID / Touch ID / Windows Hello). All of them end at the same place — a short-lived **access token** (JWT, **15 minutes**, sent as `Authorization: Bearer <accessToken>`) and a long-lived **refresh token** (**30 days**, rotating). How the refresh token reaches you depends on platform, not on which sign-in method was used:

| Platform | Transport | You do |
|---|---|---|
| **Web (browser)** | httpOnly cookie, set automatically | Nothing — never store it; call every endpoint with `credentials: "include"` |
| **Native app (iOS/Android)** | Response body | Send header `X-Auth-Transport: body`; store the returned `refreshToken` in secure storage (Keychain/Keystore) |

Pick one mode per client and never mix them.

**Why more than OTP:** SMS is a single point of failure — a Termii outage, a signal-dead depot, or the daily send cap being spent (a real 503 this backend returns) all lock a customer out of an account that might need to place an urgent order. Email+password and PIN give business users a way in that doesn't depend on SMS delivery at all.

---

## 2. Account model: one customer, several linked identities

```
Customer
 ├── phone + OTP        always present, the default
 ├── email + password   optional, linked
 ├── PIN                optional, linked — device-bound, not a standalone login
 ├── Google             optional, linked
 ├── Apple              optional, linked
 └── passkeys            optional, one or more devices
```

`GET /api/customer/auth/identities` (authenticated) returns what's linked:

```json
{
  "success": true,
  "data": {
    "phone": { "verified": true },
    "identities": [
      { "provider": "email", "verified": true, "linkedAt": "2026-07-20T09:00:00.000Z" },
      { "provider": "google", "verified": true, "linkedAt": "2026-07-22T14:12:00.000Z" }
    ],
    "passkeys": [{ "id": 4, "deviceName": "iPhone 15", "createdAt": "…" }],
    "trustedDevices": [{ "id": 9, "deviceName": "Chrome — MacBook", "lastUsedAt": "…", "expiresAt": "…" }]
  }
}
```

Build the account-settings screen ("Sign-in methods") directly from this.

---

## 3. Registration

### Phone-first (the default path)

**Step 1 — `POST /register`**

```json
{
  "phone": "08012345678",
  "name": "Ada Obi",
  "companyName": "Obi Fuels Ltd",
  "turnstileToken": "<cloudflare-turnstile-token>"
}
```

Always returns the same generic body regardless of what actually happened (anti-enumeration):

```json
{ "success": true, "message": "If that number can receive a code, one has been sent." }
```

Advance to the code-entry screen regardless of the response. **400** = bad input (missing name/phone, malformed phone, failed Turnstile). **429** = rate limited. **503** = OTP capacity temporarily spent.

**Step 2 — verify** with `POST /verify-otp` (section 5) completes it. The account is created `Pending` and **the first successful OTP verification is the activation** — no staff-approval wait.

### Provider-first (Google / Apple)

Run the platform's own sign-in SDK to get an ID token, then:

**Step 1 — `POST /login/:provider`** (`provider` = `google` or `apple`)

```json
{ "idToken": "<id-token-from-the-sdk>" }
```

Two outcomes:

- **Already linked** → signs straight in, same shape as section 5's success response.
- **Never seen before** → registration, not login:

```json
{
  "success": true,
  "needsRegistration": true,
  "message": "Almost done — confirm your phone number to finish creating your account.",
  "data": { "registrationToken": "<short-lived-jwt>" }
}
```

**Step 2 — `POST /register/:provider`**

```json
{ "registrationToken": "<from step 1>", "phone": "08012345678", "name": "Ada Obi" }
```

This creates the customer (`Pending`, the provider identity linked immediately) and sends a phone OTP — the response is the same generic "if that number can receive a code…" body. **The provider proving identity does not skip phone verification** — verify the OTP (section 5) to actually get a session. `registrationToken` expires in 15 minutes; if it does, restart from step 1.

**401** from `/login/:provider` means the ID token itself was rejected (expired, wrong app, tampered) — show a generic "sign-in failed, try again," never a provider-specific reason.

---

## 4. Signing in with each method

### 4.1 Phone + OTP (unchanged, still the default)

`POST /request-otp` → `{ "phone": "…" }` → same generic 200 whether or not the number is registered. Then `POST /verify-otp` → `{ "phone", "code" }` → session on success (section 6 has the shared response shape). Codes last **10 minutes**, allow **5 attempts**, are **single-use**. Full detail in section 6.

### 4.2 Email + password

**Set/change** (must be signed in first — link it from account settings): `POST /password`

```json
{ "email": "ada@obifuels.com", "password": "at least 8 characters" }
```

**Login:** `POST /login/password`

```json
{ "email": "ada@obifuels.com", "password": "…", "deviceToken": "<optional, see below>" }
```

Two outcomes:

- **Recognized device** (a valid `deviceToken` from a prior step-up) → straight to a session, same shape as section 6.
- **New/unrecognized device** → the password was correct but the device isn't proven yet:

```json
{
  "success": true,
  "stepUpRequired": true,
  "message": "New device detected. Enter the verification code sent to your phone to continue.",
  "data": { "phone": "+2348012345678" }
}
```

An OTP has already been sent to the phone on file. Complete it with **`POST /login/password/verify`**:

```json
{ "phone": "+2348012345678", "code": "123456", "trustDevice": true, "deviceName": "Chrome — MacBook" }
```

Same session response as section 6, **plus** (if `trustDevice: true`) a `deviceToken` — store it (a cookie, localStorage, or platform secure storage; it is not the refresh token and is safe to keep client-side, but treat it like any bearer secret). Pass that `deviceToken` on future `/login/password` calls from that device to skip step-up entirely.

**401** on `/login/password` is always the generic `"Invalid email or password"` — wrong password and unknown email look identical on purpose. Five wrong attempts locks that identity for 15 minutes (still the same generic message).

### 4.3 PIN (device-bound — never a standalone login)

**Set** (authenticated): `POST /pin` → `{ "pin": "482913" }` (exactly 6 digits).

**Login:** `POST /login/pin` → `{ "phone": "…", "pin": "…", "deviceToken": "<required>" }`.

**A `deviceToken` is mandatory.** A 6-digit PIN is only ever a second factor for a device already proven by OTP — get a `deviceToken` the same way as section 4.2 (via a password step-up with `trustDevice: true`), then PIN login works from that device going forward. Presenting a PIN with no device token, or an unrecognized one, is refused (**401**) even with the correct PIN — don't build a PIN-only login screen.

### 4.4 Google / Apple

Same `POST /login/:provider` as registration (section 3) — if the identity is already linked, this call alone returns a session.

**Linking a provider to an already-signed-in account:** `POST /link/:provider` (authenticated) → `{ "idToken": "…" }`. **Unlinking:** `DELETE /link/:provider`.

### 4.5 Passkeys (Face ID / Touch ID / Windows Hello)

Requires the browser/OS WebAuthn API (`navigator.credentials`).

**Registering a passkey** (must be signed in — add it from account settings):
1. `POST /passkeys/register/options` (authenticated) → WebAuthn creation options.
2. Pass them to `navigator.credentials.create({ publicKey: options })`.
3. `POST /passkeys/register/verify` → `{ "credential": <the browser's response>, "deviceName": "MacBook Touch ID" }`.

**Signing in with a passkey** (no prior authentication — this *is* the login):
1. `POST /passkeys/login/options` → WebAuthn request options (no account needed yet — discoverable credentials).
2. `navigator.credentials.get({ publicKey: options })`.
3. `POST /passkeys/login/verify` → `{ "credential": <the browser's response> }` → session, same shape as section 6.

**Removing one:** `DELETE /passkeys/:id` (authenticated).

A rejected ceremony (expired challenge, wrong origin, replayed response) is a generic 400 (register) or 401 (login) — never a 500; show "try again" and re-fetch fresh options rather than retrying the same response.

---

## 5. Verifying an OTP (shared underneath password/PIN step-up and phone login)

`POST /verify-otp` — `{ "phone", "code" }`. **401** always reads `{ "success": false, "message": "Invalid or expired code" }`, whether the code was wrong, expired, already used, the number unknown, or the account deactivated. Build the UX around: 10-minute life, 5 attempts then burned, single-use, no auto-retry — offer a "resend code" button instead.

---

## 6. Session response shape (identical across every method)

Whichever method got you here — OTP, password, PIN, Google, Apple, passkey — success looks like this:

```json
{
  "success": true,
  "message": "Signed in",
  "data": {
    "customer": {
      "id": 42,
      "name": "Ada Obi",
      "phone": "+2348012345678",
      "email": null,
      "companyName": "Obi Fuels Ltd",
      "status": "Active",
      "phoneVerifiedAt": "2026-07-27T10:15:00.000Z"
    },
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "…"   // ONLY present in body-transport (native) mode
  }
}
```

In cookie mode (web), the refresh token isn't in the body — it arrived as the httpOnly `soroman_customer_refresh` cookie, alongside a JS-readable `soroman_csrf` cookie you'll need for refresh/logout.

---

## 7. Staying signed in — `POST /refresh`

Access tokens die after **15 minutes**; refresh proactively (on a 401, or a timer around 13 minutes).

**Web:**

```js
await fetch("/api/customer/auth/refresh", {
  method: "POST",
  credentials: "include",
  headers: { "X-CSRF-Token": readCookie("soroman_csrf") },
});
```

**Native:**

```js
await fetch(BASE + "/api/customer/auth/refresh", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Auth-Transport": "body" },
  body: JSON.stringify({ refreshToken: storedRefreshToken }),
});
```

Returns the same shape as section 6: a fresh `accessToken` and (native) a **new** `refreshToken`.

**Refresh tokens rotate on every use** — overwrite the stored token immediately and atomically, every time. There's a 60-second grace window to survive one dropped response, but **reusing an old token beyond that revokes every session for that customer** (theft response). Serialize refresh calls — two in flight at once will log your user out of every device. This is independent of which method the customer originally signed in with.

**401 from `/refresh`** → session is over. Clear local state, go to login.

---

## 8. Authenticated requests, sessions, sign-out — unchanged regardless of method

- Every call: `Authorization: Bearer <accessToken>`.
- `GET /me` → `{ customer }` — use on app start to restore state.
- `POST /logout` (needs CSRF header on web if a refresh cookie is present) → revokes this session; **204** if there was nothing to revoke.
- `POST /logout-all` (authenticated) → signs out every device, returns `revokedCount`.
- `GET /sessions` / `DELETE /sessions/:id` (authenticated) → device list / revoke one.
- `DELETE /devices/:id` (authenticated) → revoke a **trusted-device** grant (section 4.3), distinct from a login session — use it in the "Trusted devices" part of account settings, not the "Active sessions" part.

---

## 9. Account status

- `Pending` — registered (any method), phone not yet proven. First successful OTP verification auto-promotes to `Active` — no waiting-for-approval screen needed, for any sign-up path.
- `Active` — normal.
- `Inactive` — staff-deactivated. Every login method fails with its generic message; no special screen needed.
- Changing the phone number revokes all sessions — expect a forced re-login after that.

---

## 10. Checklist / common mistakes

1. **Web:** always `credentials: "include"`; never store any token in localStorage; access token lives in memory only.
2. **Native:** send `X-Auth-Transport: body` on every token-issuing call — `verify-otp`, `login/password/verify`, `login/pin`, `login/:provider`, `passkeys/login/verify`, and `refresh`. Missing it on refresh is the most common bug.
3. Serialize refresh calls — parallel refreshes trip reuse detection and sign out every device.
4. Overwrite the stored refresh token after every refresh.
5. Treat every generic OTP/registration 200 as "advance the UI," never as "the number/email exists."
6. A password login returning `stepUpRequired: true` is **not an error** — it's a normal branch; render the code-entry screen, don't show a failure toast.
7. Never build a PIN-only login form — PIN requires `deviceToken`, obtained via a prior OTP step-up.
8. `registrationToken` (from provider-first sign-up) expires in 15 minutes and is single-purpose — don't cache it across app restarts.
9. Handle **429** and **503** as "try later," not as errors to auto-retry.
10. Turnstile is required in production on `/register` (phone-first only — provider-first registration doesn't take a Turnstile token).
11. Passkey ceremony failures should re-fetch fresh options and retry, not resend the same (now-consumed) response.
12. Build the "Sign-in methods" screen from `GET /identities` — don't hardcode which providers a customer has.
