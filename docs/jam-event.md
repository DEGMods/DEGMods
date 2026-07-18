# Jam Event (Kind 31143) + Ballots (31243) + Results (31343)

A **jam** is a time-boxed community event where participants publish entries, and (optionally) those entries are voted on. It is published as a **Nostr addressable replaceable event** with kind `31143`. Because it uses a `d` tag with a UUID v4 identifier, the event can be updated in-place by re-publishing with the same `d` tag — the relay replaces the old version.

There are two **jam types**, distinguished by the `j` tag:

- **`mod`** — a **mod jam**: participants publish mods (kind `31142`) as entries. **Supported now.**
- **`game`** — a **game jam**: participants publish games (a future game kind) as entries. **Not supported yet** — the `game` value is reserved and never surfaced in the current UI. See [Game Jams — future notes](#game-jams--future-notes).

The three kinds in the jam family:

| Kind | Name | Author | Purpose |
|---|---|---|---|
| `31143` | Jam | jam creator | The jam itself: metadata, dates, voting config, criteria. |
| `31243` | Ballot | a voter | One person's scores for one entry. |
| `31343` | Result | jam creator | The creator's published tally — top 100 per track (aggregates + ranks). |

---

## Full Example Event (Jam, kind 31143)

```json
{
  "id": "<64-hex>",
  "pubkey": "<jam-author-hex>",
  "created_at": 1768867200,
  "kind": 31143,
  "content": "# Winter Survival Mod Jam 2026\n\nMake surviving the cold harder, smarter, or just more fun.\n\n## Theme\n…\n\n## Rules\n…\n\n## Prizes\n…",
  "sig": "<128-hex>",
  "tags": [
    ["d", "b7f3c2a1-5e4d-4c8b-9a0f-1e2d3c4b5a6f"],
    ["published_at", "1768867200"],
    ["title", "Winter Survival Mod Jam 2026"],
    ["image", "https://image.nostr.build/winterjam-banner.jpg"],
    ["video", "https://video.nostr.build/winterjam-trailer.mp4"],
    ["summary", "A two-week jam for winter-survival mods, with judge + community voting."],
    ["theme", "Frozen wasteland"],
    ["screenshots",
      "https://image.nostr.build/winterjam-promo-01.png",
      "https://image.nostr.build/winterjam-promo-02.png"
    ],
    ["t", "survival"],
    ["t", "winter"],

    ["g", "Skyrim Special Edition"],
    ["g", "Fallout 4"],

    ["j", "mod"],
    ["start", "1769904000"],
    ["end", "1771113600"],
    ["y", "2026-02"],

    ["voting", "true"],
    ["user-voting", "true"],
    ["judge", "npub1qqqqq…"],
    ["judge", "FrostWorks"],
    ["voting_end", "1771718400"],

    ["criterion", "Graphics", "10"],
    ["criterion", "Sound Design", "10"],
    ["criterion", "Gameplay", "10"],
    ["criterion", "Originality", "10"],

    ["reward", "monetary", "USD", "500"],
    ["reward", "monetary", "sats", "100000"],
    ["reward", "other", "Featured spot on the DEG Mods homepage for a month"],
    ["reward_note", "1st place takes the $500; the sats pool splits across the top 3 by judge rank; the featured spot goes to the community favourite."],

    ["relays", "wss://relay.degmods.com", "wss://relay.damus.io", "wss://nos.lol"],

    ["faq", "Can I submit more than one mod?", "Yes — each mod is its own submission."],
    ["faq", "Do assets have to be original?", "Free-to-use resources are fine if credited."],
    ["rule", "One submission per person", "Pick your best entry — extra submissions are ignored."]
  ]
}
```

After the voting period ends and the creator publishes results, the jam event is edited to add a `results` marker (see [Results](#results-kind-31343)).

---

## Top-Level Event Fields

### `kind`

- **Value:** `31143`
- **Purpose:** Identifies this event as a jam. Falls within the addressable replaceable range (30000–39999), so relays replace older versions when a new event with the same `d` tag is published by the same pubkey.

### `content`

- **Type:** String (Markdown)
- **Required:** Yes
- **Purpose:** The full body of the jam — theme, rules, timeline, prizes, judging notes, etc.

### `created_at`

- **Type:** Unix timestamp (seconds)
- **Required:** Yes (set automatically)
- **On first publish:** Current Unix timestamp.
- **On edit:** `previous_created_at + 1`. Like mods and blogs, this keeps an edited jam from jumping to the top of "latest" feeds. Original ordering comes from `published_at`.

---

## Tags Reference

### `d` — Identifier

```json
["d", "b7f3c2a1-5e4d-4c8b-9a0f-1e2d3c4b5a6f"]
```

- **Required:** Yes
- **Value:** UUID v4. Forms the coordinate `31143:<pubkey>:<d>`. Generated once, reused on every edit.

### `published_at` — Original Publication Timestamp

```json
["published_at", "1768867200"]
```

- **Required:** Yes
- **Value:** Unix timestamp string, set once on first publish, preserved on edits. Use for display/ordering (never changes, unlike `created_at`).

### `title` / `image` / `video` / `summary` / `screenshots` / `t` / `content-warning`

These behave exactly as in the [mod event](./game-mod-event.md):

| Tag | Required | Notes |
|---|---|---|
| `title` | Yes | The jam's name. |
| `image` | Yes | Cover/banner image. |
| `video` | No | Optional promo/trailer video. |
| `summary` | Yes | Short description for cards/listings. |
| `screenshots` | No | Optional promo gallery (multi-value). |
| `t` | Yes (≥1) | Keywords, one per tag, lowercase. |
| `content-warning` | No | NIP-36 sensitive flag; omit if not sensitive. Legacy `["nsfw","true"]` accepted on read. |

### `theme` — Jam Theme

```json
["theme", "Frozen wasteland"]
```

- **Required:** No.
- **Format:** `["theme", "<text>"]` — a free-text word or phrase (client cap: 200 chars). Omitted when empty.
- **Purpose:** The creative theme/prompt for the jam, shown prominently on the jam post.
- **Note:** It is public the moment the jam is published. To reveal a theme only once the jam starts, the creator publishes the jam without it and adds it in a later edit.

### `g` — Game(s) the jam is for

```json
["g", "Skyrim Special Edition"],
["g", "Fallout 4"]
```

- **Required:** No — **optional and repeatable** (differs from mods, where `g` is single + required).
- **Value:** A game name.
- **Semantics:**
  - **0 `g` tags** → a **general** jam (any game / game-agnostic).
  - **1+ `g` tags** → the specific game(s) participants should mod for.
- **Game jams** ignore `g` (the game *is* the entry, not the target).

### `j` — Jam Type

```json
["j", "mod"]
```

- **Required:** Yes
- **Value:** `"mod"` | `"game"`. Single-character, so relays can filter (`#j: ["mod"]`).
- **Purpose:** Distinguishes a mod jam from a game jam. Always `"mod"` for now; `"game"` is reserved and hidden in the current UI.

### `start` / `end` — Jam Window (NIP-52 style)

```json
["start", "1769904000"],
["end",   "1771113600"]
```

- **Required:** Yes (both)
- **Value:** Unix timestamp (seconds) as a string — a single timestamp encodes date **and** time.
- **Purpose:** `start` = jam opens; `end` = submissions close. Follows the NIP-52 (Calendar Events) convention for interoperability. Timezones are handled by storing UTC and rendering local (optional `start_tzid`/`end_tzid` could be added later if needed).
- **Constraint:** `end` must be **greater than** `start`.

### `y` — Month Buckets (date-range index)

```json
["y", "2026-01"],
["y", "2026-02"]
```

- **Required:** No, but clients SHOULD emit it.
- **Repeatable:** Yes — **one tag per calendar month the jam spans**, from `start` through `voting_end` (or `end` when there is no voting).
- **Value:** `YYYY-MM` (UTC).
- **Why it exists:** relays only index **single-letter** tags, so `start` / `end` / `voting_end` are **not queryable** (`#start` is not a valid filter, and `since`/`until` only bound `created_at`, i.e. publish time). `y` is a single-letter **coarse date index** that makes relay-level date-range search possible.

**It is an overlap index, not a start marker.** A jam running **Jan 28 → Feb 15** carries *both* `["y","2026-01"]` and `["y","2026-02"]`, so a search for jams active in February finds it. If it only carried its start month, that search would miss it.

```json
// "what jams are on in February 2026?" (coarse prefilter)
{ "kinds":[31143], "#y":["2026-02"] }
```

- **Derived, never authored:** generated from `start`/`end`/`voting_end` and **fully regenerated on every publish** — same spirit as the `h`/`f` category indexes on mods.
- **Untrusted on read:** clients **ignore `y` entirely** when reading a jam and always re-derive the real window from `start`/`end`/`voting_end`. The index can therefore only ever *over-include*, never lie — someone stuffing `y` for every month to appear in every bucket gets returned by the relay but is immediately filtered out client-side.
- **Size:** each tag is ~17 bytes; even a 12-month jam adds ~220 bytes — negligible against the ~64 KB event ceiling.

**Maximum jam duration:** clients MUST NOT publish a jam whose `start → voting_end || end` span exceeds **12 months** (so `y` can never exceed 13 entries, and absurd jams are rejected at the source). This is a creation-side guard only; a foreign event with a longer span is still rendered normally, since readers use `start`/`end` and ignore `y`.

### `voting` / `user-voting` — Voting Switches

```json
["voting", "true"],
["user-voting", "true"]
```

- **Required:** No (default `"false"` / omit)
- **Purpose:** Two **independent** tracks:
  - **`voting`** — **judge voting**: the pubkeys listed in `judge` score entries.
  - **`user-voting`** — **community voting**: anyone may score entries (see [Anti-gaming](#anti-gaming--future-vote-weighting)).
- Either, both, or neither may be enabled.

### `judge` — Judges

```json
["judge", "npub1qqqqq…"],
["judge", "FrostWorks"]
```

- **Required:** Only when `voting` (judge voting) is `"true"` — then **at least one**.
- **Repeatable:** Yes, one per judge.
- **Value:** an **npub** or a plain **name**. npubs are resolved to profiles by the client; names render as text.
- **Purpose:** Defines who the official judges are. A ballot counts toward the **judge tally** only if its author is in this list — so judge scores are self-verifying (the jam itself declares its judges).

### `voting_end` — Voting Deadline

```json
["voting_end", "1771718400"]
```

- **Required:** When `voting` **or** `user-voting` is `"true"`.
- **Value:** Unix timestamp string.
- **Purpose:** When voting closes.
- **Constraint:** Must be **≥ `end`** (voting can't close before submissions do). The voting window is **`[end, voting_end]`** — see [Voting Window](#voting-window).

### `score_max` — Shared Score Scale

```json
["score_max", "10"]
```

- **Required:** No (defaults to `10`).
- **Format:** `["score_max", "<2…100>"]`. One scale for the **whole jam** — every criterion **and** the single "overall" score use it. `min` is always `0`.
- **Why one shared max:** the tally averages each criterion's scores and then averages those together, so mixing per-criterion scales (e.g. one `0–10`, one `0–20`) would make the composite meaningless. A single scale keeps it coherent and gives voters one mental model.
- **Reading a larger scale:** `100` is the cap a client should *write*. A ballot UI renders one option per point, so a foreign jam declaring a huge scale would otherwise render that many controls — clients should cap what they draw (DEG Mods stops at `0–100`) and say so, rather than trusting the declared number.
- Clients write it whenever a voting track is enabled. It is the authoritative max; the per-criterion `max` field below is written equal to it for backward compatibility.

### `criterion` — Scoring Criteria

```json
["criterion", "Graphics", "10"],
["criterion", "Sound Design", "10"]
```

- **Required:** No.
- **Repeatable:** Yes.
- **Format:** `["criterion", "<label>", "<max?>"]`. `max` mirrors `score_max` (all criteria share it); readers should prefer `score_max` and fall back to this, then to `10`.
- **Purpose:** Defines the dimensions ballots score. The ballot UI is generated from these.
- **Rules:**
  - **No `criterion` tags** → voting is a single **overall** `0–score_max` score (ballots carry `["c","0:<n>","overall"]`).
  - **Custom criteria** → **2 to 15** criteria (a single custom criterion is just a renamed "overall", so ≥2 is required; the upper cap keeps ballots and the event bounded — though many criteria make ballots slower to fill).
- Only meaningful when a voting track is enabled.

### `reward` — Prize(s)

```json
["reward", "monetary", "USD", "500"],
["reward", "monetary", "sats", "100000"],
["reward", "other", "Featured spot on the DEG Mods homepage for a month"]
```

- **Required:** No (a jam may have no rewards / be just for fun).
- **Repeatable:** Yes — one tag per prize, so a jam can list several.
- **Format:** `["reward", "<type>", …]`, where `<type>` is a per-reward toggle:
  - **`monetary`** → `["reward", "monetary", "<currency>", "<amount>"]`. `currency` is **free text** — a symbol (`$`, `€`) or a name (`USD`, `sats`, `BTC`) — deliberately not a fixed list, the creator types it. `amount` is a number as a string.
  - **`other`** → `["reward", "other", "<custom text>"]`. A free-text non-monetary prize (a key, a feature spot, mentorship, merch, …).
- **Purpose:** Describes *what* the prize pool is. *How* it's split is in `reward_note`.

### `reward_note` — Distribution

```json
["reward_note", "1st place takes the $500; the sats pool splits across the top 3 by judge rank; the featured spot goes to the community favourite."]
```

- **Required:** No.
- **Value:** Free-text (from a textarea) describing **how rewards are distributed** — top winner only, top 10, some arbitrary scheme, whatever the creator decides. Intentionally unstructured, since distribution rules vary wildly per jam.

### `relays` — Where to Publish Ballots

```json
["relays", "wss://relay.degmods.com", "wss://relay.damus.io", "wss://nos.lol"]
```

- **Required:** No (but strongly recommended when voting is enabled).
- **Value:** Multi-value list of relay URLs.
- **Purpose:** Declares the canonical relays where **ballots should be published** and where the **tally reads from**, so the count is complete and reliable.
- **Client behavior:**
  - **Auto-seed:** on jam creation the client auto-adds **up to 3 of the creator's enabled relays**, but only after a **connection test** — only working relays are added, and each is **removable**. This is a safety net so a creator who doesn't care about relays still gets a usable set.
  - **Voting:** clients publish each ballot to the jam's `relays` (primary) **plus** the voter's own write relays (best-effort backup).
  - **Tally:** reads the jam's `relays` ∪ the reader's own relays, then dedups.

### `rule` — Jam Rules

```json
["rule", "One submission per person", "Pick your best entry — extra submissions are ignored."]
```

- **Required:** No.
- **Repeatable:** Yes, one rule per tag.
- **Format:** `["rule", "<title>", "<detail>"]`.
- **Purpose:** The binding conditions of entering, kept structured rather than buried in the body so a client can list them on their own.
- **Client behavior:** rendered as its own collapsible section on the jam post, above the FAQ. Limits mirror the FAQ's: 200 chars for the title, 1000 for the detail, up to 30 rules.

### `faq` — Frequently Asked Questions

```json
["faq", "Can I submit more than one mod?", "Yes — each mod is its own submission."]
```

- **Required:** No.
- **Repeatable:** Yes, one Q&A per tag.
- **Format:** `["faq", "<question>", "<answer>"]`.

### `results` — Tally Marker (added after voting)

```json
["results", "1771722000"]
```

- **Required:** No — added by the creator **after** publishing the result event (kind `31343`).
- **Value:** the Unix timestamp when the tally was published.
- **Purpose:** A lightweight marker telling clients "results are out." The per-entry data lives in the `31343` events, never on the jam event (which would blow past relay size limits at scale). Adding it is an edit, so `created_at` becomes `previous + 1`.

---

## Removed vs. the Mod Event

A jam is "a mod event minus the mod-specific parts, plus jam parts." Removed from `31142`: `download`, categories (`c`/`h`/`f`), the emulation/platform field, `m` (for another mod), `repost`, `permissions`, `notes`, `credits`, `dependencies`.

---

## Jam Tag Summary

| Tag | Required | Repeatable | Format | Notes |
|---|---|---|---|---|
| `d` | Yes | No | UUID v4 | Coordinate identifier |
| `published_at` | Yes | No | Unix ts string | Set once |
| `title` | Yes | No | Text | |
| `image` | Yes | No | Image URL | |
| `video` | No | No | Video URL | |
| `summary` | Yes | No | Text | |
| `theme` | No | No | Text | Theme word/phrase; public on publish |
| `screenshots` | No | No (multi-value) | Image URLs | Promo gallery |
| `t` | Yes (≥1) | Yes | Keyword | |
| `content-warning` | No | No | Reason string | NIP-36 |
| `g` | No | Yes | Game name | 0 = general; game jams ignore |
| `j` | Yes | No | `mod` \| `game` | Jam type |
| `start` | Yes | No | Unix ts string | Jam opens |
| `end` | Yes | No | Unix ts string | Submissions close (`> start`) |
| `y` | Should | Yes | `YYYY-MM` | Derived month buckets (date-range index); ignored on read |
| `voting` | No | No | `true`/`false` | Judge voting |
| `user-voting` | No | No | `true`/`false` | Community voting |
| `judge` | If `voting` | Yes | name or npub | ≥1 when judge voting on |
| `voting_end` | If any voting | No | Unix ts string | `≥ end` |
| `criterion` | No | Yes | `label` + optional `max` | 0 = overall; else 2–6 |
| `reward` | No | Yes | `monetary`+`currency`+`amount`, or `other`+`text` | One per prize |
| `reward_note` | No | No | Text | How prizes are distributed |
| `relays` | Recommended | No (multi-value) | Relay URLs | Where ballots go / tally reads |
| `rule` | No | Yes | `title` + `detail` | |
| `faq` | No | Yes | `question` + `answer` | |
| `results` | No | No | Unix ts string | Added after tally |

**Validation:** `end` > `start`; if `voting` or `user-voting` → `voting_end` ≥ `end`; if `voting` → ≥1 `judge`; custom criteria → 2–6.

---

## Submissions — Linking an Entry to a Jam

A submission is **not** a new kind. It's the normal entry event (a **mod**, kind `31142`, for a mod jam) carrying two extra tags:

```jsonc
{
  "kind": 31142,
  "tags": [
    ["d", "e47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["g", "Skyrim Special Edition"],
    ["title", "Frostfall Companion"],
    /* …all the usual mod tags… */

    ["a", "31143:<jam-author-hex>:b7f3c2a1-5e4d-4c8b-9a0f-1e2d3c4b5a6f"], // which jam
    ["l", "jam-entry"]                                                    // what it is
  ]
}
```

- **`a`** → the jam's coordinate (`31143:<pubkey>:<d>`). Unambiguous because the coordinate's kind (`31143`) can only be a jam. A single mod may be entered into more than one jam (multiple `a` tags).
- **`l`** → the NIP-32 label `"jam-entry"` (bare — no `L` namespace, to avoid centralized/branded categorization). It's a single-letter, relay-indexed tag, so `#l: ["jam-entry"]` finds jam entries everywhere, and future entry types (`"demo"`, `"dlc"`, `"playtest"` on games) reuse the same slot.

**Query a jam's entries:**

```json
{ "kinds":[31142], "#l":["jam-entry"], "#a":["31143:<pubkey>:<d>"] }
```

### Valid submission

Not every event returned by that query counts. A submission is **valid** (shown on the submissions page, eligible for voting/tally) only if:

- **Its kind matches the jam's type (`j`).** A mod jam (`j=mod`) counts only mod entries (`31142`); a game jam (`j=game`) counts only game entries (the future game kind). This stops a mod being counted in a game jam's leaderboard (or vice-versa) if some client tags it that way. Each client enforces its own side: DEG Mods is a mod client, so `isValidSubmission` accepts only a mod (`31142`) in a `j=mod` jam and rejects everything else — it never processes game jams at all (they're excluded from its listing too).
- **`published_at` ∈ `[start, end]`** — the authoritative gate. The entry must have been *originally published during the jam*, so a pre-existing mod (published before `start`) that's tagged into the jam is excluded, and so is anything published after submissions closed.
- **`created_at`** passes a sanity check: `≥ start`, and `≤ end` with a small grace. `created_at` is only a secondary check because the mod edit convention (`created_at = prev + 1`) makes it drift slightly upward with each edit — a legit entry published just before `end` and edited during voting could tip a second or two past `end`, so it isn't a hard cutoff.
- **Not a repost:** entries whose mod carries `["repost","true",…]` are excluded (a re-upload of someone else's work isn't an original jam entry).

Both timestamps are self-declared (Nostr doesn't enforce them), so this is an honest-client gate plus a deterrent, not a cryptographic guarantee; PoW and the public, recomputable nature of the tally are the backstops.

---

## Voting

### Voting Window

Voting is only counted within **`[end, voting_end]`** — i.e. **after submissions close**, until the deadline. Rationale: everyone votes on the *final, complete* set of entries, and no entry gets a longer voting window than another. Clients disable the vote UI before `end` ("Voting opens when submissions close") and hide it after `voting_end`. Anyone *can* still publish a ballot outside the window (Nostr is permissionless), but it is not counted.

### Ballot — Kind `31243`

One ballot = one voter's scores for one entry.

```jsonc
{
  "kind": 31243,
  "pubkey": "<voter-hex>",
  "content": "",                                     // optional note; DEG Mods leaves it empty
  "created_at": 1771200000,                          // see "edits" below
  "tags": [
    ["d", "<jam-d>:<submission-d>"],                 // one ballot per voter per entry per jam
    ["a", "31143:<jam-pk>:<jam-d>"],                 // the jam
    ["a", "31142:<mod-pk>:<mod-d>"],                 // the entry
    ["c", "0:8", "Graphics"],                        // criterion #0 scored 8
    ["c", "1:7", "Sound Design"],
    ["c", "2:9", "Gameplay"],
    ["c", "3:6", "Originality"],
    ["nonce", "<n>", "<difficulty>"]                 // NIP-13 proof of work
  ]
}
```

**`d` — the composite identifier.** The coordinate is `31243:<voter>:<jam-d>:<submission-d>`. Combining the jam's `d` and the submission's `d` guarantees the invariant *one ballot per (voter, jam, entry)*:

- same voter + same jam + same entry → same coordinate → their single, editable ballot;
- same voter, different entry → different `<submission-d>` → separate ballot;
- same voter, the entry is in two jams → different `<jam-d>` → separate ballots (votes stay per-jam);
- different voter → different pubkey → different coordinate.

So no client-side de-duplication of "multiple ballots from one person" is ever needed.

**`c` tags — the scores.** One per active criterion:

```
["c", "<fingerprint>:<criterion-index>:<value>", "<label>"]

e.g. ["c", "6x10:a3f91c0e:0:8", "Gameplay"]
```

If the jam has no `criterion` tags, a single overall score at index 0.

- **`fingerprint`** identifies the criteria set this ballot was cast against — see below.
- **`criterion-index`** is the criterion's **position in the jam event's `criterion` tags**, zero-based. Position rather than label, so the label is free to be decorative.
- **`value`** is the score, `0…score_max`.
- **`label`** is carried purely for human readability when inspecting a raw event. Nothing reads it — the index is authoritative. A ballot whose label disagrees with the jam is not thereby invalid.

**Why one single-letter tag holding all of it.** Relays index single-letter tags only, and a filter matches on the tag's *first* value. Putting the score alone there (`["c","8",…]`) would make `#c:["8"]` match "scored 8 on **anything**", collapsing every criterion together. Packing the whole bucket key into that one slot makes each (criteria set, criterion, score) bucket independently queryable, which is what lets the community tally run on counts instead of downloads — see [Tallying](#tallying--results).

#### The criteria fingerprint

```
fingerprint = "<criteria-count>x<score_max>:<hash>"
hash        = sha256(JSON([score_max, ...labels.map(normalize)])).slice(0, 8)
normalize   = s => s.normalize('NFC').replace(/\s+/g, ' ').trim()
```

A ballot binds to a *slot*, not a name. Without the fingerprint, a creator who
renamed or reordered criteria mid-voting would silently turn "rated Gameplay 10"
into "rated Sound 10" — the aggregate and the ranking survive (a mean is
permutation-invariant), but the published breakdown would assert something about
voter opinion that is false. Changing the criteria *count* or `score_max` is
worse: it genuinely reshuffles rankings.

Binding ballots to the fingerprint converts all of that into a **loud, reversible**
failure. A ballot cast against a different criteria set matches no bucket the
tally queries, so its votes read as zero — obvious immediately, and fixed by
reverting the criteria. The alternative, a silent misattribution nobody detects,
is strictly worse.

**Why normalize only Unicode form and whitespace.** Those are the differences a
*client* can introduce by re-serializing the jam — an innocent creator fixing a
typo in the description on a tidy-minded client shouldn't zero out every vote.
Case, hyphen-vs-dash and quote style are deliberately **not** folded: no client
rewrites those on its own, so a difference there means a human retyped the label,
which is exactly the change the fingerprint exists to catch.

**Note this is a guard against mistakes, not a trust boundary.** A creator
determined to publish false results can simply do so — they sign the result event.
What the fingerprint protects is the *unsigned* per-entry view that every viewer's
client computes for itself, which a criteria change would otherwise silently
corrupt for everyone.

**`content`.** Free for a note, but DEG Mods neither collects nor shows one, so it publishes an empty string: a ballot there is just its scores. A comment nobody surfaces would invite voters to write feedback that's never read. Clients that do want judge feedback can use this field and render it.

**PoW.** Every ballot carries a NIP-13 `nonce` mined to the jam's expected difficulty (matching the client's standard PoW). It's a spam/cost floor — not a full sybil defense (see below).

**Edits use `created_at = now` (NOT `previous + 1`).** This is the opposite of jams/mods, and deliberate: because the ballot is replaceable, relays keep only the latest version, and the tally counts a ballot only if `created_at ≤ voting_end`. So the latest `created_at` must be the *actual* time the vote was last set:

- edited within the window → counts with the new scores;
- edited **after** `voting_end` → `created_at > voting_end` → excluded → the voter self-invalidates (they can't touch anyone else's vote).

If ballots used `previous + 1`, a post-deadline edit would inherit an in-window timestamp and sneak past the deadline. Ballots therefore have **no `published_at`** — the current `created_at` is the single source of truth for "when this vote stands as of."

### Anti-gaming & Future Vote-Weighting

For v1, community (`user-voting`) results are a **plain count, gated only by PoW**. PoW raises per-vote cost but does not stop a determined botnet — this is understood and accepted for now.

**Future weighting/filtering (not built — direction only):** count or weight user votes by signals that are hard to fake, e.g.:

- a verified **DNN ID**;
- a **game purchase** from the (future) Nostr-based game store;
- an **external purchase** (Steam / itch) proven via a signed event referenced in the voter's profile, with opt-in public purchase history;
- account age (ignore pubkeys with no activity before `start`).

(Web-of-Trust weighting was considered and **rejected** for jams — deemed undesirable here.)

---

## Tallying & Results

Triggered **manually by the jam creator** after `voting_end`.

### 1. Two tracks, two very different methods

The judge track and the community track are gathered in completely different
ways, because they have completely different scaling properties.

**Judges — fetch the actual ballots.** The judge list is bounded (≤25) and known
in advance, so the ballots can be pulled directly with an author filter:

```json
{ "kinds":[31243], "#a":["31143:<pk>:<jam-d>"], "authors":["<judge-hex>", "…"],
  "since":<end>, "until":<voting_end> }
```

Cost is bounded by *judges × entries*, never by how many people voted. These
ballots are validated and averaged exactly as written below, and anyone can
re-fetch them and independently verify the published result. **This is the
authoritative track.**

**Community — count, don't download.** Community voting is unbounded: a popular
jam can attract millions of ballots, and no browser can download them all. So
the community track never fetches ballots at all. It asks relays to **count**
them (NIP-45), one query per (entry, criterion, score) bucket:

```json
// how many ballots gave this entry a 8 on criterion #0?
{ "kinds":[31243], "#a":["31142:<mod-pk>:<mod-d>"], "#c":["0:8"],
  "since":<end>, "until":<voting_end> }
```

From the resulting histogram: `total = Σ counts`, `average = Σ (value × count) / total`.

The decisive property is that **query count is independent of ballot volume**.
It is *entries × criteria × (score_max + 1)* whether the jam received a thousand
ballots or ten million. A 20-entry jam with 6 criteria on a 0–10 scale costs
~1,300 tiny queries at any scale. Cost now tracks entries — bounded by how many
mods humans actually made — instead of votes, which are bounded by nothing.

There is no sweep. The paginated download of every ballot is gone.

### 1a. Merging counts across relays — best effort

Counts cannot be deduplicated. If relay A reports 60,000 and relay B reports
60,000, there is no way to tell union from overlap; only the raw events would
say, and not downloading them is the point.

**Rule: take the highest count for each bucket independently.** A relay holds
only a subset of the ballots, so its count for a bucket is always **≤** the true
count. The maximum across relays therefore can never inflate a bucket — it is
always a floor, never an invention — and taking it per bucket rather than
per relay keeps the best available evidence for every bucket.

The consequence is that the community tally is **best effort and may undercount**.
A relay that is down or slow when the tally runs takes any ballots stored only
there with it. This must be stated plainly to the creator *and* to voters at the
moment they cast a ballot — a close result that nobody was warned about is an
argument that cannot be settled.

### 1b. What this costs in rigour

Counting buys scale by giving up three things the judge track keeps:

- **No whole-ballot validity.** A ballot that omits a criterion still counts in
  the criteria it did fill, where a downloaded ballot would be dropped whole.
  The damage is bounded — an out-of-range or undeclared score matches no valid
  bucket and is silently excluded — but partial ballots do slip through.
- **No PoW check.** Proof of work can't be verified from a count.
- **Reproducible, not verifiable.** Re-running the queries proves the relay
  agrees with itself, not that the ballots exist. Anyone wanting real
  verification can still download every ballot and recompute by hand; it just
  stops being the default path.

These are acceptable on the community track precisely because it is *not* the
authoritative one. The result that decides who won never depends on a relay's
arithmetic.

### 1c. Relay requirement

A jam with `user-voting` enabled **must** list at least one `relays` entry that
supports NIP-45, or its community votes can never be tallied. Clients should
probe each vote relay (send a trivial `COUNT`, see whether a `COUNT` response
comes back) and refuse to enable community voting until one qualifies. DEG Mods
badges each vote relay in the editor and auto-disables community voting if the
last counting relay is removed or switched off.

### 2. Validate and aggregate

Applies in full to the **judge track**; the community track gets what counting
can express (see 1b).

- **Dedup** by ballot coordinate `31243:<voter>:<jam-d>:<sub-d>`; across relays keep the version with the **highest `created_at` that is still ≤ `voting_end`**.
- **Validate:** `created_at ∈ [end, voting_end]`, PoW meets difficulty, and the `c` tags match the jam's criteria **exactly** — one score per declared criterion index, no extras, no duplicates, each value within `0…score_max`. For the **judge tally**, additionally require the author ∈ the jam's `judge` list.
  - **A ballot that doesn't match exactly is dropped whole**, not partially counted, and the tally continues without it. Partial acceptance is gameable: a ballot that skips criteria would be averaged over a smaller denominator than its rivals'.
- **Aggregate** per entry, per criterion → **average**. Keep **two independent tracks**: judges (judge-authored ballots, fetched) and community (all ballots, counted), each with its vote count.

### 3. Rank

Compute **two ranks**: a **judges' rank** and a **users' rank**. Optionally a **combined** rank if the creator wants one (e.g. weight judges 70% / users 30%). Ties broken by vote count, then earliest submission.

### 4. Publish — one Result event (kind `31343`)

**A jam publishes exactly one result event: the top 100 of each track.**

Every page costs a PoW mine and a signer round-trip, so publishing a full
leaderboard for a large jam means dozens of mining runs and dozens of approval
prompts — unusable at scale. And nobody reads a leaderboard past the top: the
person who cares about entry #487 is its creator, who can compute it on demand
(see [Per-entry results on demand](#per-entry-results-on-demand)).

```jsonc
{
  "kind": 31343,
  "pubkey": "<jam-creator>",
  "content": "{\"judge\":[…100 rows…],\"community\":[…100 rows…]}",
  "tags": [
    ["d", "<jam-d>:r:0"],
    ["a", "31143:<jam-pk>:<jam-d>"],
    ["truncated", "100"],             // top N per track; absence ≠ "no votes"
    ["client", "DEG MODS"]
  ]
}
```

**Two sections, ranked independently.** `judge` holds the top 100 by judges'
rank, `community` the top 100 by community rank. **An entry may appear in both,
and the duplication is intended** — the two tracks are separate results, not two
views of one. Cutting on a single ranking would be a bug: an entry can place #3
with judges and #400 with the community, and a judge-track winner must never be
dropped because the crowd ignored it.

**Row format.** One row per entry, per section:

```jsonc
{
  "a": "31142:<mod-pk>:<mod-d>",   // the entry
  "r": 1,                           // rank within this section
  "v": 1240,                        // ballots counted in this track
  "s": 8.4,                         // aggregate score (mean of the criteria means)
  "c": [8.8, 7.9, 9.1, 8.0]         // per-criterion means, in the jam's criterion order
}
```

`c` is positional — index *i* is the jam's criterion *i*, so labels aren't
repeated 200 times. A jam with no `criterion` tags has a single-element `c`
equal to `s`. Averages are rounded to **one decimal**: ranks are precomputed and
stored, so display precision can't affect ordering.

**Zero-vote entries are omitted.** A row of `avg 0, votes 0, rank 0` carries no
information. Absence, combined with the `truncated` marker, means "not in the
top N" — which the entry's own page can resolve exactly.

**Size budget.** Worst case — 15 criteria (the cap), 200 rows, 8-digit vote
counts, `99.9` averages, full 107-char coordinates, signature and PoW nonce —
lands at **~47 KB**, inside the 64 KB relays commonly allow. Two levers exist if
a stricter relay needs them: dropping the redundant `31142:` prefix (~1 KB), and
trimming the criteria breakdown.

- **Read results:** `{ "kinds":[31343], "authors":["<jam-pk>"], "#a":["31143:<pk>:<jam-d>"] }` → one event → both leaderboards.
- The result is the creator's **signed** tally. The judge track can be independently recomputed from the ballots and verified; the community track can only be re-queried (see [1b](#1b-what-this-costs-in-rigour)).
- Finally, stamp the jam event with `["results", "<ts>"]` (edit → `created_at = prev + 1`).

### Per-entry results on demand

Any entry — ranked, unranked, or outside the published top 100 — can be tallied
on its own, cheaply, without the published result. Clients surface this as an
explicit action on the entry (DEG Mods: a button on the mod post), not as an
automatic fetch on every page view.

- **Judges:** one events fetch — `{ "kinds":[31243], "#a":["31142:<mod-pk>:<mod-d>"], "authors":[<judges>], "since":<end>, "until":<voting_end> }`. Bounded by the judge count; validated and averaged exactly like the main tally.
- **Community:** the same COUNT histogram as the main tally, for this entry only — *criteria × (score_max + 1)* tiny queries.

Two things this **must** distinguish, because conflating them is the worst
failure mode here: **"no ballots were cast"** and **"not enough relays answered
to say."** Silently rendering zeros for a relay outage would report a real result
as a shutout.

This is a live view, not a record: it reads whatever relays hold *now*, it isn't
signed, and two viewers may see different numbers. Relays prune, so an entry
outside the published top 100 has results that **degrade over time** — the
accepted cost of not publishing thousands of rows nobody reads.

### Who wins

**The judge track is authoritative.** Judges' ballots are fetched as real events,
validated whole, PoW-checked and independently verifiable; a jam's winner is
judge rank #1, and clients should say so plainly.

**The community track is an audience signal, not an award.** It is counted, not
verified — no PoW check, no whole-ballot validation, and per-bucket maximums mean
the *highest* claim from any relay wins by construction. That is fine for "what
did people like" and disqualifying for "who took the prize."

**A jam with community voting and no judges therefore has no verifiable result.**
Clients should either discourage that combination at creation or label its
results plainly as unofficial — never render them with the authority of a judged
jam's.

**Displaying ranks.** Where both tracks exist, show both, judges first: on the
entry card in the submissions list, and in the entry's own results section on the
mod post.

### Result Tag Summary (`31343`)

| Tag | Required | Format | Notes |
|---|---|---|---|
| `d` | Yes | `<jam-d>:r:0` | Replaceable (re-tally updates in place) |
| `a` | Yes | `31143:<pk>:<jam-d>` | The jam |
| `truncated` | Yes | `<N>` | Top N published per track; absence ≠ no votes |
| `content` | Yes | JSON object | `{judge: [...], community: [...]}` |

---

## Game Jams — Future Notes

Game jams reuse **this exact design**; only a few things differ, and none are built yet:

- **`j` = `"game"`** on the jam event.
- **`g`** is not required (a game jam's entries *are* games, so there's no target game to mod for). It may be omitted entirely, or used loosely (e.g. an engine/theme) if ever useful.
- **Entries** are the future **game kind** (see below) instead of `31142`, still linked with `["a","31143:…"]` + `["l","jam-entry"]`. Game releases reuse the `l` slot for their own types (`"demo"`, `"dlc"`, `"playtest"`, …), independent of jams.
  - **Separate client, separate scope.** Game jams belong to the future game client, not DEG Mods. DEG Mods only ever creates/lists/validates `j=mod` jams (`isValidSubmission` requires a mod in a mod jam; `constructJamListFromEvents` and the jam page drop non-mod jams). The game client mirrors this on its side for `j=game` — the shared `j`-vs-kind rule keeps a mod out of a game jam's leaderboard and vice-versa, with neither client needing to model the other's type.
- **Ballots (`31243`)**, **results (`31343`)**, criteria, voting window, tally/publish flow — all identical.

**Games are a separate kind, not overloaded onto `31142`.** A mod (`31142`) *targets* a game and carries mod-specific fields (downloads, modding permissions); a game *is* the thing and needs different fields (price/free, platforms, store/build links, system requirements, age rating, demo↔full/DLC relationships). Keeping them as distinct kinds keeps relay/client filtering and UIs clean; the `l` label handles sub-types *within* each kind rather than blurring the kinds together. The concrete game kind number is TBD.

---

## Conclusions / Design Decisions So Far

- **Kinds:** `31143` jam, `31243` ballot, `31343` result — an addressable "…43" family.
- **Jam type** via single-letter `j` (`mod` now, `game` later). Mod jam only in current UI.
- **Dates** use NIP-52 `start`/`end` unix timestamps; `voting_end ≥ end`; voting window `[end, voting_end]`.
- **Date search:** multi-letter tags aren't relay-indexable, so a derived single-letter **`y` month-bucket** index (one per month spanned, `start` → `voting_end || end`) enables `#y` prefiltering. Untrusted and ignored on read (truth is re-derived from `start`/`end`); jams capped at **12 months** on creation.
- **`g`** optional + repeatable for jams (0 = general).
- **Submissions** = normal entry event + `["a","31143:…"]` + `["l","jam-entry"]` (bare `l`, no `L`).
- **Two voting tracks:** `voting` (judges, self-verified via `judge` list) and `user-voting` (community, PoW only for now; future weighting via DNN ID / purchases; WoT rejected).
- **Criteria:** none = single overall 0–10; custom = 2–6 `criterion` tags.
- **Rewards:** repeatable `reward` tags (toggle `monetary` [free-text currency + amount] or `other` [text]) + a single free-text `reward_note` for distribution.
- **Ballot** identity via composite `d` (`<jam-d>:<sub-d>`); edits use `created_at = now`; no `published_at`.
- **Jam/mod edits** use `created_at = prev + 1` (feed-stable); **ballot edits** use `now` (deadline-enforcing).
- **Tally:** creator-triggered. Judges' ballots are **fetched** by author filter and counted exactly; community ballots are **counted** via NIP-45 per (entry, criterion, score) bucket, taking the highest count per bucket across relays. Query cost tracks entries, not votes. Two ranks, progress UI.
- **Results:** one `31343` event holding the top 100 of each track, with a `truncated` marker; zero-vote entries omitted; anything below the cut is computed on demand from the entry's own page. Jam keeps only a `results` marker. Judge track fully recomputable/verifiable; community track re-queryable.
- **Relays** tag declares where ballots go / tally reads; client auto-seeds up to 3 working, removable relays.
- **Games** get their own future kind; never overloaded onto `31142`.
