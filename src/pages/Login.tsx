import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignUpForm } from '@/components/auth/SignUpForm';
import logo from '@/assets/logo.jpg';

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const { user, userRole, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && userRole) {
      if (userRole === 'admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    }
  }, [user, userRole, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background glow effect */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 30%, hsl(270 60% 50% / 0.1), transparent 60%)',
        }}
      />

      <div className="w-full max-w-md relative animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block p-1 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30 animate-pulse-glow">
            <img 
              src={logo} 
              alt="StoicOps Logo" 
              className="h-20 w-20 rounded-xl object-cover"
            />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground mt-4">
            Stoic<span className="text-gradient">Ops</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            {isLogin ? 'Welcome back. Enter your credentials.' : 'Create your account to get started.'}
          </p>
        </div>

        {/* Auth Card */}
        <div className="stoic-card p-8">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-6 text-center">
            {isLogin ? 'Sign In' : 'Create Account'}
          </h2>

          {isLogin ? (
            <LoginForm onSwitchToSignUp={() => setIsLogin(false)} />
          ) : (
            <SignUpForm onSwitchToLogin={() => setIsLogin(true)} />
          )}
        </div>

        {/* Stoic quote */}
        <p className="text-center text-muted-foreground text-sm mt-8 italic">
          "The impediment to action advances action. What stands in the way becomes the way."
        </p>
        <p className="text-center text-muted-foreground text-xs mt-1">
          — Marcus Aurelius
        </p>
      </div>
    </div>
  );
};

export default Login;
