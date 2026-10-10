import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ses from "aws-cdk-lib/aws-ses";
import * as logs from "aws-cdk-lib/aws-logs";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS, METRIC_DIMENSIONS, METRIC_NAMESPACE, PIPELINE_METRICS } from "@outbreak/backend/metrics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "../..");

/** SSM parameter that holds the demo password. Create it before deploying (infra/README.md). */
export const DEMO_TOKEN_PARAM = "/outbreak/demo-auth-token";
/** SSM parameter that holds the webhook secret for /webhooks/pharmacy|hospital. Create it before deploying. */
export const WEBHOOK_SECRET_PARAM = "/outbreak/webhook-secret";

/**
 * Settings read at deploy time from CDK context (-c name=value) or the environment.
 * No email address or password is written in this file.
 */
function setting(scope: Construct, contextKey: string, envKey: string): string | undefined {
  const value = scope.node.tryGetContext(contextKey) ?? process.env[envKey];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class OutbreakWatchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sesFromEmail = setting(this, "sesFromEmail", "SES_FROM_EMAIL");
    const officerEmail = setting(this, "officerEmail", "OFFICER_EMAIL");
    const budgetEmail = setting(this, "budgetEmail", "BUDGET_EMAIL") ?? officerEmail;
    const corsOrigin = setting(this, "corsOrigin", "CORS_ALLOW_ORIGIN") ?? "*";
    // Demo password: DEMO_AUTH_TOKEN at deploy time if given, else the SSM parameter (resolved by CloudFormation).
    const demoAuthToken = setting(this, "demoAuthToken", "DEMO_AUTH_TOKEN") ?? ssm.StringParameter.valueForStringParameter(this, DEMO_TOKEN_PARAM);
    // Webhook secret: WEBHOOK_SECRET at deploy time if given, else the SSM parameter. Header name: default X-Webhook-Secret.
    const webhookSecret = setting(this, "webhookSecret", "WEBHOOK_SECRET") ?? ssm.StringParameter.valueForStringParameter(this, WEBHOOK_SECRET_PARAM);
    const webhookSecretHeader = setting(this, "webhookSecretHeader", "WEBHOOK_SECRET_HEADER") ?? "X-Webhook-Secret";

    if (!sesFromEmail || !officerEmail) {
      cdk.Annotations.of(this).addWarning(
        "SES_FROM_EMAIL and OFFICER_EMAIL are not set (context sesFromEmail/officerEmail or env). Alerts will be saved but no email is sent."
      );
    }

    // ==========================================
    // 1. VPC & NETWORKING
    // ==========================================
    const vpc = new ec2.Vpc(this, "OutbreakVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "PublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "OutbreakDbSecurityGroup", {
      vpc,
      description: "Allow inbound PostgreSQL traffic with TLS",
      allowAllOutbound: true,
    });

    // LIMIT (infra/README.md): the database is public. The Lambdas run outside the VPC.
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Allow PostgreSQL port 5432 connections with TLS"
    );

    // ==========================================
    // 2. DATABASE CREDENTIALS & SECRETS
    // ==========================================
    const dbSecret = new secretsmanager.Secret(this, "OutbreakDbSecret", {
      secretName: "outbreak/db/credentials",
      description: "Database credentials for Outbreak Watch RDS PostgreSQL",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: "outbreak_admin",
          dbname: "outbreak_watch",
        }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    // ==========================================
    // 3. RDS POSTGRESQL + POSTGIS INSTANCE
    // ==========================================
    const dbInstance = new rds.DatabaseInstance(this, "OutbreakPostgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: "outbreak_watch",
      // Cost (infra/README.md): smallest single-AZ instance, 20 GB (autoscaling capped at 50 GB). The live
      // instance already runs 1-day backups, no Performance Insights, no enhanced monitoring (RDS defaults).
      // Not set explicitly here: on the live stack CloudFormation marks backup/Multi-AZ/gp3 edits as
      // "may replace" the instance (and its data). Change them in a planned window with a snapshot first.
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageEncrypted: true,
      publiclyAccessible: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================
    // 4. SSM PARAMETER STORE (CONFIG) & SES IDENTITIES (SANDBOX MODE)
    // ==========================================
    // The demo password is NOT created here: create /outbreak/demo-auth-token yourself before deploying.
    // In the SES sandbox both the sender and the recipient must be verified: AWS emails each
    // address a link that must be clicked before any alert email can be sent.
    if (sesFromEmail) {
      new ssm.StringParameter(this, "SesFromEmailParam", {
        parameterName: "/outbreak/ses-from-email",
        stringValue: sesFromEmail,
        description: "Verified SES sender email address for alert notifications",
      });
      new ses.EmailIdentity(this, "SesSenderIdentity", { identity: ses.Identity.email(sesFromEmail) });
    }
    if (officerEmail) {
      new ssm.StringParameter(this, "OfficerEmailParam", {
        parameterName: "/outbreak/officer-email",
        stringValue: officerEmail,
        description: "Recipient email address for municipal health officers",
      });
      if (officerEmail !== sesFromEmail) new ses.EmailIdentity(this, "SesOfficerIdentity", { identity: ses.Identity.email(officerEmail) });
    }

    // ==========================================
    // 5. CLOUDWATCH LOG GROUPS & LAMBDA FUNCTIONS (esbuild bundles of backend/src/handlers)
    // ==========================================
    const backendLogGroup = new logs.LogGroup(this, "BackendApiLogGroup", {
      logGroupName: "/aws/lambda/outbreak-watch-backend-api",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const detectorLogGroup = new logs.LogGroup(this, "DetectorScheduleLogGroup", {
      logGroupName: "/aws/lambda/outbreak-watch-detector",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const rainLogGroup = new logs.LogGroup(this, "RainLogGroup", {
      logGroupName: "/aws/lambda/outbreak-watch-rain",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const feedLogGroup = new logs.LogGroup(this, "FeedLogGroup", {
      logGroupName: "/aws/lambda/outbreak-watch-feed",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const dbSetupLogGroup = new logs.LogGroup(this, "DbSetupLogGroup", {
      logGroupName: "/aws/lambda/outbreak-watch-db-setup",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /**
     * One esbuild bundle per handler. P1's city.json is imported, so it is inside the bundle.
     * Files read at run time are copied next to the bundle after bundling:
     * the migrations (all), P1's backtest results without "runs" (API), P1's ward and zone shapes (DB setup).
     */
    const bundle = (copy: { migrations?: boolean; backtest?: boolean; shapes?: boolean }): nodejs.BundlingOptions => ({
      format: nodejs.OutputFormat.ESM,
      target: "node22",
      mainFields: ["module", "main"],
      minify: false,
      sourceMap: true,
      // pg and friends are CommonJS; give the ESM bundle a require().
      banner: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
      externalModules: ["@aws-sdk/*", "pg-native"],
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (_inputDir: string, outputDir: string) => [
          ...(copy.migrations ? [`cp -R "${join(REPO_ROOT, "backend/src/db/migrations")}" "${outputDir}/migrations"`] : []),
          ...(copy.backtest
            ? [`node "${join(REPO_ROOT, "infra/scripts/slim-backtest.mjs")}" "${join(REPO_ROOT, "detection/results/backtest.json")}" "${outputDir}/backtest.json"`]
            : []),
          ...(copy.shapes
            ? [
                `cp "${join(REPO_ROOT, "detection/data/wards.geojson")}" "${outputDir}/wards.geojson"`,
                `cp "${join(REPO_ROOT, "detection/data/zones.geojson")}" "${outputDir}/zones.geojson"`,
              ]
            : []),
        ],
      },
    });

    const handlerEntry = (file: string) => join(REPO_ROOT, "backend/src/handlers", file);

    // Raw copies of every input (Open-Meteo answers, feed batches, webhook batches), by India day:
    // raw/<source>/<YYYY-MM-DD>/... Private, encrypted, TLS only. Each Lambda can only add to its own prefix.
    const rawBucket = new s3.Bucket(this, "RawInputBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const commonEnv = {
      DB_SECRET_ARN: dbSecret.secretArn,
      NODE_ENV: "production",
      NODE_OPTIONS: "--enable-source-maps",
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
    };
    const emailEnv = { SES_FROM_EMAIL: sesFromEmail ?? "", OFFICER_EMAIL: officerEmail ?? "" };

    // Backend REST API Lambda (the demo inject and reset also run the detector, so it can email too)
    const backendLambda = new nodejs.NodejsFunction(this, "BackendApiFunction", {
      functionName: "outbreak-watch-backend-api",
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: handlerEntry("apiHandler.ts"),
      handler: "handler",
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, "package-lock.json"),
      bundling: bundle({ migrations: true, backtest: true }),
      logGroup: backendLogGroup,
      timeout: cdk.Duration.seconds(29), // API Gateway's limit
      memorySize: 1024,
      environment: {
        ...commonEnv,
        ...emailEnv,
        DEMO_AUTH_TOKEN: demoAuthToken,
        RAW_BUCKET: rawBucket.bucketName,
        WEBHOOK_SECRET: webhookSecret,
        WEBHOOK_SECRET_HEADER: webhookSecretHeader,
        CORS_ALLOW_ORIGIN: corsOrigin,
      },
    });

    // Scheduled Detector Lambda (every 5 minutes; once today has run, it recomputes today from yesterday's saved state)
    const detectorLambda = new nodejs.NodejsFunction(this, "DetectorScheduleFunction", {
      functionName: "outbreak-watch-detector",
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: handlerEntry("detectorHandler.ts"),
      handler: "handler",
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, "package-lock.json"),
      bundling: bundle({}),
      logGroup: detectorLogGroup,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: { ...commonEnv, ...emailEnv },
    });

    // One-off DB setup Lambda: migrations + seed. Run once after deploy (see the DbSetupCommand output).
    const dbSetupLambda = new nodejs.NodejsFunction(this, "DbSetupFunction", {
      functionName: "outbreak-watch-db-setup",
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: handlerEntry("dbSetupHandler.ts"),
      handler: "handler",
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, "package-lock.json"),
      bundling: bundle({ migrations: true, shapes: true }),
      logGroup: dbSetupLogGroup,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      // The demo key lets the scenario's officer actions go through the API routes.
      environment: { ...commonEnv, DEMO_AUTH_TOKEN: demoAuthToken },
    });

    // P2's rain job: hourly, real Open-Meteo rain into all 243 wards (backend/src/handlers/rainHandler.ts)
    const rainLambda = new nodejs.NodejsFunction(this, "RainFunction", {
      functionName: "outbreak-watch-rain",
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: handlerEntry("rainHandler.ts"),
      handler: "handler",
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, "package-lock.json"),
      bundling: bundle({}),
      logGroup: rainLogGroup,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: { ...commonEnv, RAW_BUCKET: rawBucket.bucketName },
    });

    // P2's synthetic feed: daily, IST morning; P1's rowsArrivingOn(today) (backend/src/handlers/feedHandler.ts)
    const feedLambda = new nodejs.NodejsFunction(this, "FeedFunction", {
      functionName: "outbreak-watch-feed",
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: handlerEntry("feedHandler.ts"),
      handler: "handler",
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, "package-lock.json"),
      bundling: bundle({}),
      logGroup: feedLogGroup,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: {
        ...commonEnv,
        RAW_BUCKET: rawBucket.bucketName,
        // Pharmacy/hospital rows go through the API's webhooks (API_URL is added once the API exists).
        WEBHOOK_SECRET: webhookSecret,
        WEBHOOK_SECRET_HEADER: webhookSecretHeader,
      },
    });

    // Least-privilege permissions
    for (const fn of [backendLambda, detectorLambda, dbSetupLambda, rainLambda, feedLambda]) dbSecret.grantRead(fn);
    // Write-only (s3:PutObject) on each Lambda's own prefix; nobody can read or delete through these roles.
    const putRaw = (fn: lambda.IFunction, prefix: string) =>
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [rawBucket.arnForObjects(`${prefix}*`)] }));
    putRaw(rainLambda, "raw/rain/");
    putRaw(feedLambda, "raw/feed/");
    putRaw(backendLambda, "raw/webhook-pharmacy/");
    putRaw(backendLambda, "raw/webhook-hospital/");

    const sesPolicy = new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`],
    });
    detectorLambda.addToRolePolicy(sesPolicy);
    backendLambda.addToRolePolicy(sesPolicy);

    // ==========================================
    // 6. EVENTBRIDGE SCHEDULE (EVERY 5 MINUTES)
    // ==========================================
    const detectorRule = new events.Rule(this, "DetectorScheduleRule", {
      ruleName: "outbreak-watch-every-5-minutes",
      description: "Triggers Outbreak Watch detection cycle every 5 minutes",
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    detectorRule.addTarget(new targets.LambdaFunction(detectorLambda));

    // Rain: every hour (Open-Meteo updates during the day; the last 7 days are re-written).
    new events.Rule(this, "RainScheduleRule", {
      ruleName: "outbreak-watch-rain-hourly",
      description: "Fetches real Open-Meteo rain every hour",
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    }).addTarget(new targets.LambdaFunction(rainLambda));

    // Synthetic feed: 06:00 India time (00:30 UTC) every day. The detector picks the rows up on its next 5-minute run.
    new events.Rule(this, "FeedScheduleRule", {
      ruleName: "outbreak-watch-feed-daily-0600-ist",
      description: "Writes P1's synthetic rows that arrive today (06:00 IST)",
      schedule: events.Schedule.cron({ minute: "30", hour: "0" }),
    }).addTarget(new targets.LambdaFunction(feedLambda));

    // ==========================================
    // 7. API GATEWAY
    // ==========================================
    const corsHeaders = ["Content-Type", "X-Demo-Auth", "X-Officer-Name", "Authorization", "X-Amz-Date", "X-Api-Key"];
    const api = new apigateway.LambdaRestApi(this, "OutbreakRestApi", {
      handler: backendLambda,
      proxy: true,
      restApiName: "Outbreak Watch Public & Officer API",
      description: "API Gateway proxy to Outbreak Watch Backend Lambda",
      defaultCorsPreflightOptions: {
        allowOrigins: corsOrigin === "*" ? apigateway.Cors.ALL_ORIGINS : [corsOrigin],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: corsHeaders,
      },
    });
    feedLambda.addEnvironment("API_URL", api.url);

    // Errors made by API Gateway itself (e.g. a Lambda timeout) also need CORS, or the browser hides them.
    for (const [id, type] of [["Default4xx", apigateway.ResponseType.DEFAULT_4XX], ["Default5xx", apigateway.ResponseType.DEFAULT_5XX]] as const) {
      api.addGatewayResponse(id, {
        type,
        responseHeaders: {
          "Access-Control-Allow-Origin": `'${corsOrigin}'`,
          "Access-Control-Allow-Headers": `'${corsHeaders.join(",")}'`,
        },
        templates: { "application/json": '{ "message": $context.error.messageString }' },
      });
    }

    // ==========================================
    // 8. CLOUDWATCH DASHBOARD & OPERATIONAL METRICS
    // ==========================================
    // Names and dimensions come from backend/src/metrics.ts: the same list the detector emits.
    const metric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        dimensionsMap: { ...METRIC_DIMENSIONS },
        statistic: "sum",
        period: cdk.Duration.minutes(5),
      });

    const dashboard = new cloudwatch.Dashboard(this, "OutbreakWatchDashboard", {
      dashboardName: "OutbreakWatch-Operational-Dashboard",
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Detector Runs & Alerts Sent (5-min sum)",
        left: [metric(METRICS.detectorRuns), metric(METRICS.alertsSent), metric(METRICS.alertsHeldBack), metric(METRICS.duplicateAlerts)],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Signals Evaluated",
        left: [metric(METRICS.signalsEvaluated)],
        width: 12,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Errors & Failures (API Gateway, Lambdas & Detector)",
        left: [
          api.metricClientError(),
          api.metricServerError(),
          detectorLambda.metricErrors(),
          backendLambda.metricErrors(),
          metric(METRICS.detectorErrors),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "RDS PostgreSQL Health",
        left: [dbInstance.metricCPUUtilization()],
        right: [dbInstance.metricDatabaseConnections()],
        width: 12,
      })
    );

    // P2's ingestion jobs: names and dimensions from backend/src/metrics.ts (PIPELINE_METRICS).
    const pipelineMetric = (group: keyof typeof PIPELINE_METRICS, metricName: string, period = cdk.Duration.hours(1)) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        dimensionsMap: { ...PIPELINE_METRICS[group].dimensions },
        statistic: "sum",
        period,
      });
    const R = PIPELINE_METRICS.rain.names;
    const F = PIPELINE_METRICS.feed.names;
    const W = PIPELINE_METRICS.webhooks.names;
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Rain job (hourly): runs, rows written, failed fetches",
        left: [pipelineMetric("rain", R.runs), pipelineMetric("rain", R.fetchFailures), rainLambda.metricErrors({ period: cdk.Duration.hours(1) })],
        right: [pipelineMetric("rain", R.rowsWritten)],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: "Synthetic feed (daily): rows, late rows, failures",
        left: [pipelineMetric("feed", F.runs, cdk.Duration.days(1)), pipelineMetric("feed", F.failures, cdk.Duration.days(1)), feedLambda.metricErrors({ period: cdk.Duration.days(1) })],
        right: [pipelineMetric("feed", F.rowsWritten, cdk.Duration.days(1)), pipelineMetric("feed", F.lateRows, cdk.Duration.days(1))],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: "Webhooks: rows written, batches rejected",
        left: [pipelineMetric("webhooks", W.rowsWritten), pipelineMetric("webhooks", W.rejected)],
        width: 8,
      })
    );

    new cloudwatch.Alarm(this, "RainFetchAlarm", {
      alarmName: "OutbreakWatch-RainFetchFailing",
      alarmDescription: "Rain has not been fetched for 3 hours in a row (nothing is written when the fetch fails)",
      metric: pipelineMetric("rain", R.fetchFailures),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Operational Alarm for Detector Failures
    new cloudwatch.Alarm(this, "DetectorErrorAlarm", {
      alarmName: "OutbreakWatch-DetectorErrors",
      alarmDescription: "Alerts when Detector Lambda encounters failures in consecutive runs",
      metric: detectorLambda.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 2,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // ==========================================
    // 7.1 FRONTEND HOSTING: private S3 bucket behind CloudFront (origin access control)
    // ==========================================
    // Off by default: the live frontend is on AWS Amplify Hosting (built from the repo). Deploy with
    // -c cloudfront=true (or FRONTEND_CLOUDFRONT=true) to host it here instead.
    // The built frontend (frontend/dist) is synced here (DEPLOY.md). Nothing in the bucket is public:
    // only this distribution can read it. Unknown paths fall back to index.html (the app's own router).
    if (setting(this, "cloudfront", "FRONTEND_CLOUDFRONT") === "true") {
      const siteBucket = new s3.Bucket(this, "SiteBucket", {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
      const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
        comment: "Outbreak Watch frontend",
        defaultRootObject: "index.html",
        // Price class 200 includes the Indian edge locations; the free tier (1 TB, 10M requests a month) covers the demo.
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        // SPA fallback: a private bucket answers 403 for a missing key; serve the app instead.
        errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) })),
      });
      new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}`, description: "The live frontend (CloudFront)" });
      new cdk.CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName, description: "Sync frontend/dist here" });
      new cdk.CfnOutput(this, "SiteDistributionId", { value: distribution.distributionId, description: "Invalidate after each sync" });
    }

    // ==========================================
    // 8.1 AWS BUDGET & COST CONTROLS ($30/MONTH)
    // ==========================================
    new budgets.CfnBudget(this, "OutbreakMonthlyBudget", {
      budget: {
        budgetName: "outbreak-watch-monthly-30usd",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: 30,
          unit: "USD",
        },
      },
      notificationsWithSubscribers: budgetEmail
        ? [
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 80,
                thresholdType: "PERCENTAGE",
              },
              subscribers: [{ subscriptionType: "EMAIL", address: budgetEmail }],
            },
          ]
        : undefined,
    });

    // ==========================================
    // 9. STACK OUTPUTS
    // ==========================================
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway Base URL for Outbreak Watch (the frontend's VITE_API_BASE_URL)",
      exportName: "OutbreakWatchApiUrl",
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: dbInstance.dbInstanceEndpointAddress,
      description: "RDS PostgreSQL Database Hostname",
      exportName: "OutbreakWatchDbEndpoint",
    });

    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: dbSecret.secretArn,
      description: "AWS Secrets Manager Secret ARN for Database Credentials",
      exportName: "OutbreakWatchDbSecretArn",
    });

    new cdk.CfnOutput(this, "BackendLambdaName", { value: backendLambda.functionName, description: "Backend API Lambda Function Name" });
    new cdk.CfnOutput(this, "DetectorLambdaName", { value: detectorLambda.functionName, description: "Scheduled Detector Lambda Function Name" });
    new cdk.CfnOutput(this, "DbSetupCommand", {
      value: `aws lambda invoke --function-name ${dbSetupLambda.functionName} --region ${this.region} --cli-read-timeout 310 db-setup.json && cat db-setup.json`,
      description: "Run once after the first deploy: migrations + seed",
    });
    new cdk.CfnOutput(this, "RainLambdaName", { value: rainLambda.functionName, description: "Hourly rain Lambda" });
    new cdk.CfnOutput(this, "FeedLambdaName", { value: feedLambda.functionName, description: "Daily synthetic-feed Lambda" });
    new cdk.CfnOutput(this, "RawBucketName", { value: rawBucket.bucketName, description: "Raw copies of every input, by day" });
    new cdk.CfnOutput(this, "DashboardName", { value: dashboard.dashboardName, description: "CloudWatch Operational Dashboard Name" });
    if (sesFromEmail) new cdk.CfnOutput(this, "SesSenderEmail", { value: sesFromEmail, description: "SES sender (must be verified)" });
    if (officerEmail) new cdk.CfnOutput(this, "SesRecipientEmail", { value: officerEmail, description: "SES recipient (must be verified in the sandbox)" });
  }
}
