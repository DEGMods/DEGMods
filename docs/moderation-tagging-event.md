# Moderation Tagging Event (kind 30985)

An addressable event that **applies tags to a post someone else wrote**.

A Nostr event is signed by its author and can never be edited by anyone else —
that's the point of the signature. So when an author publishes a mod and forgets
to mark it NSFW, or doesn't declare that it's a repost of someone else's work,
there is no way to fix the post itself. The only honest option is a *separate*
event that says "treat that post as though it also carried these tags", which
readers merge in at render time.

That's all this is: a small, replaceable overlay, keyed by the post it points at.

---

## It is not a moderation-specific format

The name describes what DEG MODS uses it for, not what it can carry. The
envelope is **addressing only**; **every other tag is payload**, applied verbatim
to the target. Nothing in the event format knows what `content-warning` means.

So any client can attach any tag it understands, for any purpose:

| Client wants to… | Payload it publishes |
|---|---|
| mark a post NSFW | `["content-warning", "nsfw"]` |
| flag a repost | `["repost", "true", "<who>"]` |
| add topics | `["t", "cyberpunk"]` |
| record a language | `["l", "pt-BR", "ISO-639-1"]` |
| anything of its own | `["whatever", "…"]` |

A reader simply ignores payload tags it doesn't recognise. DEG MODS reads exactly
two today (`content-warning` and `repost`); another client reading the same
events is free to read others, or to publish tags DEG MODS ignores.

Two consequences worth being explicit about:

- **The kind carries no authority of its own.** Anyone can publish an overlay
  pointing at any post. It means nothing until a reader decides *whose* overlays
  to honour. DEG MODS honours exactly one pubkey — its `ADMIN_PUBKEY`. A
  different client would pick its own, or a set, or a web of trust.
- **The meaning lives in the reader, not the kind.** Two clients can attach the
  same tag with different intent. That's the cost of a general primitive, and
  it's the same trade NIP-32 makes.

---

## Event shape

```jsonc
{
  "kind": 30985,
  "pubkey": "<whoever is tagging>",
  "tags": [
    // ── envelope: addressing only ──
    ["d", "31142:<author>:<mod-d>"],   // the target — also the addressable key
    ["a", "31142:<author>:<mod-d>"],   // target pointer (or ["e", "<id>"])
    ["k", "31142"],                     // target kind
    ["L", "moderation"],                // namespace (see below)

    // ── payload: applied to the target ──
    ["content-warning", "nsfw"],
    ["repost", "true", "<npub, name, or link>"]
  ],
  "content": ""    // optional note explaining the decision
}
```

**`d` is the target address**, which is what makes this work:

- For addressable posts (mods `31142`, legacy mods `30402`, blogs `30023`, jams
  `31143`) it's the `kind:pubkey:d` coordinate, and the pointer is an `a` tag.
- For regular events (notes `1`, comments `1111`) it's the event id, and the
  pointer is an `e` tag.

Because kind 30985 is addressable, `(kind, pubkey, d)` identifies exactly one
overlay per author per post. Re-tagging **replaces** it. There is never a pile of
conflicting overlays to reconcile — just the newest one.

### Clearing tags

Publish the same overlay again **without** the tag. An overlay with no payload
tags left means "this author tags nothing here".

**Deletion (kind 5) is deliberately not used.** Relays don't reliably drop
tombstoned events, so a deletion may or may not take effect anywhere in
particular. A replacement always does — every relay that had the old version now
has the empty one. A cleared overlay that still exists is far more dependable
than one that was asked to disappear.

### Why `L: moderation`

NIP-32's *self-reporting* rule states that `l`/`L` tags on kinds **other than
1985** label the event itself rather than a target. Kind 30985 is not 1985, so
`["L", "moderation"]` reads correctly as *"this overlay is a moderation
action"* — it isn't a hijacked letter.

It also gives the one query that matters for accountability:

```jsonc
{ "kinds": [30985], "authors": ["<pubkey>"], "#L": ["moderation"] }
```

→ everything that pubkey has ever tagged. Nothing is hidden; anyone can audit a
moderator by fetching their overlays.

### Relationship to NIP-32

NIP-32 already covers the general idea — its `L` values beginning with `#` mean
"associate this standard nostr tag with the target". Two gaps justify a separate
kind rather than reusing 1985:

1. **Kind 1985 is a regular event**, so it is not replaceable. Un-tagging would
   depend on kind-5 deletions, which is exactly the unreliable path above.
