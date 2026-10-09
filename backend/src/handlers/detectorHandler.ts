import { executeDetector, type DetectorExecutionResult } from "../detector/orchestrator.js";
import { type ScheduledEvent, type Context } from "aws-lambda";

/** Manual invoke: { "date": "YYYY-MM-DD" } runs up to that day; { "rerunFrom": "YYYY-MM-DD" } re-runs from a day. */
export interface CustomDetectorEvent {
  date?: string;
  rerunFrom?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handler(
  event?: ScheduledEvent | CustomDetectorEvent,
  _context?: Context
): Promise<{ statusCode: number; result: DetectorExecutionResult }> {
  console.log("[DetectorLambda] Invoked with event:", JSON.stringify(event ?? {}));

  const customEvent = (event ?? {}) as CustomDetectorEvent;
  const date = typeof customEvent.date === "string" && DATE.test(customEvent.date) ? customEvent.date : undefined;
  const rerunFrom = typeof customEvent.rerunFrom === "string" && DATE.test(customEvent.rerunFrom) ? customEvent.rerunFrom : undefined;

  try {
    const result = await executeDetector({ date, rerunFrom });
    console.log("[DetectorLambda] Finished successfully:", { ...result, alerts: result.alerts.map((a) => a.id) });
    return { statusCode: 200, result };
  } catch (err: any) {
    console.error("[DetectorLambda] Error running detector:", err);
    throw err;
  }
}
