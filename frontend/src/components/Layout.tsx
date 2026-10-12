import { KanbanSquare, List, LogOut, Moon, Sun, UserCheck, Users } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, type Developer, type SystemRow } from "../api/client";
import { useTheme } from "../lib/theme";
import { usePoll } from "../lib/usePoll";

type Stats = { active_by_system: Record<string, number>; my_active: number };
type Ctx = {
  me: Developer;
  // After the user renames themselves, so the sidebar and assignee lists follow.
  setMe: (me: Developer) => void;
  developers: Developer[];
  systems: SystemRow[];
  stats: Stats;
  // Bumped after any mutation so every open view refetches.
  version: number;
  refresh: () => void;
};
const HubContext = createContext<Ctx | null>(null);
export const useHub = () => useContext(HubContext)!;

function NavItem({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count?: number }) {
  const { pathname, search } = useLocation();
  const [path, qs] = to.split("?");
  const active = pathname === path && (qs ? search.includes(qs) : !search.includes("system="));
  return (
    <NavLink
      to={to}
      className={`relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors ${
        active
          ? "bg-[var(--sidebar-active)] font-semibold text-sidebar-ink"
          : "text-sidebar-ink-muted hover:bg-[var(--sidebar-hover)] hover:text-sidebar-ink"
      }`}
    >
      {active && <span className="absolute -left-[10px] bottom-2 top-2 w-[2px] rounded-r bg-primary" />}
      <span className={active ? "text-primary" : ""}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-[var(--sidebar-hover)] px-1.5 text-[10.5px] font-semibold tabular-nums text-sidebar-ink-muted">
          {count}
        </span>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const [base, setBase] = useState<Omit<Ctx, "stats" | "version" | "refresh" | "setMe"> | null>(null);
  const [stats, setStats] = useState<Stats>({ active_by_system: {}, my_active: 0 });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    Promise.all([
      api<{ developer: Developer }>("/me"),
      api<{ developers: Developer[] }>("/developers"),
      api<{ systems: SystemRow[] }>("/systems"),
    ])
      .then(([m, d, s]) => setBase({ me: m.developer, developers: d.developers, systems: s.systems }))
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadStats = useCallback(() => {
    api<Stats>("/tickets/stats").then(setStats).catch(() => {});
  }, []);
  useEffect(loadStats, [loadStats, version]);
  usePoll(loadStats, 30_000);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const setMe = useCallback(
    (me: Developer) =>
      setBase((b) => b && { ...b, me, developers: b.developers.map((d) => (d.id === me.id ? { ...d, name: me.name } : d)) }),
    [],
  );

  if (error) return <div className="p-10 text-center text-loz-red-ink">{error}</div>;
  if (!base) return <div className="p-10 text-center text-ink-subtlest">Loading...</div>;

  return (
    <HubContext.Provider value={{ ...base, stats, version, refresh, setMe }}>
      <div className="flex h-full">
        <aside className="relative flex w-60 shrink-0 flex-col bg-sidebar">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-accent/35 to-transparent" />
          <div className="flex items-center gap-2.5 border-b border-[var(--sidebar-border)] px-4 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--sidebar-active)] text-[12px] font-bold tracking-wider text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.35)]">
              IT
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold text-sidebar-ink">Houzs IT Hub</div>
              <div className="truncate text-[9.5px] font-bold uppercase tracking-brand text-accent-bright">Tickets</div>
            </div>
          </div>

          <nav className="space-y-0.5 px-3 py-2">
            <div className="px-2.5 pb-1 pt-3 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Workspace</div>
            <NavItem to="/tickets" icon={<List className="h-4 w-4" />} label="List" />
            <NavItem to="/board" icon={<KanbanSquare className="h-4 w-4" />} label="Board" />
            <NavItem to="/queue" icon={<UserCheck className="h-4 w-4" />} label="My queue" count={stats.my_active} />

            <div className="px-2.5 pb-1 pt-5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Systems</div>
            {base.systems.map((s) => (
              <NavItem
                key={s.code}
                to={`/tickets?system=${s.code}`}
                icon={
                  <span className="grid h-5 min-w-[22px] place-items-center rounded border border-[var(--sidebar-border)] px-1 font-docno text-[9px] font-semibold text-accent-bright">
                    {s.code}
                  </span>
                }
                label={s.name}
                count={stats.active_by_system[s.code] ?? 0}
              />
            ))}

            {/* Only hides the link; the API itself refuses non-admins. */}
            {base.me.role === "admin" && (
              <>
                <div className="px-2.5 pb-1 pt-5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Admin</div>
                <NavItem to="/users" icon={<Users className="h-4 w-4" />} label="Users" />
              </>
            )}
          </nav>

          <div className="mt-auto flex items-center gap-2.5 border-t border-[var(--sidebar-border)] px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--sidebar-active)] text-[10px] font-bold uppercase text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.25)]">
              {base.me.name.slice(0, 2)}
            </span>
            <Link to="/account" className="group min-w-0 flex-1" title="My account and password">
              <div className="truncate text-[12px] font-semibold text-sidebar-ink group-hover:text-accent-bright">{base.me.name}</div>
              <div className="truncate text-[10px] text-sidebar-ink-muted">{base.me.email}</div>
            </Link>
            <button
              onClick={toggle}
              className="grid h-8 w-8 place-items-center rounded-md text-sidebar-ink-muted transition-colors hover:bg-[var(--sidebar-hover)] hover:text-accent-bright"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => fetch("/api/v1/auth/logout", { method: "POST" }).finally(() => location.assign("/login"))}
              className="grid h-8 w-8 place-items-center rounded-md text-sidebar-ink-muted transition-colors hover:bg-[var(--sidebar-hover)] hover:text-accent-bright"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </HubContext.Provider>
  );
}
