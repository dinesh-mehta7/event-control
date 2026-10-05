import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import UsersView from './UsersView';
import { Lock, Users, Copy, RefreshCw, Check } from 'lucide-react';

// Team & Users (Admin only). General settings / accessory stock / data tools
// now live elsewhere: stock on the Dashboard, data tools in the profile menu.
export default function SettingsView() {
  const { settings, currentUser, addToast, currentOrganization, regenerateJoinCode } = useApp();
  const isDark = settings.theme === 'dark';
  const isAdmin = currentUser?.role === 'Admin';
  const [copied, setCopied] = useState(false);

  const handleCopyJoinCode = () => {
    if (!currentOrganization?.joinCode) return;
    navigator.clipboard.writeText(currentOrganization.joinCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => addToast('Could not copy — select and copy the code manually.', 'error'));
  };

  const handleRegenerateJoinCode = () => {
    if (window.confirm('Generate a new join code? The old code will stop working immediately.')) regenerateJoinCode();
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <Lock className="w-10 h-10 text-amber-500 mx-auto mb-2" />
        <h4 className="font-bold text-base">Admins only</h4>
        <p className="text-xs text-slate-400 mt-1">Team &amp; Users is reserved for the Admin role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team &amp; Users</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The people who can use this workspace.</p>
      </div>
      {currentOrganization && (
        <div className={`p-6 rounded-xl border relative ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            Join Code
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            {currentOrganization.name} is its own isolated organization — its data never mixes with any other organization. Share this code with people who should be able to request access; approve each of them below before they can sign in.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-lg font-mono font-bold tracking-[0.2em]">{currentOrganization.joinCode}</span>
            </div>
            <button
              onClick={handleCopyJoinCode}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
            <button
              onClick={handleRegenerateJoinCode}
              className="flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-500 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </button>
          </div>
        </div>
      )}
      <UsersView embedded />
    </div>
  );
}
