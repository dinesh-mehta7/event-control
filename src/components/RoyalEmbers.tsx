import React, { useEffect, useRef } from 'react';

// The sign-in page's drifting embers, toned down to sit behind the Royal theme.
// Fewer particles, paused when the tab is hidden, and off for people who prefer reduced motion.
export const RoyalEmbers: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = ref.current!,
      ctx = cv.getContext('2d')!;
    let W = 0,
      H = 0,
      DPR = 1,
      raf = 0,
      parts: any[] = [];
    const spawn = (anywhere: boolean) => ({
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + Math.random() * 30 * DPR,
      r: (Math.random() * 1.5 + 0.4) * DPR,
      up: (Math.random() * 0.3 + 0.08) * DPR,
      sway: Math.random() * Math.PI * 2,
      sw: Math.random() * 0.012 + 0.003,
      hue: 20 + Math.random() * 26,
      life: Math.random() * 0.5 + 0.35,
      tw: Math.random() * 0.04 + 0.008,
      t: Math.random() * 100,
    });
    const size = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = innerWidth * DPR;
      H = cv.height = innerHeight * DPR;
      parts = Array.from({ length: Math.round(Math.min(60, (innerWidth * innerHeight) / 24000)) }, () => spawn(true));
    };
    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        p.t += p.tw;
        p.sway += p.sw;
        p.x += Math.sin(p.sway) * 0.3 * DPR;
        p.y -= p.up;
        if (p.y < -20 * DPR || p.x < -40 * DPR || p.x > W + 40 * DPR) Object.assign(p, spawn(false));
        const fade = Math.min(1, Math.max(0, p.y / (H * 0.45)));
        const a = Math.min(1, (0.3 + Math.sin(p.t) * 0.2) * p.life * fade);
        if (a <= 0.01) continue;
        const rr = p.r * 4;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        g.addColorStop(0, `hsla(${p.hue},100%,72%,${a})`);
        g.addColorStop(0.35, `hsla(${p.hue},100%,55%,${a * 0.4})`);
        g.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const onVisible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    size();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="royal-embers" />;
};
