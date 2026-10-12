# First vertical test

## Acceptance criteria

1. Preserve the original instance state and record the bridge JAR hash.
2. Install the pinned client-only bridge; launch the existing client and confirm it reaches the title screen without a mod loading error.
3. Register the running client with the MCP adapter using a private token path. Query bridge status, player state and a framebuffer. Do not send input.
4. In an expendable single-player world, ask the agent to turn the camera a small fixed amount, then query state again. Verify the observed yaw changed as requested.
5. Interrupt a held-input test and confirm `release_all` leaves no key held. Confirm an explicit stop prevents further actions.
6. Compare game FPS and frame time with bridge idle and during inference. Record `ollama ps` and system RAM/VRAM pressure for any local-model trial.

## Verification and security

- Run MCP self-tests from the pinned source and verify the JAR hash before installation.
- Ensure the bridge binds only to `127.0.0.1` and rejects unauthenticated access. Never log or commit the token.
- Validate tool arguments with allow-lists and bounded values. Do not grant shell or arbitrary Minecraft command access to the autonomous loop.
- Time out input, release all held controls on failure, and stop on disconnection or unexpected world state.
- Inspect the Git diff for secrets and private paths before a public push.

## Gate to server trial

Only after the local-world test passes: confirm the server's automation rules with its administrator, choose a harmless bounded task, and test while the user can observe and stop the client. A persistent second player remains a separate project.
