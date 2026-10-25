import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const SESSION_KEY = 'mindsync-player-session-v1';
const INTRO_KEY = 'mindsync-intro-seen-v2';
const AVATAR_KEY = 'mindsync-avatar-v1';
const SOUND_KEY = 'mindsync-sound-v1';
const MOTION_KEY = 'mindsync-motion-v1';
const AVATARS = ['🛰️', '🦊', '🐺', '🐼', '🦉', '🐙', '🦋', '🐸', '🐯', '🦄', '👾', '🤖', '🎭', '🧿', '🔥', '🌙'];
const MISSION_STAGES = [
  { name: 'Relay Dock', location: 'LOW ORBIT · COMMS ARRAY', icon: '◌', tint: 'violet', detail: 'A silent signal was intercepted above the cloud line.' },
  { name: 'Glass Ward', location: 'NIGHT CITY · EAST SECTOR', icon: '▥', tint: 'cyan', detail: 'Security shutters are falling. The team has one clean route.' },
  { name: 'Echo Archive', location: 'SUBLEVEL 04 · DATA VAULT', icon: '⌁', tint: 'blue', detail: 'The evidence is intact, but the access log has been altered.' },
  { name: 'Silent Grid', location: 'BLACKSITE · POWER CORE', icon: '⌗', tint: 'red', detail: 'The last shield is down. One wrong move exposes the crew.' },
  { name: 'Extraction Zero', location: 'DEEP RANGE · EVAC POINT', icon: '↗', tint: 'gold', detail: 'No backup is coming. Bring the operation home.' },
];
const playerIcon = (player) => player?.role === 'saboteur' ? '✦' : '◈';
const phaseLabel = {
  lobby: 'ASSEMBLY', proposal: 'TEAM PROPOSAL', voting: 'SECURE BALLOT',
  intel: 'INTEL SELECTION', action: 'MISSION IN PROGRESS', debrief: 'DEBRIEF', finished: 'FINAL VERDICT',
};
const formatClock = (seconds) => `${String(Math.floor((seconds ?? 0) / 60)).padStart(2, '0')}:${String((seconds ?? 0) % 60).padStart(2, '0')}`;
const readBool = (key, fallback) => { try { const value = localStorage.getItem(key); return value == null ? fallback : value === 'true'; } catch { return fallback; } };
const readAvatar = () => { try { const value = localStorage.getItem(AVATAR_KEY); return AVATARS.includes(value) ? value : AVATARS[0]; } catch { return AVATARS[0]; } };
let audioContext;
function playCue(kind, enabled) {
  if (!enabled || typeof window === 'undefined' || !window.AudioContext) return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const tones = kind === 'success' ? [440, 660, 880] : kind === 'alert' ? [180, 135] : kind === 'phase' ? [520, 780] : [370, 555];
    const start = audioContext.currentTime;
    tones.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = kind === 'alert' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start + index * .095);
      gain.gain.setValueAtTime(.0001, start + index * .095);
      gain.gain.exponentialRampToValueAtTime(.045, start + index * .095 + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, start + index * .095 + .22);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(start + index * .095); oscillator.stop(start + index * .095 + .23);
    });
  } catch { /* Audio stays optional if the browser blocks it. */ }
}

function readSavedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function App() {
  const socket = useMemo(() => io({
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4500,
    timeout: 12_000,
  }), []);
  const [session, setSession] = useState(readSavedSession);
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [avatar, setAvatar] = useState(readAvatar);
  const [team, setTeam] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [introOpen, setIntroOpen] = useState(() => { try { return !localStorage.getItem(INTRO_KEY); } catch { return true; } });
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(() => readBool(SOUND_KEY, true));
  const [reducedMotion, setReducedMotion] = useState(() => readBool(MOTION_KEY, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
  const previousPhase = useRef(null);
  const previousMission = useRef(null);

  useEffect(() => {
    if (!introOpen) return undefined;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(INTRO_KEY, 'true'); } catch { /* Storage is optional. */ }
      setIntroOpen(false);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [introOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
    return () => document.documentElement.classList.remove('reduce-motion');
  }, [reducedMotion]);

  useEffect(() => {
    const onConnect = () => {
      setOnline(true);
      const saved = readSavedSession();
      if (saved?.code && saved?.token) {
        socket.emit('room:resume', saved, (result) => {
          if (!result?.ok) {
            localStorage.removeItem(SESSION_KEY);
            setSession(null);
            setState(null);
            setError(result?.error || 'Could not restore the saved room. Join again with its code.');
          } else {
            setSession(saved);
            setNotice('Secure connection restored.');
            window.setTimeout(() => setNotice(''), 2600);
          }
        });
      }
    };
    const onDisconnect = () => setOnline(false);
    const onConnectError = () => setOnline(false);
    const onState = (next) => { setState(next); setError(''); };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:state', onState);
    socket.connect();
    const heartbeat = window.setInterval(() => { if (socket.connected) socket.emit('transport:heartbeat'); }, 60_000);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:state', onState);
      window.clearInterval(heartbeat);
      socket.disconnect();
    };
  // The socket subscription stays stable for the lifetime of this page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(() => {
    if (!state) return;
    const mission = state.mission?.number ?? null;
    if (previousPhase.current && (previousPhase.current !== state.phase || previousMission.current !== mission)) {
      const lastMission = state.missionLog?.at(-1);
      const cue = lastMission && previousMission.current !== mission
        ? lastMission.result === 'success' ? 'success' : 'alert'
        : state.phase === 'finished' ? state.winner === 'loyal' ? 'success' : 'alert' : 'phase';
      playCue(cue, soundOn);
    }
    previousPhase.current = state.phase;
    previousMission.current = mission;
  }, [state?.phase, state?.mission?.number, state?.winner, soundOn]);

  useEffect(() => {
    if (!state?.phaseDeadline) { setSecondsLeft(null); return undefined; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((state.phaseDeadline - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [state?.phaseDeadline]);

  useEffect(() => {
    if (state?.phase === 'proposal') setTeam([]);
  }, [state?.phase, state?.mission?.number, state?.leaderId]);

  const send = (event, payload = {}) => new Promise((resolve) => {
    if (!socket.connected) { resolve({ ok: false, error: 'Connection is still restoring. Try again in a moment.' }); return; }
    socket.emit(event, payload, resolve);
  });

  const saveSession = (result) => {
    const saved = { code: result.code, token: result.token, playerId: result.playerId };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
    setSession(saved);
    setCode(result.code);
    setError('');
  };

  const run = async (event, payload = {}, options = {}) => {
    setBusy(true);
    setError('');
    try {
      const result = await send(event, payload);
      if (!result?.ok) throw new Error(result?.error || 'The action was not accepted.');
      if (options.saveSession) saveSession(result);
      if (options.notice) {
        setNotice(options.notice);
        window.setTimeout(() => setNotice(''), 2600);
      }
      return result;
    } catch (cause) {
      setError(cause.message || 'Something went wrong. Please try again.');
      return null;
    } finally { setBusy(false); }
  };

  const createRoom = async (event) => {
    event.preventDefault();
    await run('room:create', { name, avatar }, { saveSession: true });
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    await run('room:join', { name, code: code.trim().toUpperCase(), avatar }, { saveSession: true });
  };

  const chooseAvatar = (nextAvatar) => {
    setAvatar(nextAvatar);
    try { localStorage.setItem(AVATAR_KEY, nextAvatar); } catch { /* Storage is optional. */ }
    if (state) run('player:profile', { avatar: nextAvatar });
  };

  const finishIntro = () => {
    try { localStorage.setItem(INTRO_KEY, 'true'); } catch { /* Storage is optional. */ }
    setIntroOpen(false);
  };

  const setSoundPreference = (value) => {
    setSoundOn(value);
    try { localStorage.setItem(SOUND_KEY, String(value)); } catch { /* Storage is optional. */ }
    if (value) playCue('phase', true);
  };

  const setMotionPreference = (value) => {
    setReducedMotion(value);
    try { localStorage.setItem(MOTION_KEY, String(value)); } catch { /* Storage is optional. */ }
  };

  const leaveDevice = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setState(null);
    setCode('');
    setError('');
    setNotice('');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      setNotice('Room code copied');
      window.setTimeout(() => setNotice(''), 2200);
    } catch { setNotice(`Share code ${state.code} with your team`); }
  };

  const content = !state ? <Landing
      name={name} setName={setName} code={code} setCode={setCode}
      online={online} busy={busy} error={error} setError={setError}
      onCreate={createRoom} onJoin={joinRoom} savedSession={session}
      onForget={leaveDevice} avatar={avatar} onAvatarChange={chooseAvatar}
      openTutorial={() => setTutorialOpen(true)} openSettings={() => setSettingsOpen(true)}
    /> : <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark">M</span><span>MINDSYNC<small>THE IMPOSTOR PROTOCOL</small></span></div>
      <div className="topbar-right">
        <span className={`connection-pill ${online ? 'is-online' : 'is-offline'}`}><i />{online ? 'LINK SECURE' : 'RECONNECTING'}</span>
        <div className="profile-control"><button className="avatar-trigger" onClick={() => setProfileOpen(!profileOpen)} aria-label="Change your avatar">{state.you?.avatar || avatar}<span>⌄</span></button>{profileOpen && <div className="profile-popover"><span className="eyebrow">CHOOSE YOUR AVATAR</span><AvatarPicker value={state.you?.avatar || avatar} onChange={(value) => { chooseAvatar(value); setProfileOpen(false); }} /></div>}</div>
        <button className="subtle-button help-button" aria-label="How to play tutorial" title="How to play?" onClick={() => setTutorialOpen(true)}>How to play?</button>
        <button className="subtle-button options-button" onClick={() => setSettingsOpen(true)}>Options</button>
        <button className="subtle-button leave-button" disabled={!online || busy} onClick={async () => { const result = await run('room:leave'); if (result) { leaveDevice(); setNotice(result.resetMatch ? 'You left the party. The active operation was reset for the remaining team.' : 'You left the party.'); } }}>Leave party</button>
      </div>
    </header>

    {!online && <div className="connection-banner"><span className="pulse-dot" />Connection interrupted. Reconnecting to your room…</div>}

    <div className="room-strip">
      <div><span className="eyebrow">ROOM ACCESS</span><strong className="room-code">{state.code}</strong></div>
      <button className="share-button" onClick={copyCode}><span>↗</span> Share code</button>
      <div className="room-strip-right"><span className="live-indicator" />{phaseLabel[state.phase] || state.phase}</div>
    </div>

    {notice && <div className="toast" role="status">{notice}</div>}
    {error && <div className="error-banner" role="alert">{error}</div>}

    {state.matchAbandoned && state.phase === 'lobby' && <div className="error-banner abandoned-banner" role="status">An operative left during the operation. The match was reset; the remaining party can ready up and start again.</div>}

    {state.phase === 'lobby'
      ? <Lobby state={state} busy={busy} send={run} />
      : <GameRoom state={state} busy={busy} send={run} team={team} setTeam={setTeam} secondsLeft={secondsLeft} />}

    <ChatDock state={state} send={send} />

    <footer className="site-footer"><span>FIELD PROTOCOL 01</span><span>3–8 OPERATIVES · PRIVATE ROOM</span></footer>
  </div>;

  return <>
    {content}
    {introOpen && <CinematicIntro onFinish={finishIntro} />}
    {tutorialOpen && <TutorialModal onClose={() => setTutorialOpen(false)} />}
    {settingsOpen && <SettingsModal soundOn={soundOn} setSoundOn={setSoundPreference} reducedMotion={reducedMotion} setReducedMotion={setMotionPreference} onReplayIntro={() => { setSettingsOpen(false); setIntroOpen(true); }} onClose={() => setSettingsOpen(false)} />}
  </>;
}

function AvatarPicker({ value, onChange }) {
  return <div className="avatar-picker" role="group" aria-label="Choose player avatar">{AVATARS.map((choice) => <button key={choice} type="button" className={`avatar-choice ${choice === value ? 'selected' : ''}`} onClick={() => onChange(choice)} aria-label={`Choose ${choice} avatar`} aria-pressed={choice === value}>{choice}</button>)}</div>;
}

function Leaderboard({ state }) {
  const rankings = [...(state?.players ?? [])].sort((a, b) => b.wins - a.wins || b.matchesPlayed - a.matchesPlayed || a.name.localeCompare(b.name)).slice(0, 5);
  return <section className="side-panel leaderboard-panel"><div className="side-panel-heading"><span className="eyebrow">ROOM LEADERBOARD</span><span>TOP SCORES</span></div><div className="leaderboard-list">{rankings.map((player, index) => <div className={`leaderboard-row ${player.id === state.you?.id ? 'is-you' : ''}`} key={player.id}><span className={`rank-badge rank-${index + 1}`}>{index === 0 && player.wins > 0 ? '✦' : String(index + 1).padStart(2, '0')}</span><span className="leaderboard-avatar">{player.avatar || player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}{player.id === state.you?.id && <small> YOU</small>}</strong><span className="leaderboard-score">{player.wins}<small> W</small></span></div>)}{!rankings.some((player) => player.wins > 0) && <p className="leaderboard-hint">Finish your first operation to set the high score.</p>}</div><small className="leaderboard-foot">ROOM RECORDS · WINS</small></section>;
}

function StageScene({ stage, number, scores }) {
  return <section className={`stage-scene stage-${stage.tint}`} aria-label={`Stage ${number}: ${stage.name}`}>
    <div className="stage-horizon" /><div className="stage-gridline" />
    <div className="stage-copy"><span className="eyebrow">STAGE {String(number).padStart(2, '0')} · {stage.location}</span><h2>{stage.name}<span>{stage.icon}</span></h2><p>{stage.detail}</p></div>
    <div className="stage-art" aria-hidden="true"><span className="stage-orbit orbit-one" /><span className="stage-orbit orbit-two" /><span className="stage-object">{stage.icon}</span><i className="stage-star star-one" /><i className="stage-star star-two" /><i className="stage-star star-three" /></div>
    <div className="stage-score" aria-label={`${scores.loyal} loyal points, ${scores.saboteur} saboteur points`}><span>{String(number).padStart(2, '0')}</span><div><i style={{ transform: `scaleX(${Math.max(.12, scores.loyal / 3)})` }} /><i style={{ transform: `scaleX(${Math.max(.12, scores.saboteur / 3)})` }} /></div><span>05</span></div>
  </section>;
}

function ChatDock({ state, send }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState('');
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [state?.chat?.length, open]);
  const submit = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    const result = await send('chat:send', { message });
    if (result?.ok) { setDraft(''); setChatError(''); }
    else setChatError(result?.error || 'Message could not be sent.');
  };
  const quick = async (emoji) => {
    const result = await send('chat:send', { message: emoji });
    if (!result?.ok) setChatError(result?.error || 'Message could not be sent.');
  };
  return <div className={`chat-dock ${open ? 'chat-open' : ''}`}>
    {open && <section className="chat-window" aria-label="Room chat"><header className="chat-heading"><div><span className="eyebrow">TEAM CHANNEL</span><strong>Room chat</strong></div><span className="chat-live"><i /> LIVE</span><button onClick={() => setOpen(false)} aria-label="Close room chat">×</button></header>
      <div className="chat-messages" aria-live="polite">{(state.chat || []).map((entry) => <div className={`chat-message ${entry.playerId === state.you?.id ? 'mine' : ''}`} key={entry.id}><span className="chat-avatar">{entry.avatar || entry.name?.slice(0, 1) || '◈'}</span><div className="chat-bubble"><div><strong>{entry.playerId === state.you?.id ? 'You' : entry.name}</strong><time>{new Date(entry.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{entry.message}</p></div></div>)}{!state.chat?.length && <div className="chat-empty"><span>⌁</span><strong>Signal is quiet.</strong><small>Send your team the first message.</small></div>}<div ref={endRef} /></div>
      <div className="chat-quick">{['👍', '😂', '👀', '🚨'].map((emoji) => <button key={emoji} onClick={() => quick(emoji)} aria-label={`Send ${emoji}`}>{emoji}</button>)}</div>
      <form className="chat-compose" onSubmit={submit}><input value={draft} maxLength={240} onChange={(event) => setDraft(event.target.value)} placeholder="Message your party…" aria-label="Write a room chat message" /><button disabled={!draft.trim()} aria-label="Send message">↗</button></form>{chatError && <div className="chat-error">{chatError}</div>}
      <div className="chat-privacy">Everyone in this room can read chat. Keep your role secret.</div>
    </section>}
    <button className="chat-launcher" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close room chat' : 'Open room chat'}><span>{open ? '×' : '✉'}</span><strong>{open ? 'Close' : 'Chat'}</strong>{state.chat?.length > 0 && !open && <i>{Math.min(9, state.chat.length)}</i>}</button>
  </div>;
}

function CinematicIntro({ onFinish }) {
  return <div className="cinematic-intro" role="dialog" aria-label="MindSync introduction"><div className="intro-noise" /><div className="intro-console"><span><i /> UPLINK ESTABLISHED</span><span>PROTOCOL 01.05</span></div><div className="intro-art-wrap"><OperatorArt /></div><div className="intro-copy"><span className="eyebrow">A SOCIAL DEDUCTION OPERATION</span><h1>Trust is a <em>weapon.</em></h1><p>Five stages. One hidden saboteur. Every vote leaves a trace.</p></div><div className="intro-bottom"><div className="intro-progress"><i /></div><span>BRIEFING LOADING · 05 SECONDS</span><button onClick={onFinish}>SKIP INTRO ↗</button></div></div>;
}

function OperatorArt() {
  return <svg className="operator-art" viewBox="0 0 900 510" role="img" aria-label="Three covert operatives above a neon city">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0.9" y2="1"><stop stopColor="#161536"/><stop offset=".56" stopColor="#10182d"/><stop offset="1" stopColor="#081018"/></linearGradient><linearGradient id="armor" x1="0" y1="0" x2="1" y2=".9"><stop stopColor="#77829d"/><stop offset=".4" stopColor="#283349"/><stop offset="1" stopColor="#101726"/></linearGradient><linearGradient id="visor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b7a3ff" stopOpacity=".92"/><stop offset=".55" stopColor="#61e8e5" stopOpacity=".65"/><stop offset="1" stopColor="#243853"/></linearGradient><radialGradient id="dawn"><stop stopColor="#b084ff" stopOpacity=".34"/><stop offset="1" stopColor="#b084ff" stopOpacity="0"/></radialGradient></defs>
    <rect width="900" height="510" rx="14" fill="url(#sky)"/><ellipse cx="475" cy="300" rx="390" ry="220" fill="url(#dawn)"/>
    <g fill="#c9d4ff" opacity=".65"><circle cx="112" cy="77" r="1.4"/><circle cx="213" cy="118" r="1"/><circle cx="354" cy="54" r="1.5"/><circle cx="622" cy="79" r="1.2"/><circle cx="742" cy="117" r="1.3"/><circle cx="806" cy="57" r="1"/><circle cx="670" cy="170" r=".9"/><circle cx="160" cy="182" r="1"/></g>
    <path d="M0 362h90v-82h54v48h35V245h71v117h44v-65h54v65h60v-125h65v125h53v-91h72v91h48V275h75v87h79v148H0z" fill="#111a2c" opacity=".85"/><path d="M0 402h900" stroke="#8068d9" strokeOpacity=".28"/><g fill="#69d8e1" opacity=".34">{Array.from({length:27},(_,i)=><rect key={i} x={22+i*34} y={390+(i%3)*19} width="2" height="9" rx="1" />)}</g>
    <g className="model model-left" transform="translate(185 165)"><path d="M45 178 8 319h176l-36-141q-28-24-55-24t-48 24" fill="url(#armor)" stroke="#8a9ab2" strokeOpacity=".33" strokeWidth="2"/><path d="m48 203-28 93 64-20 8-85zm75 0 28 93-65-20-8-85z" fill="#34445b"/><path d="M41 92q4-55 51-57t54 57v43q-11 37-53 42-41-4-53-42z" fill="#182337" stroke="#8fa3c3" strokeOpacity=".54" strokeWidth="3"/><path d="M47 97q6-39 44-40t46 39l-10 19H57z" fill="url(#visor)"/><path d="m53 92 59 15" stroke="#f0f3ff" strokeOpacity=".6" strokeWidth="3"/><path d="M34 220 5 287l35 16 30-70m62-13 36 66-35 17-34-68" fill="#26354a" stroke="#74849c" strokeOpacity=".42" strokeWidth="2"/><path d="M71 252h45l-6 20H77z" fill="#70dfe2" opacity=".8"/></g>
    <g className="model model-center" transform="translate(355 104)"><path d="m65 210-55 184h280l-55-184q-40-32-85-32t-85 32" fill="url(#armor)" stroke="#b5a6ff" strokeOpacity=".48" strokeWidth="3"/><path d="m79 235-39 118 84-26 8-105zm124 0 39 118-84-26-8-105z" fill="#364159"/><path d="M70 101q3-72 86-76t87 76v54q-17 47-87 56-68-9-86-56z" fill="#1b2639" stroke="#c6b7ff" strokeOpacity=".7" strokeWidth="4"/><path d="M80 106q9-55 76-58t76 58l-18 28H98z" fill="url(#visor)"/><path d="m91 96 118 28" stroke="#f5f2ff" strokeOpacity=".78" strokeWidth="4"/><path d="M64 252 15 345l43 25 62-90m104-28 50 93-44 24-62-89" fill="#27354b" stroke="#9ba9c2" strokeOpacity=".48" strokeWidth="3"/><path d="M129 284h56l-8 29h-40z" fill="#a58bff"/><circle cx="157" cy="333" r="12" fill="#58ded8" opacity=".82"/></g>
    <g className="model model-right" transform="translate(585 170)"><path d="m42 180-35 139h171l-34-139q-25-24-51-24t-51 24" fill="url(#armor)" stroke="#8a9ab2" strokeOpacity=".35" strokeWidth="2"/><path d="M42 95q3-54 49-57t54 57v42q-12 36-53 43-40-7-51-43z" fill="#1b2738" stroke="#84d8de" strokeOpacity=".48" strokeWidth="3"/><path d="M49 98q7-38 42-40t45 40l-9 18H58z" fill="url(#visor)"/><path d="m54 92 62 20" stroke="#effbff" strokeOpacity=".62" strokeWidth="3"/><path d="m38 221-31 66 35 15 33-72m59-9 31 66-35 15-33-68" fill="#26354a" stroke="#74849c" strokeOpacity=".45" strokeWidth="2"/><path d="M65 252h48l-6 21H72z" fill="#58ded8" opacity=".8"/></g>
    <path d="M48 418h804" stroke="#a58bff" strokeOpacity=".24"/><path d="M450 0v510" stroke="#58ded8" strokeOpacity=".04"/><rect x="14" y="14" width="872" height="482" rx="10" fill="none" stroke="#c3c6ee" strokeOpacity=".14"/>
  </svg>;
}

const TUTORIAL_STEPS = [
  { title: 'Assemble a party', text: 'Create a private room and share the six-character code. Three to eight people can join.', label: '01 · ASSEMBLY', accent: 'violet' },
  { title: 'Propose a mission team', text: 'A rotating leader selects the crew. The whole room votes privately to approve or reject it.', label: '02 · THE BALLOT', accent: 'cyan' },
  { title: 'Read the Intel Fragment', text: 'The leader chooses one public clue: a ballot echo or the number of sabotage actions.', label: '03 · INTELLIGENCE', accent: 'blue' },
  { title: 'Act in secret', text: 'Selected players choose their action privately. A saboteur can support or sabotage.', label: '04 · THE OPERATION', accent: 'red' },
  { title: 'Win three stages', text: 'The first side to three mission points wins. Five rejected teams also fail a mission.', label: '05 · EXTRACTION', accent: 'gold' },
];

function TutorialModal({ onClose }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setStep((current) => (current + 1) % TUTORIAL_STEPS.length), 3200);
    return () => window.clearInterval(timer);
  }, [playing]);
  const slide = TUTORIAL_STEPS[step];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title"><header className="modal-header"><div><span className="eyebrow">20-SECOND GAMEPLAY BRIEFING</span><h2 id="tutorial-title">How to play</h2></div><button className="modal-close" onClick={onClose} aria-label="Close tutorial">×</button></header><div className={`tutorial-stage tutorial-${slide.accent}`}><div className="tutorial-art"><OperatorArt /><div className="tutorial-overlay-chip">{slide.label}</div><div className="tutorial-ui-card card-a"><span className="tutorial-mini-avatar">🛰️</span><i /><b>{step === 0 ? 'ROOM READY' : step === 1 ? 'PROPOSAL SENT' : step === 2 ? 'SIGNAL FOUND' : step === 3 ? 'ACTION SEALED' : 'MISSION CLEAR'}</b></div><div className="tutorial-ui-card card-b"><span>{['03 / 08', '02 / 03', '⌁ ECHO', '◈ PRIVATE', '03 POINTS'][step]}</span><i /></div><span className="tutorial-target target-one" /><span className="tutorial-target target-two" /></div><div className="tutorial-caption"><span>{slide.label}</span><h3>{slide.title}</h3><p>{slide.text}</p></div></div><div className="tutorial-controls"><div className="tutorial-dots">{TUTORIAL_STEPS.map((item, index) => <button key={item.label} onClick={() => setStep(index)} className={index === step ? 'active' : ''} aria-label={`Show ${item.title}`} />)}</div><button className="tutorial-play" onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button><button className="tutorial-next" onClick={() => setStep((step + 1) % TUTORIAL_STEPS.length)}>Next scene ↗</button></div></section></div>;
}

