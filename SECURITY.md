# Security Policy

## Supported Versions

Security fixes are issued only for the latest `2.x` release line. Older
major versions (`1.x`) are no longer maintained — upgrade to `2.x` if
you need a security fix.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/ilovepixelart/ts-cache-mongoose/security/advisories/new)
form. This routes the report directly to the maintainer through a private
advisory and keeps the details out of the public issue tracker until a fix
is available.

When reporting, please include:

- The affected version(s) of `ts-cache-mongoose`
- A minimal reproduction (schema, cache engine, query or aggregate
  pipeline, observed vs expected behavior)
- The impact you believe the issue has (data integrity, information
  disclosure, cache poisoning, denial of service, etc.)

## Response Expectations

- **Acknowledgement:** within 7 days of the report.
- **Triage and fix window:** targeted within 30 days for confirmed issues,
  depending on severity and complexity.
- **Disclosure:** coordinated via the GitHub advisory. A CVE will be
  requested where applicable, and a patched release will be published to
  npm with provenance attestations before the advisory is made public.

## Scope

In scope:

- The `ts-cache-mongoose` plugin source in this repository.
- The published tarball on npm (`ts-cache-mongoose`).
- Cache key generation, invalidation, and engine (in-memory / Redis)
  integration.

Out of scope:

