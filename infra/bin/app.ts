#!/usr/bin/env node
import process from "node:process";
import * as cdk from "aws-cdk-lib";
import { OutbreakWatchStack } from "../src/outbreak-stack.js";

const app = new cdk.App();

// ap-south-1 (Mumbai) unless AWS_REGION says otherwise. CDK_DEFAULT_REGION (from the local AWS profile) is NOT used,
// so a profile set to another region cannot move the stack by accident.
const region = process.env.AWS_REGION || "ap-south-1";
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID || process.env.AWS_DEFAULT_ACCOUNT;

new OutbreakWatchStack(app, "OutbreakWatchStack", {
  env: {
    account,
    region,
  },
  description: "Outbreak Watch - Bengaluru Community Outbreak Early-Warning System (P3 Backend & Infrastructure)",
});

app.synth();
