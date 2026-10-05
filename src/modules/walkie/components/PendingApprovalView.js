import React from 'react';
import { useApp } from '../context/AppContext';
import { Radio, Clock, LogOut, Building2 } from 'lucide-react';

export default function PendingApprovalView() {
  const { currentUser, currentOrganization, logout } = useApp();

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>

      <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-8 shadow-2xl relative z-10 space-y-6 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-lg mx-auto">
          <Clock className="w-8 h-8" />
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Waiting for Approval</h1>
          <p className="text-sm text-mute mt-2">
            Hi {currentUser?.name}, your account has been created{currentOrganization ? <> for <span className="text-ink font-semibold">{currentOrganization.name}</span></> : ''}, but an Admin still needs to approve you before you can get in.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-faint bg-canvas border border-line rounded-xl py-3 px-4">
          <Building2 className="w-3.5 h-3.5" />
          Ask your organization's Admin to approve your request from the Users screen.
        </div>

        <p className="text-xs text-faint flex items-center justify-center gap-1.5">
          <Radio className="w-3 h-3 animate-pulse" />
          This page will update automatically once you're approved — no need to refresh.
        </p>

        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-mute hover:text-ink border border-line hover:border-line-strong rounded-xl transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
