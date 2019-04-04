# Next

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.6...develop

Changes:
* TODO

# 1.0.6

> Build environment: NodeJS `8.15.1`, NPM `6.4.1`

Changes:
* NPM updates (including transition to v1 of Google's own MaterialDesign UI lib, components for the web)
* Many small UI improvements and fixes

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.6/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.6/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.6

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.5...v1.0.6

# 1.0.5

> Build environment: NodeJS `8.14.1`, NPM `6.4.1`

Changes:
* NPM updates
* Switched to more up-to-date variant of material-design-icons
* Now checks ReadiumWebPubManifest type using HTTP HEAD request and content-type header
* Enable direct support for remote publications, including LCP (in which case proxy through streamer to handle decryption)
* Added basic test UI for TTS read aloud
* Added switch for popup footnotes (user preference)
* Mouse wheel can be used on left/right navigation arrows to turn pages
* Fixed URL concatenation issue (links with relative hrefs, TOC, etc.)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.5/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.5/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.5

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.4...v1.0.5

# 1.0.4

> Build environment: NodeJS `8.14.1`, NPM `6.4.1`

Changes:
* Updated documentation (minor)
* NPM 6.5.* has regression bugs for global package installs, so revert back to NPM 6.4.1 (which is officially shipped with the NodeJS installer).

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.4/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.4/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.4

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.3...v1.0.4

# 1.0.3

> Build environment: NodeJS `8.14.0`, NPM `6.5.0`

Changes:
* NPM updates
* Fixed LCP/LSD device ID manager store
* Minor API adaptations to match latest `r2-xxx-js` packages

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.3/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.3/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.3

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.2...v1.0.3

# 1.0.2

> Build environment: NodeJS `8.14.0`, NPM `6.5.0`

Changes:
* NPM updates (`r2-xxx-js`)
* Support for remote HTTP manifest.json publications
* Includes a fix for nasty base64 encoding edge case with slash characters in URLs

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.2/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.2/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.2

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.1...v1.0.2

# 1.0.1

> Build environment: NodeJS `8.14.0`, NPM `6.5.0`

Changes:
* NPM updates (`r2-xxx-js` packages)
* Replaced deprecated RawGit URLs
* Removed unnecessary TypeScript import aliases
* Improved ReadiumCSS integration (updated API with defaults and all params, and streamer-based injection)
* Experimental support for direct loading of remote/local ReadiumWebPubManifest JSON, with LCP support (will migrate to core fetcher/zip when further tested)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.1/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.1/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.1

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0...v1.0.1

# 1.0.0

> Build environment: NodeJS `8.14.0`, NPM `6.5.0`

Changes:
* Fixed broken font menu
* Removed loader / hide-panel so we can test/observe the ReadiumCSS layout pass (currently not injected at streamer level)
* Alignment with underlying packages, notably ReadiumCSS and Locator APIs
* NPM updates (minor)
* ReadiumCSS updated to latest (minor)
* Git revision JSON info now includes NodeJS and NPM version (build environment)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.7...v1.0.0

# 1.0.0-alpha.7

> Build environment: NodeJS `8.12.0`, NPM `6.4.1`

Changes:
* NPM updates (minor)
* Git revision JSON info now includes NodeJS and NPM version (build environment)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.7/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.7/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.7

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.6...v1.0.0-alpha.7

# 1.0.0-alpha.6

Changes:
* Dependency "ta-json" GitHub semver dependency becomes "ta-json-x" NPM package (fixes https://github.com/readium/r2-testapp-js/issues/10 )
* Removed TypeScript linter warning message (checks for no unused variables)
* NPM updates related to the Node TypeScript typings

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.6/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.6/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.6

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.5...v1.0.0-alpha.6

# 1.0.0-alpha.5

Changes:
* NPM update r2-navigator-js (fixes console redirect)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.5/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.5/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.5

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.4...v1.0.0-alpha.5

# 1.0.0-alpha.4

Changes:
* NPM updates (external dependencies)

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.4/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.4/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.4

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.3...v1.0.0-alpha.4

# 1.0.0-alpha.3

Changes:
* correct version in `package-lock.json`

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.3/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.3/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.3

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.2...v1.0.0-alpha.3

# 1.0.0-alpha.2

Changes (NPM updates):
* `@types/node`
* `@types/uuid`
* `r2-xxx-js`

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.2/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.2/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.2

Git diff:
* https://github.com/readium/r2-testapp-js/compare/v1.0.0-alpha.1...v1.0.0-alpha.2

# 1.0.0-alpha.1

Changes:
* initial NPM publish

Git revision info:
* https://unpkg.com/r2-testapp-js@1.0.0-alpha.1/dist/gitrev.json
* https://github.com/edrlab/r2-testapp-js-dist/blob/v1.0.0-alpha.1/dist/gitrev.json

Git commit history:
* https://github.com/readium/r2-testapp-js/commits/v1.0.0-alpha.1

Git diff:
* initial NPM publish
