# CrewProxy CA Certificates

Place the CrewProxy CA root certificate here as `crew-proxy-ca.crt`.

This file is bundled into the packaged app via `tauri.conf.json` resources
and injected as `NODE_EXTRA_CA_CERTS` so that Bun's TLS (BoringSSL) trusts
the CrewProxy endpoint on systems where the CA is not in the system trust store
(e.g. macOS without the root cert installed in Keychain).

**Do NOT commit private keys here.** Only the public CA root certificate (.crt).
