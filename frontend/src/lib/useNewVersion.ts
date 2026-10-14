import { useCallback, useState } from "react";
import { usePoll } from "./usePoll";

// True once the live site serves a different build than this tab is running.
export function useNewVersion() {
  const [isOutdated, setIsOutdated] = useState(false);
  const check = useCallback(() => {
    if (!import.meta.env.PROD || isOutdated) return;
    fetch("/version.json", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ build?: string }>)
      .then((live) => live.build && live.build !== __BUILD_ID__ && setIsOutdated(true))
      .catch(() => {});
  }, [isOutdated]);
  usePoll(check, 60_000);
  return isOutdated;
}
