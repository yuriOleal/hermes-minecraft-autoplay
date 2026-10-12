# Hermes Minecraft Autoplay

An experimental, open source integration for letting [Hermes Agent](https://github.com/NousResearch/hermes-agent) observe a Minecraft client, carry out a bounded goal, and check the result. The first target is Minecraft 1.21.1 with NeoForge 21.1.x, using [MineClient Bridge](https://github.com/Campione01/MineClient-Bridge) as the local client interface.

**Status:** the read-only MCP adapter passed both its protocol/authentication test and a live observation test in the target modpack while the client was on a server. No input or autonomous gameplay has been demonstrated. Controlled action testing in a disposable single-player world is next; server gameplay and long-running autonomy are later milestones.

## Scope

- Control the player's already authenticated Minecraft client while it is open.
- Use structured state first; request a screenshot only when state is insufficient.
- Plan one short action at a time, verify the result, and stop on errors or an explicit stop signal.
- Keep the inference provider interchangeable. Ollama is an optional local backend; a remote provider or second machine may be preferable when Minecraft uses the same GPU.
- Never store client tokens, credentials, server addresses, world saves, screenshots, logs, or private chat in this repository.

The client bridge does not create a second player or keep playing after the client closes. That would require a separate server-side design.

## Current dependencies and evidence

See [research and decisions](docs/research-and-decisions.md) and the [first test plan](docs/first-test.md). Dependencies are linked rather than vendored. A tagged release will pin versions and document reproducible installation after the integration works.

## Read-only adapter

`mcp/read-only-server.mjs` is a dependency-free Node.js 20+ MCP server. It connects to MineClient Bridge on numeric loopback and offers four observation tools: `minecraft_status`, `minecraft_state`, `minecraft_screen`, and `minecraft_frame`. It has no input, chat, command, filesystem, or process-control tool.

Set `MINECRAFT_BRIDGE_TOKEN_FILE` to the private token file created by the mod and optionally `MINECRAFT_BRIDGE_URL` to its loopback origin. Keep the token and any Hermes config containing the private path outside Git. Run `node --test test/read-only-server.test.mjs` to check the adapter without launching Minecraft. The live observation test succeeded on 2026-10-12; details are in [research and decisions](docs/research-and-decisions.md).

## License

MIT. The external projects retain their own licenses and copyrights.
