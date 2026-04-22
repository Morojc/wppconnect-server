import fs from 'fs';

jest.mock('../../config', () => ({
  secretKey: 'test-secret',
  customUserDataDir: './userDataDir/',
  tokenStoreType: 'file',
  webhook: { uploadS3: false },
}));

jest.mock('../../util/tokenStore/factory');
jest.mock('../../util/sessionUtil', () => ({ clientsArray: {} as Record<string, any> }));
jest.mock('../../util/manageSession', () => ({
  backupSessions: jest.fn(),
  restoreSessions: jest.fn(),
}));
jest.mock('../../util/functions', () => ({}));
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
