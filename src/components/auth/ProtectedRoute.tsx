import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';


type Role = 'owner' | 'admin' | 'moderator' | 'client' | 'worker';
interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: Role | Role[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { user, session, userRole, isBanned, banReason, sessionExpired, sessionExpiryReason, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user || !session) {
    const sessionQuery =
      sessionExpired && sessionExpiryReason ? `?session=${encodeURIComponent(sessionExpiryReason)}` : '';
    return <Navigate to={`/login${sessionQuery}`} replace />;
  }

  if (isBanned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md rounded-xl border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Account banned</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This account has been banned from accessing the platform.
          </p>
          {banReason ? (
            <p className="mt-3 text-sm">
              <strong>Reason:</strong> {banReason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (userRole === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md rounded-xl border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Loading account access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your session is valid, but your access level is still being resolved.
            Please refresh if this does not clear in a few seconds.
          </p>
        </div>
      </div>
    );
  }

  if (requiredRole) {
    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowedRoles.includes(userRole)) {
      // Redirect to appropriate dashboard based on role
      if (userRole === 'admin' || userRole === 'owner') {
        return <Navigate to="/admin" replace />;
      }
      if (userRole === 'moderator') {
        return <Navigate to="/admin/tasks" replace />;
      }
      if (userRole === 'worker') {
        return <Navigate to="/worker" replace />;
      }
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};