function SettingsModal({ soundOn, setSoundOn, reducedMotion, setReducedMotion, onReplayIntro, onClose }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="modal-header"><div><span className="eyebrow">PERSONALIZE YOUR OPERATION</span><h2 id="settings-title">Options</h2></div><button className="modal-close" onClick={onClose} aria-label="Close options">×</button></header><button className="setting-row" onClick={() => setSoundOn(!soundOn)}><span><strong>Game sound effects</strong><small>Soft mission pings and outcome cues</small></span><i className={`toggle-switch ${soundOn ? 'on' : ''}`} /></button><button className="setting-row" onClick={() => setReducedMotion(!reducedMotion)}><span><strong>Reduce motion</strong><small>Turn off moving scenes and transitions</small></span><i className={`toggle-switch ${reducedMotion ? 'on' : ''}`} /></button><button className="secondary-button replay-intro" onClick={onReplayIntro}>Replay cinematic intro ↻</button><p className="settings-note">Sound starts after your first interaction. You can change these settings any time.</p></section></div>;
}

function ConnectionPip({ online }) {
  return <span className={`status-pip ${online ? 'online' : 'offline'}`} title={online ? 'Connected' : 'Disconnected'} />;
}

function Landing({ name, setName, code, setCode, online, busy, error, onCreate, onJoin, savedSession, onForget, avatar, onAvatarChange, openTutorial, openSettings }) {
  return <main className="landing-shell">
    <header className="landing-topbar">
      <div className="brand-lockup"><span className="brand-mark">M</span><span>MINDSYNC<small>THE IMPOSTOR PROTOCOL</small></span></div>
      <div className="landing-tools"><span className={`connection-pill ${online ? 'is-online' : 'is-offline'}`}><i />{online ? 'SYSTEM READY' : 'CONNECTING'}</span><button className="subtle-button help-button" onClick={openTutorial}>How to play?</button><button className="subtle-button options-button" onClick={openSettings}>Options</button></div>
    </header>

    <div className="landing-grid">
      <section className="hero-copy">
        <div className="eyebrow hero-kicker"><span className="live-indicator" /> SECURE CHANNEL ESTABLISHED</div>
        <h1>Trust is a<br /><em>weapon.</em></h1>
        <p className="hero-text">One team. Five missions. Someone in the room is working against you.</p>
        <div className="hero-rule"><span />OPERATIVE BRIEFING<span /></div>
        <div className="briefing-list">
          <div><b>01</b><span><strong>Assemble your team</strong><small>3–8 players · one private room</small></span></div>
          <div><b>02</b><span><strong>Read the evidence</strong><small>Votes, outcomes, and Intel Fragments</small></span></div>
          <div><b>03</b><span><strong>Find the saboteurs</strong><small>Three mission wins take the match</small></span></div>
        </div>
        <div className="role-distribution"><span className="role-symbol agent-symbol">◈</span> 3–5 players · 1 saboteur <span className="distribution-divider" /> <span className="role-symbol saboteur-symbol">✦</span> 6–8 players · 2 saboteurs</div>
      </section>

      <section className="access-card">
        <div className="card-overline"><span>OPERATION ACCESS</span><span className="card-index">01 / 04</span></div>
        <h2>Enter the network</h2>
        <p className="card-subtitle">Create a private room or join your team’s operation.</p>
        {savedSession && <div className="saved-session"><span><i /> SAVED OPERATIVE KEY</span><button onClick={onForget}>Clear</button></div>}
        <span className="field-label">CHOOSE YOUR AVATAR</span>
        <AvatarPicker value={avatar} onChange={onAvatarChange} />
        <label className="field-label" htmlFor="callsign">OPERATIVE NAME</label>
        <input id="callsign" className="text-field" value={name} onChange={(event) => setName(event.target.value)} maxLength={18} minLength={2} placeholder="Choose a callsign" autoComplete="nickname" />
        <button className="primary-button create-button" onClick={onCreate} disabled={busy || !online || name.trim().length < 2}><span className="button-glyph">＋</span>{busy ? 'Opening secure channel…' : 'Create a room'}<span className="button-arrow">↗</span></button>
        <div className="form-divider"><span />OR JOIN A TEAM<span /></div>
        <form onSubmit={onJoin}>
          <label className="field-label" htmlFor="room-code">ROOM CODE</label>
          <div className="join-row"><input id="room-code" className="text-field code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))} maxLength={6} placeholder="e.g. K7R4QM" autoCapitalize="characters" autoComplete="off" /><button type="submit" className="join-button" disabled={busy || !online || code.length !== 6 || name.trim().length < 2}>Join room <span>→</span></button></div>
        </form>
        {error && <div className="error-inline" role="alert">{error}</div>}
        <div className="privacy-note"><span>◇</span> No accounts. No installs. Private roles stay private.</div>
      </section>
    </div>

    <div className="landing-bottom"><span>PROTOCOL VERSION 1.0</span><span>BUILT FOR THE TEAM THAT TRUSTS EACH OTHER</span></div>
  </main>;
}

