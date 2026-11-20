import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageContainer from '../Layout/PageContainer';
import Spinner from '../common/Spinner';
import { useAccounts } from '../../hooks/useAccounts';
import { useToastStore } from '../../store/toast';
import { countryCodeMap } from '../../apple/config';
import { nativeLogin, nativeVerify, toBrowserAccount } from '../../api/native';
import { getErrorMessage } from '../../utils/error';

export default function AddAccountForm() {
  const navigate = useNavigate();
  const { addAccount } = useAccounts();
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [country, setCountry] = useState('US');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const field = 'block min-h-11 w-full rounded-xl bg-gray-100 px-3 py-2 text-base text-gray-900 dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500/40';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const store = countryCodeMap[country];
      if (!store) throw new Error('Select an App Store region');
      const result = sessionId
        ? await nativeVerify(sessionId, code, store)
        : await nativeLogin(email.trim(), password, store);
      if (result.status === 'verification_required') {
        setSessionId(result.sessionId);
        setCode('');
        setPassword('');
        addToast(t('accounts.addForm.codeHelp'), 'info');
        return;
      }
      await addAccount(toBrowserAccount(result.account));
      setPassword('');
      setCode('');
      setSessionId(null);
      addToast(t('accounts.addForm.addSuccess'), 'success');
      navigate('/accounts');
    } catch (err) {
      if (sessionId) {
        setSessionId(null);
        setCode('');
        addToast('Verification did not finish. Please begin a new sign-in.', 'error');
      }
      addToast(getErrorMessage(err, t('accounts.addForm.authFailed')), 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer title={t('accounts.addForm.title')}>
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 sm:p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Apple authentication is performed on your private Docker server with ipatool. 
              Configure ACCESS_PASSWORD, NATIVE_APPLE_AUTH=true and HTTPS before using this feature.
              Your password is not saved in the browser account record.
            </p>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">{t('accounts.addForm.email')}</label>
              <input id="email" type="text" autoComplete="username" required disabled={loading || Boolean(sessionId)}
                value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </div>
            {!sessionId ? (
              <>
                <div>
                  <label htmlFor="password" className="mb-1 block text-sm font-medium">{t('accounts.addForm.password')}</label>
                  <input id="password" type="password" autoComplete="current-password" required disabled={loading}
                    value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="store-region" className="mb-1 block text-sm font-medium">{t('accounts.detail.storeRegion')}</label>
                  <select id="store-region" className={field} value={country} disabled={loading}
                    onChange={(e) => setCountry(e.target.value)}>
                    {Object.keys(countryCodeMap).sort().map((value) => (
                      <option key={value} value={value}>{t('countries.' + value, value)} ({value})</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Select the country or region of your Apple App Store account.</p>
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="verification" className="mb-1 block text-sm font-medium">{t('accounts.addForm.code')}</label>
                <input id="verification" className={field} type="text" inputMode="numeric" pattern="[0-9]{6}"
                  autoComplete="one-time-code" maxLength={6} required value={code} disabled={loading}
                  onChange={(e) => setCode(e.target.value)} autoFocus />
              </div>
            )}
          </section>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={loading}
              className="flex min-h-11 items-center gap-2 rounded-full bg-blue-600 px-6 py-2 text-white disabled:opacity-50">
              {loading && <Spinner />}
              {sessionId ? t('accounts.addForm.verify') : t('accounts.addForm.signIn')}
            </button>
            <button type="button" onClick={() => navigate('/accounts')} disabled={loading}
              className="min-h-11 rounded-full bg-gray-200 px-6 py-2 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              {t('accounts.addForm.cancel')}
            </button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
