import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface NativeAccount {
  email: string;
  name: string;
  store: string;
  backendManaged: true;
  authenticatedAt: string;
}

type NativeOutput = Record<string, unknown>;
const base = path.resolve(config.dataDir, 'native-accounts');
const metadataPath = path.join(base, 'accounts.json');
const active = new Set<string>();
const sessions = new Map<string, { email: string; runner: NativeRunner; createdAt: number }>();

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!value || value.length > 254 || /[\r\n\0]/.test(value)) throw new Error('Invalid Apple account identifier');
  return value;
}
function accountDirectory(email: string): string {
  const hash = createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return path.join(base, hash);
}
function ensureAccountHome(email: string): { home: string; secret: string } {
  const home = accountDirectory(email);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  const secretPath = path.join(home, '.keychain-passphrase');
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  }
  return { home, secret: fs.readFileSync(secretPath, 'utf8').trim() };
}
function accountMetadata(): NativeAccount[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return Array.isArray(data) ? data.filter((v): v is NativeAccount =>
      typeof v === 'object' && v !== null && typeof v.email === 'string' &&
      typeof v.store === 'string' && v.backendManaged === true) : [];
  } catch { return []; }
}
function saveAccount(account: NativeAccount): void {
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const all = [...accountMetadata().filter((a) => a.email !== account.email), account];
  const temporary = metadataPath + '.' + randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(all), { mode: 0o600 });
  fs.renameSync(temporary, metadataPath);
}
export function listNativeAccounts(): NativeAccount[] { return accountMetadata(); }
export function nativeAccount(email: string): NativeAccount | undefined {
  return accountMetadata().find((a) => a.email === normalizeEmail(email));
}
export function removeNativeAccount(email: string): void {
  const key = normalizeEmail(email);
  if (active.has(key)) throw new Error('Account is busy. Try again later.');
  const remaining = accountMetadata().filter((a) => a.email !== key);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const temporary = metadataPath + '.' + randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(remaining), { mode: 0o600 });
  fs.renameSync(temporary, metadataPath);
  fs.rmSync(accountDirectory(key), { recursive: true, force: true });
}
function validArg(value: string): string {
  if (!/^[A-Za-z0-9._:\/@-]+$/.test(value)) throw new Error('Invalid native command argument');
  return value;
}
function safeError(): Error {
  return new Error('Apple authentication or App Store operation failed. Check the Apple account status or server logs for non-sensitive diagnostics.');
}

/** Runs ipatool in a pseudo-terminal so password, 2FA and file-keychain
 * passphrases never appear in process arguments, environment variables or logs.
 * The PTY explicitly disables tty echo before opening the CLI. */
class NativeRunner {
  private process: ChildProcessWithoutNullStreams;
  private output = '';
  private seen = new Set<string>();
  private waitingForCode = false;
  private closed = false;
  private codeResolver!: () => void;
  readonly codePrompt: Promise<void>;
  readonly done: Promise<NativeOutput>;
  private timer: NodeJS.Timeout;

