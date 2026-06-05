import fs from 'fs';

import {
  cleanDatabase,
  clearSessionData,
} from '../../controller/miscController';
import { clientsArray } from '../../util/sessionUtil';
import Factory from '../../util/tokenStore/factory';

jest.mock('../../config', () => ({
  secretKey: 'test-secret',
  customUserDataDir: './userDataDir/',
  tokenStoreType: 'file',
  webhook: { uploadS3: false },
}));

jest.mock('../../util/tokenStore/factory');
// NB: ts-jest hoists jest.mock() above the imports, so the factory must not
// close over an outer `const` (that would be in its TDZ when the factory runs
// during the very first import). Build the array inside the factory and read it
// back through the imported `clientsArray` binding, which points at this object.
jest.mock('../../util/sessionUtil', () => {
  const arr: Record<string, any> = {};
  return {
    clientsArray: arr,
    deleteSessionOnArray: jest.fn((session: string) => {
      delete arr[session];
    }),
  };
});
jest.mock('../../util/manageSession', () => ({
  backupSessions: jest.fn(),
  restoreSessions: jest.fn(),
}));
jest.mock('../../util/functions', () => ({}));
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: { rm: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../..', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

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
      createTokenStory: jest
        .fn()
        .mockReturnValue({ removeToken: mockRemoveToken }),
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
    const req: any = {
      params: { session: 'sess1', secretkey: 'test-secret' },
      client: undefined,
    };
    const res = makeRes();
    await cleanDatabase(req, res);
    expect(mockRemoveToken).toHaveBeenCalledWith('sess1');
    expect(fs.promises.rm).toHaveBeenCalledWith('./userDataDir/sess1', {
      recursive: true,
      force: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: true,
      message: 'Session cleaned successfully',
    });
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
    expect(mockRemoveToken).toHaveBeenCalledWith('sess2');
  });
});

describe('clearSessionData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(clientsArray)) delete (clientsArray as any)[k];
  });

  it('returns 400 when secretkey is wrong', async () => {
    const req: any = { params: { session: 'sess1', secretkey: 'wrong' } };
    const res = makeRes();
    await clearSessionData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      response: 'error',
      message: 'The token is incorrect',
    });
  });

  // The regression that made "reset / refresh QR" a no-op: a session sitting in
  // QRCODE is a placeholder with no page/logout/close. The old guard
  // (`if (req?.client?.page)`) skipped the in-memory teardown entirely, leaving
  // status === 'QRCODE' so the next start-session early-returned. We must ALWAYS
  // free the slot, even when there's no live page and nothing to log out.
  it('frees the in-memory slot for a QRCODE placeholder (no page/logout)', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (clientsArray as any)['sess-qr'] = { status: 'QRCODE', session: 'sess-qr' };
    const req: any = {
      params: { session: 'sess-qr', secretkey: 'test-secret' },
    };
    const res = makeRes();
    await clearSessionData(req, res);
    expect((clientsArray as any)['sess-qr']).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('logs out, closes and frees the slot for a live (CONNECTED) client', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const logout = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    (clientsArray as any)['sess-live'] = {
      status: 'CONNECTED',
      page: {},
      logout,
      close,
    };
    const req: any = {
      params: { session: 'sess-live', secretkey: 'test-secret' },
    };
    const res = makeRes();
    await clearSessionData(req, res);
    expect(logout).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect((clientsArray as any)['sess-live']).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still succeeds and frees the slot when logout throws', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const logout = jest.fn().mockRejectedValue(new Error('boom'));
    (clientsArray as any)['sess-bad'] = { status: 'CONNECTED', page: {}, logout };
    const req: any = {
      params: { session: 'sess-bad', secretkey: 'test-secret' },
    };
    const res = makeRes();
    await clearSessionData(req, res);
    expect((clientsArray as any)['sess-bad']).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('force-wipes the userDataDir so a busy Chromium lock cannot block reset', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const req: any = {
      params: { session: 'sess-fs', secretkey: 'test-secret' },
    };
    const res = makeRes();
    await clearSessionData(req, res);
    expect(fs.promises.rm).toHaveBeenCalledWith(
      './userDataDir/sess-fs',
      expect.objectContaining({ recursive: true, force: true })
    );
  });
});
