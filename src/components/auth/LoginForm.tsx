import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FaDiscord } from 'react-icons/fa';
import { motion } from 'framer-motion';
import { getAuthRedirectUrl } from '@/lib/authRedirect';

interface LoginFormProps {
  onSwitchToSignUp: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSwitchToSignUp }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const { signIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // 🔹 Email login (UNCHANGED)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast({
        title: 'Login failed',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Welcome back',
        description: 'Successfully logged in.',
      });
    }

    setLoading(false);
  };

  // 🔹 Discord login (UNCHANGED)
  const loginWithDiscord = async () => {
    setLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: getAuthRedirectUrl('/login'),
      },
    });

    if (error) {
      toast({
        title: 'Discord login failed',
        description: error.message,
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email" className="text-foreground">
          Email
        </Label>
        <Input
          id="email"
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
        <Label htmlFor="password" className="text-foreground">
          Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
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
      </div>

      {/* 🔥 Animated Sign In Button */}
      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
        <Button
          type="submit"
          disabled={loading}
          className="relative w-full overflow-hidden group
                     bg-gradient-to-r from-primary via-primary/90 to-primary
                     text-white transition-all duration-300
                     hover:shadow-[0_0_30px_rgba(99,102,241,0.6)]"
        >
          {/* SVG Glow Effect */}
          <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            <svg className="w-full h-full">
              <defs>
                <radialGradient id="buttonGlow">
                  <stop offset="0%" stopColor="white" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#buttonGlow)" />
            </svg>
          </span>

          {loading ? (
            <span className="relative flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Signing in...
            </span>
          ) : (
            <span className="relative flex items-center gap-2">
              <LogIn size={18} />
              Sign In
            </span>
          )}
        </Button>
      </motion.div>

      {/* Divider */}
      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-border"></div>
        <span className="mx-4 text-xs text-muted-foreground">OR</span>
        <div className="flex-grow border-t border-border"></div>
      </div>

      {/* 💜 Animated Discord Button */}
      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
        <Button
          type="button"
          onClick={loginWithDiscord}
          disabled={loading}
          className="relative w-full overflow-hidden group
                     bg-[#5865F2] hover:bg-[#4752C4]
                     text-white transition-all duration-300
                     shadow-lg hover:shadow-[0_0_30px_rgba(88,101,242,0.6)]"
        >
          {/* Shine Sweep Effect */}
          <span className="absolute inset-0 overflow-hidden">
            <span className="absolute -left-full top-0 h-full w-1/2
                             bg-gradient-to-r from-transparent via-white/30 to-transparent
                             skew-x-12 group-hover:left-full
                             transition-all duration-700" />
          </span>

          <span className="relative flex items-center gap-2">
            {loading ? (
              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <FaDiscord className="h-5 w-5" />
            )}
            Continue with Discord
          </span>
        </Button>
      </motion.div>

      {/* Footer Links */}
      <div className="flex flex-col gap-2 text-center text-muted-foreground text-sm">
        <span>
          <button
            type="button"
            onClick={() => navigate('/forgot-password')}
            className="text-primary hover:text-primary/80 transition-colors font-medium"
          >
            Forgot Password?
          </button>
        </span>

        <span>
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignUp}
            className="text-primary hover:text-primary/80 transition-colors font-medium"
          >
            Create one
          </button>
        </span>
      </div>
    </motion.form>
  );
};
