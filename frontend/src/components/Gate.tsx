import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { setSession } from "@/api/session";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { HonestyPill } from "./Shell";

/** Asks once per session for the demo key (sent as X-Demo-Auth) and a display name (X-Officer-Name). */
export function Gate({ onDone, wrongKey }: { onDone: () => void; wrongKey?: boolean }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(wrongKey ? "That demo key was not accepted. Enter it again." : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return setError("Enter the demo key.");
    if (!name.trim()) return setError("Enter your name. It is shown in the activity log.");
    setSession({ demoKey: key.trim(), officerName: name.trim().slice(0, 80) });
    onDone();
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-4">
        <Logo size={64} ripple />
        <div>
          <h1 className="text-3xl font-bold">Outbreak Watch</h1>
          <p className="text-lg text-muted">Early warning for contaminated water, Bengaluru</p>
        </div>
      </div>
      <HonestyPill />
      <form onSubmit={submit} className="soft-lg edge grid gap-6 rounded-lg p-8" noValidate>
        <h2 className="text-2xl font-bold">Enter the demo</h2>
        <label className="grid gap-2">
          <span className="font-bold">Demo key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
            className="soft-in h-12 rounded-btn px-4 text-ink outline-none focus-visible:outline-3" aria-describedby="gate-error" />
        </label>
        <label className="grid gap-2">
          <span className="font-bold">Your name</span>
          <span className="text-sm text-muted">Shown next to what you do (acknowledge, resolve, notes). Demo only, no login.</span>
          <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
            className="soft-in h-12 rounded-btn px-4 text-ink outline-none" aria-describedby="gate-error" />
        </label>
        <p id="gate-error" role="alert" className="min-h-6 font-bold text-[var(--danger-ink)]">{error}</p>
        <Button type="submit" variant="primary" className="justify-self-start"><LogIn aria-hidden="true" />Enter</Button>
      </form>
    </main>
  );
}
