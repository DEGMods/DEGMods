# Game Mod Event (Kind 31142)

A game mod is published as a **Nostr addressable replaceable event** with kind `31142`. Because it uses a `d` tag with a UUID v4 identifier, the event can be updated in-place by re-publishing with the same `d` tag — the relay will replace the old version.

---

## Full Example Event

```json
{
  "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "pubkey": "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  "created_at": 1749571201,
  "kind": 31142,
  "content": "# Emerald Nights Reshade - Neon Noir Preset\n\nThis reshade preset transforms Night City into a moody, neon-drenched cyberpunk dreamscape with enhanced lighting, deeper shadows, and vibrant holographic reflections.\n\n## Installation\n\n1. Download and install [ReShade](https://reshade.me/) for Cyberpunk 2077\n2. Extract `EmeraldNights.ini` into your game's reshade-shaders folder\n3. Launch the game, open ReShade overlay (Home key), and select **EmeraldNights** preset\n\n## Compatibility\n\n- Works with Cyberpunk 2077 v2.2 and Phantom Liberty\n- Compatible with CET and Cyber Engine Tweaks mods\n- **Not compatible** with other reshade presets (disable them first)",
  "sig": "f4c2e8a9d3b1c7f5e6a8d2b4c9f1a3e5d7b9c2f4a6e8d1b3c5f7a9e2d4b6c8f0a1e3d5b7c9f2a4e6d8b1c3f5a7e9d2b4c6f8a1e3d5b7c9f2a4e6d8b0c2f4a6e8",
  "tags": [
    ["d", "e47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["published_at", "1749571200"],
    ["g", "Cyberpunk 2077"],
    ["title", "Emerald Nights Reshade - Neon Noir Preset v2.1"],
    ["image", "https://image.nostr.build/abc123def456featured.jpg"],
    ["video", "https://video.nostr.build/emerald-nights-showcase.mp4"],
    ["summary", "A cinematic reshade preset that transforms Night City with moody neon lighting."],
    ["content-warning", "nsfw"],
    ["repost", "true", "npub1x0r4mand0exampleauthorhexkeyabcdef1234567890abcdef12345"],
    ["screenshots",
      "https://image.nostr.build/screenshot_nightcity_rain_01.png",
      "https://image.nostr.build/screenshot_afterlife_bar_02.png",
      "https://image.nostr.build/screenshot_japantown_neon_03.png",
      "https://image.nostr.build/screenshot_badlands_sunset_04.png"
    ],
    ["t", "reshade"],
    ["t", "visual"],
    ["t", "lighting"],
    ["t", "cinematic"],
    ["t", "neon"],
    ["t", "cyberpunk"],
    ["t", "rtx"],
    ["download", "{\"file\":\"https://files.degmods.com/a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1.zip\",\"title\":\"Emerald Nights v2.1.0 - Full Package\",\"hash\":\"a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1\",\"version\":\"2.1.0\",\"note\":\"Includes both Standard and Performance presets.\",\"image\":\"https://image.nostr.build/download_preview_emerald.png\",\"scans\":[{\"label\":\"VirusTotal\",\"url\":\"https://www.virustotal.com/gui/file/a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1\"},{\"label\":\"Hybrid Analysis\",\"url\":\"https://www.hybrid-analysis.com/sample/a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1\"}]}"],
    ["download", "{\"file\":\"https://files.degmods.com/b4c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9.zip\",\"title\":\"Emerald Nights v2.1.0 - Lite\",\"hash\":\"b4c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9\",\"version\":\"2.1.0\",\"note\":\"Lightweight version without custom LUT tables.\",\"image\":\"https://image.nostr.build/download_preview_lite.png\",\"scans\":[{\"label\":\"VirusTotal\",\"url\":\"https://www.virustotal.com/gui/file/b4c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9\"},{\"label\":\"MetaDefender\",\"url\":\"https://metadefender.com/results/file/bzI2.../_mdaas/overview\"}]}"],
    ["permissions",
      "original-assets:true",
      "reupload:true",
      "modification:true",
      "conversion:true",
      "asset-usage:true",
      "commercial:false"
    ],
    ["notes", "Big thanks to the ReShade community for testing. Lower EMERALD_STRENGTH to 0.7 for Dogtown."],
    ["credits", "LUT tables based on work by @CinematicDave. Rain reflection shader from MariasGFX."],
    ["c", "graphics:reshade"],
    ["c", "visuals:lighting"]
  ]
}
```

