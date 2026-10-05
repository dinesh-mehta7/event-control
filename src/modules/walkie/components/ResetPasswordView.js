import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Radio, KeyRound, ChevronRight } from 'lucide-react';

export default function ResetPasswordView() {
  const { updatePassword, authLoading } = useApp();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    await updatePassword(password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>

      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-8 shadow-2xl relative z-10 space-y-6">

        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-blue-600/20 text-blue-500 border border-blue-500/30 shadow-lg">
            <Radio className="w-8 h-8 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Set a new password</h1>
            <p className="text-xs text-mute font-medium mt-1">
              You're verified via your email link — choose a new password below.
            </p>
          </div>
        </div>

        {formError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">New Password</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="password"
                required
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Confirm New Password</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="password"
                required
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm"
          >
            {authLoading ? 'Updating…' : 'Update Password'}
            {!authLoading && <ChevronRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
