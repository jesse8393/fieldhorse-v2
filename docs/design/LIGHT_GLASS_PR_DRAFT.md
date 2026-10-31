> Historical iteration. The current implementation and review evidence are in [Workspace 06](WORKSPACE_06_IMPLEMENTATION.md).

# Replace the dark workspace shell with the approved light glass design

The old sidebar and dark job banner competed with the work itself, while phone job navigation repeated the current section and required horizontal scrolling. This change introduces a warm light header, clearer job identity, real-photo and no-photo layouts, a live next-visit summary, and a compact section picker that retains all 18 existing job destinations.

Today, Schedule, and Money use the same visual system. Workspace permissions, company switching, capture, keyboard shortcuts, job actions, and financial calculations remain connected to their existing behavior. Regression checks now exercise the header and workspace navigation instead of the removed sidebar. The browser theme-color and CSP hash are updated together.

Validation: TypeScript, ESLint, design audit, production build, and 1,443 unit tests pass. The 1,510 browser test cases parse; manual browser review covered all job sections, job-attached Capture, menu keyboard behavior, and desktop/phone layouts.

Before merge: run the full browser CI job and review visual baseline updates. The Chromium binary is unavailable in the local environment, so the automated browser suite has not been executed there. This PR changes shared visual tokens; review secondary routes and both existing theme modes before release.
