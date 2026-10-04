import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../state/auth';
import { ApiError, api, errorMessage } from '../lib/api';
import { AuthShell, FormError, PasswordInput, SiteField, SiteInput, SubmitButton, TextLink } from './public/auth';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  return (
    <AuthShell
      title="Welcome back."
      lede="Sign in to your phone system."
      top={
        <>
          <span className="hidden sm:inline">New to Envo? </span>
          <TextLink to="/signup">Create an account</TextLink>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setUnverified(false);
          setResent(false);
          try {
            await login(email, password);
          } catch (err) {
            setError(errorMessage(err));
            setUnverified(err instanceof ApiError && err.status === 403);
          } finally {
            setBusy(false);
          }
        }}
      >
        <SiteField label="Email">
          <SiteInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required placeholder="you@company.com" />
        </SiteField>
        <SiteField
          label="Password"
          aside={
            <Link to="/forgot-password" className="text-[13.5px] font-normal text-[#5b616e] hover:text-[#0b0d12]">
              Forgot it?
            </Link>
          }
        >
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </SiteField>
        <FormError>
          {error && (
            <>
              {error}
              {unverified &&
                (resent ? (
                  <span className="mt-1 block text-[#5b616e]">A new confirmation link is on its way.</span>
                ) : (
                  <button
                    type="button"
                    className="mt-1 block font-medium underline underline-offset-4"
                    onClick={async () => {
                      await api.post('/api/public/resend-verification', { email }).catch(() => undefined);
                      setResent(true);
                    }}
                  >
                    Send the confirmation link again
                  </button>
                ))}
            </>
          )}
        </FormError>
        <div className="pt-2">
          <SubmitButton busy={busy}>Sign in</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
