import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

type ClockTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  buttonClassName?: string;
};

const timeLabel = (hour: number, minute: number, period: 'AM' | 'PM') =>
  `${hour}:${String(minute).padStart(2, '0')} ${period}`;

/** Compact, themed analog clock picker. Values stay in HTML time format (HH:mm). */
export const ClockTimePicker: React.FC<ClockTimePickerProps> = ({
  value,
  onChange,
  label = 'Choose time',
  className = '',
  buttonClassName = '',
}) => {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const show = () => {
    if (value) {
      const [h, m] = value.split(':').map(Number);
      setHour(h % 12 || 12);
      setMinute(m || 0);
      setPeriod(h >= 12 ? 'PM' : 'AM');
    }
    setMode('hour');
    setOpen(v => !v);
  };
  const commit = (nextHour = hour, nextMinute = minute, nextPeriod = period) => {
    const hour24 = (nextHour % 12) + (nextPeriod === 'PM' ? 12 : 0);
    onChange(`${String(hour24).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);
  };
  const dialValues =
    mode === 'hour' ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 12 }, (_, i) => i * 5);
  const selected = mode === 'hour' ? hour : (Math.round(minute / 5) * 5) % 60;
  const choose = (n: number) => {
    if (mode === 'hour') {
      setHour(n);
      commit(n, minute);
      setMode('minute');
    } else {
      setMinute(n);
      commit(hour, n);
    }
  };
  const shownTime = value
    ? (() => {
        const [h, m] = value.split(':').map(Number);
        return timeLabel(h % 12 || 12, m, h >= 12 ? 'PM' : 'AM');
      })()
    : 'Select time';

  return (
    <div ref={root} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label={`${label}: ${shownTime}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-line bg-field px-3 text-left text-sm text-ink outline-none transition hover:border-blue-500/50 focus:border-blue-500 ${buttonClassName}`}
      >
        <span className={value ? '' : 'text-mute'}>{shownTime}</span>
        <Clock className="h-4 w-4 shrink-0 text-mute" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMode('hour')}
                className={`rounded-md px-2 py-1 text-base font-semibold ${mode === 'hour' ? 'bg-blue-500/15 text-blue-300' : 'text-ink'}`}
              >
                {String(hour).padStart(2, '0')}
              </button>
              <span className="text-mute">:</span>
              <button
                type="button"
                onClick={() => setMode('minute')}
                className={`rounded-md px-2 py-1 text-base font-semibold ${mode === 'minute' ? 'bg-blue-500/15 text-blue-300' : 'text-ink'}`}
              >
                {String(minute).padStart(2, '0')}
              </button>
            </div>
            <div className="flex rounded-lg border border-line p-0.5">
              <button
                type="button"
                onClick={() => {
                  setPeriod('AM');
                  commit(hour, minute, 'AM');
                }}
                className={`rounded px-2 py-1 text-[10.5px] font-semibold ${period === 'AM' ? 'bg-blue-600 text-white' : 'text-mute'}`}
              >
                AM
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriod('PM');
                  commit(hour, minute, 'PM');
                }}
                className={`rounded px-2 py-1 text-[10.5px] font-semibold ${period === 'PM' ? 'bg-blue-600 text-white' : 'text-mute'}`}
              >
                PM
              </button>
            </div>
          </div>
          <div
            className="relative mx-auto h-52 w-52 rounded-full border border-line bg-raised/50"
            aria-label={mode === 'hour' ? 'Select hour' : 'Select minutes'}
          >
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400" />
            {dialValues.map((number, index) => {
              const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
              const radius = 78;
              const isSelected = number === selected;
              return (
                <button
                  key={number}
                  type="button"
                  onClick={() => choose(number)}
                  aria-label={mode === 'hour' ? `${number} o'clock` : `${number} minutes`}
                  aria-pressed={isSelected}
                  className={`absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-semibold transition ${isSelected ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40' : 'text-ink hover:bg-blue-500/20 hover:text-blue-200'}`}
                  style={{
                    left: `${50 + (Math.cos(angle) * radius) / 2.08}%`,
                    top: `${50 + (Math.sin(angle) * radius) / 2.08}%`,
                  }}
                >
                  {mode === 'hour' ? String(number).padStart(2, '0') : String(number).padStart(2, '0')}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10.5px] text-mute">{mode === 'hour' ? 'Choose hour' : 'Choose minutes'}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
