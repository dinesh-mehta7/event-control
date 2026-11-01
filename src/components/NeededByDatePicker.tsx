import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const localIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const NeededByDatePicker: React.FC<{
  value: string;
  minDate: string;
  onChange: (value: string) => void;
}> = ({ value, minDate, onChange }) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opensAbove, setOpensAbove] = useState(false);
  const [opensRight, setOpensRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>();
  const selectedDate = value ? new Date(`${value}T00:00:00`) : null;
  const min = new Date(`${minDate}T00:00:00`);
  const [month, setMonth] = useState(() => {
    const date = selectedDate || min;
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const firstAllowedMonth = new Date(min.getFullYear(), min.getMonth(), 1);
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);
  const close = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 170);
  }, [open, closing]);

  useEffect(() => {
    if (!value) return;
    const date = new Date(`${value}T00:00:00`);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <div ref={root} className="absolute inset-y-0 right-0 z-20">
      <button
        type="button"
        aria-label="Choose needed-by date from calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose date from calendar"
        onClick={event => {
          if (open) {
            close();
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const rightSpace = window.innerWidth - bounds.right;
          const rightPlacement = rightSpace >= 280;
          setOpensRight(rightPlacement);
          setOpensAbove(!rightPlacement && window.innerHeight - bounds.bottom < 370 && bounds.top > 370);
          setClosing(false);
          setOpen(true);
        }}
        className={`grid h-full w-10 place-items-center rounded-r-lg text-mute transition-colors hover:bg-raised hover:text-ink ${open ? 'text-blue-400' : ''}`}
      >
        <CalendarDays size={16} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose needed-by date"
          className={`needed-by-calendar-enter absolute z-50 w-72 rounded-xl border border-line bg-surface p-3 shadow-2xl shadow-black/40 ring-1 ring-white/5 ${closing ? 'needed-by-calendar-leave' : ''} ${opensRight ? 'bottom-0 left-[calc(100%-1rem)]' : opensAbove ? 'right-0 bottom-full mb-2' : 'right-0 top-full mt-2'}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              disabled={month <= firstAllowedMonth}
              onClick={() => setMonth(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
              className="grid h-8 w-8 place-items-center rounded-lg text-mute transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-semibold text-ink">
              {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
              className="grid h-8 w-8 place-items-center rounded-lg text-mute transition-colors hover:bg-raised hover:text-ink"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            {WEEK.map(day => (
              <span key={day} className="py-1.5">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {days.map((date, index) => {
              const iso = localIso(date);
              const disabled = iso < minDate;
              const selected = value === iso;
              const sameMonth = date.getMonth() === month.getMonth();
              const today = iso === minDate;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={disabled}
                  aria-current={today ? 'date' : undefined}
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(iso);
                    close();
                  }}
                  className={`mx-auto grid h-9 w-9 place-items-center rounded-lg text-xs tabular-nums transition-[background-color,color,box-shadow,transform] duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-20 ${
                    selected
                      ? 'bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20'
                      : sameMonth
                        ? `text-ink hover:bg-raised ${today ? 'ring-1 ring-blue-500/60' : ''}`
                        : 'text-faint/60 hover:bg-raised'
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setMonth(firstAllowedMonth);
                close();
              }}
              className="rounded-md px-2 py-1 text-xs text-mute transition-colors hover:bg-raised hover:text-ink"
            >
              Clear date
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(minDate);
                setMonth(firstAllowedMonth);
                close();
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/10 hover:text-blue-300"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
