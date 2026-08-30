import React, { useState } from 'react';
import { APP_BUILD } from './version.js';

// A modern dropdown that switches between the Sales CRM and the HR portal.
// `current` is 'crm' or 'hr'. Shows the active app as a pill; picking the other
// navigates there.
export function AppSwitcher({ current }) {
  const [open, setOpen] = useState(false);
  const apps = [
    { id: 'crm', label: 'Sales CRM', desc: 'Leads, deals & pipeline', href: '/go/crm', color: '#2563EB',
      icon: 'M3 3v18h18 M7 14l3-3 3 3 5-6' },
    { id: 'hr', label: 'HRMS', desc: 'Recruitment & people', href: '/go/hr', color: '#FF6A00',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  ];
  const active = apps.find((a) => a.id === current) || apps[0];
  const go = (a) => { if (a.id === current) { setOpen(false); return; } window.location.href = a.href; };
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1 transition-colors">
        <span className="text-xs font-extrabold tracking-wide" style={{ color: active.id === 'hr' ? '#FF8A3D' : '#7CB0FF' }}>{active.id === 'hr' ? 'HRMS' : 'CRM'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-50">Switch app</div>
            <div className="p-1.5">
              {apps.map((a) => {
                const on = a.id === current;
                return (
                  <button key={a.id} onClick={() => go(a)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${on ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${a.color}14` }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{a.icon.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-[#050A1F]">{a.label}</span>
                        {on && <span className="text-[9px] font-bold rounded-full bg-slate-200 text-slate-500 px-1.5 py-0.5">CURRENT</span>}
                      </span>
                      <span className="block text-[11px] text-slate-400">{a.desc}</span>
                    </span>
                    {!on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300 shrink-0"><path d="M9 18l6-6-6-6" /></svg>}
                  </button>
                );
              })}
            </div>
            <div className="px-3 py-2 text-[10px] text-slate-300 border-t border-slate-50">Build {APP_BUILD}</div>
          </div>
        </>
      )}
    </div>
  );
}
