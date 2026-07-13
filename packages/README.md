# Ledmapper workspaces

The repository publishes one npm artifact: `@fastled/gfx`. Its `core`, `fled`, and `worker` paths are subpath exports from that same package and are not separate npm packages.

Any other workspace under this directory is an internal Ledmapper implementation detail and must set `"private": true`. Internal packages can be built and consumed through the workspace during development, but they must not appear in release workflows, package publication, or the public `@fastled/gfx` dependency graph. Promoting an internal package requires a new packaging-policy issue and an explicit release workflow change.
