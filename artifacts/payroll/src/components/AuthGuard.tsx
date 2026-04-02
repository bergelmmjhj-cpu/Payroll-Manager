import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: user, error, isLoading } = useGetMe({ query: { retry: false } as any });

  useEffect(() => {
    if (!isLoading && error) {
      setLocation("/login");
    }
  }, [error, isLoading, setLocation]);

  useEffect(() => {
    if (!isLoading && user && !error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = user as any;
      const isWorker = !!u.workerId && !u.isAdmin;
      if (isWorker && !location.startsWith("/timecard")) {
        setLocation("/timecard");
      }
    }
  }, [user, isLoading, error, location, setLocation]);

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
