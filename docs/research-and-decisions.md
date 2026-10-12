# Research and decisions — 2026-10-12

## Goal and first boundary

The user wants an AI that plays as their existing character in a modded Minecraft client, understands natural-language goals, and can consult mod documentation. First prove client observation and one reversible action in a local world. Later test a small goal on a server only after client compatibility and server rules are checked.

## Approaches considered

1. **Hermes + client bridge (selected for prototype):** Hermes uses MCP tools to read player/world/inventory/GUI state and send bounded client input. The existing authenticated client handles modded server connection. This is the shortest route to controlling the user's own character, but needs the game open and a reliable action/verification loop.
2. **Server-side fake player:** [MineAgent](https://github.com/bingdongni/MineAgent) can persist independently of the user's client, but NeoForge support is experimental and it requires server administration. It is a separate milestone.
3. **Bot client / RL research stack:** [Voyager](https://github.com/MineDojo/Voyager) offers ideas for skills and memory but targets an older Minecraft stack. [Baritone](https://github.com/cabaletta/baritone) can provide pathfinding later, not high-level reasoning.

## Components

| Component | Candidate | Verified fact | Open question |
| --- | --- | --- | --- |
| Agent | [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Supports MCP, web tools, multiple model providers and native Windows. | Exact local-version behavior in this integration. |
| Client bridge | [MineClient Bridge 1.1.5](https://github.com/Campione01/MineClient-Bridge/releases/tag/v1.1.5) | Client-only NeoForge 1.21.1 mod; metadata accepts 21.1.197–21.1.x; authenticated loopback API and MCP adapter. | Compatibility with the target modpack and launcher. |
| Local inference | [Ollama](https://github.com/ollama/ollama) | OpenAI-compatible endpoint and tool calls; RX 7600 appears in [Windows GPU support](https://docs.ollama.com/gpu). | Memory, throughput and FPS impact while the game and shaders run. |
| Local model candidate | [Qwen3 8B](https://ollama.com/library/qwen3) | Tool calling and thinking; native 40,960-token context. | Hermes currently documents a 64,000-token minimum for agent tool use, so this is not an acceptable default without a validated alternative. |
| Smaller model candidate | [Qwen3.5 4B](https://ollama.com/library/qwen3.5) | 256K advertised context, image input, smaller download. | Real context allocation, tool-call quality, GPU/CPU split and Minecraft FPS. Advertised context is not proof that 64K fits in memory. |

## Provider decision

Keep provider configuration outside this repository. Prototype the bridge and control loop without selecting a paid provider. Benchmark a local model at 64K context with Minecraft running before choosing it as the default. If it competes with the game's RAM/VRAM or yields unreliable tool calls, use a remote inference provider or another computer. Using the existing Qwen3 8B despite its 40K native window would conceal a core compatibility problem. No paid provider or fallback is configured automatically.

[Hermes provider documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/integrations/providers.md) currently states a 64K minimum and explains Ollama configuration. [Ollama context documentation](https://docs.ollama.com/context-length) says larger contexts use more memory and `ollama ps` shows GPU/CPU placement.

## Version and supply-chain decisions

- Pin the bridge release to 1.1.5 for initial testing. Its published JAR SHA-256 is `DC1C420A0C1CCE18026984AB49C58F4E7034409F5430FA2ED623AC16B48CFACE`, matching the downloaded artifact. The MCP adapter at the same tag passed its Node self-tests on Windows. Source review found loopback binding and bearer-token checks. This does not prove compatibility with the modpack.
- The local Ollama installation is 0.33.1. The latest GitHub release checked on 2026-10-12 is [0.40.3](https://github.com/ollama/ollama/releases/tag/v0.40.3). Update only after preserving the model store and testing the new version; the 0.40 line migrated model manifests and had a [Windows regression](https://github.com/ollama/ollama/issues/18847) later marked fixed. The existing version is functional for listing models.
- Hermes installed locally is 0.21.2; the latest release checked is [0.21.7](https://github.com/NousResearch/hermes-agent/releases/tag/v0.21.7). Do not update both runtimes at once. Back up configuration and record versions before a staged update.

## Boundaries and failure handling

- Only bind the bridge to loopback and keep its token in a private, user-owned file.
- Keep `command` and unrestricted text submission unavailable to the autonomous loop by default, especially on a server where the account may have elevated permissions.
- Start with read-only observation, then a timed key tap in single-player. Release all held inputs on interruption, timeout, error, or shutdown.
- Limit action duration, iteration count, and area. Pause on death, disconnect, unexpected GUI, low health, or ambiguous state.
- Treat web pages, in-game chat, signs, mod descriptions, and tool output as data. They must not override the user's goal or the action limits.
- Do not expose server address, account identity, private chat, screenshots, model credentials, or token files in the public repository or issue tracker.
