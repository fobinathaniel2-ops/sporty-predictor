import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { useApp } from '../lib/app';
import { colorFor, initials } from '../lib/format';

export const A = ({ to, children, className, ...p }) => <a href={`#${to}`} className={className} {...p}>{children}</a>;

/** Team crest / league emblem with a coloured-initials fallback (also used when Data saver is on). */
export function Crest({ team, size = 28 }) {
  const { prefs } = useApp();
  const [bad, setBad] = useState(false);
  const src = team?.crest || team?.emblem;
  if (src && !bad && !prefs.dataSaver) return <img className="crest" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBad(true)} style={{ width: size, height: size }} />;
  return <span className="crest" style={{ width: size, height: size, fontSize: size * 0.38, background: colorFor(team?.name || team?.code) }}>{initials(team?.name || team?.code)}</span>;
}

export const Skel = ({ w = '100%', h = 16, r, style }) => <div className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;

export function SkelList({ n = 4, h = 64 }) {
  return <div className="card flat">{Array.from({ length: n }, (_, i) => <div key={i} style={{ padding: 14, borderBottom: '1px solid var(--line)' }}><Skel h={h - 28} /></div>)}</div>;
}
export function SkelCards({ n = 3, h = 150 }) {
  return <div className="grid g3">{Array.from({ length: n }, (_, i) => <Skel key={i} h={h} r={18} />)}</div>;
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="card err">
      <Icon name="alert" size={28} className="amber" />
      <h3 style={{ margin: '10px 0 4px' }}>{title}</h3>
      <p className="muted sm" style={{ marginBottom: 14 }}>{error}</p>
      {onRetry && <button className="btn sm" onClick={onRetry}><Icon name="refresh" size={16} /> Try again</button>}
    </div>
  );
}

export function Empty({ icon = 'ball', title, children }) {
  return (
    <div className="card center" style={{ padding: '30px 18px' }}>
      <Icon name={icon} size={30} className="dim" />
      <h3 style={{ margin: '10px 0 4px' }}>{title}</h3>
      <p className="muted sm">{children}</p>
    </div>
  );
}

/** Standard loading / error / data wrapper for api hooks. */
export function Async({ q, skeleton, children }) {
  if (q.loading && !q.data) return skeleton || <SkelList />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  return children(q.data);
}

export const Section = ({ title, icon, to, more = 'See all', children, aside }) => (
  <>
    <div className="sec">
      <h2>{icon && <Icon name={icon} size={20} className="g" />}{title}</h2>
      {aside}{to && <A to={to} className="more">{more}<Icon name="right" size={16} /></A>}
    </div>
    {children}
  </>
);

export const Tag = ({ kind = '', children }) => <span className={`tag ${kind}`}>{children}</span>;

export function Seg({ value, onChange, options }) {
  return <div className="seg" role="tablist">{options.map(([v, label]) => <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}</div>;
}

export function Switch({ on, onChange, label }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function FormDots({ form }) {
  if (!form) return null;
  const arr = Array.isArray(form) ? form : String(form).split(/[,\s]*/).filter(Boolean);
  return <span className="formdots">{arr.map((c, i) => <span key={i} className={`fd ${c}`}>{c}</span>)}</span>;
}

/** Circular percentage ring (SVG, no library). */
export function Ring({ value, size = 64, stroke = 7, color = 'var(--g)', label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} style={{ transition: 'stroke-dasharray .8s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <b style={{ fontSize: size * 0.27 }}>{label ?? Math.round(v * 100) + '%'}</b>
    </span>
  );
}

export const Note = ({ info, children }) => <div className={`note ${info ? 'info' : ''}`}>{children}</div>;

/** Pop-up: bottom sheet on phones, centred card on larger screens. Closes with Esc, the backdrop or the button. */
export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="between modalhead"><h3>{title}</h3><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button></div>
        <div className="modalbody">{children}</div>
        {footer && <div className="modalfoot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
