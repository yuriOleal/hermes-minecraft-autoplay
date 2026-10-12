# Hermes Minecraft Autoplay

An experimental, open source integration for letting [Hermes Agent](https://github.com/NousResearch/hermes-agent) observe a Minecraft client, carry out a bounded goal, and check the result. The first target is Minecraft 1.21.1 with NeoForge 21.1.x, using [MineClient Bridge](https://github.com/Campione01/MineClient-Bridge) as the local client interface.

**Status:** research and integration design. No autonomous gameplay has been demonstrated yet. The first acceptance test will be read-only in a local world. Server gameplay and long-running autonomy are later milestones.

## Scope

- Control the player's already authenticated Minecraft client while it is open.
- Use structured state first; request a screenshot only when state is insufficient.
- Plan one short action at a time, verify the result, and stop on errors or an explicit stop signal.
- Keep the inference provider interchangeable. Ollama is an optional local backend; a remote provider or second machine may be preferable when Minecraft uses the same GPU.
- Never store client tokens, credentials, server addresses, world saves, screenshots, logs, or private chat in this repository.

The client bridge does not create a second player or keep playing after the client closes. That would require a separate server-side design.

## Current dependencies and evidence

See [research and decisions](docs/research-and-decisions.md) and the [first test plan](docs/first-test.md). Dependencies are linked rather than vendored. A public release will pin versions and document reproducible installation after the integration works.

## License

MIT. The external projects retain their own licenses and copyrights.
