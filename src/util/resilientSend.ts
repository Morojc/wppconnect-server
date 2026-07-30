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
 * Sends that survive a broken message read-back.
 *
 * Every wppconnect send that resolves to a full message object is two separate
 * page evaluations (see `sender.layer.ts`):
 *
 *   1. `WPP.chat.send*Message(...)` — this is the one that actually delivers,
 *      and it returns `{ id, ack, sendMsgResult }`.
 *   2. `WAPI.getMessageById(sendResult.id)` — pure enrichment, run only to give
 *      the caller the stored message instead of the thin send result.
 *
 * Step 2 is not reliable. In wa-js (4.4.2 and 4.4.3 alike — the implementation
 * is byte-identical) it resolves through
 * `assertGetChat(key.remote).msgs.get(key)`, and `.msgs` is undefined on
 * WhatsApp Web builds the engine has no bundled version map for (the
 * "Version not available for 2.3000.10305x, using latest as fallback" warning
 * on boot). It then throws `Cannot read properties of undefined (reading
 * 'get')` — *after* the message is already on the recipient's phone.
 *
 * The library propagates that, the controller turns it into HTTP 500, and every
 * caller with a retry policy re-sends a message that was delivered the first
 * time. A single conversational turn reaching a customer three times is a worse
 * failure than a thinner response body, so here step 2 is best-effort: only a
 * step-1 failure may fail the request.
 *
 * When enrichment does not work out the caller still gets the send result, plus
 * `enriched: false` and `lookupError` so the degradation is explicit rather
 * than looking like an unusually sparse message. That matters because
 * consumers read `isSendFailure`/`ack` off the enriched message to spot
 * undeliverable `@lid` recipients (see src/util/lidResolver.ts) — absent those
 * fields they must not assume the send was clean.
 */

/** What step 1 hands back before enrichment. */
export interface RawSendResult {
  id: string;
  ack?: number;
  [key: string]: any;
}

/** A send result that reached WhatsApp but could not be read back. */
export interface DegradedSendResult extends RawSendResult {
  enriched: false;
  lookupError: string;
}

function describeError(error: any): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  return String(error.message ?? error);
}

function degrade(
  sendResult: any,
  reason: string,
  logger?: any,
  messageId?: string
): DegradedSendResult {
  logger?.warn?.(
    `Message ${
      messageId ?? '<unknown id>'
    } was sent but could not be read back: ${reason}`
  );
  const base =
    sendResult && typeof sendResult === 'object'
      ? sendResult
      : { id: sendResult };
  return { ...base, enriched: false, lookupError: reason };
}

/**
 * Step 2, made non-fatal.
 *
 * Returns the stored message when the lookup works — byte-for-byte what
 * `sendText` & friends used to return, including `isSendFailure` and `ack` —
 * and a {@link DegradedSendResult} when it doesn't. Still throws for
 * `erro === true`, which is wppconnect's own "this send is bad" signal and the
 * only thing it ever threw from this step deliberately.
 */
export async function enrichSentMessage(
  client: any,
  sendResult: any,
  logger?: any
): Promise<any> {
  const messageId =
    typeof sendResult === 'string' ? sendResult : sendResult?.id;

  if (!messageId) {
    return degrade(sendResult, 'the send returned no message id', logger);
  }
  if (typeof client?.page?.evaluate !== 'function') {
    return degrade(
      sendResult,
      'no browser page to read the message from',
      logger,
      messageId
    );
  }

  let lookup: any;
  try {
    lookup = await client.page.evaluate(
      async ({ messageId }: { messageId: string }) => {
        const win = window as any;
        // The JSON round trip is wppconnect's: a direct return of the model
        // comes back undefined through the CDP bridge.
        try {
          const message = await win.WAPI.getMessageById(messageId);
          return { ok: true, message: JSON.parse(JSON.stringify(message)) };
        } catch (error: any) {
          // wa-js reaches the message through the chat's `msgs` collection,
          // which some WhatsApp Web builds don't expose. The global message
          // store usually still holds it, so try that before giving up.
          try {
            const stored = win.WPP?.whatsapp?.MsgStore?.get?.(messageId);
            if (stored) {
              return { ok: true, message: JSON.parse(JSON.stringify(stored)) };
            }
          } catch (fallbackError) {
            /* keep the original error, it's the informative one */
          }
          return { ok: false, error: String(error?.message ?? error) };
        }
      },
      { messageId }
    );
  } catch (error) {
    // A page-level failure: the evaluate itself blew up, the session dropped,
    // the page navigated. The message is still out.
    return degrade(sendResult, describeError(error), logger, messageId);
  }

  if (!lookup?.ok || !lookup.message) {
    return degrade(
      sendResult,
      lookup?.error ?? 'the message lookup returned nothing',
      logger,
      messageId
    );
  }
  if (lookup.message.erro === true) throw lookup.message;
  return lookup.message;
}

/**
 * Runs a send (step 1) and then enriches it (step 2, best-effort).
 *
 * `pageFunction` runs inside the browser and must return wa-js's send result.
 * Anything it throws is the caller's problem — that is a real send failure.
 */
async function sendAndEnrich(
  client: any,
  pageFunction: (arg: any) => any,
  arg: any,
  logger?: any
): Promise<any> {
  const sendResult = await client.page.evaluate(pageFunction, arg);
  return enrichSentMessage(client, sendResult, logger);
}

/** Resilient `client.sendText`. */
export async function sendText(
  client: any,
  to: string,
  content: string,
  options?: any,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ to, content, options }: any) =>
      (window as any).WPP.chat.sendTextMessage(to, content, {
        ...options,
        waitForAck: true,
      }),
    { to, content, options },
    logger
  );
}

/** Resilient `client.reply`. */
export async function reply(
  client: any,
  to: string,
  content: string,
  quotedMsg: string,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ to, content, quotedMsg }: any) =>
      (window as any).WPP.chat.sendTextMessage(to, content, { quotedMsg }),
    { to, content, quotedMsg },
    logger
  );
}

/** Resilient `client.sendListMessage`. */
export async function sendListMessage(
  client: any,
  to: string,
  options: any,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ to, options }: any) =>
      (window as any).WPP.chat.sendListMessage(to, options),
    { to, options },
    logger
  );
}

/** Resilient `client.sendPollMessage`. */
export async function sendPollMessage(
  client: any,
  chatId: string,
  name: string,
  choices: string[],
  options?: any,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ chatId, name, choices, options }: any) =>
      (window as any).WPP.chat.sendCreatePollMessage(
        chatId,
        name,
        choices,
        options
      ),
    { chatId, name, choices, options },
    logger
  );
}

/** Resilient `client.sendOrderMessage`. */
export async function sendOrderMessage(
  client: any,
  to: string,
  items: any[],
  options?: any,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ to, items, options }: any) =>
      (window as any).WPP.chat.sendChargeMessage(to, items, options),
    { to, items, options },
    logger
  );
}

/** Resilient `client.sendPixKey`. */
export async function sendPixKey(
  client: any,
  to: string,
  params: any,
  options?: any,
  logger?: any
): Promise<any> {
  return sendAndEnrich(
    client,
    ({ to, params, options }: any) =>
      (window as any).WPP.chat.sendPixKeyMessage(to, params, {
        ...options,
        waitForAck: true,
      }),
    { to, params, options },
    logger
  );
}
