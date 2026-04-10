# AIVA batch test run

A [GitHub Action](https://docs.github.com/en/actions) written in TypeScript that
starts an automated test batch in [AIVA](https://app.aiva.works/) and waits
until it finishes. It uses the AIVA REST API (`POST /v1/batches` and batch
status polling). API details are documented at
[Run batch](https://app.aiva.works/docs/api/batches-run-batch).

## What it does

1. **Starts a batch** — Sends your labels, agent limit, optional test name,
   variable overrides, and optional gateway name to
   `https://api.aiva.works/v1/batches`.
1. **Polls until done** — Every 30 seconds it fetches batch status until the
   CTRF summary reports no pending tests.
1. **Surfaces results** — Adds a link to the batch in the AIVA UI to the job
   summary, appends the final status payload, writes `batch-ctrf.json` to the
   workspace, and uploads it as a workflow artifact named `batch-status`
   (artifact upload is skipped when `ACTIONS_RUNTIME_TOKEN` is unset, e.g. when
   using [`@github/local-action`](https://github.com/github/local-action)
   locally).

The action expects Node 24 (see `action.yml` and `package.json`).

### ./dist in repo
You may be wondering why we push `dist` folder in repo, when it is usually in gitignore.
The reason are [Github runners](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action#commit-tag-and-push-your-action). 

## Usage

Store your AIVA API key in a
[secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
(for example `AIVA_API_KEY`) and reference this action from your workflow.

```yaml
steps:
  - name: Run AIVA batch
    uses: aiva-actions/run@v1
    with:
      apiKey: ${{ secrets.AIVA_API_KEY }}
      labels: 'smoke;regression'
      maxNumberOfAgents: '3'
      testName: 'CI nightly'
      # Optional — multiline JSON objects:
      # globalVariableOverrides: |
      #   {"KEY": "value"}
      # variableOverridesPerTest: |
      #   {"test-id": {"KEY": "value"}}
      # gatewayName: my-gateway
      # apiUrl: https://api.aiva.works/v1/batches
      # aivaBatchUrl: https://app.aiva.works/scheduling/
      # statusCheckWaitTime: '30'
      # CTRFReportFilepath: ./batch-ctrf.json

  - name: Print CTRF Summary
    id: summary
    uses: ctrf-io/github-test-reporter@v1
    with:
      report-path: '${{ input.CTRFReportFilepath }}'
      template-path: 'summary-template.hbf'
    if: always()
```

Replace `uses: ./` with your published action reference (for example
`owner/repo@v1`) when consuming it from another repository.

## Inputs

| Input                      | Required | Description                                                                                                                                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                   | Yes      | AIVA API key.                                                                                                                               |
| `labels`                   | Yes      | Semicolon-separated labels that select which tests run (e.g. `smoke;regression`). At least one non-empty label is required after splitting. |
| `maxNumberOfAgents`        | Yes      | Maximum number of agents the batch may use.                                                                                                 |
| `testName`                 | No       | Custom batch name (default: empty).                                                                                                         |
| `globalVariableOverrides`  | No       | JSON object applied to all tests in the batch (multiline). Empty input is treated as `{}`.                                                  |
| `variableOverridesPerTest` | No       | JSON object mapping test IDs to variable overrides (multiline). Empty input is treated as `{}`.                                              |
| `gatewayName`              | No       | Gateway name used by aiva-node during the test (default: empty).                                                                            |
| `apiUrl`                   | No       | Batch API URL: POST to start the batch, GET `{url}/{batchId}` for status polling. Default: `https://api.aiva.works/v1/batches`.               |
| `aivaBatchUrl`             | No       | URL for getting batch status. Default: `https://app.aiva.works/scheduling/`.                                                                 |
| `statusCheckWaitTime`      | No       | Seconds to wait between status polls. Must be between 5 and 1800. Default: `30`.                                                            |
| `CTRFReportFilepath`       | No       | Path where the final CTRF JSON is written and uploaded as the `batch-status` artifact. Default: `./batch-ctrf.json`.                          |

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
