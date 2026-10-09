/* Demo key and officer name, asked once per browser session on the gate screen.
 * sessionStorage can be unavailable (private mode, blocked storage), so every access
 * is guarded and an in-memory copy is kept. */
export interface Session {
  demoKey: string | null;
  officerName: string | null;
}

const KEY = "outbreak-watch-session";
let memory: Session = { demoKey: null, officerName: null };
const clearedListeners = new Set<() => void>();

/** Called after clearSession(), e.g. when the server refuses the demo key. Returns an unsubscribe. */
export function onSessionCleared(listener: () => void): () => void {
  clearedListeners.add(listener);
  return () => clearedListeners.delete(listener);
}

export function getSession(): Session {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) memory = { ...memory, ...(JSON.parse(raw) as Session) };
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
  memory = { demoKey: null, officerName: null };
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  clearedListeners.forEach((listener) => listener());
}
