import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { DbAlert } from "../db/types.js";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ISesService {
  sendAlertNotification(alert: DbAlert, wardName?: string): Promise<EmailResult>;
}

export class SesService implements ISesService {
  private client: SESClient;
  private fromEmail: string;
  private officerEmail: string;

  constructor(fromEmail?: string, officerEmail?: string) {
    this.client = new SESClient({
      region: process.env.AWS_REGION || "ap-south-1",
    });
    // Both come from CDK context or env at deploy time (infra/README.md); no made-up defaults.
    this.fromEmail = fromEmail || process.env.SES_FROM_EMAIL || "";
    this.officerEmail = officerEmail || process.env.OFFICER_EMAIL || "";
  }

  formatDisclaimer(): string {
    return (
      "CRITICAL DISCLAIMER: THIS ALERT IS SUSPECTED, NOT CONFIRMED. " +
      "This is an automated early-warning signal and is not a confirmed outbreak. " +
      "Statistical anomaly detection does not constitute a clinical diagnosis. " +
      "Field verification is required before taking public health interventions."
    );
  }

  buildEmailContent(alert: DbAlert, wardName: string = `Ward ${alert.wardId}`) {
    const primaryCause = Object.entries(alert.causeProbs).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0] ?? "unknown";

    const subject = `Suspected Outbreak Signal — Ward ${alert.wardId}`;

