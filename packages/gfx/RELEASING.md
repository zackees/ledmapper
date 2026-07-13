# Releasing `@fastled/gfx`

Package releases are independent of ledmapper application releases. Update the package version, API report, `API.md`, and changelog notes, then push a tag named `gfx-v<package-version>` (for example, `gfx-v0.2.0` or `gfx-v0.2.0-beta.1`).

The `Publish @fastled/gfx` workflow is the only supported publication path. It runs the package build, API compatibility check, packed-consumer contract, declaration checks, tarball-content/size checks, and then publishes with npm trusted publishing (OIDC) and provenance. The `npm-gfx` GitHub environment should require the package maintainers' approval.

Prereleases use the same tag format and package semver prerelease identifier. Stable releases omit the identifier. To recover from a bad release, deprecate the exact version with `npm deprecate @fastled/gfx@<version> "reason"`; never retag an existing version.
