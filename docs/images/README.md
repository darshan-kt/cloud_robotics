# docs/images/

**Purpose:** every diagram and screen recording referenced from the docs, in one place, so they're easy to find, regenerate, or replace.

## Diagrams (PNG)

Rendered from real Mermaid source via a headless Chrome (`mermaid.js` from CDN, screenshotted) — the same diagram language already used inline in `docs/00-overview.md` and `docs/11-aws-migration.md`, exported as standalone images for docs that want a picture without a live Mermaid-capable renderer. Every diagram describes the system **as it actually is** as of the LiDAR feature (post-Milestone-11) — not aspirational.

| File | Shows | Referenced from |
|---|---|---|
| `architecture-overview.png` | The whole system: two containers, every service, both data paths (control over MQTT, video over WebRTC) | [`00-overview.md`](../00-overview.md) |
| `command-path.png` | Sequence diagram: a teleop command's full round trip, browser to wheels and back as telemetry | [`00-overview.md`](../00-overview.md) |
| `video-path.png` | Sequence diagram: the WebRTC offer/answer signalling flow and where media actually flows | [`00-overview.md`](../00-overview.md), [`08-webrtc-signalling.md`](../08-webrtc-signalling.md) |
| `mqtt-topic-acl.png` | Every MQTT topic plus the ACL boundary enforcing who can read/write each one | [`03-mqtt-layer.md`](../03-mqtt-layer.md) |
| `topic-name-mapping.png` | The same piece of data's three names as it crosses layers (ROS2 topic → MQTT topic → REST/WS field) | [`configuration-reference.md`](../configuration-reference.md) |
| `repo-layout.png` | Folder structure of both containers | [`01-repository-structure.md`](../01-repository-structure.md) |
| `milestone-roadmap.png` | All 11 milestones plus the post-Milestone-11 LiDAR addition, in build order | root [`README.md`](../../README.md) |
| `aws-topology.png` | Target AWS topology - the same boxes as `architecture-overview.png`, mapped onto real AWS services | [`11-aws-migration.md`](../11-aws-migration.md) |

## Screen recordings (GIF)

Real captures of the actual running stack - not mockups. `terminal-startup.gif` replays real, previously-captured `docker compose` output and `curl` responses (not live-typed at record time, since a real `docker compose up` takes minutes; the content itself is genuine, captured from this project's own terminal). `web-console-walkthrough.gif` is a real Playwright session driving the real frontend against the real running backend/robot - login, live dashboard, connected WebRTC video, a populated LiDAR panel, and an actual teleop command reaching the robot (visible as the arrow button lighting up).

| File | Shows | Referenced from |
|---|---|---|
| `terminal-startup.gif` | `docker compose up` → real service logs → `docker compose ps` → real `/metrics` output | root [`README.md`](../../README.md) |
| `web-console-walkthrough.gif` | Login → Dashboard → Robot page (live camera + LiDAR) → Take control → drive → Health page | root [`README.md`](../../README.md), [`09-frontend.md`](../09-frontend.md) |

## Regenerating these

Nothing here is hand-drawn - every diagram is Mermaid source rendered by a script, and every GIF is a real Playwright recording converted with `ffmpeg`. None of the generation scripts are checked into this repo (they're one-off tooling, not part of the running system) - to regenerate:

- **Diagrams**: write/edit a `.mmd` (Mermaid) file, render it with a headless-Chrome + `mermaid.js`-from-CDN script (screenshot the rendered `<svg>`), same approach as this project's own live verification scripts throughout `docs/*.md`.
- **GIFs**: record a real session with Playwright's `record_video_dir` context option (terminal: an HTML/CSS terminal replaying real captured output; web console: Playwright actually driving the real app), then `ffmpeg -vf "fps=…,scale=…,palettegen"` + `paletteuse` to convert the `.webm` to a compact GIF.
