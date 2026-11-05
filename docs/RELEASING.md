# Release checks

Pyx is a local, synthetic-fixture access checker. A release is not a security certification, and the website's configured paths are not automatic discovery of every application endpoint.

## Verify the exact release commit

Use the Node version in `.node-version` and the pnpm version in `package.json`:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm package
pnpm site
pnpm integration
```

The integration command requires Docker. It must demonstrate healthy isolation, deliberately broken policies/routes, and blocked setup failures. Unit tests alone do not establish database behavior. On Windows without Developer Mode, the file-symlink test reports a skip; Linux CI must pass it.

Commit generated site changes from `pnpm site`. The release workflow calls the complete CI workflow before publishing, including the real-stack integration and baseline assessment jobs. A missing approved baseline is explicitly reported as not assessed, not as evidence of isolation.

## Publish

1. Review and merge the implementation and fixes into the intended release branch. The repository's default branch should contain the implementation before sending users to its README.
2. Confirm the package name/version, license attribution, and supported scope. Keep `packages/cli` and `packages/runner` versions aligned.
3. Configure npm trusted publishing for this repository's `release.yml`, or the protected `npm` environment's `NPM_TOKEN`. Configure release-tag protections and environment approvals as needed.
4. Push a version tag matching `packages/cli/package.json` only after the checks above pass. Publishing an npm version is a separate release action; running checks does not publish it.
5. Verify a fresh registry install, `pyx --version`, rule initialization, and validation before advertising the install command as available.

For a prepublication local install, run `pnpm package` followed by `npm install -g ./packages/cli`.

## Website

Follow [DEPLOY.md](DEPLOY.md). A successful static build is not proof of deployment. Verify the deployed URL, verifier samples, contact links, and response headers after deployment. Do not claim a custom domain or a live checkout until it exists.
