import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, MathUtils, SRGBColorSpace } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const WALK_SPEED = 4.2;
const WALK_BOUNDS = { x: 10.5, z: 6.5 };
const MISSION_LABELS = ['RELAY DOCK', 'GLASS WARD', 'ECHO ARCHIVE', 'SILENT GRID', 'EXTRACTION ZERO'];
const MISSION_TERMINAL_POSITIONS = [[-7.1, -3.8], [-3.6, -5.2], [0, -5.7], [3.6, -5.2], [7.1, -3.8]];
const SUIT_COLORS = {
  violet: '#8d76ed', cyan: '#54c5d4', ember: '#ec795e',
  mint: '#68cda9', gold: '#dcae5a', rose: '#d778a5',
};
const HELMET_COLORS = { aegis: '#b3e7fa', pilot: '#f7c96e', halo: '#b8a4ff' };
const ECHO_SIGNALS = [
  { type: 'follow', label: 'Follow me', symbol: '➜' },
  { type: 'danger', label: 'Danger', symbol: '!' },
  { type: 'look', label: 'Look here', symbol: '⌖' },
  { type: 'wrong', label: 'Something is wrong', symbol: '⌁' },
  { type: 'stop', label: 'Stop', symbol: '⊘' },
  { type: 'help', label: 'I need help', symbol: '+' },
];

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

function showSceneNotice(timeoutRef, setNotice, message, duration = 2_000) {
  if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  setNotice(message);
  timeoutRef.current = window.setTimeout(() => {
    timeoutRef.current = null;
    setNotice('');
  }, duration);
}

function nameTexture(name, isSelf) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(8, 13, 25, 0.82)';
  context.beginPath();
  context.roundRect(16, 12, 480, 88, 30);
  context.fill();
  context.strokeStyle = isSelf ? '#58ded8' : 'rgba(174, 195, 234, .46)';
  context.lineWidth = 4;
  context.stroke();
  context.font = '700 39px system-ui, sans-serif';
  context.fillStyle = '#f3f6ff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(isSelf ? `${name}  ·  YOU` : name, 256, 58, 438);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function signalTexture(signal) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(8, 13, 25, .92)';
  context.beginPath();
  context.roundRect(8, 8, 368, 112, 32);
  context.fill();
  context.strokeStyle = signal.type === 'danger' || signal.type === 'wrong' ? '#ff8b79' : '#58ded8';
  context.lineWidth = 5;
  context.stroke();
  const details = ECHO_SIGNALS.find((item) => item.type === signal.type) ?? ECHO_SIGNALS[0];
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 50px system-ui, sans-serif';
  context.fillStyle = '#ffffff';
  context.fillText(details.symbol, 64, 64);
  context.font = '700 30px system-ui, sans-serif';
  context.fillText(details.label.toUpperCase(), 222, 64, 232);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Billboard({ texture, position, scale }) {
  return <sprite position={position} scale={scale}>
    <spriteMaterial map={texture} transparent depthWrite={false} />
  </sprite>;
}

