import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";

// Pages
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Workers from "@/pages/Workers";
import Hotels from "@/pages/Hotels";
import PayPeriods from "@/pages/PayPeriods";
import PayPeriodDetail from "@/pages/PayPeriodDetail";
import Invoices from "@/pages/Invoices";
import InvoiceDetail from "@/pages/InvoiceDetail";
import Settings from "@/pages/Settings";
import ImportWizard from "@/pages/ImportWizard";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  return (
    <AuthGuard>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/workers" component={Workers} />
          <Route path="/hotels" component={Hotels} />
          <Route path="/pay-periods" component={PayPeriods} />
          <Route path="/pay-periods/:id" component={PayPeriodDetail} />
          <Route path="/invoices" component={Invoices} />
          <Route path="/invoices/:id" component={InvoiceDetail} />
          <Route path="/settings" component={Settings} />
          <Route path="/import" component={ImportWizard} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/login" component={Login} />
            <Route component={ProtectedRoutes} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
