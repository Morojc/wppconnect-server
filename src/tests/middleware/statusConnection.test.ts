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
import statusConnection from '../../middleware/statusConnection';
import { clearLidCache } from '../../util/lidResolver';

const LID = '163733095633036@lid';
const PHONE = '212612345678@c.us';

function makeReq(body: any = {}, clientOverrides: any = {}) {
  return {
    body,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    serverOptions: {},
    client: {
      session: 'test-session',
      isConnected: jest.fn().mockResolvedValue(true),
      checkNumberStatus: jest
        .fn()
        .mockResolvedValue({ numberExists: true, id: { _serialized: PHONE } }),
      getPnLidEntry: jest.fn().mockResolvedValue({}),
      page: { evaluate: jest.fn().mockResolvedValue(null) },
      ...clientOverrides,
    },
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  clearLidCache();
});

describe('statusConnection LID handling', () => {
  it('rewrites a LID recipient to its phone JID before the controller sends', async () => {
    const req = makeReq(
      { phone: LID, isLid: true },
      {
        getPnLidEntry: jest
          .fn()
          .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
      }
    );
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(req.body.phone).toEqual([PHONE]);
    expect(next).toHaveBeenCalled();
    // A LID is not an MSISDN — it must never reach checkNumberStatus, which is
    // what used to answer "o número não existe" and 400 the request.
    expect(req.client.checkNumberStatus).not.toHaveBeenCalled();
  });

  it('detects a LID from the JID suffix even when isLid is not set', async () => {
    const req = makeReq(
      { phone: LID },
      {
        getPnLidEntry: jest
          .fn()
          .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
      }
    );
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(req.body.phone).toEqual([PHONE]);
    expect(req.client.checkNumberStatus).not.toHaveBeenCalled();
  });

  it('keeps the LID when no phone number is mapped to it', async () => {
    const req = makeReq({ phone: LID, isLid: true });
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(req.body.phone).toEqual([LID]);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('honors resolveLid: false in the request body', async () => {
    const req = makeReq(
      { phone: LID, isLid: true, resolveLid: false },
      {
        getPnLidEntry: jest
          .fn()
          .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
      }
    );
    const res = makeRes();

    await statusConnection(req, res, jest.fn());

    expect(req.body.phone).toEqual([LID]);
    expect(req.client.getPnLidEntry).not.toHaveBeenCalled();
  });

  it('honors lid.resolveToPhone = false in the server options', async () => {
    const req = makeReq(
      { phone: LID, isLid: true },
      {
        getPnLidEntry: jest
          .fn()
          .mockResolvedValue({ phoneNumber: { _serialized: PHONE } }),
      }
    );
    req.serverOptions = { lid: { resolveToPhone: false } };
    const res = makeRes();

    await statusConnection(req, res, jest.fn());

    expect(req.body.phone).toEqual([LID]);
    expect(req.client.getPnLidEntry).not.toHaveBeenCalled();
  });
});

describe('statusConnection non-LID handling', () => {
  it('still validates plain phone numbers through checkNumberStatus', async () => {
    const req = makeReq({ phone: '212612345678' });
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(req.client.checkNumberStatus).toHaveBeenCalledWith(PHONE);
    expect(req.body.phone).toEqual([PHONE]);
    expect(next).toHaveBeenCalled();
  });

  it('answers 400 once for a number that does not exist', async () => {
    const req = makeReq(
      { phone: '212612345678' },
      {
        checkNumberStatus: jest.fn().mockResolvedValue({ numberExists: false }),
      }
    );
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves group JIDs untouched', async () => {
    const req = makeReq({ phone: '8865623215244578', isGroup: true });
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(req.body.phone).toEqual(['8865623215244578@g.us']);
    expect(req.client.checkNumberStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('answers 404 when the session is not connected', async () => {
    const req = makeReq({ phone: '212612345678' }, { isConnected: undefined });
    const res = makeRes();
    const next = jest.fn();

    await statusConnection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