function Astronaut({ player, targetRef, local, signal }) {
  const group = useRef(null);
  const label = useMemo(() => nameTexture(player.name, local), [player.name, local]);
  const signalMap = useMemo(() => signal ? signalTexture(signal) : null, [signal?.id]);
  const suit = SUIT_COLORS[player.appearance?.suit] ?? SUIT_COLORS.violet;
  const visor = HELMET_COLORS[player.appearance?.helmet] ?? HELMET_COLORS.aegis;
  const pack = player.appearance?.pack ?? 'standard';

  useEffect(() => () => label.dispose(), [label]);
  useEffect(() => () => signalMap?.dispose(), [signalMap]);

  useFrame((frame, delta) => {
    if (!group.current) return;
    const target = targetRef.current[player.id] ?? { x: 0, z: 0 };
    group.current.position.x = MathUtils.damp(group.current.position.x, target.x, local ? 18 : 9, delta);
    group.current.position.z = MathUtils.damp(group.current.position.z, target.z, local ? 18 : 9, delta);
    group.current.position.y = 0.02 + Math.sin(frame.clock.elapsedTime * 2.1 + player.id.length) * 0.035;
  });

  return <group ref={group}>
    <group>
      <mesh position={[0, 0.88, 0]} castShadow={false}>
        <cylinderGeometry args={[0.37, 0.43, 0.78, 9, 1]} />
        <meshStandardMaterial color={suit} roughness={0.43} metalness={0.18} flatShading />
      </mesh>
      <mesh position={[0, 1.51, -0.02]}>
        <sphereGeometry args={[0.35, 12, 9]} />
        <meshStandardMaterial color={visor} roughness={0.18} metalness={0.35} transparent opacity={0.88} flatShading />
      </mesh>
      <mesh position={[0, 1.49, 0.255]}>
        <sphereGeometry args={[0.245, 12, 8, 0, Math.PI * 2, 0.05, Math.PI * 0.57]} />
        <meshStandardMaterial color="#142238" emissive="#274766" emissiveIntensity={0.28} metalness={0.5} roughness={0.22} flatShading />
      </mesh>
      <mesh position={[0, 0.88, -0.48]}>
        <boxGeometry args={pack === 'wing' ? [0.72, 0.62, 0.24] : pack === 'twin' ? [0.78, 0.52, 0.25] : [0.53, 0.61, 0.25]} />
        <meshStandardMaterial color="#35445c" roughness={0.52} metalness={0.42} flatShading />
      </mesh>
      {pack === 'twin' && [-0.25, 0.25].map((x) => <mesh key={x} position={[x, 0.94, -0.64]}>
        <cylinderGeometry args={[0.105, 0.13, 0.5, 7]} />
        <meshStandardMaterial color="#7994ad" metalness={0.6} roughness={0.3} />
      </mesh>)}
      {pack === 'wing' && [-1, 1].map((side) => <mesh key={side} position={[side * 0.43, 0.88, -0.47]} rotation={[0, 0, side * -0.12]}>
        <boxGeometry args={[0.25, 0.68, 0.16]} />
        <meshStandardMaterial color={suit} roughness={0.5} metalness={0.25} />
      </mesh>)}
      {player.appearance?.helmet === 'halo' && <mesh position={[0, 1.82, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.29, 0.035, 6, 20]} />
        <meshStandardMaterial color="#c2b6ff" emissive="#8e7aff" emissiveIntensity={0.5} metalness={0.4} />
      </mesh>}
      {player.appearance?.helmet === 'pilot' && <mesh position={[0, 1.69, 0]}>
        <boxGeometry args={[0.7, 0.095, 0.56]} />
        <meshStandardMaterial color="#e4af55" metalness={0.56} roughness={0.32} />
      </mesh>}
      {[-1, 1].map((side) => <group key={side} position={[side * 0.41, 0.88, 0]} rotation={[0, 0, side * 0.1]}>
        <mesh position={[0, -0.04, 0]} rotation={[0, 0, side * -0.11]}>
          <cylinderGeometry args={[0.115, 0.13, 0.58, 7]} />
          <meshStandardMaterial color={suit} roughness={0.48} flatShading />
        </mesh>
        <mesh position={[0, -0.34, 0]}>
          <sphereGeometry args={[0.13, 8, 6]} />
          <meshStandardMaterial color="#c7d4e2" metalness={0.42} roughness={0.4} />
        </mesh>
      </group>)}
      {[-1, 1].map((side) => <group key={side} position={[side * 0.17, 0.43, 0]}>
        <mesh position={[0, -0.2, 0]}>
          <cylinderGeometry args={[0.14, 0.13, 0.47, 7]} />
          <meshStandardMaterial color={suit} roughness={0.52} flatShading />
        </mesh>
        <mesh position={[0, -0.45, 0.045]}>
          <boxGeometry args={[0.28, 0.13, 0.38]} />
          <meshStandardMaterial color="#28374c" roughness={0.6} metalness={0.18} />
        </mesh>
      </group>)}
    </group>
    <Billboard texture={label} position={[0, 2.13, 0]} scale={[2.15, 0.47, 1]} />
    {signalMap && <Billboard texture={signalMap} position={[0, 2.7, 0]} scale={[2.2, 0.72, 1]} />}
    {local && <pointLight position={[0, 0.25, 0]} color="#58ded8" intensity={0.38} distance={2.8} />}
  </group>;
}

