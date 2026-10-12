# Existing projects and the next navigation test — 2026-10-12

The target remains the player's own SKLauncher client in All the Mons 1.3.0 (Minecraft 1.21.1, NeoForge 21.1.249). A separate NPC is a different product. These projects provide useful pieces, but none has been demonstrated in this exact modpack.

| Project | Useful part | Fit for this client |
| --- | --- | --- |
| [Baritone v1.11.3](https://github.com/cabaletta/baritone/releases/tag/v1.11.3) and [usage guide](https://github.com/cabaletta/baritone/blob/1.21.4/USAGE.md) | Block-aware pathfinding, `#goto`, `#stop`, supported API | Official NeoForge build covers Minecraft 1.21/1.21.1. Use as a navigation component under Hermes; it does not choose high-level goals. |
| [Minecraft Codex Companion](https://github.com/Hakurei-git/minecraft-codex-companion) | Game-side task execution and verified steps; NeoForge client-player bridge | Promising reference or alternative, but its published installer acceptance covers HMCL, not this SKLauncher instance. A second bridge/runtime would need an isolated compatibility trial. |
| [MineAgent](https://github.com/bingdongni/MineAgent) | Agent loop, tools, pathfinding, survival tasks, memory | NeoForge 1.21.1 is marked experimental; it creates a companion/fake player instead of driving this player. Its docs warn that API keys are saved in plain text. |
| [MCAi](https://github.com/Apocscode/MCAi) | Dependency-aware crafting and repeated-call safeguards | NeoForge 1.21.1 companion entity, not direct control of the player's avatar. Its MIT source can inform later task planning. |
| [Voyager](https://github.com/MineDojo/Voyager) | Skill library, reflection, memory | Research architecture rather than a drop-in mod for this version and modpack. |

## Fastest useful route

1. Load the checked Baritone JAR on the next game launch. The file already copied into the instance is `baritone-standalone-neoforge-1.11.3.jar`; its SHA-1 matches the official `checksums.txt`. Verify the client log and a harmless command before treating compatibility as proven.
2. In the disposable single-player world, test one nearby path and `#stop` through the authenticated client bridge. Confirm that the command stays client-side, movement stops, and the bridge can still read player state. Do not test on the friends' server yet.
3. Expose a narrow Hermes navigation tool: numeric nearby destination only, limited distance and time, no arbitrary chat/command string; read position, health and screen before and after. Add an independent Baritone stop path, because releasing synthetic keys does not necessarily cancel Baritone's own path.
4. Give Hermes one small goal at a time and require it to inspect the result before selecting another tool. Crafting, inventory and mod knowledge can follow once navigation is reliable.

The client option `pauseOnLostFocus` was changed from `true` to `false` using Minecraft's F3+P shortcut. It was verified with the game out of focus: `window.active=false`, `screen.present=false`. A pause opened manually with Escape remains a stop signal; the agent should not dismiss it automatically.
