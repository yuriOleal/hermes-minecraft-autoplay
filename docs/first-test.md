# First vertical test

## Acceptance criteria

1. Preserve the original instance state and record the bridge JAR hash.
2. Install the pinned client-only bridge; launch the existing client and confirm it reaches an active world without a mod loading error.
3. Let the mod create its private token file. Point the read-only MCP adapter at that path without copying the token into the repository. Query bridge status, player state and a framebuffer. Do not send input. This observation passed on 2026-10-12 while the player was on the server.
4. In an expendable single-player world, turn the camera a small fixed amount, then query state again. Verify the observed yaw changed as requested. A manual 3-degree turn, a bounded MCP 2-degree turn and a Hermes-controlled online 2-degree turn passed on 2026-10-12. The agent followed an explicit target angle; independent goal selection remains untested.
5. Confirm an explicit stop prevents further actions and releases any held synthetic input. The bounded adapter passed this check on 2026-10-12. A 100 ms forward input moved the player about 0.25 block in the disposable single-player world; the input was released, with an independent delayed release watchdog as backup.
6. Compare game FPS and frame time with bridge idle and during inference. Record `ollama ps` and system RAM/VRAM pressure for any local-model trial.

On 2026-10-12, Baritone 1.11.3 loaded with the target modpack. A manual bridge call and then a Hermes-selected `minecraft_navigate_nearby` call each navigated to an adjacent block and sent `#stop`. The Hermes trial moved about 0.84 block, with full health, no open GUI and no held bridge inputs afterward. This demonstrates one attended natural-language navigation goal, not sustained autonomous play.

## Verification and security

- Run MCP self-tests from the pinned source and verify the JAR hash before installation.
- Ensure the bridge binds only to `127.0.0.1` and rejects unauthenticated access. Never log or commit the token.
- Validate tool arguments with allow-lists and bounded values. Do not grant shell or arbitrary Minecraft command access to the autonomous loop.
- Time out input, release all held controls on failure, and stop on disconnection or unexpected world state.
- Inspect the Git diff for secrets and private paths before a public push.

## Gate to server trial

Only after the local-world test passes: confirm the server's automation rules with its administrator, choose a harmless bounded task, and test while the user can observe and stop the client. A persistent second player remains a separate project.

## Next single-player milestone

Extract a small local obstacle and hazard view, then let the model choose at most one short action for a harmless goal. Check the observed result and stop on missing data, damage, unexpected screens, or a session change. Add broader movement, inventory and crafting only after that loop works reliably. The current forward tool is a manual control proof, not permission for autonomous navigation.
