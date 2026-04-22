# Clean DB + QR Code JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new endpoints — `POST /api/:session/:secretkey/clean-db` to gracefully wipe a session's token and browser data, and `GET /api/:session/qrcode-session-json` to return the QR code as JSON.

**Architecture:** Both handlers follow the existing patterns in `miscController.ts` and `sessionController.ts`. The clean-db handler uses the `Factory` token store abstraction so it works for file, MongoDB, and Redis stores. The QR JSON handler is a thin wrapper around the existing `QRCode.toDataURL` call already used in `getSessionState`.

**Tech Stack:** TypeScript, Express, Jest + ts-jest, `qrcode` npm package, `@wppconnect-team/wppconnect`

---

## File Map

| File | Change |
|------|--------|
| `src/controller/miscController.ts` | Add `cleanDatabase` function |
| `src/controller/sessionController.ts` | Add `getQrCodeJson` function |
| `src/routes/index.ts` | Register both new routes |
| `src/tests/controller/miscController.test.ts` | New — unit tests for `cleanDatabase` |
| `src/tests/controller/sessionController.test.ts` | New — unit tests for `getQrCodeJson` |

---

## Task 1: `cleanDatabase` handler + tests

**Files:**
- Modify: `src/controller/miscController.ts`
- Create: `src/tests/controller/miscController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/controller/miscController.test.ts`:

```typescript
import fs from 'fs';

jest.mock('../../config', () => ({
  secretKey: 'test-secret',
  customUserDataDir: './userDataDir/',
  tokenStoreType: 'file',
}));

jest.mock('../../util/tokenStore/factory');
jest.mock('../../util/sessionUtil', () => ({ clientsArray: {} as Record<string, any> }));
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: { rm: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../..', () => ({ logger: { error: jest.fn() } }));

import { cleanDatabase } from '../../controller/miscController';
import { clientsArray } from '../../util/sessionUtil';
import Factory from '../../util/tokenStore/factory';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('cleanDatabase', () => {
  let mockRemoveToken: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRemoveToken = jest.fn().mockResolvedValue(true);
    (Factory as jest.Mock).mockImplementation(() => ({
      createTokenStory: jest.fn().mockReturnValue({ removeToken: mockRemoveToken }),
    }));
  });

  it('returns 400 when secretkey is wrong', async () => {
    const req: any = { params: { session: 'sess1', secretkey: 'wrong' } };
    const res = makeRes();
    await cleanDatabase(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      response: 'error',
      message: 'The token is incorrect',
    });
  });

  it('removes token and userDataDir when session is inactive', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const req: any = { params: { session: 'sess1', secretkey: 'test-secret' }, client: undefined };
    const res = makeRes();
    await cleanDatabase(req, res);
    expect(mockRemoveToken).toHaveBeenCalledWith('sess1');
    expect(fs.promises.rm).toHaveBeenCalledWith('./userDataDir/sess1', { recursive: true, force: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: true, message: 'Session cleaned successfully' });
  });

  it('calls logout and removes client from array when session is active', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const mockLogout = jest.fn().mockResolvedValue(undefined);
    (clientsArray as any)['sess2'] = { status: 'CONNECTED' };
    const req: any = {
      params: { session: 'sess2', secretkey: 'test-secret' },
      client: { page: {}, logout: mockLogout },
    };
    const res = makeRes();
    await cleanDatabase(req, res);
    expect(mockLogout).toHaveBeenCalled();
    expect((clientsArray as any)['sess2']).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/tests/controller/miscController.test.ts --no-coverage
```

Expected: FAIL — `cleanDatabase is not exported` (or similar)

- [ ] **Step 3: Implement `cleanDatabase` in `miscController.ts`**

Add the following imports at the top of `src/controller/miscController.ts` (after existing imports):

```typescript
import { clientsArray } from '../util/sessionUtil';
import Factory from '../util/tokenStore/factory';
```

Then add this function at the end of `src/controller/miscController.ts`:

