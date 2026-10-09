import { SesService } from "../src/notifications/ses.js";
import { readFileSync } from "node:fs";
import type { DbAlert } from "../src/db/types.js";

/**
 * Script to test Amazon SES email sending with real or demo addresses.
 *
 * Usage:
 *   npx tsx scripts/test-ses.ts <recipient_email> [sender_email]
 *
 * Environment variables:
 *   AWS_REGION (default: ap-south-1)
 *   SES_FROM_EMAIL
 *   OFFICER_EMAIL
 */
async function main() {
  const recipient = process.argv[2] || process.env.OFFICER_EMAIL;
  const sender = process.argv[3] || process.env.SES_FROM_EMAIL;
  if (!recipient || !sender) {
    console.error("Give both addresses: npx tsx scripts/test-ses.ts <recipient_email> <sender_email> (or set OFFICER_EMAIL and SES_FROM_EMAIL).");
    process.exit(1);
  }

  console.log("==================================================");
  console.log("OUTBREAK WATCH - SES NOTIFICATION VERIFICATION");
  console.log("==================================================");
  console.log(`Region:     ${process.env.AWS_REGION || "ap-south-1"}`);
  console.log(`From (SES): ${sender}`);
  console.log(`To (Dest):  ${recipient}`);
  console.log("--------------------------------------------------");

  // A real alert shape: P1's handoff sample (SYNTHETIC data), ward 21 in water zone 14.
  const sample = JSON.parse(
    readFileSync(new URL("../../detection/handoff/sample-run-detector.json", import.meta.url), "utf8")
  ).firstDetection;
  const sampleAlert: DbAlert = {
    ...sample.alerts[0],
    id: "00000000-0000-4000-8000-000000000000",
    causeEvidence: sample.causeEvidence[String(sample.alerts[0].wardId)],
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const wardLabel = `SES TEST, synthetic sample (Ward ${sampleAlert.wardId})`;

  const sesService = new SesService(sender, recipient);
  const emailContent = sesService.buildEmailContent(
    sampleAlert,
    wardLabel
  );

  console.log("\nGenerated Email Preview:");
  console.log(`Subject: ${emailContent.subject}`);
  console.log("\nText Body:\n", emailContent.textBody);

  console.log("Dispatching email via Amazon SES...");
  const result = await sesService.sendAlertNotification(
    sampleAlert,
    wardLabel
  );

  if (result.success) {
    console.log("\n==================================================");
    console.log("RESULT: SUCCESS");
    console.log(`SES Message ID: ${result.messageId}`);
    console.log("Email successfully handed off to Amazon SES.");
    console.log("==================================================");
  } else {
    console.log("\n==================================================");
    console.log("RESULT: FAILED");
    console.log(`Error: ${result.error}`);
    console.log("==================================================");
    console.log("\nAmazon SES Sandbox Troubleshooting:");
    console.log(
      "1. Verify that BOTH sender and recipient email addresses are verified identities in AWS SES:"
    );
    console.log(`   aws ses verify-email-identity --email-address ${sender}`);
    console.log(`   aws ses verify-email-identity --email-address ${recipient}`);
    console.log(
      "2. Check recipient inbox for the verification email from Amazon SES and click the confirmation link."
    );
    console.log(
      "3. Verify AWS credentials have 'ses:SendEmail' permissions for your AWS region."
    );
  }
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
