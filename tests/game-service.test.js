import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connectSocket } from 'socket.io-client';
import { GameService } from '../server/game-service.js';
import { MemoryRoomStore } from '../server/store.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function makeHarness(t, { store = new MemoryRoomStore() } = {}) {
  const httpServer = createServer();
  const ioServer = new Server(httpServer, { cors: { origin: true } });
  const game = new GameService({ store, io: ioServer, timeouts: { proposal: 5_000, voting: 5_000, intel: 5_000, action: 5_000, debrief: 30 } });
  ioServer.on('connection', (socket) => game.attach(socket));
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const sockets = [];
  const states = new Map();
  const openPlayer = async () => {
    const socket = connectSocket(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, forceNew: true });
    socket.on('room:state', (state) => states.set(socket, state));
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const request = (socket, event, payload = {}) => new Promise((resolve, reject) => {
    socket.timeout(2_500).emit(event, payload, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  const waitFor = async (socket, predicate, label = 'state') => {
    const end = Date.now() + 2_500;
    while (Date.now() < end) {
      const current = states.get(socket);
      if (current && predicate(current)) return current;
      await wait(5);
    }
    throw new Error(`Timed out waiting for ${label}. Current state: ${JSON.stringify(states.get(socket))}`);
  };
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => ioServer.close(resolve));
  });
  return { openPlayer, request, waitFor, states, sockets, store };
}

async function enterLobby(harness) {
  const { openPlayer, request, waitFor, states } = harness;
  const host = await openPlayer();
  const created = await request(host, 'room:create', { name: 'Aster' });
  assert.equal(created.ok, true);
  await waitFor(host, (state) => state.phase === 'lobby' && state.players.length === 1, 'host lobby');
  const players = [host];
  const credentials = [{ code: created.code, token: created.token, playerId: created.playerId }];
  for (const name of ['Beryl', 'Cinder']) {
    const socket = await openPlayer();
    const joined = await request(socket, 'room:join', { code: created.code, name });
    assert.equal(joined.ok, true);
    players.push(socket);
    credentials.push({ code: joined.code, token: joined.token, playerId: joined.playerId });
  }
  for (const socket of players) await waitFor(socket, (state) => state.players.length === 3, 'three-player lobby');
  for (const socket of players) assert.equal((await request(socket, 'player:ready', { ready: true })).ok, true);
  for (const socket of players) await waitFor(socket, (state) => state.players.every((player) => player.ready), 'ready players');
  return { host, players, credentials, code: created.code, ids: players.map((socket) => states.get(socket).you.id) };
}

async function beginMatch(harness, room) {
  const { host, players, ids } = room;
  const { request, waitFor, states } = harness;
  assert.equal((await request(players[1], 'game:start')).ok, false, 'a non-host cannot start');
  assert.equal((await request(host, 'game:start')).ok, true);
  for (const socket of players) await waitFor(socket, (state) => state.phase === 'proposal', 'match start');
  for (const socket of players) {
    const state = states.get(socket);
    assert.equal(state.players.some((player) => 'role' in player), false, 'public roster omits roles');
    assert.ok(['agent', 'saboteur'].includes(state.you.role), 'each player sees their own role');
    assert.equal(state.players.some((player) => 'tokenHash' in player), false, 'player credentials are never broadcast');
  }
  return { saboteurCount: states.get(host).you.role === 'saboteur' ? 1 : 0 };
}

