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
  enrichSentMessage,
  reply,
  sendListMessage,
  sendOrderMessage,
  sendPixKey,
  sendPollMessage,
  sendText,
} from '../../util/resilientSend';

const TO = '212612345678@c.us';
const MSG_ID = 'true_212612345678@c.us_3EB01DE65ACC6_out';

/** What wa-js hands back from step 1 — the send that actually delivers. */
const SEND_RESULT = { id: MSG_ID, ack: 1, sendMsgResult: {} };

/** What step 2 hands back when WhatsApp Web cooperates. */
const STORED_MESSAGE = {
  id: MSG_ID,
  body: 'hi',
  ack: 1,
  isSendFailure: false,
  from: '999@c.us',
  to: TO,
};

/** The exact TypeError the current WhatsApp Web build produces. */
const MSGS_UNDEFINED = "Cannot read properties of undefined (reading 'get')";

interface ClientOverrides {
  /** Replaces individual `WPP.chat.send*` stubs. */
  chat?: Record<string, any>;
  /** Replaces `WAPI.getMessageById`. */
  getMessageById?: any;
  /** Replaces `WPP.whatsapp.MsgStore.get`. */
  msgStoreGet?: any;
}

/**
 * A client whose `page.evaluate` really runs the page function against a stub
 * `window`, so the browser-side half of resilientSend is under test too and not
 * just the Node wrapper around it.
 */
function makeClient(overrides: ClientOverrides = {}) {
  const chat: Record<string, any> = {
    sendTextMessage: jest.fn().mockResolvedValue(SEND_RESULT),
    sendListMessage: jest.fn().mockResolvedValue(SEND_RESULT),
    sendCreatePollMessage: jest.fn().mockResolvedValue(SEND_RESULT),
    sendChargeMessage: jest.fn().mockResolvedValue(SEND_RESULT),
    sendPixKeyMessage: jest.fn().mockResolvedValue(SEND_RESULT),
    ...(overrides.chat || {}),
  };

  const fakeWindow = {
    WAPI: {
      getMessageById:
        overrides.getMessageById ?? jest.fn().mockResolvedValue(STORED_MESSAGE),
    },
    WPP: {
      chat,
      whatsapp: {
        MsgStore: { get: overrides.msgStoreGet ?? jest.fn() },
      },
    },
  };

  const client: any = {
    page: {
      evaluate: jest.fn(async (pageFunction: any, arg: any) => {
        const previous = (global as any).window;
        (global as any).window = fakeWindow;
        try {
          return await pageFunction(arg);
        } finally {
          (global as any).window = previous;
        }
      }),
    },
  };

  return { client, chat };
}

