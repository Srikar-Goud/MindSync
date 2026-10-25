import test from 'node:test';
import assert from 'node:assert/strict';
import { createLobby, publicState, roleCounts, sabotageThreshold, startMatch, teamSize } from '../server/game.js';

test('role counts support every room size from three to eight', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(roleCounts), [1, 1, 1, 2, 2, 2]);
});

test('mission teams match the published player-count table', () => {
  const expected = {
    3: [2, 2, 2, 2, 2],
    4: [2, 2, 3, 3, 3],
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
  };
  for (const [count, sizes] of Object.entries(expected)) {
    assert.deepEqual([0, 1, 2, 3, 4].map((index) => teamSize(Number(count), index)), sizes);
  }
});

test('only Mission 4 at 7–8 players needs two sabotage actions', () => {
  assert.equal(sabotageThreshold(7, 3), 2);
  assert.equal(sabotageThreshold(8, 3), 2);
  assert.equal(sabotageThreshold(6, 3), 1);
  assert.equal(sabotageThreshold(8, 2), 1);
});

test('roles are assigned in the approved counts when a match starts', () => {
  for (const count of [3, 4, 5, 6, 7, 8]) {
    const players = Array.from({ length: count }, (_, index) => ({
      id: `p${index}`, tokenHash: `secret-${index}`, name: `Player ${index}`,
      role: null, ready: true, connected: true, wins: 0, matchesPlayed: 0, rematchReady: false,
    }));
    const room = { ...createLobby({ code: 'ABC234', playerId: 'p0', token: 'a'.repeat(44), name: 'Player 0' }), players };
    const started = startMatch(room, 100, 1_000);
    assert.equal(started.players.filter((player) => player.role === 'saboteur').length, roleCounts(count));
    assert.equal(started.players.filter((player) => player.role === 'agent').length, count - roleCounts(count));
  }
});

test('public state keeps other players’ roles and secrets private until the final reveal', () => {
  const players = [
    { id: 'a', tokenHash: 'token-hash-a', name: 'Aster', role: 'agent', ready: true, connected: true, wins: 0, matchesPlayed: 0, rematchReady: false },
    { id: 'b', tokenHash: 'token-hash-b', name: 'Beryl', role: 'saboteur', ready: true, connected: true, wins: 0, matchesPlayed: 0, rematchReady: false },
    { id: 'c', tokenHash: 'token-hash-c', name: 'Cinder', role: 'agent', ready: true, connected: true, wins: 0, matchesPlayed: 0, rematchReady: false },
  ];
  const room = {
    code: 'ABC234', phase: 'action', hostId: 'a', players,
    revision: 0, matchNumber: 1, leaderIndex: 0, missionIndex: 0,
    scores: { loyal: 0, saboteur: 0 }, rejectionCount: 0,
    currentProposal: { leaderId: 'a', team: ['a', 'b'], votes: { a: { choice: true } } },
    currentTeam: ['a', 'b'], selectedIntel: 'ballotEcho', actions: { a: { choice: 'support' } },
    proposalLog: [{ mission: 1, team: ['a', 'b'], votes: { a: { choice: true }, b: { choice: false } }, yes: 1, no: 2, passed: false }],
    missionLog: [{ number: 1, result: 'failure', sabotageCount: 1, fragment: { kind: 'actionTrace', value: '1', text: '1 action' } }],
    phaseDeadline: 500,
  };
  const state = publicState(room, 'a');
  assert.equal(state.you.role, 'agent');
  assert.equal(state.players.some((player) => 'role' in player), false);
  assert.equal(state.players.some((player) => 'tokenHash' in player), false);
  assert.equal(state.proposalLog.some((proposal) => 'votes' in proposal), false);
  assert.equal('sabotageCount' in state.missionLog[0], false);
  assert.equal(JSON.stringify(state).includes('token-hash'), false);

  room.phase = 'finished';
  room.winner = 'loyal';
  assert.equal(publicState(room, 'a').players.find((player) => player.id === 'b').role, 'saboteur');
  assert.equal(publicState(room, 'a').missionLog[0].sabotageCount, 1);
});

