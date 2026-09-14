# AIVA batch trigger

A [GitHub Action](https://docs.github.com/en/actions) written in TypeScript that
triggers a batch defined in [AIVA](https://app.aiva.works/) and waits until it
finishes. It uses the AIVA v2 REST API: `POST /v2/batches/{batchId}/trigger`
starts the execution and `GET /v2/batch-executions/{executionId}/ctrf` polls it.
API details are documented at
[Trigger a defined batch](https://app.aiva.works/docs/api/batches-trigger-batch-v-2).

## What it does

1. **Triggers a batch** — Starts an execution of the batch with the given ID,
   optionally overriding its variables.
1. **Keeps monitoring the batch** — Every ten seconds fetches batch status
   until there are no pending tests.
1. **Prints a test summary** — Adds a link to the batch in the AIVA UI.
   Fills in summary results and uploads it as a workflow artifact named
   `batch-status`.

The action expects Node 24 (see `action.yml` and `package.json`).

### ./dist in repository

You may be wondering why we push `dist` folder in repository, when it is usually
in gitignore. The reasons are
[GitHub runners](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action#commit-tag-and-push-your-action).

## Usage

Store your AIVA API key in a
[secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
(for example `AIVA_API_KEY`) and reference this action from your workflow.

```yaml
steps:
    - name: Start AIVA batch
      id: aiva
      uses: aiva-actions/run@v2
      with:
          apiKey: ${{ secrets.APIKEY }}
          batchId: ${{ inputs.BATCH_ID }}

    - name: Download Summary template
      id: template-download
      run: wget https://raw.githubusercontent.com/aiva-actions/run/refs/heads/main/summary-template.hbs
      if: always()

    - name: Generate CTRF summary
      id: summary
      uses: ctrf-io/github-test-reporter@v1.0.28
      with:
          report-path: './batch-ctrf.json'
          template-path: 'summary-template.hbs'
          custom-report: true
      if: always()
```

## Inputs

| Input                     | Required | Description                                                                                                                                                    |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                  | Yes      | AIVA API key, should be added via secrets.                                                                                                                     |
| `batchId`                 | Yes      | ID of the defined batch to trigger.                                                                                                                            |
| `globalVariableOverrides` | No       | JSON object applied to all tests in the batch (multiline). Empty input is treated as `{}`. Merged over the batch's own overrides (a variable named here wins). |
| `apiUrl`                  | No       | AIVA API base URL. Default: `https://api.aiva.works/`.                                                                                                         |
| `pollPeriodSeconds`       | No       | Seconds to wait between status polls. Must be between 5 and 1800. Default: `10`.                                                                               |
| `reportFilePath`          | No       | Path where the batch run report (CTRF or JUnit) is written. Default: `./batch-ctrf.json`.                                                                      |
| `artifactName`            | No       | Name of the uploaded workflow artifact. Override when multiple invocations run in the same workflow to avoid name conflicts. Default: `batch-status`.          |
| `verbose`                 | No       | Set to `true` to log additional debug output.                                                                                                                  |

## Outputs

| Output     | Description                                    |
| ---------- | ---------------------------------------------- |
| `batchId`  | ID of the started batch execution.             |
| `batchUrl` | URL to the batch in the AIVA.                  |
| `success`  | `true` if all tests passed, `false` otherwise. |

## Versioning

This action follows [semantic versioning](https://semver.org/). Releases are
tagged as `vMAJOR.MINOR.PATCH` (e.g. `v1.1.0`). A floating major tag
(e.g. `v1`) is kept in sync with the latest non-breaking release so you get
bugfixes and new inputs automatically without updating your workflow file.

| Pin style             | What you get                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `uses: ...run@v1`     | Latest `1.x.x` — recommended; automatic minor/patch updates.                                |
| `uses: ...run@v1.1.0` | Exact release — fully reproducible, opt-in updates.                                         |
| `uses: ...run@main`   | Always the newest release (might contain breaking changes if new major version is released) |

**Breaking changes** (removed inputs, changed behavior) bump the major version
to `v2`, `v3`, etc. Minor additions (new optional inputs, new outputs) and
bugfixes stay within the current major.

## Development

Prerequisites: Node.js 24+ and npm.

```bash
npm install
npm run bundle    # format + Rollup bundle to dist/
npm test
```

To exercise the action locally, copy [`.env.example`](./.env.example) to `.env`,
set `INPUT_*` variables and secrets, then:

```bash
npx @github/local-action . src/main.ts .env
```

This project bundles with Rollup; commit the built `dist/` output if your action
distribution relies on the prebuilt `dist/index.js` entrypoint defined in
`action.yml`.
