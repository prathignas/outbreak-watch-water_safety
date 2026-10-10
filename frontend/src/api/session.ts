/* Demo key and officer name sent with every request. No login page: in real mode the presenter
 * types the demo key into the Demo panel (it is never in the build); mock mode uses the mock key.
 * sessionStorage can be unavailable (private mode, blocked storage), so every access
 * is guarded and an in-memory copy is kept. */
export interface Session {
  demoKey: string | null;
  officerName: string | null;
}

const KEY = "outbreak-watch-session";
/** Only Reset and Inject need the demo key. A real build has none: the presenter enters it once per tab. */
const buildKey = import.meta.env.VITE_API_MODE === "real" ? null : import.meta.env.VITE_DEMO_KEY || "watch-demo";
const DEFAULTS: Session = { demoKey: buildKey, officerName: "Demo officer" };
let memory: Session = { ...DEFAULTS };

export function getSession(): Session {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Session;
      memory = { demoKey: stored.demoKey ?? DEFAULTS.demoKey, officerName: stored.officerName || DEFAULTS.officerName };
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

/** The presenter's demo key for this tab (null forgets it, e.g. after the server refused it). */
export function setDemoKey(demoKey: string | null): void {
  setSession({ ...getSession(), demoKey: demoKey?.trim() || null });
}

/**
 * Judge link: https://<site>/demo#key=<demo key>. Run once at startup. The key goes to
 * sessionStorage for this tab only (never localStorage) and the fragment is removed at once,
 * so it is not left in the address bar or history. The key is never logged.
 */
export function captureDemoKeyFromUrl(): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const key = params.get("key")?.trim();
  if (!key) return;
  setDemoKey(key);
  params.delete("key");
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`);
}
