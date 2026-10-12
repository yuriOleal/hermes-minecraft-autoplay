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

1. The checked Baritone JAR loaded alongside All the Mons after restarting. The client log records Baritone 1.11.3, its Mixin connector, and single-player world cache.
2. In the disposable single-player world, the authenticated bridge submitted `#help`, `#allowBreak false`, `#allowPlace false`, one adjacent `#goto`, and `#stop`. The first manual path moved about 0.55 block, with full health and an `ok canceled` response.
3. The narrow `minecraft_navigate_nearby` MCP tool accepts only integer offsets of at most one block on each X/Z axis. It checks single-player and Baritone settings, observes health and GUI state, stops after a fixed short interval, and refuses a second goal in the same process. A live MCP trial moved about 0.84 block. Hermes then interpreted a one-block-south instruction, called this tool, and called stop; the client log and direct state read confirmed the movement and stop.
4. For unattended use, add an independent Baritone stop path, because releasing synthetic keys does not cancel Baritone's path. Expand task tools and verification before trying collection, crafting or server play.

The client option `pauseOnLostFocus` was changed from `true` to `false` using Minecraft's F3+P shortcut. It was verified with the game out of focus: `window.active=false`, `screen.present=false`. A pause opened manually with Escape remains a stop signal; the agent should not dismiss it automatically.
