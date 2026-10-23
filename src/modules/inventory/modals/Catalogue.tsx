import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Edit3, FileSpreadsheet, Plus, Trash2, Upload } from 'lucide-react';
import { ConfirmModal, Modal, inputCls, labelCls } from '../../accommodation/ui';
import { useInventory } from '../InventoryContext';
import type { Loc } from '../InventoryContext';
import { D, cx, ghost, iconBtn, primary } from '../ui/kit';
import { Select } from '../../../components/Select';
import { PillTabs } from '../../../components/PillTabs';

export const LocationForm: React.FC<{
  initial: Loc | null;
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
}> = ({ initial, onClose, onSave }) => {
  const [name, setName] = useState(initial?.name || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(name);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={initial ? 'Rename location' : 'Add location'} dark={D} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls(D)} htmlFor="lc-n">
            Location name
          </label>
          <input
            id="lc-n"
            autoFocus
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Gate 3 · Main Stage · Control Room A"
            className={inputCls(D)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ghost}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className={primary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const CategoryManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { categories, items, addCategory, renameCategory, deleteCategory } = useInventory();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const count = (c: string) => items.filter(i => i.category === c).length;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await addCategory(name)) setName('');
  };
  const save = async () => {
    if (edit !== null && (await renameCategory(edit, val))) setEdit(null);
  };
  return (
    <Modal title="Categories" dark={D} onClose={onClose} wide>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          aria-label="New category"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New category name"
          className={inputCls(D)}
        />
        <button type="submit" disabled={!name.trim()} className={primary}>
          <Plus className="h-4 w-4" />
          Add
        </button>
      </form>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {categories.map(c => (
          <li key={c} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            {edit === c ? (
              <>
                <input
                  aria-label={`Rename ${c}`}
                  autoFocus
                  value={val}
                  onChange={e => setVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') save();
                  }}
                  className={cx(inputCls(D), '!py-1.5')}
                />
                <div className="flex shrink-0 gap-1.5">
                  <button className={ghost} onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                  <button className={primary} onClick={save}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate font-medium">{c}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 rounded-full bg-raised px-2 py-0.5 text-xs tabular-nums text-mute">
                    {count(c)} items
                  </span>
                  <button
                    className={iconBtn}
                    onClick={() => {
                      setEdit(c);
                      setVal(c);
                    }}
                    aria-label={`Rename ${c}`}
                    title="Rename"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  {c.toLowerCase() !== 'general' && (
                    <button
                      className={cx(iconBtn, 'hover:text-rose-400')}
                      onClick={() => setDel(c)}
                      aria-label={`Delete ${c}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        Renaming updates every item in that category. Deleting a category moves its items to “General”.
      </p>
      {del && (
        <ConfirmModal
          dark={D}
          title={`Delete ${del}?`}
          body={`${count(del)} item(s) will move to General.`}
          confirmLabel="Delete"
          onConfirm={() => {
            deleteCategory(del);
          }}
          onClose={() => setDel(null)}
        />
      )}
    </Modal>
  );
};

// Excel / CSV import. Columns are matched by header name (any order), so the file from "Export Excel"
// can be edited and imported back. Without a recognisable header row, columns are read by position.
type Row = {
  name: string;
  code: string;
  category: string;
  unit: string;
  location: string;
  minLevel: number;
  opening: number;
};
type Field = keyof Row;
const FIELDS: { key: Field; label: string; aliases: string[] }[] = [
  { key: 'name', label: 'Item', aliases: ['item', 'item name', 'name', 'product', 'material', 'description'] },
  { key: 'code', label: 'Code', aliases: ['code', 'item code', 'sku', 'part no', 'part number', 'asset code'] },
  { key: 'category', label: 'Category', aliases: ['category', 'group', 'type'] },
  { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'units'] },
  { key: 'location', label: 'Stored at', aliases: ['stored at', 'location', 'store', 'shelf', 'warehouse', 'bin'] },
  {
    key: 'minLevel',
    label: 'Min level',
    aliases: ['min level', 'min', 'minimum', 'low stock level', 'low-stock level', 'reorder level'],
  },
  {
    key: 'opening',
    label: 'Opening qty',
    aliases: [
      'in store',
      'opening',
      'opening stock',
      'opening qty',
      'quantity',
      'qty',
      'stock',
      'on hand',
      'available',
    ],
  },
];
const POSITIONAL: Field[] = ['name', 'opening', 'unit', 'category', 'location', 'minLevel'];
const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
const int = (v: unknown) => Math.max(0, Math.floor(Number(String(v ?? '').replace(/,/g, '')) || 0));

const toRows = (grid: unknown[][]): { rows: Row[]; mapped: Field[] } => {
  const lines = grid.filter(r => r.some(c => String(c ?? '').trim()));
  if (!lines.length) return { rows: [], mapped: [] };
  const head = lines[0].map(norm);
  const col: Partial<Record<Field, number>> = {};
  FIELDS.forEach(f => {
    const i = head.findIndex(h => f.aliases.includes(h));
    if (i >= 0) col[f.key] = i;
  });
  const hasHeader = col.name !== undefined;
  if (!hasHeader)
    POSITIONAL.forEach((k, i) => {
      col[k] = i;
    });
  const cell = (r: unknown[], k: Field) => (col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim());
  const rows = (hasHeader ? lines.slice(1) : lines)
    .map(r => ({
      name: cell(r, 'name'),
      code: cell(r, 'code'),
      category: cell(r, 'category') || 'General',
      unit: cell(r, 'unit') || 'pcs',
      location: cell(r, 'location'),
      minLevel: int(cell(r, 'minLevel')),
      opening: int(cell(r, 'opening')),
    }))
    .filter(r => r.name);
  return { rows, mapped: FIELDS.map(f => f.key).filter(k => col[k] !== undefined) };
};

const downloadTemplate = () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Item', 'Code', 'Category', 'Unit', 'Stored at', 'Min level', 'Opening qty'],
    ['Cat6 Cable (305m)', 'NET-001', 'Cables & Fiber', 'drum', 'Warehouse A · Shelf 3', 5, 12],
    ['Walkie-Talkie Charger', 'RAD-020', 'Radios & Comms', 'pcs', 'Radio Store', 10, 40],
  ]);
  sheet['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 24 }, { wch: 10 }, { wch: 12 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Items');
  XLSX.writeFile(book, 'inventory_import_template.xlsx');
};

export const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { importItems, items } = useInventory();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; book: XLSX.WorkBook; sheet: string } | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    if (!/\.(xlsx|xls|xlsm|csv|ods)$/i.test(f.name)) {
      setErr('Choose an Excel (.xlsx, .xls) or CSV file.');
      return;
    }
    try {
      const book = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      if (!book.SheetNames.length) {
        setErr('That file has no sheets.');
        return;
      }
      setFile({ name: f.name, book, sheet: book.SheetNames[0] });
    } catch {
      setErr('Could not read that file. Save it as .xlsx and try again.');
    }
  };

  const { rows: all, mapped } = useMemo(() => {
    if (mode === 'paste') return toRows(text.split('\n').map(l => l.split(/\t|,/)));
    if (!file) return { rows: [] as Row[], mapped: [] as Field[] };
    return toRows(
      XLSX.utils.sheet_to_json<unknown[]>(file.book.Sheets[file.sheet], { header: 1, defval: '', raw: false }),
    );
  }, [mode, text, file]);
  const taken = useMemo(() => new Set(items.map(i => i.name.trim().toLowerCase())), [items]);
  // Skip names already in the catalogue and repeats inside the file.
  const { fresh, skip } = useMemo(() => {
    const seen = new Set<string>();
    const skip = new Set<number>();
    all.forEach((r, i) => {
      const k = r.name.toLowerCase();
      if (taken.has(k) || seen.has(k)) skip.add(i);
      seen.add(k);
    });
    return { fresh: all.filter((_, i) => !skip.has(i)), skip };
  }, [all, taken]);
  const go = async () => {
    setBusy(true);
    const r = await importItems(fresh);
    setBusy(false);
    if (r.added) onClose();
  };

  return (
    <Modal title="Import items" dark={D} onClose={onClose} xxl>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PillTabs
          variant="segmented"
          label="Import from"
          value={mode}
          onChange={id => setMode(id as typeof mode)}
          className="inline-flex flex-nowrap rounded-md border border-line bg-raised/40 p-0.5"
          itemClassName="px-3 py-1.5 text-xs"
          tabs={[
            { id: 'file', label: 'Excel / CSV file' },
            { id: 'paste', label: 'Paste rows' },
          ]}
        />
        <button type="button" className={ghost} onClick={downloadTemplate}>
          <Download className="h-3.5 w-3.5" />
          Download template
        </button>
      </div>

      {mode === 'file' ? (
        <>
          <div
            onDragOver={e => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => {
              e.preventDefault();
              setDrag(false);
              void read(e.dataTransfer.files[0]);
            }}
            className={cx(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
              drag ? 'border-blue-500 bg-blue-500/10' : 'border-line',
            )}
          >
            <FileSpreadsheet className="h-7 w-7 text-emerald-400" />
            {file ? (
              <p className="text-sm text-ink">
                <b>{file.name}</b>
              </p>
            ) : (
              <p className="text-sm text-ink">Drop an Excel file here, or</p>
            )}
            <button type="button" className={primary} onClick={() => input.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              {file ? 'Choose another file' : 'Choose file'}
            </button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.ods"
              className="hidden"
              onChange={e => {
                void read(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-faint">
              .xlsx, .xls or .csv · first row should be headings like Item, Code, Category, Unit, Stored at, Min level,
              Opening qty
            </p>
          </div>
          {file && file.book.SheetNames.length > 1 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-mute">
              Sheet
              <Select
                value={file.sheet}
                onChange={e => setFile({ ...file, sheet: e.target.value })}
                className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink"
              >
                {file.book.SheetNames.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </label>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-mute">
            Copy rows from Excel and paste them here. Include the heading row, or use the order{' '}
            <span className="font-mono">Name, Quantity, Unit, Category, Location, Low-stock level</span>.
          </p>
          <textarea
            rows={7}
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={
              'Cat6 Cable, 12, drum, Cables & Fiber, Warehouse A, 5\nWalkie Charger, 40, pcs, Radios & Comms'
            }
            className={cx(inputCls(D), 'font-mono text-xs')}
          />
        </>
      )}
      {err && <p className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</p>}

      {all.length > 0 && (
        <>
          <p className="mt-3 text-xs text-mute">
            Columns found:{' '}
            {FIELDS.map(f => (
              <span
                key={f.key}
                className={cx(
                  'mr-1.5 inline-block rounded px-1.5 py-0.5',
                  mapped.includes(f.key) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-raised text-faint line-through',
                )}
              >
                {f.label}
              </span>
            ))}
          </p>
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-raised">
                <tr className="text-left text-mute">
                  {['#', ...FIELDS.map(f => f.label)].map(h => (
                    <th key={h} className="whitespace-nowrap border border-line/70 px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.slice(0, 200).map((r, i) => (
                  <tr
                    key={i}
                    className={skip.has(i) ? 'text-faint line-through' : 'text-ink-soft'}
                    title={skip.has(i) ? 'Already exists — will be skipped' : undefined}
                  >
                    <td className="border border-line/70 px-2 py-1 text-right tabular-nums text-faint">{i + 1}</td>
                    <td className="border border-line/70 px-2 py-1 font-medium text-ink">{r.name}</td>
                    <td className="border border-line/70 px-2 py-1 font-mono">{r.code || '—'}</td>
                    <td className="border border-line/70 px-2 py-1">{r.category}</td>
                    <td className="border border-line/70 px-2 py-1">{r.unit}</td>
                    <td className="border border-line/70 px-2 py-1">{r.location || '—'}</td>
                    <td className="border border-line/70 px-2 py-1 text-right tabular-nums">{r.minLevel}</td>
                    <td className="border border-line/70 px-2 py-1 text-right tabular-nums">{r.opening}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {all.length > 200 && (
            <p className="mt-1 text-xs text-faint">
              Showing the first 200 of {all.length} rows. All rows will be imported.
            </p>
          )}
        </>
      )}
      {(file || text.trim()) && !all.length && !err && (
        <p className="mt-3 text-xs text-amber-300">No items found. Make sure there is an “Item” (or “Name”) column.</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-mute">
          {fresh.length} ready to import{skip.size ? ` · ${skip.size} already exist and will be skipped` : ''}
        </span>
        <div className="flex gap-2">
          <button className={ghost} onClick={onClose}>
            Cancel
          </button>
          <button className={primary} disabled={!fresh.length || busy} onClick={go}>
            {busy ? 'Importing…' : `Import ${fresh.length}`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