- Vulnerabilities in `mongoose` itself — report those to the
  [mongoose project](https://github.com/Automattic/mongoose/security).
- Vulnerabilities in `ioredis` itself — report those to the
  [ioredis project](https://github.com/redis/ioredis).
- Vulnerabilities in development-only dependencies listed under
  `devDependencies` — those do not ship in the published package.

## Supply Chain

This section explains how `ts-cache-mongoose` defends against
supply-chain attacks of the kind that hit widely-used packages in
2025 (notably the `axios` compromise, where a maintainer token was
abused to publish versions that pulled in a malicious transitive
`plain-crypto-js` dependency running obfuscated code via a
`postinstall` lifecycle hook). Each defence below maps to a concrete
step in that attack chain.

### Minimal dependency surface

- **One runtime dependency: `ioredis`.** That single dep is required
  because the Redis cache engine needs a Redis client; the in-memory
  engine uses Node built-ins only. Consumers audit a dependency
  surface of three: `ioredis`, `mongoose` (peer), and `bson` (peer).
- **Pinned peer ranges.** `mongoose >=6.6.0 <10`, `bson >=4.7.2 <8`,
  and `@nestjs/common >=9.0.0 <12` cap the upper bound at the first
  untested major so a hypothetical mongoose 10, bson 8, or Nest 12
  cannot auto-pull into consumer installs.
- **Exact production dep version.** `ioredis` is pinned to an exact
  version in `dependencies`, not a range.
- **Safety override.** The only `package.json` `overrides` entry is
  `tmp: "0.2.5"` — the `np` → `listr-input` → `inquirer` →
  `external-editor` dev-dep chain transitively declares `tmp ^0.0.33`,
  a major with a known symlink-race CVE
  ([CVE-2024-7345](https://nvd.nist.gov/vuln/detail/CVE-2024-7345));
  the override forces the patched release.

### Zero install-time lifecycle scripts

- **`package.json` has no `postinstall`, `preinstall`, or `prepare`
  script** in the published manifest. The `prepare: simple-git-hooks`
  entry was dropped in favour of a one-time `npx simple-git-hooks`
  command documented in `CONTRIBUTING.md`. Consumer `npm install`
  cannot execute any of our lifecycle code, and attackers who smuggle
  in a malicious transitive dep still cannot run `postinstall` code
  from *this* package.
- **`files: ["dist"]`** ships only the `dist/` directory. No `src`,
  no `tests`, no `tsconfig.json`, no `vite.config.mts` — the
  attack surface inside the tarball is strictly the pre-built JS
  bundle, not arbitrary TypeScript that could be re-executed.

### OIDC trusted publishing

- **Releases are published via npm trusted publishing**, not a
  long-lived npm token. The `publish.yaml` workflow uses
  `id-token: write` and lets npm verify the publish was triggered by
  a specific GitHub Actions workflow run on this repository via OIDC.
  There is no `NPM_TOKEN` secret that can be exfiltrated from the
  repo or a maintainer account.
- **The publish pipeline is split into two jobs** so the tarball
  that gets attested is the exact same one that gets published:
  `build` runs full CI, `npm pack`s the tarball, signs it via
  [`actions/attest@v4`](https://github.com/actions/attest) (Sigstore
  keyless OIDC → SLSA v1 build provenance attestation
  [predicate type `https://slsa.dev/provenance/v1`] uploaded to
  GitHub's native attestation store), then uploads the tarball as a
  workflow artifact; `publish` downloads that artifact and runs
  `npm publish` — npm-registry provenance is emitted automatically
  via `publishConfig.provenance: true`. **Every action in every
  workflow is SHA-pinned** — there are no tag-pin exceptions.

### Release verifiability

[SLSA v1.2's distributing-provenance guidance](https://slsa.dev/spec/v1.2/distributing-provenance)
states that producers **MUST** publish attestations in at least one
place and **SHOULD** publish in more than one — the rationale being
that independent channels give consumers more than one way to
verify and remove any single point of failure. This project
publishes the same SLSA v1 build provenance in **three independent
channels** on every release (with the third channel carrying two
separate artifacts that target different verification tools, giving
four attestation files in total across the three channels):

1. **npm registry provenance** — emitted automatically by
   `npm publish` because `publishConfig.provenance: true` is set in
   `package.json`. Verifiable with
   [`npm audit signatures`](https://docs.npmjs.com/generating-provenance-statements).
2. **GitHub native attestation store** — produced by
   [`actions/attest@v4`](https://github.com/actions/attest) in the
   `build` job. Stored at
   [github.com/ilovepixelart/ts-cache-mongoose/attestations](https://github.com/ilovepixelart/ts-cache-mongoose/attestations)
   and verifiable through `gh attestation verify` — no extra tooling
   install required by consumers who already have the `gh` CLI.
3. **GitHub Release assets** — two sidecar files attached to the
   GitHub Release, carrying the same DSSE envelope at the innermost
   layer but in different outer containers for different verification
   flows:
   - **`<tarball>.sigstore.json`** — a straight copy of
     `actions/attest`'s output, a full Sigstore bundle
     ([`application/vnd.dev.sigstore.bundle.v0.3+json`](https://github.com/sigstore/protobuf-specs/blob/main/protos/sigstore_bundle.proto)).
     Carries the Fulcio certificate and the Rekor inclusion proof
     inline, so consumers can verify offline without querying Rekor.
     Parsed by `gh attestation verify --bundle` and other
     Sigstore-native tooling.
   - **`<tarball>.intoto.jsonl`** — a spec-compliant
     [in-toto attestation v1 bundle](https://github.com/in-toto/attestation/blob/main/spec/v1/bundle.md):
     JSON Lines of DSSE envelopes, one envelope per line. Extracted
     from the Sigstore bundle via `jq -c '.dsseEnvelope'` — this is
     a genuine in-toto bundle, not a renamed Sigstore bundle.
     Parsed by `slsa-verifier verify-artifact`, which queries Rekor
     for the certificate and inclusion proof via the signature hash.

   The two files are **not** duplicate signing material — they are
   the same cryptographic signature presented in two different
   container formats that different verification tools understand.
   The `.sigstore.json` container embeds everything needed for
   offline verification; the `.intoto.jsonl` container is smaller
   and requires a Rekor lookup at verify time. Neither file names
   itself as something it isn't.

**Status:** the hardened pipeline was introduced in the 2.x
maintenance series. `2.1.0` predates the new `publish.yaml`
entirely — no provenance in any channel. Starting with the first
release under the hardened pipeline (**next release after this
change lands**), every published tarball will ship with npm
provenance, GitHub attestation-store provenance, and both
release-asset sidecars.

### Dev-environment isolation

- **Dependabot is configured for `github-actions` only**, not `npm`
  (see `.github/dependabot.yml`). Every runtime or dev-dep bump
  requires a manual, reviewed PR — the lib never auto-merges a new
  version of anything that reaches consumer installs. GitHub Actions
  SHA pins do get auto-bumped weekly because those pins are meant to
  rot fast and auto-bumping keeps Scorecard's Pinned-Dependencies at
  maximum.
- **CI action dependencies are SHA-pinned with trailing version
  comments**, so a compromised upstream action's new tag cannot
  silently run with our privileges.
- **Maintainer npm account uses 2FA / WebAuthn.** This is the single
  defence that cannot be enforced from the repository — it is a
  maintainer-side responsibility. A reviewer auditing this project's
  supply-chain posture should treat it as a documented commitment:
  if 2FA were disabled, the OIDC trusted-publishing defence above
  would not fully protect against a session hijack.

### Consumer verification steps

Anyone integrating `ts-cache-mongoose` into a production pipeline
has four verification paths available, each exercising one of the
distribution channels documented above. Pick the one that matches
the tooling you already trust and the environment you're deploying
to — the trust model is identical (all four resolve to the same
Fulcio-issued certificate binding the signature to the exact
GitHub Actions workflow run). For releases earlier than the
hardened pipeline, `npm audit signatures` only verifies npm
registry signatures without provenance.

**Primary check (no extra tooling):**

```bash
# Verifies npm provenance and registry signatures for all installed
# packages in one pass. Built into npm, no extra install required.
npm audit signatures

# Cross-checks the installed version against npm dist-tags.
npm view ts-cache-mongoose dist-tags
```

**Advanced check (independent of npm):**

```bash
# Pull the tarball from the npm registry (or GitHub Release) first:
npm pack ts-cache-mongoose@X.Y.Z

# Verify against the attestation stored on GitHub:
gh attestation verify ts-cache-mongoose-X.Y.Z.tgz \
  --repo ilovepixelart/ts-cache-mongoose \
  --signer-workflow ilovepixelart/ts-cache-mongoose/.github/workflows/publish.yaml
```

The `--signer-workflow` flag pins the verification to the exact
workflow file that produced the attestation — a stronger claim than
just `--repo` alone, because it blocks any other workflow in the
same repository from producing attestations that would pass
verification.

**Offline check via Sigstore bundle:**

```bash
gh attestation verify ts-cache-mongoose-X.Y.Z.tgz \
  --bundle ts-cache-mongoose-X.Y.Z.tgz.sigstore.json \
  --repo ilovepixelart/ts-cache-mongoose \
  --signer-workflow ilovepixelart/ts-cache-mongoose/.github/workflows/publish.yaml
```

**Third-party check via in-toto attestation bundle:**

```bash
# Install once (needs Go toolchain):
go install github.com/slsa-framework/slsa-verifier/v2/cmd/slsa-verifier@latest

# Verify:
slsa-verifier verify-artifact ts-cache-mongoose-X.Y.Z.tgz \
  --provenance-path ts-cache-mongoose-X.Y.Z.tgz.intoto.jsonl \
  --source-uri github.com/ilovepixelart/ts-cache-mongoose \
  --source-tag vX.Y.Z
```

All four verification paths end up at the same Fulcio-issued
certificate binding the signature to the exact GitHub Actions
workflow file that produced it. The split is about which tool you
trust and which dependencies you have installed, not about which
path is more secure.

## OpenSSF Scorecard — Accepted Findings

The project runs [OpenSSF Scorecard](https://securityscorecards.dev/) on a
weekly schedule (see `.github/workflows/scorecard.yaml`). The following
checks intentionally stay below their maximum score; the rationale is
documented here so future reviewers understand why they are not bugs to
chase:

- **`Code-Review`** — Scorecard requires that recent commits be approved
  by a reviewer distinct from the author. `ts-cache-mongoose` has a
  single active maintainer, so every change is inherently self-merged.
  Requiring approvals would either block all work or force self-approvals
  from a second account — neither offers real review value. We rely on
  automated gates (CI status checks, CodeQL, Scorecard, SonarCloud,
  Socket, Biome, type checks) to catch issues instead of human review.

- **`Contributors`** — Scorecard wants contributors from 3+ distinct
  organizations in the last 30 commits. As a personal project this is
  structurally unattainable; the score will move organically if external
  contributors join.

- **`CII-Best-Practices`** — tracked at
  [bestpractices.dev/projects/12484](https://www.bestpractices.dev/en/projects/12484).
  The project targets the "passing" tier; "silver" and "gold" require
  multiple reviewers and documented security-review processes that are
  out of reach for a single-maintainer project.

- **`Pinned-Dependencies`** — caps at ~8/10 due to a single structural
  exception: the `npm i ${{ matrix.mongoose-version[0] }} ${{ matrix.mongoose-version[1] }}`
  step in `pr-check.yaml` installs a different mongoose + bson version
  pair per matrix cell from the npm registry, and there is no
  hash-pinned lockfile shape that supports matrix overrides. The
  exception is structural to the CI matrix design and will persist
  as long as the project tests against multiple mongoose majors.
  All GitHub Actions in every workflow are SHA-pinned — there are
  no tag-pin exceptions anywhere.
