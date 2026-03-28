import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import logo from '@/assets/logo.jpg';

const UnderMaintenance: React.FC = () => {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.18),_transparent_45%),linear-gradient(160deg,_hsl(var(--background)),_hsl(var(--muted)/0.5))] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 overflow-hidden rounded-[2rem] border border-border/60 bg-card/85 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.18)] backdrop-blur md:grid-cols-[1.15fr_0.85fr] md:p-10">
          <div className="flex flex-col justify-between gap-8">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                <AlertTriangle className="h-4 w-4" />
                Platform maintenance mode is active
              </div>

              <div className="space-y-4">
                <h1 className="max-w-xl text-4xl font-black tracking-tight text-foreground sm:text-5xl">
                  StoicOps is briefly offline for updates.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  Access is temporarily paused while the admin team completes maintenance. Please check back shortly.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Admin sign in
              </Link>
              <div className="inline-flex items-center rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground">
                The public app is unavailable until maintenance mode is turned off.
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[1.5rem] border border-border/60 bg-[linear-gradient(180deg,_hsl(var(--secondary)/0.85),_hsl(var(--background)))] p-6">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_hsl(var(--primary)/0.18),_transparent_40%)]" />
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div className="flex items-center gap-4">
                <img src={logo} alt="StoicOps logo" className="h-14 w-14 rounded-2xl object-cover shadow-lg" />
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">StoicOps</p>
                  <p className="text-lg font-semibold text-foreground">Scheduled maintenance</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <p className="text-sm font-medium text-foreground">What this means</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Clients, workers, and guests are blocked from the app until maintenance mode is disabled by an admin or owner.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Admin access remains available
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Admins and owners can still sign in and use the dashboard to switch maintenance mode off.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnderMaintenance;