function MissionTerminal({ position, index, current, accent }) {
  const ring = useRef(null);
  const label = useMemo(() => nameTexture(MISSION_LABELS[index], false), [index]);
  useEffect(() => () => label.dispose(), [label]);
  useFrame((frame) => {
    if (ring.current) ring.current.rotation.z = frame.clock.elapsedTime * (current ? 0.25 : 0.12);
  });
  return <group position={position}>
    <mesh position={[0, 0.6, 0]}>
      <boxGeometry args={[0.62, 1.2, 0.42]} />
      <meshStandardMaterial color="#14243a" metalness={0.72} roughness={0.3} />
    </mesh>
    <mesh position={[0, 1.05, 0.23]}>
      <boxGeometry args={[0.42, 0.26, 0.045]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={current ? 1.7 : 0.38} />
    </mesh>
    <mesh ref={ring} position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[current ? 0.88 : 0.66, 0.018, 6, 32]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={current ? 1.25 : 0.38} transparent opacity={0.8} />
    </mesh>
    <mesh position={[0, 1.62, 0]}>
      <sphereGeometry args={[0.12, 8, 6]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={current ? 1.5 : 0.45} />
    </mesh>
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.13, 12]} />
      <meshBasicMaterial color={accent} />
    </mesh>
    <mesh position={[0, 1.31, 0]}>
      <boxGeometry args={[0.44, 0.08, 0.36]} />
      <meshStandardMaterial color="#8597b5" metalness={0.55} roughness={0.38} />
    </mesh>
    <group position={[0, 0.76, 0.25]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.12, 0.06, 0.01]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
    <mesh position={[0, 0.22, 0.222]}>
      <boxGeometry args={[0.33, 0.12, 0.025]} />
      <meshStandardMaterial color={index === 0 ? '#394b62' : '#25364a'} metalness={0.4} />
    </mesh>
    <Billboard texture={label} position={[0, 1.91, 0]} scale={[1.65, 0.35, 1]} />
  </group>;
}

function SpaceStation({ players, selfId, positionsRef, intentRef, socket, signals, phase, stageNumber, interactive }) {
  const { camera, gl } = useThree();
  const controls = useRef(null);
  const lastFollow = useRef({ x: 0, z: 0 });
  const lastSent = useRef({ x: 0, z: 0, at: 0 });
  const sendSequence = useRef(0);

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enablePan = false;
    orbit.enableZoom = false;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 6.3;
    orbit.maxDistance = 13;
    orbit.minPolarAngle = 0.67;
    orbit.maxPolarAngle = 1.31;
    orbit.target.set(0, 0.85, 0);
    controls.current = orbit;
    return () => {
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, gl]);

  useFrame((frame, delta) => {
    const orbit = controls.current;
    const target = positionsRef.current[selfId] ?? { x: 0, z: 0 };
    if (orbit) {
      const dx = target.x - lastFollow.current.x;
      const dz = target.z - lastFollow.current.z;
      camera.position.x += dx;
      camera.position.z += dz;
      orbit.target.x += dx;
      orbit.target.z += dz;
      orbit.enabled = interactive;
      orbit.update();
      lastFollow.current = { x: target.x, z: target.z };
    }

    const input = interactive ? intentRef.current : { x: 0, z: 0 };
    if (input.x || input.z) {
      target.x = clamp(target.x + input.x * WALK_SPEED * delta, WALK_BOUNDS.x);
      target.z = clamp(target.z + input.z * WALK_SPEED * delta, WALK_BOUNDS.z);
      positionsRef.current[selfId] = target;
    }

    const clock = frame.clock.elapsedTime;
    const changed = input.x !== lastSent.current.x || input.z !== lastSent.current.z;
    if (changed || ((input.x || input.z) && performance.now() - lastSent.current.at > 100)) {
      const packet = { x: input.x, z: input.z };
      lastSent.current = { ...packet, at: performance.now() };
      const sequence = ++sendSequence.current;
      socket.timeout(2_500).emit('world:move', packet, (_error, result) => {
        if (result?.reason !== 'rate-limited') return;
        window.setTimeout(() => {
          if (sequence !== sendSequence.current) return;
          const current = intentRef.current;
          socket.emit('world:move', { x: current.x, z: current.z }, () => {});
        }, 95);
      });
    }

    const center = frame.scene.getObjectByName('deck-core');
    if (center) center.rotation.y = clock * 0.035;
  });

  const activeSignals = new Map();
  for (const signal of signals) activeSignals.set(signal.playerId, signal);
  const accent = stageNumber % 2 ? '#58ded8' : '#a58bff';
  return <>
    <color attach="background" args={['#07101b']} />
    <fog attach="fog" args={['#07101b', 17, 38]} />
    <ambientLight intensity={0.62} />
    <hemisphereLight args={['#a7c7ff', '#101320', 1.25]} />
    <pointLight position={[-7, 5, -2]} color="#7868ff" intensity={42} distance={18} />
    <pointLight position={[7, 4, 2]} color="#37c9d0" intensity={34} distance={16} />
    <pointLight position={[0, 5, -7]} color="#f0a66a" intensity={18} distance={12} />

    <mesh position={[0, -0.22, 0]}>
      <boxGeometry args={[25, 0.42, 26]} />
      <meshStandardMaterial color="#101a2a" metalness={0.68} roughness={0.5} />
    </mesh>
    <gridHelper args={[28, 28, '#38516f', '#1c2b40']} position={[0, 0.03, 0]} />
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[23.5, 24]} />
      <meshStandardMaterial color="#0d1725" metalness={0.44} roughness={0.62} transparent opacity={0.78} />
    </mesh>
    {[-1, 1].map((side) => <group key={side}>
      <mesh position={[side * 12.15, 1.55, 0]}>
        <boxGeometry args={[0.4, 3.5, 16.5]} />
        <meshStandardMaterial color="#111e30" metalness={0.58} roughness={0.45} />
      </mesh>
    {[-9.5, -3.2, 3.2, 9.5].map((z) => <mesh key={z} position={[side * 11.88, 1.3, z]}>
        <boxGeometry args={[0.16, 1.75, 0.42]} />
        <meshStandardMaterial color="#477087" emissive="#235267" emissiveIntensity={0.62} metalness={0.7} />
      </mesh>)}
    </group>)}
    {[-12.3, 12.3].map((z) => <mesh key={z} position={[0, 1.6, z]}>
      <boxGeometry args={[24.4, 3.35, 0.35]} />
      <meshStandardMaterial color="#121e30" metalness={0.58} roughness={0.46} />
    </mesh>)}

    <group name="deck-core" position={[0, 0.1, 0]}>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[1.22, 1.48, 0.68, 12]} />
        <meshStandardMaterial color="#17243a" metalness={0.74} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.42, 0.036, 8, 48]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.3} />
      </mesh>
      <mesh position={[0, 0.79, 0]}>
        <cylinderGeometry args={[0.32, 0.44, 0.18, 10]} />
        <meshStandardMaterial color="#c0d9ec" emissive="#55d6dc" emissiveIntensity={0.45} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.96, 0]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} />
      </mesh>
    </group>

    {MISSION_TERMINAL_POSITIONS.map(([x, z], index) => <MissionTerminal
      key={index}
      index={index}
      position={[x, 0, z]}
      current={index + 1 === stageNumber}
      accent={index + 1 === stageNumber ? accent : '#5c7392'}
    />)}
    {players.map((player, index) => <Astronaut
      key={player.id}
      player={player}
      local={player.id === selfId}
      targetRef={positionsRef}
      signal={activeSignals.get(player.id)}
      index={index}
    />)}
  </>;
}

