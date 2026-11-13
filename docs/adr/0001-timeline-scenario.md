# Timeline scenarios live inside the diagram document

The timeline demo is stored as `doc.timeline` (events, changes, core tables) instead of a separate scenario file, playback renders table values through a runtime overlay that never mutates node data, and pruning happens inside the app before a JSON export; `.md` exports stay timeline-free. We chose document-owned scripts so switching/duplicating/backing-up a diagram carries its demo, and the overlay keeps playback out of the undo stack, saved data, and Mermaid output.

## Considered Options

- Standalone scenario files referenced by documents: more reusable, but broken references and sync work for a feature tied to one diagram's nodes.
- Writing values back into node fields during playback: simplest rendering, but pollutes saves, undo history, and exports.
- Exporting the timeline into `.md`: complete round-trip, but `.md` is the AI-facing diagram artifact and would grow with presentation data.

## Consequences

- Playback state is ephemeral store state, so undo/redo never replays frames.
- Exporting the scenario JSON only includes 核心表 changes after 裁剪; re-importing is the migration path.
- `.md` consumers see no timeline; scenarios travel via the full backup or the scenario JSON.
