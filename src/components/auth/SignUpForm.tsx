import React, { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { setPendingReferralCode } from '@/lib/referrals';

interface SignUpFormProps {
  onSwitchToLogin: () => void;
  referralCode?: string;
  referrerLabel?: string;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({
  onSwitchToLogin,
  referralCode,
  referrerLabel,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const { signUp } = useAuth();
  const { toast } = useToast();

  // 🔥 Password Strength Logic
  const passwordStrength = useMemo(() => {
    let score = 0;

    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    return score;
  }, [password]);

  const strengthLabel = useMemo(() => {
    if (passwordStrength <= 1) return 'Weak';
    if (passwordStrength <= 3) return 'Medium';
    return 'Strong';
  }, [passwordStrength]);

  const strengthColor = useMemo(() => {
    if (passwordStrength <= 1) return 'bg-red-500';
    if (passwordStrength <= 3) return 'bg-yellow-500';
    return 'bg-green-500';
  }, [passwordStrength]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      setPendingReferralCode(referralCode);
      const { error } = await signUp(email, password, fullName, 'worker', undefined, undefined, referralCode || null);

      if (error) {
        toast({
          title: 'Sign up failed',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Account created 🎉',
          description: 'Please check your email to confirm your account.',
        });
        onSwitchToLogin();
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Something went wrong.',
        variant: 'destructive',
      });
    }

    setLoading(false);
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      {/* Full Name */}
      <div className="space-y-2">
        <Label>Full Name</Label>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Enter your full name"
          required
          className="bg-input border-border focus:ring-2 focus:ring-primary/40 transition-all"
        />
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          required
          className="bg-input border-border focus:ring-2 focus:ring-primary/40 transition-all"
        />
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label>Password</Label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
            required
            minLength={6}
            className="bg-input border-border pr-10 focus:ring-2 focus:ring-primary/40 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {/* 🔥 Animated Strength Meter */}
        {password && (
          <div className="mt-2 space-y-1">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(passwordStrength / 5) * 100}%` }}
                transition={{ duration: 0.3 }}
                className={`h-full ${strengthColor}`}
              />
            </div>
            <p
              className={`text-xs font-medium ${
                passwordStrength <= 1
                  ? 'text-red-500'
                  : passwordStrength <= 3
                  ? 'text-yellow-500'
                  : 'text-green-500'
              }`}
            >
              {strengthLabel} Password
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-input/50 p-4">
        <Label>Account Type</Label>
        <p className="mt-2 text-sm text-foreground">Tasker</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Client signup is currently closed. New public registrations are tasker accounts only.
        </p>
      </div>

      {referralCode ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Label>Referral</Label>
          <p className="mt-2 text-sm text-foreground">
            Joining with referral code <span className="font-semibold">{referralCode}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {referrerLabel
              ? `Referrer: ${referrerLabel}.`
              : 'Your referrer will be credited after your first submitted and verified task.'}
          </p>
        </div>
      ) : null}

      {/* Submit Button */}
      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
        <Button
          type="submit"
          disabled={loading}
          className="relative w-full overflow-hidden group
                     bg-gradient-to-r from-primary via-primary/90 to-primary
                     text-white transition-all duration-300
                     hover:shadow-[0_0_30px_rgba(99,102,241,0.6)]"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating account...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <UserPlus size={18} />
              Create Account
            </span>
          )}
        </Button>
      </motion.div>

      <p className="text-center text-muted-foreground text-sm">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-primary hover:text-primary/80 transition-colors font-medium"
        >
          Sign in
        </button>
      </p>
    </motion.form>
  );
};