async function completeMission(harness, room, { index = 0, firstMission = false } = {}) {
  const { host, players, ids } = room;
  const { request, waitFor, states } = harness;
  const leaderId = states.get(host).leaderId;
  const leaderSocket = players[ids.indexOf(leaderId)];
  const team = ids.slice(0, 2);
  assert.equal((await request(leaderSocket, 'proposal:submit', { team })).ok, true);
  for (const socket of players) await waitFor(socket, (state) => state.phase === 'voting', 'secure vote');

  if (firstMission) {
    const firstVote = await request(players[0], 'vote:submit', { approve: true });
    assert.equal(firstVote.ok, true);
    assert.equal((await request(players[0], 'vote:submit', { approve: true })).ok, false, 'duplicate votes are rejected');
    await waitFor(players[0], (state) => state.votesSubmitted === 1, 'first sealed ballot');
  }
  const alreadyVoted = firstMission ? [0] : [];
  for (const [playerIndex, socket] of players.entries()) {
    if (alreadyVoted.includes(playerIndex)) continue;
    assert.equal((await request(socket, 'vote:submit', { approve: true })).ok, true);
  }
  for (const socket of players) await waitFor(socket, (state) => state.phase === 'intel', 'passed vote');

  const intelLeaderId = states.get(host).proposalLeaderId;
  const intelLeader = players[ids.indexOf(intelLeaderId)];
  if (firstMission) {
    const extra = await openUnauthorized(harness, room.code);
    assert.equal(extra.ok, false, 'new players cannot join a match in progress');
  }
  assert.equal((await request(intelLeader, 'intel:choose', { channel: 'ballotEcho' })).ok, true);
  for (const socket of players) await waitFor(socket, (state) => state.phase === 'action', 'mission actions');

  const outsiderIndex = ids.findIndex((id) => !team.includes(id));
  assert.equal((await request(players[outsiderIndex], 'action:submit', { action: 'support' })).ok, false, 'players outside the team cannot act');
  const teamIndices = team.map((id) => ids.indexOf(id));
  const agentIndex = teamIndices.find((playerIndex) => states.get(players[playerIndex]).you.role === 'agent');
  assert.notEqual(agentIndex, undefined);
  assert.equal((await request(players[agentIndex], 'action:submit', { action: 'sabotage' })).ok, false, 'loyal agents cannot sabotage');
  assert.equal((await request(players[teamIndices[0]], 'action:submit', { action: 'support' })).ok, true);
  if (firstMission) assert.equal((await request(players[teamIndices[0]], 'action:submit', { action: 'support' })).ok, false, 'duplicate mission actions are rejected');
  const remaining = teamIndices.find((playerIndex) => playerIndex !== teamIndices[0]);
  assert.equal((await request(players[remaining], 'action:submit', { action: 'support' })).ok, true);
  return Promise.all(players.map((socket) => waitFor(socket, (state) => state.phase === (index === 2 ? 'finished' : 'debrief'), 'mission result')));
}

async function openUnauthorized(harness, code) {
  const socket = await harness.openPlayer();
  const result = await harness.request(socket, 'room:join', { code, name: 'Intruder' });
  return result;
}

test('separate socket players complete a match, reject tampering, and rematch', async (t) => {
  const harness = await makeHarness(t);
  const room = await enterLobby(harness);
  const { states, request, waitFor } = harness;
  await beginMatch(harness, room);

  let publicStates = await completeMission(harness, room, { firstMission: true, index: 0 });
  assert.equal(publicStates[0].missionLog[0].result, 'success');
  assert.equal(publicStates[0].missionLog[0].fragment.kind, 'ballotEcho');
  assert.equal('sabotageCount' in publicStates[0].missionLog[0], false, 'mission actions remain hidden before the final reveal');

  for (let mission = 1; mission < 3; mission += 1) {
    await Promise.all(room.players.map((socket) => waitFor(socket, (state) => state.phase === 'proposal' && state.mission.number === mission + 1, 'next mission proposal')));
    publicStates = await completeMission(harness, room, { index: mission });
  }

  assert.equal(publicStates[0].phase, 'finished');
  assert.equal(publicStates[0].winner, 'loyal');
  assert.equal(publicStates[0].scores.loyal, 3);
  assert.equal(publicStates[0].players.filter((player) => player.role === 'saboteur').length, 1);
  assert.equal(publicStates[0].missionLog[0].sabotageCount, 0, 'action counts are available after the reveal');
  assert.equal(publicStates[0].matchHistory.length, 1, 'completed match history is retained in the room');

  for (const socket of room.players) assert.equal((await request(socket, 'rematch:ready', { ready: true })).ok, true);
  await Promise.all(room.players.map((socket) => waitFor(socket, (state) => state.rematchAllReady, 'rematch readiness')));
  assert.equal((await request(room.host, 'game:rematch')).ok, true);
  for (const socket of room.players) await waitFor(socket, (state) => state.phase === 'proposal' && state.matchNumber === 2, 'rematch start');
  for (const socket of room.players) {
    assert.equal(states.get(socket).players.some((player) => 'role' in player), false, 'roles are private again after rematch');
    assert.equal(states.get(socket).matchHistory.length, 1, 'the first match remains in room history');
  }
});

