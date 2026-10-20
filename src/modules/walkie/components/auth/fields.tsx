'use client';

import React, { useRef, useState } from 'react';
import { I } from './icons';

/* ---------- field ---------- */
type FieldProps = {
  id: string;
  label: string;
  icon: React.ReactNode;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: string;
  good?: boolean;
  shake?: boolean;
  onShaken?: () => void;
  autoComplete?: string;
  eye?: boolean;
  upper?: boolean;
  i: number;
  bare?: boolean;
};

export const Field: React.FC<FieldProps> = ({
  id,
  label,
  icon,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  good,
  shake,
  onShaken,
  autoComplete,
  eye,
  upper,
  i,
  bare,
}) => {
  const [show, setShow] = useState(false);
  const [blink, setBlink] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className={[
        'ea-field',
        bare ? '' : 'ea-f',
        error ? 'bad' : '',
        good && !error ? 'good' : '',
        shake ? 'ea-shake' : '',
      ].join(' ')}
      style={{ '--i': i } as any}
      onAnimationEnd={e => {
        if (e.animationName === 'ea-shake') onShaken?.();
      }}
    >
      <div className="ea-box">
        <span className="ea-ico">{icon}</span>
        <input
          ref={ref}
          id={id}
          type={eye ? (show ? 'text' : 'password') : type}
          placeholder=" "
          autoComplete={autoComplete}
          value={value}
          className={upper ? 'upper' : undefined}
          aria-invalid={!!error}
          aria-describedby={`${id}-msg`}
          onChange={e => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
          onBlur={onBlur}
        />
        <label htmlFor={id}>{label}</label>
        {eye && (
          <span className="ea-trail">
            <button
              type="button"
              className={'ea-eye' + (blink ? ' blink' : '')}
              key={blink}
              aria-pressed={show}
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => {
                setShow(s => !s);
                setBlink(b => b + 1);
                ref.current?.focus({ preventScroll: true });
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <g className="lid">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </g>
                <path className="slash" d="M4 4l16 16" />
              </svg>
            </button>
          </span>
        )}
      </div>
      <div className="ea-msg" id={`${id}-msg`} role={error ? 'alert' : undefined}>
        {error}
      </div>
    </div>
  );
};

/* ---------- primary button with ripple ---------- */
export const Primary: React.FC<{ label: string; loading: boolean; i: number; style?: React.CSSProperties }> = ({
  label,
  loading,
  i,
  style,
}) => {
  const ripple = (e: React.PointerEvent<HTMLButtonElement>) => {
    const b = e.currentTarget,
      r = b.getBoundingClientRect(),
      d = Math.max(r.width, r.height),
      s = document.createElement('span');
    s.className = 'ea-ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 700);
  };
  return (
    <button
      className={'ea-btn ea-f' + (loading ? ' loading' : '')}
      type="submit"
      style={{ '--i': i, ...style } as any}
      onPointerDown={ripple}
      aria-busy={loading}
    >
      <span className="lbl">{label}</span>
      {I.arrow}
      <span className="spin" />
    </button>
  );
};
