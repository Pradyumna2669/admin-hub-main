import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  children: React.ReactNode;
}

const VerifiedWorkerRoute: React.FC<Props> = ({ children }) => {
  const { user, userRole, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isVerified, setIsVerified] = useState<boolean | null>(null);

  useEffect(() => {
    const checkVerification = async () => {
      if (user && userRole === 'worker') {
        const { data, error } = await supabase
          .from('reddit_accounts')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_verified', true)
          .limit(1);

        if (error) {
          setIsVerified(false);
        } else {
          setIsVerified((data || []).length > 0);
        }
      }
      setChecking(false);
    };

    if (!loading) checkVerification();
  }, [user, userRole, loading]);

  if (loading || checking) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (userRole === 'worker' && isVerified === false) {
    return <Navigate to="/worker/not-verified" replace />;
  }

  return <>{children}</>;
};

export default VerifiedWorkerRoute;
