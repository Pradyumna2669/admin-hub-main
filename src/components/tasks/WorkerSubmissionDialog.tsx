import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  compressImageForUpload,
  getUploadFileExtension,
  IMAGE_UPLOAD_PRESETS,
} from '@/lib/imageUpload';
import { toStorageObjectValue } from '@/lib/storagePaths';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { 
  X,
  Plus,
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock
} from 'lucide-react';

interface WorkerSubmissionProps {
  taskId: string;
  taskTitle: string;
  taskCompletionTime: number; // in minutes
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SubmissionLink {
  id: string;
  url: string;
}

export const WorkerSubmissionDialog: React.FC<WorkerSubmissionProps> = ({
  taskId,
  taskTitle,
  taskCompletionTime,
  open,
  onOpenChange,
}) => {
  const [submissionLinks, setSubmissionLinks] = useState<SubmissionLink[]>([
    { id: '1', url: '' }
  ]);
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) {
        throw new Error('You must be logged in to submit a task');
      }

      const validLinks = submissionLinks
        .map((l) => l.url.trim())
        .filter((url) => url.length > 0);

      if (validLinks.length === 0) {
        throw new Error('At least one submission link is required');
      }

      const screenshotUrls: string[] = [];
      const uploadedPaths: string[] = [];

      try {
        for (let i = 0; i < screenshotFiles.length; i++) {
          const file = screenshotFiles[i];
          const optimizedFile = await compressImageForUpload(
            file,
            IMAGE_UPLOAD_PRESETS.screenshot
          );
          const fileExt = getUploadFileExtension(optimizedFile);
          const fileName = `${taskId}/${user.id}/${Date.now()}_screenshot_${i}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('task-submissions')
            .upload(fileName, optimizedFile);

          if (uploadError) throw uploadError;
          uploadedPaths.push(fileName);

          screenshotUrls.push(
            toStorageObjectValue('task-submissions', fileName)
          );
        }

        const { error } = await (supabase as any).rpc(
          'submit_task_submission',
          {
            p_task_id: taskId,
            p_submission_links: validLinks,
            p_screenshot_urls: screenshotUrls,
            p_submission_notes: notes.trim() || null,
          }
        );
        if (error) throw error;
        return true;
      } catch (error) {
        if (uploadedPaths.length > 0) {
          await supabase.storage
            .from('task-submissions')
            .remove(uploadedPaths);
        }

        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: 'Submission successful',
        description:
          'Your task is being verified. This may take 24-48 hours.',
      });
      queryClient.invalidateQueries();
      onOpenChange(false);
      resetForm();
    },
  });


  const resetForm = () => {
    setSubmissionLinks([{ id: '1', url: '' }]);
    setScreenshotFiles([]);
    setNotes('');
  };

  const addLinkField = () => {
    const newId = String(Math.max(...submissionLinks.map((l) => parseInt(l.id) || 0)) + 1);
    setSubmissionLinks([...submissionLinks, { id: newId, url: '' }]);
  };

  const removeLink = (id: string) => {
    if (submissionLinks.length > 1) {
      setSubmissionLinks(submissionLinks.filter((l) => l.id !== id));
    }
  };

  const updateLink = (id: string, url: string) => {
    setSubmissionLinks(
      submissionLinks.map((l) => (l.id === id ? { ...l, url } : l))
    );
  };

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setScreenshotFiles([...screenshotFiles, ...Array.from(e.target.files)]);
    }
  };

  const removeScreenshot = (index: number) => {
    setScreenshotFiles(screenshotFiles.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader className="sticky top-0 bg-card z-10 pb-4 border-b border-border">
          <DialogTitle className="text-xl font-bold text-foreground">
            Submit Task: {taskTitle}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Submit your links and screenshots for verification
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Task Completion Info */}
          <Card className="bg-background border-border p-4">
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-5 w-5 text-blue-600" />
              <span className="text-muted-foreground">
                Task completion time limit: <span className="font-semibold text-foreground">{taskCompletionTime} minutes</span>
              </span>
            </div>
          </Card>

          {/* Submission Links */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground flex items-center gap-1">
              Submission Links <span className="text-red-600">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Add the links you used to complete this task (e.g., Reddit comments, posts, etc.)
            </p>
            
            <div className="space-y-2">
              {submissionLinks.map((link) => (
                <div key={link.id} className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://..."
                    value={link.url}
                    onChange={(e) => updateLink(link.id, e.target.value)}
                    className="flex-1 bg-input border-border"
                  />
                  {submissionLinks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLink(link.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLinkField}
              className="border-border hover:bg-input"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Another Link
            </Button>
          </div>

          {/* Screenshots */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground">
              Screenshots (Optional)
            </label>
            <p className="text-xs text-muted-foreground">
              Upload screenshots of your work to help with verification
            </p>

            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
              <Input
                type="file"
                multiple
                accept="image/*"
                onChange={handleScreenshotUpload}
                className="hidden"
                id="screenshot-upload"
              />
              <label htmlFor="screenshot-upload" className="cursor-pointer flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to upload screenshots or drag and drop
                </span>
                <span className="text-xs text-muted-foreground">
                  PNG, JPG up to 10MB each
                </span>
              </label>
            </div>

            {screenshotFiles.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Uploaded Screenshots ({screenshotFiles.length})</h4>
                {screenshotFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-background border border-border rounded p-3">
                    <span className="text-sm text-muted-foreground truncate">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeScreenshot(index)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground">
              Additional Notes (Optional)
            </label>
            <Textarea
              placeholder="Add any notes or context about your submission..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-input border-border min-h-24"
            />
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="flex-1 stoic-button-primary"
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Task'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WorkerSubmissionDialog;

