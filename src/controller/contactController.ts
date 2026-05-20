import { Request, Response } from 'express';

export default class ContactController {
  static async getContactPnLid(req: Request, res: Response) {
    /**
      #swagger.tags = ["Contact"]
      #swagger.autoBody=false
      #swagger.security = [{
              "bearerAuth": []
      }]
      #swagger.parameters["session"] = {
          schema: 'NERDWHATS_AMERICA'
      }
      #swagger.parameters["pnLid"] = {
          schema: '1234567890@c.us' // or '1234567890@lid'
      }
      */
    const { pnLid } = req.params;

    if (!pnLid) {
      return res.status(400).json({
        status: 'error',
        message: 'Phone Number or LID (pnLid) parameter is required',
      });
    }

    try {
      const response = await req.client.getPnLidEntry(pnLid);
      res.status(200).json(response);
    } catch (error) {
      req.logger.error(error);
      res.status(500).json({
        status: 'error',
        message: 'Error on get contact by PN-LID',
        error: error,
      });
    }
  }

  static async requestPhoneNumber(req: Request, res: Response) {
    /**
      #swagger.tags = ["Contact"]
      #swagger.autoBody=false
      #swagger.security = [{
              "bearerAuth": []
      }]
      #swagger.parameters["session"] = {
          schema: 'NERDWHATS_AMERICA'
      }
      #swagger.parameters["pnLid"] = {
          schema: '12345678901234567@lid'
      }
      */
    // Actively asks a LID contact's WhatsApp client to share their real
    // phone number — the same mechanism behind the "Request phone number"
    // button in WhatsApp. The contact has to accept; the actual MSISDN
    // becomes available via /contact/pn-lid/{pnLid} once shared.
    //
    // The returned `SendMessageReturn` describes the request message we
    // just dispatched, NOT the eventual phone number. Callers should
    // treat it as fire-and-forget and re-poll pn-lid later.
    const { pnLid } = req.params;

    if (!pnLid) {
      return res.status(400).json({
        status: 'error',
        message: 'LID (pnLid) parameter is required',
      });
    }

    try {
      // wa-js exposes WPP.chat.requestPhoneNumber but
      // @wppconnect-team/wppconnect doesn't wrap it as a layer method, so
      // we call it via page.evaluate — the same escape hatch the library
      // uses internally for unwrapped wa-js functions (evaluateAndReturn).
      const response = await req.client.page.evaluate(
        (jid: string) => (window as any).WPP.chat.requestPhoneNumber(jid),
        pnLid,
      );
      res.status(200).json(response);
    } catch (error) {
      req.logger.error(error);
      res.status(500).json({
        status: 'error',
        message: 'Error on request phone number for LID',
        error: error,
      });
    }
  }
}
