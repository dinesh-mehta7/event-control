import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Radio, KeyRound, User, ChevronRight, AlertCircle, Info } from 'lucide-react';

export default function LoginView() {
  const { login, setAuthView, authNotice, setAuthNotice, authLoading, resendVerificationEmail } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    await login(email, password);
  };

  const isUnverified = authNotice && /verify your email/i.test(authNotice);

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4 relative overflow-hidden">
      {/* Tech Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>

      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-8 shadow-2xl relative z-10 space-y-6">

        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-blue-600/20 text-blue-500 border border-blue-500/30 shadow-lg">
            <Radio className="w-8 h-8 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Event Command</h1>
            <p className="text-xs text-mute font-medium mt-1">Walkie Talkie Management System</p>
          </div>
        </div>

        {/* Notice banner (verification sent, reset sent, account disabled, etc.) */}
        {authNotice && (
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>{authNotice}</p>
              {isUnverified && (
                <button
                  type="button"
                  onClick={() => resendVerificationEmail(email)}
                  className="mt-1.5 font-bold underline underline-offset-2 hover:text-blue-200"
                >
                  Resend verification email
                </button>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Business Email</label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="email"
                required
                placeholder="e.g. admin@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setAuthNotice(null); }}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-mute uppercase tracking-wider">Password</label>
              <button
                type="button"
                onClick={() => { setAuthNotice(null); setAuthView('forgot'); }}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setAuthNotice(null); }}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm"
          >
            {authLoading ? 'Signing in…' : 'Sign In'}
            {!authLoading && <ChevronRight className="w-4 h-4" />}
          </button>

          {submitted && !authLoading && !authNotice && (
            <p className="flex items-center gap-1.5 text-xs text-faint justify-center">
              <AlertCircle className="w-3.5 h-3.5" />
              Trouble signing in? Double-check your email and password.
            </p>
          )}
        </form>

        {/* Sign up link */}
        <div className="pt-4 border-t border-line text-center">
          <p className="text-xs text-mute">
            New here?{' '}
            <button
              type="button"
              onClick={() => { setAuthNotice(null); setAuthView('signup'); }}
              className="font-bold text-blue-400 hover:text-blue-300"
            >
              Create an account
            </button>
          </p>
          <p className="text-xs text-faint mt-2">
            New accounts start as read-only Clients — an Administrator upgrades
            your access from the Users screen.
          </p>
        </div>

      </div>
    </div>
  );
}
