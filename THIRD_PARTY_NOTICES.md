# Third-Party Notices

Kurari is distributed under the MIT License. It depends on third-party open
source software distributed under their own licenses.

Dependency license metadata is recorded in:

- `frontend/package-lock.json`
- `agent/package-lock.json`
- `backend/build.gradle.kts`

The frontend dependency tree currently includes packages under permissive
licenses such as MIT, Apache-2.0, BSD-3-Clause, ISC, 0BSD, CC0-1.0, and
Python-2.0, plus MPL-2.0 packages.

Notable MPL-2.0 packages include:

- `@blocknote/core`
- `@blocknote/mantine`
- `@blocknote/react`
- `lightningcss` and platform-specific `lightningcss-*` packages

MPL-2.0 covered source code is available from the corresponding upstream npm
packages and repositories referenced by the package metadata. Kurari does not
modify those MPL-covered package source files.

Some runtime and development tools may include their own `LICENSE`, `NOTICE`,
or third-party notice files inside installed package directories. When
redistributing a bundled build or binary distribution, preserve applicable
third-party notices from the redistributed artifacts.
