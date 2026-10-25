import {
  MAX_PLAYERS, MAX_REJECTIONS, MIN_PLAYERS, allReady, assignPublicId,
  createLobby, publicState, playerToken, roomCode, safeAvatar, safeName,
  sabotageThreshold, startMatch, teamSize, tokenHash,
} from './game.js';

const TIMEOUTS = Object.freeze({
  proposal: 75_000,
  voting: 45_000,
  intel: 20_000,
  action: 45_000,
  debrief: 35_000,
});
const clone = (value) => structuredClone(value);
const now = () => Date.now();

export class GameService {
  constructor({ store, io, timeouts = {} }) {
    this.store = store;
    this.io = io;
    this.timeouts = { ...TIMEOUTS, ...timeouts };
    this.playerSockets = new Map();
    this.socketPlayers = new Map();
    this.phaseTimers = new Map();
    this.rateLimits = new Map();
    this.chatLimits = new Map();
  }

  attach(socket) {
    const events = {
      'room:create': (payload) => this.createRoom(socket, payload),
      'room:join': (payload) => this.joinRoom(socket, payload),
      'room:resume': (payload) => this.resumeRoom(socket, payload),
      'room:leave': () => this.leaveRoom(socket),
      'player:profile': (payload) => this.setProfile(socket, payload),
      'chat:send': (payload) => this.sendChat(socket, payload),
      'player:ready': (payload) => this.setReady(socket, payload),
      'game:start': () => this.start(socket),
      'proposal:submit': (payload) => this.submitProposal(socket, payload),
      'vote:submit': (payload) => this.submitVote(socket, payload),
      'intel:choose': (payload) => this.chooseIntel(socket, payload),
      'action:submit': (payload) => this.submitAction(socket, payload),
      'rematch:ready': (payload) => this.setRematchReady(socket, payload),
      'game:rematch': () => this.rematch(socket),
    };
    for (const [event, handler] of Object.entries(events)) {
      socket.on(event, (payload = {}, ack = () => {}) => {
        Promise.resolve(handler(payload ?? {}))
          .then((data) => ack({ ok: true, ...(data ?? {}) }))
          .catch((error) => ack({ ok: false, error: error.message || 'That action could not be completed.' }));
      });
    }
    socket.on('transport:heartbeat', () => {});
    socket.on('disconnect', () => { this.handleDisconnect(socket.id).catch(() => {}); });
  }

  async restoreRooms() {
    const rooms = await this.store.list();
    for (const room of rooms) {
      const restored = await this.mutate(room.code, (draft) => {
        draft.players = draft.players.map((player) => ({ ...player, connected: false }));
        if (draft.phase !== 'lobby' && draft.phase !== 'finished') {
          const nextDuration = this.timeouts[draft.phase] ?? 45_000;
          if (!draft.phaseDeadline || draft.phaseDeadline < now()) draft.phaseDeadline = now() + nextDuration;
        }
        return draft;
      }, { broadcast: false, schedule: false });
      this.schedule(restored);
    }
  }

