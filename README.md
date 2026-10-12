# Hermes Minecraft Autoplay

An experimental, open source integration for letting [Hermes Agent](https://github.com/NousResearch/hermes-agent) observe a Minecraft client, carry out a bounded goal, and check the result. The first target is Minecraft 1.21.1 with NeoForge 21.1.x, using [MineClient Bridge](https://github.com/Campione01/MineClient-Bridge) as the local client interface.

**Status:** the read-only MCP adapter passed its protocol/authentication test and a live observation test in the target modpack. In a disposable single-player world, Hermes Agent using an online NVIDIA Nemotron model called the observation, bounded camera-turn, and stop tools. The turn was 2 degrees and was verified against the game state. A separate manual MCP test advanced the player about 0.25 block with a 100 ms forward input and verified release. Long-running autonomous gameplay and server actions have not been demonstrated.

## Scope

- Control the player's already authenticated Minecraft client while it is open.
- Use structured state first; request a screenshot only when state is insufficient.
- Plan one short action at a time, verify the result, and stop on errors or an explicit stop signal.
- Keep the inference provider interchangeable. Ollama is an optional local backend; a remote provider or second machine may be preferable when Minecraft uses the same GPU.
- Never store client tokens, credentials, server addresses, world saves, screenshots, logs, or private chat in this repository.

The client bridge does not create a second player or keep playing after the client closes. That would require a separate server-side design.

## Current dependencies and evidence

See [research and decisions](docs/research-and-decisions.md), [existing projects and navigation plan](docs/existing-projects.md), the [first test plan](docs/first-test.md), and [online inference](docs/online-inference.md). Dependencies are linked rather than vendored. A tagged release will pin versions and document reproducible installation after the integration works.

## Read-only adapter

`mcp/read-only-server.mjs` is a dependency-free Node.js 20+ MCP server. It connects to MineClient Bridge on numeric loopback and offers four observation tools: `minecraft_status`, `minecraft_state`, `minecraft_screen`, and `minecraft_frame`. The status and state results use allow-lists that remove account name, UUID and local runtime identifiers. Screen and frame can contain private content, so the online profile used in the first AI test selected only status and state. It has no input, chat, command, filesystem, or process-control tool.

Set `MINECRAFT_BRIDGE_TOKEN_FILE` to the private token file created by the mod and optionally `MINECRAFT_BRIDGE_URL` to its loopback origin. Keep the token and any Hermes config containing the private path outside Git. Run `node --test test/read-only-server.test.mjs` to check the adapter without launching Minecraft. The live observation test succeeded on 2026-10-12; details are in [research and decisions](docs/research-and-decisions.md).

## Bounded single-player control

`mcp/bounded-control-server.mjs` is a separate MCP server for single-player experiments. It exposes `minecraft_look` (at most 5 degrees per axis per call), `minecraft_step_forward` (50–200 ms of forward input), and `minecraft_stop` (releases inputs and disables further actions in that process). It reads the local client log before each action to require the latest connection marker to be an integrated single-player server, checks the current player and GUI state, and verifies the result afterward. Movement requires an unpaused world. The forward tool starts a separate release watchdog before pressing the key and releases all synthetic inputs in its own cleanup path. It does not expose mouse clicks, chat, commands, or a general input endpoint. The log check is a prototype safeguard; it is not a hard guarantee against a session switch between checks.

This adapter is disabled unless `MINECRAFT_ENABLE_SINGLEPLAYER_CONTROL=1` is set. It also needs `MINECRAFT_BRIDGE_TOKEN_FILE` and `MINECRAFT_CLIENT_LOG_FILE` pointed at private files outside Git. The tested isolated Hermes profile has the adapter registered with control disabled after the trial. Run `node --test test/bounded-control-server.test.mjs` to check the controls against a fake local bridge. The live single-player camera turn and 100 ms forward step passed on 2026-10-12. The model has not been given the forward tool: safe autonomous movement still needs obstacle and hazard perception plus a bounded observe–act–verify loop.

## License

MIT. The external projects retain their own licenses and copyrights.