---

## Top-Level Event Fields

### `kind`

- **Value:** `31142`
- **Purpose:** Identifies this event as a game mod. Falls within the addressable replaceable event range (30000–40000), meaning relays will replace older versions when a new event with the same `d` tag is published by the same pubkey.

### `content`

- **Type:** String (Markdown)
- **Required:** Yes
- **Purpose:** The full body/description of the mod. Supports markdown formatting for installation instructions, changelogs, compatibility notes, etc.

### `created_at`

- **Type:** Unix timestamp (seconds)
- **Required:** Yes (set automatically)
- **Purpose:** Indicates when this version of the event was created.
- **On first publish:** Set to the current Unix timestamp.
- **On edit:** Set to `previous_created_at + 1`. This prevents the mod from jumping to the "latest" position in feeds, since the increment is minimal. Clients can use `published_at` for original ordering — the two timestamps will remain close together.

---

## Tags Reference

### `d` — Identifier

```json
["d", "e47ac10b-58cc-4372-a567-0e02b2c3d479"]
```

- **Required:** Yes
- **Value:** UUID v4
- **Purpose:** The unique identifier for this addressable replaceable event. Combined with `kind` and `pubkey`, it forms the event's coordinate (`31142:<pubkey>:<d-tag>`), which relays use to determine which event to replace on updates.
- **Constraints:** Must be a valid UUID v4. Generated once on first publish and reused on all subsequent edits.

---

### `published_at` — Original Publication Timestamp

```json
["published_at", "1749571200"]
```

- **Required:** Yes
- **Value:** Unix timestamp as a string
- **Purpose:** Records when the mod was originally published. Unlike `created_at`, this value never changes on edits. Clients should use this for display ordering and "published on" dates.
- **Constraints:** Set once on first publish (current timestamp). Preserved as-is on all subsequent edits.

---

### `g` — Game

```json
["g", "Cyberpunk 2077"]
```

- **Required:** Yes
- **Value:** The full name of the game this mod is for
- **Purpose:** Associates the mod with a specific game. Uses a single-character tag name for efficient relay querying and filtering.
- **Constraints:** Must not be empty.

---

### `title` — Mod Title

```json
["title", "Emerald Nights Reshade - Neon Noir Preset v2.1"]
```

- **Required:** Yes
- **Value:** Display title of the mod
- **Purpose:** The human-readable name shown in listings and on the mod page.
- **Constraints:** Must not be empty.

---

### `image` — Featured Image

```json
["image", "https://image.nostr.build/abc123def456featured.jpg"]
```

- **Required:** Yes
- **Value:** A valid image URL
- **Purpose:** The cover/featured image displayed in mod listings and at the top of the mod page. Follows the same convention as NIP-23 (Long-form Content, kind 30023) for consistency across Nostr clients.
- **Constraints:** Must be a valid, reachable image URL.

---

### `video` — Featured Video

```json
["video", "https://video.nostr.build/emerald-nights-showcase.mp4"]
```

- **Required:** No
- **Value:** A valid video URL
- **Purpose:** An optional showcase/trailer video for the mod, displayed on the mod page alongside or in place of the featured image.
- **Constraints:** Must be a valid, reachable video URL if provided.

---

### `summary` — Short Description

```json
["summary", "A cinematic reshade preset that transforms Night City with moody neon lighting."]
```

- **Required:** Yes
- **Value:** Brief text summary
- **Purpose:** A short description shown in mod listing cards and search results. Should give users a quick understanding of what the mod does without needing to read the full body.
- **Constraints:** Must not be empty.

---

### `content-warning` — Sensitive Content Flag (NIP-36)

```json
["content-warning", "nsfw"]
```

- **Required:** No — **omit the tag entirely** if the mod is not sensitive
- **Value:** `"nsfw"` (or another reason string)
- **Purpose:** Marks the mod as containing sensitive/NSFW content, following the NIP-36 standard. When present, clients SHOULD blur or hide the mod's images and content until the user explicitly opts to view it. When absent, the mod is assumed to be safe for all audiences.
- **Constraints:** The tag's presence alone signals sensitive content. The value provides a human-readable reason but is not strictly required (an empty string is valid).

#### Backwards Compatibility

Clients MUST also handle the legacy `["nsfw", "true"]` tag for reading. When encountered on an existing event, treat it as equivalent to `["content-warning", "nsfw"]`. However, clients MUST NOT publish new events using the legacy `nsfw` tag — always use `content-warning` instead.

