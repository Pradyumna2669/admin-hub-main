import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { parseRedditData } from '@/lib/redditVerification';

type RejectedRedditAccount = {
  reddit_username: string | null;
  reddit_data: unknown;
  is_verified: boolean | null;
};

type RedditVerificationMetadata = {
  verification?: {
    status?: string;
    rejectionReason?: string;
  };
};

export const BannedAccountBanner: React.FC = () => {
  const { user, userRole } = useAuth();
  const isWorker = userRole === 'worker';

  const { data: bannedAccounts } = useQuery({
    queryKey: ['banned-reddit-accounts', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('reddit_accounts')
        .select('reddit_username, reddit_data, is_verified')
        .eq('user_id', user.id)
        .eq('is_verified', false);

      if (error) {
        console.error('Error fetching reddit accounts for banner:', error);
        return [];
      }

      // Filter for accounts that were rejected due to a ban
      return ((data || []) as RejectedRedditAccount[]).filter((account) => {
        const parsedData = parseRedditData(account.reddit_data) as RedditVerificationMetadata;
        const status = parsedData.verification?.status;
        const reason = parsedData.verification?.rejectionReason;
        
        return status === 'rejected_by_admin' && reason === 'Account Banned on Reddit';
      });
    },
    enabled: isWorker && !!user?.id,
  });

  if (!isWorker || !bannedAccounts || bannedAccounts.length === 0) {
    return null;
  }

  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-3 shadow-md z-50">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
          <div className="text-sm font-medium">
            Action Required: Your Reddit account{bannedAccounts.length > 1 ? 's' : ''} (
            <span className="font-bold">
              {bannedAccounts.map(a => `u/${a.reddit_username}`).join(', ')}
            </span>
            ) {bannedAccounts.length > 1 ? 'have' : 'has'} been suspended/banned on Reddit. You must add a new verified account to continue taking tasks.
          </div>
        </div>
        <Link 
          to="/profile" 
          className="shrink-0 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-background text-foreground hover:bg-background/90 h-9 px-4 py-2"
        >
          Update Profile
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </div>
    </div>
  );
};
