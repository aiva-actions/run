import * as core from '@actions/core'
import { writeFile } from 'node:fs/promises'
import { DefaultArtifactClient, ArtifactClient } from '@actions/artifact'
import { executeBatch, getBatchStatus } from './aiva-api.ts'
import { PathLike } from 'node:fs'
import { CTRFReport } from 'ctrf'

/** @param {string} labelsInput */
function parseLabels(labelsInput: string) {
  const labels: string[] = labelsInput
    .split(';')
    .map((s: string): string => s.trim())
    .filter((label: string) => label.length > 0)

  if (labels.length === 0) {
    throw new Error(
      'labels must contain at least one label after splitting by semicolon(e.g. "nightly")'
    )
  }
  return labels
}

function multilineInputToObject(multilineInput: string[]): Object {
  const joined = multilineInput.join('')
  return joined == '' ? {} : JSON.parse(joined)
}

/**
 * @param {number} s - Seconds to wait for
 */
function sleep(s: number) {
  return new Promise((resolve) => setTimeout(resolve, s * 1000))
}

/**
 * @param batchStatusResponse
 * @returns {Boolean} True if there are no more pending tests
 */
function testBatchStillRunning(batchStatusResponse: CTRFReport): boolean {
  core.debug(JSON.stringify(batchStatusResponse))
  const pending: number = batchStatusResponse?.results?.summary?.pending ?? 0
  return pending > 0
}

/**
 * Main function of the github action.
 */
export async function run() {
  const apiKey: string = core.getInput('apiKey', { required: true })
  const labelsInput: string = core.getInput('labels', { required: true })
  const maxNumberOfAgents: string = core.getInput('maxNumberOfAgents', {
    required: true
  })
  const testName: string = core.getInput('testName', { required: false })
  const globalVariableOverridesMultiline: string[] = core.getMultilineInput(
    'globalVariableOverrides',
    { required: false }
  )
  const variableOverridesPerTestMultiline: string[] = core.getMultilineInput(
    'variableOverridesPerTest',
    { required: false }
  )
  const gatewayName: string = core.getInput('gatewayName', { required: false })

  const artifact: ArtifactClient = new DefaultArtifactClient()

  const apiUrl: string = 'https://api.aiva.works/v1/batches'
  const aivaBatchUrl: string = 'https://app.aiva.works/scheduling/'
  const batchStatusFilepath: PathLike = './batch-ctrf.json'
  const labels: string[] = parseLabels(labelsInput)
  const batchWaitTimeout: number = 30

  core.setSecret(apiKey)
  const globalVariableOverrides: Object = multilineInputToObject(
    globalVariableOverridesMultiline
  )
  const variableOverridesPerTest: Object = multilineInputToObject(
    variableOverridesPerTestMultiline
  )

  const batchId: string = await executeBatch(
    apiUrl,
    apiKey,
    labels,
    maxNumberOfAgents,
    testName,
    globalVariableOverrides,
    variableOverridesPerTest,
    gatewayName
  )
  core.summary.addLink(
    'See the batch results in AIVA. ',
    aivaBatchUrl + batchId
  )

  let batchStatus: CTRFReport
  do {
    core.info('Waiting for test batch to finish.')
    await sleep(batchWaitTimeout)
    batchStatus = await getBatchStatus(apiUrl, apiKey, batchId)
    core.debug(JSON.stringify(batchStatus))
  } while (testBatchStillRunning(batchStatus))

  core.setOutput('batchId', batchId)
  await writeFile(batchStatusFilepath, JSON.stringify(batchStatus), 'utf-8')
  // The following if is present only to enable local testing via @github/local-action. When testing locally
  // ACTIONS_RUNTIME_TOKEN is not present and the action crashes
  if (process.env.ACTIONS_RUNTIME_TOKEN) {
    await artifact.uploadArtifact('batch-status', [batchStatusFilepath], '.')
  } else {
    core.warning(
      'Skipping artifact upload: ACTIONS_RUNTIME_TOKEN is unset (e.g. local-action). ' +
        `Batch CTRF was written to ${String(batchStatusFilepath)}.`
    )
  }

  await core.summary.write()
  if (batchStatus?.results?.summary?.failed > 0) {
    core.setFailed('AIVA test batch has failed tests.')
  }
}