```
Reading (accept both):
  ["content-warning", "nsfw"]  →  sensitive content
  ["nsfw", "true"]             →  treat as sensitive content (legacy)
  Neither tag present           →  not sensitive

Writing (publish only):
  Sensitive mod    →  ["content-warning", "nsfw"]
  Non-sensitive    →  omit the tag
```

---

### `repost` — Repost Indicator

```json
["repost", "false"]
```

```json
["repost", "true", "npub1abc..."]
```

- **Required:** Yes
- **Purpose:** Indicates whether this mod is a repost/re-upload of someone else's work.
- **When `"false"`:** Only two values in the tag. No original author is specified.
- **When `"true"`:** A third value is **required** — the original author's npub or a link to the original source. This gives proper attribution.
- **Constraints:**
  - First value must be `"true"` or `"false"`.
  - When `"true"`, the third value must be present and non-empty.

---

### `screenshots` — Screenshot URLs

```json
["screenshots",
  "https://image.nostr.build/screenshot_01.png",
  "https://image.nostr.build/screenshot_02.png",
  "https://image.nostr.build/screenshot_03.png"
]
```

- **Required:** Yes (at least one)
- **Value:** Multiple image URLs as additional values in the same tag
- **Purpose:** Gallery images showcasing the mod in action. Displayed on the mod page in a gallery/carousel.
- **Constraints:** At least one valid image URL must be provided. All values must be valid, reachable image URLs.

---

### `t` — User Tags

```json
["t", "reshade"],
["t", "visual"],
["t", "lighting"]
```

- **Required:** Yes (at least one)
- **Value:** One tag per `t` entry, lowercase
- **Purpose:** User-defined keywords for search and discovery. Each tag gets its own `t` entry, making them individually queryable via relay filters.
- **Constraints:** At least one tag must be provided. Must not be empty.

---

### `download` — Download Entry

Each download is a single `download` tag whose one value is a **JSON-encoded object**. Nostr tags are flat string arrays, so structured/nested data (the `scans` list) is JSON-encoded into one element rather than packed with `key:value` delimiters.

```json
["download", "{\"file\":\"https://files.degmods.com/a3f8...f0a1.zip\",\"title\":\"Emerald Nights v2.1.0 - Full Package\",\"hash\":\"a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1\",\"version\":\"2.1.0\",\"note\":\"Includes both Standard and Performance presets.\",\"image\":\"https://image.nostr.build/download_preview.png\",\"scans\":[{\"label\":\"VirusTotal\",\"url\":\"https://www.virustotal.com/gui/file/a3f8...f0a1\"},{\"label\":\"MetaDefender\",\"url\":\"https://metadefender.com/results/file/bzI2.../_mdaas/overview\"}]}"]
```

The decoded object:

```json
{
  "file": "https://files.degmods.com/a3f8...f0a1.zip",
  "title": "Emerald Nights v2.1.0 - Full Package",
  "hash": "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
  "version": "2.1.0",
  "note": "Includes both Standard and Performance presets.",
  "image": "https://image.nostr.build/download_preview.png",
  "scans": [
    { "label": "VirusTotal", "url": "https://www.virustotal.com/gui/file/a3f8...f0a1" },
    { "label": "MetaDefender", "url": "https://metadefender.com/results/file/bzI2.../_mdaas/overview" }
  ]
}
```

- **Required:** Yes (at least one `download` tag)
- **Format:** One `download` tag per file; its single value is a JSON object.
- **Purpose:** Each `download` tag represents one downloadable file. Multiple `download` tags can exist for different versions or variants of the mod.
- **Backward compatibility:** Older events using the flat `["downloads", "file:...", ...]` `key:value` format are still parsed; new events are always written as `download` JSON.

#### Download Object Fields

| Field | Required | Description |
|---|---|---|
| `file` | **Yes** | The download URL. A direct user-provided link or a Blossom upload URL. When uploaded to Blossom, this is auto-populated with the Blossom link. |
| `title` | No | Display name for this download variant (e.g., "Full Package", "Lite Version"). |
| `hash` | No | SHA-256 hash of the file. Auto-populated when uploading to Blossom (the hash is in the Blossom URL). |
| `version` | No | The mod version string (e.g., "2.1.0"). |
| `note` | No | A custom note for this download (compatibility, variant differences, install steps). |
| `image` | No | A preview image for this download variant. |
| `scans` | No | Array of malware-scan report links — see below. |

