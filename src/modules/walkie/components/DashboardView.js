import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Radio, BatteryCharging, Headphones, Wrench, Pencil } from 'lucide-react';

export default function DashboardView() {
  const { walkies, departments, allocations, history, settings, currentUser, inventorySettings: inv, allocatedChargers, allocatedEarphones, availableChargers, availableEarphones, updateStock } = useApp();
  const dark = settings.theme === 'dark';
  const box = `rounded-xl border ${dark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`;
  const sub = dark ? 'text-slate-400' : 'text-slate-500';
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ total: 0, fix: 0 });
  const n = (st) => walkies.filter(w => w.status === st).length;

  const cards = [
    { key: 'walkie', title: 'Walkie Talkies', icon: Radio, tone: 'text-blue-500 bg-blue-500/10', total: walkies.length, out: n('Allocated'), free: n('Available'), fix: n('Under Maintenance') },
    { key: 'charger', title: 'Chargers', icon: BatteryCharging, tone: 'text-emerald-500 bg-emerald-500/10', total: inv.totalChargers || 0, out: allocatedChargers, free: availableChargers, fix: inv.chargersMaintenance || 0 },
    { key: 'earphone', title: 'Earphones', icon: Headphones, tone: 'text-blue-500 bg-blue-500/10', total: inv.totalEarphones || 0, out: allocatedEarphones, free: availableEarphones, fix: inv.earphonesMaintenance || 0 },
  ];
  const save = async (key) => {
    const ok = await updateStock(key === 'charger' ? { totalChargers: +form.total || 0, chargersMaintenance: +form.fix || 0 } : { totalEarphones: +form.total || 0, earphonesMaintenance: +form.fix || 0 });
    if (ok) setEdit(null);
  };

  const active = allocations.filter(a => a.status === 'Active');
  const rows = departments.map(d => {
    const mine = active.filter(a => a.departmentId === d.id);
    return { id: d.id, name: d.name, w: walkies.filter(x => x.departmentId === d.id && x.status === 'Allocated').length,
      c: mine.reduce((t, a) => t + (a.chargerCount || 0), 0), e: mine.reduce((t, a) => t + (a.earphoneCount || 0), 0) };
  });
  const inp = `w-20 px-2 py-1 rounded-lg border text-sm ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        {cards.map(({ key, title, icon: Icon, tone, total, out, free, fix }) => (
          <div key={key} className={`${box} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 font-semibold text-sm"><span className={`p-2 rounded-lg ${tone}`}><Icon className="w-4 h-4" /></span>{title}</div>
              {key !== 'walkie' && currentUser?.role === 'Admin' && (
                <button title="Edit stock" onClick={() => { setEdit(edit === key ? null : key); setForm({ total, fix }); }} className="p-1 text-slate-400 hover:text-blue-500"><Pencil className="w-4 h-4" /></button>
              )}
            </div>
            <div className="grid grid-cols-3 text-center">
              {[['Total', total, ''], ['Allocated', out, 'text-blue-500'], ['Available', free, 'text-emerald-500']].map(([l, v, c]) => (
                <div key={l}><div className={`text-3xl font-bold ${c}`}>{v}</div><div className={`text-xs mt-1 ${sub}`}>{l}</div></div>
              ))}
            </div>
            <div className={`mt-4 pt-3 border-t flex items-center gap-2 text-xs ${dark ? 'border-slate-800' : 'border-slate-100'} ${fix ? 'text-amber-500' : sub}`}>
              <Wrench className="w-3.5 h-3.5" />{fix} under maintenance
            </div>
            {edit === key && (
              <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
                Total <input type="number" min="0" className={inp} value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} />
                Repair <input type="number" min="0" className={inp} value={form.fix} onChange={e => setForm({ ...form, fix: e.target.value })} />
                <button onClick={() => save(key)} className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold">Save</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className={`${box} p-5 flex flex-col h-96`}>
          <h2 className="font-semibold text-sm mb-3">Department allocations</h2>
          <div className={`grid grid-cols-4 text-xs pb-2 border-b ${sub} ${dark ? 'border-slate-800' : 'border-slate-100'}`}><span>Department</span><span className="text-center">Walkies</span><span className="text-center">Chargers</span><span className="text-center">Earphones</span></div>
          <div className="flex-1 overflow-y-auto">
            {rows.map(r => (
              <div key={r.id} className={`grid grid-cols-4 items-center py-2.5 text-sm border-b ${dark ? 'border-slate-800' : 'border-slate-100'}`}>
                <span className="truncate pr-2">{r.name}</span><b className="text-center">{r.w}</b><span className="text-center">{r.c}</span><span className="text-center">{r.e}</span>
              </div>
            ))}
            {!rows.length && <p className={`text-sm py-6 text-center ${sub}`}>No departments yet.</p>}
          </div>
        </section>

        <section className={`${box} p-5 flex flex-col h-96`}>
          <h2 className="font-semibold text-sm mb-3">Recent logs</h2>
          <ul className="flex-1 overflow-y-auto space-y-3">
            {history.slice(0, 20).map(h => (
              <li key={h.id} className="text-sm"><div className="font-medium">{h.action}</div><div className={`text-xs ${sub}`}>{h.details}</div><div className="text-xs text-slate-400">{h.timestamp}</div></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