test('a player can reconnect with their token without repeating a sealed vote', async (t) => {
  const harness = await makeHarness(t);
  const room = await enterLobby(harness);
  const { request, waitFor, states, openPlayer } = harness;
  await beginMatch(harness, room);
  const leaderId = states.get(room.host).leaderId;
  const leader = room.players[room.ids.indexOf(leaderId)];
  assert.equal((await request(leader, 'proposal:submit', { team: room.ids.slice(0, 2) })).ok, true);
  for (const socket of room.players) await waitFor(socket, (state) => state.phase === 'voting', 'team vote');
  assert.equal((await request(room.host, 'vote:submit', { approve: true })).ok, true);
  room.host.disconnect();
  await Promise.all(room.players.slice(1).map((socket) => waitFor(socket, (state) => state.players.find((player) => player.id === room.ids[0])?.connected === false, 'disconnect state')));

  const replacement = await openPlayer();
  assert.equal((await request(replacement, 'room:resume', room.credentials[0])).ok, true);
  const resumed = await waitFor(replacement, (state) => state.phase === 'voting' && state.you.hasVoted, 'restored sealed vote');
  assert.equal(resumed.players.find((player) => player.id === room.ids[0]).connected, true);
  assert.equal((await request(replacement, 'vote:submit', { approve: true })).ok, false, 'a reconnect does not duplicate the vote');
});

test('five rejected proposals fail one mission and advance the game', async (t) => {
  const harness = await makeHarness(t);
  const room = await enterLobby(harness);
  const { request, waitFor, states } = harness;
  await beginMatch(harness, room);
  const team = room.ids.slice(0, 2);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const leaderId = states.get(room.host).leaderId;
    const leader = room.players[room.ids.indexOf(leaderId)];
    assert.equal((await request(leader, 'proposal:submit', { team })).ok, true);
    for (const socket of room.players) await waitFor(socket, (state) => state.phase === 'voting', 'proposal vote');
    for (const socket of room.players) assert.equal((await request(socket, 'vote:submit', { approve: false })).ok, true);
    if (attempt < 4) {
      for (const socket of room.players) await waitFor(socket, (state) => state.phase === 'proposal' && state.mission.rejectionCount === attempt + 1, 'rejected proposal');
    }
  }
  const resolved = await Promise.all(room.players.map((socket) => waitFor(socket, (state) => state.phase === 'debrief', 'automatic mission failure')));
  assert.equal(resolved[0].scores.saboteur, 1);
  assert.equal(resolved[0].missionLog[0].reason, 'five-rejections');
  assert.equal(resolved[0].mission.number, 2);
});

test('room chat is synchronized and avatar updates are room-wide without exposing roles', async (t) => {
  const harness = await makeHarness(t);
  const room = await enterLobby(harness);
  const { request, waitFor, states, openPlayer } = harness;
  const outsider = await openPlayer();
  assert.equal((await request(room.host, 'chat:send', { message: 'Ready for the first mission 👀' })).ok, true);
  for (const socket of room.players) await waitFor(socket, (state) => state.chat?.length === 1, 'shared room chat');
  const firstState = states.get(room.host);
  assert.equal(firstState.chat[0].message, 'Ready for the first mission 👀');
  assert.equal(firstState.players.some((player) => 'role' in player), false, 'room chat does not reveal private roles');
  assert.equal((await request(outsider, 'chat:send', { message: 'intrude' })).ok, false, 'chat is limited to room members');
  assert.equal((await request(room.players[1], 'player:profile', { avatar: '🦊' })).ok, true);
  for (const socket of room.players) await waitFor(socket, (state) => state.players.find((player) => player.id === room.ids[1])?.avatar === '🦊', 'room-wide avatar update');
});

