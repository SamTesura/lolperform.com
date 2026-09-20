# Specs

Feature work in this repo is spec-driven. One directory per change:

```
specs/NNN-slug/
├── spec.md           # what + why. Status: Draft -> Approved -> In progress -> Done
├── plan.md           # how: approach, alternatives, requirement->sensor coverage, risks
├── tasks.md          # ordered ~30-min tasks, each with a verify command
├── notes.md          # decision log
└── verification.md   # acceptance-criteria -> evidence table
```

Rules that matter here:

- `spec.md` carries no implementation detail. Requirements get IDs (R1...) and testable acceptance criteria.
- **Only Sam approves.** Never implement a spec still marked Draft.
- Tick a task only after its verify command passed (`pnpm test` / `pnpm run gates` for this repo).
- Free-plan budgets (D1 rows written/day) are a constraint in every plan that touches the pipeline.
- If implementation shows the spec is wrong, stop, fix the spec, and log why in `notes.md`.

Commands: `/sdd-spec`, `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-verify`.
Numbers are zero-padded and never reused.
