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
function isTestBatchRunning(batchStatusResponse: CTRFReport): boolean {
  core.debug(JSON.stringify(batchStatusResponse))
  const pending: number = batchStatusResponse?.results?.summary?.pending ?? 0
  return pending > 0
}

function isValueInRange(
  value: number,
  minValue: number,
  maxValue: number
): boolean {
  return value >= minValue && value <= maxValue
}

/**
 * Main function of the github action.
 */
export async function run() {
  const minStatusWaitTime = 5
  const maxStatusWaitTime = 1800
  const artifact: ArtifactClient = new DefaultArtifactClient()

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
  const apiUrl: string = core.getInput('apiUrl', { required: false })
  const aivaBatchUrl: string = core.getInput('aivaBatchUrl', {
    required: false
  })
  const batchWaitTimeout: string = core.getInput('statusCheckWaitTime', {
    required: false
  })
  const batchStatusFilepath: PathLike = core.getInput('CTRFReportFilepath')
  if (
    !isValueInRange(
      parseInt(batchWaitTimeout),
      minStatusWaitTime,
      maxStatusWaitTime
    )
  ) {
    core.setFailed(
      'Wait time is not within sane bounds of ${minWaitTime} and ${maxWaitTime} seconds.'
    )
  }

  const labels: string[] = parseLabels(labelsInput)

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

  let batchStatus: CTRFReport
  do {
    core.info('Waiting for test batch to finish.')
    await sleep(parseInt(batchWaitTimeout))
    batchStatus = await getBatchStatus(apiUrl, apiKey, batchId)
    core.debug(JSON.stringify(batchStatus))
  } while (isTestBatchRunning(batchStatus))

  core.setOutput('batchId', batchId)
  await writeFile(batchStatusFilepath, JSON.stringify(batchStatus), 'utf-8')
  // Local-action testing crashes when trying to upload artifact, so we want to skip it
  if (process.env.SKIP_ARTIFACT_UPLOAD) {
    core.warning(
      'Skipping artifact upload: ACTIONS_RUNTIME_TOKEN is unset (e.g. local-action). ' +
        `Batch CTRF was written to ${String(batchStatusFilepath)}.`
    )
  } else {
    await artifact.uploadArtifact('batch-status', [batchStatusFilepath], '.')
  }

  if (batchStatus?.results?.summary?.failed > 0) {
    core.setFailed('AIVA test batch has failed tests.')
  }
}
