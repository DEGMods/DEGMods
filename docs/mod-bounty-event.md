# Mod Bounty Event (Kind 31144) + Reward Pledges (31244)

A **mod bounty** is a public request for a mod that does not exist yet: someone wants a mod for a specific game and describes it, optionally attaching a (purely descriptive) reward. Creators fulfil it by publishing a mod linked to the bounty, and the bounty's author picks one of them as the primary fulfiller.

It is published as a **Nostr addressable replaceable event** with kind `31144`. Because it uses a `d` tag with a UUID v4 identifier, the author can update it in-place by re-publishing with the same `d` tag — the relay replaces the old version. That replaceability is what lets the author mark a winner after the fact.

Kind `31144` is a **general-purpose bounty kind**: a [`b` (type) tag](#b--bounty-type) distinguishes what the bounty is for, so other Nostr clients can reuse the same kind for their own bounty boards. DEG Mods only writes and only lists `b=game-mod` bounties; everything below describes that type.

The two kinds in the bounty family:

| Kind | Name | Author | Purpose |
|---|---|---|---|
| `31144` | Bounty | the requester | The request itself: what mod is wanted, for which game, and the offered reward. |
| `31244` | Reward Pledge | anyone | A third party adds their own (descriptive) reward on top of an existing bounty. |

> **No money changes hands through the protocol or the client.** A "reward" is a *description* of what is offered and how it will be delivered. There is no escrow, no zap integration, and no on-chain/Lightning settlement in this spec. Payment, if any, happens out-of-band between the parties on trust. This keeps v1 shippable and avoids custody.

---

## Full Example Event (Bounty, kind 31144)

```json
{
  "id": "<64-hex>",
  "pubkey": "<requester-hex>",
  "created_at": 1768867200,
  "kind": 31144,
  "content": "# First-person camera for vehicles\n\nEvery vehicle in the game is stuck in third person. I want a proper first-person/cockpit camera with working mirrors and a toggle hotkey.\n\n## Why\nImmersion — the driving feels great but you can't sit *in* the car.",
  "sig": "<128-hex>",
  "tags": [
    ["d", "b7f3c2a1-5e4d-4c8b-9a0f-1e2d3c4b5a6f"],
    ["published_at", "1768867200"],
    ["title", "First-person camera for vehicles"],
    ["image", "https://image.nostr.build/bounty-cover.jpg"],
    ["summary", "A cockpit/first-person camera for all vehicles, with a toggle."],

    ["g", "Grand Theft Auto VI"],
    ["b", "game-mod"],

    ["reward", "$100", "PayPal on release"],

    ["t", "camera"],
    ["t", "vehicles"],

    ["v", "unfulfilled"]
  ]
}
```

Once the requester picks a winner, the event is re-published with the fulfilment selection added (`a` + `p`) and `v` flipped to `fulfilled` — see [Fulfilment & winner selection](#fulfilment--winner-selection).

---

## Top-Level Event Fields

### `kind`

- **Value:** `31144`
- **Purpose:** Identifies this event as a mod bounty. Falls within the addressable replaceable range (30000–39999), so relays replace older versions when a new event with the same `d` tag is published by the same pubkey.

### `content`

- **Type:** String (Markdown)
- **Required:** Yes
- **Purpose:** The full description of the wanted mod — what it should do, context, why it's wanted.

### `created_at`

- **Type:** Unix timestamp (seconds)
- **Required:** Yes (set automatically)
- **On first publish:** Current Unix timestamp.
- **On edit:** `previous_created_at + 1`. Like mods, blogs, and jams, this keeps an edited bounty from jumping to the top of "latest" feeds. It is a logical counter, **not** a usable "last edited" time - use `updated_at` for that. Original ordering comes from `published_at`.

---

## Tags Reference

### `d` — Identifier

```json
["d", "b7f3c2a1-5e4d-4c8b-9a0f-1e2d3c4b5a6f"]
```

- **Required:** Yes
- **Value:** UUID v4. Forms the coordinate `31144:<pubkey>:<d>`. Generated once, reused on every edit.

### `published_at` — Original Publication Timestamp

```json
["published_at", "1768867200"]
```

- **Required:** Yes
- **Value:** Unix timestamp string, set once on first publish, preserved on edits. Use for display/ordering (never changes, unlike `created_at`).

### `updated_at` — Last-Edit Timestamp

```json
["updated_at", "1769040000"]
```

- **Required:** No (written only on edits).
- **Value:** The real **wall-clock** unix time of the edit. Written whenever the bounty is re-published as an edit (including when the requester picks a winner); absent on a never-edited bounty.
- **For display only** ("Edited <date>"). It is **not** relay-indexed and MUST NOT be used to select revisions - `created_at` (the +1 counter) remains the authority for which revision is newest. This mirrors the `updated_at` convention from NIP-PS (Permissionless Standards).

### `title` / `image` / `summary` / `t` / `content-warning`

These behave as in the [mod event](./game-mod-event.md):

| Tag | Required | Notes |
|---|---|---|
| `title` | Yes | The bounty's short name. |
| `image` | No | Optional featured image for the card. |
| `summary` | No | Short description for cards/listings. Falls back to the first line of `content`. |
| `t` | No | Keywords, one per tag, lowercase. |
| `content-warning` | No | NIP-36 sensitive (NSFW) flag with an optional reason; omit when not sensitive. The creator sets it via a simple on/off toggle, so the value is usually the literal `nsfw`. Legacy `["nsfw","true"]` is accepted on read. Drives the NSFW listing filter (hide / show / only) and blurs the featured image until revealed. |

### `g` — Game the bounty is for

```json
["g", "Grand Theft Auto VI"]
```

- **Required:** **Yes** (exactly one).
- **Why mandatory:** a bounty is intrinsically "a mod request *for a game*." The game scopes the bounty, drives the listing (`#g` is a relay-indexed single-letter tag), and is matched against a fulfilling mod's own `g` (see [Fulfilment](#fulfilment--winner-selection)).
- Unlike jams (which allow 0..n games), a bounty has exactly one game.

### `b` — Bounty type

```json
["b", "game-mod"]
```

- **Required:** Yes (exactly one).
- **Why it exists:** kind `31144` is a **general-purpose bounty kind** - the `b` tag says what *kind* of thing is being requested, so other Nostr clients can reuse the same kind for their own bounty boards (`art`, `code`, `general`, ...). It's the direct analogue of the jam `j` (jam type) tag.
- **Value:** DEG Mods writes and recognises only **`game-mod`** (a request for a game mod). It is single-letter and relay-indexed, so a client filters to its own type with `"#b": ["game-mod"]`.
- **Matching is strict, allowlist-style** (like `isModJam`): DEG Mods lists a bounty only when `b === "game-mod"`. A bounty with a different `b`, or no `b` at all, is treated as "not mine" and ignored by the listing - so a generic bounty from another client never leaks into the mod site. (The `g` game tag is still required for a `game-mod` bounty; a different bounty type would define its own required fields.)

### `reward` — Offered Reward *(what + how)*

```json
["reward", "50,000 sats", "Lightning zap on release"]
```

- **Required:** No (a bounty may be a pure "I just want this to exist" request).
- **Format:** `["reward", "<what>", "<how>"]`
  - **`<what>`** — what the reward is, free text: `"50,000 sats"`, `"a Steam gift"`, `"credit in my next project"`.
  - **`<how>`** — *(optional 3rd value)* how it will be delivered: `"Lightning zap on release"`, `"DM to arrange"`.
- Descriptive only; nothing parses or settles it. `reward` is a multi-letter tag and therefore **not** relay-indexed — the extra value costs nothing and is valid per NIP-01 (tags are arbitrary-length string arrays).
- At most one `reward` tag on the bounty itself. Additional rewards from **other** people are separate [Reward Pledge](#reward-pledges-kind-31244) events.

### `v` — Fulfilment Status *(derived)*

```json
["v", "unfulfilled"]
```

- **Required:** Yes (set automatically by the client, never by hand).
- **Values:** `"unfulfilled"` | `"fulfilled"`.
- **Derivation — this is the whole point:** the status is *computed from whether a fulfilment selection exists on the event*, not toggled independently. In the event builder:
  - the bounty has an `a` tag pointing at a mod coordinate (`31142:…`) → `["v", "fulfilled"]`
  - otherwise → `["v", "unfulfilled"]`
- **Why a tag at all, if it's derived?** `v` is a **single-letter, relay-indexed** tag, so clients can filter fulfilled vs. open bounties server-side (`"#v": ["unfulfilled"]`). A multi-letter `status` tag (NIP-99 style) would not be indexed and would be pointless next to the `a` tag — so the choice was either *no tag* (derive everywhere client-side) or *a single-letter tag*. We take `v` because it keeps listings filterable. It is kept in lock-step with the `a` selection by always rebuilding it at publish time.
- **Why `v`:** `s` is already used (NIP-SHORT short-address code) and `t` is hashtags; `v` is unused by any NIP and by DEG Mods, so it's claimed here for bounty status. (`b`, `o`, `w` are likewise free and held in reserve.)

### `a` + `p` — Winner Selection

Present only once the requester has picked a fulfiller. See [Fulfilment & winner selection](#fulfilment--winner-selection).

```json
["a", "31142:<fulfiller-hex>:<mod-d>"],
["p", "<fulfiller-hex>"]
```

- **`a`** → the coordinate of the chosen **mod** (`31142:…`). Its presence is what makes the bounty `fulfilled`.
- **`p`** → the chosen fulfiller's pubkey (for easy "who fulfilled it" rendering and notification).
- Exactly one winner (the "primary" fulfiller). The requester can change their pick by re-publishing with a different `a`/`p`, or clear it (back to `unfulfilled`) by removing them.

---

## Fulfilment & winner selection

Two separate writes by two different owners — don't conflate them:

### 1. A creator submits a fulfilment (mod → bounty)

A fulfilment is **not** a new kind. It's a normal **mod** (kind `31142`) carrying two extra tags that point at the bounty — exactly mirroring how [jam entries](./jam-event.md#submissions--linking-an-entry-to-a-jam) link to a jam:

```jsonc
{
  "kind": 31142,
  "tags": [
    ["d", "e47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["g", "Grand Theft Auto VI"],
    ["title", "Cockpit Cam"],
    /* …all the usual mod tags… */

    ["a", "31144:<requester-hex>:b7f3c2a1-…", "bounty-fulfillment"] // which bounty + role
  ]
}
```

- **`a`** → the bounty's coordinate (`31144:…`), with the role `"bounty-fulfillment"` as the tag's **third value** — exactly how jam entries now carry `["a", <jam-coord>, "jam-entry"]`. Unambiguous because that coordinate's kind can only be a bounty. One mod could fulfil more than one bounty (multiple `a` tags).
- **Legacy form read too:** a bare `["a", <bounty-coord>]` alongside a separate `["l", "bounty-fulfillment"]` label is also recognised on read, mirroring `isJamEntry`.

**Query a bounty's fulfilments** (by the indexed `a` coordinate; the role/kind is re-checked client-side):

```json
{ "kinds": [31142], "#a": ["31144:<pubkey>:<d>"] }
```

**A fulfilment is *valid* (rendered on the bounty page, selectable as winner) only if:**

- **It is a mod (`31142`).** Other kinds carrying the tag are ignored.
- **Its `g` equals the bounty's `g`.** A bounty for game X can only be fulfilled by a mod for game X. This both enforces the semantics and blocks spraying unrelated mods at a bounty. Clients drop mismatches on read; the editor refuses to write a mismatch (see guard below).
- **It is authored by the submitter** — inherent, since a mod is a replaceable event under its author's pubkey. The editor guard (below) prevents even attempting to tag a mod you don't own.

### 2. The requester picks a winner (bounty → mod)

The requester edits **their own** bounty event, adding the [winner selection](#a--p--winner-selection) (`a` → the chosen mod coordinate, `p` → the fulfiller) and — automatically — flipping `v` to `fulfilled`. Because the bounty is the requester's own replaceable event, they may point `a`/`p` at anyone's mod; no ownership restriction applies to *this* write (unlike the mod-side link).

### Editor guard (applies to bounties **and**, retrofitted, to jams)

When a mod editor writes the link tag (the "Fulfils bounty" / "Submit to jam" field), the client validates before publishing. The link is accepted only if the field is **empty**, or **all** of:

1. the pasted address resolves to a real event of the **expected kind** (`31144` for a bounty, `31143` for a jam),
2. that event's `g` **matches** the mod's `g`, and
3. the mod being edited is **owned by the signed-in user**.

Any failure → a clear error and the publish is blocked.

---

## Reward Pledges (Kind 31244)

A third party cannot edit someone else's bounty, so an **additional** reward offered by anyone else is its own small addressable event referencing the bounty.

```json
{
  "kind": 31244,
  "pubkey": "<pledger-hex>",
  "content": "",
  "tags": [
    ["d", "<uuid>"],
    ["a", "31144:<requester-hex>:b7f3c2a1-…"],
    ["l", "bounty-reward"],
    ["g", "Grand Theft Auto VI"],
    ["reward", "20,000 sats", "zapped on release"]
  ]
}
```

- **Addressable** (`d` tag) → the pledger can edit or withdraw (replace, or NIP-09 delete) their own offer.
- **`a`** → the bounty coordinate. Because `a` is relay-indexed, a bounty's pledges are directly queryable: `{ "kinds": [31244], "#a": ["31144:<pubkey>:<d>"] }`.
- **`l`** → bare label `"bounty-reward"`.
- **`g`** → must match the bounty's game (same guard as fulfilments).
- **`reward`** → same `["reward", "<what>", "<how>"]` shape as the bounty's own reward.
- Purely descriptive, trust-based, no settlement — identical philosophy to the bounty reward. The bounty page lists these under the requester's own reward ("Also offered: 20,000 sats — @alice").

> Reward pledges are a **reserved, later phase.** The kind is specified and claimed now so the schema is stable; the core bounty + fulfilment loop ships first.

---

## Bounty Tag Summary (`31144`)

| Tag | Required | Repeatable | Format | Notes |
|---|---|---|---|---|
| `d` | Yes | No | UUID v4 | Coordinate identifier |
| `published_at` | Yes | No | Unix ts string | Set once |
| `updated_at` | No | No | Unix ts string | Wall-clock time of an edit; display only, not indexed |
| `title` | Yes | No | Text | |
| `image` | No | No | Image URL | Optional card cover |
| `summary` | No | No | Text | Falls back to first line of `content` |
| `g` | **Yes (exactly 1)** | No | Game name | The game the mod is wanted for |
| `b` | **Yes (exactly 1)** | No | Bounty type | `game-mod` for DEG Mods; a general-purpose discriminator (relay-indexed), strict-matched like jam `j` |
| `reward` | No | No | `what` + optional `how` | Descriptive only |
| `t` | No | Yes | Keyword | Lowercase |
| `content-warning` | No | No | Reason string | NIP-36 NSFW flag (toggle; value usually `nsfw`) |
| `v` | Yes (auto) | No | `unfulfilled` \| `fulfilled` | Derived from the `a` selection; relay-indexed |
| `a` | No | No | `31142:<pk>:<d>` | Winner selection (chosen mod). Presence ⇒ `fulfilled` |
| `p` | With `a` | No | hex pubkey | Chosen fulfiller |

**Client caps** (policy, not protocol): title/summary length limits as per mods; `content` capped well under the 64 KB event ceiling; `t` ≤ 20.

**Status is never authored by hand.** `v` is always recomputed from the presence/absence of the winner `a` tag at publish time, so it can't drift.

---

## Removed vs. the Mod Event

A bounty is "a mod request, not a mod." Removed from `31142`: `download`, categories (`c`/`h`/`f`), emulation/platform, `m` (for another mod), `repost`, `permissions`, `credits`, `dependencies`. Added: mandatory single `g`, `reward`, and the derived `v` status plus the `a`/`p` winner selection.

---

## Conclusions / Design Decisions So Far

- **Addressable (`31144`) so the requester can edit** — marking a winner is an edit to their own event, which is why a replaceable kind was chosen.
- **Status is derived, surfaced as `v`.** The fulfilled/unfulfilled state is a function of whether a winner `a` tag exists. It's mirrored into a single-letter `v` tag purely so listings stay relay-filterable; it is never a hand-set field. A multi-letter `status` tag was rejected (not indexed → pointless beside the `a` tag), and `t`/`s` were unavailable.
- **Fulfilments reuse the jam-entry pattern, not comments.** A fulfilment is a mod tagged with `a` (bounty coord) + `l` `"bounty-fulfillment"`. Comments remain pure discussion.
- **`g` is mandatory and cross-checked.** Both the bounty and every fulfilment/pledge must name the same game; mismatches are refused on write and dropped on read.
- **Two link directions, two owners.** Mod→bounty (the `a` on a mod) is author-only and game-matched; bounty→mod (the `a` on the bounty) is the requester's own edit and may point anywhere.
- **No money in-protocol.** Rewards (on the bounty and via `31244` pledges) are descriptions only. A future phase may wire the existing `PAYTO` (kind 10133, NIP-A3) payment targets for one-click payout — out of scope here.
- **Anyone logged in can post a bounty** (PoW anti-spam, like other posts). Reward pledges and the "Featured Mod Bounties" landing surface are later phases.
