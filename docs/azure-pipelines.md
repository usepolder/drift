# Polder Drift on Azure DevOps

Polder Drift posts the same design-system drift comment on Azure DevOps pull requests
that it posts on GitHub. There is no extension to install: you run the CLI as a pipeline
step with `polder-drift ci`. It runs entirely in your pipeline, no third-party cloud.

## Pipeline

```yaml
# azure-pipelines.yml
trigger: none
pr:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self
    fetchDepth: 0          # REQUIRED: the base branch must be present for diffing

  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci
    displayName: Install deps   # so DS package exports resolve from node_modules

  - script: npx @usepolder/drift ci
    displayName: Polder Drift
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)   # REQUIRED: expose the OAuth token
```

## Two gotchas (the usual reasons it fails to post)

1. **`SYSTEM_ACCESSTOKEN` is not exposed to scripts by default.** Either pass it through
   `env:` as shown above, or enable "Allow scripts to access the OAuth token" on the job.
   The build service identity (`<Project> Build Service`) also needs **Contribute to pull
   requests** permission on the repo, otherwise the comment POST returns 403.
2. **Shallow checkout hides the base branch.** Set `fetchDepth: 0` so Polder Drift can
   diff against the PR target and compute "new in this PR" + adoption delta. Without it,
   it degrades to treating all drift as new.

## Gating the PR

`polder-drift ci` exits non-zero when `fail_on_drift: true` is set in `.polder.yml` and
the PR introduces new drift. Add the pipeline as a **required** build-validation policy on
the target branch to block merges on new drift; leave it optional to comment without
blocking.

## What it reads

- `.polder.yml` at the repo root (same config as the GitHub Action and CLI).
- `SYSTEM_PULLREQUEST_*`, `SYSTEM_COLLECTIONURI`, `SYSTEM_TEAMPROJECT`,
  `BUILD_REPOSITORY_ID`, `BUILD_SOURCESDIRECTORY` (set automatically in PR builds).
