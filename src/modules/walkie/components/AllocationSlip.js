import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

// Radio allocation slip: a printable document. On screen it shows as a sheet of paper inside a themed
// dialog; when printed, only the sheet is printed (see `.slip-*` rules in index.css).
const fmtDate = value => {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime())
    ? String(value || '')
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function AllocationSlip({ record, onClose }) {
  const { walkies, departments, currentOrganization, currentUser } = useApp();
  const orgName = currentOrganization?.name || 'Event Command';
  const logo = currentOrganization?.logoUrl || null;
  const initials = orgName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
  const dept = departments.find(d => d.id === record.departmentId);
  const issuedAt = new Date();
  const time = issuedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const rows = record.walkieIds.map(id => {
    const w = walkies.find(x => x.id === id);
    return {
      id,
      name: w?.label?.trim() || id,
      model: w?.model?.trim() || '—',
      holder: w?.assignedPerson?.name || '—',
      contact: w?.assignedPerson?.contact || '—',
    };
  });
  const holders = [...new Set(rows.map(r => r.holder).filter(h => h !== '—'))];

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('slip-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('slip-open');
    };
  }, [onClose]);

  return createPortal(
    <div
      className="slip-overlay fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Radio allocation slip"
        onClick={e => e.stopPropagation()}
        className="slip-dialog w-full max-w-2xl rounded-2xl border border-line bg-surface shadow-2xl animate-pop-in"
      >
        <div className="slip-chrome flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Allocation saved</p>
            <p className="text-xs text-mute">Print this slip and get it signed when the radios are handed over.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mute hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="slip-scroll max-h-[70vh] overflow-y-auto bg-raised/40 p-3 sm:p-5">
          <article className="slip-paper">
            <header className="slip-head">
              <div className="slip-brand">
                {logo ? (
                  <img src={logo} alt="" className="slip-logo" />
                ) : (
                  <span className="slip-logo slip-logo-fallback">{initials}</span>
                )}
                <div>
                  <div className="slip-org">{orgName}</div>
                  <div className="slip-sub">Communications · Radio Store</div>
                </div>
              </div>
              <div className="slip-title-box">
                <div className="slip-title">Radio Allocation Slip</div>
                <div className="slip-no">
                  No. <span>{record.id}</span>
                </div>
              </div>
            </header>

            <dl className="slip-meta">
              <div>
                <dt>Department</dt>
                <dd>{dept?.name || '—'}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{dept?.channelNumber || '—'}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{fmtDate(record.date)}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{time}</dd>
              </div>
              <div>
                <dt>Issued by</dt>
                <dd>{record.allocatedBy || currentUser?.name || '—'}</dd>
              </div>
              <div>
                <dt>Received by</dt>
                <dd>
                  {holders.length === 1
                    ? holders[0]
                    : holders.length > 1
                      ? `${holders.length} holders (see below)`
                      : '—'}
                </dd>
              </div>
            </dl>

            <table className="slip-table">
              <thead>
                <tr>
                  <th className="slip-num">#</th>
                  <th>Radio</th>
                  <th>Model</th>
                  <th>Held by</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="slip-num">{i + 1}</td>
                    <td className="slip-strong">{r.name}</td>
                    <td>{r.model}</td>
                    <td>{r.holder}</td>
                    <td className="slip-mono">{r.contact}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="slip-totals">
              <div>
                <span>Radios</span>
                <strong>{rows.length}</strong>
              </div>
              <div>
                <span>Chargers</span>
                <strong>{record.chargerCount || 0}</strong>
              </div>
              <div>
                <span>Earphones</span>
                <strong>{record.earphoneCount || 0}</strong>
              </div>
            </div>

            {record.remarks && (
              <div className="slip-remarks">
                <span>Remarks</span>
                <p>{record.remarks}</p>
              </div>
            )}

            <p className="slip-terms">
              The equipment above remains the property of {orgName}. The receiver is responsible for it until it is
              returned in working condition, with all accessories, to the Radio Store.
            </p>

            <div className="slip-signs">
              <div>
                <div className="slip-line" />
                <span>Issued by (name &amp; signature)</span>
              </div>
              <div>
                <div className="slip-line" />
                <span>Received by (name &amp; signature)</span>
              </div>
            </div>

            <footer className="slip-foot">
              <span>
                Generated {fmtDate(issuedAt)}, {time}
              </span>
              <span>Event Command · Walkie-Talkie Management</span>
            </footer>
          </article>
        </div>

        <div className="slip-chrome flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-sm font-medium border border-line-strong text-ink-soft hover:bg-raised hover:text-ink"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Printer className="h-4 w-4" />
            Print slip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
