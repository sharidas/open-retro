# Dependency security follow-up

Checked on 2026-11-17. Remediation remains open: no compatible patched release
was available for the current finding. Package manifests and the lockfile were
left unchanged; findings have not been suppressed.

## Finding

`npm audit --json` reports five high-severity affected package entries, all
stemming from one advisory:
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
Picomatch can consume excessive CPU when processing crafted repeated extglob
patterns. The advisory covers versions through 4.0.7 and lists no patched version.
The npm registry also reported 4.0.7 as the latest published version at inspection.

The locked development dependency chain is:

- Vite 7.3.7 uses picomatch directly and through tinyglobby/fdir.
- Vitest 5.1.0 uses picomatch directly, tinyglobby, and Vite.
- tinyglobby 0.2.17 and fdir 6.5.0 also lead to picomatch 4.0.7.

The five affected entries are picomatch, fdir, tinyglobby, Vite, and Vitest; this
is not five independent underlying vulnerabilities. npm proposes major downgrades
of Vite and Vitest. Those are not compatible patch updates and were not applied.
A different toolchain would need independent security and compatibility review.

## Current boundary and limits

`npm audit --omit=dev --json` reported zero runtime dependency vulnerabilities at
this check. The production Dockerfile builds in a separate stage and prunes dev
dependencies before copying node_modules to the runtime image. The development
server remains bound to host localhost through Compose.

This does not fix the vulnerable development/build tools or certify the base
image. Keep build inputs and glob configuration trusted; do not expose the Vite
development server as a public production service. The retro API does not accept
glob configuration from participants. This boundary is not a claim that every
possible development-server input path has been proven safe.

## Recheck and close

Run inside the development container (no host npm needed):

```bash
docker compose exec -T dev npm audit --json
docker compose exec -T dev npm ls picomatch vite vitest tinyglobby fdir
docker compose exec -T dev npm view picomatch version versions --json
docker compose exec -T dev npm audit --omit=dev --json
```

An audit exit code of 1 is expected while findings remain. Check the advisory for
a published fix; update the lockfile using compatible dependency ranges once one
is available. Do not use `npm audit fix --force` merely to make the report green.
After updating, rebuild the development image, rerun the full test suite,
TypeScript/portability checks and production image build, and audit both the full
and runtime dependency sets again. Close this follow-up only once the affected
dependency is removed or a verified fix is installed.
