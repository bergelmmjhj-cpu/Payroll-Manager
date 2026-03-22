import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

// Extremely robust, accessible, and beautiful UI components

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'danger' | 'success', isLoading?: boolean }>(
  ({ className, variant = 'default', isLoading, children, disabled, ...props }, ref) => {
    const variants = {
      default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
      outline: "border-2 border-border bg-transparent hover:bg-accent text-foreground hover:text-accent-foreground",
      ghost: "bg-transparent hover:bg-accent text-foreground hover:text-accent-foreground",
      danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
      success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          "min-h-[44px] px-6 py-2 text-lg", // Large touch targets
          variants[variant],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export const Card = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-2xl border border-border/50 bg-card text-card-foreground shadow-lg shadow-black/5", className)} {...props}>
    {children}
  </div>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("text-base font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground", className)} {...props} />
  )
);
Label.displayName = "Label";

export const StatusBadge = ({ status }: { status: string }) => {
  const norm = status.toLowerCase();
  let color = "bg-gray-100 text-gray-800 border-gray-200"; // Default/Draft
  
  if (["missing_info", "missing", "draft"].includes(norm)) color = "bg-red-100 text-red-800 border-red-200";
  if (["pending", "review", "in_progress"].includes(norm)) color = "bg-amber-100 text-amber-800 border-amber-200";
  if (["ready", "cleared", "finalized", "approved"].includes(norm)) color = "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (["paid", "sent"].includes(norm)) color = "bg-blue-100 text-blue-800 border-blue-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold capitalize shadow-sm", color)}>
      {status.replace('_', ' ')}
    </span>
  );
};

export const Dialog = ({ open, onOpenChange, title, children }: { open: boolean, onOpenChange: (open: boolean) => void, title: string, children: React.ReactNode }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <button onClick={() => onOpenChange(false)} className="p-2 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
