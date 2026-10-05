import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';
import { Radio, KeyRound, User, Mail, ChevronRight, ArrowLeft, Building2, Users } from 'lucide-react';

export default function SignupView() {
  const { signUp, setAuthView, setAuthNotice, authLoading } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orgMode, setOrgMode] = useState('create'); // 'create' | 'join'
  const [orgName, setOrgName] = useState('');
  const [joinCode, setJoinCode] = useState('');
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
    if (orgMode === 'create' && !orgName.trim()) {
      setFormError('Please name your organization.');
      return;
    }
    if (orgMode === 'join' && !joinCode.trim()) {
      setFormError("Please enter your organization's join code.");
      return;
    }
    if (orgMode === 'join') {
      // Check the code first so a wrong one gives a clear message (the database error at sign-up is vague).
      try {
        const { data, error } = await supabase.rpc('check_department_code', { p_code: joinCode.trim() });
        if (!error && data && data.valid === false) {
          setFormError('That code is not valid. Ask your department head for the current code.');
          return;
        }
      } catch (e) { /* if the check itself is unavailable, let sign-up decide */ }
    }
    await signUp(name, email, password, orgMode, orgMode === 'create' ? orgName : joinCode);
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
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
            <p className="text-xs text-mute font-medium mt-1">Join Event Command</p>
          </div>
        </div>

        {formError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOrgMode('create')}
            className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-bold transition-all
              ${orgMode === 'create' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-canvas border-line text-mute hover:border-line-strong'}`}
          >
            <Building2 className="w-4 h-4" />
            New Organization
          </button>
          <button
            type="button"
            onClick={() => setOrgMode('join')}
            className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-bold transition-all
              ${orgMode === 'join' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-canvas border-line text-mute hover:border-line-strong'}`}
          >
            <Users className="w-4 h-4" />
            Join Existing
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {orgMode === 'create' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-mute uppercase tracking-wider">Organization Name</label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Divya Jyoti Jagriti Sansthan"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
                />
              </div>
              <p className="text-xs text-faint pl-1">You'll be this organization's Admin, approved instantly.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-mute uppercase tracking-wider">Organization Join Code</label>
              <div className="relative">
                <Users className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
                <input
                  type="text"
                  required
                  placeholder="Ask your admin for this code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all tracking-widest uppercase"
                />
              </div>
              <p className="text-xs text-faint pl-1">Your organization's Admin will need to approve you before you can sign in.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Full Name</label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-faint" />
              <input
                type="text"
                required
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-11 pr-4 py-3 text-sm rounded-xl border border-line bg-canvas text-ink placeholder-faint outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

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

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Password</label>
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
            <label className="text-xs font-bold text-mute uppercase tracking-wider">Confirm Password</label>
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
            {authLoading ? 'Creating account…' : 'Create Account'}
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
