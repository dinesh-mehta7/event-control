import React, { useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus } from 'lucide-react';
import { btnGhost, btnPrimary, inputCls } from '../../ui';
import { useApp as useWalkie } from '../../../modules/walkie/context/AppContext';

// Reads an image file and shrinks it to fit 256×256, so the stored logo stays small.
const shrinkImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.onload = () => {
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

// Super Admin: the organization's name and logo, shown in the sidebar for everyone.
export const OrganizationSettings: React.FC = () => {
  const w: any = useWalkie();
  const org = w.currentOrganization;
  const [name, setName] = useState(org?.name || '');
  const [logo, setLogo] = useState<string | null>(org?.logoUrl || null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setName(org?.name || '');
    setLogo(org?.logoUrl || null);
  }, [org?.name, org?.logoUrl]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setLogo(await shrinkImage(f));
      setMsg(null);
    } catch (x: any) {
      setMsg({ ok: false, text: x.message });
    }
  };
  const save = async () => {
    if (name.trim().length < 2) {
      setMsg({ ok: false, text: 'Enter an organization name.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const e = await w.updateOrganization(name, logo);
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: 'Saved.' });
  };
  const changed = name.trim() !== (org?.name || '') || logo !== (org?.logoUrl || null);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x: string) => x[0])
      .join('')
      .toUpperCase() || 'EC';

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line text-sm font-semibold text-ink flex items-center gap-2">
        <Building2 size={15} className="text-blue-400" />
        Organization
      </div>
      <div className="p-4 space-y-4 max-w-lg">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center w-16 h-16 rounded-xl bg-blue-600 text-white text-lg font-bold overflow-hidden shrink-0">
            {logo ? (
              <img src={logo} alt="Organization logo" className="w-full h-full object-contain bg-white" />
            ) : (
              initials
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
            <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} />
              {logo ? 'Change logo' : 'Upload logo'}
            </button>
            {logo && (
              <button
                type="button"
                className={btnGhost + ' text-red-300 hover:text-red-200'}
                onClick={() => setLogo(null)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-mute">Organization name</span>
          <input className={inputCls} value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={busy || !changed} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {msg && (
            <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {msg.text}
            </span>
          )}
        </div>
        <p className="text-xs text-faint">The name and logo show in the sidebar for everyone in the organization.</p>
      </div>
    </div>
  );
};