2. **`l` values are single strings**, so they cannot express a multi-element tag
   like `["repost", "true", "<author>"]`.

If this is ever written up as a NIP, it should be positioned as *addressable
NIP-32 with multi-value payloads*, not as an alternative to it.

---

## How readers apply it

**Tags are additive.** The effective value is *the post's own tag OR the
overlay's*. An overlay adds what an author left off; it never removes what an
author set deliberately. A mod its author marked NSFW stays NSFW regardless of
any overlay, or of whether the overlay ever loads.

### Fetching is scoped, not preloaded

The set of tagged posts grows with the catalogue, so DEG MODS does **not** fetch
them all. Instead:

- Cards ask for their own coordinate; requests from separate cards are
  **coalesced into one query per tick** (a 20-card page produces one query, not
  20).
- Queries are batched at **40 coordinates** per filter. Much beyond that the
  `#d` filter becomes a large request some relays reject.
- Results are cached **including negatives** — a "checked, clean" marker. Without
  it there is no way to tell an unflagged post from an unchecked one, so every
  render would re-query forever. The cache is persisted, so repeat visits are
  instant.

```jsonc
// what one page of mods asks for
{ "kinds": [30985], "authors": ["<ADMIN>"], "#d": ["<coord1>", …, "<coord40>"] }
```

### Revealing is gated on the check

Anything that could *expose* something waits for the overlay to settle; anything
that can't doesn't:

- **The featured image waits** — but never for long (see below). A mod the admin
  marked NSFW should not paint before we know. Title, author and layout render
  immediately regardless.
- **Badges don't wait.** A repost badge appearing a moment late is harmless.
- **Posts the author already tagged don't wait at all** — that signal is in the
  mod event itself, so it applies with no network involved.

### The wait is capped at 1.5s

This gate was originally designed on the assumption that the overlay query beats
the image download — one small query against hundreds of KB of image. **Measured,
that is not true here.** On a cold load the query queues behind the listing,
profile and legacy fetches in the relay pool's read throttle; images sat blurred
for around **nine seconds**.

So the gate is capped. After `GATE_MS` (1.5s) the post is treated as checked and
renders. The query is *not* cancelled — if the real answer arrives later it is
still applied, so a late "this is NSFW" still blurs the image, just late.

In practice the cap only ever bites on the **first** view of a given post: results
are cached (including negatives) and persisted, so afterwards the answer is
already in hand and there is no wait at all.

### Failure resolves open

Same rule, reached sooner. If the query times out or fails, the post is marked
checked **for that session only** and renders normally. The failure is not
written to the persisted cache, so the next visit tries again.

This is a deliberate trade: a relay hiccup shows an admin-corrected post
untagged, rather than freezing the grid behind blurred images. Author-tagged
content is unaffected, so what's at risk is only the *correction* layer.

---

## Using it as the admin

**Settings → Moderation → Moderation Tags.**

1. Open the post you want to tag and copy its address — the `naddr` for a mod,
   blog or jam, or the `nevent` for a note. A raw `kind:pubkey:d` coordinate
   works too.
2. Paste it into the address field.
3. Toggle the tags to apply:
   - **Content warning (NSFW)** — with the reason readers will see (defaults to
     `nsfw`).
   - **Repost** — optionally with the original author as an npub, a name, or a
     link.
4. **Publish tags.**

The **Published tags** list below shows everything you've tagged, newest first,
resolved to post titles with a link to each post. From there you can **edit** an
entry (loads it back into the form) or **clear** it (publishes an empty overlay,
removing your tags from that post).

Because the overlay is keyed by the post, publishing again for the same post
updates it rather than adding a second entry.

---

## Files

| File | Role |
|---|---|
| [`src/lib/nostr/moderationTags.ts`](../src/lib/nostr/moderationTags.ts) | Event build/parse, address parsing, last-write-wins merge |
| [`src/stores/moderationTagsStore.ts`](../src/stores/moderationTagsStore.ts) | Scoped batched fetching, negative cache, fail-open |
| [`src/hooks/useModerationTags.ts`](../src/hooks/useModerationTags.ts) | `useModerationOverlay`, `useEffectiveModFlags` |
| [`src/components/admin/AdminSettings.tsx`](../src/components/admin/AdminSettings.tsx) | `ModerationTagsSection` — the admin UI |
