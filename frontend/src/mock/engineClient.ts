/* A promise interface to the mock backend: a Web Worker in the browser, a direct instance in tests. */
import { istDay, nowMs } from "@/lib/clock";
import type { MockBackend } from "./backend";
import { MockError } from "./backend";

type Methods = {
  [K in keyof MockBackend as MockBackend[K] extends (...args: never[]) => unknown ? K : never]: MockBackend[K];
};
export type Engine = {
  call<K extends keyof Methods>(method: K, ...args: Parameters<Methods[K]>): Promise<ReturnType<Methods[K]>>;
};

export function workerEngine(): Engine {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; value?: unknown; status?: number; message?: string }>) => {
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    if (event.data.ok) p.resolve(event.data.value);
    else p.reject(new MockError(event.data.status ?? 500, event.data.message ?? "Mock engine error"));
  };
  return {
    call(method, ...args) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        const now = nowMs();
        worker.postMessage({ id, method, args, clock: { now, today: istDay(now) } });
      });
    },
  };
}

export function directEngine(backend: MockBackend): Engine {
  return {
    async call(method, ...args) {
      const fn = (backend as unknown as Record<string, (...a: unknown[]) => unknown>)[method as string];
      return fn.apply(backend, args) as never;
    },
  };
}
