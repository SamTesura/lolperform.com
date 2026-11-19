# .quality-gates/tools

Pinned third-party tools for this repo's quality gates. Installed by `.quality-gates-kit`.

CI installs them with `npm ci --prefix .quality-gates/tools --ignore-scripts`. That checks
the lockfile's sha512, and `npm audit signatures` then verifies npm's signature and the SLSA
provenance. `node_modules/` here is gitignored.

Don't bump versions here. The kit owns the pin (`.quality-gates-kit/tools/README.md`), and
`legacy-web.mjs` refuses any scanner whose code does not match the vetted hashes.
