import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { roleHasPermission, type WorkspacePermission } from "@/lib/permissions";

type Profile = Tables<"profiles">;
type WorkspaceRow = Tables<"workspaces">;
type WorkspaceRole = Tables<"workspace_members">["role"];

export type WorkspaceMembership = {
  workspaceId: string;
  role: WorkspaceRole;
  workspace: WorkspaceRow;
};

const CURRENT_WORKSPACE_STORAGE_KEY = "stabiflow.currentWorkspaceId";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  memberships: WorkspaceMembership[];
  membershipsLoading: boolean;
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string) => void;
  currentMembership: WorkspaceMembership | null;
  refreshMemberships: () => Promise<void>;
  /**
   * Synchronously merges a just-created membership into local state,
   * without waiting on a network round-trip. Exists specifically for
   * create_workspace(): a route guard (RequireWorkspace) reads
   * memberships/currentWorkspaceId from THIS context, so redirecting the
   * caller right after a successful creation is only safe once this
   * context - not just the database - knows the new workspace exists.
   * refreshMemberships() alone can't guarantee that by the time its
   * caller resumes (it's a separate async round-trip); this call is a
   * plain setState, so it's guaranteed applied before whatever runs next
   * in the same synchronous block (e.g. an immediate navigate()).
   */
  addWorkspaceMembership: (membership: WorkspaceMembership) => void;
  signOut: () => Promise<{ error: Error | null }>;
  /**
   * UX-only convenience for hiding/showing controls the current role
   * can't use. NEVER the actual security boundary - the database
   * (has_workspace_role()/has_workspace_permission(), checked inside
   * every RLS policy and RPC) is authoritative and re-validates
   * independently of whatever this returns.
   */
  hasPermission: (permission: WorkspacePermission) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  profile: null,
  memberships: [],
  membershipsLoading: true,
  currentWorkspaceId: null,
  setCurrentWorkspaceId: () => {},
  currentMembership: null,
  refreshMemberships: async () => {},
  addWorkspaceMembership: () => {},
  signOut: async () => ({ error: null }),
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [membershipsLoading, setMembershipsLoading] = useState(true);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(
    () => localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY),
  );
  const mounted = useRef(true);

  const setCurrentWorkspaceId = (id: string) => {
    setCurrentWorkspaceIdState(id);
    localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, id);
  };

  const loadProfileAndMemberships = async (userId: string) => {
    setMembershipsLoading(true);
    const [{ data: profileRow }, { data: membershipRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("workspace_id, role, workspace:workspaces(*)")
        .eq("user_id", userId),
    ]);
    if (!mounted.current) return;
    setProfile(profileRow ?? null);
    const mapped: WorkspaceMembership[] = (membershipRows || [])
      .filter((row): row is typeof row & { workspace: WorkspaceRow } => !!row.workspace)
      .map((row) => ({ workspaceId: row.workspace_id, role: row.role, workspace: row.workspace }));
    setMemberships(mapped);
    setMembershipsLoading(false);

    // If there's no remembered workspace (or it's no longer one this user
    // belongs to), default to the first membership rather than leaving the
    // app stuck with an invalid workspace selected.
    setCurrentWorkspaceIdState((current) => {
      if (current && mapped.some((m) => m.workspaceId === current)) return current;
      const fallback = mapped[0]?.workspaceId ?? null;
      if (fallback) localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, fallback);
      return fallback;
    });
  };

  const refreshMemberships = async () => {
    if (user) await loadProfileAndMemberships(user.id);
  };

  const addWorkspaceMembership = (membership: WorkspaceMembership) => {
    setMemberships((prev) => (prev.some((m) => m.workspaceId === membership.workspaceId) ? prev : [...prev, membership]));
  };

  useEffect(() => {
    mounted.current = true;

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mounted.current) return;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      if (initialSession?.user) {
        loadProfileAndMemberships(initialSession.user.id).finally(() => setLoading(false));
      } else {
        setMembershipsLoading(false);
        setLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        loadProfileAndMemberships(nextSession.user.id);
      } else {
        setProfile(null);
        setMemberships([]);
        setMembershipsLoading(false);
      }
    });

    return () => {
      mounted.current = false;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const currentMembership = memberships.find((m) => m.workspaceId === currentWorkspaceId) ?? null;
  const hasPermission = (permission: WorkspacePermission) => roleHasPermission(currentMembership?.role, permission);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        profile,
        memberships,
        membershipsLoading,
        currentWorkspaceId,
        setCurrentWorkspaceId,
        currentMembership,
        refreshMemberships,
        addWorkspaceMembership,
        signOut,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
