# Native App Store authentication fallback (ipatool v2.8.1)

## Why a separate container?

AssppWeb signs and sends Apple requests entirely inside the browser, over an encrypted Wisp TCP tunnel. Its server never receives your Apple ID password or authentication session.

In November 2026 Apple changed the App Store device-proof requirements. The fixes in [ipatool v2.8.1](https://github.com/majd/ipatool/releases/tag/v2.8.1) rely on native Store AMD generation, an emulator, and pinned Apple platform components. They cannot safely be dropped into the current browser-only signer.

The CLI below is an **independent compatibility path** for authentication and downloading IPA files. It **does not** repair the existing AssppWeb web account-verification screen. It does not share account state with AssppWeb.

## Run on Docker / Synology

The GitHub Actions workflow publishes:

- `ghcr.io/412999826/assppweb-ipatool:2.8.1` (pinned release)
- `ghcr.io/412999826/assppweb-ipatool:latest` (latest packaged compatibility build)

From this repository's directory:

```sh
docker compose -f compose.yml -f compose.ipatool.yml --profile ipatool pull ipatool
docker compose -f compose.yml -f compose.ipatool.yml --profile ipatool run --rm ipatool auth login
```

The command interactively requests your Apple ID, password, and verification code if required. **Do not pass your password as a command-line flag**, since that can end up in shell history and process arguments.

Inspect the saved session:

```sh
docker compose -f compose.yml -f compose.ipatool.yml --profile ipatool run --rm ipatool auth info
```

To download applications, inspect the supported flags before running it:

```sh
docker compose -f compose.yml -f compose.ipatool.yml --profile ipatool run --rm ipatool download --help
```

All app data and the CLI's authentication state are stored in `./mnt/ipatool-data` on the Docker host. Limit access to this directory and back it up only if you can protect it.

## Operational and security notes

- This CLI container is isolated from the AssppWeb backend and does not expose an HTTP authentication API. The browser app keeps its existing zero-trust behavior.
- Initial Apple Store AMD provisioning may download substantial platform assets and consume significant memory/disk. Keep the persistent volume attached across runs.
- Use a private host you control. Apple accounts and acquired IPA files remain subject to Apple's policies.
- The image pins exact SHA-256 digests of the upstream Linux amd64 and arm64 v2.8.1 release archives.
- Build success verifies the packaged CLI can start. It **does not** prove live Apple ID login; a real-account test is required for that.
- If `auth login` cannot use the Linux keychain, follow ipatool's interactive keychain passphrase prompt; do not store passphrases in your compose file.
- To fix AssppWeb's web login itself, a separate browser-compatible AMD proof solution or an explicitly approved change in credential trust boundaries is still necessary.
