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
import {
  DEFAULT_TYPING_OPTIONS,
  resolveTypingChatId,
  resolveTypingDelay,
  showTypingIndicator,
  TYPING_HARD_CAP_MS,
} from '../../util/typingIndicator';

const CHAT = '163733095633036@lid';
const PHONE = '212666178020@c.us';
const CONFIG = { enabled: true, msPerChar: 50, minMs: 500, maxMs: 4000 };

function makeClient(overrides: any = {}) {
  return {
    startTyping: jest.fn().mockResolvedValue(undefined),
    stopTyping: jest.fn().mockResolvedValue(undefined),
    // By default the page resolves a chat id back to itself, so tests that
    // don't care about LID mapping behave like a plain @c.us contact.
    page: {
      evaluate: jest.fn(async (fn: any, id: string) => id),
    },
    ...overrides,
  };
}

function pageResolving(to: string | null) {
  return { evaluate: jest.fn().mockResolvedValue(to) };
}

describe('resolveTypingDelay', () => {
  it('scales with the message length', () => {
    expect(resolveTypingDelay('a'.repeat(20), undefined, CONFIG)).toBe(1000);
    expect(resolveTypingDelay('a'.repeat(40), undefined, CONFIG)).toBe(2000);
  });

  it('clamps to minMs and maxMs', () => {
    expect(resolveTypingDelay('hi', undefined, CONFIG)).toBe(CONFIG.minMs);
    expect(resolveTypingDelay('a'.repeat(500), undefined, CONFIG)).toBe(
      CONFIG.maxMs
    );
  });

  it('falls back to the built-in defaults when unconfigured', () => {
    expect(resolveTypingDelay('hi')).toBe(DEFAULT_TYPING_OPTIONS.minMs);
  });

  it('is off when the server config disables it', () => {
    expect(resolveTypingDelay('hello', undefined, { enabled: false })).toBe(0);
  });

  it('lets the request opt out', () => {
    expect(resolveTypingDelay('hello', false, CONFIG)).toBe(0);
    expect(resolveTypingDelay('hello', 'false', CONFIG)).toBe(0);
  });

  it('lets the request force it on over a disabled server config', () => {
    const config = { ...CONFIG, enabled: false };
    expect(resolveTypingDelay('a'.repeat(20), true, config)).toBe(1000);
    expect(resolveTypingDelay('a'.repeat(20), 'true', config)).toBe(1000);
  });

  it('honours an explicit duration, length and config notwithstanding', () => {
    expect(resolveTypingDelay('hi', 3000, CONFIG)).toBe(3000);
    expect(resolveTypingDelay('hi', '3000', { enabled: false })).toBe(3000);
    expect(resolveTypingDelay('hi', 0, CONFIG)).toBe(0);
  });

  it('caps an explicit duration so a caller cannot hang the request', () => {
    expect(resolveTypingDelay('hi', 10 * 60 * 1000, CONFIG)).toBe(
      TYPING_HARD_CAP_MS
    );
  });

  it('ignores junk overrides and negative durations', () => {
    expect(resolveTypingDelay('hi', 'yes', CONFIG)).toBe(CONFIG.minMs);
    expect(resolveTypingDelay('hi', -500, CONFIG)).toBe(CONFIG.minMs);
  });

  it('never exceeds maxMs even when min is misconfigured above it', () => {
    const config = { enabled: true, msPerChar: 50, minMs: 9000, maxMs: 4000 };
    expect(resolveTypingDelay('hi', undefined, config)).toBe(4000);
  });

  it('treats a missing message as the shortest allowed pause', () => {
    expect(resolveTypingDelay(undefined, undefined, CONFIG)).toBe(CONFIG.minMs);
  });
});

describe('resolveTypingChatId', () => {
  it('maps a phone JID to the chat WhatsApp actually keeps for it', async () => {
    const client = makeClient({ page: pageResolving(CHAT) });
    await expect(resolveTypingChatId(client, PHONE)).resolves.toBe(CHAT);
  });

  it('keeps the original id when the chat cannot be found', async () => {
    const client = makeClient({ page: pageResolving(null) });
    await expect(resolveTypingChatId(client, PHONE)).resolves.toBe(PHONE);
  });

  it('keeps the original id when the lookup throws', async () => {
    const client = makeClient({
      page: { evaluate: jest.fn().mockRejectedValue(new Error('detached')) },
    });
    const logger = { warn: jest.fn() };
    await expect(resolveTypingChatId(client, PHONE, logger)).resolves.toBe(
      PHONE
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps the original id when the client exposes no page', async () => {
    await expect(resolveTypingChatId({}, PHONE)).resolves.toBe(PHONE);
  });
});

describe('showTypingIndicator', () => {
  it('holds then clears the state for the requested duration', async () => {
    const client = makeClient();
    await showTypingIndicator(client, CHAT, 5);
    expect(client.startTyping).toHaveBeenCalledWith(CHAT, 5);
    expect(client.stopTyping).toHaveBeenCalledWith(CHAT);
  });

  it('types against the resolved chat, not the phone JID', async () => {
    // The regression this whole resolution step exists for: typing addressed
    // to the phone JID throws "Chat not found" for a LID-addressed contact.
    const client = makeClient({ page: pageResolving(CHAT) });
    await showTypingIndicator(client, PHONE, 5);
    expect(client.startTyping).toHaveBeenCalledWith(CHAT, 5);
    expect(client.stopTyping).toHaveBeenCalledWith(CHAT);
  });

  it('waits the delay once when startTyping returns immediately', async () => {
    const client = makeClient();
    const startedAt = Date.now();
    await showTypingIndicator(client, CHAT, 60);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(140);
  });

  it('does not double-wait when startTyping blocks for the duration', async () => {
    // wa-js's markIsComposing awaits its own duration timer; sleeping the full
    // delay on top of that held the indicator for twice the configured time.
    const client = makeClient({
      startTyping: jest.fn(
        (_chat: string, duration: number) =>
          new Promise((resolve) => setTimeout(resolve, duration))
      ),
    });
    const startedAt = Date.now();
    await showTypingIndicator(client, CHAT, 60);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(110);
  });

  it('does nothing when the delay is zero', async () => {
    const client = makeClient();
    await showTypingIndicator(client, CHAT, 0);
    expect(client.startTyping).not.toHaveBeenCalled();
    expect(client.stopTyping).not.toHaveBeenCalled();
  });

  it('swallows a startTyping failure so the send still goes out', async () => {
    const client = makeClient({
      startTyping: jest.fn().mockRejectedValue(new Error('no chat state')),
    });
    const logger = { warn: jest.fn() };
    await expect(
      showTypingIndicator(client, CHAT, 5, logger)
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
    // Bailing out early matters: the caller must not pay the delay for an
    // indicator that never appeared.
    expect(client.stopTyping).not.toHaveBeenCalled();
  });

  it('swallows a stopTyping failure', async () => {
    const client = makeClient({
      stopTyping: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const logger = { warn: jest.fn() };
    await expect(
      showTypingIndicator(client, CHAT, 5, logger)
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('is a no-op against a client that cannot type', async () => {
    await expect(showTypingIndicator({}, CHAT, 5)).resolves.toBeUndefined();
  });
});
