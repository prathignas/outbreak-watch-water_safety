import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Bell, Clock, Database, Home, Info, Map as MapIcon, MessageSquareWarning, Moon, SlidersHorizontal, Sun, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { config } from "@/api/client";
import { getSession } from "@/api/session";
import { useTheme } from "@/app/theme";
import { Switch } from "@/components/ui/switch";
import { useAlerts, useDemoState } from "@/hooks/queries";
import { secondsSince } from "@/lib/clock";
import { fmtFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DemoPanel } from "./DemoPanel";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/proof", label: "Proof", icon: BadgeCheck },
  { to: "/data", label: "Data", icon: Database },
  { to: "/report", label: "Report", icon: MessageSquareWarning },
];

export function HonestyPill() {
  return (
    <p role="note" className="flex items-start gap-3 self-start rounded-[1.375rem] bg-pill-bg px-5 py-2 text-sm text-pill-ink">
      <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>
        <b>{config.mode === "mock" ? "Prototype in mock mode." : "Prototype."}</b> Health signals are simulated, except reports sent through the Report form; rain, ward and water-zone boundaries are real.{" "}
        <Link to="/data" className="font-bold whitespace-nowrap text-pill-ink">Data and sources</Link>
      </span>
    </p>
  );
}

function OpenCount() {
  const open = useAlerts().data?.filter((a) => a.status === "open").length ?? 0;
  if (!open) return null;
  return (
    <span className="absolute top-2 right-3 min-w-6 rounded-full bg-alert-bg px-1.5 text-center font-display text-sm font-bold text-alert-ink" aria-label={`${open} open alerts`}>
      {open}
    </span>
  );
}

function Rail({ onDemo }: { onDemo: () => void }) {
  return (
    <nav aria-label="Main" className="hidden h-full w-[7.5rem] shrink-0 flex-col items-center gap-[min(1.5rem,2.2vh)] overflow-hidden py-[min(1.5rem,2.2vh)] md:flex">
      <Link to="/" className="flex flex-col items-center gap-1 text-center font-display text-sm font-bold text-ink no-underline" aria-label="Outbreak Watch, home">
        <Logo size={44} className="max-h-[5vh] max-w-[5vh]" />
        <span aria-hidden="true">Outbreak<br />Watch</span>
      </Link>
      <ul className="mt-[min(1rem,1.5vh)] flex flex-col gap-[min(1rem,1.6vh)]">
        {NAV.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === "/"}
              className={({ isActive }) => cn("soft-btn relative flex h-[min(5rem,8.4vh)] w-[5.5rem] flex-col items-center justify-center gap-1 rounded-card text-sm text-ink no-underline", isActive && "font-bold text-teal")}>
              <Icon className="size-6" aria-hidden="true" />
              <span>{label}</span>
              {to === "/alerts" && <OpenCount />}
            </NavLink>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onDemo} className="soft-btn mt-auto flex h-[min(5rem,8.4vh)] w-[5.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-card text-sm" aria-keyshortcuts="Shift+D">
        <SlidersHorizontal className="size-6" aria-hidden="true" />
        <span>Demo</span>
      </button>
    </nav>
  );
}

function BottomBar() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex h-[5.5rem] items-center justify-around bg-bg px-2 shadow-[0_-6px_16px_var(--shadow-lo)] md:hidden">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === "/"}
          className={({ isActive }) => cn("relative flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-btn text-xs text-ink no-underline sm:text-sm", isActive && "font-bold text-teal shadow-press")}>
          <Icon className="size-[1.375rem]" aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function PageHeader({ title, brand, children }: { title?: string; brand?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4", brand && "xl:flex-row xl:items-center xl:justify-between xl:gap-6")}>
      {brand ? (
        <div className="flex items-center gap-4">
          <Logo size={52} ripple />
          <div>
            <h1 className="text-[1.625rem] leading-8 font-bold md:text-3xl">Outbreak Watch</h1>
            <p className="text-muted md:text-lg xl:whitespace-nowrap">Early warning for contaminated water, Bengaluru</p>
          </div>
        </div>
      ) : (
        <h1 className="text-3xl font-bold">{title}</h1>
      )}
      {children}
    </div>
  );
}

function TopRight({ onDemo }: { onDemo: () => void }) {
  const { theme, toggle } = useTheme();
  const demo = useDemoState();
  const name = getSession().officerName;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = demo.dataUpdatedAt ? secondsSince(demo.dataUpdatedAt) : null;
  return (
    <div className="flex w-full items-center gap-2 sm:gap-3 md:w-auto md:gap-4">
      {demo.data && (
        <span className="inline-flex items-center gap-2 whitespace-nowrap"><Clock className="size-5" aria-hidden="true" />{fmtFull(demo.data.today)}</span>
      )}
      {ago !== null && <span className="hidden text-muted lg:inline" aria-live="off">Updated {ago} s ago</span>}
      <Switch checked={theme === "dark"} onCheckedChange={toggle} aria-label="Dark theme">
        <Sun className="size-4" aria-hidden="true" /><Moon className="size-4" aria-hidden="true" />
      </Switch>
      {name && <span className="soft-sm hidden h-11 items-center gap-2 rounded-btn px-4 lg:inline-flex"><User className="size-5" aria-hidden="true" />{name}</span>}
      <button type="button" onClick={onDemo} className="soft-btn ml-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-btn px-3 md:hidden">
        <SlidersHorizontal className="size-5" aria-hidden="true" />Demo
      </button>
    </div>
  );
}

/** The app frame: rail (bottom bar on phone), header row, honesty pill, page transitions. */
export function Shell() {
  const [demoOpen, setDemoOpen] = useState(false);
  const location = useLocation();
  const reduce = useReducedMotion();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.shiftKey && (e.key === "D" || e.key === "d") && !typing) setDemoOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const section = location.pathname.split("/")[1] || "home";
  return (
    <div className="flex min-h-screen md:h-screen md:w-screen md:overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-btn focus:bg-bg focus:p-4">Skip to content</a>
      <Rail onDemo={() => setDemoOpen(true)} />
      <div data-scroller className="min-w-0 flex-1 px-4 pt-6 pb-[7rem] md:h-full md:overflow-y-auto md:px-8 md:pt-[min(1.5rem,2.2vh)] md:pb-8 lg:pr-12">
        <div data-content className={cn("mx-auto flex max-w-[105rem] flex-col gap-4", section === "home" ? "md:h-full" : "md:min-h-full")}>
          <div className="flex md:justify-end"><TopRight onDemo={() => setDemoOpen(true)} /></div>
          <AnimatePresence mode="wait">
            <motion.main id="main" key={section} tabIndex={-1} className={cn("flex flex-col gap-6 outline-none md:flex-1", section === "home" && "md:min-h-0")}
              initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}>
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
      <BottomBar />
      <DemoPanel open={demoOpen} onOpenChange={setDemoOpen} />
    </div>
  );
}
