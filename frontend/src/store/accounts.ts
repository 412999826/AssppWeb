import { create } from 'zustand';
import { openDB, type IDBPDatabase } from 'idb';
import type { Account } from '../types';
import { nativeAccounts, toBrowserAccount } from '../api/native';
import { apiDelete } from '../api/client';

const DB_NAME = 'asspp-accounts';
const STORE_NAME = 'accounts';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'email' });
        }
      },
    });
  }
  return dbPromise;
}

interface AccountsState {
  accounts: Account[];
  loading: boolean;
  loadAccounts: () => Promise<void>;
  addAccount: (account: Account) => Promise<void>;
  removeAccount: (email: string) => Promise<void>;
  updateAccount: (account: Account) => Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: true,

  loadAccounts: async () => {
    set({ loading: true });
    const db = await getDB();
    let accounts = await db.getAll(STORE_NAME) as Account[];
    try {
      const remote = await nativeAccounts();
      const remoteEmails = new Set(remote.map((a) => a.email));
      for (const value of accounts.filter((a) => a.backendManaged && !remoteEmails.has(a.email))) {
        await db.delete(STORE_NAME, value.email);
      }
      for (const item of remote) {
        await db.put(STORE_NAME, toBrowserAccount(item));
      }
      accounts = await db.getAll(STORE_NAME) as Account[];
    } catch {
      // Login access token may not be available at startup. Local accounts
      // remain readable until the user unlocks the server.
    }
    set({ accounts, loading: false });
  },

  addAccount: async (account: Account) => {
    const db = await getDB();
    await db.put(STORE_NAME, account);
    set({
      accounts: [...get().accounts.filter((a) => a.email !== account.email), account],
    });
  },

  removeAccount: async (email: string) => {
    const existing = get().accounts.find((a) => a.email === email);
    if (existing?.backendManaged) {
      await apiDelete('/api/native/accounts/' + encodeURIComponent(email));
    }
    const db = await getDB();
    await db.delete(STORE_NAME, email);
    set({ accounts: get().accounts.filter((a) => a.email !== email) });
  },

  updateAccount: async (account: Account) => {
    const db = await getDB();
    await db.put(STORE_NAME, account);
    set({
      accounts: get().accounts.map((a) => (a.email === account.email ? account : a)),
    });
  },
}));

// Auto-load accounts on import
useAccountsStore.getState().loadAccounts();
