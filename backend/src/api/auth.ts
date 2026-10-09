import { timingSafeEqual } from "node:crypto";

/**
 * Demo authentication verification.
 * Header: X-Demo-Auth
 * Value: DEMO_AUTH_TOKEN. In AWS it is read at deploy time from the SSM parameter
 * /outbreak/demo-auth-token (or the DEMO_AUTH_TOKEN env var). There is no default in the code:
 * with no token set, every officer and demo request is refused.
 *
 * NOTE: This is strictly DEMO authentication for hackathon evaluation, NOT production authentication.
 */
export const DEMO_AUTH_HEADER = "X-Demo-Auth";

/** Header lookup in any letter case (API Gateway REST keeps the client's case; HTTP APIs lowercase). */
export function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export function verifyDemoAuth(headers: Record<string, string | undefined>): boolean {
  const expectedToken = process.env.DEMO_AUTH_TOKEN;
  const authHeader = headerValue(headers, DEMO_AUTH_HEADER);
  if (!expectedToken || !authHeader) {
    return false;
  }
  return authHeader === expectedToken;
}

/**
 * Webhook authentication (POST /webhooks/pharmacy | hospital): a shared secret in a header.
 * Header name: WEBHOOK_SECRET_HEADER (default "X-Webhook-Secret").
 * Value: WEBHOOK_SECRET. In AWS it is read at deploy time from the SSM parameter
 * /outbreak/webhook-secret (or the WEBHOOK_SECRET env var). No default: with no secret set,
 * every webhook call is refused.
 */
export const DEFAULT_WEBHOOK_SECRET_HEADER = "X-Webhook-Secret";

export function webhookSecretHeader(): string {
  return process.env.WEBHOOK_SECRET_HEADER?.trim() || DEFAULT_WEBHOOK_SECRET_HEADER;
}

export function verifyWebhookSecret(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.WEBHOOK_SECRET;
  const given = headerValue(headers, webhookSecretHeader());
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Constant-time compare, so the secret cannot be guessed from response times.
  return a.length === b.length && timingSafeEqual(a, b);
}
