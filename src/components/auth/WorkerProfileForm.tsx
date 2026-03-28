import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { clearPendingReferralCode, normalizeReferralCode } from '@/lib/referrals';
import {
  compressImageForUpload,
  getUploadFileExtension,
  IMAGE_UPLOAD_PRESETS,
} from '@/lib/imageUpload';
import {
  normalizeRedditUsername,
  saveRedditAccount,
} from '@/lib/redditVerification';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WorkerProfileFormProps {
  userId: string;
  existingUpiId?: string | null;
  initialReferralCode?: string | null;
  onComplete: (result?: { isVerified: boolean }) => void;
  rejectionDetails?: { username: string; reason?: string }[];
}

export const WorkerProfileForm: React.FC<WorkerProfileFormProps> = ({
  userId,
  existingUpiId,
  initialReferralCode,
  onComplete,
  rejectionDetails,
}) => {
  const [redditId, setRedditId] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [referredBy, setReferredBy] = useState(normalizeReferralCode(initialReferralCode));
  const [karmaRange, setKarmaRange] = useState('');
  const [cqs, setCqs] = useState('');
  const [cqsProof, setCqsProof] = useState('');
  const [cqsLink, setCqsLink] = useState('');
  const [upiId, setUpiId] = useState(existingUpiId || '');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    setReferredBy(normalizeReferralCode(initialReferralCode));
  }, [initialReferralCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const rawRedditUsername = redditId.trim();

    if (/^\/?u\//i.test(rawRedditUsername)) {
      toast({
        title: 'Invalid Reddit username',
        description:
          'Enter only the username, for example Vegetable_3992, not u/Vegetable_3992.',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    const normalizedRedditUsername = normalizeRedditUsername(redditId).toLowerCase();
    const referralCode = referredBy.trim().toUpperCase();

    // Validation
    if (
      !normalizedRedditUsername ||
      !karmaRange ||
      !cqs ||
      !cqsProof.trim() ||
      !cqsLink.trim() ||
      (!upiId.trim() && !existingUpiId) ||
      !screenshot
    ) {
      toast({
        title: 'All required fields must be filled',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    // Upload screenshot
    let redditScreenshotPath: string | null = null;

    if (screenshot) {
      const optimizedScreenshot = await compressImageForUpload(
        screenshot,
        IMAGE_UPLOAD_PRESETS.screenshot
      );
      const fileExt = getUploadFileExtension(optimizedScreenshot);
      const filePath = `reddit_screenshots/${userId}/${normalizedRedditUsername}_${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } =
        await supabase.storage
          .from('user_uploads')
          .upload(filePath, optimizedScreenshot, { upsert: true });

      if (uploadError) {
        toast({
          title: 'Failed to upload screenshot',
          description: uploadError.message,
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      redditScreenshotPath = uploadData.path;
    }

    let shouldAutoVerify = false;

    try {
      const result = await saveRedditAccount({
        redditUsername: normalizedRedditUsername,
        karmaRange,
        cqs,
        cqsProof,
        cqsLink,
        discordUsername,
        referralCode: referralCode || null,
        upiId: upiId.trim() || existingUpiId || null,
        screenshotPath: redditScreenshotPath,
      });

      shouldAutoVerify = !!result.is_verified;
    } catch (error) {
      if (redditScreenshotPath) {
        await supabase.storage.from('user_uploads').remove([redditScreenshotPath]);
      }

      toast({
        title: 'Failed to save Reddit account',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    if (referralCode) {
      clearPendingReferralCode();
    }

    toast({
      title: shouldAutoVerify
        ? 'Reddit account verified!'
        : 'Reddit account submitted for verification!',
      description: !shouldAutoVerify
        ? 'Reddit profile needs admin verification.'
        : undefined,
    });
    setLoading(false);
    onComplete({ isVerified: shouldAutoVerify });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 p-6 stoic-card max-w-lg mx-auto mt-10"
    >
      {rejectionDetails && rejectionDetails.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="font-semibold">Reddit account rejected</div>
          <div className="mt-1 text-xs">
            Please add a different Reddit account. Rejection details:
          </div>
          <div className="mt-2 space-y-1 text-xs">
            {rejectionDetails.map((detail) => (
              <div key={detail.username}>
                u/{detail.username}: {detail.reason || 'No reason provided'}
              </div>
            ))}
          </div>
        </div>
      )}
      <h2 className="font-heading text-xl mb-2">
        Add a Reddit Account
      </h2>

      <Input
        value={redditId}
        onChange={(e) => setRedditId(e.target.value)}
        placeholder="Reddit Username (example: Vegetable_Hold_3377) *"
        required
        className="bg-input border-border"
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Use only the Reddit username. Do not include `u/` at the start.
      </p>

      <Input
        value={discordUsername}
        onChange={(e) => setDiscordUsername(e.target.value)}
        placeholder="Discord Username (optional)"
        className="bg-input border-border"
      />

      <Input
        value={referredBy}
        onChange={(e) => setReferredBy(e.target.value)}
        placeholder="Referral Code (optional)"
        className="bg-input border-border"
      />

      {/* Karma Range */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Karma Range *
        </label>
        <Select value={karmaRange} onValueChange={setKarmaRange}>
          <SelectTrigger className="bg-input border-border">
            <SelectValue placeholder="Select Karma Range" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="200-1K">200-1K</SelectItem>
            <SelectItem value="1K-5K">1K-5K</SelectItem>
            <SelectItem value="5K-25K">5K-25K</SelectItem>
            <SelectItem value="25K-50K">25K-50K</SelectItem>
            <SelectItem value="50K+">50K+</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* CQS */}
      <div>
        <label className="block text-sm font-medium mb-1">
          CQS Level *
        </label>
        <Select value={cqs} onValueChange={setCqs}>
          <SelectTrigger className="bg-input border-border">
            <SelectValue placeholder="Select CQS Level" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="Highest">Highest</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Moderate">Moderate</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Input
        value={cqsProof}
        onChange={(e) => setCqsProof(e.target.value)}
        placeholder="CQS Proof Link *"
        required
        className="bg-input border-border"
      />


      <Input
        value={cqsLink}
        onChange={(e) => setCqsLink(e.target.value)}
        placeholder="Reddit Profile Link *"
        required
        className="bg-input border-border"
      />

      {!existingUpiId && (
        <Input
          value={upiId}
          onChange={(e) => setUpiId(e.target.value)}
          placeholder="UPI ID (example@upi) *"
          required
          className="bg-input border-border"
        />
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Upload Reddit profile screenshot *
        </label>
        <p className="text-xs text-muted-foreground">
          Upload a screenshot of your Reddit profile or Reddit account page that clearly shows the username and profile details.
        </p>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) =>
            setScreenshot(e.target.files?.[0] || null)
          }
          required
          className="bg-input border-border"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full stoic-button-primary"
      >
        {loading ? 'Saving...' : 'Add Reddit Account'}
      </Button>
    </form>
  );
};
