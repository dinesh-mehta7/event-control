import React, { useMemo, useState } from 'react';
import { ExternalLink, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { DEPT_OPTIONS } from '../../accommodation/types';
import { Modal, btnGhost, btnPrimary, cx, inputCls } from '../../accommodation/ui';
import { useManpower } from '../ManpowerContext';
import type { SewadarInput } from '../ManpowerContext';
import { DEVICES } from '../types';
import type { ArrivalTimeOfDay, SewadarMemberType } from '../types';
import { D, emptySewadar } from './shared';

const readDelimitedRows = (source: string) => {
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' && source[i + 1] === '"' && quoted) {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);
  return rows;
};

const headerKey = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const headerMatches = (value: string, alias: string) =>
  value === headerKey(alias) || (alias.length >= 6 && value.startsWith(`${headerKey(alias)} `));

const headerAliases: Record<string, string[]> = {
  name: ['name', 'full name', 'sewadar name', 'member name', 'employee name'],
  phone: ['mobile', 'mobile number', 'phone', 'phone number', 'contact', 'contact number'],
  department: ['sub department', 'subdepartment', 'sub dept', 'department', 'dept'],
  memberType: ['member type', 'sewadar type', 'type', 'member category'],
  joiningDate: ['sewa joining date', 'joining date', 'sewa date', 'promised date', 'date promised'],
  serialNo: ['sr no', 'sr number', 'serial no', 'serial number'],
  batchNo: ['badge no', 'badge number', 'badge', 'b no', 'batch no', 'batch number', 'b number'],
  relation: ['rel', 'relation'],
  relationName: ['relation name', 'father name', 'husband name', 'guardian name'],
  villageCity: ['village city', 'village', 'city'],
  branch: ['branch'],
  occupation: ['occupation'],
  remarks: ['remarks', 'remark'],
  employeeCode: ['emp code', 'employee code', 'employee number'],
  employeeId: ['employee id', 'emp id', 'employee identifier'],
  address: ['address', 'address 1'],
  address2: ['address 2', 'address line 2'],
  expectedArrival: ['expected arrival', 'arrival date'],
  expectedArrivalPeriod: ['expected arrival time', 'arrival time', 'time of day'],
  skills: ['skills', 'skill set'],
  teamName: ['team', 'team name'],
  teamLead: ['team lead', 'team leader'],
  shift: ['shift'],
  deviceType: ['device', 'device type'],
  deviceRef: ['device id', 'device serial', 'device reference'],
};

const memberKind = (value: string, fallback: SewadarMemberType): SewadarMemberType => {
  const kind = value.toLowerCase();
  if (kind.includes('annual')) return 'annual';
  if (kind.includes('month') || kind.includes('regular')) return 'monthly';
  if (kind.includes('salary') || kind.includes('permanent') || kind.includes('hired')) return 'salary_based';
  return fallback;
};

const importDate = (value: string) => {
  const raw = value.trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  return '';
};

const parseSewadarImport = (text: string, defaultType: SewadarMemberType): SewadarInput[] => {
  const rows = readDelimitedRows(text);
  if (!rows.length) return [];
  const keys = Object.keys(headerAliases);
  const headerIndex = rows.findIndex(row => {
    const values = row.map(headerKey);
    const hasName = headerAliases.name.some(alias => values.some(value => headerMatches(value, alias)));
    const recognized = keys.filter(key =>
      headerAliases[key].some(alias => values.some(value => headerMatches(value, alias))),
    );
    return hasName && recognized.length >= 2;
  });
  const hasHeader = headerIndex >= 0;
  const headers = hasHeader ? rows[headerIndex].map(headerKey) : [];
  const dataRows = hasHeader ? rows.slice(headerIndex + 1) : rows;
  const indexFor = (key: string) =>
    headers.findIndex(value => headerAliases[key].some(alias => headerMatches(value, alias)));
  const cell = (values: string[], key: string, fallbackIndex: number) => {
    const index = hasHeader ? indexFor(key) : fallbackIndex;
    return index < 0 ? '' : (values[index] || '').trim();
  };
  return dataRows
    .map(values => {
      const departmentRaw = cell(values, 'department', 2).toLowerCase();
      const department = DEPT_OPTIONS.find(
        ([key, label]) => key.toLowerCase() === departmentRaw || label.toLowerCase() === departmentRaw,
      );
      const typeRaw = cell(values, 'memberType', 3);
      const type = memberKind(typeRaw, defaultType);
      const joiningDate = importDate(cell(values, 'joiningDate', 4));
      const expectedArrival = importDate(cell(values, 'expectedArrival', 4));
      const arrivalPeriodRaw = cell(values, 'expectedArrivalPeriod', -1).toLowerCase();
      const expectedArrivalPeriod: ArrivalTimeOfDay = ['morning', 'noon', 'evening', 'night'].includes(arrivalPeriodRaw)
        ? (arrivalPeriodRaw as ArrivalTimeOfDay)
        : '';
      const skills = cell(values, 'skills', -1)
        .split(/[;,]/)
        .map(skill => skill.trim())
        .filter(Boolean);
      const deviceCandidate = cell(values, 'deviceType', 19).toLowerCase();
      const deviceType =
        DEVICES.find(device => device.key === deviceCandidate || device.label.toLowerCase() === deviceCandidate)?.key ||
        'none';
      return {
        ...emptySewadar(),
        name: cell(values, 'name', 0),
        phone: cell(values, 'phone', 1),
        department: department?.[0] || '',
        memberType: type,
        joiningDate,
        expectedArrival,
        expectedArrivalPeriod,
        skills,
        batchNo: cell(values, 'batchNo', 5),
        teamName: cell(values, 'teamName', 6),
        teamLead: cell(values, 'teamLead', 7),
        teams: cell(values, 'teamName', 6) ? [cell(values, 'teamName', 6)] : [],
        villageCity: cell(values, 'villageCity', 8),
        branch: cell(values, 'branch', 9),
        occupation: cell(values, 'occupation', 10),
        remarks: cell(values, 'remarks', 11),
        serialNo: cell(values, 'serialNo', 12),
        relation: cell(values, 'relation', 13),
        relationName: cell(values, 'relationName', 14),
        employeeCode: cell(values, 'employeeCode', 15),
        employeeId: cell(values, 'employeeId', 16),
        address: cell(values, 'address', 17),
        address2: cell(values, 'address2', 18),
        deviceType,
        deviceRef: cell(values, 'deviceRef', 20),
      };
    })
    .filter(member => member.name);
};

const googleCsvUrl = (value: string) => {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !/^(docs|www)\.google\.com$/.test(url.hostname))
    throw new Error('Paste a Google Sheets link or a published CSV URL.');
  const match = url.pathname.match(/\/spreadsheets\/d\/(e\/)?([^/]+)/);
  if (!match) throw new Error('That link does not look like a Google Sheets spreadsheet link.');
  const isPublished = Boolean(match[1]) || /\/pub(html)?\/?$/.test(url.pathname);
  const id = match[2];
  const gid = url.searchParams.get('gid') || url.hash.match(/(?:^#|&)gid=(\d+)/)?.[1];
  if (isPublished) {
    url.pathname = `/spreadsheets/d/e/${id}/pub`;
    url.search = '';
    url.searchParams.set('output', 'csv');
    if (gid) url.searchParams.set('gid', gid);
    return url.toString();
  }
  url.pathname = `/spreadsheets/d/${id}/export`;
  url.search = '';
  url.searchParams.set('format', 'csv');
  if (gid) url.searchParams.set('gid', gid);
  return url.toString();
};

export const ImportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { addMany } = useManpower();
  const [text, setText] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [defaultType, setDefaultType] = useState<SewadarMemberType>('monthly');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseSewadarImport(text, defaultType), [text, defaultType]);
  const loadGoogleSheet = async () => {
    setSheetError('');
    let csvUrl = '';
    try {
      csvUrl = googleCsvUrl(sheetUrl);
    } catch (error: any) {
      setSheetError(error.message || 'Check the Google Sheets link.');
      return;
    }
    setSheetBusy(true);
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error(`Google Sheets returned ${response.status}.`);
      const csv = await response.text();
      if (!csv.trim() || /<html[\s>]/i.test(csv.slice(0, 500)))
        throw new Error('No CSV data returned. Check the link and sheet access.');
      setText(csv);
    } catch (error: any) {
      setSheetError(
        `${error.message || 'Could not read this sheet.'} Share it as viewer or publish the selected tab as CSV, then try again. If your browser blocks the request, download the tab as CSV and upload it below.`,
      );
    } finally {
      setSheetBusy(false);
    }
  };
  const go = async () => {
    setBusy(true);
    const r = await addMany(parsed);
    setBusy(false);
    if (r.added) onClose();
  };
  return (
    <Modal title="Import sewadars" dark={D} onClose={onClose} wide>
      <p className="mb-3 text-xs text-mute">
        Import the Sewadar register or employee list from CSV, Google Sheets, or pasted rows. Header names are matched
        automatically; existing phone numbers are skipped.
      </p>
      <section className="mb-3 rounded-lg border border-line bg-surface/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
          <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
          Google Sheets
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={sheetUrl}
            onChange={e => setSheetUrl(e.target.value)}
            placeholder="Paste a Google Sheets link"
            className={cx(inputCls(D), 'min-w-0 flex-1')}
          />
          <button
            type="button"
            onClick={loadGoogleSheet}
            disabled={!sheetUrl.trim() || sheetBusy}
            className={cx(btnGhost(D), 'shrink-0')}
          >
            {sheetBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {sheetBusy ? 'Loading…' : 'Load sheet'}
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          The spreadsheet must be available to viewers or published as CSV. Only the selected sheet tab is imported.
        </p>
        {sheetError && (
          <p role="alert" className="mt-2 text-xs text-rose-300">
            {sheetError}
          </p>
        )}
      </section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-mute">
          If the sheet has no member type
          <select
            value={defaultType}
            onChange={e => setDefaultType(e.target.value as SewadarMemberType)}
            className="h-8 rounded-md border border-line bg-field px-2 text-xs text-ink"
          >
            <option value="monthly">Regular</option>
            <option value="annual">Annual</option>
            <option value="salary_based">Permanent</option>
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-xs text-mute">
          Upload CSV
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={async e => {
              const file = e.currentTarget.files?.[0];
              if (file) setText(await file.text());
            }}
            className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-2 file:font-semibold file:text-ink"
          />
        </label>
      </div>
      <textarea
        rows={7}
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={
          'Paste CSV rows with a header row, for example:\nName,Member type,Mobile,Department\nAmit Sharma,Regular,9876543210,WiFi'
        }
        className={cx(inputCls(D), 'font-mono text-xs')}
      />
      {parsed.length > 0 && (
        <div className="mt-2 rounded-md bg-raised/60 px-2.5 py-2 text-[11.5px] text-mute">
          Preview:{' '}
          <span className="font-medium text-ink">
            {parsed
              .slice(0, 4)
              .map(row => `${row.name} · ${row.memberType.replace('_', ' ')}`)
              .join('  |  ')}
          </span>
          {parsed.length > 4 && `  |  +${parsed.length - 4} more`}
        </div>
      )}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-mute">{parsed.length} ready to import</span>
        <div className="flex gap-2">
          <button className={btnGhost(D)} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={!parsed.length || busy} onClick={go}>
            {busy ? 'Importing…' : `Import ${parsed.length}`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
