import { Bell, ChevronDown, KanbanSquare, List, LogOut, Menu, Moon, Plug, ShieldCheck, Sun, UserCheck, Users } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, json, type Perm, type User, type SystemRow } from "../api/client";
import { useTheme } from "../lib/theme";
import { usePoll } from "../lib/usePoll";
import FirstPasswordPage from "../pages/FirstPasswordPage";
import { Avatar } from "./Bits";
import NewTicketToasts from "./NewTicketToasts";
import { NotificationBell } from "./Notifications";

type Stats = { active_by_system: Record<string, number>; my_active: number; unread_notifications: number };

const IT_PATH = /^\/($|tickets|board|queue|notifications)/;

const PAGE_NAMES: Record<string, string> = {
  "/tickets": "List",
  "/board": "Board",
  "/queue": "My queue",
  "/notifications": "Notifications",
  "/users": "Users",
  "/account": "My account",
  "/integrations": "Integrations",
  "/roles": "Roles",
};

// "/tickets?system=HK&selected=HK-12" -> "HK-12", "/board?system=HK" -> "Board · HK"
export function pageLabel(page: string | null) {
  if (!page) return "";
  const url = new URL(page, "http://x");
  const ticket = url.pathname.match(/^\/tickets\/([^/]+)$/)?.[1] ?? url.searchParams.get("selected");
  if (ticket) return decodeURIComponent(ticket);
  const name = PAGE_NAMES[url.pathname] ?? url.pathname;
  const system = url.searchParams.get("system");
  return system ? `${name} · ${system}` : name;
}
type Ctx = {
  me: User;
  // After the user renames themselves, so the sidebar and assignee lists follow.
  setMe: (me: User) => void;
  users: User[];
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
  const [stats, setStats] = useState<Stats>({ active_by_system: {}, my_active: 0, unread_notifications: 0 });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Set when the account still has a handed-out password; the server refuses
  // everything but /me and /me/password until it is replaced.
  const [firstLogin, setFirstLogin] = useState<string | null>(null);
  const { theme, toggle } = useTheme();
  const [presence, setPresence] = useState<{ id: number; page: string | null }[]>([]);
  const { pathname, search } = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  useEffect(() => setIsMenuOpen(false), [pathname, search]);
  const [itOpen, setItOpen] = useState(() => {
    try {
      return localStorage.getItem("sidebar.it") !== "closed";
    } catch {
      return true;
    }
  });
  const toggleIt = () =>
    setItOpen((o) => {
      try {
        localStorage.setItem("sidebar.it", o ? "closed" : "open");
      } catch {}
      return !o;
    });

  useEffect(() => {
    api<{ user: User }>("/me")
      .then(async ({ user: me }) => {
        if (me.mustChangePassword) return setFirstLogin(me.name);
        const [d, s] = await Promise.all([
          api<{ users: User[] }>("/users"),
          api<{ systems: SystemRow[] }>("/systems"),
        ]);
        setBase({ me, users: d.users, systems: s.systems });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadStats = useCallback(() => {
    if (base?.me.perms?.includes("it")) api<Stats>("/tickets/stats").then(setStats).catch(() => {});
  }, [base]);
  useEffect(loadStats, [loadStats, version]);
  usePoll(loadStats, 60_000);

  const checkIn = useCallback(() => {
    if (base) api<{ online: typeof presence }>("/presence", json("POST", { page: pathname + search }))
      .then((r) => setPresence(r.online))
      .catch(() => {});
  }, [base, pathname, search]);
  useEffect(checkIn, [checkIn]);
  usePoll(checkIn, 15_000);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const setMe = useCallback(
    (me: User) =>
      setBase((b) => b && { ...b, me, users: b.users.map((d) => (d.id === me.id ? { ...d, name: me.name } : d)) }),
    [],
  );

  const online = presence.flatMap((p) => {
    const u = base?.users.find((d) => d.id === p.id);
    return u && u.id !== base!.me.id ? [{ ...u, page: p.page }] : [];
  });

  const can = (...p: Perm[]) => p.some((x) => base?.me.perms?.includes(x));
  // Without IT, land on the first admin page they may open, else My account.
  const landing = can("users", "roles") ? "/users" : can("integrations") ? "/integrations" : "/account";
  const itActive = Object.values(stats.active_by_system).reduce((a, n) => a + n, 0);

  if (firstLogin) return <FirstPasswordPage name={firstLogin} />;
  if (error) return <div className="p-10 text-center text-loz-red-ink">{error}</div>;
  if (!base) return <div className="p-10 text-center text-ink-subtlest">Loading...</div>;

  return (
    <HubContext.Provider value={{ ...base, stats, version, refresh, setMe }}>
      <div className="flex h-full">
        {isMenuOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setIsMenuOpen(false)} />}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-sidebar transition-transform motion-reduce:transition-none lg:relative lg:translate-x-0 ${
            isMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-accent/35 to-transparent" />
          <div className="relative flex items-center gap-2.5 border-b border-[var(--sidebar-border)] py-4 pl-4 pr-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--sidebar-active)] text-[12px] font-bold tracking-wider text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.35)]">
              IT
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold text-sidebar-ink">Houzs IT Hub</div>
              <div className="truncate text-[9.5px] font-bold uppercase tracking-brand text-accent-bright">Tickets</div>
            </div>
            {can("it") && (
              <div className="ml-auto">
                <NotificationBell />
              </div>
            )}
          </div>

          <nav className="space-y-0.5 px-3 py-2">
            {/* The IT category (workspace views and its systems), shown with the "it"
                permission. The server refuses ticket routes without it too. */}
            {can("it") && (
            <button
              onClick={toggleIt}
              aria-expanded={itOpen}
              className="flex w-full items-center gap-1.5 px-2.5 pb-1 pt-3 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted hover:text-sidebar-ink"
            >
              <span className="flex-1 text-left">IT</span>
              {!itOpen && itActive > 0 && (
                <span className="rounded-full bg-[var(--sidebar-hover)] px-1.5 text-[10.5px] normal-case tracking-normal tabular-nums">{itActive}</span>
              )}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${itOpen ? "" : "-rotate-90"}`} />
            </button>
            )}
            {can("it") && itOpen && (
              <>
                <div className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-brand text-sidebar-ink-muted/70">Workspace</div>
                <NavItem to="/tickets" icon={<List className="h-4 w-4" />} label="List" />
                <NavItem to="/board" icon={<KanbanSquare className="h-4 w-4" />} label="Board" />
                <NavItem to="/queue" icon={<UserCheck className="h-4 w-4" />} label="My queue" count={stats.my_active} />
                <NavItem to="/notifications" icon={<Bell className="h-4 w-4" />} label="Notifications" count={stats.unread_notifications} />

                <div className="px-2.5 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-brand text-sidebar-ink-muted/70">Systems</div>
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
              </>
            )}

            {/* Only hides the links; each admin API route checks its own permission. */}
            {can("users", "roles", "integrations") && (
              <>
                <div className="px-2.5 pb-1 pt-5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Admin</div>
                {can("users", "roles") && <NavItem to="/users" icon={<Users className="h-4 w-4" />} label="Users" />}
                {can("roles") && <NavItem to="/roles" icon={<ShieldCheck className="h-4 w-4" />} label="Roles" />}
                {can("integrations") && <NavItem to="/integrations" icon={<Plug className="h-4 w-4" />} label="Integrations" />}
              </>
            )}
          </nav>

          <div className="mt-auto" />
          {online.length > 0 && (
            <div className="px-4 pb-3">
              <div className="pb-1.5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Online now</div>
              <div className="space-y-1">
                {online.map((u) => (
                  <Link
                    key={u.id}
                    to={u.page ?? "/tickets"}
                    className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--sidebar-hover)]"
                    title={`Go to what ${u.name} is reading`}
                  >
                    <Avatar name={u.name} size={22} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-sidebar-ink">{u.name}</span>
                    <span className="max-w-[45%] truncate font-docno text-[10.5px] text-sidebar-ink-muted">{pageLabel(u.page)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2.5 border-t border-[var(--sidebar-border)] px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--sidebar-active)] text-[10px] font-bold uppercase text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.25)]">
              {base.me.name.slice(0, 2)}
            </span>
            <Link to="/account" className="group min-w-0 flex-1" title="My account and password">
              <div className="truncate text-[12px] font-semibold text-sidebar-ink group-hover:text-accent-bright">{base.me.name}</div>
              <div className="truncate text-[10px] text-sidebar-ink-muted">{base.me.email ?? base.me.username}</div>
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

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 lg:hidden">
            <button className="btn-subtle h-10 px-2" onClick={() => setIsMenuOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <span className="flex-1 text-[14px] font-bold text-ink">Houzs IT Hub</span>
            <Link to="/account" className="p-1" title="My account" aria-label="My account">
              <Avatar name={base.me.name} size={30} />
            </Link>
          </header>
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {!can("it") && IT_PATH.test(pathname) ? <Navigate to={landing} replace /> : <Outlet />}
          </main>
        </div>
      </div>
      {can("it") && <NewTicketToasts />}
    </HubContext.Provider>
  );
}
