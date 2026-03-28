import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AppSettings = {
  maintenance_mode: boolean;
};

export const APP_SETTINGS_QUERY_KEY = ['app-settings'];

export const useAppSettings = () =>
  useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('maintenance_mode')
        .eq('id', 'global')
        .maybeSingle();

      if (error) {
        throw error;
      }

      return {
        maintenance_mode: !!data?.maintenance_mode,
      };
    },
    staleTime: 60_000,
  });
