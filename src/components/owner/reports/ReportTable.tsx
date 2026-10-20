import React from 'react';
import { th } from '../../ui';
import { reportValue } from './reportData';

export const ReportTable: React.FC<{ rows: any[]; columns: [string, string][]; empty: string }> = ({
  rows,
  columns,
  empty,
}) => (
  <div className="overflow-x-auto rounded-xl border border-line bg-surface">
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="bg-canvas">
          {columns.map(([key, label]) => (
            <th key={key} className={th}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row, index) => (
          <tr key={row.id || index}>
            {columns.map(([key]) => (
              <td key={key} className="max-w-sm truncate px-4 py-2 text-ink-soft">
                {reportValue(row[key])}
              </td>
            ))}
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={columns.length} className="p-8 text-center text-sm text-mute">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
