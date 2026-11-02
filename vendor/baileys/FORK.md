# @asamake/baileys

A fork of [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) at
tag `v7.0.0-rc13`, patched to fix `Bad MAC` session-recovery.

Upstream is MIT licensed; `LICENSE` retains their copyright notice alongside
ours. This fork exists only for the patch below and tracks upstream otherwise.

## The bug

Upstream ships a complete MAC-error recovery subsystem that is never invoked.

`src/Utils/message-retry-manager.ts` documents, at the `shouldRecreateSession`
docstring:

> MAC errors (codes 4 and 7) trigger immediate session recreation regardless of
> timeout.

The function implements exactly that, keyed on its third parameter
`errorCode?: RetryReason`. Both call sites in `src/Socket/messages-recv.ts`
called it with two arguments, so `errorCode` was always `undefined` and the MAC
branch never ran. Two sibling helpers — `isMacError()` and
`parseRetryErrorCode()` — had no callers anywhere outside their own file.

The consequence: after a `Bad MAC`, session recreation fell through to the
generic path, which is gated behind both a `retryCount > 1` check at the call
site and a one-hour-per-JID cooldown inside the manager. A desynced session
that had rotated within the last hour would not be rebuilt at all, and every
message from that peer kept failing until the cooldown expired.

This affects every released 7.x version, including `rc14`. Upstream PR #2367
(proposing a similar fix) was closed unmerged; PR #2372 is still open.

## The patch

One source file changed: `src/Socket/messages-recv.ts` (~40 lines).

**Inbound** — we failed to decrypt a peer's message:

1. `classifyDecryptError()` (new, module-level) maps the decrypt failure string
   that `decode-wa-message.ts` already stores in
   `msg.messageStubParameters[0]` to a `RetryReason` code. Strings verified
   against the actual `throw` sites in `libsignal/src/crypto.js` and
   `libsignal/src/session_cipher.js`. `'Bad MAC length'` is tested before the
   bare `'Bad MAC'`, since the latter is a substring of the former.
2. The code is threaded through `sendRetryRequest` and passed as the third
   argument to `shouldRecreateSession`, activating the documented MAC branch.
3. The `retryCount > 1` call-site gate is bypassed when the error is a MAC
   error, so a desynced session is rebuilt on the first failure.
4. The outgoing retry receipt reports the real error code instead of the
   hardcoded `error: '0'`.

**Outbound** — a peer reports that *they* failed to decrypt ours:

5. `parseRetryErrorCode()` (upstream, previously uncalled) reads the peer's
   `error` attribute from the retry node; MAC errors likewise bypass the gate
   and reach `shouldRecreateSession`.

Non-MAC errors are unchanged and still respect the cooldown, so this does not
increase session rotation in the general case.

## Scope

This shortens recovery from a broken session; it does not prevent sessions
breaking. The common local cause is two Signal key stores writing one auth
directory concurrently — usually overlapping sockets from a reconnect loop.
Fix that separately; this patch will otherwise heal sessions that your own
process re-corrupts.

## Verification

- `npm test` — 404 tests across 27 suites, all passing (unchanged from
  upstream).
- `npx tsc -P tsconfig.build.json --noEmit` — clean.
- Behavioural check: with an active cooldown and identical state, a 2-argument
  call refuses recreation (upstream behaviour) while a MAC-code call forces it
  (fork behaviour).

## Updating from upstream

```bash
git remote add upstream https://github.com/WhiskeySockets/Baileys
git fetch upstream --tags
git rebase v7.0.0-rc14   # or whichever tag
npm run build && npm test
```

Conflicts should be limited to the retry block in `messages-recv.ts`. If
upstream merges PR #2372 or equivalent, this fork can be retired.
