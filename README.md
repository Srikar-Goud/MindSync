# MindSync: The Impostor Protocol

MindSync is a real-time hidden-role mission game for 3–8 players. Each player joins a private room with a share code; the server assigns roles, validates all votes and mission actions, and reveals roles only when a match ends.

New players see a short animated cinematic before entering the room setup. **How to play?** opens a five-scene animated tutorial. Players can select an emoji avatar, chat with everyone in their room, compare room-scoped win records, and adjust sound and motion in **Options**. The five missions each have a distinct stage scene. A reticle cursor and low-volume synthesized sound cues are part of the interface; sound is optional and can be turned off.

## Play loop

1. Create a room or join one with its six-character code. Everyone marks ready.
2. The host starts the match. The server privately assigns one saboteur for 3–5 players or two for 6–8.
3. A rotating leader proposes a mission team. Everyone votes privately; a strict majority approves.
4. After approval, the leader picks one public Intel Fragment: **Ballot Echo** reports how many selected players rejected the approved team, or **Action Trace** reports the sabotage count as 0, 1, or 2+.
5. Selected players act privately. Loyal agents can only support; saboteurs can support or sabotage.
6. The first team to three points wins. Five consecutive rejected proposals fail the current mission. The final reveal includes the full roster, score, mission log, room match history, per-room player records, and rematch controls.

Room chat is visible to everyone in that room. Player roles and secret mission actions remain private. **Leave party** works during every phase; leaving during a live match resets that operation to the lobby for the remaining players so they can invite a replacement and start fairly. Empty rooms are deleted. The leaderboard is scoped to that room and ranks players by completed match wins; there are no accounts or global player records.

Mission team sizes by player count:

| Players | Mission 1 | Mission 2 | Mission 3 | Mission 4 | Mission 5 |
|---:|---:|---:|---:|---:|---:|
| 3 | 2 | 2 | 2 | 2 | 2 |
| 4 | 2 | 2 | 3 | 3 | 3 |
| 5 | 2 | 3 | 2 | 3 | 3 |
| 6 | 2 | 3 | 4 | 3 | 4 |
| 7 | 2 | 3 | 3 | 4 | 4 |
| 8 | 3 | 4 | 4 | 5 | 5 |

Mission 4 requires two sabotage actions to fail for 7–8 players; all other missions require one. Votes tie to reject. Missing votes count as rejects, and missing mission actions count as support. Proposal, vote, Intel, action, and discussion phases have server-side deadlines so an idle player cannot stall a match indefinitely.

## Local development

Requirements: Node.js 20+.

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`; the Express and Socket.IO server runs at `http://localhost:8787`. Two browser tabs use the same live server. Without `MONGODB_URI`, rooms are kept in process memory and are lost on server restart. Copy `.env.example` to `.env` to configure a local database.

Player records and match history are scoped to a room. There are no account-wide stats; clearing the browser's saved player key also removes that device's ability to resume its seat in an active match.

Run the automated rules and multiplayer checks with:

```sh
npm test
npm run build
```

## Deploy to Render

The included `render.yaml` configures a single Node web service that serves both the app and Socket.IO. Render supports WebSocket connections on web services. The free service can sleep after inactivity and may restart; rooms are kept in MongoDB so players can reconnect after a restart. Clients send a small heartbeat while connected so an active room keeps delivering WebSocket traffic.

1. Create a MongoDB Atlas Free cluster and a database user. Add the database connection string as the Render service environment variable `MONGODB_URI`; set `MONGODB_DATABASE` to `mindsync` if desired.
2. In the Render service dashboard, open **Connect → Outbound** and copy that service's region-specific IP ranges. Add those ranges to the Atlas project's IP access list. Render shares these ranges with other services in the same region, so use a dedicated database user with access only to this app's database. Keep the connection string in Render's secret settings; the browser never receives it.
3. Create a remote GitHub repository for this local repository, push the project, and connect it to Render. Choose the repository root as the service root; Render runs `npm ci && npm run build`, then `npm start`.
4. Open the deployed URL on two separate devices, create a room, and play through a match. A successful build alone does not confirm that a public deployment works.

Atlas Free clusters have limited storage and throughput. This configuration is for challenge-scale rooms and match summaries; it is not a claim of production-scale capacity. No public deployment has been made from this workspace.

