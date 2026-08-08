/**
 * The shared branded email shell.
 *
 * services/email.service.js hand-rolls a full HTML document per template, which
 * is why the eight templates there run to 1,200 lines and drifted in their
 * footers and paddings. Those templates stay exactly as they are — they are
 * transactional documents (an invoice, a QR ticket) whose layout is the point,
 * and rewriting them would risk the copy customers already receive.
 *
 * Everything the notification engine generates instead renders through the
 * layout below: same teal header, same footer, one place to change either.
 */

const BRAND = {
  name: "Soroman",
  // Matches the existing templates exactly, so the two families are
  // indistinguishable in an inbox.
  headerFrom: "#0d9488",
  headerTo: "#0f766e",
  accent: "#0d9488",
  pageBg: "#f4f7fa",
  cardBg: "#ffffff",
  heading: "#1e293b",
  text: "#475569",
  muted: "#94a3b8",
  border: "#e2e8f0",
  subtleBg: "#f8fafc",
};

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** ₦ amounts, matching the formatting used across the existing templates. */
function formatMoney(amount, { decimals = 2 } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: decimals,
  }).format(n);
}

function formatQuantity(value, unit = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString()}${unit ? ` ${unit}` : ""}`;
}

function formatDate(value, { withTime = false } = {}) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/**
 * A label/value table. Rows whose value is empty are dropped rather than
 * rendered blank — a notification about an order without a depot should not
 * show "Depot —".
 */
function detailRows(rows = []) {
  const visible = rows.filter(
    (r) => r && r.value !== undefined && r.value !== null && String(r.value).trim() !== ""
  );
  if (!visible.length) return "";

  const cells = visible
    .map(
      ({ label, value, strong }, i) => `
        <tr>
          <td style="padding:8px 0;${i < visible.length - 1 ? `border-bottom:1px solid ${BRAND.border};` : ""}">
            <span style="color:${BRAND.text};font-size:13px;">${escapeHtml(label)}</span>
          </td>
          <td style="padding:8px 0;text-align:right;${i < visible.length - 1 ? `border-bottom:1px solid ${BRAND.border};` : ""}">
            <span style="color:${strong ? BRAND.accent : BRAND.heading};font-size:13px;font-weight:${strong ? 700 : 600};">${escapeHtml(value)}</span>
          </td>
        </tr>`
    )
    .join("");

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${cells}</table>`;
}

/** A single call-to-action button, with the raw URL beneath it for mail clients that strip buttons. */
function callToAction(url, label) {
  if (!url) return "";
  const safeUrl = escapeHtml(url);
  return `
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:${BRAND.accent};border-radius:8px;">
          <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;padding:12px 16px;background-color:#f1f5f9;border-radius:6px;word-break:break-all;">
      <a href="${safeUrl}" style="color:${BRAND.accent};font-size:13px;text-decoration:none;">${safeUrl}</a>
    </p>`;
}

/** A tinted callout. `tone` picks the palette; the copy is the caller's. */
function callout(html, tone = "info") {
  const tones = {
    info: { bg: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "#a7f3d0", text: "#065f46" },
    warning: { bg: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "#fbbf24", text: "#92400e" },
    danger: { bg: "linear-gradient(135deg,#fee2e2,#fecaca)", border: "#fca5a5", text: "#991b1b" },
  };
  const t = tones[tone] || tones.info;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg};border:1px solid ${t.border};border-radius:8px;padding:16px;margin:0 0 24px;">
      <tr><td><p style="margin:0;color:${t.text};font-size:13px;line-height:1.5;">${html}</p></td></tr>
    </table>`;
}

/**
 * Wrap body HTML in the branded shell.
 *
 * @param {object}  opts
 * @param {string}  opts.subtitle  the line under the wordmark ("Order Update")
 * @param {string}  opts.heading   the H2 inside the card
 * @param {string}  opts.intro     lead paragraph (plain text; escaped here)
 * @param {string}  opts.bodyHtml  pre-rendered blocks (detailRows, callout, …)
 * @param {string}  opts.footNote  small print under the content
 */
function layout({ subtitle = "", heading = "", intro = "", bodyHtml = "", footNote = "" } = {}) {
  return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:0;background-color:${BRAND.pageBg};font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.pageBg};padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cardBg};border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
                  <tr>
                    <td style="background:linear-gradient(135deg,${BRAND.headerFrom},${BRAND.headerTo});padding:32px 40px;">
                      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${BRAND.name}</h1>
                      ${subtitle ? `<p style="margin:8px 0 0;color:#ccfbf1;font-size:14px;">${escapeHtml(subtitle)}</p>` : ""}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:40px;">
                      ${heading ? `<h2 style="margin:0 0 16px;color:${BRAND.heading};font-size:20px;font-weight:600;">${escapeHtml(heading)}</h2>` : ""}
                      ${intro ? `<p style="margin:0 0 24px;color:${BRAND.text};font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>` : ""}
                      ${bodyHtml}
                      ${footNote ? `<p style="margin:0;color:${BRAND.muted};font-size:13px;line-height:1.5;text-align:center;">${escapeHtml(footNote)}</p>` : ""}
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color:${BRAND.subtleBg};padding:24px 40px;border-top:1px solid ${BRAND.border};">
                      <p style="margin:0;color:${BRAND.muted};font-size:12px;text-align:center;">
                        &copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>`;
}

module.exports = {
  BRAND,
  escapeHtml,
  formatMoney,
  formatQuantity,
  formatDate,
  detailRows,
  callToAction,
  callout,
  layout,
};