function Lobby({ state, busy, send }) {
  const readyCount = state.players.filter((player) => player.ready && player.connected).length;
  const isHost = state.you?.isHost;
  const allReady = state.players.length >= 3 && readyCount === state.players.length;
  return <main className="workspace-grid">
    <section className="main-panel lobby-panel">
      <div className="section-heading"><div><span className="eyebrow">PRE-FLIGHT CHECK</span><h1>Assemble your team</h1></div><span className="player-count">{state.players.length}<small> / 8</small></span></div>
      <p className="muted-copy">Share the room code, then wait for every operative to check in.</p>
      <div className="roster-list">
        {state.players.map((player, index) => <div className={`roster-row ${player.id === state.you?.id ? 'is-you' : ''}`} key={player.id}>
          <span className="roster-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="roster-avatar">{player.avatar || player.name.slice(0, 1).toUpperCase()}</span>
          <div className="roster-name"><strong>{player.name}{player.id === state.you?.id && <small> YOU</small>}</strong><span>{player.id === state.hostId ? 'MISSION HOST' : 'OPERATIVE'}</span></div>
          <div className="roster-status"><ConnectionPip online={player.connected} /><span>{player.connected ? player.ready ? 'READY' : 'CONNECTED' : 'OFFLINE'}</span></div>
        </div>)}
        {Array.from({ length: Math.max(0, Math.min(8, 3) - state.players.length) }).map((_, index) => <div className="roster-row vacant-row" key={`vacant-${index}`}><span className="roster-number">{String(state.players.length + index + 1).padStart(2, '0')}</span><span className="roster-avatar vacant-avatar">·</span><div className="roster-name"><strong>Awaiting operative</strong><span>ROOM OPEN</span></div><div className="roster-status muted-status">EMPTY SEAT</div></div>)}
      </div>
      <div className="lobby-actions">
        <button className={`primary-button ${state.you?.ready ? 'ready-button' : ''}`} disabled={busy || !state.you || !state.players.find((player) => player.id === state.you.id)?.connected} onClick={() => send('player:ready', { ready: !state.you?.ready })}>
          {state.you?.ready ? '✓  Marked ready' : 'I’m ready'}
        </button>
        {isHost ? <button className="secondary-button" disabled={busy || !allReady} onClick={() => send('game:start')}>{allReady ? 'Start operation  →' : `Waiting for team · ${readyCount}/${state.players.length}`}</button> : <span className="host-wait">Host will start when everyone is ready.</span>}
      </div>
      <p className="lobby-footnote">{state.players.length < 3 ? `${3 - state.players.length} more operative${3 - state.players.length === 1 ? '' : 's'} needed to start.` : 'Roles are randomized by the server when the host starts.'}</p>
    </section>
    <aside className="side-panel briefing-panel">
      <span className="eyebrow">MISSION PARAMETERS</span>
      <div className="briefing-stat"><span>OPERATIVES</span><strong>03—08</strong></div>
      <div className="briefing-stat"><span>MISSIONS</span><strong>05</strong></div>
      <div className="briefing-stat"><span>WIN CONDITION</span><strong>FIRST TO 03</strong></div>
      <div className="briefing-divider" />
      <div className="briefing-note"><span className="note-mark">✦</span><div><strong>One of you is compromised.</strong><p>Saboteurs are assigned in secret. Find them before three missions fail.</p></div></div>
      <div className="briefing-note"><span className="note-mark cyan">⌁</span><div><strong>Expect incomplete intel.</strong><p>Each mission reveals one fragment. Read the signal, then decide who to trust.</p></div></div>
      <Leaderboard state={state} />
    </aside>
  </main>;
}