#### `scans` — Malware Scan Reports

Each entry is `{ "label": string, "url": string }`:

| Field | Required | Description |
|---|---|---|
| `label` | **Yes** | Provider name shown on the button (e.g., `"VirusTotal"`, `"Hybrid Analysis"`, `"MetaDefender"`). |
| `url` | **Yes** | The report URL. Always explicit — the client never generates links. |

- **Hash-verified badge:** When a `label` matches a known provider (currently **VirusTotal** and **Hybrid Analysis**, which expose public hash-addressed report pages) **and** its `url` equals the URL built from this download's `hash`, the client shows a "hash-verified" badge — proof the report is for these exact bytes. Any other entry (custom provider, or a URL that doesn't match the hash) renders as a plain link.
- The editor prefills the built-in providers' URLs from the file's `hash`; custom reports (e.g., MetaDefender, whose web report is addressed by an opaque `dataId` rather than the hash) are entered as a free `label` + `url`.

#### Blossom Server Uploads

When a user uploads a file to a Blossom server instead of providing a direct link:

- The `file` field is auto-populated with the Blossom URL (which follows the format `https://<host>/<sha256-hash>.<extension>`).
- The `hash` field is auto-populated by extracting the SHA-256 hash from the Blossom URL.

---

### `permissions` — Usage Permissions

```json
["permissions",
  "original-assets:true",
  "reupload:true",
  "modification:true",
  "conversion:true",
  "asset-usage:true",
  "commercial:false"
]
```

- **Required:** No (defaults apply if omitted)
- **Format:** Multi-value tag with `key:value` pairs where each value is `"true"` or `"false"`
- **Purpose:** Declares what other users are allowed to do with the mod and its assets. Displayed on the mod page as a permissions summary.

#### Permission Fields

| Field | Default | When `true` | When `false` |
|---|---|---|---|
| `original-assets` | `true` | All assets in this file are either owned by the publisher or sourced from free-to-use modder's resources. | Not all assets in this file are owned by the publisher or sourced from free-to-use modder's resources; some assets may be. |
| `reupload` | `true` | You are allowed to upload this file to other sites, but you must give credit to me as the creator (unless indicated otherwise). | You are not allowed to upload this file to other sites without explicit permission. |
| `modification` | `true` | You may modify my files and release bug fixes or enhancements, provided that you credit me as the original creator. | You are not allowed to modify this file without explicit permission. |
| `conversion` | `true` | You are permitted to convert this file for use with other games, as long as you credit me as the creator. | You are not permitted to convert this file for use with other games without explicit permission. |
| `asset-usage` | `true` | You may use the assets in this file without needing permission, provided you give me credit. | You must obtain explicit permission to use the assets in this file. |
| `commercial` | `false` | You are allowed to use assets from this file in mods or files that are sold for money on Steam Workshop or other platforms. | You are prohibited from using assets from this file in any mods or files that are sold for money on Steam Workshop or other platforms, unless given explicit permission. |

---

### `notes` — Publisher Notes

```json
["notes", "Big thanks to the ReShade community for testing."]
```

- **Required:** No
- **Value:** Free-text string
- **Purpose:** Additional notes from the publisher — support info, known issues, tips, acknowledgments, etc.

---

### `credits` — Extra Credits

```json
["credits", "LUT tables based on work by @CinematicDave."]
```

- **Required:** No
- **Value:** Free-text string
- **Purpose:** Attribution for third-party assets, tools, or contributors used in the mod.

---

### `c` / `h` / `f` — Categories (hierarchical, JSON-encoded)

