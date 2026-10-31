import { createHash, randomBytes, randomInt } from 'node:crypto';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MAX_REJECTIONS = 5;
export const PLAYER_AVATARS = Object.freeze(['🛰️', '🦊', '🐺', '🐼', '🦉', '🐙', '🦋', '🐸', '🐯', '🦄', '👾', '🤖', '🎭', '🧿', '🔥', '🌙']);
export const DEFAULT_APPEARANCE = Object.freeze({ suit: 'violet', helmet: 'aegis', pack: 'standard' });
const SUIT_STYLES = new Set(['violet', 'cyan', 'ember', 'mint', 'gold', 'rose']);
const HELMET_STYLES = new Set(['aegis', 'pilot', 'halo']);
const PACK_STYLES = new Set(['standard', 'twin', 'wing']);
export const ROLE_COUNTS = Object.freeze({ 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2 });
export const TEAM_SIZES = Object.freeze({
  3: [2, 2, 2, 2, 2],
  4: [2, 2, 3, 3, 3],
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
});

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_BYTES = 32;

export const roomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
export const playerToken = () => randomBytes(TOKEN_BYTES).toString('base64url');
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export const safeName = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 18);
export const safeAvatar = (value) => PLAYER_AVATARS.includes(value) ? value : PLAYER_AVATARS[0];
export function safeAppearance(value = {}, fallback = DEFAULT_APPEARANCE) {
  return {
    suit: SUIT_STYLES.has(value?.suit) ? value.suit : fallback.suit,
    helmet: HELMET_STYLES.has(value?.helmet) ? value.helmet : fallback.helmet,
    pack: PACK_STYLES.has(value?.pack) ? value.pack : fallback.pack,
  };
}

export function roleCounts(playerCount) {
  return ROLE_COUNTS[playerCount] ?? 0;
}

export function teamSize(playerCount, missionIndex) {
  return TEAM_SIZES[playerCount]?.[missionIndex] ?? 0;
}

export function sabotageThreshold(playerCount, missionIndex) {
  return playerCount >= 7 && missionIndex === 3 ? 2 : 1;
}

export function createLobby({ code, playerId, token, name, avatar, now = Date.now() }) {
  return {
    code,
    revision: 0,
    phase: 'lobby',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
    phaseDeadline: null,
    hostId: playerId,
    players: [{
      id: playerId,
      tokenHash: tokenHash(token),
      name: safeName(name),
      avatar: safeAvatar(avatar),
      appearance: { ...DEFAULT_APPEARANCE },
      role: null,
      ready: false,
      connected: true,
      wins: 0,
      matchesPlayed: 0,
      rematchReady: false,
    }],
    matchNumber: 0,
    leaderIndex: 0,
    missionIndex: 0,
    scores: { loyal: 0, saboteur: 0 },
    rejectionCount: 0,
    currentProposal: null,
    currentTeam: [],
    selectedIntel: null,
    actions: {},
    proposalLog: [],
    missionLog: [],
    matchStartedAt: null,
    winner: null,
    matchAbandoned: false,
    matchFinishedAt: null,
    matchHistory: [],
    chat: [],
  };
}

function randomizeRoles(players) {
  const saboteurCount = roleCounts(players.length);
  const order = players.map((player) => player.id);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const saboteurs = new Set(order.slice(0, saboteurCount));
  return players.map((player) => ({
    ...player,
    role: saboteurs.has(player.id) ? 'saboteur' : 'agent',
    ready: false,
    rematchReady: false,
  }));
}

export function startMatch(room, now = Date.now(), durationMs = 75_000) {
  if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) throw new Error('A match needs 3–8 players.');
  if (room.players.some((player) => !player.ready || !player.connected)) throw new Error('Every player must be connected and ready.');
  const players = randomizeRoles(room.players);
  return {
    ...room,
    players,
    phase: 'proposal',
    phaseDeadline: now + durationMs,
    matchNumber: room.matchNumber + 1,
    leaderIndex: randomInt(players.length),
    missionIndex: 0,
    scores: { loyal: 0, saboteur: 0 },
    rejectionCount: 0,
    currentProposal: null,
    currentTeam: [],
    selectedIntel: null,
    actions: {},
    proposalLog: [],
    missionLog: [],
    matchStartedAt: now,
    winner: null,
    matchAbandoned: false,
    matchFinishedAt: null,
    updatedAt: now,
  };
}

export function allReady(room) {
  return room.players.length >= MIN_PLAYERS && room.players.every((player) => player.ready && player.connected);
}

export function publicState(room, playerId) {
  const finished = room.phase === 'finished';
  const player = room.players.find((candidate) => candidate.id === playerId);
  const publicPlayers = room.players.map(({ id, name, avatar, appearance, ready, connected, wins, matchesPlayed, rematchReady, role }) => ({
    id, name, avatar: safeAvatar(avatar), appearance: safeAppearance(appearance), ready, connected, wins, matchesPlayed, rematchReady,
    ...(finished ? { role } : {}),
  }));
  const proposals = room.proposalLog.map((item) => ({
    mission: item.mission,
    team: item.team,
    yes: item.yes,
    no: item.no,
    passed: item.passed,
    rejectionCount: item.rejectionCount,
    timedOut: item.timedOut,
  }));
  const missions = room.missionLog.map(({ sabotageCount, ...mission }) => ({
    ...mission,
    ...(finished ? { sabotageCount } : {}),
  }));

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    proposalLeaderId: room.currentProposal?.leaderId ?? null,
    votesSubmitted: room.phase === 'voting' ? Object.keys(room.currentProposal?.votes ?? {}).length : null,
    players: publicPlayers,
    you: player ? {
      id: player.id,
      avatar: safeAvatar(player.avatar),
      appearance: safeAppearance(player.appearance),
      role: finished ? player.role : player.role,
      isHost: player.id === room.hostId,
      ready: player.ready,
      rematchReady: player.rematchReady,
      hasVoted: Boolean(room.currentProposal?.votes?.[playerId]),
      hasActed: Object.hasOwn(room.actions, playerId),
      myVote: room.currentProposal?.votes?.[playerId]?.choice ?? null,
    } : null,
    matchNumber: room.matchNumber,
    leaderId: room.players[room.leaderIndex]?.id ?? null,
    mission: room.phase === 'lobby' ? null : {
      number: room.missionIndex + 1,
      total: 5,
      teamSize: teamSize(room.players.length, room.missionIndex),
      sabotageThreshold: sabotageThreshold(room.players.length, room.missionIndex),
      rejectionCount: room.rejectionCount,
      team: room.currentProposal?.team ?? room.currentTeam,
      intelChannel: room.selectedIntel,
      submittedActions: Object.keys(room.actions).length,
    },
    scores: room.scores,
    phaseDeadline: room.phaseDeadline,
    proposalLog: proposals,
    missionLog: missions,
    matchHistory: room.matchHistory ?? [],
    chat: room.chat ?? [],
    winner: room.winner,
    matchAbandoned: Boolean(room.matchAbandoned),
    matchFinishedAt: room.matchFinishedAt,
    rematchAllReady: room.players.length >= MIN_PLAYERS && room.players.every((candidate) => candidate.rematchReady && candidate.connected),
  };
}

export function assignPublicId() {
  return randomBytes(9).toString('base64url');
}

