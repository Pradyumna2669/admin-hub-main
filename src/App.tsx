import React, { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import PushSubscriptionManager from "@/components/notifications/PushSubscriptionManager";
import WorkerTaskRealtime from "@/components/notifications/WorkerTaskRealtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import SplashScreen from "@/components/SplashScreen";
import { useAppSettings } from "@/hooks/useAppSettings";

import WorkerGate from '@/pages/worker/WorkerGate';
import WorkerDashboard from '@/pages/worker/WorkerDashboard';
import LandingPage from "@/pages/LandingPage";
import BulkTaskImport from "@/pages/admin/BulkTaskImport";

import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTasks from "./pages/admin/AdminTasks";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminCategoryTasks from "./pages/admin/AdminCategoryTasks";
import AdminLinks from "./pages/admin/AdminLinks";
import AdminAIGenerate from "./pages/admin/AdminAIGenerate";
import AdminClients from "./pages/admin/AdminClients";
import AdminChatPage from "./pages/admin/AdminChatPage";
import AdminWorkers from "./pages/admin/AdminWorkers";
import AdminActivity from "./pages/admin/AdminActivity";
import AdminVerification from "./pages/admin/AdminVerification";
import AdminPayments from "./pages/admin/AdminPayments";
import AdminPaymentLogs from "./pages/admin/AdminPaymentLogs";
import AdminExpenses from "./pages/admin/AdminExpenses";
import AdminOrders from "./pages/admin/AdminOrders";
import UserManagement from "./pages/admin/UserManagement";
import AdminTaskSettings from "./pages/admin/AdminTaskSettings";
import Discussion from "./pages/admin/Discussion";
import ClientDashboard from "./pages/client/ClientDashboard";
import ClientCategoryView from "./pages/client/ClientCategoryView";
import WorkerPaymentHistory from "./pages/worker/WorkerPaymentHistory";
import WorkerWalletPage from "./pages/worker/WorkerWalletPage";
import WorkerMyTasks from "./pages/worker/MyTasksPage";
import WorkerTaskLinkPage from "./pages/worker/WorkerTaskLinkPage";
import WorkerTasks from "./pages/worker/WorkerTasks";
import NotFound from "./pages/NotFound";
import WorkerChatPage from "./pages/worker/WorkerChatPage";
import ProfilePage from "./pages/ProfilePage";
import GeneralChatPage from "./pages/chat/GeneralChatPage";
import Arcade from "./pages/Arcade";
import FPSBattleRoyalePage from "./pages/FPSBattleRoyalePage";
import UnderMaintenance from "./pages/UnderMaintenance";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

const SPLASH_MIN_MS = 900;
const ROUTE_SPLASH_MS = 240;

const AppRoutes = () => {
  const { loading: authLoading, userRole } = useAuth();
  const location = useLocation();
  const { data: appSettings, isLoading: settingsLoading } = useAppSettings();

  const [showInitialSplash, setShowInitialSplash] = useState(true);
  const initialSplashStartRef = useRef<number>(Date.now());

  useEffect(() => {
    if (authLoading) {
      initialSplashStartRef.current = Date.now();
      setShowInitialSplash(true);
      return;
    }

    const elapsed = Date.now() - initialSplashStartRef.current;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    const timeoutId = window.setTimeout(() => setShowInitialSplash(false), remaining);
    return () => window.clearTimeout(timeoutId);
  }, [authLoading]);

  const [showRouteSplash, setShowRouteSplash] = useState(false);
  const lastPathRef = useRef(location.pathname);

  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;

    setShowRouteSplash(true);
    const timeoutId = window.setTimeout(() => setShowRouteSplash(false), ROUTE_SPLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [location.pathname]);

  const splashVisible = showInitialSplash || showRouteSplash;
  const isPrivilegedUser = userRole === 'admin' || userRole === 'owner';
  const allowDuringMaintenance = ['/login', '/forgot-password', '/reset-password'].includes(location.pathname);
  const maintenanceModeEnabled = !!appSettings?.maintenance_mode;

  if (!authLoading && !settingsLoading && maintenanceModeEnabled && !isPrivilegedUser && !allowDuringMaintenance) {
    return <UnderMaintenance />;
  }

  return (
    <>
      <WorkerTaskRealtime />
      <PushSubscriptionManager />
      <SplashScreen
        visible={splashVisible}
        message={authLoading ? "Verifying sessionâ€¦" : "Loadingâ€¦"}
      />

      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Admin */}
        <Route path="/admin" element={
          <ProtectedRoute requiredRole={["admin", "owner"]}>
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/admin/tasks" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminTasks />
          </ProtectedRoute>
        } />
        <Route path="/admin/task-settings" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminTaskSettings />
          </ProtectedRoute>
        } />
        <Route path="/admin/bulk-import" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <BulkTaskImport />
          </ProtectedRoute>
        } />
        <Route path="/admin/categories" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminCategories />
          </ProtectedRoute>
        } />
        <Route path="/admin/categories/:categoryId" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminCategoryTasks />
          </ProtectedRoute>
        } />
        <Route path="/admin/links" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminLinks />
          </ProtectedRoute>
        } />
        <Route path="/admin/ai-generate" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminAIGenerate />
          </ProtectedRoute>
        } />
        <Route path="/admin/clients" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminClients />
          </ProtectedRoute>
        } />
        <Route path="/admin/workers" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminWorkers />
          </ProtectedRoute>
        } />
        <Route path="/admin/activity" element={
          <ProtectedRoute requiredRole={["admin", "owner"]}>
            <AdminActivity />
          </ProtectedRoute>
        } />
        <Route path="/admin/verification" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminVerification />
          </ProtectedRoute>
        } />
        <Route path="/admin/chat" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminChatPage />
          </ProtectedRoute>
        } />
        <Route path="/admin/discussion" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <Discussion />
          </ProtectedRoute>
        } />
        <Route path="/admin/payment-logs" element={
          <ProtectedRoute requiredRole={["admin", "owner"]}>
            <AdminPaymentLogs />
          </ProtectedRoute>
        } />
        <Route path="/admin/expenses" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminExpenses />
          </ProtectedRoute>
        } />
        <Route path="/admin/payments" element={
          <ProtectedRoute requiredRole={["admin", "owner", "moderator"]}>
            <AdminPayments />
          </ProtectedRoute>
        } />
        <Route path="/admin/orders" element={
          <ProtectedRoute requiredRole={["admin", "owner"]}>
            <AdminOrders />
          </ProtectedRoute>
        } />
        <Route path="/admin/user-management" element={
          <ProtectedRoute requiredRole={["admin", "owner"]}>
            <UserManagement />
          </ProtectedRoute>
        } />

        {/* Client */}
        <Route path="/dashboard" element={
          <ProtectedRoute requiredRole="client">
            <ClientDashboard />
          </ProtectedRoute>
        } />
        <Route path="/dashboard/categories" element={
          <ProtectedRoute requiredRole="client">
            <ClientCategoryView />
          </ProtectedRoute>
        } />

        {/* Worker */}
        <Route path="/worker/dashboard" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerGate>
              <WorkerDashboard />
            </WorkerGate>
          </ProtectedRoute>
        } />
        <Route path="/worker/my-tasks" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerGate>
              <WorkerMyTasks />
            </WorkerGate>
          </ProtectedRoute>
        } />
        <Route path="/worker/tasks" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerGate>
              <WorkerTasks />
            </WorkerGate>
          </ProtectedRoute>
        } />
        <Route path="/worker/task/:taskId" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerGate>
              <WorkerTaskLinkPage />
            </WorkerGate>
          </ProtectedRoute>
        } />
        <Route path="/worker/chat" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerChatPage />
          </ProtectedRoute>
        } />
        <Route path="/worker/payments" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerPaymentHistory />
          </ProtectedRoute>
        } />
        <Route path="/worker/wallet" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerWalletPage />
          </ProtectedRoute>
        } />
        <Route path="/worker" element={
          <ProtectedRoute requiredRole="worker">
            <WorkerGate />
          </ProtectedRoute>
        } />

        {/* Shared */}
        <Route path="/chat/general" element={
          <ProtectedRoute>
            <GeneralChatPage />
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        } />

        <Route path="/arcade" element={<ProtectedRoute><Arcade /></ProtectedRoute>} />

        <Route path="/arcade/blaster-fps" element={<ProtectedRoute><FPSBattleRoyalePage /></ProtectedRoute>} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <TooltipProvider>

          {/* Root wrapper prevents layout shift */}
          <div className="min-h-screen w-full overflow-x-hidden bg-background">

            <Toaster />
            <Sonner />
            <div className="fixed right-4 top-4 z-[70] sm:right-6 sm:top-6">
              <ThemeToggle />
            </div>

            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <AppRoutes />
            </BrowserRouter>

          </div>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;


