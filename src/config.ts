import { ServerOptions } from './types/ServerOptions';

export default {
  // The master key that mints per-session bearer tokens. Read from the
  // environment so a deployment can hold a real key without it living in git —
  // set SECRET_KEY on the container and every consumer picks it up, both the
  // ones reading `config` directly (miscController, sessionController) and the
  // ones reading the merged `serverOptions` (auth middleware). The literal below
  // is upstream's placeholder and is only what an unconfigured dev box gets.
  secretKey: process.env.SECRET_KEY || 'THISISMYSECURETOKEN',
  host: 'http://localhost',
  port: '21465',
  deviceName: 'WppConnect',
  poweredBy: 'WPPConnect-Server',
  startAllSession: true,
  tokenStoreType: 'file',
  maxListeners: 15,
  customUserDataDir: './userDataDir/',
  webhook: {
    url: null,
    autoDownload: true,
    uploadS3: false,
    // Default left as upstream. The deployed behavior is controlled by the
    // WEBHOOK_READ_MESSAGE env var (see src/index.ts + docker-compose.yml) so
    // we don't have to edit this file to flip auto-seen on/off.
    readMessage: true,
    allUnreadOnStart: false,
    listenAcks: true,
    onPresenceChanged: true,
    onParticipantsChanged: true,
    onReactionMessage: true,
    onPollResponse: true,
    onRevokedMessage: true,
    onLabelUpdated: true,
    onSelfMessage: false,
    ignore: ['status@broadcast'],
  },
  websocket: {
    autoDownload: false,
    uploadS3: false,
  },
  chatwoot: {
    sendQrCode: true,
    sendStatus: true,
  },
  archive: {
    enable: false,
    waitTime: 10,
    daysToArchive: 45,
  },
  phoneNumber: {
    // When set, local-format numbers (e.g. "0612345678") are converted to
    // the international form (e.g. "212612345678") before building the JID.
    // Leave undefined to disable normalization.
    defaultCountryCode: '212',
  },
  lid: {
    // Translate `<digits>@lid` recipients to their `<msisdn>@c.us` JID before
    // sending. WhatsApp fails sends to a LID the session can't map, and does so
    // silently (isSendFailure on the stored message, not a thrown error).
    // Overridable at deploy time with RESOLVE_LID_TO_PHONE (see src/index.ts).
    resolveToPhone: true,
  },
  typing: {
    // Hold the "typing…" state before a send-message lands, so a bot reply
    // arrives the way a person's would instead of appearing instantly. The
    // duration is `msPerChar` per character of the message, clamped to
    // [minMs, maxMs] — it is dead time on the request, hence the ceiling.
    // Per request: `typing: false` skips it, `typing: <ms>` sets it outright.
    // Overridable at deploy time with SEND_TYPING (see src/index.ts).
    enabled: true,
    msPerChar: 45,
    minMs: 800,
    maxMs: 5000,
  },
  log: {
    level: 'silly', // Before open a issue, change level to silly and retry a action
    logger: ['console', 'file'],
  },
  createOptions: {
    // Never give up on a session that hasn't been paired yet. wppconnect's
    // default (60s) closes the browser while the QR is still on screen, which
    // makes pairing a race. This was set on the deployed image but had never
    // made it back into the repo — restored here so a rebuild doesn't silently
    // change session lifecycle behaviour. The cost is that an abandoned session
    // retries the QR forever, so remove its token file when you drop a session.
    autoClose: 0,
    browserArgs: [
      '--disable-web-security',
      '--no-sandbox',
      '--disable-web-security',
      '--aggressive-cache-discard',
      '--disable-cache',
      '--disable-application-cache',
      '--disable-offline-load-stale-cache',
      '--disk-cache-size=0',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-certificate-errors-spki-list',
    ],
    /**
     * Example of configuring the linkPreview generator
     * If you set this to 'null', it will use global servers; however, you have the option to define your own server
     * Clone the repository https://github.com/wppconnect-team/wa-js-api-server and host it on your server with ssl
     *
     * Configure the attribute as follows:
     * linkPreviewApiServers: [ 'https://www.yourserver.com/wa-js-api-server' ]
     */
    linkPreviewApiServers: null,

    /**
     * Which WhatsApp Web build to serve into the browser.
     *
     * This is NOT cosmetic. wppconnect 2.2.4 defaults to '2.3000.10305x', and
     * that version does not exist in the `@wppconnect/wa-version` catalogue it
     * ships with (which starts at 2.3000.1035…). `getPageContent` therefore
     * returns nothing, the request interception is never installed, and the
     * browser loads whatever WhatsApp Web is serving TODAY — a build wa-js has
     * no bindings for. You can see it happen on every boot:
     *
     *   error: Version not available for 2.3000.10305x, using latest as fallback
     *
     * The damage is not limited to one call. With wa-js bound to an unknown
     * build, chat models come back without their `msgs` collection, so
     * `getMessageById` throws "Cannot read properties of undefined (reading
     * 'get')" (see src/util/resilientSend.ts), `all-unread-messages` throws,
     * and — worst — no inbound message events fire at all, which leaves the
     * session able to send but completely deaf.
     *
     * Pinned to a range so it tracks the newest build in whatever catalogue is
     * installed, instead of a single version that rots. `@wppconnect/wa-version`
     * is held at ^1.5.4473 in `resolutions` for the same reason — the catalogue,
     * not this string, is what decides which builds are servable.
     *
     * CAUTION, learned the hard way: pinning a build that is too OLD makes
     * WhatsApp unpair the device outright ("Session Unpaired" in the log, then
     * disconnectedMobile) and costs a QR re-scan. 2.3000.1039x did exactly that.
     * Always pin within the newest series the installed catalogue offers —
     * `node -e "console.log(require('@wppconnect/wa-version').getLatestVersion())"`
     * says what that is. WHATSAPP_WEB_VERSION overrides without a rebuild, and
     * setting it to `off` disables pinning entirely (back to wppconnect's
     * fallback: whatever WhatsApp Web serves live, with wa-js likely broken
     * against it) as an escape hatch if a pin turns out to be unusable.
     */
    whatsappVersion:
      process.env.WHATSAPP_WEB_VERSION === 'off'
        ? undefined
        : process.env.WHATSAPP_WEB_VERSION || '2.3000.1044x',
  },
  mapper: {
    enable: false,
    prefix: 'tagone-',
  },
  db: {
    mongodbDatabase: 'tokens',
    mongodbCollection: '',
    mongodbUser: '',
    mongodbPassword: '',
    mongodbHost: '',
    mongoIsRemote: true,
    mongoURLRemote: '',
    mongodbPort: 27017,
    redisHost: 'localhost',
    redisPort: 6379,
    redisPassword: '',
    redisDb: 0,
    redisPrefix: 'docker',
  },
  aws_s3: {
    region: 'sa-east-1' as any,
    access_key_id: null,
    secret_key: null,
    defaultBucketName: null,
    endpoint: null,
    forcePathStyle: null,
  },
} as unknown as ServerOptions;
