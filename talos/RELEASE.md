# Local Release Runbook (Dual-Server)

This runbook follows the current constraints:
- Local machine builds and packages artifacts only.
- Remote servers publish.
- Remote R2 host publishes `org`; remote OSS host publishes `cn`.

## 1) Prepare Configs

Copy templates if needed:

```bash
cp config/config.template.json config/config.json
cp config/config.r2.template.json config/config.r2.json
```

Optional channel prefixes (recommended):
- `config/config.json` -> `web.build.deployChannels.beta.ossPrefix`, `web.build.deployChannels.prod.ossPrefix`
- `config/config.r2.json` -> `web.build.deployChannels.beta.r2Prefix`, `web.build.deployChannels.prod.r2Prefix`

If channel mappings are missing, scripts fallback to:
- `prod`: use base prefix from `oss.prefix` / `r2.prefix`
- `beta`: derive from base prefix (`_dev -> _beta`, or append `-beta`)

## 2) Package Artifacts Locally

CN beta package:

```bash
pnpm release:package:cn:beta
```

ORG beta package:

```bash
pnpm release:package:org:beta
```

CN prod package:

```bash
pnpm release:package:cn:prod
```

ORG prod package:

```bash
pnpm release:package:org:prod
```

Artifacts are generated in `release-artifacts/`:
- `dist-<target>-<channel>-<timestamp>-<sha>.zip`
- `*.sha256`
- `*.json` (metadata)

Packaging prune rules applied automatically:
- Remove `dist/clips/Jinlong`
- Remove script files under `dist/clips` (`.py/.sh/.js/.mjs/.ts/.bash/.zsh`)

## 3) Transfer and Publish on R2 Host (org / R2)

Transfer package (example):

```bash
scp -i "<your-key>.pem" release-artifacts/dist-org-beta-*.zip \
  <remote-user>@<r2-host>:<remote-upload-dir>/dist.zip
```

Remote publish:

```bash
ssh -i "<your-key>.pem" <remote-user>@<r2-host>
cd <remote-upload-dir>
rm -rf dist && unzip dist.zip && rm dist.zip
cd <talos-repo-dir>
DEPLOY_CHANNEL=beta node ./scripts/publish-R2.js
```

For prod:

```bash
DEPLOY_CHANNEL=prod node ./scripts/publish-R2.js
```

## 4) Publish Pages (org / Cloudflare Pages)

Pages is used for the root SEO entry pages under the org domain. Build the R2 target first, then package the reduced Pages artifact:

```bash
DEPLOY_CHANNEL=beta pnpm build:r2
pnpm package:pages:org:beta
pnpm publish:pages:org:beta
```

For prod:

```bash
DEPLOY_CHANNEL=prod pnpm build:r2
pnpm package:pages:org:prod
pnpm publish:pages:org:prod
```

Projects:
- Beta/UAT: `<cf-pages-project-beta>`, production branch `<beta-branch>`, custom domain `<public-domain-beta>`
- Prod/root: `<cf-pages-project-prod>`, production branch `<prod-branch>`, custom domain `<public-domain-prod>`

Create projects when needed:

```bash
pnpm create:pages:org:beta
pnpm create:pages:org:prod
```

Cloudflare-side settings:
- Add `<public-domain-beta>` to `<cf-pages-project-beta>` and `<public-domain-prod>` to `<cf-pages-project-prod>` from Pages > Custom domains.
- If `<public-domain-prod>` is an apex domain, the zone must be on the same Cloudflare account as the Pages project.
- To prevent direct `*.pages.dev` access, create account-level Bulk Redirects:
  - `<cf-pages-project-beta>.pages.dev` -> `https://<public-domain-beta>` with Preserve query string, Subpath matching, Preserve path suffix, Include subdomains.
  - `<cf-pages-project-prod>.pages.dev` -> `https://<public-domain-prod>` with the same parameters.
- To restrict preview deployment URLs, enable the Pages Access policy under Pages > Settings > General. Pages preview deployment URLs are public by default; Access protects preview URLs, while the Bulk Redirect handles the project `*.pages.dev` domain and branch/hash aliases.

## 5) Transfer and Publish on OSS Host (cn / OSS)

Upload package to the OSS publishing host as `dist.zip` (FileZilla or SCP), then:

```bash
ssh <deploy-user>@<oss-host>
cd <talos-repo-dir>
rm -rf dist && unzip dist.zip && rm dist.zip
DEPLOY_CHANNEL=beta pnpm publish:web
```

For prod:

```bash
DEPLOY_CHANNEL=prod pnpm publish:web
```

## 6) Verification Checklist

After each publish, verify:
- Beta domains:
  - `<public-domain-beta-org>`
  - `<public-domain-beta-cn>`
- Production domains:
  - `<public-domain-prod-org>`
  - `<public-domain-prod-cn>`
- Key files: `index.html`, main JS asset, `manifest.json`, search docs
- Cache headers behavior (html no-store, assets immutable)
- Pages-only org checks:
  - `https://<public-domain-prod-org>/<seo-token>/`
  - `https://<cf-pages-project-prod>.pages.dev/` redirects to `https://<public-domain-prod-org>/`
  - `https://<public-domain-beta-org>/<seo-token>/`
  - `https://<cf-pages-project-beta>.pages.dev/` redirects to `https://<public-domain-beta-org>/`

## 7) Notes

- Channel switching is controlled by `DEPLOY_CHANNEL=beta|prod`.
- Optional env overrides are supported for one-off publishing:
  - `DEPLOY_PREFIX`
  - `DEPLOY_BETA_PREFIX`
  - `DEPLOY_PROD_PREFIX`
- Keep credentials only on remote publishing machines.
