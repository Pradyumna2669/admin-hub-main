import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionMissing, setSessionMissing] = useState(false);

  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!data.session) {
        setSessionMissing(true);
      }

      setCheckingSession(false);
    };

    // Listen for session changes (important for reset links)
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session) {
          setSessionMissing(false);
          setCheckingSession(false);
        }
      }
    );

    checkSession();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirm) {
      toast({
        title: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (error) {
      toast({
        title: 'Reset failed',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Password updated',
        description: 'You can now log in with your new password.',
      });
      navigate('/login');
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="stoic-card p-8 max-w-md w-full text-center">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Checking session...</p>
        </div>
      </div>
    );
  }

  if (sessionMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="stoic-card p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-semibold mb-4 text-destructive">
            Reset link expired
          </h2>
          <p className="mb-4 text-muted-foreground">
            Your password reset link is invalid or expired.
            Please request a new one.
          </p>
          <Button onClick={() => navigate('/forgot-password')}>
            Request New Link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="stoic-card p-8 max-w-md w-full space-y-6"
      >
        <h2 className="text-xl font-semibold text-center">
          Set New Password
        </h2>

        <div className="space-y-2">
          <Label htmlFor="password">New Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Enter new password"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            placeholder="Confirm new password"
          />
        </div>

        <Button
          type="submit"
          className="w-full stoic-button-primary"
          disabled={loading}
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </Button>
      </form>
    </div>
  );
};

export default ResetPassword;
