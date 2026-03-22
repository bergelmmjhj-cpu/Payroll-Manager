import { Card, Button } from "@/components/ui";

export default function Login() {
  const handleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="min-h-screen w-full flex bg-background relative overflow-hidden">
      {/* Background Image/Pattern */}
      <div className="absolute inset-0 z-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&q=80')] bg-cover bg-center mix-blend-luminosity"></div>
      
      {/* Gradient Overlay */}
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-background/95 via-background/80 to-primary/10"></div>

      <div className="relative z-10 w-full flex items-center justify-center p-4">
        <Card className="w-full max-w-lg p-10 md:p-14 text-center shadow-2xl bg-card/95 backdrop-blur-md border-primary/10">
          <div className="mx-auto w-24 h-24 bg-primary rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-primary/25 rotate-3">
            <span className="text-white font-bold text-4xl -rotate-3">M</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground mb-4">
            MMJ Payroll
          </h1>
          <p className="text-xl text-muted-foreground mb-12">
            Operations & Invoice Management System
          </p>

          <Button 
            onClick={handleLogin}
            className="w-full h-16 text-xl shadow-lg hover:-translate-y-1 transition-transform"
          >
            <svg className="w-6 h-6 mr-3 bg-white rounded-full p-1" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </Button>

          <p className="mt-8 text-sm text-muted-foreground">
            Secure access restricted to authorized personnel.
          </p>
        </Card>
      </div>
    </div>
  );
}
