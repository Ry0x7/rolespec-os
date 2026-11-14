# Gates: Recruitt parity documentation

OWNS: docs/FEATURE_PARITY.md, docs/ARCHITECTURE.md, docs/IMPLEMENTATION_PLAN.md, docs/API_CONTRACTS.md, docs/WORKFLOW_STATES.md, docs/RESEARCH.md, scripts/verify-parity-docs.mjs, GATES.md, src/features/workflows, src/app/api/workflows, src/app/api/review-tasks, src/instrumentation.ts, src/features/resume/tailoring, src/features/resume/actions/history.ts, src/features/resume/actions/rollback.ts, src/features/resume/actions/save.ts, src/features/resume/actions/tailor.ts, src/features/export/services/single-page.ts, src/features/export/actions/export-pdf.ts, prisma/migrations/20261111170000_add_workflow_runs, prisma/migrations/20261111190000_add_resume_tailoring_provenance

Scope: a code-grounded parity matrix, target architecture, ordered implementation plan, API contracts, workflow state machines, sourced research decisions, the delivered unified-intake implementation, and the delivered durable agent-assisted workflow engine for reproducing Recruitt's workflow inside RoleSpec OS.

- [x] G1: all six documents exist with their required sections and each phase heading is present
  CHECK: node scripts/verify-parity-docs.mjs G1
  EXPECT: PARITY-DOCS-G1-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=7819400ba265d891c0f824a38a0148f70b0a392e6b7325b95fac8aa0b009a35a; exit=0; EXPECT=matched; output-sha256=7bef6aece8728729304129ecf12af424162626c0fe5632a06b8f46d0d69d1461; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G2: the matrix covers F01-F59 with an allowed status, evidence and a gap, and overstates nothing critical
  CHECK: node scripts/verify-parity-docs.mjs G2
  EXPECT: PARITY-DOCS-G2-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=40378bafaf28092dbffbf537544c4efa11db0e776a733540ca613dfc4e518799; exit=0; EXPECT=matched; output-sha256=cc31bd851859141ebfb16a631b1a10e74a4e51da625b3ded6b238f060304ef22; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G3: every repository path cited as parity evidence exists
  CHECK: node scripts/verify-parity-docs.mjs G3
  EXPECT: PARITY-DOCS-G3-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=b6cd9305005281d720f8e2f22bf9cbe9b0ad738882d422305609b7f16133eba3; exit=0; EXPECT=matched; output-sha256=af318baab289fa1161c706a39bf219635a609ad544321dc5cd7946a50d24a6f6; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G4: the architecture states the full pipeline, the new entities, and the Postgres-only execution decision
  CHECK: node scripts/verify-parity-docs.mjs G4
  EXPECT: PARITY-DOCS-G4-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=715085afe1d0a91f6023fb0b5cbe824bc9740de1055eb6bb5be713ef3a18834a; exit=0; EXPECT=matched; output-sha256=d7b958db94dfdc64e9edfeccb257d4dda3379090b7204db7e72ae3ac74b42555; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G5: every existing API route is documented, along with the new workflow, review, answer, submission, intake and ranking routes
  CHECK: node scripts/verify-parity-docs.mjs G5
  EXPECT: PARITY-DOCS-G5-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=dd2bb0ed659431d962bc7559c1636c5cd67f1760edf02f5887d4a48dede038df; exit=0; EXPECT=matched; output-sha256=2c73ee332fc3ddde90211e604d320ff5c0e4f287362cad3c6cee21adc33f6174; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G6: every required workflow state and transition is defined, including the no-write-on-transition rule
  CHECK: node scripts/verify-parity-docs.mjs G6
  EXPECT: PARITY-DOCS-G6-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=e0f305d1f5e4fb794ff0ce17136b29222201d94b0cb9cb0038a369f13e0b0fe2; exit=0; EXPECT=matched; output-sha256=0cd402953e3d498b0315a058ac36e5668ac09fd7e1abe06ec9789c94b6cb74ca; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G7: research cites at least 18 sources and records the versioned decisions relied on
  CHECK: node scripts/verify-parity-docs.mjs G7
  EXPECT: PARITY-DOCS-G7-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a187887628a4d2b20c1b29f0f397765a4a82d5559d8188269d57fa20b4888e20; exit=0; EXPECT=matched; output-sha256=7042fa705b554f16e62a17902edf69f3e09eb340b9a44dd090ff14db3dfcc009; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G8: phases are dependency-ordered, each names files, tests and exit criteria, and every gap has a phase
  CHECK: node scripts/verify-parity-docs.mjs G8
  EXPECT: PARITY-DOCS-G8-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=2b44859b96a8502be4e9a817980f059d98722148e49131548c2384fede73cbec; exit=0; EXPECT=matched; output-sha256=90d1ddc0d2de6534ea6d41e02379d9023837c62611b9be2b69e5f30e050fa2fe; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G9: no document embeds local user paths, credentials or connection strings
  CHECK: node scripts/verify-parity-docs.mjs G9
  EXPECT: PARITY-DOCS-G9-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a372e27d7a7cabf2b645dadfb6d9fff8e31ab9d47714b6681bce48fc430208d3; exit=0; EXPECT=matched; output-sha256=c623b43cb6b438d9660a8bd47b1f59d6e0e2b4ccd4fae0ff331ef851f2a24fea; output-bytes=20; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G10: every relative Markdown link in the document set and the README resolves
  CHECK: node scripts/verify-parity-docs.mjs G10
  EXPECT: PARITY-DOCS-G10-PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=4e7252c5eb64f4d9b0735d19e91a89c5727c23c161084552319bef0e45f34fdc; exit=0; EXPECT=matched; output-sha256=b88bc5d5cbf23c1cc2b5a2385a936e841a14e898d3b018ad23a990f02416b2b0; output-bytes=21; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G11: the whole repository typechecks with the intake schema, services, routes and UI
  CHECK: npx tsc --noEmit && echo TSC-OK
  EXPECT: TSC-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c2fdf25dec8c07c41a1b10a613143920ef26ecfd964f9e25edc1a7726b9b1a79; exit=0; EXPECT=matched; output-sha256=0ec84abad7ef5dbe3ac7057df9ebb54f230169cd081fa3e538a1c52f92cec424; output-bytes=8; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G12: every intake service, adapter, route and panel test passes
  CHECK: npx vitest run src/features/intake src/app/api/intake && echo INTAKE-TESTS-OK
  EXPECT: INTAKE-TESTS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d2c647c8c79210a18ee5bcfa441a85831a96f459839038e98a3e49a39ab83831; exit=0; EXPECT=matched; output-sha256=6323c47ee6b64fff028472afd2e699351a88e231c19dcd1317af40f55741be4b; output-bytes=5235; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G13: the intake subsystem and its page integration pass ESLint
  CHECK: npx eslint src/features/intake src/app/api/intake "src/app/(app)/career-profile/page.tsx" scripts/verify-parity-docs.mjs && echo INTAKE-LINT-OK
  EXPECT: INTAKE-LINT-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=6c5aca1abb8c20c5378d081c63a93e3dedd230e98c4de9d8de5a67cf093af231; exit=0; EXPECT=matched; output-sha256=eeba7124838f682d49c7a6062d0fd92505022862e0aa6d71700922f81cb1d94f; output-bytes=16; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G14: the Prisma schema and migration are valid and the client regenerates
  CHECK: npx prisma validate && npx prisma generate && echo PRISMA-OK
  EXPECT: PRISMA-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=edc32556cfc51b438bac5777cc17306e087e90e9c80e37786a084f68c76c7440; exit=0; EXPECT=matched; output-sha256=9fc4e6a588a77182388b46c133c75b8dd1bdfc1de525fa312d79153a926d815d; output-bytes=884; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G15: the workflow schema and additive migration are valid and the client regenerates
  CHECK: npx prisma validate && npx prisma generate && echo WORKFLOW-PRISMA-OK
  EXPECT: WORKFLOW-PRISMA-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c7db03c842f287b54752d75d2f8db269bd5f82d4e701187ed8eb34930756b984; exit=0; EXPECT=matched; output-sha256=5298a1899c539dec1f9693a80a19db4d91542dfa85d1ce36cb26fe00d86e9a5a; output-bytes=893; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G16: the workflow engine, executors, routes and docs typecheck with the rest of the repository
  CHECK: npx tsc --noEmit && echo WORKFLOW-TSC-OK
  EXPECT: WORKFLOW-TSC-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=cb278e12fa6a58335f8be94cb97ccf789d3f3787908764848dc4513bb6ee20de; exit=0; EXPECT=matched; output-sha256=c1fab8eca730bde1b18cf5cc3ce26ee6648e3d6a19982d7787ad591af5a4af3e; output-bytes=17; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G17: every workflow engine, recovery, executor and route test passes
  CHECK: npx vitest run src/features/workflows src/app/api/workflows && echo WORKFLOW-TESTS-OK
  EXPECT: WORKFLOW-TESTS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=bb159ab1051cda796f017a3b194a60876bf0948b15f0ab391fab7f5ffeadc855; exit=0; EXPECT=matched; output-sha256=80f6362621be2d8c487008afaa4549e37ab98abe25ba98d043a70fa356bddba4; output-bytes=1475; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G18: the workflow docs and parity matrix match the shipped files and routes
  CHECK: node scripts/verify-parity-docs.mjs G11 && echo WORKFLOW-DOCS-OK
  EXPECT: WORKFLOW-DOCS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=fb7ccc18077fc9a181af146170019561c7bb024f10731f55696b58790e8f78c6; exit=0; EXPECT=matched; output-sha256=1fd34b476259a65a96ca0679df0f32dbfe63d66910a1c73a81aa62a3382274ec; output-bytes=39; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G19: the workflow backend and its verifier pass ESLint with no errors
  CHECK: npx eslint src/features/workflows src/app/api/workflows src/app/api/review-tasks src/instrumentation.ts scripts/verify-parity-docs.mjs && echo WORKFLOW-LINT-OK
  EXPECT: WORKFLOW-LINT-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ee26204e7c19befe0e284eeb6526633ff760557e975d70483fcd25f0a4a67425; exit=0; EXPECT=matched; output-sha256=ca57df42360d1e92a0b0a48d438f1012edabbc42bf9fc673140299e210113789; output-bytes=18; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G20: the whole repository test suite still passes with the workflow engine present
  CHECK: npx vitest run && echo FULL-TESTS-OK
  EXPECT: FULL-TESTS-OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=547e1358bf81ee5d960ed171f07f8953cae1841efa29da3c917a3dea76b7f303; exit=0; EXPECT=matched; output-sha256=1849a47ac2e89630c8b5fcc229d2cac4a3e00db999f76e1a180fc18ecfd54100; output-bytes=140343; shell=C:\Windows\system32\cmd.exe; cwd=E:\Github\rolespec-os; path=af8b626af674/42 entries

