import nodemailer from "nodemailer";

/* Mail sent by the website itself, which until now sent none.
 *
 * Everything this project mails came from the Python pipeline on a schedule, and that is still true of the
 * digest. This exists for the one message that cannot wait for a schedule: the verification mail a reader
 * asks for by clicking a link, which is worthless if it arrives tomorrow morning.
 *
 * So the app password now lives in two places -- GitHub Secrets for the pipeline, Netlify environment
 * variables for this. That is a real cost of letting the site send mail and it is the reason the account
 * must stay single-purpose: two copies of a credential is twice the surface, and an empty purpose-built
 * mailbox is what keeps that acceptable.
 *
 * Deliberately no Resend fallback here, unlike the pipeline. A verification mail only ever goes to a reader,
 * and Resend without a verified domain cannot reach anyone but the account owner -- so a fallback would be
 * a path that silently cannot do this job. Better to fail and say so.
 */

const HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const PORT = Number(process.env.SMTP_PORT || "587");
const USER = process.env.SMTP_USER || "";
/* Whitespace stripped, for the same reason as in the pipeline: Google displays an app password as four
 * groups of four and it is pasted that way more often than not. SMTP then fails with "Username and
 * Password not accepted", which reads like a wrong password rather than a formatting one. */
const PASS = (process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");

export function mailConfigured(): boolean {
  return Boolean(HOST && USER && PASS);
}

/** Who the mail is from. Gmail rewrites anything that is not the authenticated account or a verified
 *  alias of it, so this is the account unless DIGEST_FROM has been set to something Gmail knows about. */
export function mailFrom(): string {
  return process.env.DIGEST_FROM || `As Amended <${USER}>`;
}

let cached: nodemailer.Transporter | null = null;

function transport(): nodemailer.Transporter {
  /* Reused across invocations. A warm Netlify function handles several requests, and building a transport
   * per request means a fresh TCP connection, TLS handshake and SMTP AUTH each time -- which is both slow
   * and the thing Gmail throttles on. `pool` keeps one connection open for the life of the container. */
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // 587 is STARTTLS, so `secure` is false and the upgrade happens after greeting. 465 is implicit TLS.
    secure: PORT === 465,
    requireTLS: PORT !== 465,
    auth: { user: USER, pass: PASS },
    pool: true,
    maxConnections: 1,
    // A function that waits on SMTP is a function burning its own timeout. Ten seconds is far longer than
    // Gmail needs and far shorter than Netlify's limit, so a hung connection fails as an error we log
    // rather than as a request that dies without explanation.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  return cached;
}

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe. Both headers or neither -- List-Unsubscribe alone does nothing. */
  unsubscribe?: string;
};

/** True when it was accepted by the server. Never throws: a caller deciding what to tell a reader needs an
 *  answer, not an exception, and the reason belongs in the log rather than on the reader's screen. */
export async function send(mail: Mail): Promise<boolean> {
  if (!mailConfigured()) {
    console.error("mail: SMTP_USER / SMTP_PASSWORD not set; cannot send");
    return false;
  }
  try {
    await transport().sendMail({
      from: mailFrom(),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.unsubscribe
        ? {
            headers: {
              "List-Unsubscribe": `<${mail.unsubscribe}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
    return true;
  } catch (err) {
    // The address is deliberately not logged with the error. A failure is worth recording; a log line
    // pairing a reader's address with "mail failed" is a record of who reads this site, which is the one
    // thing the rest of this codebase goes out of its way not to keep.
    console.error("mail: send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
