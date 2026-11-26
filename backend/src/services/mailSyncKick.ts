// Each ERP's Mail Center pulls mail with its own "Mail Sync" GitHub workflow. Its "*/5" schedule is best-effort and
// in practice fired every 5-9 hours (2026-11-25: no run from 16:45 to 23:53 MYT), so mail reached the ERPs that late.
// The hub's cron is on time, so it starts those workflows itself. The repos are public, so the runs cost nothing.
// Each target names the secret holding a GitHub token with Actions write on that repo; no token = that one is skipped.

export type MailSyncTarget = { system: string; repo: string; tokenSecret: string };

export const MAIL_SYNC_TARGETS: MailSyncTarget[] = [
  { system: "HC", repo: "Houzs-Century/Houzs-ERP", tokenSecret: "GH_DISPATCH_TOKEN_HOUZS_CENTURY" },
  { system: "HK", repo: "Houzs-IT/hookka-erp-testing", tokenSecret: "GH_DISPATCH_TOKEN_HOUZS_IT" },
  { system: "CARRES", repo: "Houzs-IT/Carres-Portal-v2", tokenSecret: "GH_DISPATCH_TOKEN_HOUZS_IT" },
];

export type KickResult = { system: string; status: number | "no-token" | "error"; detail?: string };

// A one-day look-back: runs are minutes apart, and the ERP drops what it already has by Message-ID.
const BODY = JSON.stringify({ ref: "main", inputs: { since_days: "1" } });

export async function kickMailSyncs(
  secrets: Record<string, string | undefined>,
  targets: MailSyncTarget[],
  fetcher: typeof fetch,
): Promise<KickResult[]> {
  return Promise.all(
    targets.map(async (t): Promise<KickResult> => {
      const token = secrets[t.tokenSecret];
      if (!token) return { system: t.system, status: "no-token" };
      try {
        const res = await fetcher(`https://api.github.com/repos/${t.repo}/actions/workflows/mail-sync.yml/dispatches`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "houzs-hub",
            "Content-Type": "application/json",
          },
          body: BODY,
        });
        return res.status === 204
          ? { system: t.system, status: 204 }
          : { system: t.system, status: res.status, detail: (await res.text()).slice(0, 200) };
      } catch (e) {
        return { system: t.system, status: "error", detail: String(e).slice(0, 200) };
      }
    }),
  );
}
