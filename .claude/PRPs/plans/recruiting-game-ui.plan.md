# PRP: 8-bit Recruiting Arena UI

## Purpose

Render the recruiting loop as a fast, legible 8-bit game without moving any business logic into the browser. Judges should understand identity, action, authorization, evidence, learning, and final effect within seconds.

## Branch and ownership

- Branch: `codex/recruiting-game-ui`
- Base: frozen recruiting-contract SHA and golden recruiting fixture.
- Owns: `public/**`, `assets/sprites/**`, UI-specific tests.
- Must not edit: `src/domain/**`, engine/adapters, `src/main.ts`, `src/config.ts`, `compose.yaml`, package manifests.

The UI may import or consume serialized `GameEvent` contracts but does not own the event schema.

## User experience

### Core screen

Use one 16:9 viewport-safe arena:

- top status strip: episode objective, mode (`fake | recorded | live`), turn, loop phase, Pomerium health, Zero budget, Fillmore state;
- left lane: red candidate sprite, current technique, score table, memory;
- center lane: recruiting pipeline/office stage, candidate card, calendar gate, visible outcome;
- right lane: white verifier + hiring controller, evidence cards, regression memory;
- bottom: ordered turn rail and compact event/log trace;
- prominent Pomerium gate between the sourcer/controller and scheduling tool.

### Visual grammar

- 32×32 or 48×48 pixel sprites; integer scaling only.
- Red/coral: untrusted candidate attempts.
- Amber: request/pending/uncertain.
- Pomerium blue: identity authorization boundary.
- Zero violet: capability discovery/purchase.
- Fillmore green: recruiting side effect.
- White/cyan: verifier learning and regression.
- Denial animation: sourcer bounces off the gate and the calendar stays locked.
- Allow animation: controller identity badge passes the same gate; calendar receives one `[HACKATHON TEST]` event.

Avoid tiny dashboard text. The main action/result must remain readable from the back of a presentation room.

## Event-driven renderer

The browser holds only a presentation reducer:

```text
server GameEvent -> validate -> append trace -> reduce visual state -> animate cue
```

It must not infer the next turn, call sponsor tools, mutate agent memory, or manufacture authorization decisions. On reconnect, it requests a snapshot plus `lastSequence` and resumes from the next event.

Use the golden fixture for independent development. The exact same reducer must accept the live SSE/WebSocket stream later.

## Required visual cues

Map frozen event kinds to explicit cues, including:

- episode/pipeline initialized;
- candidate attack emitted;
- schedule requested;
- Pomerium denied;
- verifier diagnosed;
- Zero discovery started/completed;
- capability invoked/evidence created;
- regression stored;
- controller authorized;
- Fillmore screen scheduled;
- mutated replay blocked;
- red/white memory updated;
- episode completed/error.

Unknown event kinds render as a safe “unrecognized event” trace entry and do not crash the arena.

## Assets

Create original pixel art for:

- red candidate / social engineer;
- Fillmore sourcer robot;
- white verifier;
- hiring controller;
- Pomerium gate/shield;
- Zero capability portal/shop;
- calendar, evidence scroll, regression book, locked/unlocked icons;
- simple office/castle-inspired recruiting arena tiles.

Do not use copyrighted movie characters or logos as character art. Product names/logos may appear as integration labels in accordance with sponsor brand guidance, but the game characters should be original.

Provide sprite sheets plus a manifest:

```json
{
  "red-candidate": { "idle": [0, 0], "attack": [1, 0], "blocked": [2, 0] }
}
```

Use CSS `image-rendering: pixelated` and respect `prefers-reduced-motion`.

## Files

- `public/index.html`: semantic shell and live-region status.
- `public/styles.css`: pixel design system and responsive layout.
- `public/app.js`: connection, validation boundary, presentation reducer, controls.
- `public/replay.js`: golden-fixture playback only.
- `public/assets/sprites/*.png`: original sheets.
- `public/assets/sprites/manifest.json`: coordinates/states.
- `public/assets/fonts/**`: only redistributable font assets, or use a system monospace stack.
- `tests/ui/reducer.test.ts`: fixture-to-visual-state tests.
- `tests/ui/accessibility.test.ts`: keyboard/status semantics.

If TypeScript bundling is not yet owned by this branch, keep browser modules standards-compliant and dependency-free; the pipeline branch can add build tooling later.

## Controls

- `Play/Pause`.
- `Next event` for presenter recovery.
- `Restart episode` in fake/recorded mode.
- speed selector for rehearsal, locked to a sensible demo default.
- `Show proof` panel displaying sanitized Pomerium request ID, Zero capability/invocation ID, Fillmore operation ID, and event hash.

Controls never change outcomes. In live mode, restart requires a new server episode; the UI cannot rewind external actions.

## Implementation tasks

1. Build a static renderer against `fixtures/recruiting-contract-events.json`.
2. Implement presentation reducer keyed only by event kind/payload.
3. Establish pixel palette, spacing, typography, and integer sprite scale.
4. Create the original sprite set and manifest.
5. Implement all Turn 0–8 cues and the same-tool deny/allow gate animation.
6. Implement ordered trace and evidence/provenance drawer.
7. Add fake/recorded/live mode badge and connection state.
8. Add SSE reconnection contract (`lastSequence`) without hardcoding the server URL.
9. Add responsive behavior for 1280×720 and 1920×1080.
10. Add keyboard, reduced-motion, contrast, and screen-reader status support.

## Edge cases

- Duplicate event sequence is ignored idempotently.
- Sequence gap pauses animation and requests a snapshot.
- Reconnect does not replay already-rendered animations.
- Long summary text truncates visually but remains available in proof/trace detail.
- Missing sprite falls back to a labeled pixel placeholder.
- Unknown event does not block later known events.
- Error event clearly stops autoplay and presents recovery.
- `recorded` cannot appear as `live` even if event provenance contains live-like IDs.
- Animation state is derived from event sequence, so pausing mid-cue resumes consistently.

## Tests

- golden fixture reaches the expected terminal visual state;
- Turn 3 shows sourcer denied and locked calendar;
- Turn 6/7 shows controller allowed and one screening event;
- Turn 8 shows replay blocked and both memory panels updated;
- all event kinds have an explicit cue or safe fallback;
- duplicate/gapped/out-of-order sequences are handled correctly;
- mode badge is always visible;
- keyboard controls work without pointer input;
- reduced-motion removes movement but preserves state changes;
- no horizontal/vertical overflow at 1280×720 and 1920×1080;
- event summaries and status changes are available to assistive technology.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- tests/ui
```

Manual checks:

- run the entire fixture at presentation speed in under 150 seconds;
- view from several meters away or at 50% zoom;
- throttle/reconnect the event stream;
- verify exact deny/allow proof IDs in the proof drawer;
- verify reduced-motion mode.

## Acceptance criteria

- The full story is understandable without reading raw logs.
- The Pomerium same-tool deny/allow moment is visually unmistakable.
- Zero discovery and Fillmore scheduling each have distinct provenance-bearing cues.
- The renderer uses only `GameEvent`; it contains no engine state machine.
- Golden replay and live stream produce the same final visual state.
- Original 8-bit assets render cleanly at both target resolutions.

## Handoff to pipeline

Provide the static public directory, expected event-stream URL shape, snapshot/reconnect behavior, proof fields used, and the command/test needed to play the golden fixture. The pipeline branch serves the assets and supplies real events; it must not reimplement the UI reducer.
