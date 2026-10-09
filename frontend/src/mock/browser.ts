/* Starts MSW in the browser (mock mode only). The engine runs in a Web Worker. */
import { setupWorker } from "msw/browser";
import { workerEngine } from "./engineClient";
import { makeHandlers } from "./handlers";

export async function startMockApi(): Promise<void> {
  const worker = setupWorker(...makeHandlers(workerEngine()));
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
