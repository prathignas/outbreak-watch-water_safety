/* Demo key and officer name sent with every request. Defaults come from the build; no login page.
 * sessionStorage can be unavailable (private mode, blocked storage), so every access
 * is guarded and an in-memory copy is kept. */
export interface Session {
  demoKey: string | null;
  officerName: string | null;
}

const KEY = "outbreak-watch-session";
/** No login page: the demo key comes from the build (VITE_DEMO_KEY, same value as the API's DEMO_AUTH_TOKEN). */
const DEFAULTS: Session = { demoKey: import.meta.env.VITE_DEMO_KEY || "watch-demo", officerName: "Demo officer" };
let memory: Session = { ...DEFAULTS };

export function getSession(): Session {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Session;
      memory = { demoKey: stored.demoKey || DEFAULTS.demoKey, officerName: stored.officerName || DEFAULTS.officerName };
    }
  } catch {
    // storage unavailable: use the in-memory copy
  }
  return memory;
}

export function setSession(next: Session): void {
  memory = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: in-memory only
  }
}

export function clearSession(): void {
  memory = { ...DEFAULTS };
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
