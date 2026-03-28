import React, { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { sendTaskStatusDiscord } from '@/lib/taskDiscord';
import {
  compressImageForUpload,
  getUploadFileExtension,
  IMAGE_UPLOAD_PRESETS,
} from '@/lib/imageUpload';
import { getUserUploadsObjectPath } from '@/lib/storagePaths';
import {
  IndianRupee,
  CheckCircle2,
  QrCode,
  Smartphone,
  Upload,
  ReceiptText,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const PAYMENTS_PAGE_SIZE = 20;

type AssignmentRow = {
  id: string;
  user_id: string;
  amount: number | null;
  payment_status: string;
  status: string;
  is_removal: boolean | null;
  tasks: {
    id: string;
    title: string;
    amount: number | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string | null;
    upi_id: string | null;
  } | null;
};

type WorkerPaymentGroup = {
  user_id: string;
  worker_name: string;
  worker_email: string | null;
  upi_id: string | null;
  assignments: AssignmentRow[];
  total: number;
};

const AdminPayments: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedGroup, setSelectedGroup] = useState<WorkerPaymentGroup | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);

  const resetDialogState = () => {
    setSelectedGroup(null);
    setQrCodeDataUrl(null);
    setTransactionId('');
    setPaymentNotes('');
    setPaymentProofFile(null);
  };

  const {
    data: paymentPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-payments'],
    queryFn: async ({ pageParam = 0 }: { pageParam?: number }) => {
      const from = pageParam * PAYMENTS_PAGE_SIZE;
      const to = from + PAYMENTS_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('task_assignments')
        .select(`
          id,
          user_id,
          amount,
          payment_status,
          status,
          is_removal,
          tasks(id, title, amount),
          profiles:user_id (full_name, email, upi_id)
        `)
        .eq('payment_status', 'pending')
        .or('status.eq.completed,is_removal.eq.true')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return (data || []) as unknown as AssignmentRow[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAYMENTS_PAGE_SIZE ? undefined : allPages.length,
    initialPageParam: 0,
    refetchOnWindowFocus: true,
  });

  const payments = useMemo(() => (paymentPages?.pages.flat() || []) as AssignmentRow[], [paymentPages]);
  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: !!hasNextPage,
    isLoading: isLoading || isFetchingNextPage,
    onLoadMore: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
  });

  const groupedPayments = useMemo(() => {
    const map = new Map<string, WorkerPaymentGroup>();
    for (const assignment of payments) {
      const workerName =
        assignment.profiles?.full_name ||
        assignment.profiles?.email ||
        'Unknown tasker';
      const workerEmail = assignment.profiles?.email || null;
      const key = assignment.user_id;
      const current = map.get(key) || {
        user_id: assignment.user_id,
        worker_name: workerName,
        worker_email: workerEmail,
        upi_id: assignment.profiles?.upi_id || null,
        assignments: [],
        total: 0,
      };
      const finalAmount = assignment.amount || assignment.tasks?.amount || 0;
      current.assignments.push(assignment);
      current.total += finalAmount;
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [payments]);

  const loadWorkerGroup = async (group: WorkerPaymentGroup) => {
    setLoadingGroup(true);
    const { data, error } = await supabase
      .from('task_assignments')
      .select(`
        id,
        user_id,
        amount,
        payment_status,
        status,
        is_removal,
        tasks(id, title, amount),
        profiles:user_id (full_name, email, upi_id)
      `)
      .eq('user_id', group.user_id)
      .eq('payment_status', 'pending')
      .or('status.eq.completed,is_removal.eq.true');

    if (error) {
      toast({
        title: 'Failed to load tasker payments',
        description: error.message,
        variant: 'destructive',
      });
      setLoadingGroup(false);
      return;
    }

    const assignments = (data || []) as unknown as AssignmentRow[];
    const total = assignments.reduce((sum, assignment) => sum + (assignment.amount || assignment.tasks?.amount || 0), 0);
    const workerName =
      assignments[0]?.profiles?.full_name ||
      assignments[0]?.profiles?.email ||
      group.worker_name;
    const workerEmail = assignments[0]?.profiles?.email || group.worker_email || null;
    const upiId = assignments[0]?.profiles?.upi_id || group.upi_id || null;

    setSelectedGroup({
      user_id: group.user_id,
      worker_name: workerName,
      worker_email: workerEmail,
      upi_id: upiId,
      assignments,
      total,
    });
    setLoadingGroup(false);
  };

  const upiPaymentLink = useMemo(() => {
    if (!selectedGroup?.upi_id) return '';
    const params = new URLSearchParams({
      pa: selectedGroup.upi_id,
      pn: selectedGroup.worker_name,
      am: selectedGroup.total.toFixed(2),
      cu: 'INR',
      tn: `Task payouts - ${selectedGroup.worker_name}`,
    });
    return `upi://pay?${params.toString()}`;
  }, [selectedGroup]);

  useEffect(() => {
    let cancelled = false;

    const generateQrCode = async () => {
      if (!selectedGroup?.upi_id || !upiPaymentLink) {
        setQrCodeDataUrl(null);
        setIsGeneratingQr(false);
        return;
      }

      setIsGeneratingQr(true);

      try {
        const dataUrl = await QRCode.toDataURL(upiPaymentLink, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
        });

        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeDataUrl(null);
          toast({
            title: 'QR generation failed',
            description: 'Could not generate the UPI QR code for this payment.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) {
          setIsGeneratingQr(false);
        }
      }
    };

    generateQrCode();

    return () => {
      cancelled = true;
    };
  }, [selectedGroup, toast, upiPaymentLink]);

  const markPaidMutation = useMutation({
    mutationFn: async (group: WorkerPaymentGroup) => {
      if (!paymentProofFile) {
        throw new Error('Payment screenshot is required.');
      }

      const trimmedTransactionId = transactionId.trim();
      const optimizedProof = await compressImageForUpload(
        paymentProofFile,
        IMAGE_UPLOAD_PRESETS.paymentProof
      );

      const fileExt = getUploadFileExtension(optimizedProof);
      const fileIdStr = trimmedTransactionId ? `-${trimmedTransactionId}` : '';
      const filePath = `payment-proofs/${group.user_id}/${Date.now()}${fileIdStr}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('user_uploads')
        .upload(filePath, optimizedProof, { upsert: false });

      if (uploadError) throw uploadError;

      const paidAt = new Date().toISOString();
      const assignmentIds = group.assignments.map((assignment) => assignment.id);
      const taskIds = Array.from(
        new Set(
          group.assignments
            .map((assignment) => assignment.tasks?.id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      );

      const { error: updateError } = await supabase
        .from('task_assignments')
        .update({
          payment_status: 'paid',
          payment_completed_at: paidAt,
        })
        .in('id', assignmentIds);

      if (updateError) throw updateError;

      for (const assignmentId of assignmentIds) {
        await sendTaskStatusDiscord(assignmentId);
      }

      if (taskIds.length > 0) {
        const { error: discordClearError } = await supabase
          .from('tasks')
          .update({ discord_message_id: null })
          .in('id', taskIds);

        if (discordClearError) throw discordClearError;
      }

      const logs = group.assignments.map((assignment) => ({
        assignment_id: assignment.id,
        task_id: assignment.tasks?.id,
        worker_id: group.user_id,
        worker_name: group.worker_name || null,
        worker_email: group.worker_email || null,
        amount: assignment.amount || assignment.tasks?.amount || 0,
        transaction_id: trimmedTransactionId || null,
        payment_proof_url: getUserUploadsObjectPath(filePath) || filePath,
        notes: paymentNotes.trim() || null,
        paid_by: user?.id,
        payer_name: user?.email || null,
        paid_at: paidAt,
      }));

      const { error: logError } = await supabase
        .from('payment_logs')
        .insert(logs);

      if (logError) {
        await supabase
          .from('task_assignments')
          .update({
            payment_status: 'pending',
            payment_completed_at: null,
          })
          .in('id', assignmentIds);
        throw logError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      queryClient.invalidateQueries({ queryKey: ['payment-logs'] });
      queryClient.invalidateQueries({ queryKey: ['admin-expenses'] });
      resetDialogState();
      toast({
        title: 'Payment recorded',
        description: 'Payment details and proof were saved.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Payment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Pending Payments</h1>
          <p className="text-sm text-muted-foreground">
            Pay each tasker once in bulk. All pending tasks for that tasker are closed together.
          </p>
        </div>

        {isLoading ? (
          <p>Loading payments...</p>
        ) : groupedPayments.length > 0 ? (
          <div className="space-y-4">
            {groupedPayments.map((group) => (
              <Card
                key={group.user_id}
                className="p-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="space-y-2">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {group.worker_name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {group.worker_email || 'No email'}
                    </p>
                  </div>

                  <p className="text-sm">
                    UPI:{' '}
                    <strong>{group.upi_id || 'Not provided'}</strong>
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                      Pending {group.assignments.length} task{group.assignments.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2 text-left lg:text-right">
                  <p className="text-xl font-bold flex items-center gap-1 lg:justify-end">
                    <IndianRupee className="h-5 w-5" />
                    {group.total.toFixed(2)}
                  </p>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loadingGroup}
                      onClick={() => loadWorkerGroup(group)}
                    >
                      <QrCode className="h-4 w-4 mr-1" />
                      {loadingGroup ? 'Loading...' : 'Open Payout Form'}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p>No pending payments.</p>
        )}

        {groupedPayments.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more payments...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest pending payments'}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => {
          if (!open) {
            resetDialogState();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Record Bulk Payment</DialogTitle>
            <DialogDescription>
              Pay this tasker once for all pending tasks. Upload payment proof and an optional transaction ID.
            </DialogDescription>
          </DialogHeader>

          {selectedGroup && (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="font-medium">
                    {selectedGroup.worker_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedGroup.worker_email || 'No email'}
                  </p>
                  <p className="mt-2 text-sm">
                    UPI: <strong>{selectedGroup.upi_id || 'Not provided'}</strong>
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                    <IndianRupee className="h-4 w-4" />
                    {selectedGroup.total.toFixed(2)}
                  </p>
                </div>

                {selectedGroup.upi_id ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-xl border bg-white p-4 shadow-sm">
                      {isGeneratingQr ? (
                        <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">
                          Generating QR...
                        </div>
                      ) : qrCodeDataUrl ? (
                        <img
                          src={qrCodeDataUrl}
                          alt={`UPI QR for ${selectedGroup.worker_name}`}
                          className="h-64 w-64"
                        />
                      ) : (
                        <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">
                          QR unavailable
                        </div>
                      )}
                    </div>

                    <Button asChild variant="outline" className="w-full">
                      <a href={upiPaymentLink}>
                        <Smartphone className="h-4 w-4 mr-1" />
                        Open in UPI App
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    This tasker has no UPI ID on profile, so a QR code cannot be generated.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Tasks included</p>
                  <div className="mt-3 space-y-2">
                    {selectedGroup.assignments.map((assignment) => (
                      <div key={assignment.id} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {assignment.tasks?.title || 'Untitled task'}
                        </span>
                        <span className="font-semibold">
                          Rs {(assignment.amount || assignment.tasks?.amount || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="transaction-id">Transaction ID / UTR (Optional)</Label>
                  <Input
                    id="transaction-id"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="Enter the payment reference number"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="payment-proof">Payment Screenshot</Label>
                  <Input
                    id="payment-proof"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPaymentProofFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Upload the confirmation screenshot from GPay, PhonePe, bank app, or UPI app.
                  </p>
                  {paymentProofFile && (
                    <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <Upload className="h-4 w-4" />
                      {paymentProofFile.name}
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="payment-notes">Notes</Label>
                  <Textarea
                    id="payment-notes"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Optional note for this payout"
                    rows={5}
                  />
                </div>

                <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <ReceiptText className="mt-0.5 h-4 w-4" />
                    <p>
                      Saving this payout records the amount, tasks, tasker, payer, transaction ID, timestamp, and proof screenshot for expense tracking.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetDialogState}>
              Close
            </Button>
            <Button
              onClick={() => selectedGroup && markPaidMutation.mutate(selectedGroup)}
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={markPaidMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {markPaidMutation.isPending ? 'Saving...' : 'Save Payment Proof'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminPayments;
