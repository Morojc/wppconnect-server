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
