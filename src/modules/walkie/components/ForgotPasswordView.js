import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Radio, Mail, ChevronRight, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordView() {
  const { sendPasswordReset, setAuthView, setAuthNotice, authLoading } = useApp();
  const [email, setEmail] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    await sendPasswordReset(email);
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
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
            <p className="text-xs text-mute font-medium mt-1">
              We'll email you a secure link to set a new one.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm"
          >
            {authLoading ? 'Sending…' : 'Send Reset Link'}
            {!authLoading && <ChevronRight className="w-4 h-4" />}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setAuthNotice(null); setAuthView('login'); }}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-mute hover:text-ink"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </button>
      </div>
    </div>
  );
}
