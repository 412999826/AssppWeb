import { Router, type Request, type Response } from 'express';
import { createHash } from 'crypto';
import fs from 'fs';
import { config } from '../config.js';
import { createNativeTask, finishNativeTask, sanitizeTaskForResponse } from '../services/downloadManager.js';
import {
  listNativeAccounts, nativeAccount, nativeCommand, removeNativeAccount,
  startNativeLogin, verifyNativeLogin,
} from '../services/nativeIpatool.js';
import type { Software } from '../types/index.js';

const router = Router();

// Browser-to-backend Apple credential transport is permissible only with an
// explicitly configured API access password and TLS at the public entrypoint.
router.use((_req, res, next) => {
  if (!config.accessPassword || process.env.NATIVE_APPLE_AUTH !== 'true') {
    res.status(503).json({ error: 'Set ACCESS_PASSWORD and NATIVE_APPLE_AUTH=true on the Docker service before using server-side Apple sign-in.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function message(error: unknown): string {
  if (!(error instanceof Error)) return 'Native App Store operation failed';
  // Never return raw process logs or upstream error bodies containing account data.
  return error.message.slice(0, 280);
}
function failed(res: Response, error: unknown): void {
  const msg = message(error);
  const status = /Another operation|busy/i.test(msg) ? 409 : /Invalid|requires|first|expired/i.test(msg) ? 400 : 502;
  res.status(status).json({ error: msg });
}
function appId(value: unknown): string {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid App Store app ID');
  return String(n);
}
function externalVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('Invalid external version identifier');
  return value;
}
function accountEmail(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 254) throw new Error('Invalid Apple account');
  const email = value.trim().toLowerCase();
  if (!nativeAccount(email)) throw new Error('Authenticate this account with the native login first');
  return email;
}

router.get('/native/accounts', (_req: Request, res: Response) => {
  res.json(listNativeAccounts());
});

router.post('/native/auth/start', async (req: Request, res: Response) => {
  try {
    const { email, password, store } = req.body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || typeof store !== 'string')
      throw new Error('Invalid authentication parameters');
    res.json(await startNativeLogin(email, password, store));
  } catch (error) { failed(res, error); }
});

router.post('/native/auth/verify', async (req: Request, res: Response) => {
  try {
    const { sessionId, code, store } = req.body as Record<string, unknown>;
    if (typeof sessionId !== 'string' || typeof code !== 'string' || typeof store !== 'string')
      throw new Error('Invalid verification parameters');
    res.json(await verifyNativeLogin(sessionId, code, store));
  } catch (error) { failed(res, error); }
});

router.delete('/native/accounts/:id', (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(String(req.params.id));
    removeNativeAccount(email);
    res.json({ success: true });
  } catch (error) { failed(res, error); }
});

router.post('/native/purchase', async (req: Request, res: Response) => {
  try {
    const email = accountEmail(req.body.email);
    const id = appId(req.body.appId);
    const result = await nativeCommand(email, ['purchase', '--app-id', id, '--platform', 'iphone']);
    res.json({ success: true, alreadyOwned: result.alreadyOwned === true });
  } catch (error) { failed(res, error); }
});

router.post('/native/versions', async (req: Request, res: Response) => {
  try {
    const email = accountEmail(req.body.email);
    const id = appId(req.body.appId);
    const output = await nativeCommand(email, ['list-versions', '--app-id', id, '--platform', 'iphone']);
    const values = output.externalVersionIdentifiers;
    res.json({ versions: Array.isArray(values) ? values.map(String).filter((v) => /^\d+$/.test(v)) : [] });
  } catch (error) { failed(res, error); }
});

router.post('/native/version-metadata', async (req: Request, res: Response) => {
  try {
    const email = accountEmail(req.body.email);
    const id = appId(req.body.appId);
    const version = externalVersion(req.body.versionId);
    if (!version) throw new Error('Version ID is required');
    const output = await nativeCommand(email, ['get-version-metadata', '--app-id', id,
      '--external-version-id', version, '--platform', 'iphone']);
    res.json({ displayVersion: String(output.displayVersion || ''), releaseDate: String(output.releaseDate || '') });
  } catch (error) { failed(res, error); }
});

router.post('/native/download', async (req: Request, res: Response) => {
  try {
    const email = accountEmail(req.body.email);
    const input = req.body.software as Software;
    if (!input || typeof input !== 'object' || typeof input.name !== 'string' ||
      typeof input.bundleID !== 'string' || typeof input.version !== 'string' ||
      input.name.length > 300 || !/^[A-Za-z0-9._-]+$/.test(input.bundleID))
      throw new Error('Invalid application metadata');
    const id = appId(input.id);
    const version = externalVersion(req.body.versionId);
    const accountHash = createHash('sha256').update(email).digest('hex');
    const task = createNativeTask(input, accountHash);
    // Returning immediately preserves the existing asynchronous task UI.
    res.status(201).json(sanitizeTaskForResponse(task));
    void (async () => {
      try {
        if (!task.filePath) throw new Error('Missing package path');
        const args = ['download', '--app-id', id, '--output', task.filePath,
          '--platform', 'iphone'];
        if (version) args.push('--external-version-id', version);
        await nativeCommand(email, args, 3 * 60 * 60_000);
        if (config.maxDownloadMB > 0 && task.filePath &&
          fs.statSync(task.filePath).size > config.maxDownloadMB * 1024 * 1024)
          throw new Error('Package exceeds the configured download limit');
        finishNativeTask(task);
      } catch (error) {
        // Do not disclose raw upstream messages or subprocess output to clients.
        finishNativeTask(task, new Error(message(error)));
      }
    })();
  } catch (error) { failed(res, error); }
});

export default router;
