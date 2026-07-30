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
import { sendMessage } from '../../controller/messageController';

// functions.ts pulls in config (and with it the environment); sendMessage only
// needs unlinkAsync for the file endpoints, never for a text send.
jest.mock('../../util/functions', () => ({ unlinkAsync: jest.fn() }));
// Presence is cosmetic and already covered by typingIndicator.test.ts; here it
// would only make the test sleep.
jest.mock('../../util/typingIndicator', () => ({
  resolveTypingDelay: jest.fn().mockReturnValue(0),
  showTypingIndicator: jest.fn().mockResolvedValue(undefined),
}));

const TO = '212612345678@c.us';
const MSG_ID = 'true_212612345678@c.us_3EB01DE65ACC6_out';
const SEND_RESULT = { id: MSG_ID, ack: 1 };
const STORED_MESSAGE = { id: MSG_ID, body: 'hi', ack: 1, isSendFailure: false };

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/**
 * `sendMessage` reaches WhatsApp through two page evaluations: the send, then
 * the message read-back. `readBack` decides how the second one behaves.
 */
function makeReq(options: { send?: () => any; readBack?: () => any } = {}) {
  const send = options.send ?? (() => SEND_RESULT);
  const readBack = options.readBack ?? (() => STORED_MESSAGE);

  const fakeWindow = {
    WAPI: { getMessageById: async () => readBack() },
    WPP: {
      chat: { sendTextMessage: async () => send() },
      whatsapp: { MsgStore: { get: () => undefined } },
    },
  };

  return {
    body: { phone: [TO], message: 'hi' },
    client: {
      page: {
        evaluate: async (pageFunction: any, arg: any) => {
          const previous = (global as any).window;
          (global as any).window = fakeWindow;
          try {
            return await pageFunction(arg);
          } finally {
            (global as any).window = previous;
          }
        },
      },
    },
    io: { emit: jest.fn() },
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    serverOptions: {},
  } as any;
}

describe('sendMessage', () => {
  it('answers 201 with the stored message when everything works', async () => {
    const req = makeReq();
    const res = makeRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      response: [STORED_MESSAGE],
      mapper: 'return',
    });
    expect(req.io.emit).toHaveBeenCalledWith('mensagem-enviada', [
      STORED_MESSAGE,
    ]);
  });

  it('answers 201 with enriched:false when only the read-back fails', async () => {
    // The regression this whole change exists for: WhatsApp has the message,
    // wa-js cannot look it up, and the caller used to see HTTP 500 and retry.
    const req = makeReq({
      readBack: () => {
        throw new TypeError(
          "Cannot read properties of undefined (reading 'get')"
        );
      },
    });
    const res = makeRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('success');
    expect(body.response).toEqual([
      {
        ...SEND_RESULT,
        enriched: false,
        lookupError: "Cannot read properties of undefined (reading 'get')",
      },
    ]);
  });

  it('answers 500 when the send itself fails', async () => {
    const req = makeReq({
      send: () => {
        throw new Error('Chat not found');
      },
    });
    const res = makeRes();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Error' })
    );
    expect(req.io.emit).not.toHaveBeenCalled();
  });
});
