import { Activity, Bell, ChevronDown, CreditCard, KanbanSquare, KeySquare, List, LogOut, Menu, Moon, Plug, ShieldCheck, Sun, UserCheck, UserCog, Users } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, json, type Perm, type User, type SystemRow } from "../api/client";
import { useTheme } from "../lib/theme";
import { useNewVersion } from "../lib/useNewVersion";
import { usePoll } from "../lib/usePoll";
import FirstPasswordPage from "../pages/FirstPasswordPage";
import { Avatar } from "./Bits";
import { useOutside } from "./FilterButton";
import NewTicketToasts from "./NewTicketToasts";
import { NotificationBell } from "./Notifications";

type Stats = { active_by_system: Record<string, number>; my_active: number; unread_notifications: number };

const IT_PATH = /^\/($|tickets|board|queue|notifications)/;

// Sidebar wording only; everywhere else shows the system's stored name.
const SIDEBAR_SYSTEM_NAMES: Record<string, string> = { CONTS: "The Conts" };

const PAGE_NAMES: Record<string, string> = {
  "/tickets": "List",
  "/board": "Board",
  "/queue": "My queue",
  "/notifications": "Notifications",
  "/users": "Users",
  "/account": "My account",
  "/integrations": "Integrations",
  "/roles": "Roles",
  "/accounts": "Account ownership",
  "/billing": "System billing",
  "/health": "System health",
};

// A sidebar category's open or closed state, remembered in this browser.
function useSectionOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "closed";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? "closed" : "open");
      } catch {}
      return !o;
    });
  return [open, toggle];
}

function SectionToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="tap flex w-full items-center gap-1.5 px-2.5 pb-1 pt-5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted hover:text-sidebar-ink"
    >
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} />
    </button>
  );
}

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
  // The one ticket the last bump was about, or null for "anything may have changed".
  changedCode: string | null;
  refresh: (code?: string) => void;
};
const HubContext = createContext<Ctx | null>(null);
export const useHub = () => useContext(HubContext)!;

