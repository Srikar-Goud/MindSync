# MindSync: The Impostor Protocol

MindSync is a real-time hidden-role mission game for 3–8 players. Each player joins a private room with a share code; the server assigns roles, validates all votes and mission actions, and reveals roles only when a match ends.

New players see a short animated cinematic before entering the room setup. **How to play?** opens a five-scene animated tutorial. Players can select an emoji avatar, chat with everyone in their room, compare room-scoped win records, and adjust sound and motion in **Options**. The five missions each have a distinct stage scene. A reticle cursor and low-volume synthesized sound cues are part of the interface; sound is optional and can be turned off.

The room now includes an interactive React Three Fiber crew deck. Players appear as animated low-poly astronauts, can walk with WASD or arrow keys, drag to look around, customize suit/helmet/backpack, and send room-only **ECHO SIGNALS**. On touch layouts, a directional pad appears. Movement is validated and relayed by the existing Socket.IO server, and remote characters are interpolated on each client. Press **E** near a mission console to jump to the existing phase controls; mission actions, votes, and outcomes remain server-authoritative through the original game flow.

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
```

Start the app with in-memory rooms for local development. This overrides any `MONGODB_URI` in `.env` for the current shell, keeping the dev server away from the production database:

```powershell
$env:MONGODB_URI = ''
npm run dev
```

The web app runs at `http://localhost:5173`; Express and Socket.IO run at `http://localhost:8787`. Open two browser sessions in the same room to check shared customization, movement, and Echo Signals. Rooms are lost when the local server restarts. Set a local development database URI only when you intentionally want persistent local rooms.

For a Unix shell, use `MONGODB_URI= npm run dev` instead. Do not copy production credentials into a local `.env`.

Player records and match history are scoped to a room. There are no account-wide stats; clearing the browser's saved player key also removes that device's ability to resume its seat in an active match.

Run the automated rules and multiplayer checks with:

```sh
npm test
npm run build
```

## Deployment

The current all-in-one game is available at <https://mindsync-knm6.onrender.com/>. Its Render web service serves the Vite build, Express API, and Socket.IO from the repository root. The included `render.yaml` keeps the service configuration in source control.

The Netlify production demo is available at <https://mindsync-handshake.netlify.app/>. Its Vite frontend connects directly to `https://mindsync-knm6.onrender.com` using Socket.IO over WebSocket; Express, room state, and MongoDB remain on Render. Netlify's static host does not run the persistent Socket.IO server. Do not put the MongoDB URI or other server secrets in Netlify's `VITE_*` variables because those values are included in browser JavaScript.

Netlify uses `npm run build` and publishes `dist`. For a manual deploy, install the Netlify CLI and run `netlify deploy --prod --dir=dist` from the project root after building. The `.netlify` folder is ignored by Git because the CLI stores local site linkage there.

To create another deployment from this repository:

1. Connect `https://github.com/Srikar-Goud/MindSync` to Render and apply the repository's Blueprint (`render.yaml`). Keep the service root at the repository root.
2. Add `MONGODB_URI` as a secret environment variable and set `MONGODB_DATABASE=mindsync`. Never put the connection string in Git or the browser bundle.
3. In the Render service dashboard, open **Connect → Outbound** and add that service's region-specific IP ranges to the Atlas project's IP access list. Render shares these ranges with other services in the same region; use a database user restricted to this app's database.
4. The Blueprint builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and checks `/health`. Verify the public URL and connect from two separate devices before hosting a match.

The Render Free web service can spin down after inactivity and take about a minute to wake. It is intended for demonstrations and hobby use, not always-on production traffic. The current game server keeps socket membership and phase timers in process memory, so run one instance; horizontal scaling requires a shared Socket.IO adapter and coordinated timer ownership. Atlas Free clusters also have limited storage and throughput, so this configuration is for challenge-scale rooms and match summaries.

