import React, { useRef, useState } from 'react';
import { LockKeyhole, Package } from 'lucide-react';
import { ConfirmModal } from '../accommodation/ui';
import { ServiceInbox } from '../requests/ServiceInbox';
import { useInventory } from './InventoryContext';
import type { Item, MoveType } from './types';
import type { Stage } from './lib/stock';
import { ALL_TABS, GROUPS, groupOf } from './nav';
import type { Actions, Tab } from './nav';
import { D, SubTabs, cx, panel } from './ui/kit';
import { Swap } from '../../components/Swap';
import { SlideNav } from '../../components/SlideNav';

const tabIndex = (t: string) => ALL_TABS.indexOf(t as Tab);
import { Overview } from './views/Overview';
import { ItemsView } from './views/Items';
import { LocationsView } from './views/Locations';
import { HistoryView, IssuedView, MaintenanceView, ReturnsView } from './views/Movements';
import { EventRequirementsView } from './views/EventRequirements';
import { ItemForm } from './modals/ItemForm';
import { MoveModal } from './modals/MoveModal';
import { ItemDetail } from './modals/ItemDetail';
import { CategoryManager, ImportModal } from './modals/Catalogue';
import { DepartmentSelect } from '../../components/DepartmentSelect';

const readTab = (): Tab => {
  try {
    const t = localStorage.getItem('inv_tab') as Tab;
    return ALL_TABS.includes(t) ? t : 'dashboard';
  } catch {
    return 'dashboard';
  }
};

// The CRM shell owns the global navigation; inventory uses grouped local sections.
export const InventoryApp: React.FC = () => {
  const inv = useInventory();
  const { items, stats, canManage, loadError } = inv;
  const [tab, setTabRaw] = useState<Tab>(readTab);
  const [stage, setStage] = useState<Stage>('all');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<{ itemId: string; type: MoveType } | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const [cats, setCats] = useState(false);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const lastInGroup = useRef<Record<string, Tab>>({});

  const setTab = (t: Tab) => {
    lastInGroup.current[groupOf(t).id] = t;
    setTabRaw(t);
    try {
      localStorage.setItem('inv_tab', t);
    } catch {
      /* ignore */
    }
  };
  const group = groupOf(tab);
  const a: Actions = {
    go: (t, s) => {
      if (s) setStage(s);
      setTab(t);
    },
    openMove: (type, itemId) => setMoving({ itemId: itemId || items[0]?.id || '', type }),
    onEdit: setEditing,
    onDetail: setDetail,
    onDelete: setDeleting,
    onImport: () => setImporting(true),
    onCategories: () => setCats(true),
  };
  // Small counters on the group tabs so problems are visible from anywhere in the module.
  const badge: Record<string, number> = { stock: stats.needRestock, movements: stats.withDamaged };

  return (
    <div className="space-y-4">
      <header className={cx(panel, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-fg shadow-sm">
              <Package className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-ink">Inventory</h1>
              <p className="mt-0.5 truncate text-xs text-mute">Stock, movements and requests for the store.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Super Admin: each department keeps its own stock; pick one to view and add to, or see all. */}
            {inv.showDepartments && (
              <DepartmentSelect
                value={inv.departmentFilter}
                onChange={inv.setDepartmentFilter}
                allOption="All departments"
              />
            )}
            <span className="rounded-md border border-line bg-raised/50 px-2.5 py-1.5 text-xs text-mute">
              <b className="tabular-nums text-ink">{items.length}</b> catalogue items
            </span>
          </div>
        </div>
        <SlideNav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Inventory sections">
          {GROUPS.map(({ id, label, icon: Icon, tabs }) => {
            const on = group.id === id;
            return (
              <button
                type="button"
                key={id}
                aria-current={on ? 'page' : undefined}
                onClick={() => setTab(lastInGroup.current[id] || tabs[0].id)}
                className={cx(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors',
                  on ? 'text-brand' : 'text-mute hover:bg-raised hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {!!badge[id] && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold tabular-nums text-amber-300">
                    {badge[id]}
                  </span>
                )}
              </button>
            );
          })}
        </SlideNav>
      </header>

      {!canManage && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/60 p-3 text-xs text-mute">
          <LockKeyhole className="h-4 w-4 shrink-0 text-blue-300" />
          Read-only access · Inventory changes are restricted to authorized staff.
        </div>
      )}
      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-400">
          Could not load inventory: {loadError}
        </div>
      )}

      {group.tabs.length > 1 && (
        <SubTabs label={`${group.label} sections`} tabs={group.tabs} value={tab} onChange={setTab} />
      )}

      <Swap k={tab} indexOf={tabIndex}>
        {tab === 'dashboard' && <Overview a={a} />}
        {tab === 'items' && <ItemsView a={a} stage={stage} setStage={setStage} />}
        {tab === 'locations' && <LocationsView a={a} />}
        {tab === 'allocations' && <IssuedView a={a} />}
        {tab === 'returns' && <ReturnsView a={a} />}
        {tab === 'maintenance' && <MaintenanceView a={a} />}
        {tab === 'history' && <HistoryView />}
        {tab === 'requests' && <ServiceInbox kind="item" title="Inventory" />}
        {tab === 'event-requirements' && <EventRequirementsView />}
      </Swap>

      {detail && (
        <ItemDetail
          item={items.find(x => x.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onMove={(type, id) => a.openMove(type, id)}
          onEdit={i => setEditing(i)}
        />
      )}
      {editing && (
        <ItemForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(i, opening) => (editing === 'new' ? inv.addItem(i, opening) : inv.updateItem(editing.id, i))}
          onDelete={
            editing !== 'new'
              ? async () => {
                  const ok = await inv.deleteItem(editing.id);
                  if (ok) setDetail(null);
                  return ok;
                }
              : undefined
          }
        />
      )}
      {moving && <MoveModal start={moving} onClose={() => setMoving(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {cats && <CategoryManager onClose={() => setCats(false)} />}
      {deleting && (
        <ConfirmModal
          dark={D}
          title={`Delete ${deleting.name}?`}
          body="The item, its location holdings and its whole history will be removed."
          confirmLabel="Delete"
          onConfirm={() => {
            inv.deleteItem(deleting.id);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
};