function NavItem({ to, icon, label, count }: { to: string; icon?: ReactNode; label: string; count?: number }) {
  const { pathname, search } = useLocation();
  const [path, qs] = to.split("?");
  const active = pathname === path && (qs ? search.includes(qs) : !search.includes("system="));
  return (
    <NavLink
      to={to}
      className={`tap relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors ${
        active
          ? "bg-[var(--sidebar-active)] font-semibold text-sidebar-ink"
          : "text-sidebar-ink-muted hover:bg-[var(--sidebar-hover)] hover:text-sidebar-ink"
      }`}
    >
      {active && <span className="absolute -left-[10px] bottom-2 top-2 w-[2px] rounded-r bg-primary" />}
      {icon && <span className={active ? "text-primary" : ""}>{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-[var(--sidebar-hover)] px-1.5 text-[10.5px] font-semibold tabular-nums text-sidebar-ink-muted">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </NavLink>
  );
}

// Matches the server: check-ins every 60s, last-seen written at most once a minute.
const ACTIVE_SECONDS = 150;

type Teammate = User & { page: string | null; idleSeconds: number };

function TeamActivity({ teammates, canManage }: { teammates: Teammate[]; canManage: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const ref = useOutside<HTMLDivElement>(isOpen, close);
  const active = teammates.filter((t) => t.idleSeconds < ACTIVE_SECONDS);
  const away = teammates.filter((t) => t.idleSeconds >= ACTIVE_SECONDS);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen((open) => !open)}
        className="relative grid h-10 w-10 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink"
        aria-label={`Team activity, ${active.length} online`}
        aria-expanded={isOpen}
      >
        <Users className="h-[18px] w-[18px]" />
        {active.length > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-loz-green-ink px-1 text-[10px] font-bold leading-none text-surface">
            {active.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-[10px] border border-transparent bg-overlay text-ink shadow-overlay max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 max-sm:top-auto max-sm:w-auto">
          <div className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-on">
            <span className="flex-1 text-[11px] font-bold uppercase tracking-brand">Team activity</span>
            <span className="flex items-center gap-1.5 rounded-full bg-loz-green-ink px-2 py-0.5 text-[10px] font-bold uppercase text-surface">
              <span className="h-1.5 w-1.5 rounded-full bg-surface" />
              {active.length} online
            </span>
            {away.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-surface-dim px-2 py-0.5 text-[10px] font-bold uppercase text-ink-subtle">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle" />
                {away.length} away
              </span>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            {teammates.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-subtle">Nobody else is online</div>}
            {active.length > 0 && <TeammateGroup label="Active now" teammates={active} isActive onPick={close} />}
            {away.length > 0 && <TeammateGroup label="Away" teammates={away} isActive={false} onPick={close} />}
          </div>
          {canManage && (
            <div className="flex justify-end border-t border-line px-4 py-2.5 text-[11px]">
              <Link to="/users" onClick={close} className="tap font-bold uppercase tracking-wide text-primary hover:underline">
                Manage access
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeammateGroup({ label, teammates, isActive, onPick }: { label: string; teammates: Teammate[]; isActive: boolean; onPick: () => void }) {
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <div className="px-4 py-1">
        <span
          className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-brand ${
            isActive ? "bg-loz-green text-loz-green-ink" : "bg-surface-dim text-ink-subtle"
          }`}
        >
          {label}
        </span>
      </div>
      {teammates.map((teammate) => (
        <Link
          key={teammate.id}
          to={teammate.page ?? "/tickets"}
          onClick={onPick}
          className="flex min-h-10 items-center gap-3 px-4 py-2 hover:bg-hover"
          title={`Go to what ${teammate.name} is reading`}
        >
          <span className={`relative flex ${isActive ? "" : "opacity-60"}`}>
            <Avatar name={teammate.name} size={32} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-overlay ${
                isActive ? "bg-loz-green-ink" : "border-2 border-ink-subtle bg-overlay"
              }`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{teammate.name}</span>
            <span className="block truncate text-[11.5px] text-ink-subtle">{pageLabel(teammate.page)}</span>
          </span>
          <span className={`shrink-0 text-[10.5px] font-bold uppercase tabular-nums ${isActive ? "text-loz-green-ink" : "text-ink-subtle"}`}>
            {isActive ? "Now" : `${Math.floor(teammate.idleSeconds / 60)}m idle`}
          </span>
        </Link>
      ))}
    </div>
  );
}

function ProfileMenu({ me, onSignOut }: { me: User; onSignOut: () => void }) {
  const { theme, toggle } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const ref = useOutside<HTMLDivElement>(isOpen, close);
  const itemClass = "tap flex min-h-10 w-full items-center gap-2.5 px-4 text-left text-[13px] hover:bg-hover";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-10 items-center gap-2.5 rounded-md px-1.5 transition-colors hover:bg-hover"
        aria-label="My account menu"
        aria-expanded={isOpen}
      >
        <span className="relative flex">
          <Avatar name={me.name} size={30} />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-loz-green-ink ring-2 ring-surface" />
        </span>
        <span className="hidden min-w-0 max-w-[160px] text-left sm:block">
          <span className="block truncate text-[13px] font-bold leading-tight text-ink">{me.name}</span>
          <span className="block truncate text-[11px] leading-tight text-ink-subtle">{me.roleName ?? me.email ?? me.username}</span>
        </span>
      </button>

      {isOpen && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-[min(240px,calc(100vw-32px))] rounded-[10px] border border-transparent bg-overlay py-1.5 text-ink shadow-overlay max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 max-sm:top-auto max-sm:w-auto">
          <div className="border-b border-line px-4 pb-2 pt-1">
            <div className="truncate text-[13px] font-semibold">{me.name}</div>
            <div className="truncate text-[11px] text-ink-subtle">{me.email ?? me.username}</div>
          </div>
          <Link to="/account" onClick={close} className={itemClass} role="menuitem">
            <UserCog className="h-4 w-4 text-ink-subtle" /> My account
          </Link>
          <button onClick={toggle} className={itemClass} role="menuitem">
            {theme === "dark" ? <Sun className="h-4 w-4 text-ink-subtle" /> : <Moon className="h-4 w-4 text-ink-subtle" />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <button onClick={onSignOut} className={itemClass} role="menuitem">
            <LogOut className="h-4 w-4 text-ink-subtle" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [base, setBase] = useState<Omit<Ctx, "stats" | "version" | "changedCode" | "refresh" | "setMe"> | null>(null);
  const [stats, setStats] = useState<Stats>({ active_by_system: {}, my_active: 0, unread_notifications: 0 });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Set when the account still has a handed-out password; the server refuses
  // everything but /me and /me/password until it is replaced.
  const [firstLogin, setFirstLogin] = useState<string | null>(null);
  const [presence, setPresence] = useState<{ id: number; page: string | null; idleSeconds: number }[]>([]);
  const { pathname, search } = useLocation();
  const isOutdated = useNewVersion();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  useEffect(() => setIsMenuOpen(false), [pathname, search]);
  useEffect(() => {
    if (!isMenuOpen) return;
    const closeOnEscape = (e: KeyboardEvent) => e.key === "Escape" && setIsMenuOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMenuOpen]);
  const [itOpen, toggleIt] = useSectionOpen("sidebar.it");
  const [financeOpen, toggleFinance] = useSectionOpen("sidebar.finance");

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
  // Backup heartbeat; navigating checks in at once. The server treats 150s of silence as gone.
  usePoll(checkIn, 60_000);

  const [changedCode, setChangedCode] = useState<string | null>(null);
  const refresh = useCallback((code?: string) => {
    setChangedCode(code ?? null);
    setVersion((v) => v + 1);
  }, []);
  const setMe = useCallback(
    (me: User) =>
      setBase((b) => b && { ...b, me, users: b.users.map((d) => (d.id === me.id ? { ...d, name: me.name } : d)) }),
    [],
  );

  const online = presence.flatMap((p) => {
    const u = base?.users.find((d) => d.id === p.id);
    return u && u.id !== base!.me.id ? [{ ...u, page: p.page, idleSeconds: p.idleSeconds }] : [];
  });

  const can = (...p: Perm[]) => p.some((x) => base?.me.perms?.includes(x));
  // Without IT, land on the first admin page they may open, else My account.
  const landing = can("users", "roles")
    ? "/users"
    : can("integrations")
      ? "/integrations"
      : can("health_view", "health_edit")
        ? "/health"
        : can("accounts_view", "accounts_edit")
        ? "/accounts"
        : can("billing_view", "billing_edit")
          ? "/billing"
          : "/account";
  const itActive = Object.values(stats.active_by_system).reduce((a, n) => a + n, 0);

  const signOut = () => fetch("/api/v1/auth/logout", { method: "POST" }).finally(() => location.assign("/login"));

  if (firstLogin) return <FirstPasswordPage name={firstLogin} />;
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p role="alert" className="text-sm text-loz-red-ink">
            {error}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => location.reload()}>
              Try again
            </button>
            <button className="btn-default" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!base) return <div className="p-10 text-center text-ink-subtle">Loading...</div>;
  const unread = stats.unread_notifications;

  return (
    <HubContext.Provider value={{ ...base, stats, version, changedCode, refresh, setMe }}>
      <div className="flex h-full">
        {isMenuOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setIsMenuOpen(false)} />}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-sidebar transition-[transform,visibility] motion-reduce:transition-none lg:relative lg:translate-x-0 ${
            isMenuOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
          }`}
        >
          <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-accent/35 to-transparent" />
          <div className="relative flex items-center gap-2.5 border-b border-[var(--sidebar-border)] py-4 pl-4 pr-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--sidebar-active)] text-[12px] font-bold tracking-wider text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.35)]">
              HH
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold text-sidebar-ink">Houzs Hub</div>
              <div className="truncate text-[9.5px] font-bold uppercase tracking-brand text-accent-bright">ENTERPRISE PORTAL</div>
            </div>
          </div>

          {/* Scrolls on short screens so the account row and Sign out below stay reachable. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <nav className="space-y-0.5 px-3 py-2">
            {/* The IT category (workspace views and its systems), shown with the "it"
                permission. The server refuses ticket routes without it too. */}
            {can("it") && (
            <button
              onClick={toggleIt}
              aria-expanded={itOpen}
              className="tap flex w-full items-center gap-1.5 px-2.5 pb-1 pt-3 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted hover:text-sidebar-ink"
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
                <div className="px-2.5 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-brand text-sidebar-ink-muted">Workspace</div>
                <NavItem to="/tickets" icon={<List className="h-4 w-4" />} label="List" />
                <NavItem to="/board" icon={<KanbanSquare className="h-4 w-4" />} label="Board" />
                <NavItem to="/queue" icon={<UserCheck className="h-4 w-4" />} label="My queue" count={stats.my_active} />
                <NavItem to="/notifications" icon={<Bell className="h-4 w-4" />} label="Notifications" count={stats.unread_notifications} />

                <div className="px-2.5 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-brand text-sidebar-ink-muted">Systems</div>
                {base.systems.map((s) => (
                  <NavItem
                    key={s.code}
                    to={`/tickets?system=${s.code}`}
                    label={SIDEBAR_SYSTEM_NAMES[s.code] ?? s.name}
                    count={stats.active_by_system[s.code] ?? 0}
                  />
                ))}
              </>
            )}

            {/* The Finance category: outside accounts and what the systems cost. Only
                hides the links; the server checks accounts_* and billing_* itself. */}
            {can("accounts_view", "accounts_edit", "billing_view", "billing_edit") && (
              <SectionToggle label="Finance" open={financeOpen} onToggle={toggleFinance} />
            )}
            {financeOpen && (
              <>
                {can("accounts_view", "accounts_edit") && <NavItem to="/accounts" icon={<KeySquare className="h-4 w-4" />} label="Account ownership" />}
                {can("billing_view", "billing_edit") && <NavItem to="/billing" icon={<CreditCard className="h-4 w-4" />} label="System billing" />}
              </>
            )}

            {/* Only hides the links; each admin API route checks its own permission. */}
            {can("users", "roles", "integrations", "health_view", "health_edit") && (
              <>
                <div className="px-2.5 pb-1 pt-5 text-[9.5px] font-bold uppercase tracking-brand text-sidebar-ink-muted">Admin</div>
                {can("users", "roles") && <NavItem to="/users" icon={<Users className="h-4 w-4" />} label="Users" />}
                {can("roles") && <NavItem to="/roles" icon={<ShieldCheck className="h-4 w-4" />} label="Roles" />}
                {can("integrations") && <NavItem to="/integrations" icon={<Plug className="h-4 w-4" />} label="Integrations" />}
                {can("health_view", "health_edit") && <NavItem to="/health" icon={<Activity className="h-4 w-4" />} label="System health" />}
              </>
            )}
          </nav>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {isOutdated && (
            <div role="status" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-1.5 text-[13px] text-primary-on">
              <span>A new version of Houzs Hub is available.</span>
              <button className="tap rounded-md px-2 font-semibold underline underline-offset-2 hover:no-underline" onClick={() => location.reload()}>
                Refresh
              </button>
            </div>
          )}
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-6">
            <button className="btn-subtle h-10 px-2 lg:hidden" onClick={() => setIsMenuOpen(true)} aria-label="Open menu" aria-expanded={isMenuOpen}>
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-[14px] font-bold text-ink lg:hidden">Houzs Hub</span>
            <div className="flex-1" />
            <TeamActivity teammates={online} canManage={can("users", "roles")} />
            {can("it") && (
              <div className="hidden lg:block">
                <NotificationBell />
              </div>
            )}
            {/* Phones open the full page; the popover would not fit beside the menu. */}
            {can("it") && (
              <Link
                to="/notifications"
                className="tap relative grid place-items-center rounded-md text-ink-subtle lg:hidden"
                aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-loz-red-ink px-1 text-[10px] font-bold leading-none text-surface">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            )}
            <ProfileMenu me={base.me} onSignOut={signOut} />
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
