import { createContext, useCallback, useContext, useEffect, useState, type DependencyList } from "react";
import type { Api, Me } from "./api.ts";
import type { Auth } from "./auth.ts";

export interface Session {
  api: Api;
  auth: Auth;
  me: Me;
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside a signed-in session");
  return session;
}

export const isOwner = (me: Me) => me.team?.role === "owner";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

/** Loads data for a page and reloads it on demand or when `deps` change. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): [Loaded<T>, () => Promise<void>] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- callers pass the real dependencies
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    try {
      setState({ status: "ready", data: await run() });
    } catch (error) {
      setState({ status: "error", error });
    }
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    run().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (error) => !cancelled && setState({ status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [run]);

  return [state, reload];
}