  constructor(email: string, args: string[], password?: string, timeoutMs = 12 * 60_000) {
    const { home, secret } = ensureAccountHome(email);
    const cmd = 'stty -echo; exec /usr/local/bin/ipatool --format json ' + args.map(validArg).join(' ');
    const env = {
      ...process.env, HOME: home,
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      TERM: 'dumb',
    };
    this.codePrompt = new Promise((resolve) => { this.codeResolver = resolve; });
    this.process = spawn('/usr/bin/script', ['-q', '-e', '-f', '-c', cmd, '/dev/null'], {
      env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const send = (value: string) => {
      if (!this.closed) this.process.stdin.write(value + '\n');
    };
    const onOutput = (data: Buffer) => {
      this.output = (this.output + data.toString('utf8')).slice(-65_536);
      const prompts: [string, RegExp, string | undefined][] = [
        ['email', /enter Apple ID \(email address or phone number\):\s*$/i, email],
        ['password', /enter password:\s*$/i, password],
        ['keychain', /enter passphrase to unlock [^\r\n]*:\s*$/i, secret],
        ['code', /enter 2FA code:\s*$/i, undefined],
      ];
      for (const [key, pattern, value] of prompts) {
        if (this.seen.has(key) || !pattern.test(this.output)) continue;
        this.seen.add(key);
        if (key === 'code') {
          this.waitingForCode = true;
          this.codeResolver();
        } else if (value !== undefined) {
          send(value);
        }
        break;
      }
    };
    this.process.stdout.on('data', onOutput);
    this.process.stderr.on('data', onOutput);
    this.timer = setTimeout(() => this.cancel(), timeoutMs);
    this.timer.unref();
    this.done = new Promise<NativeOutput>((resolve, reject) => {
      this.process.once('error', () => {
        this.closed = true;
        clearTimeout(this.timer);
        reject(new Error('Native ipatool could not start'));
      });
      this.process.once('close', (code) => {
        this.closed = true;
        clearTimeout(this.timer);
        if (code !== 0) { reject(safeError()); return; }
        const records = this.output.split(/[\r\n]+/).map((line) => {
          try { return JSON.parse(line.trim()) as NativeOutput; } catch { return null; }
        }).filter((record): record is NativeOutput => record !== null);
        const result = [...records].reverse().find((record) => record.success === true);
        if (!result) reject(new Error('ipatool did not report a successful result'));
        else resolve(result);
      });
    });
  }

  enterCode(code: string): void {
    if (!this.waitingForCode || this.closed || !/^\d{6}$/.test(code)) throw new Error('Invalid verification step or code');
    this.waitingForCode = false;
    this.process.stdin.write(code + '\n');
  }
  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.kill('SIGKILL');
  }
}

function lock(email: string): () => void {
  const key = normalizeEmail(email);
  if (active.has(key)) throw new Error('Another operation is in progress for this account');
  active.add(key);
  return () => active.delete(key);
}
function responseAccount(email: string, store: string, name: string): NativeAccount {
  const account: NativeAccount = { email, name: name || email, store, backendManaged: true,
    authenticatedAt: new Date().toISOString() };
  saveAccount(account);
  return account;
}

export async function startNativeLogin(emailInput: string, password: string, store: string) {
  const email = normalizeEmail(emailInput);
  if (!password || password.length > 1024) throw new Error('Password is required');
  if (!/^\d{6}$/.test(store)) throw new Error('Invalid storefront');
  const release = lock(email);
  let runner: NativeRunner;
  try {
    runner = new NativeRunner(email, ['auth', 'login'], password);
  } catch (error) { release(); throw error; }
  const sessionId = randomUUID();
  sessions.set(sessionId, { email, runner, createdAt: Date.now() });
  const finished = runner.done.finally(() => {
    release();
    sessions.delete(sessionId);
  });
  // Do not let a request resolving at the 2FA prompt leak an unhandled rejection.
  void finished.catch(() => undefined);
  const outcome = await Promise.race([
    finished.then((value) => ({ status: 'complete' as const, value })),
    runner.codePrompt.then(() => ({ status: 'verification_required' as const })),
  ]);
  if (outcome.status === 'verification_required') {
    // The original process and SAP/AMD session remain alive until code submission.
    return { status: 'verification_required' as const, sessionId };
  }
  return { status: 'authenticated' as const,
    account: responseAccount(email, store, String(outcome.value.name || email)) };
}

export async function verifyNativeLogin(sessionId: string, code: string, store: string) {
  const session = sessions.get(sessionId);
  if (!session || Date.now() - session.createdAt > 10 * 60_000) throw new Error('Verification session expired');
  if (!/^\d{6}$/.test(store)) throw new Error('Invalid storefront');
  session.runner.enterCode(code);
  const result = await session.runner.done;
  return { status: 'authenticated' as const,
    account: responseAccount(session.email, store, String(result.name || session.email)) };
}

export async function nativeCommand(emailInput: string, args: string[], timeoutMs = 12 * 60_000): Promise<NativeOutput> {
  const email = normalizeEmail(emailInput);
  if (!nativeAccount(email)) throw new Error('Authenticate the account in the web UI first');
  const release = lock(email);
  try {
    const job = new NativeRunner(email, args, undefined, timeoutMs);
    return await job.done;
  } finally { release(); }
}
