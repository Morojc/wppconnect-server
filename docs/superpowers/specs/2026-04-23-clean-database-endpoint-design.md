---
title: Clean Database Endpoint + QR Code JSON Endpoint
date: 2026-04-23
status: approved
---

# Clean Database + QR Code JSON Endpoints

## Overview

Two new endpoints:
1. `POST /api/:session/:secretkey/clean-db` — gracefully shuts down a specific WhatsApp session and wipes all its persisted data (token store + browser profile)
2. `GET /api/:session/qrcode-session-json` — returns the current QR code as a JSON response (simpler alternative to the existing PNG endpoint)

## Motivation

The existing `clear-session-data` endpoint only deletes file-based tokens and does not handle MongoDB or Redis token stores. The new endpoint fills that gap while also performing a proper graceful logout before deleting data.

The existing `qrcode-session` endpoint returns a raw PNG binary with hardcoded render options. Most API consumers need JSON. A dedicated lightweight endpoint returns just the QR data URL in a standard JSON envelope.

## Endpoint

```
POST /api/:session/:secretkey/clean-db
```

### Parameters

| Parameter   | Location | Required | Description                        |
|-------------|----------|----------|------------------------------------|
| `session`   | URL      | yes      | Name of the session to clean       |
| `secretkey` | URL      | yes      | Server secret key for auth         |

### Authentication

Secret key validated against `config.secretKey`. No Bearer token required. Returns `400` if the key does not match.

## Behavior

1. **Validate secretkey** — return `400` if it does not match `config.secretKey`
2. **Graceful disconnect** — if `clientsArray[session]` has an active client (`client.page` exists), call `client.logout()` then remove the entry from `clientsArray`
3. **Remove token** — instantiate `Factory`, call `removeToken(session)` on the resulting store (handles `file`, `mongodb`, and `redis` based on config)
4. **Delete userDataDir** — delete `config.customUserDataDir + session` recursively if the directory exists
5. **Return success** — `200 { status: true, message: 'Session cleaned successfully' }`

## Error Handling

| Condition                  | Response                                          |
|----------------------------|---------------------------------------------------|
| Wrong secretkey            | `400 { response: 'error', message: 'The token is incorrect' }` |
| Unexpected error           | `500 { status: false, message: 'Error on clean database', error }` |

## Files Changed

- `src/controller/miscController.ts` — add `cleanDatabase` export function
- `src/controller/sessionController.ts` — add `getQrCodeJson` export function
- `src/routes/index.ts` — register both new routes

## Non-Goals

- Does not affect other sessions
- Does not modify `clear-session-data` or `qrcode-session` (existing endpoints unchanged)
- Does not add a "clean all sessions" variant

---

## Endpoint 2: QR Code JSON

```
GET /api/:session/qrcode-session-json
```

### Parameters

| Parameter | Location | Required | Description              |
|-----------|----------|----------|--------------------------|
| `session` | URL      | yes      | Name of the session      |

### Authentication

Bearer token via `verifyToken` middleware (same as `qrcode-session`).

### Behavior

1. If `req.client` is undefined → `200 { status: null, message: 'Session not started' }`
2. If `req.client.urlcode` is present → generate data URL via `QRCode.toDataURL(urlcode)` and return `200 { status: 'success', qrcode: '<dataURL>' }`
3. If no QR available → `200 { status: req.client.status, qrcode: null, message: 'QR code not available' }`

### Error Handling

| Condition        | Response                                                     |
|------------------|--------------------------------------------------------------|
| Unexpected error | `500 { status: 'error', message: 'Error retrieving QR code', error }` |