A category is a **hierarchical chain** of segments, e.g. `graphics › reshade › neon`. Segments are **free text** (they may contain `:`, commas, spaces, anything), so chains are stored as **JSON-encoded string arrays** in the tag value — never a delimiter-joined string. This is collision-proof and keeps each value a single relay-indexable string (relays only index a tag's first value, `tag[1]`).

For each chain the author enters, the event carries three kinds of tags, **all derived from the chains and fully regenerated on every publish** (they are never authored or diff-edited independently):

| Tag | Holds | Answers the query | Dedup |
|---|---|---|---|
| `c` | the **maximal** chain (the path the author actually typed) — source of truth, used to reconstruct/edit and for exact-path matching | "the exact path is X" | identical chains collapsed |
| `h` | every **rooted prefix** of each chain (depths 1…n) | "path X **and everything under it**" (subtree) | across all chains |
| `f` | every **segment**, position-independent | "segment X appears **anywhere**, at any depth" | across all chains |

```jsonc
// Author enters two chains: graphics›reshade›neon  and  visuals›lighting
["c", "[\"graphics\",\"reshade\",\"neon\"]"],   // maximal chain
["c", "[\"visuals\",\"lighting\"]"],            // maximal chain

["h", "[\"graphics\"]"],                          // rooted prefixes (subtree index)
["h", "[\"graphics\",\"reshade\"]"],
["h", "[\"graphics\",\"reshade\",\"neon\"]"],
["h", "[\"visuals\"]"],
["h", "[\"visuals\",\"lighting\"]"],

["f", "graphics"], ["f", "reshade"], ["f", "neon"], ["f", "visuals"], ["f", "lighting"]  // segments (anywhere index)
```

**Querying relays:**
- exact path → `#c: ["[\"graphics\",\"reshade\"]"]`
- path + everything under it (subtree) → `#h: ["[\"graphics\",\"reshade\"]"]` (matches `graphics›reshade›neon`, etc.)
- a loose term anywhere → `#f: ["reshade"]`

`h` is *rooted*, so a bare term that only ever appears mid-chain is found via `f`, not `h`. Order is significant and reverses are kept distinct (`a›b` ≠ `b›a`).

- **Required:** No
- **Repeatable:** Yes (`c`, `h`, `f` each appear once per unique value)
- **Caps (size safety):** max **5** segments per chain (depth), max **10** chains per mod, max **30** chars per segment. With downloads/scans/screenshots/body also maxed this keeps the event comfortably under the ~64 KB relay bar.
- **Parsing:** read `c` values as JSON string-arrays (the maximal chains); `h`/`f` are pure indexes and ignored when reconstructing the author's chains. A non-JSON `c` value (other clients) is treated as a single literal segment.

---

### `m` — For Another Mod

```json
["m", "naddr1..."]
```

- **Required:** No
- **Value:** A reference to a mod this mod is *made for* — a plain **mod name**, a DEG MODS **naddr**, or an external **link**.
- **Presentation:** name → shown as text; `naddr` → a "View mod" button opening it on DEG MODS; link → a button opening the URL in a new tab.

---

### `dependencies` — Required Mods / Software / Files

```json
["dependencies", "ReShade", "https://reshade.me/"],
["dependencies", "Base Texture Pack", "naddr1..."]
```

- **Required:** No
- **Repeatable:** Yes — one tag per dependency.
- **Format:** `["dependencies", <title>, <value>]`. `value` is a mod name, an `naddr`, or a link (same presentation rules as `m`).
- **UI:** rendered as a collapsible "Dependencies" section under the downloads on the mod page.

---

## Tag Summary Table

| Tag | Required | Repeatable | Format | Example |
|---|---|---|---|---|
| `d` | Yes | No | UUID v4 | `e47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `published_at` | Yes | No | Unix timestamp string | `1749571200` |
| `g` | Yes | No | Game name string | `Cyberpunk 2077` |
| `title` | Yes | No | Text | `Emerald Nights v2.1` |
| `image` | Yes | No | Image URL | `https://...featured.jpg` |
| `video` | No | No | Video URL | `https://...showcase.mp4` |
| `summary` | Yes | No | Text | Short description |
| `content-warning` | No | No | Reason string (e.g. `"nsfw"`) | Present = sensitive, omit = safe |
| `repost` | Yes | No | `true`/`false` + optional npub | `true`, `npub1...` |
| `screenshots` | Yes | No (multi-value) | Image URLs | Multiple URLs in one tag |
| `t` | Yes | Yes | Keyword | One tag per entry |
| `download` | Yes | Yes | JSON object | One tag per download (legacy `downloads` `key:value` still parsed) |
| `permissions` | No | No | `key:value` pairs | Single tag, all permissions |
| `notes` | No | No | Text | Free-text |
| `credits` | No | No | Text | Free-text |
| `c` | No | Yes | JSON string-array (maximal chain) | `["graphics","reshade"]` |
| `h` | No | Yes | JSON string-array (rooted prefix; subtree index) | `["graphics"]` |
| `f` | No | Yes | Segment string (anywhere index) | `reshade` |
| `m` | No | No | Mod name, naddr, or link | `naddr1...` |
| `dependencies` | No | Yes | `title` + value (name/naddr/link) | `["dependencies","ReShade","https://reshade.me/"]` |
