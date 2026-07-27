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

import { NextFunction, Request, Response } from 'express';

import { contactToArray } from '../util/functions';

export default async function statusConnection(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const numbers: any = [];
    if (req.client && req.client.isConnected) {
      await req.client.isConnected();

      const localArr = contactToArray(
        req.body.phone || [],
        req.body.isGroup,
        req.body.isNewsletter,
        req.body.isLid
      );
      let index = 0;
      for (const contact of localArr) {
        // Skip the phone-existence check for address spaces that are NOT phone
        // numbers.
        //
        // A LID is WhatsApp's privacy identifier for a contact that hasn't
        // shared its number — a 14-17 digit synthetic id, never an MSISDN.
        // Running checkNumberStatus on one asks "is this a real phone?" about
        // something that was never a phone, so it answers no and every request
        // for that contact dies with `O número <lid> não existe`, even though
        // the chat exists and is perfectly reachable. That made send-seen and
        // typing impossible for any contact WhatsApp addresses by LID.
        //
        // `isLid` was already threaded into contactToArray above but was
        // missing from this guard, which is the whole bug. The suffix check is
        // the belt-and-braces half: callers that pass a fully-formed `<id>@lid`
        // without setting the flag are just as correct, and contactToArray's
        // "longer than 14 digits" heuristic silently misroutes a 14-digit LID
        // to @c.us.
        const isLidContact = req.body.isLid || /@lid$/i.test(String(contact));
        if (req.body.isGroup || req.body.isNewsletter || isLidContact) {
          localArr[index] = contact;
        } else if (numbers.indexOf(contact) < 0) {
          const profile: any = await req.client
            .checkNumberStatus(contact)
            .catch((error) => req.logger.warn(error));
          if (!profile?.numberExists) {
            const num = (contact as any).split('@')[0];
            // RETURN, don't just respond: without this the loop kept running
            // and `next()` fired below on an already-sent response, handing the
            // controller a request it could only fail on
            // ("Cannot set headers after they are sent").
            return res.status(400).json({
              response: null,
              status: 'Connected',
              message: `O número ${num} não existe.`,
            });
          } else {
            if ((numbers as any).indexOf(profile.id._serialized) < 0) {
              (numbers as any).push(profile.id._serialized);
            }
            (localArr as any)[index] = profile.id._serialized;
          }
        }
        index++;
      }
      req.body.phone = localArr;
    } else {
      // Same missing-return as above: this answered 404 and then fell through
      // to next(), running the controller against a disconnected session on an
      // already-sent response.
      return res.status(404).json({
        response: null,
        status: 'Disconnected',
        message: 'A sessão do WhatsApp não está ativa.',
      });
    }
    next();
  } catch (error) {
    req.logger.error(error);
    res.status(404).json({
      response: null,
      status: 'Disconnected',
      message: 'A sessão do WhatsApp não está ativa.',
    });
  }
}
