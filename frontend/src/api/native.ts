import { apiGet, apiPost } from './client';
import type { Account, Software, VersionMetadata } from '../types';

export interface NativeAccount {
  email: string;
  name: string;
  store: string;
  backendManaged: true;
  authenticatedAt: string;
}
export type NativeAuthResult =
  | { status: 'pending'; jobId: string }
  | { status: 'verification_required' }
  | { status: 'authenticated'; account: NativeAccount }
  | { status: 'failed'; error: string };

export function toBrowserAccount(native: NativeAccount): Account {
  const words = (native.name || '').trim().split(/\s+/).filter(Boolean);
  return {
    email: native.email, password: '', appleId: native.email,
    store: native.store, firstName: words[0] ?? '',
    lastName: words.slice(1).join(' '),
    passwordToken: '', directoryServicesIdentifier: '', cookies: [],
    deviceIdentifier: '', backendManaged: true,
  };
}

export function nativeLogin(email: string, password: string, store: string) {
  return apiPost<NativeAuthResult>('/api/native/auth/start', { email, password, store });
}
export function nativeVerify(jobId: string, code: string, store: string) {
  return apiPost<NativeAuthResult>('/api/native/auth/verify', { jobId, code, store });
}
export function nativeAuthStatus(jobId: string) {
  return apiGet<NativeAuthResult>('/api/native/auth/status/' + encodeURIComponent(jobId));
}
export function nativeAccounts() {
  return apiGet<NativeAccount[]>('/api/native/accounts');
}
export function nativePurchase(email: string, appId: number) {
  return apiPost<{ success: boolean; alreadyOwned: boolean }>('/api/native/purchase', { email, appId });
}
export function nativeDownload(email: string, software: Software, versionId?: string) {
  return apiPost('/api/native/download', { email, software, versionId });
}
export function nativeVersions(email: string, appId: number) {
  return apiPost<{ versions: string[] }>('/api/native/versions', { email, appId });
}
export function nativeVersionMetadata(email: string, appId: number, versionId: string) {
  return apiPost<VersionMetadata>('/api/native/version-metadata', { email, appId, versionId });
}
