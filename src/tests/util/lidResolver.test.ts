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
  clearLidCache,
  isLid,
  isPhoneJid,
  resolveLidToPhone,
} from '../../util/lidResolver';

const LID = '163733095633036@lid';
const PHONE = '212612345678@c.us';

function makeClient(overrides: any = {}) {
  return {
    session: 'test-session',
    getPnLidEntry: jest.fn().mockResolvedValue({}),
    page: { evaluate: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

beforeEach(() => {
  clearLidCache();
});

describe('isLid / isPhoneJid', () => {
  it('recognizes a LID JID', () => {
    expect(isLid(LID)).toBe(true);
    expect(isLid('163733095633036@LID')).toBe(true);
  });

  it('rejects everything that is not a LID JID', () => {
    expect(isLid(PHONE)).toBe(false);
    expect(isLid('123@g.us')).toBe(false);
    expect(isLid('163733095633036')).toBe(false);
    expect(isLid(undefined)).toBe(false);
  });

  it('recognizes only a digits-only @c.us JID as a phone JID', () => {
    expect(isPhoneJid(PHONE)).toBe(true);
    expect(isPhoneJid(LID)).toBe(false);
    expect(isPhoneJid('+212612345678@c.us')).toBe(false);
    expect(isPhoneJid(undefined)).toBe(false);
  });
});

describe('resolveLidToPhone', () => {
  it('ignores ids that are not LIDs', async () => {
    const client = makeClient();
    expect(await resolveLidToPhone(client, PHONE)).toBeNull();
    expect(client.getPnLidEntry).not.toHaveBeenCalled();
  });

  it('resolves through getPnLidEntry when the mapping is cached in wa-js', async () => {
    const client = makeClient({
      getPnLidEntry: jest.fn().mockResolvedValue({
        lid: { _serialized: LID },
        phoneNumber: { _serialized: PHONE },
      }),
    });

    expect(await resolveLidToPhone(client, LID)).toBe(PHONE);
    expect(client.page.evaluate).not.toHaveBeenCalled();
  });

  it('falls back to the browser lookup when getPnLidEntry has no phone number', async () => {
    const client = makeClient({
      page: { evaluate: jest.fn().mockResolvedValue(PHONE) },
    });

    expect(await resolveLidToPhone(client, LID)).toBe(PHONE);
    expect(client.getPnLidEntry).toHaveBeenCalledWith(LID);
    expect(client.page.evaluate).toHaveBeenCalled();
  });

  it('still tries the browser lookup when getPnLidEntry throws', async () => {
    const client = makeClient({
      getPnLidEntry: jest.fn().mockRejectedValue(new Error('invalid wid')),
      page: { evaluate: jest.fn().mockResolvedValue(PHONE) },
    });
    const logger = { info: jest.fn(), warn: jest.fn() };

    expect(await resolveLidToPhone(client, LID, logger)).toBe(PHONE);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('discards a browser answer that is not a phone JID', async () => {
    // queryExists echoes the LID back when it only hit a local store — that is
    // not a resolution and must not be handed to the sender as one.
    const client = makeClient({
      page: { evaluate: jest.fn().mockResolvedValue(LID) },
    });

    expect(await resolveLidToPhone(client, LID)).toBeNull();
  });

  it('returns null when no source knows the mapping, and warns', async () => {
    const client = makeClient();
    const logger = { info: jest.fn(), warn: jest.fn() };

    expect(await resolveLidToPhone(client, LID, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(LID));
  });

  it('serves a resolved mapping from cache instead of re-querying', async () => {
    const client = makeClient({
      getPnLidEntry: jest
        .fn()
        .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
    });

    await resolveLidToPhone(client, LID);
    await resolveLidToPhone(client, LID);

    expect(client.getPnLidEntry).toHaveBeenCalledTimes(1);
  });

  it('caches misses too, so an unmapped LID is not re-queried on every send', async () => {
    const client = makeClient();

    await resolveLidToPhone(client, LID);
    await resolveLidToPhone(client, LID);

    expect(client.getPnLidEntry).toHaveBeenCalledTimes(1);
  });

  it('keeps caches separate per session', async () => {
    const a = makeClient({
      session: 'a',
      getPnLidEntry: jest
        .fn()
        .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
    });
    const b = makeClient({ session: 'b' });

    expect(await resolveLidToPhone(a, LID)).toBe(PHONE);
    expect(await resolveLidToPhone(b, LID)).toBeNull();
    expect(b.getPnLidEntry).toHaveBeenCalledTimes(1);
  });

  it('clearLidCache(session) drops only that session and forces a re-query', async () => {
    const client = makeClient({
      getPnLidEntry: jest
        .fn()
        .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
    });

    await resolveLidToPhone(client, LID);
    clearLidCache('another-session');
    await resolveLidToPhone(client, LID);
    expect(client.getPnLidEntry).toHaveBeenCalledTimes(1);

    clearLidCache('test-session');
    await resolveLidToPhone(client, LID);
    expect(client.getPnLidEntry).toHaveBeenCalledTimes(2);
  });

  it('works on a client without getPnLidEntry (older wppconnect)', async () => {
    const client = makeClient({
      getPnLidEntry: undefined,
      page: { evaluate: jest.fn().mockResolvedValue(PHONE) },
    });

    expect(await resolveLidToPhone(client, LID)).toBe(PHONE);
  });
});
