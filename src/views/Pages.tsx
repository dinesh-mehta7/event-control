import React, { useState } from 'react';
import { useAccess } from '../context/AccessContext';
import { Card, btnPrimary, inputCls } from '../components/ui';
import { LifeBuoy } from 'lucide-react';

export { MeetingsEmergency } from './MeetingsPage';

// For people who are signed in but are not in a department yet: join one with its sign-up code, or raise a request.
export const OtherDept: React.FC = () => {
  const { requestAccess } = useAccess();
  const [code, setCode] = useState(''); const [msg, setMsg] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!code.trim()) return; setBusy(true); setMsg('');
    const e = await requestAccess(code.trim()); setBusy(false);
    if (e) { setOk(false); setMsg(e); } else { setOk(true); setMsg('Sent. The Organization Head will review it.'); setCode(''); }
  };
  return (
    <div className="space-y-4 max-w-lg">
      <Card icon={LifeBuoy} title="Need something?">
        <p className="text-sm text-mute mb-3">Ask for equipment or services with a request. It goes to the owner for approval.</p>
        <a href="#/requests/new" className={btnPrimary + ' inline-flex'}>Raise a request</a>
      </Card>
      <Card icon={LifeBuoy} title="Join a department">
        <p className="text-sm text-mute mb-3">Enter the code your department head gave you. The owner approves it before you get access.</p>
        <div className="flex gap-2"><input className={inputCls} placeholder="Department code" aria-label="Department code" value={code} onChange={e => setCode(e.target.value)} />
          <button className={btnPrimary} disabled={busy} onClick={send}>Send</button></div>
        {msg && <p role="status" className={`text-sm mt-2 ${ok ? 'text-emerald-400' : 'text-red-300'}`}>{msg}</p>}
      </Card>
    </div>
  );
};
