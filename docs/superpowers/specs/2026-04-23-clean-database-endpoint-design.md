---
title: Clean Database Endpoint
date: 2026-04-23
status: approved
---

# Clean Database Endpoint

## Overview

Add a new endpoint `POST /api/:session/:secretkey/clean-db` that gracefully shuts down a specific WhatsApp session and wipes all its persisted data (token store + browser profile).

## Motivation

The existing `clear-session-data` endpoint only deletes file-based tokens and does not handle MongoDB or Redis token stores. The new endpoint fills that gap while also performing a proper graceful logout before deleting data.

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
- `src/routes/index.ts` — register `POST /api/:session/:secretkey/clean-db` → `MiscController.cleanDatabase`

## Non-Goals

- Does not affect other sessions
- Does not modify `clear-session-data` (existing endpoint unchanged)
- Does not add a "clean all sessions" variant