  async createRoom(socket, payload) {
    this.checkLobbyRate(socket, 'create', 6);
    const name = safeName(payload.name);
    if (name.length < 2) throw new Error('Choose a name with at least 2 characters.');
    let room;
    let token;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      token = playerToken();
      room = createLobby({ code: roomCode(), playerId: assignPublicId(), token, name, avatar: payload.avatar });
      if (await this.store.create(room)) break;
      room = null;
    }
    if (!room) throw new Error('Could not reserve a room code. Please try again.');
    this.bindPlayer(socket, room.code, room.players[0].id);
    this.schedule(room);
    this.broadcast(room);
    return { code: room.code, token, playerId: room.players[0].id };
  }

  async joinRoom(socket, payload) {
    this.checkLobbyRate(socket, 'join', 18);
    const code = this.cleanCode(payload.code);
    const name = safeName(payload.name);
    if (name.length < 2) throw new Error('Choose a name with at least 2 characters.');
    const token = playerToken();
    const playerId = assignPublicId();
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'lobby') throw new Error('This match has already started. New players cannot join.');
      if (draft.players.length >= MAX_PLAYERS) throw new Error('This room is full.');
      if (draft.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already being used in this room.');
      draft.players.push({
        id: playerId,
        tokenHash: tokenHash(token),
        name,
        avatar: safeAvatar(payload.avatar),
        role: null,
        ready: false,
        connected: true,
        wins: 0,
        matchesPlayed: 0,
        rematchReady: false,
      });
      return draft;
    });
    this.bindPlayer(socket, code, playerId);
    this.broadcast(room);
    return { code, token, playerId };
  }

  async resumeRoom(socket, payload) {
    const code = this.cleanCode(payload.code);
    const token = String(payload.token ?? '');
    if (token.length < 30) throw new Error('This saved player key is invalid. Join the room again.');
    let playerId;
    const room = await this.mutate(code, (draft) => {
      const player = draft.players.find((candidate) => candidate.tokenHash === tokenHash(token));
      if (!player) throw new Error('That player key is not registered in this room.');
      playerId = player.id;
      player.connected = true;
      return draft;
    });
    this.bindPlayer(socket, code, playerId);
    this.broadcast(room);
    return { code, playerId, resumed: true };
  }

  async bindPlayer(socket, code, playerId) {
    const key = `${code}:${playerId}`;
    const previousId = this.playerSockets.get(key);
    if (previousId && previousId !== socket.id) {
      this.socketPlayers.delete(previousId);
      this.io.sockets.sockets.get(previousId)?.disconnect(true);
    }
    this.playerSockets.set(key, socket.id);
    this.socketPlayers.set(socket.id, { code, playerId });
    socket.data.gamePlayer = { code, playerId };
  }

  async handleDisconnect(socketId) {
    const membership = this.socketPlayers.get(socketId);
    if (!membership) return;
    this.socketPlayers.delete(socketId);
    const key = `${membership.code}:${membership.playerId}`;
    if (this.playerSockets.get(key) !== socketId) return;
    this.playerSockets.delete(key);
    const room = await this.mutate(membership.code, (draft) => {
      const player = draft.players.find((candidate) => candidate.id === membership.playerId);
      if (!player) return null;
      player.connected = false;
      if (draft.hostId === player.id) {
        draft.hostId = draft.players.find((candidate) => candidate.connected)?.id ?? player.id;
      }
      return draft;
    });
    if (room) this.broadcast(room);
  }

  async leaveRoom(socket) {
    const { code, playerId } = this.requireMember(socket);
    let removeAll = false;
    let resetMatch = false;
    const room = await this.mutate(code, (draft) => {
      const activeMatch = !['lobby', 'finished'].includes(draft.phase);
      resetMatch = activeMatch;
      draft.players = draft.players.filter((player) => player.id !== playerId);
      if (draft.hostId === playerId) draft.hostId = draft.players.find((player) => player.connected)?.id ?? draft.players[0]?.id ?? null;
      removeAll = draft.players.length === 0;
      if (activeMatch) {
        draft.phase = 'lobby';
        draft.phaseDeadline = null;
        draft.players = draft.players.map((player) => ({ ...player, role: null, ready: false, rematchReady: false }));
        draft.missionIndex = 0;
        draft.scores = { loyal: 0, saboteur: 0 };
        draft.rejectionCount = 0;
        draft.currentProposal = null;
        draft.currentTeam = [];
        draft.selectedIntel = null;
        draft.actions = {};
        draft.proposalLog = [];
        draft.missionLog = [];
        draft.matchStartedAt = null;
        draft.matchFinishedAt = null;
        draft.winner = null;
        draft.matchAbandoned = true;
      }
      return draft;
    }, { broadcast: false, schedule: false });
    const key = `${code}:${playerId}`;
    this.playerSockets.delete(key);
    this.socketPlayers.delete(socket.id);
    if (removeAll) {
      await this.store.delete(code);
      const activeTimer = this.phaseTimers.get(code);
      if (activeTimer) clearTimeout(activeTimer.timer);
      this.phaseTimers.delete(code);
    } else this.broadcast(room);
    socket.leave(code);
    return { left: true, resetMatch };
  }

  async setProfile(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const avatar = safeAvatar(payload.avatar);
    const room = await this.mutate(code, (draft) => {
      const player = draft.players.find((candidate) => candidate.id === playerId);
      if (!player) throw new Error('That player seat is no longer in this room.');
      player.avatar = avatar;
      return draft;
    });
    this.broadcast(room);
    return { avatar };
  }

  async sendChat(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    this.checkChatRate(code, playerId);
    const message = String(payload.message ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 240);
    if (!message) throw new Error('Write a message before sending it.');
    const room = await this.mutate(code, (draft) => {
      const player = draft.players.find((candidate) => candidate.id === playerId);
      if (!player) throw new Error('That player seat is no longer in this room.');
      draft.chat = [...(draft.chat ?? []), {
        id: assignPublicId(),
        playerId,
        name: player.name,
        avatar: safeAvatar(player.avatar),
        message,
        sentAt: now(),
      }].slice(-120);
      return draft;
    });
    this.broadcast(room);
    return { sent: true };
  }

  async setReady(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const ready = Boolean(payload.ready);
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'lobby') throw new Error('Readiness can only change in the lobby.');
      const player = draft.players.find((candidate) => candidate.id === playerId);
      player.ready = ready;
      return draft;
    });
    this.broadcast(room);
  }

  async start(socket) {
    const { code, playerId } = this.requireMember(socket);
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'lobby') throw new Error('This room is not waiting to start.');
      if (draft.hostId !== playerId) throw new Error('Only the host can start the match.');
      if (draft.players.length < MIN_PLAYERS) throw new Error('At least 3 players are needed.');
      if (!allReady(draft)) throw new Error('Everyone must be connected and ready.');
      return startMatch(draft, now(), this.timeouts.proposal);
    });
    this.broadcast(room);
  }

  async submitProposal(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const submittedTeam = Array.isArray(payload.team) ? [...new Set(payload.team.map(String))] : [];
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'proposal') throw new Error('The team proposal phase is closed.');
      if (draft.players[draft.leaderIndex]?.id !== playerId) throw new Error('Only the current leader can propose a team.');
      const required = teamSize(draft.players.length, draft.missionIndex);
      if (submittedTeam.length !== required) throw new Error(`Select exactly ${required} players for this mission.`);
      if (submittedTeam.some((id) => !draft.players.some((player) => player.id === id))) throw new Error('The proposed team includes an unknown player.');
      draft.currentTeam = submittedTeam;
      draft.currentProposal = { leaderId: playerId, team: submittedTeam, votes: {}, createdAt: now() };
      draft.phase = 'voting';
      draft.phaseDeadline = now() + this.timeouts.voting;
      return draft;
    });
    this.broadcast(room);
  }

  async submitVote(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    if (typeof payload.approve !== 'boolean') throw new Error('Choose approve or reject.');
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'voting') throw new Error('There is no open team vote.');
      if (draft.currentProposal.votes[playerId]) throw new Error('Your vote has already been recorded.');
      draft.currentProposal.votes[playerId] = { choice: payload.approve, submittedAt: now() };
      if (Object.keys(draft.currentProposal.votes).length === draft.players.length) this.resolveVoteDraft(draft, false);
      return draft;
    });
    this.broadcast(room);
  }

  resolveVoteDraft(draft, timedOut) {
    const totalPlayers = draft.players.length;
    for (const player of draft.players) {
      if (!draft.currentProposal.votes[player.id]) draft.currentProposal.votes[player.id] = { choice: false, submittedAt: now(), timedOut: true };
    }
    const values = Object.values(draft.currentProposal.votes);
    const yes = values.filter((vote) => vote.choice).length;
    const no = totalPlayers - yes;
    const passed = yes > totalPlayers / 2;
    const proposal = {
      mission: draft.missionIndex + 1,
      leaderId: draft.currentProposal.leaderId,
      team: [...draft.currentProposal.team],
      votes: clone(draft.currentProposal.votes),
      yes,
      no,
      passed,
      timedOut,
      rejectionCount: passed ? 0 : draft.rejectionCount + 1,
    };
    draft.proposalLog.push(proposal);
    draft.leaderIndex = (draft.leaderIndex + 1) % draft.players.length;
    if (passed) {
      draft.rejectionCount = 0;
      draft.phase = 'intel';
      draft.phaseDeadline = now() + this.timeouts.intel;
      draft.currentProposal = { ...proposal, createdAt: now() };
    } else {
      draft.rejectionCount += 1;
      draft.currentProposal = null;
      draft.currentTeam = [];
      draft.selectedIntel = null;
      if (draft.rejectionCount >= MAX_REJECTIONS) {
        this.failMissionDraft(draft, 'five-rejections', null);
      } else {
        draft.phase = 'proposal';
        draft.phaseDeadline = now() + this.timeouts.proposal;
      }
    }
  }

  async chooseIntel(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const channel = String(payload.channel ?? '');
    if (!['ballotEcho', 'actionTrace'].includes(channel)) throw new Error('Choose one of the two Intel Fragment channels.');
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'intel') throw new Error('Intel can only be selected after the team vote passes.');
      if (draft.currentProposal?.leaderId !== playerId) throw new Error('The mission leader chooses this Intel Fragment.');
      draft.selectedIntel = channel;
      draft.phase = 'action';
      draft.phaseDeadline = now() + this.timeouts.action;
      draft.actions = {};
      return draft;
    });
    this.broadcast(room);
  }

  async submitAction(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const action = String(payload.action ?? '');
    if (!['support', 'sabotage'].includes(action)) throw new Error('Choose support or sabotage.');
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'action') throw new Error('Mission actions are closed.');
      if (!draft.currentTeam.includes(playerId)) throw new Error('Only selected players can submit a mission action.');
      const player = draft.players.find((candidate) => candidate.id === playerId);
      if (player.role !== 'saboteur' && action !== 'support') throw new Error('Loyal agents can only support a mission.');
      if (Object.hasOwn(draft.actions, playerId)) throw new Error('Your mission action has already been recorded.');
      draft.actions[playerId] = { choice: action, submittedAt: now() };
      if (Object.keys(draft.actions).length === draft.currentTeam.length) this.resolveMissionDraft(draft);
      return draft;
    });
    this.broadcast(room);
  }

  resolveMissionDraft(draft) {
    const selected = draft.selectedIntel;
    for (const id of draft.currentTeam) {
      if (!draft.actions[id]) draft.actions[id] = { choice: 'support', submittedAt: now(), timedOut: true };
    }
    const sabotageCount = Object.values(draft.actions).filter((action) => action.choice === 'sabotage').length;
    const threshold = sabotageThreshold(draft.players.length, draft.missionIndex);
    const passed = sabotageCount < threshold;
    let fragment;
    if (selected === 'ballotEcho') {
      const dissent = draft.currentTeam.filter((id) => draft.currentProposal?.votes?.[id]?.choice === false).length;
      fragment = { kind: selected, value: dissent, text: `Ballot Echo · ${dissent} selected ${dissent === 1 ? 'operative voted' : 'operatives voted'} to reject this team.` };
    } else {
      const band = sabotageCount >= 2 ? '2+' : String(sabotageCount);
      fragment = { kind: selected, value: band, text: `Action Trace · ${band} sabotage ${band === '1' ? 'action' : 'actions'} detected.` };
    }
    draft.missionLog.push({
      number: draft.missionIndex + 1,
      team: [...draft.currentTeam],
      threshold,
      sabotageCount,
      result: passed ? 'success' : 'failure',
      reason: 'mission-actions',
      fragment,
      proposals: draft.proposalLog.filter((entry) => entry.mission === draft.missionIndex + 1).map(({ mission, team, yes, no, passed: proposalPassed }) => ({ mission, team, yes, no, passed: proposalPassed })),
      completedAt: now(),
    });
    if (passed) draft.scores.loyal += 1;
    else draft.scores.saboteur += 1;
    this.finishOrDebrief(draft);
  }

  failMissionDraft(draft, reason, fragment) {
    draft.missionLog.push({
      number: draft.missionIndex + 1,
      team: [],
      threshold: sabotageThreshold(draft.players.length, draft.missionIndex),
      sabotageCount: null,
      result: 'failure',
      reason,
      fragment,
      proposals: draft.proposalLog.filter((entry) => entry.mission === draft.missionIndex + 1).map(({ mission, team, yes, no, passed }) => ({ mission, team, yes, no, passed })),
      completedAt: now(),
    });
    draft.scores.saboteur += 1;
    this.finishOrDebrief(draft);
  }

  finishOrDebrief(draft) {
    draft.currentProposal = null;
    draft.currentTeam = [];
    draft.selectedIntel = null;
    draft.actions = {};
    const winner = draft.scores.loyal >= 3 ? 'loyal' : draft.scores.saboteur >= 3 ? 'saboteur' : null;
    if (winner || draft.missionIndex >= 4) {
      draft.winner = winner ?? (draft.scores.loyal > draft.scores.saboteur ? 'loyal' : 'saboteur');
      draft.phase = 'finished';
      draft.phaseDeadline = null;
      draft.matchFinishedAt = now();
      for (const player of draft.players) {
        player.matchesPlayed += 1;
        const won = (player.role === 'saboteur' && draft.winner === 'saboteur') || (player.role === 'agent' && draft.winner === 'loyal');
        if (won) player.wins += 1;
        player.rematchReady = false;
      }
      draft.matchHistory = [...(draft.matchHistory ?? []), {
        matchNumber: draft.matchNumber,
        winner: draft.winner,
        scores: clone(draft.scores),
        players: draft.players.map(({ id, name, role, wins, matchesPlayed }) => ({ id, name, role, wins, matchesPlayed })),
        missions: clone(draft.missionLog),
        proposals: draft.proposalLog.map(({ votes, ...proposal }) => proposal),
        completedAt: draft.matchFinishedAt,
      }].slice(-20);
    } else {
      draft.missionIndex += 1;
      draft.rejectionCount = 0;
      draft.phase = 'debrief';
      draft.phaseDeadline = now() + this.timeouts.debrief;
    }
    draft.updatedAt = now();
  }

  async setRematchReady(socket, payload) {
    const { code, playerId } = this.requireMember(socket);
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'finished') throw new Error('Rematch readiness is available after the match.');
      const player = draft.players.find((candidate) => candidate.id === playerId);
      player.rematchReady = Boolean(payload.ready);
      return draft;
    });
    this.broadcast(room);
  }

  async rematch(socket) {
    const { code, playerId } = this.requireMember(socket);
    const room = await this.mutate(code, (draft) => {
      if (draft.phase !== 'finished') throw new Error('The current match is not finished.');
      if (draft.hostId !== playerId) throw new Error('Only the host can start a rematch.');
      if (draft.players.some((player) => !player.rematchReady || !player.connected)) throw new Error('Every player must be connected and ready for the rematch.');
      draft.players = draft.players.map((player) => ({ ...player, ready: true }));
      return startMatch(draft, now(), this.timeouts.proposal);
    });
    this.broadcast(room);
  }

  async timeout(code, expectedDeadline) {
    try {
      const room = await this.mutate(code, (draft) => {
        if (draft.phaseDeadline !== expectedDeadline || expectedDeadline > now()) return null;
        if (draft.phase === 'proposal') {
          draft.proposalLog.push({ mission: draft.missionIndex + 1, leaderId: draft.players[draft.leaderIndex]?.id, team: [], votes: {}, yes: 0, no: 0, passed: false, timedOut: true, rejectionCount: draft.rejectionCount + 1 });
          draft.leaderIndex = (draft.leaderIndex + 1) % draft.players.length;
          draft.rejectionCount += 1;
          if (draft.rejectionCount >= MAX_REJECTIONS) this.failMissionDraft(draft, 'five-rejections', null);
          else draft.phaseDeadline = now() + this.timeouts.proposal;
        } else if (draft.phase === 'voting') {
          this.resolveVoteDraft(draft, true);
        } else if (draft.phase === 'intel') {
          draft.selectedIntel = 'ballotEcho';
          draft.phase = 'action';
          draft.phaseDeadline = now() + this.timeouts.action;
          draft.actions = {};
        } else if (draft.phase === 'action') {
          this.resolveMissionDraft(draft);
        } else if (draft.phase === 'debrief') {
          draft.phase = 'proposal';
          draft.phaseDeadline = now() + this.timeouts.proposal;
        } else return null;
        return draft;
      });
      if (room) this.broadcast(room);
    } catch {
      // A concurrent player action may have advanced the phase before this timer fired.
    }
  }

  async mutate(code, callback, { broadcast = true, schedule = true } = {}) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await this.store.get(code);
      if (!current) throw new Error('Room not found. Check the code and try again.');
      const draft = clone(current);
      const next = callback(draft);
      if (!next) return null;
      next.revision = current.revision;
      next.updatedAt = now();
      next.expiresAt = new Date(now() + 30 * 24 * 60 * 60 * 1000);
      if (await this.store.compareAndSet(code, current.revision, next)) {
        next.revision = current.revision + 1;
        if (schedule) this.schedule(next);
        if (broadcast) this.broadcast(next);
        return next;
      }
    }
    throw new Error('The room changed at the same time. Please try that action again.');
  }

  cleanCode(value) {
    const code = String(value ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
    if (code.length !== 6) throw new Error('Enter the 6-character room code.');
    return code;
  }

  checkLobbyRate(socket, action, maxPerMinute) {
    const address = socket.handshake.address || 'unknown';
    const key = `${address}:${action}`;
    const current = this.rateLimits.get(key);
    if (!current || now() - current.startedAt >= 60_000) {
      this.rateLimits.set(key, { startedAt: now(), count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maxPerMinute) throw new Error('Too many room attempts. Wait a minute and try again.');
  }

  checkChatRate(code, playerId) {
    const key = `${code}:${playerId}`;
    const current = this.chatLimits.get(key);
    if (!current || now() - current.startedAt >= 10_000) {
      this.chatLimits.set(key, { startedAt: now(), count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > 8) throw new Error('Chat is moving too quickly. Wait a few seconds and try again.');
  }

  requireMember(socket) {
    const membership = this.socketPlayers.get(socket.id);
    if (!membership) throw new Error('Reconnect to the room before taking an action.');
    return membership;
  }

  schedule(room) {
    const existing = this.phaseTimers.get(room.code);
    if (existing) clearTimeout(existing.timer);
    this.phaseTimers.delete(room.code);
    if (!room.phaseDeadline || !this.timeouts[room.phase]) return;
    const expectedDeadline = room.phaseDeadline;
    const timer = setTimeout(() => this.timeout(room.code, expectedDeadline), Math.max(5, expectedDeadline - now()));
    timer.unref?.();
    this.phaseTimers.set(room.code, { timer, expectedDeadline });
  }

  broadcast(room) {
    for (const player of room.players) {
      const socketId = this.playerSockets.get(`${room.code}:${player.id}`);
      if (!socketId) continue;
      const socket = this.io.sockets.sockets.get(socketId);
      socket?.emit('room:state', publicState(room, player.id));
    }
  }

  async setConnected(code, playerId, connected) {
    const room = await this.mutate(code, (draft) => {
      const player = draft.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      player.connected = connected;
      return draft;
    });
    if (room) this.broadcast(room);
  }
}

