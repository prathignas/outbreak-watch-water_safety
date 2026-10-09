/*
 * CloudWatch metric names. The ONE list: the detector emits these (EMF logs) and the
 * CDK dashboard reads these, so the two can never drift apart.
 */
export const METRIC_NAMESPACE = "OutbreakWatch";
/** EMF dimension the detector logs with; the dashboard must use the same one. */
export const METRIC_DIMENSIONS = { Service: "DetectorLambda" } as const;
export const METRICS = {
  detectorRuns: "DetectorRuns",
  alertsSent: "AlertsSent",
  alertsHeldBack: "AlertsHeldBack",
  duplicateAlerts: "DuplicateAlerts",
  signalsEvaluated: "SignalsEvaluated",
  detectorErrors: "DetectorErrors",
} as const;
export type MetricValues = Record<keyof typeof METRICS, number>;

/*
 * P2's ingestion jobs. Same namespace; each Lambda logs with its own Service dimension, and the
 * dashboard reads exactly these names and dimensions.
 */
export const PIPELINE_METRICS = {
  rain: {
    dimensions: { Service: "RainLambda" },
    names: { runs: "RainRuns", rowsWritten: "RainRowsWritten", fetchFailures: "RainFetchFailures" },
  },
  feed: {
    dimensions: { Service: "FeedLambda" },
    names: { runs: "FeedRuns", rowsWritten: "FeedRowsWritten", lateRows: "FeedLateRows", failures: "FeedFailures" },
  },
  webhooks: {
    dimensions: { Service: "ApiLambda" },
    names: { rowsWritten: "WebhookRowsWritten", rejected: "WebhookRejected" },
  },
} as const;

/** Logs one CloudWatch Embedded Metric Format line (CloudWatch turns it into metrics). */
export function emitMetrics(dimensions: Record<string, string>, values: Record<string, number>): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: METRIC_NAMESPACE, Dimensions: [Object.keys(dimensions)], Metrics: Object.keys(values).map((Name) => ({ Name, Unit: "Count" })) },
        ],
      },
      ...dimensions,
      ...values,
    })
  );
}
