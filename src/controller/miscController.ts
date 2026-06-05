/*
 * Copyright 2023 WPPConnect Team
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

import { Request, Response } from 'express';
import fs from 'fs';

import { logger } from '..';
import config from '../config';
import { backupSessions, restoreSessions } from '../util/manageSession';
import { clientsArray, deleteSessionOnArray } from '../util/sessionUtil';
import Factory from '../util/tokenStore/factory';

export async function backupAllSessions(req: Request, res: Response) {
  /**
     * #swagger.tags = ["Misc"]
     * #swagger.description = 'Please, open the router in your browser, in swagger this not run'
     * #swagger.produces = ['application/octet-stream']
     * #swagger.consumes = ['application/octet-stream']
       #swagger.autoBody=false
       #swagger.parameters["secretkey"] = {
          required: true,
          schema: 'THISISMYSECURETOKEN'
       }
       #swagger.responses[200] = {
        description: 'A ZIP file contaings your backup. Please, open this link in your browser',
        content: {
          "application/zip": {
            schema: {}
          }
        },
      }
     */
  const { secretkey } = req.params;

  if (secretkey !== config.secretKey) {
    return res.status(400).json({
      response: 'error',
      message: 'The token is incorrect',
    });
  }

  try {
    res.setHeader('Content-Type', 'application/zip');
    res.send(await backupSessions(req));
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Error on backup session',
      error: error,
    });
  }
}

export async function restoreAllSessions(req: Request, res: Response) {
  /**
   #swagger.tags = ["Misc"]
   #swagger.autoBody=false
    #swagger.parameters["secretkey"] = {
    required: true,
    schema: 'THISISMYSECURETOKEN'
    }
    #swagger.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: 'object',
            properties: {
              file: {
                type: "string",
                format: "binary"
              }
            },
            required: ['file'],
          }
        }
      }
    }
  */
  const { secretkey } = req.params;

  if (secretkey !== config.secretKey) {
    return res.status(400).json({
      response: 'error',
      message: 'The token is incorrect',
    });
  }

  try {
    const result = await restoreSessions(req, req.file as any);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      status: false,
      message: 'Error on restore session',
      error: error,
    });
  }
}

export async function takeScreenshot(req: Request, res: Response) {
  /**
   #swagger.tags = ["Misc"]
   #swagger.autoBody=false
    #swagger.security = [{
          "bearerAuth": []
    }]
    #swagger.parameters["session"] = {
    schema: 'NERDWHATS_AMERICA'
    }
  */

  try {
    const result = await req.client.takeScreenshot();
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      status: false,
      message: 'Error on take screenshot',
      error: error,
    });
  }
}

export async function clearSessionData(req: Request, res: Response) {
  /**
   #swagger.tags = ["Misc"]
   #swagger.autoBody=false
    #swagger.parameters["secretkey"] = {
    required: true,
    schema: 'THISISMYSECURETOKEN'
    }
    #swagger.parameters["session"] = {
    schema: 'NERDWHATS_AMERICA'
    }
  */

  try {
    const { secretkey, session } = req.params;

    if (secretkey !== config.secretKey) {
      return res.status(400).json({
        response: 'error',
        message: 'The token is incorrect',
      });
    }

    // Tear down whatever in-memory client exists for this session. This route
    // authenticates with the secret key (no verifyToken middleware), so
    // `req.client` is never populated — we must reach into clientsArray
    // directly. Two shapes can live there:
    //   * a fully-created wppClient (CONNECTED) — has `.page`, `.logout`, `.close`
    //   * a lightweight placeholder (QRCODE / INITIALIZING) — has none of those,
    //     just `{ status, session, qrcode }`, with an orphaned Puppeteer browser
    //     still rendering an expired QR.
    // Each teardown call is guarded so a missing method or an already-dead
    // browser can't abort the wipe. logout() (when there's a live page) unlinks
    // the WhatsApp device so the next start issues a BRAND-NEW QR instead of
    // silently re-pairing the old credentials.
    const client: any = clientsArray[req.params.session];
    if (client) {
      try {
        if (client.page && typeof client.logout === 'function') {
          await client.logout();
        }
      } catch (e) {
        logger.warn(e);
      }
      try {
        if (typeof client.close === 'function') {
          await client.close();
        }
      } catch (e) {
        logger.warn(e);
      }
      // ALWAYS free the slot. Without this, a session stuck in QRCODE keeps
      // status === 'QRCODE', and the next start-session early-returns in
      // createSessionUtil (`if (client.status != null && client.status !==
      // 'CLOSED') return`) — so the expired QR never refreshes. This is the
      // root cause of "reset / refresh QR does nothing".
      delete clientsArray[req.params.session];
    }

    const path = config.customUserDataDir + session;
    const pathToken = __dirname + `../../../tokens/${session}.data.json`;
    if (fs.existsSync(path)) {
      await fs.promises.rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 1000,
      });
    }
    if (fs.existsSync(pathToken)) {
      await fs.promises.rm(pathToken, { force: true });
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error(error);
    res.status(500).json({
      status: false,
      message: 'Error on clear session data',
      error: error,
    });
  }
}

export async function setLimit(req: Request, res: Response) {
  /**
   #swagger.tags = ["Misc"]
   #swagger.description = 'Change limits of whatsapp web. Types value: maxMediaSize, maxFileSize, maxShare, statusVideoMaxDuration, unlimitedPin;'
   #swagger.autoBody=false
    #swagger.security = [{
          "bearerAuth": []
    }]
    #swagger.parameters["session"] = {
    schema: 'NERDWHATS_AMERICA'
    }
     #swagger.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              value: { type: 'any' },
            },
            required: ['type', 'value'],
          },
          examples: {
            'Default': {
              value: {
                type: 'maxFileSize',
                value: 104857600
              },
            },
          },
        },
      },
    }
  */

  try {
    const { type, value } = req.body;
    if (!type || !value) throw new Error('Send de type and value');

    const result = await req.client.setLimit(type, value);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      status: false,
      message: 'Error on set limit',
      error: error,
    });
  }
}

export async function cleanDatabase(req: Request, res: Response): Promise<any> {
  /**
   #swagger.tags = ["Misc"]
   #swagger.autoBody=false
    #swagger.parameters["secretkey"] = {
    required: true,
    schema: 'THISISMYSECURETOKEN'
    }
    #swagger.parameters["session"] = {
    schema: 'NERDWHATS_AMERICA'
    }
  */
  try {
    const { secretkey, session } = req.params;

    if (secretkey !== config.secretKey) {
      return res.status(400).json({
        response: 'error',
        message: 'The token is incorrect',
      });
    }

    if (req?.client?.page) {
      await req.client.logout();
      deleteSessionOnArray(session);
    }

    const tokenStore = new Factory();
    const myTokenStore = tokenStore.createTokenStory(null);
    await myTokenStore.removeToken(session);

    const userDataPath = config.customUserDataDir + session;
    if (fs.existsSync(userDataPath)) {
      await fs.promises.rm(userDataPath, { recursive: true, force: true });
    }

    return res
      .status(200)
      .json({ status: true, message: 'Session cleaned successfully' });
  } catch (error: any) {
    logger.error(error);
    return res.status(500).json({
      status: false,
      message: 'Error on clean database',
      error,
    });
  }
}
