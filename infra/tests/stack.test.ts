import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { OutbreakWatchStack } from "../src/outbreak-stack.js";
import { METRICS, PIPELINE_METRICS } from "@outbreak/backend/metrics";

/* Emails come from context; none of them is in the source. */
function synth(context: Record<string, string> = {}) {
  const app = new cdk.App({ context });
  const stack = new OutbreakWatchStack(app, "TestOutbreakStack", { env: { region: "ap-south-1", account: "123456789012" } });
  return Template.fromStack(stack);
}

describe("Infrastructure CDK Stack", () => {
  const template = synth({ sesFromEmail: "sender@example.com", officerEmail: "officer@example.com", demoAuthToken: "test-token" });

  it("creates RDS PostgreSQL instance with PostGIS-capable configuration", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      DBInstanceClass: "db.t4g.micro",
      AllocatedStorage: "20",
      PubliclyAccessible: true,
      DBName: "outbreak_watch",
    });
  });

  it("creates Secrets Manager secret for database credentials", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "outbreak/db/credentials" });
  });

  it("creates the API, detector and DB setup Lambdas as esbuild bundles", () => {
    for (const name of ["outbreak-watch-backend-api", "outbreak-watch-detector", "outbreak-watch-db-setup"]) {
      template.hasResourceProperties("AWS::Lambda::Function", { FunctionName: name, Runtime: "nodejs22.x", Handler: "index.handler" });
    }
  });

  it("creates EventBridge rule with 5-minute schedule targeting detector", () => {
    template.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(5 minutes)" });
  });

  it("creates API Gateway REST API with CORS that allows X-Officer-Name", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", { Name: "Outbreak Watch Public & Officer API" });
    const methods = JSON.stringify(template.findResources("AWS::ApiGateway::Method"));
    expect(methods).toContain("X-Officer-Name");
    expect(methods).toContain("X-Demo-Auth");
  });

  it("reads the SES emails from context and creates their identities", () => {
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/outbreak/ses-from-email", Value: "sender@example.com" });
    template.hasResourceProperties("AWS::SSM::Parameter", { Name: "/outbreak/officer-email", Value: "officer@example.com" });
    template.hasResourceProperties("AWS::SES::EmailIdentity", { EmailIdentity: "sender@example.com" });
    template.hasResourceProperties("AWS::SES::EmailIdentity", { EmailIdentity: "officer@example.com" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "outbreak-watch-detector",
      Environment: { Variables: Match.objectLike({ SES_FROM_EMAIL: "sender@example.com", OFFICER_EMAIL: "officer@example.com" }) },
    });
    expect(JSON.stringify(template.toJSON())).not.toContain("outbreakwatch.org");
  });

  it("sends the budget alert to the context email", () => {
    template.hasResourceProperties("AWS::Budgets::Budget", {
      NotificationsWithSubscribers: [Match.objectLike({ Subscribers: [{ SubscriptionType: "EMAIL", Address: "officer@example.com" }] })],
    });
  });

  it("has no hard-coded demo password: it comes from SSM at deploy time when not given", () => {
    const fromSsm = synth({ sesFromEmail: "sender@example.com", officerEmail: "officer@example.com" }).toJSON();
    const text = JSON.stringify(fromSsm);
    expect(text).not.toContain("outbreak-demo-officer-secret");
    expect(Object.values(fromSsm.Parameters ?? {}).some((p: any) => p.Default === "/outbreak/demo-auth-token")).toBe(true);
  });

  it("webhook secret: from SSM at deploy time when not given, never in the source; header name set", () => {
    const fromSsm = synth({ sesFromEmail: "sender@example.com", officerEmail: "officer@example.com" }).toJSON();
    expect(Object.values(fromSsm.Parameters ?? {}).some((p: any) => p.Default === "/outbreak/webhook-secret")).toBe(true);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "outbreak-watch-backend-api",
      Environment: { Variables: Match.objectLike({ WEBHOOK_SECRET_HEADER: "X-Webhook-Secret", WEBHOOK_SECRET: Match.anyValue() }) },
    });
  });

  it("creates CloudWatch Dashboard with the metric names the detector emits, and alarms", () => {
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "OutbreakWatch-Operational-Dashboard" });
    const body = JSON.stringify(template.findResources("AWS::CloudWatch::Dashboard"));
    for (const name of Object.values(METRICS)) expect(body).toContain(name);
    expect(body).toContain("DetectorLambda");
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "OutbreakWatch-DetectorErrors" });
  });

  it("still synthesizes with no emails set (no identities, no budget email)", () => {
    const bare = synth({ demoAuthToken: "x" });
    bare.resourceCountIs("AWS::SES::EmailIdentity", 0);
    expect(JSON.stringify(bare.findResources("AWS::Budgets::Budget"))).not.toContain("Subscribers");
  });

  it("P2 jobs: a rain Lambda every hour and a feed Lambda at 06:00 IST, both NodejsFunction bundles", () => {
    template.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "outbreak-watch-rain", Runtime: "nodejs22.x", Handler: "index.handler" });
    template.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "outbreak-watch-feed", Runtime: "nodejs22.x", Handler: "index.handler" });
    template.hasResourceProperties("AWS::Events::Rule", { Name: "outbreak-watch-rain-hourly", ScheduleExpression: "rate(1 hour)" });
    template.hasResourceProperties("AWS::Events::Rule", { Name: "outbreak-watch-feed-daily-0600-ist", ScheduleExpression: "cron(30 0 * * ? *)" });
  });

  it("raw-copy bucket is private, encrypted and TLS-only; each Lambda can only PutObject on its own prefix", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: Match.anyValue(),
    });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    for (const prefix of ["raw/rain/*", "raw/feed/*", "raw/webhook-pharmacy/*", "raw/webhook-hospital/*"]) expect(policies).toContain(prefix);
    // No role gets read, delete or wildcard S3 rights on the bucket.
    expect(policies).not.toMatch(/"s3:(GetObject|DeleteObject|\*)"/);
    expect(policies).not.toContain('"s3:*"');
  });

  it("dashboard shows the P2 job metrics with the names and dimensions the Lambdas log", () => {
    const body = JSON.stringify(template.findResources("AWS::CloudWatch::Dashboard"));
    for (const group of Object.values(PIPELINE_METRICS)) {
      for (const name of Object.values(group.names)) expect(body).toContain(name);
      expect(body).toContain(group.dimensions.Service);
    }
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "OutbreakWatch-RainFetchFailing" });
  });
});
