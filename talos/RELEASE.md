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

`publish-R2.js` does not upload point-page aliases like `<token>/index.html` by
default because org root point pages are served by Pages. Set
`SEO_UPLOAD_POINT_ALIASES=1` only for a manual R2 alias backfill.

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

### One-command CN dist transfer

Configure an SSH host alias named `atlos-cn` in `~/.ssh/config` (configuration
example below), then run from `Atlos/talos`:

```bash
pnpm deploy:cn:server
```

The command runs `pnpm build` and packages `dist/`. It then runs
`pnpm publish:web` locally while uploading the archive to
`workspace/atlos-assets/_WORK_DIR/Atlos/talos/`, validating it, and replacing
the remote `dist/`. The command finishes only after both the OSS publish and
the server `dist/` deployment succeed.

To upload an already-built local `dist/`:

```bash
pnpm deploy:cn:server --skip-build
```

Optional overrides:

```bash
ATLOS_CN_SSH_HOST=atlos-cn \
ATLOS_CN_REMOTE_DIR=workspace/atlos-assets/_WORK_DIR/Atlos/talos \
pnpm deploy:cn:server
```

The equivalent CLI options are `--host` and `--remote-dir`.
`publish:web` uses the `prod` channel by default. To publish beta instead, set
`DEPLOY_CHANNEL=beta` for the whole command so the build and publish use the
same channel:

```bash
DEPLOY_CHANNEL=beta pnpm deploy:cn:server
```

### SSH configuration

Use a dedicated SSH key. Do not put the server password in this repository,
the deploy script, package.json, or an environment variable.

Generate a key locally:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_atlos_cn -C "atlos-cn-deploy"
```

Install the public key on the server. This command asks for the server password
once:

```bash
cat ~/.ssh/id_ed25519_atlos_cn.pub | \
  ssh <remote-user>@<server-ip> \
  'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

Add the connection to `~/.ssh/config`:

```sshconfig
Host atlos-cn
    HostName <server-ip>
    User <remote-user>
    Port 22
    IdentityFile ~/.ssh/id_ed25519_atlos_cn
    IdentitiesOnly yes
```

Protect the local SSH files and test the alias:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config ~/.ssh/id_ed25519_atlos_cn
ssh atlos-cn
```

If the server only permits password authentication, omit `IdentityFile` and
`IdentitiesOnly`. `scp`/`ssh` will prompt interactively; never store the
password in a file. To reuse one password-authenticated connection during the
upload, add these optional lines to the same host entry:

```sshconfig
    ControlMaster auto
    ControlPersist 10m
    ControlPath ~/.ssh/control-%C
```

The remote account needs write permission for
`workspace/atlos-assets/_WORK_DIR/Atlos/talos/` and the server needs `bash` and
`unzip`.

### Manual fallback

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

`publish:web` uploads point-page aliases like `<token>/index.html` by default so
root point URLs such as `https://opendfieldmap.cn/0Q2NtmS` resolve on the OSS
host. Set `SEO_UPLOAD_POINT_ALIASES=0` only for resource-only recovery uploads
where those aliases should be left untouched.

The `opendfieldmap.cn` nginx host must also route point-token URLs before its
generic 404/static fallback. If the host already serves
`/seo/points/oss/<token>.html`, the simplest rule is an internal rewrite:

```nginx
rewrite ^/([0-9A-Za-z]{7})/?$ /seo/points/oss/$1.html last;
rewrite ^/([0-9A-Za-z]{7})/index\.html$ /seo/points/oss/$1.html last;
```

Place these rules in the `server` block before the catch-all `location /` or
inside `location /` before `try_files`.

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