function GameRoom({ state, busy, send, team, setTeam, secondsLeft }) {
  if (state.phase === 'finished') return <FinalReveal state={state} busy={busy} send={send} />;
  const leader = state.players.find((player) => player.id === state.leaderId);
  const isLeader = state.you?.id === state.leaderId;
  const isSelected = state.mission?.team?.includes(state.you?.id);
  const selectedCount = team.length;
  const stageNumber = state.phase === 'debrief' ? state.missionLog.at(-1)?.number ?? state.mission.number : state.mission.number;
  const stage = MISSION_STAGES[stageNumber - 1] || MISSION_STAGES[0];
  const togglePlayer = (playerId) => setTeam((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);

  return <main className="game-layout">
    <div className="game-main-column">
      <div className="mission-overview">
        <div><span className="eyebrow">MISSION {String(state.phase === 'debrief' ? state.missionLog.at(-1)?.number ?? state.mission.number : state.mission.number).padStart(2, '0')} / 05</span><h1>{state.phase === 'debrief' ? 'Signal received.' : state.phase === 'action' ? 'The operation is live.' : state.phase === 'voting' ? 'Approve the team.' : state.phase === 'intel' ? 'Choose your signal.' : 'Build the mission team.'}</h1></div>
        <div className="timer-box"><span>{state.phase === 'debrief' ? 'DEBRIEF' : 'PHASE CLOSES'}</span><strong>{secondsLeft == null ? '—' : formatClock(secondsLeft)}</strong></div>
      </div>

      <StageScene stage={stage} number={stageNumber} scores={state.scores} />

      <SecretRole role={state.you?.role} />

      {state.phase === 'proposal' && <section className="phase-card">
        <PhaseTitle step="01" title="Propose a team" detail={`${leader?.name || 'The leader'} is leading · select ${state.mission.teamSize} operatives`} />
        {isLeader ? <>
          <div className="team-picker">
            {state.players.map((player) => <button key={player.id} onClick={() => togglePlayer(player.id)} className={`picker-row ${team.includes(player.id) ? 'selected' : ''}`} aria-pressed={team.includes(player.id)}>
              <span className="picker-check">{team.includes(player.id) ? '✓' : ''}</span><span className="picker-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="picker-name">{player.name}{player.id === state.you?.id && <small> YOU</small>}</span><ConnectionPip online={player.connected} />
            </button>)}
          </div>
          <div className="phase-card-footer"><span className="muted-copy">{selectedCount} / {state.mission.teamSize} selected</span><button className="primary-button compact" disabled={busy || selectedCount !== state.mission.teamSize} onClick={() => send('proposal:submit', { team })}>Submit team <span>→</span></button></div>
        </> : <WaitingMessage title="Leader is assembling the team" text={`${leader?.name || 'Your mission leader'} is choosing ${state.mission.teamSize} operatives. You can discuss who should go.`} />}
      </section>}

      {state.phase === 'voting' && <section className="phase-card">
        <PhaseTitle step="02" title="Secure team vote" detail="Your vote stays hidden until the full room has voted." />
        <div className="proposed-team">{state.mission.team.map((id) => { const p = state.players.find((player) => player.id === id); return p && <span className="team-chip" key={id}><span>{p.name.slice(0, 1).toUpperCase()}</span>{p.name}</span>; })}</div>
        {!state.you?.hasVoted ? <div className="vote-actions"><button className="vote-button approve" disabled={busy} onClick={() => send('vote:submit', { approve: true })}><span>✓</span> Approve team</button><button className="vote-button reject" disabled={busy} onClick={() => send('vote:submit', { approve: false })}><span>×</span> Reject team</button></div> : <WaitingMessage title="Ballot sealed" text="Your vote is locked. The tally will appear when every operative has voted." />}
        <div className="vote-progress"><div><span>SECURE BALLOTS</span><strong>{state.votesSubmitted} of {state.players.length} submitted</strong></div><div className="progress-track"><span style={{ width: `${(state.votesSubmitted || 0) / state.players.length * 100}%` }} /></div><small>Individual votes are never shown.</small></div>
      </section>}

      {state.phase === 'intel' && <section className="phase-card">
        <PhaseTitle step="03" title="Select an Intel Fragment" detail="Choose one public signal to reveal after the mission." />
        {state.proposalLeaderId === state.you?.id
          ? <div className="intel-options">
            <button className="intel-choice ballot" disabled={busy} onClick={() => send('intel:choose', { channel: 'ballotEcho' })}><span className="intel-symbol">⌁</span><span><strong>BALLOT ECHO</strong><small>Reveal how many selected operatives rejected this team.</small></span><span className="choice-arrow">↗</span></button>
            <button className="intel-choice trace" disabled={busy} onClick={() => send('intel:choose', { channel: 'actionTrace' })}><span className="intel-symbol">◉</span><span><strong>ACTION TRACE</strong><small>Reveal the number of sabotage actions: 0, 1, or 2+.</small></span><span className="choice-arrow">↗</span></button>
          </div>
          : <WaitingMessage title="Leader is choosing the signal" text="The selected Intel Fragment will appear publicly when the mission resolves." />}
      </section>}

      {state.phase === 'action' && <section className="phase-card">
        <PhaseTitle step="04" title="Mission action" detail={isSelected ? 'Your action is private. Submit once; you cannot change it.' : 'Your team is acting in secret.'} />
        {isSelected && !state.you?.hasActed ? <div className="action-actions">
          <button className="action-button support-action" disabled={busy} onClick={() => send('action:submit', { action: 'support' })}><span>✓</span><strong>Support</strong><small>Help the mission succeed.</small></button>
          {state.you?.role === 'saboteur' && <button className="action-button sabotage-action" disabled={busy} onClick={() => send('action:submit', { action: 'sabotage' })}><span>⌁</span><strong>Sabotage</strong><small>Undermine the operation.</small></button>}
        </div> : <WaitingMessage title={state.you?.hasActed ? 'Action received' : isSelected ? 'Select your action' : 'Standing by'} text={state.you?.hasActed ? 'Your private action is locked. The outcome stays hidden until the team finishes.' : isSelected ? 'Your role only permits support. Choose support to submit your mission action.' : `${state.mission.submittedActions} of ${state.mission.teamSize} selected operatives have submitted.`} />}
        <div className="action-progress"><span className="live-indicator" />{state.mission.submittedActions} / {state.mission.teamSize} OPERATIVES RESPONDED</div>
      </section>}

      {state.phase === 'debrief' && <Debrief state={state} secondsLeft={secondsLeft} />}

      <ProposalTrail state={state} />
      <MissionTrack state={state} />
    </div>

    <aside className="game-side-column">
      <section className="side-panel roster-panel"><div className="side-panel-heading"><span className="eyebrow">OPERATIVE ROSTER</span><span>{state.players.length} ACTIVE</span></div>
        <div className="side-roster">{state.players.map((player) => <div className={`side-roster-row ${player.id === state.you?.id ? 'is-you' : ''}`} key={player.id}><span className={`side-roster-avatar ${state.phase === 'finished' ? player.role === 'saboteur' ? 'revealed-saboteur' : 'revealed-agent' : ''}`}>{state.phase === 'finished' ? playerIcon(player) : player.avatar || player.name.slice(0, 1).toUpperCase()}</span><div><strong>{player.name}{player.id === state.you?.id && <small> YOU</small>}</strong><span>{player.id === (state.phase === 'intel' ? state.proposalLeaderId : state.leaderId) ? 'MISSION LEADER' : state.phase === 'finished' ? player.role === 'saboteur' ? 'SABOTEUR' : 'LOYAL AGENT' : 'OPERATIVE'}</span></div><ConnectionPip online={player.connected} /></div>)}</div>
      </section>
      <section className="side-panel intel-panel"><span className="eyebrow">FIELD NOTES</span><div className="intel-empty-mark">⌁</div><strong>Read the room.</strong><p>Every ballot and operation leaves a trace. Compare evidence before you trust a teammate.</p><div className="field-note-footer"><span>INTEL FRAGMENTS</span><span>01 / MISSION</span></div></section>
      <section className="score-panel"><span className="eyebrow">MISSION SCORE</span><div className="score-row"><div className="score-team"><span className="score-dot loyal-dot"/><span>LOYAL AGENTS</span></div><strong>{state.scores.loyal}</strong></div><div className="score-row"><div className="score-team"><span className="score-dot saboteur-dot"/><span>SABOTEURS</span></div><strong>{state.scores.saboteur}</strong></div><div className="score-track"><span className="loyal-score-fill" style={{ width: `${state.scores.loyal / 3 * 50}%` }} /><span className="saboteur-score-fill" style={{ width: `${state.scores.saboteur / 3 * 50}%` }} /></div><small>First team to 3 wins</small></section>
      <Leaderboard state={state} />
    </aside>
  </main>;
}

function SecretRole({ role }) {
  return <div className={`secret-role ${role === 'saboteur' ? 'secret-saboteur' : 'secret-agent'}`}><span className="secret-icon">{role === 'saboteur' ? '✦' : '◈'}</span><div><span className="eyebrow">YOUR CLASSIFICATION · PRIVATE</span><strong>{role === 'saboteur' ? 'Saboteur' : 'Loyal Agent'}</strong></div><span className="secret-status">VISIBLE TO YOU ONLY</span></div>;
}

function PhaseTitle({ step, title, detail }) {
  return <div className="phase-title"><span className="phase-step">{step}</span><div><h2>{title}</h2><p>{detail}</p></div></div>;
}

function WaitingMessage({ title, text }) {
  return <div className="waiting-message"><span className="waiting-mark"><i /></span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function MissionTrack({ state }) {
  const complete = new Map(state.missionLog.map((mission) => [mission.number, mission]));
  return <section className="phase-card mission-track-card"><div className="track-heading"><div><span className="eyebrow">OPERATION HISTORY</span><h2>Mission stages</h2></div><span className="track-count">{state.missionLog.length} / 5 RESOLVED</span></div>
    <div className="mission-track">{Array.from({ length: 5 }, (_, index) => { const mission = complete.get(index + 1); const current = state.mission?.number === index + 1; const stage = MISSION_STAGES[index]; return <div className={`mission-node ${mission ? `resolved ${mission.result}` : current ? 'current' : ''}`} key={index}><span className="mission-node-number">{String(index + 1).padStart(2, '0')}</span><span className="mission-node-mark">{mission ? mission.result === 'success' ? '✓' : '×' : current ? '•' : '·'}</span><span className="mission-node-stage">{stage.name}</span><span className="mission-node-label">{mission ? mission.result === 'success' ? 'PASS' : 'FAIL' : current ? 'LIVE' : 'NEXT'}</span></div>; })}</div>
  </section>;
}

function ProposalTrail({ state }) {
  const missionNumber = state.phase === 'debrief' ? state.missionLog.at(-1)?.number : state.mission?.number ?? state.missionLog.at(-1)?.number;
  const entries = state.proposalLog.filter((proposal) => proposal.mission === missionNumber);
  if (!entries.length) return null;
  return <section className="phase-card proposal-trail"><div className="track-heading"><div><span className="eyebrow">PUBLIC BALLOT RECORD</span><h2>Proposal trail</h2></div><span className="track-count">{entries.length} / 5</span></div>
    {entries.map((proposal, index) => <div className="proposal-trail-row" key={`${proposal.mission}-${index}`}><span className="trail-index">{String(index + 1).padStart(2, '0')}</span><span className="trail-team">{proposal.team.length ? proposal.team.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(' · ') : 'No team proposed'}</span><span className={`trail-result ${proposal.passed ? 'passed' : 'rejected'}`}>{proposal.timedOut ? 'TIMEOUT' : proposal.passed ? 'PASSED' : 'REJECTED'}</span><span className="trail-vote">{proposal.yes} YES · {proposal.no} NO</span></div>)}
    {state.phase === 'proposal' && state.mission?.rejectionCount > 0 && <div className="rejection-counter">SECURITY ALERT · {state.mission.rejectionCount} / 5 PROPOSALS REJECTED</div>}
  </section>;
}

function Debrief({ state, secondsLeft }) {
  const mission = state.missionLog.at(-1);
  if (!mission) return null;
  return <section className={`phase-card debrief-card ${mission.result}`}>
    <div className="debrief-result"><span className="debrief-symbol">{mission.result === 'success' ? '✓' : '×'}</span><div><span className="eyebrow">MISSION {String(mission.number).padStart(2, '0')} · {mission.result === 'success' ? 'OPERATION SUCCESSFUL' : 'OPERATION COMPROMISED'}</span><h2>{mission.result === 'success' ? 'Mission complete.' : mission.reason === 'five-rejections' ? 'Security deadlock.' : 'Sabotage detected.'}</h2></div></div>
    <div className="fragment-card"><span className="fragment-icon">⌁</span><div><span className="eyebrow">INTEL FRAGMENT · {mission.fragment?.kind === 'actionTrace' ? 'ACTION TRACE' : mission.fragment?.kind === 'ballotEcho' ? 'BALLOT ECHO' : 'NO SIGNAL'}</span><strong>{mission.fragment?.text || 'The team could not agree on a mission crew.'}</strong></div><span className="fragment-stamp">VERIFIED</span></div>
    <div className="mission-debrief-meta"><span>TEAM <strong>{mission.team.length ? mission.team.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(' · ') : 'No team dispatched'}</strong></span><span>NEXT PHASE <strong>{secondsLeft ?? 0}s</strong></span></div>
  </section>;
}

function FinalReveal({ state, busy, send }) {
  const won = state.winner === 'loyal' ? state.you?.role === 'agent' : state.you?.role === 'saboteur';
  return <main className="final-layout">
    <section className="final-hero"><div className="verdict-orbit"><span>{state.winner === 'loyal' ? '◈' : '✦'}</span><i /><i /></div><span className="eyebrow">OPERATION {state.winner === 'loyal' ? 'SECURED' : 'COMPROMISED'}</span><h1>{state.winner === 'loyal' ? 'The agents prevailed.' : 'The saboteurs prevailed.'}</h1><p>{won ? 'Your team won the operation.' : 'The operation ended in the other team’s favor.'} Every role is now declassified.</p><div className="final-score"><span>LOYAL AGENTS <strong>{state.scores.loyal}</strong></span><i>—</i><span>SABOTEURS <strong>{state.scores.saboteur}</strong></span></div></section>
    <section className="final-board"><div className="final-board-heading"><div><span className="eyebrow">DECLASSIFIED ROSTER</span><h2>Who was on your side?</h2></div><span className="final-match">MATCH {String(state.matchNumber).padStart(2, '0')}</span></div>
      <div className="final-player-grid">{state.players.map((player) => <div className={`final-player ${player.role}`} key={player.id}><span className="final-player-icon">{playerIcon(player)}</span><div><strong>{player.name}{player.id === state.you?.id && <small> YOU</small>}</strong><span>{player.role === 'saboteur' ? 'SABOTEUR' : 'LOYAL AGENT'} · {player.wins}W / {Math.max(0, player.matchesPlayed - player.wins)}L</span></div><span className="final-record">{player.matchesPlayed}M</span></div>)}</div>
      <div className="final-history"><span className="eyebrow">MISSION RECORD</span>{state.missionLog.map((mission) => <div className="final-history-row" key={`${state.matchNumber}-${mission.number}`}><span>{MISSION_STAGES[mission.number - 1]?.name?.toUpperCase() || `MISSION ${String(mission.number).padStart(2, '0')}`}</span><strong className={mission.result}>{mission.result === 'success' ? 'SUCCESS' : 'FAILED'}</strong><span>{mission.sabotageCount == null ? 'PROPOSAL DEADLOCK' : `${mission.sabotageCount} SABOTAGE ${mission.sabotageCount === 1 ? 'ACTION' : 'ACTIONS'}`}</span></div>)}</div>
      {state.matchHistory?.length > 1 && <div className="archive-history"><span className="eyebrow">ROOM MATCH HISTORY</span>{state.matchHistory.slice(0, -1).slice(-5).reverse().map((match) => <div className="archive-row" key={match.matchNumber}><span>MATCH {String(match.matchNumber).padStart(2, '0')}</span><strong>{match.winner === 'loyal' ? 'AGENT VICTORY' : 'SABOTEUR VICTORY'}</strong><span>{match.scores.loyal} — {match.scores.saboteur}</span></div>)}</div>}
      <div className="rematch-box"><div><span className="eyebrow">RUN IT BACK</span><p>Ready to see if the team can trust each other again?</p><small>{state.players.filter((player) => player.rematchReady).length} / {state.players.length} ready</small></div><div className="rematch-actions"><button className={`secondary-button rematch-ready ${state.you?.rematchReady ? 'marked' : ''}`} disabled={busy} onClick={() => send('rematch:ready', { ready: !state.you?.rematchReady })}>{state.you?.rematchReady ? '✓ Ready' : 'I’m in'}</button>{state.you?.isHost && <button className="primary-button compact" disabled={busy || !state.rematchAllReady} onClick={() => send('game:rematch')}>Start rematch →</button>}</div></div>
    </section>
    <Leaderboard state={state} />
  </main>;
}

const rootNode = document.getElementById('root');
rootNode._mindsyncRoot ||= createRoot(rootNode);
rootNode._mindsyncRoot.render(<React.StrictMode><App /></React.StrictMode>);