test('a player can leave during an operation and remaining players return to a safe lobby', async (t) => {
  const harness = await makeHarness(t);
  const room = await enterLobby(harness);
  const { request, waitFor, states } = harness;
  await beginMatch(harness, room);
  const left = await request(room.players[1], 'room:leave');
  assert.deepEqual({ ok: left.ok, left: left.left, resetMatch: left.resetMatch }, { ok: true, left: true, resetMatch: true });
  assert.equal((await request(room.players[1], 'chat:send', { message: 'I am gone' })).ok, false, 'leaving revokes room actions');
  for (const socket of [room.host, room.players[2]]) {
    const lobby = await waitFor(socket, (state) => state.phase === 'lobby' && state.matchAbandoned, 'abandoned match reset');
    assert.equal(lobby.players.length, 2);
    assert.equal(lobby.players.some((player) => player.id === room.ids[1]), false);
    assert.equal(lobby.players.some((player) => 'role' in player), false, 'reset clears secret roles');
    assert.equal(lobby.scores.loyal, 0);
    assert.equal(lobby.scores.saboteur, 0);
  }
});

test('the last player can leave and removes the empty room', async (t) => {
  const harness = await makeHarness(t);
  const player = await harness.openPlayer();
  const room = await harness.request(player, 'room:create', { name: 'Aster' });
  assert.equal(room.ok, true);
  assert.equal((await harness.request(player, 'room:leave')).ok, true);
  const resumed = await harness.request(player, 'room:resume', room);
  assert.equal(resumed.ok, false);
  assert.match(resumed.error, /Room not found/);
});

test('a socket cannot claim seats in multiple rooms', async (t) => {
  const harness = await makeHarness(t);
  const player = await harness.openPlayer();
  const firstRoom = await harness.request(player, 'room:create', { name: 'Aster' });
  const secondPlayer = await harness.openPlayer();
  const secondRoom = await harness.request(secondPlayer, 'room:create', { name: 'Beryl' });
  assert.equal(firstRoom.ok, true);
  assert.equal(secondRoom.ok, true);

  const rejectedJoin = await harness.request(player, 'room:join', { code: secondRoom.code, name: 'Cinder' });
  const rejectedCreate = await harness.request(player, 'room:create', { name: 'Dusk' });
  assert.equal(rejectedJoin.ok, false);
  assert.match(rejectedJoin.error, /Leave your current party/);
  assert.equal(rejectedCreate.ok, false);
  assert.match(rejectedCreate.error, /Leave your current party/);

  assert.equal((await harness.request(player, 'room:leave')).ok, true);
  const joinedAfterLeaving = await harness.request(player, 'room:join', { code: secondRoom.code, name: 'Cinder' });
  assert.equal(joinedAfterLeaving.ok, true);
  const state = await harness.waitFor(secondPlayer, (current) => current.players.length === 2, 'second room after rejoin');
  assert.deepEqual(state.players.map((candidate) => candidate.name), ['Beryl', 'Cinder']);
});

test('a concurrent join survives the final player leaving an empty room', async (t) => {
  const store = new MemoryRoomStore();
  const harness = await makeHarness(t, { store });
  const lastPlayer = await harness.openPlayer();
  const room = await harness.request(lastPlayer, 'room:create', { name: 'Aster' });
  const arrivingPlayer = await harness.openPlayer();
  const deleteRoom = store.delete.bind(store);
  let concurrentJoin;
  store.delete = async (code, expectedRevision) => {
    concurrentJoin = await harness.request(arrivingPlayer, 'room:join', { code, name: 'Beryl' });
    return deleteRoom(code, expectedRevision);
  };

  assert.equal((await harness.request(lastPlayer, 'room:leave')).ok, true);
  assert.equal(concurrentJoin.ok, true);
  assert.equal((await harness.request(arrivingPlayer, 'player:ready', { ready: true })).ok, true);
  const persisted = await store.get(room.code);
  assert.deepEqual(persisted.players.map((player) => player.name), ['Beryl']);
});

