# Local production package

This package runs the compiled frontend and API in one Node process. It uses no
paid service and needs only Docker with Compose. It is separate from the Vite
source-editing setup in `compose.yaml`. Browser/device release checks remain in
[release-verification.md](release-verification.md).

## Start and stop

From the repository root:

```bash
docker compose -f compose.production.yaml up --build -d
docker compose -f compose.production.yaml ps
```

Open http://localhost:18080. If port 18080 is occupied, set `OPEN_RETRO_PORT`
in your shell (for example, 18081) before running Compose, then open that port. Wait for the container to report healthy. The health
check verifies HTTP process availability; it does not perform a database write.
Direct participant and facilitator links work after reload. Use the same hostname
consistently: localhost and 127.0.0.1 have separate browser storage.

```bash
docker compose -f compose.production.yaml logs --tail 100 app
docker compose -f compose.production.yaml stop
docker compose -f compose.production.yaml start
```

`down` removes the container/network but preserves data. **Do not add `-v` unless
you intend to delete the production database volume.** Keep the same checkout
folder/project name when running commands, or set a consistent Compose `-p` name;
a different project name selects a different volume.

## Storage and maintenance

- SQLite lives at `/app/data/open-retro.sqlite` in the `production-data` named
  volume. Development uses a different volume; data is not migrated between them.
- Migrations run before the server starts. Startup fails on migration errors.
- Existing room expiry rules apply: 24 hours, with cleanup at startup and then
  every minute. Restarting does not extend expiry. No external scheduler is needed.
- The runtime runs as the `node` user, with a read-only image filesystem and
  writable data volume and temporary directory. Use one app replica per volume.
- The image builds for the Docker host's architecture; no x86-only platform is
  forced. Native Apple Silicon/Windows and physical-device checks remain pending.
- Docker logs rotate at 10 MB per file with up to three files. The app does not
  enable request logging. Any added proxy must avoid logging bodies, Authorization
  headers, private links, and other sensitive request data.

## Update and backup

Before upgrading, stop the app and back up the entire data directory. Copying only
the database file while the app is running can miss SQLite journal/WAL data.
One portable approach is Docker's copy command while the container is stopped:

```bash
docker compose -f compose.production.yaml stop app
docker compose -f compose.production.yaml cp app:/app/data ../retro-backup
docker compose -f compose.production.yaml start app
```

Keep backups outside the checkout/build context, restrict access, and expire them
separately. Backups contain private cards and credential hashes. Test restoration
in an isolated project before relying on a backup; restore procedures and schema
rollback are not automated by this package.

After saving a backup and updating the checkout:

```bash
docker compose -f compose.production.yaml up --build -d
```

Migrations may change the schema; do not assume that running an older image will
undo an upgrade. An unhealthy container is not automatically restarted solely
because its health check fails; inspect its status/logs. Process exits restart
under `unless-stopped`, except when you explicitly stop it.

## Network boundary

Port 18080 binds only to the host loopback interface. This is intentional: the
package is ready for local operation, not public Internet exposure. It has no TLS
terminator or public-host configuration. Team access from other computers needs
a separately configured HTTPS reverse proxy and network policy. Do not simply
publish this HTTP port publicly: room credentials grant access to private data.
A public deployment remains a separate milestone with a firm $0 spending limit.
