import { afterAll, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asspp-native-test-'));
const binary = path.join(dir, 'fake-ipatool');
fs.writeFileSync(binary, `#!/bin/sh
# A PTY-controlled fake client: password/code are read on stdin, never in argv.
case "$*" in
  *"auth login"*)
    printf 'enter Apple ID (email address or phone number): '
    IFS= read -r email
    printf 'enter password: '
    IFS= read -r password
    printf 'enter passphrase to unlock /tmp/ipatool-keychain: '
    IFS= read -r key
    printf 'enter 2FA code: '
    IFS= read -r code
    [ "$email" = 'test@example.com' ] || exit 1
    [ "$password" = 'test-password' ] || exit 1
    [ -n "$key" ] || exit 1
    [ "$code" = '123456' ] || exit 1
    printf '{"name":"Mock Account","email":"test@example.com","success":true}\\n'
    ;;
  *"list-versions"*)
    printf 'enter passphrase to unlock /tmp/ipatool-keychain: '
    IFS= read -r key
    printf '{"externalVersionIdentifiers":["123","456"],"success":true}\\n'
    ;;
  *)
    printf '{"success":true}\\n'
    ;;
esac
`, { mode: 0o700 });
process.env.NATIVE_IPATOOL_BIN = binary;
process.env.DATA_DIR = path.join(dir, 'data');
afterAll(() => {
  delete process.env.NATIVE_IPATOOL_BIN;
  delete process.env.DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

it('keeps a native login process alive across an interactive Apple 2FA prompt', async () => {
  const { startNativeLogin, verifyNativeLogin, listNativeAccounts, nativeCommand } =
    await import('./nativeIpatool.js');

  const start = await startNativeLogin('test@example.com', 'test-password', '143441');
  expect(start.status).toBe('verification_required');
  if (start.status !== 'verification_required') return;
  const result = await verifyNativeLogin(start.sessionId, '123456', '143441');
  expect(result.account.email).toBe('test@example.com');
  expect(result.account.backendManaged).toBe(true);
  expect(listNativeAccounts()).toHaveLength(1);
  const response = await nativeCommand('test@example.com',
    ['list-versions', '--app-id', '123456', '--platform', 'iphone']);
  expect(response.externalVersionIdentifiers).toEqual(['123', '456']);
}, 30_000);
