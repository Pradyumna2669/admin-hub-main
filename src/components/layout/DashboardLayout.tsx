import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import TaskerGuideBot from '@/components/worker/TaskerGuideBot';
import { Sidebar } from './Sidebar';
import { BannedAccountBanner } from '@/components/notifications/BannedAccountBanner';
import { cn } from '@/lib/utils';

interface DashboardLayoutProps {
  children: React.ReactNode;
  mainClassName?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  mainClassName,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { userRole } = useAuth();
  const location = useLocation();
  const showTaskerGuide = userRole === 'worker' && location.pathname !== '/chat/general';

  return (
    <div className="dashboard-shell h-screen flex bg-background overflow-hidden">

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Section */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        
        <BannedAccountBanner />

        {/* Mobile Header */}
        <header className="md:hidden border-b border-border/80 bg-background/80 p-4 backdrop-blur flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md bg-input"
          >
            ☰
          </button>

          <div className="text-lg font-semibold">
            StoicOps
          </div>

          <div />
        </header>

        {/* Scrollable Content Area */}
        <main
          className={cn(
            "relative flex-1 min-w-0 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8",
            mainClassName
          )}
        >
          <div className="relative z-10 h-full min-w-0">{children}</div>
        </main>
      </div>

      {showTaskerGuide ? <TaskerGuideBot /> : null}
    </div>
  );
};
