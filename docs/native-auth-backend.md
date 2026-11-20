# AssppWeb native App Store authentication

This branch changes the Apple account flow from browser-side SAP/AMD to the
**native ipatool v2.8.1 subprocess inside the existing AssppWeb Docker container**.

It is intended to address the 204/404/204 login responses from Apple. The
interface remains AssppWeb, and downloads/purchases/older versions for accounts
re-authenticated through the new flow use the **same backend keychain**.
It is not a standalone ipatool CLI shortcut.

## Before enabling

1. Run behind an HTTPS reverse proxy with a valid certificate.
2. Configure a strong `ACCESS_PASSWORD` for the web API and
   `NATIVE_APPLE_AUTH=true` in the Docker container environment.
3. Restrict Docker and volume access to trusted administrators. ipatool's
   Apple account state, cookies and password are persisted in its encrypted
   file keychain under `/data/native-accounts/`. The private file-keychain
   unlock passphrase is also stored server-side, with owner-only filesystem
   permissions. Volume encryption and limited backups are recommended.
4. Keep `/data` persistent; it also contains the device-provisioning state.
   Native ipatool derives its Apple device identity from the container's network
   MAC address. Docker may assign a new MAC address when the container is
   recreated. If you use a dedicated Docker bridge network, consider assigning
   the service a **unique, fixed** `mac_address` in Compose to keep that identity
   stable. Choose an address that does not conflict with anything else on that
   network; do not copy another container's MAC address.
   Do not expose this directory over public file shares.
5. This functionality is opt-in and is blocked when `ACCESS_PASSWORD` is
   absent. Do not disable the HTTPS redirect when credentials are submitted.

Example on the Docker host:

```sh
# From the folder containing compose.yml; use a long, random password.
cat > .env <<'EOF'
ACCESS_PASSWORD=REPLACE_WITH_YOUR_OWN_LONG_RANDOM_PASSWORD
EOF
chmod 600 .env
docker compose pull asspp
docker compose up -d asspp
```

The Compose file sets `NATIVE_APPLE_AUTH=true`, but it does not provide a
default access password. An existing custom compose stack must set both
environment variables explicitly.

## Use in the web interface

- In **Accounts > Add**, enter your Apple account, password, and matching
  App Store region. The backend launches the native ipatool process.
- If Apple requests two-factor verification, enter the six-digit code in
  the same browser page. The backend **keeps the same native process alive**
  between those steps so its authentication/device session is retained.
- Existing accounts from the old browser-only version are migrated by
  selecting **Re-authenticate**, typing the Apple password and confirming 2FA.
- Then use the existing search, purchase and download buttons. Native
  downloads appear in AssppWeb's normal Downloads and Packages views.
- The previous encrypted traffic-only Wisp protocol is still present for
  legacy/browser accounts until they are migrated.

## Security and compatibility limitations

- The server now receives the Apple password and code over the HTTPS web API.
  This **replaces the original browser-to-Apple zero-trust property** for
  native accounts. Never use this image on a public instance you don't control.
- The Apple password is never included in ipatool process arguments, environment
  variables or application logs. It is passed through an interactive PTY.
  However, **ipatool itself stores credentials in its server-side keychain**
  to support ongoing downloads and re-authentication.
- Each account has an independent local home/keychain and private session
  metadata. Persistent `/data` contents should be treated as sensitive.
- The selected App Store region is a UI filter used by AssppWeb; it must match
  the Apple account region.
- Re-authentication must occur on the web account detail screen before an old
  browser-only account will use the native download path.
- The native CLI version is pinned, and tarballs are checked by SHA-256.
- Live Apple login and App Store purchases/downloads cannot be validated in
  CI without user-owned credentials. Build success **does not** prove those
  Apple service operations have succeeded.
- The current implementation runs one ipatool operation per account at a time.
  A busy account may return HTTP 409; wait for its active task to finish.
- The native download task is shown as downloading until ipatool finishes,
  then completed or failed. Fine-grained progress/pause/resume for these
  native tasks is not yet implemented.
- The existing container image is built for `linux/amd64` in GitHub Actions.
  The separately published CLI image supports ARM64 as well.

## Verification

After deploying the new built image, open the web Accounts page and migrate
a test Apple account. Confirm login, code submission (if required), purchase
of a **free app**, downloaded IPA, and Packages listing. Do not test an app
that could charge your Apple account.

If authentication fails, inspect the Web UI error and the GitHub source
version; the server intentionally does not log or return raw credentials and
authentication bodies. Never paste Apple account passwords, tokens or
verification codes into issue reports.
