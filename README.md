# AIVA batch test run

A [GitHub Action](https://docs.github.com/en/actions) written in TypeScript that
starts an automated test batch in [AIVA](https://app.aiva.works/) and waits
until it finishes. It uses the AIVA REST API (`POST /v1/batches` and batch
status polling). API details are documented at
[Run batch](https://app.aiva.works/docs/api/batches-run-batch).

## What it does

1. **Starts a batch** — Sends a request to the AIVA API with your chosen labels,
   agent limit, and optional settings (test name, variable overrides, gateway
   name, timeouts) to start a new test batch.
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
      uses: aiva-actions/run@v1
      with:
          apiKey: ${{ secrets.APIKEY }}
          labels: ${{ inputs.LABELS}}
          maxNumberOfAgents: ${{ inputs.MAX_NUMBER_OF_AGENTS }}

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

| Input                      | Required | Description                                                                                                                                 |
|----------------------------|----------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `apiKey`                   | Yes      | AIVA API key, should be added via secrets.                                                                                                  |
| `labels`                   | Yes      | Semicolon-separated labels that select which tests run (e.g. `smoke;regression`). At least one non-empty label is required after splitting. |
| `maxNumberOfAgents`        | Yes      | Maximum number of agents the batch may use.                                                                                                 |
| `testName`                 | No       | Custom batch name.                                                                                                                          |
| `globalVariableOverrides`  | No       | JSON object applied to all tests in the batch (multiline). Empty input is treated as `{}`.                                                  |
| `variableOverridesPerTest` | No       | JSON object mapping test IDs to variable overrides (multiline). Empty input is treated as `{}`.                                             |
| `gatewayName`              | No       | Gateway name used by aiva-node during the test (default: empty).                                                                            |
| `apiUrl`                   | No       | Batch API URL: POST to start the batch, GET `{url}/{batchId}` for status polling. Default: `https://api.aiva.works/`.                       |
| `pollPeriodSeconds`        | No       | Seconds to wait between status polls. Must be between 5 and 1800. Default: `10`.                                                            |
| `reportFilePath`           | No       | Path where the batch run report (CTRF or JUnit) is written and uploaded as the `batch-status` artifact. Default: `./batch-ctrf.json`.       |
| `verbose`                  | No       | Set to true when additional logs should be logged                                                                                           |

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
