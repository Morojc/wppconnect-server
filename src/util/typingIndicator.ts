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

export interface TypingOptions {
  enabled?: boolean;
  msPerChar?: number;
  minMs?: number;
  maxMs?: number;
}

export const DEFAULT_TYPING_OPTIONS: Required<TypingOptions> = {
  enabled: true,
  msPerChar: 45,
  minMs: 800,
  maxMs: 5000,
};

// A caller-supplied duration is honoured verbatim, but never past this — the
// indicator is held with an in-flight HTTP request open behind it, so an
// unbounded value would just hang the client.
export const TYPING_HARD_CAP_MS = 20000;

function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * How long to hold "typing…" before a message goes out, in milliseconds.
 * `0` means don't show it at all.
 *
 * `override` is the request body's `typing` field and wins over the server
 * config: `false` skips the indicator, `true` forces it on even when the
 * server default is off, and a number sets the duration explicitly.
 */
export function resolveTypingDelay(
  message: unknown,
  override?: unknown,
  config: TypingOptions = {}
): number {
  const explicitMs =
    typeof override === 'boolean' ? undefined : toPositiveNumber(override);
  if (explicitMs !== undefined) return clamp(explicitMs, 0, TYPING_HARD_CAP_MS);

  const flag = toBool(override);
  if (flag === false) return 0;

  const enabled =
    flag === true
      ? true
      : config.enabled !== undefined
      ? config.enabled
      : DEFAULT_TYPING_OPTIONS.enabled;
  if (!enabled) return 0;

  const msPerChar =
    toPositiveNumber(config.msPerChar) ?? DEFAULT_TYPING_OPTIONS.msPerChar;
  const minMs = toPositiveNumber(config.minMs) ?? DEFAULT_TYPING_OPTIONS.minMs;
  const maxMs = toPositiveNumber(config.maxMs) ?? DEFAULT_TYPING_OPTIONS.maxMs;

  const length = typeof message === 'string' ? message.length : 0;
  // A misconfigured min > max would otherwise make clamp() return the min and
  // silently blow past the ceiling the operator actually set.
  return clamp(length * msPerChar, Math.min(minMs, maxMs), maxMs);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The chat id the typing state has to be addressed to, which is not always the
 * id we send to.
 *
 * `startTyping` calls `WPP.chat.markIsComposing`, which asserts an ALREADY
 * EXISTING Chat; `sendText` calls `WPP.chat.sendTextMessage`, which happily
 * creates one. For a contact WhatsApp addresses by LID the phone JID has no
 * Chat object, so the send lands while typing dies with `Chat not found` —
 * see the LID notes in src/middleware/statusConnection.ts.
 *
 * `WPP.chat.find` returns the chat WhatsApp actually keeps for that contact
 * (its id is the LID when the contact is LID-addressed), which is the one the
 * recipient is looking at. The library leans on the same call in `pinChat`'s
 * `nonExistent` path. Best-effort: on any failure we fall back to the original
 * id and let startTyping decide.
 */
export async function resolveTypingChatId(
  client: any,
  chatId: string,
  logger?: any
): Promise<string> {
  if (typeof client?.page?.evaluate !== 'function') return chatId;

  try {
    const resolved = await client.page.evaluate(async (id: string) => {
      const chat = await (window as any).WPP.chat.find(id);
      return chat?.id?._serialized ?? null;
    }, chatId);
    return typeof resolved === 'string' && resolved ? resolved : chatId;
  } catch (error) {
    logger?.warn?.(`Could not resolve typing chat for ${chatId}: ${error}`);
    return chatId;
  }
}

/**
 * Hold the "typing…" state on `chatId` for `delayMs`, then clear it.
 *
 * Presence is cosmetic, so nothing here is allowed to fail a send: if the
 * chat state can't be set we return immediately and let the message go out
 * rather than charging the caller the delay for an indicator nobody saw.
 */
export async function showTypingIndicator(
  client: any,
  chatId: string,
  delayMs: number,
  logger?: any
): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  if (typeof client?.startTyping !== 'function') return;

  const target = await resolveTypingChatId(client, chatId, logger);
  if (target !== chatId) {
    logger?.debug?.(`Typing indicator for ${chatId} addressed to ${target}`);
  }

  try {
    // Do NOT sleep `delayMs` on top of this call. wa-js's markIsComposing
    // awaits its own `duration` timer before resolving (and marks paused at
    // the end), so passing the duration AND sleeping held the indicator for
    // twice the configured time. Its docs describe the argument as fire-and-
    // forget though, so rather than depend on it blocking, wait out whatever
    // is left over — correct whichever way the library behaves.
    const startedAt = Date.now();
    await client.startTyping(target, delayMs);
    const remaining = delayMs - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
  } catch (error) {
    logger?.warn?.(`Could not show typing indicator for ${target}: ${error}`);
    return;
  }

  try {
    await client.stopTyping(target);
  } catch (error) {
    logger?.warn?.(`Could not clear typing indicator for ${target}: ${error}`);
  }
}
