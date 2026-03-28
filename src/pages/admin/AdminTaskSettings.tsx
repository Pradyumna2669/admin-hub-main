import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useTaskClaimSettings, DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES } from '@/hooks/useTaskClaimSettings';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ALL_TASK_TYPES, getTaskTypeLabel, TaskType } from '@/lib/taskTypes';
import { useTaskTypeRateSettings } from '@/hooks/useTaskTypeRateSettings';
import { ALL_LEAGUES, LEAGUE_LABELS, League } from '@/lib/workerLeagues';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AdminTaskSettings: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [league, setLeague] = useState<League>('bronze');
  const { data: rates, isLoading } = useTaskTypeRateSettings(league);
  const { data: taskClaimSettings, isLoading: claimSettingsLoading } = useTaskClaimSettings();

  const initial = useMemo(() => {
    const obj: Record<TaskType, { amount: string; removal_amount: string }> = {} as any;
    for (const t of ALL_TASK_TYPES) {
      obj[t] = {
        amount: String(rates?.[t]?.amount ?? ''),
        removal_amount: String(rates?.[t]?.removal_amount ?? ''),
      };
    }
    return obj;
  }, [rates]);

  const [draft, setDraft] = useState<Record<TaskType, { amount: string; removal_amount: string }>>(
    () => initial
  );
  const [claimCooldownMinutes, setClaimCooldownMinutes] = useState(
    String(DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES)
  );

  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  React.useEffect(() => {
    setClaimCooldownMinutes(
      String(taskClaimSettings?.claim_cooldown_minutes ?? DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES)
    );
  }, [taskClaimSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = ALL_TASK_TYPES.map((t) => ({
        league,
        task_type: t,
        amount: Number(draft[t]?.amount || 0),
        removal_amount: Number(draft[t]?.removal_amount || 0),
      }));

      const bad = payload.find(
        (p) =>
          !Number.isFinite(p.amount) ||
          p.amount < 0 ||
          !Number.isFinite((p as any).removal_amount) ||
          (p as any).removal_amount < 0
      );
      if (bad) throw new Error('Amounts must be valid numbers >= 0');

      const parsedCooldown = Number(claimCooldownMinutes);
      if (!Number.isFinite(parsedCooldown) || parsedCooldown < 0) {
        throw new Error('Claim cooldown must be a valid number >= 0');
      }

      const { error } = await supabase
        .from('task_type_rates')
        .upsert(payload, { onConflict: 'league,task_type' });

      if (error) throw error;

      const { error: cooldownError } = await supabase
        .from('task_claim_settings')
        .upsert(
          {
            id: 'global',
            claim_cooldown_minutes: parsedCooldown,
          },
          { onConflict: 'id' }
        );

      if (cooldownError) throw cooldownError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-type-rate-settings'] });
      queryClient.invalidateQueries({ queryKey: ['task-type-rates'] });
      queryClient.invalidateQueries({ queryKey: ['task-claim-settings'] });
      toast({ title: 'Saved', description: 'Task settings updated.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Task Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Set the default payout amount for each task type and league, including removal compensation (when a submission is rejected/removed).
          </p>
        </div>

        <Card className="p-6 space-y-5">
          <div className="grid gap-2">
            <Label className="text-foreground">Claim Cooldown (minutes)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={claimCooldownMinutes}
              onChange={(e) => setClaimCooldownMinutes(e.target.value)}
              className="bg-input border-border max-w-xs"
              disabled={claimSettingsLoading}
            />
            <p className="text-xs text-muted-foreground">
              After a tasker claims a task, they must wait this long before claiming another one.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-foreground">League</Label>
            <Select value={league} onValueChange={(value) => setLeague(value as League)}>
              <SelectTrigger className="bg-input border-border max-w-xs">
                <SelectValue placeholder="Select league" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {ALL_LEAGUES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LEAGUE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <p>Loading...</p>
          ) : (
            <div className="grid gap-4">
              {ALL_TASK_TYPES.map((t) => (
                <div key={t} className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <Label className="text-foreground">{getTaskTypeLabel(t)}</Label>
                    <p className="text-xs text-muted-foreground">{t}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={draft[t]?.amount ?? ''}
                        onChange={(e) =>
                          setDraft((s) => ({
                            ...s,
                            [t]: { ...s[t], amount: e.target.value },
                          }))
                        }
                        className="bg-input border-border"
                      />
                      <span className="text-sm text-muted-foreground">INR</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={draft[t]?.removal_amount ?? ''}
                        onChange={(e) =>
                          setDraft((s) => ({
                            ...s,
                            [t]: { ...s[t], removal_amount: e.target.value },
                          }))
                        }
                        className="bg-input border-border"
                      />
                      <span className="text-sm text-muted-foreground">Removal</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => {
                setDraft(initial);
                setClaimCooldownMinutes(
                  String(taskClaimSettings?.claim_cooldown_minutes ?? DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES)
                );
              }}
              disabled={saveMutation.isPending}
            >
              Reset
            </Button>
            <Button
              className="stoic-button-primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminTaskSettings;
