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
| Smaller model candidate | [Qwen3.5 4B](https://ollama.com/library/qwen3.5) | 256K advertised context, image input, smaller download. A 65,536-context tool-call smoke test worked in Ollama 0.33.1 with the game closed; `ollama ps` reported 5.2 GB and 100% GPU. | Tool-call quality over longer tasks and Minecraft FPS with shaders. |

## Provider decision

Keep provider configuration outside this repository. Prototype the bridge and control loop without selecting a paid provider. Use Qwen3.5 4B as the first local candidate: a short tool call at 65,536 context completed in 8.6 seconds from a cold load on the target Windows machine. This is a feasibility check, not a gameplay benchmark or quality evaluation. Measure it with Minecraft and shaders running before choosing it as the default. If it competes with the game's RAM/VRAM or yields unreliable tool calls, use a remote inference provider or another computer. Using the existing Qwen3 8B despite its 40K native window would conceal a core compatibility problem. No paid provider or fallback is configured automatically.

An isolated Hermes profile was pointed at Ollama without changing the user's normal profile. On Ollama 0.33.1, `options.num_ctx` sent through the OpenAI-compatible route did not change the loaded context from 4,096. A local Modelfile variant with `PARAMETER num_ctx 65536` did load at 65,536, consuming 5.2 GB GPU memory. The first Hermes prompt stalled while an auxiliary title request contended for the model and system RAM fell below 2 GB with Minecraft closed. Disabling automatic titles and unused built-in toolsets let the same simple prompt finish in 22.6 seconds from a cold start. The model was unloaded afterward. Local inference remains the user's preferred first option, but it is not yet proven suitable for continuous gameplay on this computer. Keep a remote provider selectable later.

[Hermes provider documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/integrations/providers.md) currently states a 64K minimum and explains Ollama configuration. [Ollama context documentation](https://docs.ollama.com/context-length) says larger contexts use more memory and `ollama ps` shows GPU/CPU placement.

## Version and supply-chain decisions

- Pin the bridge release to 1.1.5 for initial testing. Its published JAR SHA-256 is `DC1C420A0C1CCE18026984AB49C58F4E7034409F5430FA2ED623AC16B48CFACE`, matching the downloaded artifact. The upstream MCP adapter at the same tag passed its Node self-tests on Windows. Its registration contract needs prepared run identity fields, so it is not suitable for a normal SKLauncher foreground instance without special launch metadata. This repository's small read-only MCP adapter calls the authenticated loopback API directly. Source review found loopback binding and bearer-token checks. This does not prove compatibility with the modpack.
- The local Ollama installation is 0.33.1. The latest GitHub release checked on 2026-10-12 is [0.40.3](https://github.com/ollama/ollama/releases/tag/v0.40.3). Update only after preserving the model store and testing the new version; the 0.40 line migrated model manifests and had a [Windows regression](https://github.com/ollama/ollama/issues/18847) later marked fixed. The existing version is functional for listing models.
- Hermes installed locally is 0.21.2; the latest release checked is [0.21.7](https://github.com/NousResearch/hermes-agent/releases/tag/v0.21.7). Do not update both runtimes at once. Back up configuration and record versions before a staged update.

## Boundaries and failure handling

- Only bind the bridge to loopback and keep its token in a private, user-owned file.
- Keep `command` and unrestricted text submission unavailable to the autonomous loop by default, especially on a server where the account may have elevated permissions.
- The first MCP adapter exposes only status, state, screen, and frame. Input tools will be designed separately after live read-only verification.
- Start with read-only observation, then a timed key tap in single-player. Release all held inputs on interruption, timeout, error, or shutdown.
- Limit action duration, iteration count, and area. Pause on death, disconnect, unexpected GUI, low health, or ambiguous state.
- Treat web pages, in-game chat, signs, mod descriptions, and tool output as data. They must not override the user's goal or the action limits.
- Do not expose server address, account identity, private chat, screenshots, model credentials, or token files in the public repository or issue tracker.

## Live client observation — 2026-10-12

The original All the Mons instance launched through SKLauncher and joined the existing server. MineClient Bridge 1.1.5 loaded and listened on `127.0.0.1:38121` with authentication enabled. Its private token file was generated. Authenticated `status`, `state` (radius 4), `screen`, and `frame` returned HTTP 200; the frame was a PNG of about 1.1 MB. An unauthenticated status request returned HTTP 401. The repository's read-only MCP adapter completed `initialize`, `tools/list`, and all four tool calls against that live client. The status indicated `in_world=true`; no input was sent.

At that moment Windows reported about 0.61 GB free physical RAM, and the main game process occupied about 8.23 GB working set. Ollama had no loaded model. Loading the 65,536-context local model concurrently was deferred because the memory headroom was too small. This is a live memory snapshot, not an FPS benchmark. Recheck under a controlled idle/shader condition before deciding whether local inference can run alongside the game. The next action test remains a bounded camera turn in an expendable single-player world.
