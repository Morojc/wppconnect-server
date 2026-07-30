/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * LID -> phone number resolution.
 *
 * WhatsApp's privacy-era addressing gives every contact a LID ("linked id",
 * `<digits>@lid`) alongside its phone JID (`<msisdn>@c.us`). Inbound webhooks
 * increasingly carry the LID as the chat/sender id, so an app that simply
 * replies to `from` ends up asking us to send to `163733095633036@lid`.
 *
 * That address only routes if the *session's local mapping* already knows
 * which phone number the LID belongs to. When it doesn't, WhatsApp accepts the
 * message and then fails it server-side: the stored message comes back with
 * `isSendFailure: true` and ack -1, which wppconnect does NOT throw on (it only
 * throws when `erro === true`), so the API answers 201 and the send silently
 * never arrives.
 *
 * The fix is to translate the LID to its phone JID before handing it to
 * `sendText` & friends. Resolution is attempted in three escalating steps,
 * cheapest first:
 *
 *   1. `client.getPnLidEntry()` — wa-js `WPP.contact.getPnLidEntry`, which for a
 *      LID input reads `lidPnCache` only (it never queries the server in that
 *      direction).
 *   2. `ContactStore` — the contact model's `pnForLid`, a mapping source that is
 *      populated independently of `lidPnCache` and often survives when the
 *      cache is cold after a restart.
 *   3. `WPP.contact.queryExists()` — the one path that asks WhatsApp's servers.
 *      Only accepted when it answers with a real `@c.us` wid.
 *
 * A LID that resolves nowhere is genuinely un-addressable by phone from this
 * account (the contact hides its number): callers keep the original `@lid`,
 * which is still the best available address and works whenever the chat is
 * already known to the session.
 */

/** Matches a fully-formed LID JID, e.g. `163733095633036@lid`. */
export function isLid(id: any): boolean {
  return /@lid$/i.test(String(id ?? ''));
}

/** Matches a fully-formed phone JID, e.g. `212612345678@c.us`. */
export function isPhoneJid(id: any): boolean {
  return /^\d+@c\.us$/i.test(String(id ?? ''));
}

interface CacheEntry {
  phone: string | null;
  expiresAt: number;
}

// A LID<->phone mapping never changes, so a hit can be held for a long time.
// A miss is re-checked often: the mapping usually shows up shortly after the
// contact's next message, and we don't want a cold-start miss pinned for hours.
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

function cacheKey(session: any, lid: string): string {
  return `${session ?? '-'}:${lid.toLowerCase()}`;
}

/**
 * Drops cached mappings — for one session, or all of them when called with no
 * argument. Sessions that are logged out and re-paired get a fresh LID cache.
 */
export function clearLidCache(session?: string): void {
  if (!session) {
    cache.clear();
    return;
  }
  const prefix = `${session}:`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

async function fromPnLidEntry(
  client: any,
  lid: string
): Promise<string | null> {
  if (typeof client?.getPnLidEntry !== 'function') return null;
  const entry: any = await client.getPnLidEntry(lid);
  const phone = entry?.phoneNumber?._serialized;
  return isPhoneJid(phone) ? phone : null;
}

/**
 * Steps 2 and 3, run in a single page evaluation so a miss costs one round trip
 * to the browser instead of two. Every lookup is individually guarded: wa-js
 * internals move between versions, and a resolution failure must degrade to
 * "send to the LID" rather than break the request.
 */
async function fromBrowser(client: any, lid: string): Promise<string | null> {
  if (!client?.page) return null;

  const phone = await client.page.evaluate(async (lidId: string) => {
    const WPP = (window as any).WPP;
    if (!WPP?.whatsapp) return null;

    const serialize = (wid: any): string | null => {
      if (!wid) return null;
      if (typeof wid === 'string') return wid;
      return wid._serialized || (wid.toString ? wid.toString() : null);
    };

    let wid: any;
    try {
      wid = WPP.whatsapp.WidFactory.createWid(lidId);
    } catch (e) {
      return null;
    }

    try {
      const cached = WPP.whatsapp.lidPnCache?.getPhoneNumber?.(wid);
      if (cached) return serialize(cached);
    } catch (e) {
      /* fall through to the next source */
    }

    try {
      const contact = WPP.whatsapp.ContactStore?.get?.(wid);
      if (contact?.pnForLid) return serialize(contact.pnForLid);
    } catch (e) {
      /* fall through to the next source */
    }

    try {
      const found = await WPP.contact.queryExists(lidId);
      // For a LID input this answers with the input wid whenever it hit a local
      // store; only a server round trip yields the phone wid. The caller filters
      // on `@c.us`, so echoing the LID back is harmless.
      return serialize(found?.wid);
    } catch (e) {
      return null;
    }
  }, lid);

  return isPhoneJid(phone) ? (phone as string) : null;
}

/**
 * Resolves `<digits>@lid` to `<msisdn>@c.us` for the given session.
 *
 * Returns null when the id isn't a LID, when the session can't map it, or when
 * resolution errors out — callers should fall back to the original id.
 */
export async function resolveLidToPhone(
  client: any,
  lid: string,
  logger?: any
): Promise<string | null> {
  if (!isLid(lid)) return null;

  const key = cacheKey(client?.session, lid);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.phone;

  // Each source is isolated: one throwing (an unmapped wa-js internal, a page
  // that navigated mid-call) must not cost us the remaining sources.
  let phone: string | null = null;
  try {
    phone = await fromPnLidEntry(client, lid);
  } catch (error) {
    logger?.warn?.(`getPnLidEntry failed for LID ${lid}: ${error}`);
  }
  if (!phone) {
    try {
      phone = await fromBrowser(client, lid);
    } catch (error) {
      logger?.warn?.(`Browser LID lookup failed for ${lid}: ${error}`);
    }
  }

  cache.set(key, {
    phone,
    expiresAt: Date.now() + (phone ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });

  if (phone) {
    logger?.info?.(`Resolved LID ${lid} to ${phone}`);
  } else {
    logger?.warn?.(
      `LID ${lid} has no phone number mapped in this session; sending to the LID as-is. ` +
        `If the send fails, the contact hides its number — ` +
        `POST /api/{session}/contact/request-phone-number/${lid} to ask for it.`
    );
  }

  return phone;
}