    const textBody = `
================================================================================
OUTBREAK WATCH - EARLY WARNING SYSTEM
STATUS: SUSPECTED, NOT CONFIRMED
================================================================================

This is an automated early-warning signal and is not a confirmed outbreak.

WARD: ${wardName} (ID: ${alert.wardId})
DATE: ${alert.date}
SCORE: ${(alert.score * 100).toFixed(1)}% (${alert.score})
DETECTION METHOD: ${alert.method}
LIKELY CAUSE (triage hint, not a diagnosis): ${primaryCause.toUpperCase()} (${pct(alert.causeProbs[primaryCause as keyof typeof alert.causeProbs])})
SUSPECTED ZONE: ${alert.suspectedZoneId ? `Zone ${alert.suspectedZoneId}` : "Not determined / N/A"}

DETECTOR EVIDENCE:
${alert.evidence.map((e) => `• ${e}`).join("\n")}

CAUSE HINT REASONS (triage hint, not a diagnosis):
${alert.causeEvidence.map((e) => `• ${e}`).join("\n")}

CONTRIBUTING SIGNALS:
- ${alert.contributingSignals.join(", ")}

CAUSE PROBABILITIES (triage hint, not a diagnosis):
- Water: ${(alert.causeProbs.water * 100).toFixed(1)}%
- Food: ${(alert.causeProbs.food * 100).toFixed(1)}%
- Person-to-Person: ${(alert.causeProbs.p2p * 100).toFixed(1)}%
- Seasonal: ${(alert.causeProbs.seasonal * 100).toFixed(1)}%
- Unknown: ${(alert.causeProbs.unknown * 100).toFixed(1)}%

--------------------------------------------------------------------------------
DISCLAIMER:
${this.formatDisclaimer()}
--------------------------------------------------------------------------------
`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    .header { background: #dc2626; color: #ffffff; padding: 18px 24px; }
    .header h2 { margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 0.5px; }
    .disclaimer-banner { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 16px 24px; font-weight: bold; color: #991b1b; font-size: 13px; }
    .content { padding: 0 24px 24px 24px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: #fee2e2; color: #991b1b; }
    .grid { margin: 16px 0; border: 1px solid #f1f5f9; border-radius: 6px; }
    .row { display: flex; padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
    .label { font-weight: 600; width: 180px; color: #64748b; font-size: 13px; }
    .value { flex: 1; font-size: 13px; }
    .evidence-list { background: #f8fafc; padding: 12px 18px; border-radius: 6px; margin: 12px 0; font-size: 13px; }
    .footer { background: #f8fafc; padding: 16px 24px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Suspected Outbreak Signal &mdash; Ward ${alert.wardId}</h2>
    </div>
    <div class="disclaimer-banner">
      <strong>SUSPECTED, NOT CONFIRMED</strong>: This is an automated early-warning signal and is not a confirmed outbreak. Field verification is required before taking public health interventions.
    </div>
    <div class="content">
      <div style="margin: 12px 0;">
        <span class="badge">Risk Score: ${(alert.score * 100).toFixed(1)}%</span>
        <span class="badge" style="background: #e0f2fe; color: #0369a1; margin-left: 8px;">Detection Method: ${alert.method}</span>
      </div>

      <div class="grid">
        <div class="row"><div class="label">Ward</div><div class="value"><strong>${wardName}</strong> (ID: ${alert.wardId})</div></div>
        <div class="row"><div class="label">Date</div><div class="value">${alert.date}</div></div>
        <div class="row"><div class="label">Score</div><div class="value"><strong>${alert.score}</strong> (${(alert.score * 100).toFixed(1)}%)</div></div>
        <div class="row"><div class="label">Detection Method</div><div class="value">${alert.method}</div></div>
        <div class="row"><div class="label">Likely Cause</div><div class="value"><strong style="color: #dc2626;">${primaryCause.toUpperCase()}</strong> (triage hint, not a diagnosis)</div></div>
        <div class="row"><div class="label">Suspected Zone</div><div class="value">${alert.suspectedZoneId ? `Zone ${alert.suspectedZoneId}` : "Not determined / N/A"}</div></div>
        <div class="row"><div class="label">Contributing Signals</div><div class="value">${alert.contributingSignals.join(", ")}</div></div>
      </div>

      <h4 style="margin: 16px 0 8px 0; font-size: 14px;">Detector Evidence</h4>
      <div class="evidence-list">
        <ul style="margin: 0; padding-left: 20px;">
          ${alert.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
        </ul>
      </div>

      <h4 style="margin: 16px 0 8px 0; font-size: 14px;">Cause Hint Reasons (triage hint, not a diagnosis)</h4>
      <div class="evidence-list">
        <ul style="margin: 0; padding-left: 20px;">
          ${alert.causeEvidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
        </ul>
      </div>

      <h4 style="margin: 16px 0 8px 0; font-size: 14px;">Cause Probabilities (triage hint, not a diagnosis)</h4>
      <div style="font-size: 12px; color: #475569;">
        Water: ${(alert.causeProbs.water * 100).toFixed(1)}% |
        Food: ${(alert.causeProbs.food * 100).toFixed(1)}% |
        P2P: ${(alert.causeProbs.p2p * 100).toFixed(1)}% |
        Seasonal: ${(alert.causeProbs.seasonal * 100).toFixed(1)}% |
        Unknown: ${(alert.causeProbs.unknown * 100).toFixed(1)}%
      </div>
    </div>
    <div class="footer">
      <p style="margin: 0 0 8px 0;"><strong>Disclaimer:</strong> ${this.formatDisclaimer()}</p>
      Outbreak Watch Bengaluru Triage System &bull; Alert ID: ${alert.id} &bull; Generated: ${alert.createdAt}
    </div>
  </div>
</body>
</html>
`;

    return { subject, textBody, htmlBody };
  }

  async sendAlertNotification(alert: DbAlert, wardName?: string): Promise<EmailResult> {
    const { subject, textBody, htmlBody } = this.buildEmailContent(alert, wardName);
    if (!this.fromEmail || !this.officerEmail) {
      return { success: false, error: "SES_FROM_EMAIL or OFFICER_EMAIL is not set, so no email was sent." };
    }

    try {
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: {
          ToAddresses: [this.officerEmail],
        },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: textBody, Charset: "UTF-8" },
            Html: { Data: htmlBody, Charset: "UTF-8" },
          },
        },
      });

      const res = await this.client.send(command);
      console.log(`[SES] Alert email sent successfully. MessageId: ${res.MessageId}`);
      return { success: true, messageId: res.MessageId };
    } catch (err: any) {
      console.warn(`[SES] Warning: Failed to send email via Amazon SES: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

/**
 * Mock SES Service for deterministic unit and integration tests.
 */
export class MockSesService implements ISesService {
  public sentEmails: Array<{
    alertId: string;
    subject: string;
    recipient: string;
    disclaimerPresent: boolean;
  }> = [];

  public shouldFail = false;

  async sendAlertNotification(alert: DbAlert, wardName?: string): Promise<EmailResult> {
    if (this.shouldFail) {
      return {
        success: false,
        error: "SES Sandbox restriction: Destination address not verified.",
      };
    }
    const subject = `Suspected Outbreak Signal — Ward ${alert.wardId}`;
    this.sentEmails.push({
      alertId: alert.id,
      subject,
      recipient: "officer@example.com",
      disclaimerPresent: true,
    });
    return { success: true, messageId: `mock-msg-${Date.now()}` };
  }
}
