<!-- Thanks for contributing to Workpulse! Please fill out this template. -->

## Summary

<!-- What does this PR change and why? Focus on the "why". -->

## Type of change

- [ ] Feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Refactor (no behavior change)
- [ ] Docs / chore / build

## Scope

- [ ] Backend (`apps/api`)
- [ ] Frontend (`apps/web`)
- [ ] Shared types / config
- [ ] Infra (Docker / CI / scripts)
- [ ] Database schema (Prisma migration attached)

## Checklist

Please confirm before requesting review:

- [ ] Follows repo standards in `.cursor/rules/*.mdc`.
- [ ] DTO + Zod schema updated where API surface changed.
- [ ] New/changed domain logic covered by unit tests (Jest).
- [ ] Prisma schema changes accompanied by a migration and updated seed if needed.
- [ ] Server-side authorization checked for new endpoints (RBAC + tenant isolation).
- [ ] No secrets, tokens, or PII committed. No `console.log` left behind.
- [ ] Documentation updated (`README.md`, `docs/ARCHITECTURE.md`, `docs/WORKFLOW.md`, or new ADR under `docs/ADR/`) if user-visible or architecturally significant.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally.

## Screenshots / recordings

<!-- If the change is user-visible, attach before/after screenshots or a short clip. -->

## Testing / verification steps

<!-- How can a reviewer verify this manually? -->

1.
2.

## Related issues / ADRs

<!-- Link to Linear / GitHub issues, ADR files, or design docs. -->
