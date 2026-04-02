import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const hasLoggedFirstStableRoute = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: user, error, isLoading } = useGetMe({ query: { retry: false } as any });

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = user as any;
    console.debug("[auth-flow] guard-hydration", {
      path: location,
      isLoading,
      hasError: !!error,
      userId: u?.id,
      isAdmin: u?.isAdmin,
      role: u?.role,
      workerId: u?.workerId,
    });
  }, [location, isLoading, error, user]);

  useEffect(() => {
    if (!isLoading && error) {
      console.debug("[auth-flow] guard-redirect-login", { from: location });
      setLocation("/login");
    }
  }, [error, isLoading, location, setLocation]);

  useEffect(() => {
    if (!isLoading && user && !error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = user as any;
      const isWorker = !!u.workerId && !u.isAdmin;
      if (isWorker && !location.startsWith("/timecard")) {
        console.debug("[auth-flow] guard-redirect-timecard", {
          from: location,
          userId: u.id,
          workerId: u.workerId,
        });
        setLocation("/timecard");
      }
    }
  }, [user, isLoading, error, location, setLocation]);

  useEffect(() => {
    if (!isLoading && user && !error && !hasLoggedFirstStableRoute.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = user as any;
      hasLoggedFirstStableRoute.current = true;
      console.debug("[auth-flow] guard-first-stable-route", {
        path: location,
        userId: u.id,
        role: u.role,
        isAdmin: u.isAdmin,
        workerId: u.workerId,
      });
    }
  }, [location, isLoading, user, error]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
        <p className="text-xl text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (error || !user) {
    return null; // Will redirect in effect
  }

  return <>{children}</>;
}