- [x] G21: the tailoring provenance schema and additive migration are valid and the client regenerates
  CHECK: npx prisma validate && npx prisma generate && echo TAILORING-PRISMA-OK
  EXPECT: TAILORING-PRISMA-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G22: evidence mapping, fail-closed validation, snapshots and bounded repair tests pass
  CHECK: npx vitest run src/features/resume/tailoring && echo TAILORING-TESTS-OK
  EXPECT: TAILORING-TESTS-OK
  EVIDENCE: 34 tests passed in 4 files; exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G23: manual tailoring, version-specific rollback, concurrent-edit refusal and edit history tests pass
  CHECK: npx vitest run src/features/resume/actions/__tests__/tailor.test.ts src/features/resume/actions/__tests__/rollback.test.ts src/features/resume/actions/__tests__/save.test.ts && echo TAILORING-ACTIONS-OK
  EXPECT: TAILORING-ACTIONS-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G24: workflow tailor and stored-draft revalidation tests pass
  CHECK: npx vitest run src/features/workflows/executors/__tests__/tailor-validate.executor.test.ts src/features/workflows/__tests__/workflow-engine.test.ts && echo TAILORING-WORKFLOW-OK
  EXPECT: TAILORING-WORKFLOW-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G25: single-page export measures real PDFs and never truncates content
  CHECK: npx vitest run src/features/export/actions/__tests__/export-pdf.test.ts src/features/export/services/__tests__/single-page.test.ts && echo SINGLE-PAGE-OK
  EXPECT: SINGLE-PAGE-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G26: the whole repository typechecks, passes its tests and lints the tailoring surface
  CHECK: npx tsc --noEmit && npx vitest run && npx eslint src/features/resume/tailoring src/features/export src/features/workflows/executors --max-warnings=0 && echo TAILORING-RELEASE-OK
  EXPECT: TAILORING-RELEASE-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root

- [x] G27: parity documents still pass every verifier gate after the tailoring update
  CHECK: for g in G1 G2 G3 G4 G5 G6 G7 G8 G9 G10 G11; do node scripts/verify-parity-docs.mjs "$g" || exit 1; done && echo TAILORING-DOCS-OK
  EXPECT: TAILORING-DOCS-OK
  EVIDENCE: exit=0; EXPECT=matched; shell=bash; cwd=repo-root
