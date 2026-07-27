const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { customerRepo, customerIdentityRepo } = require("../repositories");
const { emitEvent } = require("./events");

// Passkeys (WebAuthn): Face ID / Touch ID / Windows Hello / password-manager
// credentials. Registration requires an authenticated session; login uses
// discoverable credentials so the customer never types anything.
//
// Challenges are stored server-side and consumed atomically — a ceremony
// response can be used exactly once.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const rpId = () => process.env.WEBAUTHN_RP_ID || "localhost";
const rpOrigin = () => process.env.WEBAUTHN_ORIGIN || `http://${rpId()}:3000`;
const RP_NAME = "Soroman";

const isEnabled = () =>
  Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN) ||
  process.env.NODE_ENV !== "production";

const storeChallenge = async (challenge, purpose, customerId = null) => {
  await customerIdentityRepo.createChallenge({
    customerId,
    purpose,
    challenge,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
};

// ── Registration (authenticated) ─────────────────────────────────────────────

const startRegistration = async (customer) => {
  const existing = await customerIdentityRepo.listPasskeys(customer.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: String(customer.id),
    userName: customer.phone,
    userDisplayName: customer.name,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: Buffer.from(p.credentialId, "base64url"),
      type: "public-key",
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await storeChallenge(options.challenge, "register", customer.id);
  return { success: true, options };
};

const finishRegistration = async (customer, { credential, deviceName }) => {
  const fail = { success: false, message: "Passkey registration failed. Please try again." };
  if (!credential || typeof credential !== "object") return fail;

  const clientChallenge = extractChallenge(credential);
  if (!clientChallenge) return fail;

  const stored = await customerIdentityRepo.consumeChallenge(clientChallenge, "register");
  if (!stored || stored.customerId !== customer.id) return fail;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn(`[passkey] registration rejected: ${err.message}`);
    return fail;
  }
  if (!verification.verified || !verification.registrationInfo) return fail;

  const info = verification.registrationInfo;
  const passkey = await customerIdentityRepo.createPasskey({
    customerId: customer.id,
    credentialId: Buffer.from(info.credentialID).toString("base64url"),
    publicKey: Buffer.from(info.credentialPublicKey).toString("base64url"),
    counter: info.counter,
    transports: credential.response?.transports || null,
    deviceName: (deviceName || "").slice(0, 255),
  });

  emitEvent("customer.identity_linked", {
    actor: { type: "customer", id: customer.id, name: customer.name },
    entityType: "customer",
    entityId: customer.id,
    provider: "passkey",
  });

  return { success: true, passkey: { id: passkey.id, deviceName: passkey.deviceName } };
};

// ── Authentication (anonymous — discoverable credentials) ────────────────────

const startAuthentication = async () => {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
    // No allowCredentials: the authenticator offers whichever Soroman
    // passkeys it holds.
  });

  await storeChallenge(options.challenge, "authenticate");
  return { success: true, options };
};

const finishAuthentication = async ({ credential }) => {
  const fail = { success: false, message: "Passkey sign-in failed. Please try again." };
  if (!credential || typeof credential !== "object" || typeof credential.id !== "string") {
    return fail;
  }

  const clientChallenge = extractChallenge(credential);
  if (!clientChallenge) return fail;

  const stored = await customerIdentityRepo.consumeChallenge(clientChallenge, "authenticate");
  if (!stored) return fail;

  const passkey = await customerIdentityRepo.findPasskeyByCredentialId(credential.id);
  if (!passkey) return fail;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: rpOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
      authenticator: {
        credentialID: Buffer.from(passkey.credentialId, "base64url"),
        credentialPublicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
      },
    });
  } catch (err) {
    console.warn(`[passkey] authentication rejected: ${err.message}`);
    return fail;
  }
  if (!verification.verified) return fail;

  await customerIdentityRepo.updatePasskey(passkey.id, {
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: new Date(),
  });

  const customer = await customerRepo.findById(passkey.customerId);
  if (!customer || customer.status === "Inactive") return fail;
  return { success: true, customer };
};

/** The challenge a ceremony response was built against, from clientDataJSON. */
function extractChallenge(credential) {
  try {
    const clientData = JSON.parse(
      Buffer.from(credential.response.clientDataJSON, "base64url").toString("utf8")
    );
    return typeof clientData.challenge === "string" ? clientData.challenge : null;
  } catch {
    return null;
  }
}

module.exports = {
  isEnabled,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
};