```typescript
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
      delete (clientsArray as any)[session];
    }

    const tokenStore = new Factory();
    const myTokenStore = tokenStore.createTokenStory(null);
    await myTokenStore.removeToken(session);

    const userDataPath = config.customUserDataDir + session;
    if (fs.existsSync(userDataPath)) {
      await fs.promises.rm(userDataPath, { recursive: true, force: true });
    }

    return res.status(200).json({ status: true, message: 'Session cleaned successfully' });
  } catch (error: any) {
    logger.error(error);
    return res.status(500).json({
      status: false,
      message: 'Error on clean database',
      error,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/tests/controller/miscController.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/controller/miscController.ts src/tests/controller/miscController.test.ts
git commit -m "feat: add cleanDatabase endpoint handler and tests"
```

---

## Task 2: `getQrCodeJson` handler + tests

**Files:**
- Modify: `src/controller/sessionController.ts`
- Create: `src/tests/controller/sessionController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/controller/sessionController.test.ts`:

```typescript
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKEQR'),
}));

import QRCode from 'qrcode';
import { getQrCodeJson } from '../../controller/sessionController';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.writeHead = jest.fn();
  res.end = jest.fn();
  return res;
}

describe('getQrCodeJson', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns status null when client is undefined', async () => {
    const req: any = { client: undefined, logger: { error: jest.fn() } };
    const res = makeRes();
    await getQrCodeJson(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: null,
      message: 'Session not started. Please use /start-session to initialize your session.',
    });
  });

  it('returns qrcode data URL when urlcode is present', async () => {
    const req: any = { client: { urlcode: 'some-code', status: 'QRCODE' }, logger: { error: jest.fn() } };
    const res = makeRes();
    await getQrCodeJson(req, res);
    expect(QRCode.toDataURL).toHaveBeenCalledWith('some-code');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'success', qrcode: 'data:image/png;base64,FAKEQR' });
  });

  it('returns null qrcode when session is connected and no urlcode', async () => {
    const req: any = { client: { urlcode: null, status: 'CONNECTED' }, logger: { error: jest.fn() } };
    const res = makeRes();
    await getQrCodeJson(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'CONNECTED',
      qrcode: null,
      message: 'QR code not available',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/tests/controller/sessionController.test.ts --no-coverage
```

Expected: FAIL — `getQrCodeJson is not exported`

- [ ] **Step 3: Implement `getQrCodeJson` in `sessionController.ts`**

Add this function at the end of `src/controller/sessionController.ts`:

```typescript
export async function getQrCodeJson(req: Request, res: Response): Promise<any> {
  /**
   * #swagger.tags = ["Auth"]
     #swagger.autoBody=false
     #swagger.operationId = 'getQrCodeJson'
     #swagger.security = [{
            "bearerAuth": []
     }]
     #swagger.parameters["session"] = {
      schema: 'NERDWHATS_AMERICA'
     }
   */
  try {
    if (typeof req.client === 'undefined') {
      return res.status(200).json({
        status: null,
        message:
          'Session not started. Please use /start-session to initialize your session.',
      });
    }

    if (req.client.urlcode) {
      const qrcode = await QRCode.toDataURL(req.client.urlcode);
      return res.status(200).json({ status: 'success', qrcode });
    }

    return res.status(200).json({
      status: req.client.status,
      qrcode: null,
      message: 'QR code not available',
    });
  } catch (ex) {
    req.logger.error(ex);
    return res.status(500).json({
      status: 'error',
      message: 'Error retrieving QR code',
      error: ex,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/tests/controller/sessionController.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/controller/sessionController.ts src/tests/controller/sessionController.test.ts
git commit -m "feat: add getQrCodeJson endpoint handler and tests"
```

---

## Task 3: Register both routes

**Files:**
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Add the two new routes**

In `src/routes/index.ts`, add after the existing `clear-session-data` route (line 88):

```typescript
routes.post(
  '/api/:session/:secretkey/clean-db',
  MiscController.cleanDatabase
);
```

And add after the existing `qrcode-session` route (after line 73):

```typescript
routes.get(
  '/api/:session/qrcode-session-json',
  verifyToken,
  SessionController.getQrCodeJson
);
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass (existing + new)

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
npm run build:types
```

Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.ts
git commit -m "feat: register clean-db and qrcode-session-json routes"
```
