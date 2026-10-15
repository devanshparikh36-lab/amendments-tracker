import { SITE_URL } from "@/lib/site";

/* The one message this site sends to a reader before they have confirmed anything.
 *
 * Written to be read in two seconds and acted on in one click. It is not a welcome mail, it carries no
 * digest content and it sells nothing: a reader who asked to verify an address wants the button, and
 * anything else in here is something for them to read past.
 *
 * Styled the way the digest is -- inline, tables, 600px, light colour-scheme meta -- for the same reasons
 * documented in services/pipeline/amendments/notify/email.py. A <style> block is stripped by Gmail in some
 * views and by Outlook in others, and Outlook renders through Word and does not do flex or grid.
 *
 * It also says plainly what happens if they did not ask, because an unverified address means exactly that:
 * somebody may have typed an address that is not theirs. Doing nothing must be a complete answer, and the
 * mail has to say so rather than leaving a stranger to work out whether they need to act.
 */

const INK = "#1c1917";
const INK_2 = "#44403c";
const INK_3 = "#78716c";
const RULE = "#e7e5e4";
const PAPER = "#faf9f7";
const CARD = "#ffffff";
const LINK = "#14532d";
const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

export const VERIFY_SUBJECT = "Confirm your email to get the As Amended digest";

export function verifyUrl(token: string): string {
  return `${SITE_URL.replace(/\/$/, "")}/confirm?token=${encodeURIComponent(token)}`;
}

export function verifyHtml(token: string): string {
  const url = verifyUrl(token);
  return (
    "<!doctype html><html><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<meta name='color-scheme' content='light'>" +
    "<meta name='supported-color-schemes' content='light'>" +
    `</head><body style="margin:0;padding:0;background:${PAPER}">` +
    `<div style="background:${PAPER};padding:24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:600px;max-width:100%;margin:0 auto;background:${CARD};border:1px solid ${RULE};` +
    `border-radius:4px;border-collapse:separate">` +
    `<tr><td style="padding:24px 24px 0">` +
    `<div style="font:600 19px/1.2 Georgia,'Times New Roman',serif;color:${INK}">As Amended</div>` +
    `<div style="font:500 10.5px/1.5 ${SANS};letter-spacing:.12em;text-transform:uppercase;` +
    `color:${INK_3};padding-top:3px">Indian tax &amp; corporate law, in the regulator&rsquo;s words</div>` +
    `</td></tr>` +
    `<tr><td style="padding:18px 24px 0">` +
    `<div style="font:400 14.5px/1.6 ${SANS};color:${INK_2}">` +
    `Someone asked for the daily digest to be sent to this address. One click and it starts arriving.` +
    `</div></td></tr>` +
    `<tr><td style="padding:18px 24px 0">` +
    `<a href="${url}" style="display:inline-block;background:${LINK};color:#ffffff;text-decoration:none;` +
    `border-radius:3px;padding:11px 20px;font:600 14px/1 ${SANS}">Confirm this address</a>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 24px 0">` +
    `<div style="font:400 12.5px/1.6 ${SANS};color:${INK_3}">` +
    `The link works once and expires in 48 hours. If the button does not work, copy this in:` +
    `<div style="padding-top:6px;word-break:break-all;color:${INK_2}">${url}</div>` +
    `</div></td></tr>` +
    `<tr><td style="padding:16px 24px 24px">` +
    `<div style="font:400 12.5px/1.6 ${SANS};color:${INK_3};border-top:1px solid ${RULE};padding-top:14px">` +
    `<b style="color:${INK_2}">If you did not ask for this, do nothing.</b> Nothing has been sent to this ` +
    `address and nothing will be. The address is not verified until that button is pressed, which is the ` +
    `whole reason this mail exists.` +
    `<div style="padding-top:10px">One message a day at most, only on days the regulators publish ` +
    `something. Amendments are shown as references and never applied to the statutory text. A research ` +
    `aid, not legal advice.</div>` +
    `</div></td></tr>` +
    `</table></div></body></html>`
  );
}

export function verifyText(token: string): string {
  const url = verifyUrl(token);
  return [
    "As Amended",
    "",
    "Someone asked for the daily digest to be sent to this address.",
    "Open this link to confirm it:",
    "",
    url,
    "",
    "The link works once and expires in 48 hours.",
    "",
    "If you did not ask for this, do nothing. Nothing has been sent to this address",
    "and nothing will be unless that link is opened.",
    "",
    "One message a day at most, only on days the regulators publish something.",
    "Amendments are shown as references and never applied to the statutory text.",
    "A research aid, not legal advice.",
  ].join("\n");
}
