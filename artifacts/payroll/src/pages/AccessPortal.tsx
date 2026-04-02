import { Card, Button } from "@/components/ui";
import { Clock, MapPin, CheckCircle, ArrowRight } from "lucide-react";

export default function AccessPortal() {
  const handleLogin = () => {
    const target = "/api/auth/google?redirect=/timecard";
    console.debug("[auth-flow] access-portal-signin-click", { target });
    window.location.href = target;
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background relative overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&q=80')] bg-cover bg-center mix-blend-luminosity"></div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-background/95 via-background/80 to-primary/10"></div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 py-16">
        {/* Hero card */}
        <Card className="w-full max-w-2xl p-10 md:p-14 text-center shadow-2xl bg-card/95 backdrop-blur-md border-primary/10 mb-8">
          {/* Logo */}
          <div className="mx-auto w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-primary/25 rotate-3">
            <Clock className="text-white w-9 h-9 -rotate-3" />
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground mb-3">
            Worker Time Portal
          </h1>
          <p className="text-lg text-muted-foreground mb-10">
            Time in, time out, and manage your shifts from anywhere.
          </p>

          {/* Features */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10 text-left">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/40">
              <Clock className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-foreground text-sm">GPS Clock-In</p>
                <p className="text-xs text-muted-foreground mt-0.5">Verify your location automatically when clocking in or out.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/40">
              <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-foreground text-sm">Site Tracking</p>
                <p className="text-xs text-muted-foreground mt-0.5">Log hours at the right hotel every time — no guesswork.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/40">
              <CheckCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-foreground text-sm">Timecard History</p>
                <p className="text-xs text-muted-foreground mt-0.5">View all your shifts, approval status, and correction requests.</p>
              </div>
            </div>
          </div>

          {/* Sign-in button */}
          <Button
            onClick={handleLogin}
            className="w-full h-14 text-lg shadow-lg hover:-translate-y-1 transition-transform"
          >
            <svg className="w-5 h-5 mr-3 bg-white rounded-full p-1" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>

          <p className="mt-6 text-sm text-muted-foreground">
            Use the Google account registered with your employer.
          </p>
        </Card>
      </div>
    </div>
  );
}
