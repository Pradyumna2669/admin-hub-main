import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import logo from '@/assets/logo.jpg';

const ForgotPasswordPage: React.FC = () => {
  const [showLogin, setShowLogin] = useState(false);
  const navigate = useNavigate();

  if (showLogin) {
    navigate('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 30%, hsl(270 60% 50% / 0.1), transparent 60%)',
        }}
      />
      <div className="w-full max-w-md relative animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-block p-1 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30 animate-pulse-glow">
            <img src={logo} alt="StoicOps Logo" className="h-20 w-20 rounded-xl object-cover" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground mt-4">
            Stoic<span className="text-gradient">Ops</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Forgot your password? Enter your email to reset it.
          </p>
        </div>
        <div className="stoic-card p-8">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-6 text-center">
            Forgot Password
          </h2>
          <ForgotPasswordForm onSwitchToLogin={() => setShowLogin(true)} />
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