class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="spatial-fallback" role="status">3D view is unavailable on this device. Your room and game controls are still ready below.</div>;
    return this.props.children;
  }
}

function TouchPad({ onDirection }) {
  const controls = [
    ['up', 'Move forward', '↑'], ['left', 'Move left', '←'],
    ['right', 'Move right', '→'], ['down', 'Move backward', '↓'],
  ];
  return <div className="world-joystick" role="group" aria-label="Touch movement controls">
    {controls.map(([direction, label, symbol]) => <button
      key={direction}
      aria-label={label}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onDirection(direction, true); }}
      onPointerUp={() => onDirection(direction, false)}
      onPointerCancel={() => onDirection(direction, false)}
      onLostPointerCapture={() => onDirection(direction, false)}
    >{symbol}</button>)}
  </div>;
}

export default function SpatialDeck({ roomCode, phase, players, you, socket, online, stageNumber = 1, appearance, onAppearanceChange, onInteract, suspended = false }) {
  const positionsRef = useRef({});
  const keysRef = useRef(new Set());
  const touchDirectionsRef = useRef(new Set());
  const intentRef = useRef({ x: 0, z: 0 });
  const [signals, setSignals] = useState([]);
  const [notice, setNotice] = useState('');
  const [signalBusy, setSignalBusy] = useState(false);
  const noticeTimeoutRef = useRef(null);
  const canMove = online && !suspended && phase !== 'voting' && phase !== 'finished';
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

  useEffect(() => () => window.clearTimeout(noticeTimeoutRef.current), []);

  useEffect(() => {
    const activeIds = new Set(players.map((player) => player.id));
    const next = Object.fromEntries(Object.entries(positionsRef.current).filter(([id]) => activeIds.has(id)));
    players.forEach((player, index) => {
      if (next[player.id]) return;
      const angle = (index / Math.max(players.length, 3)) * Math.PI * 2;
      next[player.id] = { x: Math.sin(angle) * 2.7, z: Math.cos(angle) * 2.2 };
    });
    positionsRef.current = next;
  }, [players]);

  useEffect(() => {
    const onWorldState = (snapshot) => {
      if (snapshot?.roomCode !== roomCode || !snapshot?.positions) return;
      const next = { ...positionsRef.current };
      for (const [id, point] of Object.entries(snapshot.positions)) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) continue;
        next[id] = { x: clamp(point.x, WALK_BOUNDS.x), z: clamp(point.z, WALK_BOUNDS.z) };
      }
      positionsRef.current = next;
    };
    const onWorldSignal = (signal) => {
      if (signal?.roomCode !== roomCode || !ECHO_SIGNALS.some((item) => item.type === signal?.type) || !players.some((player) => player.id === signal.playerId)) return;
      const timed = { ...signal, expiresAt: Date.now() + 3_600 };
      setSignals((current) => [...current.filter((item) => item.playerId !== timed.playerId), timed].slice(-8));
    };
    socket.on('world:state', onWorldState);
    socket.on('world:signal', onWorldSignal);
    const cleanup = window.setInterval(() => setSignals((current) => current.filter((signal) => signal.expiresAt > Date.now())), 400);
    return () => {
      socket.off('world:state', onWorldState);
      socket.off('world:signal', onWorldSignal);
      window.clearInterval(cleanup);
    };
  }, [players, roomCode, socket]);

  const refreshIntent = () => {
    let x = 0;
    let z = 0;
    const touch = touchDirectionsRef.current;
    if (touch.has('left')) x -= 1;
    if (touch.has('right')) x += 1;
    if (touch.has('up')) z -= 1;
    if (touch.has('down')) z += 1;
    const keys = keysRef.current;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
    const magnitude = Math.hypot(x, z);
    intentRef.current = magnitude > 1 ? { x: x / magnitude, z: z / magnitude } : { x, z };
  };

  useEffect(() => {
    const keyDirections = { KeyW: true, KeyA: true, KeyS: true, KeyD: true, ArrowUp: true, ArrowLeft: true, ArrowDown: true, ArrowRight: true };
    const isEditableTarget = (target) => target instanceof Element && target.closest('input, textarea, select, button, [role="dialog"], [contenteditable="true"]');
    const onKeyDown = (event) => {
      if (event.code === 'KeyE' && online && !suspended && phase !== 'finished' && !isEditableTarget(event.target)) {
        event.preventDefault();
        const playerPosition = positionsRef.current[you?.id];
        if (!playerPosition) return;
        let nearest = -1;
        let distance = Infinity;
        MISSION_TERMINAL_POSITIONS.forEach(([x, z], index) => {
          const nextDistance = Math.hypot(playerPosition.x - x, playerPosition.z - z);
          if (nextDistance < distance) { distance = nextDistance; nearest = index; }
        });
        if (distance > 2.45) {
          showSceneNotice(noticeTimeoutRef, setNotice, 'Move closer to a glowing mission console, then press E.');
          return;
        }
        showSceneNotice(noticeTimeoutRef, setNotice, `${MISSION_LABELS[nearest]} linked · phase controls opened.`, 2_800);
        onInteractRef.current?.(nearest);
        return;
      }
      if (!canMove || !keyDirections[event.code] || isEditableTarget(event.target)) return;
      event.preventDefault();
      keysRef.current.add(event.code);
      refreshIntent();
    };
    const onKeyUp = (event) => {
      if (!keyDirections[event.code]) return;
      keysRef.current.delete(event.code);
      refreshIntent();
    };
    const clear = () => {
      keysRef.current.clear();
      touchDirectionsRef.current.clear();
      refreshIntent();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [canMove, online, phase, suspended, you?.id]);

  const moveTouch = (direction, pressed) => {
    if (pressed) touchDirectionsRef.current.add(direction);
    else touchDirectionsRef.current.delete(direction);
    refreshIntent();
  };

  const sendSignal = (signalType) => {
    if (signalBusy || !socket.connected) {
      showSceneNotice(noticeTimeoutRef, setNotice, socket.connected ? 'Signal is on cooldown.' : 'Reconnect before sending a signal.');
      return;
    }
    setSignalBusy(true);
    socket.timeout(4_000).emit('world:signal', { type: signalType }, (error, result) => {
      setSignalBusy(false);
      showSceneNotice(noticeTimeoutRef, setNotice, error ? 'The signal could not reach your crew.' : result?.sent === true || result?.ok === true ? 'Echo signal transmitted.' : result?.error || 'Signal rejected.');
    });
  };

  const setProfileAppearance = (patch) => {
    const next = { ...appearance, ...patch };
    onAppearanceChange(next);
    socket.timeout(5_000).emit('player:profile', { appearance: next }, () => {});
  };

  const activeSignals = signals.filter((signal) => signal.expiresAt > Date.now());
  const phaseDetail = phase === 'lobby'
    ? `${players.length} operatives on deck · ${players.filter((player) => player.connected).length} linked`
    : `MISSION ${String(stageNumber).padStart(2, '0')} · ${phase.replace('-', ' ').toUpperCase()}`;

  return <section className="spatial-deck" aria-label="Interactive 3D crew deck">
    <div className="spatial-header"><span><i /> SPATIAL LINK · {phaseDetail}</span><span className="spatial-view-hint">DRAG · WASD WALK · E INTERACT</span></div>
    <div className="spatial-canvas-wrap">
      <SceneBoundary>
        <div className="spatial-canvas-focus" tabIndex={0} role="group" aria-label="Crew movement scene. Use WASD to walk, drag to look, and E to use nearby mission consoles." onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}>
          <Canvas
            dpr={[1, 1.25]}
            camera={{ position: [0, 4.8, 8.8], fov: 43, near: 0.1, far: 80 }}
            gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
            onCreated={({ gl }) => { gl.setClearColor('#07101b', 1); }}
          >
            <SpaceStation
              players={players}
              selfId={you?.id}
              positionsRef={positionsRef}
              intentRef={intentRef}
              socket={socket}
              signals={activeSignals}
              phase={phase}
              stageNumber={stageNumber}
              interactive={canMove}
            />
          </Canvas>
        </div>
      </SceneBoundary>
      <div className="spatial-corner spatial-corner-left"><span className="spatial-overline">MINDSYNC / SPATIAL HUB</span><strong>{phase === 'lobby' ? 'ASSEMBLY DECK' : `STAGE ${String(stageNumber).padStart(2, '0')}`}</strong><small>{phase === 'lobby' ? 'Crew staging area' : 'Mission consoles online'}</small></div>
      {phase === 'voting' && <div className="world-lock-banner" role="status">SECURE BALLOT · movement paused while the crew votes</div>}
      {phase !== 'finished' && <div className="spatial-corner spatial-corner-right"><span className="spatial-overline">CREW CUSTOMIZATION</span><div className="customize-quick">
        {Object.entries(SUIT_COLORS).map(([id, color]) => <button key={id} disabled={!online} aria-label={`Suit color ${id}`} title={id} className={appearance?.suit === id ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => setProfileAppearance({ suit: id })} />)}
        <select disabled={!online} aria-label="Helmet style" value={appearance?.helmet ?? 'aegis'} onChange={(event) => setProfileAppearance({ helmet: event.target.value })}>
          <option value="aegis">Aegis helmet</option><option value="pilot">Pilot helmet</option><option value="halo">Halo helmet</option>
        </select>
        <select disabled={!online} aria-label="Backpack style" value={appearance?.pack ?? 'standard'} onChange={(event) => setProfileAppearance({ pack: event.target.value })}>
          <option value="standard">Standard pack</option><option value="twin">Twin tanks</option><option value="wing">Wing pack</option>
        </select>
      </div></div>}
      <div className="spatial-controls-bar">
        <div className="echo-signal-controls" role="group" aria-label="Send an Echo Signal">
          <span className="spatial-overline">ECHO SIGNALS</span>
          {ECHO_SIGNALS.map((signal) => <button key={signal.type} disabled={signalBusy || !socket.connected} title={signal.label} aria-label={`Signal: ${signal.label}`} onClick={() => sendSignal(signal.type)}><span>{signal.symbol}</span><small>{signal.label}</small></button>)}
          {notice && <span className="echo-notice" role="status">{notice}</span>}
        </div>
        {canMove && <TouchPad onDirection={moveTouch} />}
      </div>
    </div>
  </section>;
}