function makeLogger() {
  return {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

/** A client whose read-back is broken exactly the way production's is. */
function brokenReadBack() {
  return makeClient({
    getMessageById: jest.fn().mockRejectedValue(new TypeError(MSGS_UNDEFINED)),
  }).client;
}

const DEGRADED = {
  ...SEND_RESULT,
  enriched: false,
  lookupError: MSGS_UNDEFINED,
};

describe('sendText', () => {
  it('returns the stored message untouched when the read-back works', async () => {
    const { client, chat } = makeClient();

    const result = await sendText(client, TO, 'hi', { quotedMsg: 'x' });

    expect(chat.sendTextMessage).toHaveBeenCalledWith(TO, 'hi', {
      quotedMsg: 'x',
      waitForAck: true,
    });
    // Byte-for-byte the shape callers already depend on, marker fields included
    // only by their absence.
    expect(result).toEqual(STORED_MESSAGE);
    expect(result).not.toHaveProperty('enriched');
    expect(result).not.toHaveProperty('lookupError');
  });

  it('falls back to the message store when getMessageById blows up', async () => {
    const { client } = makeClient({
      getMessageById: jest
        .fn()
        .mockRejectedValue(new TypeError(MSGS_UNDEFINED)),
      msgStoreGet: jest.fn().mockReturnValue(STORED_MESSAGE),
    });

    expect(await sendText(client, TO, 'hi')).toEqual(STORED_MESSAGE);
  });

  it('degrades instead of failing when the message cannot be read back', async () => {
    const logger = makeLogger();

    const result = await sendText(brokenReadBack(), TO, 'hi', {}, logger);

    expect(result).toEqual(DEGRADED);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(MSG_ID));
  });

  it('still rejects when the send itself fails', async () => {
    const { client } = makeClient({
      chat: {
        sendTextMessage: jest.fn().mockRejectedValue(new Error('offline')),
      },
    });

    await expect(sendText(client, TO, 'hi')).rejects.toThrow('offline');
  });

  it('propagates wppconnect\'s own "erro" result', async () => {
    const erro = { erro: true, to: TO, text: 'Invalid recipient' };
    const { client } = makeClient({
      getMessageById: jest.fn().mockResolvedValue(erro),
    });

    await expect(sendText(client, TO, 'hi')).rejects.toEqual(erro);
  });
});

describe('enrichSentMessage', () => {
  it('degrades when the page evaluation itself throws', async () => {
    const client: any = {
      page: {
        evaluate: jest.fn().mockRejectedValue(new Error('Session closed')),
      },
    };

    expect(await enrichSentMessage(client, SEND_RESULT)).toEqual({
      ...SEND_RESULT,
      enriched: false,
      lookupError: 'Session closed',
    });
  });

  it('degrades when the send result carries no message id', async () => {
    const { client } = makeClient();

    expect(await enrichSentMessage(client, { ack: 1 })).toEqual({
      ack: 1,
      enriched: false,
      lookupError: 'the send returned no message id',
    });
    expect(client.page.evaluate).not.toHaveBeenCalled();
  });

  it('degrades when there is no page to read from', async () => {
    expect(await enrichSentMessage({}, SEND_RESULT)).toEqual({
      ...SEND_RESULT,
      enriched: false,
      lookupError: 'no browser page to read the message from',
    });
  });

  it('accepts a bare message id', async () => {
    const { client } = makeClient();

    expect(await enrichSentMessage(client, MSG_ID)).toEqual(STORED_MESSAGE);
  });
});

describe('the other two-step senders', () => {
  it('reply quotes the message and enriches', async () => {
    const { client, chat } = makeClient();

    expect(await reply(client, TO, 'hi', MSG_ID)).toEqual(STORED_MESSAGE);
    expect(chat.sendTextMessage).toHaveBeenCalledWith(TO, 'hi', {
      quotedMsg: MSG_ID,
    });
  });

  it('sendListMessage forwards its options', async () => {
    const { client, chat } = makeClient();
    const options = { buttonText: 'Pick', sections: [] };

    expect(await sendListMessage(client, TO, options)).toEqual(STORED_MESSAGE);
    expect(chat.sendListMessage).toHaveBeenCalledWith(TO, options);
  });

  it('sendPollMessage forwards name and choices', async () => {
    const { client, chat } = makeClient();

    expect(await sendPollMessage(client, TO, 'Lunch?', ['a', 'b'])).toEqual(
      STORED_MESSAGE
    );
    expect(chat.sendCreatePollMessage).toHaveBeenCalledWith(
      TO,
      'Lunch?',
      ['a', 'b'],
      undefined
    );
  });

  it('sendOrderMessage forwards its items', async () => {
    const { client, chat } = makeClient();
    const items = [{ type: 'product', id: '1', qnt: 2 }];

    expect(await sendOrderMessage(client, TO, items, { tax: 10 })).toEqual(
      STORED_MESSAGE
    );
    expect(chat.sendChargeMessage).toHaveBeenCalledWith(TO, items, { tax: 10 });
  });

  it('sendPixKey waits for the ack like the library does', async () => {
    const { client, chat } = makeClient();
    const params = { keyType: 'PHONE', key: '+5567123456789' };

    expect(await sendPixKey(client, TO, params)).toEqual(STORED_MESSAGE);
    expect(chat.sendPixKeyMessage).toHaveBeenCalledWith(TO, params, {
      waitForAck: true,
    });
  });

  it('degrades every one of them rather than failing the send', async () => {
    expect(await reply(brokenReadBack(), TO, 'hi', MSG_ID)).toEqual(DEGRADED);
    expect(await sendListMessage(brokenReadBack(), TO, {})).toEqual(DEGRADED);
    expect(await sendPollMessage(brokenReadBack(), TO, 'q', [])).toEqual(
      DEGRADED
    );
    expect(await sendOrderMessage(brokenReadBack(), TO, [])).toEqual(DEGRADED);
    expect(await sendPixKey(brokenReadBack(), TO, {})).toEqual(DEGRADED);
  });
});
