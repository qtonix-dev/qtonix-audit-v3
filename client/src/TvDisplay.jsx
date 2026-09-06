import React, { useState, useEffect, useRef } from 'react';

// ============================================================================
// Company TV Display (Phase 1) — full-screen auto-rotating carousel.
// Reached at /tv/company and /tv/sales via a token in the URL query (?t=...).
// No login: gated by the token. Pulls live data every 20s, rotates slides.
// ============================================================================

const API = '/api/tv-display';

function initials(name) { return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'; }

// Photo-or-initials circle.
function Pfp({ name, photo, size = 80, border, fontSize, bg }) {
  const [failed, setFailed] = useState(false);
  const show = photo && !failed;
  return (
    <div style={{ width: size, height: size, borderRadius: 999, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', flexShrink: 0, background: bg || 'linear-gradient(135deg,#FF6A00,#FF4500)', border: border || 'none', fontSize: fontSize || size * 0.36 }}>
      {show ? <img src={photo} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(name)}
    </div>
  );
}

// F1 car SVG (matches Sales CRM), tinted + spinning wheels.
function Car({ color, w = 120 }) {
  return (
    <svg viewBox="0 0 120 50" width={w} style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.5))' }}>
      <rect x="2" y="12" width="10" height="26" rx="2" fill={color} />
      <path d="M12 22 L40 20 L74 14 L96 18 L112 24 L112 28 L96 32 L74 36 L40 30 L12 28 Z" fill={color} />
      <path d="M60 19 L84 16 L98 20 L98 22 L74 24 Z" fill="rgba(255,255,255,0.3)" />
      <ellipse cx="70" cy="22" rx="9" ry="6" fill="#0B1533" />
      <path d="M112 24 L120 25 L112 28 Z" fill={color} />
      <rect x="104" y="12" width="6" height="26" rx="2" fill={color} />
      {[36, 92].map((cx) => (
        <g key={cx}><circle cx={cx} cy="38" r="9" fill="#111" />
          <g style={{ transformOrigin: `${cx}px 38px`, animation: 'tvwheel .35s linear infinite' }}>
            <circle cx={cx} cy="38" r="3.5" fill="#555" />
            {[0, 60, 120].map((a) => <rect key={a} x={cx - 0.6} y="30" width="1.2" height="16" fill="#333" transform={`rotate(${a} ${cx} 38)`} />)}
          </g>
        </g>
      ))}
      <circle cx="36" cy="12" r="8" fill="#111" /><circle cx="92" cy="12" r="8" fill="#111" />
    </svg>
  );
}

const CAR_COLORS = ['#FF6A00', '#7C3AED', '#0891B2', '#16A34A', '#DB2777', '#CA8A04'];

// ---- Individual slide renderers --------------------------------------------
function SlideWelcome({ d }) {
  return (
    <div className="tvslide" style={{ background: 'radial-gradient(circle at 50% 35%,#12245e,#04060f 75%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: '2vw', fontWeight: 900, opacity: .8, marginBottom: '3vh' }}>🟠 Qtonix</div>
      <div className="tvbig">{d.welcome.greeting},<br />Team Qtonix! 👋</div>
      <div className="tvsub" style={{ marginTop: '2.5vh' }}>{d.welcome.message || "Let's make today count."}</div>
    </div>
  );
}
function SlideQuote({ d }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 30% 30%,#0f766e,#021512 78%)', justifyContent: 'center' }}>
      <div style={{ fontSize: '16vw', lineHeight: .5, opacity: .12, fontWeight: 900, marginBottom: '-2vh' }}>&ldquo;</div>
      <div style={{ fontSize: '5vw', fontWeight: 900, lineHeight: 1.25 }}>{d.quote}</div>
      <div className="tvsub" style={{ marginTop: '4vh', opacity: .7 }}>— Today&rsquo;s motivation for Team Qtonix</div>
    </div>
  );
}
function HeroPerson({ tag, person, title, sub, bg, confetti }) {
  return (
    <div className="tvslide tvpad" style={{ background: bg }}>
      <div className="tvtag">{tag}</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', position: 'relative' }}>
        {confetti && ['15%', '35%', '60%', '82%'].map((l, i) => <div key={l} className="tvconfetti" style={{ left: l, animationDelay: `${i * 0.5}s` }}>{['🎉', '🎈', '🎊', '🎉'][i]}</div>)}
        <div className="tvring" style={{ width: '26vh', height: '26vh' }} /><div className="tvring" style={{ width: '26vh', height: '26vh', animationDelay: '1.5s' }} />
        <div style={{ animation: 'tvpop 1s cubic-bezier(.2,1.5,.4,1)' }}><Pfp name={person.name} photo={person.photo} size={'24vh'} border="6px solid rgba(255,255,255,.9)" /></div>
        <div className="tvbig" style={{ marginTop: '3vh' }}>{title || person.name}</div>
        {sub && <div className="tvsub" style={{ marginTop: '1.5vh', opacity: .9 }}>{sub}</div>}
      </div>
    </div>
  );
}
function RowList({ tag, bg, rows }) {
  return (
    <div className="tvslide tvpad" style={{ background: bg }}>
      <div className="tvtag" style={{ marginBottom: '3vh' }}>{tag}</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.6vh' }}>
        {rows.map((r, i) => (
          <div key={i} className="tvrow" style={i === 0 ? { background: 'linear-gradient(90deg,rgba(255,215,0,.22),rgba(255,255,255,.05))', border: '2px solid rgba(255,215,0,.5)' } : {}}>
            <Pfp name={r.name} photo={r.photo} size={'7vh'} border="3px solid rgba(255,255,255,.3)" />
            <span style={{ fontSize: '2.6vw' }}>{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || '•'}</span>
            <span style={{ fontWeight: 800, flex: 1 }}>{r.name}</span>
            <span style={{ fontWeight: 900, opacity: .95 }}>{r.right}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function SlideCounter({ sales }) {
  const [v, setV] = useState(sales.counter.collected);
  useEffect(() => { setV(sales.counter.collected); }, [sales.counter.collected]);
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 35%,#065f46,#02110c 78%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div className="tvtag" style={{ marginBottom: '4vh' }}><span className="tvlive" /> Live · collected today</div>
      <div style={{ fontSize: '11vw', fontWeight: 900, lineHeight: .9, background: 'linear-gradient(180deg,#fff,#8effc0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: '0 0 60px rgba(34,255,136,.3)' }}>₹{v.toLocaleString('en-IN')}</div>
      <div className="tvsub" style={{ marginTop: '3vh', opacity: .7 }}>and counting…</div>
      <div style={{ display: 'flex', gap: '5vw', marginTop: '5vh' }}>
        <div style={{ textAlign: 'center' }}><div style={{ fontSize: '4.5vw', fontWeight: 900 }}>{sales.counter.deals}</div><div style={{ fontSize: '1.3vw', opacity: .7 }}>deals closed</div></div>
        <div style={{ textAlign: 'center' }}><div style={{ fontSize: '4.5vw', fontWeight: 900 }}>{sales.counter.clients}</div><div style={{ fontSize: '1.3vw', opacity: .7 }}>new clients</div></div>
      </div>
    </div>
  );
}
function SlideGoal({ sales }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 30%,#9a3412,#160702 75%)', justifyContent: 'center' }}>
      <div className="tvtag">🎯 Company goal · this month</div>
      <div style={{ fontSize: '10vw', fontWeight: 900, lineHeight: 1 }}>{sales.goal.pct}%</div>
      <div style={{ height: '4vh', borderRadius: 999, background: 'rgba(255,255,255,.15)', overflow: 'hidden', marginTop: '2vh' }}><div style={{ height: '100%', borderRadius: 999, width: `${sales.goal.pct}%`, background: 'linear-gradient(90deg,#fff,#ffd28a)', boxShadow: '0 0 20px rgba(255,210,138,.5)', transition: 'width 1.5s' }} /></div>
      <div className="tvsub" style={{ marginTop: '2.5vh' }}>₹{sales.goal.collected.toLocaleString('en-IN')} of ₹{sales.goal.target.toLocaleString('en-IN')} collected 💪</div>
    </div>
  );
}
function SlideRace({ sales }) {
  const racers = sales.racers.slice(0, 6);
  const [go, setGo] = useState(false);
  useEffect(() => { setGo(false); const t = setTimeout(() => setGo(true), 250); return () => clearTimeout(t); }, [sales]);
  const laneH = 100 / Math.max(1, racers.length);
  return (
    <div className="tvslide" style={{ background: '#05060f' }}>
      <div style={{ padding: '3.5vh 4vw 2vh', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
        <div><div style={{ fontSize: '3vw', fontWeight: 900, letterSpacing: '-.02em' }}>🏆 Sales Grand Prix</div><div style={{ fontSize: '1.1vw', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.15em', opacity: .9, marginTop: '.3vh' }}>Race to Target · this month</div></div>
        <div style={{ background: 'rgba(255,255,255,.2)', padding: '1vh 1.6vw', borderRadius: 12, fontSize: '1.1vw', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em' }}>● Live standings</div>
      </div>
      <div style={{ flex: 1, position: 'relative', background: 'linear-gradient(180deg,#3a1d6e,#241046)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '23%', top: 0, bottom: 0, width: 5, background: 'rgba(255,255,255,.5)' }} />
        <div style={{ position: 'absolute', right: '5%', top: 0, bottom: 0, width: 16, backgroundImage: 'repeating-conic-gradient(#fff 0% 25%,#111 0% 50%)', backgroundSize: '16px 16px' }} />
        {racers.map((r, i) => {
          const color = CAR_COLORS[i % CAR_COLORS.length];
          return (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${i * laneH}%`, height: `${laneH}%`, display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ position: 'absolute', left: go ? `calc(23% + ${(r.pct / 100) * 72}%)` : '23%', display: 'flex', alignItems: 'center', gap: '1vw', transition: 'left 3s cubic-bezier(.33,.02,.3,1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.8vw', background: '#fff', borderRadius: 18, padding: '.7vh .9vw .7vh .7vh', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  <Pfp name={r.name} photo={r.photo} size={'6vh'} border={`3px solid ${color}`} fontSize={'2vh'} bg={color} />
                  <div style={{ lineHeight: 1.1, paddingRight: '.4vw' }}>
                    <span style={{ fontSize: '.8vw', fontWeight: 900, color: '#fff', padding: '.15vh .5vw', borderRadius: 5, display: 'inline-block', marginBottom: '.3vh', background: ['#FF6A00', '#7C3AED', '#0891B2', '#64748B', '#64748B', '#64748B'][i] }}>{['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][i]}</span>
                    <div style={{ fontSize: '1.35vw', fontWeight: 900, color: '#0a0e28' }}>{r.name}</div>
                    <div style={{ fontSize: '1vw', fontWeight: 800, marginTop: '.2vh', color }}>₹{(r.collected / 1000).toFixed(1)}k · {r.pct}%</div>
                  </div>
                </div>
                <div style={{ width: '9vh' }}><Car color={color} w="100%" /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Phase 2 slides --------------------------------------------------------
function SlideFeatured({ f }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 30%,#4c1d95,#0a0416 78%)' }}>
      <div className="tvtag">✨ Featured teammate</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4vw' }}>
        <div style={{ position: 'relative' }}>
          <div className="tvring" style={{ width: '30vh', height: '30vh', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
          <div style={{ animation: 'tvpop 1s cubic-bezier(.2,1.5,.4,1)' }}><Pfp name={f.name} photo={f.photo} size={'28vh'} border="6px solid rgba(255,255,255,.9)" /></div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="tvbig" style={{ fontSize: '4.5vw' }}>{f.name}</div>
          <div className="tvsub" style={{ opacity: .8, marginTop: '.5vh' }}>{f.designation || ''}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginTop: '3vh' }}>
            <span style={{ fontSize: '2.4vw', fontWeight: 900, background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', padding: '.5vh 1.4vw', borderRadius: 14 }}>⚡ Level {f.level}</span>
            {f.club && <span style={{ fontSize: '2vw', fontWeight: 800, background: 'rgba(255,255,255,.1)', padding: '.5vh 1.2vw', borderRadius: 14 }}>{f.club.icon} {f.club.name}</span>}
          </div>
          {/* XP bar */}
          <div style={{ marginTop: '3vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.3vw', opacity: .7, marginBottom: '.8vh' }}><span>{f.lifetime.toLocaleString('en-IN')} XP</span><span>{f.xpToNext} to level {f.level + 1}</span></div>
            <div style={{ height: '2.5vh', borderRadius: 999, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${f.levelPct}%`, borderRadius: 999, background: 'linear-gradient(90deg,#a78bfa,#7c3aed)', boxShadow: '0 0 16px rgba(167,139,250,.5)', transition: 'width 1.5s' }} /></div>
          </div>
          {f.nextClub && <div className="tvsub" style={{ fontSize: '1.6vw', marginTop: '2.5vh', opacity: .85 }}>{f.nextClub.remaining.toLocaleString('en-IN')} pts to reach {f.nextClub.icon} {f.nextClub.name}!</div>}
        </div>
      </div>
    </div>
  );
}
function SlideBadge({ b }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 35%,#5b21b6,#0a0416 78%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div className="tvtag" style={{ marginBottom: '2vh' }}>✨ Badge unlocked!</div>
      <div style={{ position: 'relative', marginBottom: '2vh' }}>
        <div className="tvring" style={{ width: '24vh', height: '24vh', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
        <div style={{ animation: 'tvpop 1s cubic-bezier(.2,1.5,.4,1)' }}><Pfp name={b.name} photo={b.photo} size={'20vh'} border="6px solid rgba(255,255,255,.9)" /></div>
      </div>
      <div className="tvbig" style={{ fontSize: '4.5vw' }}>{b.name} earned</div>
      <div className="tvbig" style={{ fontSize: '5vw', marginTop: '.5vh' }}>&ldquo;{b.badge}&rdquo; 🏆</div>
      <div className="tvsub" style={{ marginTop: '2vh', opacity: .85 }}>+{b.points} points</div>
    </div>
  );
}
function SlideRising({ r }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 30%,#0369a1,#04121a 78%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div className="tvtag" style={{ marginBottom: '2vh' }}>📈 Rising star · most improved</div>
      <div style={{ animation: 'tvpop 1s cubic-bezier(.2,1.5,.4,1)', marginBottom: '2vh' }}><Pfp name={r.name} photo={r.photo} size={'22vh'} border="6px solid rgba(255,255,255,.9)" /></div>
      <div className="tvbig">{r.name} 🚀</div>
      <div className="tvsub" style={{ marginTop: '2vh', opacity: .9 }}>+{r.gain} points more than last month — huge jump!</div>
    </div>
  );
}
function SlideCountdown({ me, pace }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 30%,#7c2d12,#160702 75%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div className="tvtag" style={{ marginBottom: '2vh' }}>⏳ Month-end countdown</div>
      <div style={{ fontSize: '12vw', fontWeight: 900, lineHeight: .9 }}>{me.daysLeft}</div>
      <div className="tvsub" style={{ fontWeight: 900 }}>days left this month</div>
      {pace && pace.remaining > 0 && <div className="tvsub" style={{ marginTop: '3vh', opacity: .9, fontSize: '1.8vw' }}>₹{pace.remaining.toLocaleString('en-IN')} to hit the company target 💪</div>}
      {pace && <div className="tvsub" style={{ marginTop: '1vh', opacity: .7, fontSize: '1.6vw' }}>📈 On pace for {pace.projectedPct}% of target</div>}
    </div>
  );
}


function QR({ url, size = '14vh' }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=1&data=${encodeURIComponent(url)}`;
  return <img src={src} alt="scan" style={{ width: size, height: size, borderRadius: 12, background: '#fff', padding: '.8vh' }} />;
}
function SlidePoll({ poll, appUrl }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 30% 25%,#1e293b,#05070d 78%)' }}>
      <div className="tvtag">🤔 Poll of the day</div>
      <div style={{ flex: 1, display: 'flex', gap: '4vw', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '3vw', fontWeight: 900, lineHeight: 1.2, marginBottom: '3vh' }}>{poll.question}</div>
          {poll.options.map((o, i) => (
            <div key={i} style={{ marginBottom: '1.4vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.7vw', fontWeight: 700, marginBottom: '.5vh' }}><span>{o.label}</span><span>{o.pct}%</span></div>
              <div style={{ height: '2.2vh', borderRadius: 999, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${o.pct}%`, borderRadius: 999, background: i === 0 ? 'linear-gradient(90deg,#FF6A00,#FF4500)' : 'rgba(255,255,255,.35)', transition: 'width 1s' }} /></div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center' }}><QR url={appUrl} /><div style={{ fontSize: '1.2vw', opacity: .7, marginTop: '1vh' }}>📱 Scan to vote</div></div>
      </div>
    </div>
  );
}
function SlideCheers({ cheers, appUrl }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 20%,#831843,#0a0410 78%)' }}>
      <div className="tvtag">💬 Team cheers · live</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.8vh' }}>
        {cheers.slice(0, 4).map((c, i) => (
          <div key={i} className="tvrow"><span style={{ fontSize: '3.5vh' }}>{c.emoji}</span><span style={{ flex: 1 }}>{c.message}{c.to ? ` — for ${c.to}` : ''}</span><span style={{ fontSize: '1.4vw', opacity: .6 }}>— {c.from}</span></div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw', marginTop: '1vh' }}><QR url={appUrl} size="10vh" /><div style={{ fontSize: '1.5vw', opacity: .8 }}>📱 Scan to send a cheer to the screen!</div></div>
    </div>
  );
}
function SlideHelping({ h }) {
  return (
    <div className="tvslide tvpad" style={{ background: 'radial-gradient(circle at 50% 30%,#155e75,#04121a 78%)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div className="tvtag" style={{ marginBottom: '3vh' }}>🤝 Helping hand of the week</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', marginBottom: '3vh' }}>
        <Pfp name={h.helper.name} photo={h.helper.photo} size={'16vh'} border="4px solid rgba(255,255,255,.6)" />
        <span style={{ fontSize: '5vh' }}>➜</span>
        <Pfp name={h.helped.name} photo={h.helped.photo} size={'16vh'} border="4px solid rgba(255,255,255,.6)" />
      </div>
      <div className="tvbig" style={{ fontSize: '3.5vw' }}>{h.helper.name} helped {h.helped.name}</div>
      {h.reason && <div className="tvsub" style={{ marginTop: '1.5vh', opacity: .85 }}>&ldquo;{h.reason}&rdquo; · +{h.points} pts</div>}
    </div>
  );
}
function SlideStat({ icon, big, sub, bg }) {
  return (
    <div className="tvslide tvpad" style={{ background: bg, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: '14vh', marginBottom: '2vh' }}>{icon}</div>
      <div className="tvbig" style={{ fontSize: '4vw' }}>{big}</div>
      {sub && <div className="tvsub" style={{ marginTop: '2vh', opacity: .85 }}>{sub}</div>}
    </div>
  );
}

function buildSlides(d, kind) {
  const on = d.slides || {};
  const out = [];
  if (on.welcome !== false) out.push({ key: 'welcome', el: <SlideWelcome d={d} /> });
  if (on.quote !== false && d.quote) out.push({ key: 'quote', el: <SlideQuote d={d} /> });
  (d.celebrations?.birthdays || []).forEach((p, i) => { if (on.birthday !== false) out.push({ key: `bday${i}`, el: <HeroPerson tag="🎂 Birthday today" person={p} title={`Happy Birthday,\n${p.name}!`} sub="Wishing you an amazing year ahead 🎈" bg="radial-gradient(circle at 50% 30%,#9333ea,#1a0526 75%)" confetti /> }); });
  (d.celebrations?.anniversaries || []).forEach((p, i) => { if (on.anniversary !== false) out.push({ key: `anniv${i}`, el: <HeroPerson tag="🎉 Work anniversary" person={p} title={p.name} sub={`🎂 ${p.years} year${p.years > 1 ? 's' : ''} at Qtonix — thank you! 🙌`} bg="radial-gradient(circle at 50% 30%,#be185d,#1a0512 75%)" confetti /> }); });
  (d.celebrations?.newJoinees || []).forEach((p, i) => { if (on.newJoinee !== false) out.push({ key: `join${i}`, el: <HeroPerson tag="🎊 Welcome aboard" person={p} title={`Welcome,\n${p.name}!`} sub={[p.designation, p.department].filter(Boolean).join(' · ') || 'Say hi when you see them! 🤝'} bg="radial-gradient(circle at 50% 30%,#0284c7,#04121a 75%)" /> }); });
  if (on.recognition !== false && d.recognition) out.push({ key: 'rec', el: <HeroPerson tag="🌟 Recognition of the moment" person={d.recognition} title={d.recognition.name} sub={`${d.recognition.title} · +${d.recognition.points} pts${d.recognition.by ? ` · by ${d.recognition.by}` : ''}`} bg="radial-gradient(circle at 50% 30%,#b45309,#1a0f02 75%)" /> });
  if (on.performers !== false && (d.performers || []).length) out.push({ key: 'perf', el: <RowList tag="🏆 Top performers · this month" bg="radial-gradient(circle at 50% 20%,#1e3a8a,#040814 75%)" rows={d.performers.map((p) => ({ name: p.name, photo: p.photo, right: `${p.points} pts` }))} /> });
  // Phase 2 slides
  if (on.featured !== false && d.featured) out.push({ key: 'feat', el: <SlideFeatured f={d.featured} /> });
  if (on.rising !== false && d.rising) out.push({ key: 'rise', el: <SlideRising r={d.rising} /> });
  (d.badges || []).slice(0, 2).forEach((b, i) => { if (on.badges !== false) out.push({ key: `badge${i}`, el: <SlideBadge b={b} /> }); });
  if (on.clubs !== false && (d.clubs || []).length) out.push({ key: 'clubs', el: <RowList tag="💎 Closest to their next club" bg="radial-gradient(circle at 50% 20%,#312e81,#060613 75%)" rows={d.clubs.map((c) => ({ name: c.name, photo: c.photo, right: `${c.remaining.toLocaleString('en-IN')} to ${c.nextIcon} ${c.next}` }))} /> });
  if (on.earlyBirds !== false && (d.earlyBirds || []).length) out.push({ key: 'early', el: <RowList tag="🌅 Early birds today · beat the clock" bg="radial-gradient(circle at 30% 20%,#0e7490,#02141a 72%)" rows={d.earlyBirds.map((e) => ({ name: e.name, photo: e.photo, right: `⏰ ${e.time}` }))} /> });
  if (on.streaks !== false && (d.streaks || []).length) out.push({ key: 'streaks', el: <RowList tag="🔥 On fire · longest on-time streaks" bg="radial-gradient(circle at 70% 25%,#c2410c,#180702 72%)" rows={d.streaks.map((s) => ({ name: s.name, photo: s.photo, right: `${s.streak} days` }))} /> });
  // Phase 3 slides
  const appUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/go/hr';
  if (on.helping !== false && d.helping) out.push({ key: 'help', el: <SlideHelping h={d.helping} /> });
  if (on.poll !== false && d.poll) out.push({ key: 'poll', el: <SlidePoll poll={d.poll} appUrl={appUrl} /> });
  if (on.cheers !== false && (d.cheers || []).length) out.push({ key: 'cheers', el: <SlideCheers cheers={d.cheers} appUrl={appUrl} /> });
  if (on.deptLeaderboard !== false && (d.deptLeaderboard || []).length >= 2) out.push({ key: 'dept', el: <RowList tag="🏢 Department leaderboard · this month" bg="radial-gradient(circle at 50% 20%,#312e81,#060613 75%)" rows={d.deptLeaderboard} /> });
  if (on.innovation !== false && d.innovation && d.innovation.savings > 0) out.push({ key: 'innov', el: <SlideStat icon="💡" big={`₹${d.innovation.savings.toLocaleString('en-IN')} saved`} sub={`${d.innovation.count} team ideas turned into real impact 🚀`} bg="radial-gradient(circle at 50% 30%,#1e40af,#040a1a 78%)" /> });
  if (on.funStats !== false && (d.funStats || []).length) { const s = d.funStats[Math.floor(Date.now() / 60000) % d.funStats.length]; out.push({ key: 'fun', el: <SlideStat icon="✨" big="Did you know?" sub={s} bg="radial-gradient(circle at 30% 30%,#0f766e,#02120f 78%)" /> }); }
  if (on.memory !== false && d.memory) out.push({ key: 'mem', el: <SlideStat icon="📅" big="On this day" sub={d.memory} bg="radial-gradient(circle at 50% 30%,#4338ca,#05061a 78%)" /> });
  if (kind === 'sales' && d.sales) {
    if (on.race !== false && (d.sales.racers || []).length) out.push({ key: 'race', el: <SlideRace sales={d.sales} /> });
    if (on.counter !== false) out.push({ key: 'counter', el: <SlideCounter sales={d.sales} /> });
    if (on.goal !== false && d.sales.goal.target > 0) out.push({ key: 'goal', el: <SlideGoal sales={d.sales} /> });
    if (on.countdown !== false && d.monthEnd) out.push({ key: 'cd', el: <SlideCountdown me={d.monthEnd} pace={d.sales.pace} /> });
  }
  if (!out.length) out.push({ key: 'welcome', el: <SlideWelcome d={d} /> });
  return out;
}

export default function TvDisplay({ kind }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const token = (() => { try { return new URLSearchParams(window.location.search).get('t') || ''; } catch { return ''; } })();

  // Poll the feed every 20s.
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API}/feed/${token}/${kind}`).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) setErr(j.error); else { setData(j); setErr(''); } }).catch(() => {});
    load(); const iv = setInterval(load, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, [token, kind]);

  const slides = data ? buildSlides(data, kind) : [];
  // Rotate.
  useEffect(() => {
    if (!slides.length) return;
    const secs = (data && data.rotateSeconds) || 10;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), secs * 1000);
    return () => clearInterval(t);
  }, [slides.length, data && data.rotateSeconds]);
  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);

  if (err) return <Shell><div style={{ textAlign: 'center' }}><div style={{ fontSize: '3vw', fontWeight: 900 }}>📺 Qtonix Live</div><div style={{ marginTop: '2vh', opacity: .7 }}>{err}</div><div style={{ marginTop: '1vh', fontSize: '1.2vw', opacity: .5 }}>Check the display link.</div></div></Shell>;
  if (!data) return <Shell><div style={{ fontSize: '2vw', opacity: .6 }}>Loading Qtonix Live…</div></Shell>;

  const cur = slides[idx] || slides[0];
  return (
    <Shell>
      <style>{TV_CSS}</style>
      {data.festival && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, textAlign: 'center', padding: '1vh', fontWeight: 900, fontSize: '1.4vw', zIndex: 15, background: data.festival.color, letterSpacing: '.05em' }}>{data.festival.emoji} {data.festival.name} from all of us at Qtonix! {data.festival.emoji}</div>}
      <div key={cur.key} className="tvfade" style={{ position: 'absolute', inset: 0 }}>{cur.el}</div>
      {data.wellness && <div style={{ position: 'fixed', bottom: '6vh', left: 0, right: 0, textAlign: 'center', zIndex: 12 }}><span style={{ background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(8px)', padding: '1vh 2vw', borderRadius: 999, fontSize: '1.4vw', fontWeight: 700 }}>{data.wellness}</span></div>}
      <div style={{ position: 'fixed', bottom: '2vh', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '1vh', zIndex: 10 }}>
        {slides.map((s, k) => <div key={k} style={{ width: k === idx ? '3.5vh' : '1vh', height: '1vh', borderRadius: 999, background: k === idx ? '#FF6A00' : 'rgba(255,255,255,.3)', transition: '.3s', boxShadow: k === idx ? '0 0 12px #FF6A00' : 'none' }} />)}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return <div style={{ position: 'fixed', inset: 0, background: '#05060f', color: '#fff', fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif", overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>;
}

const TV_CSS = `
.tvslide{position:absolute;inset:0;display:flex;flex-direction:column;padding:0}
.tvpad{padding:4.5vh 5vw}
.tvfade{animation:tvsfade .8s ease}
@keyframes tvsfade{from{opacity:0}to{opacity:1}}
.tvtag{font-size:1.5vw;font-weight:800;text-transform:uppercase;letter-spacing:.14em;opacity:.7;display:flex;align-items:center;gap:.7vw}
.tvbig{font-size:5.5vw;font-weight:900;line-height:1.02;letter-spacing:-.02em;white-space:pre-line}
.tvsub{font-size:2.1vw;opacity:.9;font-weight:700}
.tvrow{display:flex;align-items:center;gap:1.6vw;background:rgba(255,255,255,.07);border-radius:20px;padding:2.2vh 2vw;font-size:2vw;backdrop-filter:blur(8px)}
.tvlive{display:inline-block;width:1vw;height:1vw;border-radius:99px;background:#22ff88;box-shadow:0 0 12px #22ff88;animation:tvpl 1.3s infinite}
@keyframes tvpl{0%{box-shadow:0 0 0 0 rgba(34,255,136,.6),0 0 12px #22ff88}70%{box-shadow:0 0 0 1.6vw rgba(34,255,136,0),0 0 12px #22ff88}100%{box-shadow:0 0 0 0 rgba(34,255,136,0),0 0 12px #22ff88}}
.tvring{position:absolute;border-radius:99px;border:2px solid rgba(255,255,255,.15);animation:tvpulse 3s ease-out infinite}
@keyframes tvpulse{0%{transform:scale(.8);opacity:.8}100%{transform:scale(1.6);opacity:0}}
.tvconfetti{position:absolute;font-size:6vh;animation:tvfall 4s linear infinite}
@keyframes tvfall{0%{transform:translateY(-10vh) rotate(0);opacity:0}10%{opacity:.6}100%{transform:translateY(110vh) rotate(360deg);opacity:0}}
@keyframes tvpop{from{transform:scale(0) rotate(-8deg)}to{transform:scale(1) rotate(0)}}
@keyframes tvwheel{to{transform:rotate(360deg)}}
`;
