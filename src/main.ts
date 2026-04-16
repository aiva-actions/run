import * as core from '@actions/core';
import { writeFile } from 'node:fs/promises';
import { DefaultArtifactClient, ArtifactClient } from '@actions/artifact';
import { executeBatch, getBatchStatus } from './aiva-api.ts';
import { PathLike } from 'node:fs';
import { CTRFReport, Summary, Test } from 'ctrf';

/** @param {string} labelsInput */
function parseLabels(labelsInput: string) {
    const labels: string[] = labelsInput
        .split(';')
        .map((s: string): string => s.trim())
        .filter((label: string) => label.length > 0);

    if (labels.length === 0) {
        throw new Error('labels must contain at least one label after splitting by semicolon(e.g. "nightly")');
    }
    return labels;
}

function multilineInputToObject(multilineInput: string[]): Object {
    const joined = multilineInput.join('');
    return joined == '' ? {} : JSON.parse(joined);
}

/**
 * @param {number} s - Seconds to wait for
 */
function sleep(s: number) {
    return new Promise((resolve) => setTimeout(resolve, s * 1000));
}

/**
 * @param batchStatusResponse
 * @returns {Boolean} True if there are no more pending tests
 */
function isTestBatchRunning(batchStatusResponse: CTRFReport): boolean {
    core.debug(JSON.stringify(batchStatusResponse));
    const pending: number = batchStatusResponse?.results?.summary?.pending ?? 0;
    return pending > 0;
}

function isBatchProgressing(
    previousNumberOfPendingTests: number,
    changeTimeOfPendingTests: Date | null,
    batchProgessTimeout: number,
    batchStatusResponse: CTRFReport,
): Date | null {
    const currentTime = new Date();
    if (changeTimeOfPendingTests == null) {
        changeTimeOfPendingTests = new Date();
    }
    if (batchStatusResponse?.results?.summary?.pending < previousNumberOfPendingTests) {
        return new Date();
        // "+" before Date due to https://github.com/Microsoft/TypeScript/issues/5710
    } else if (+currentTime - +changeTimeOfPendingTests > batchProgessTimeout * 1000) {
        core.setFailed('Timeout waiting for pending tests.');
        return null;
    } else {
        return null;
    }
}

function isValueInRange(value: number, minValue: number, maxValue: number): boolean {
    return value >= minValue && value <= maxValue;
}

/**
 * @param startEpochMs - Unix epoch milliseconds (e.g. Date.getTime())
 * @param endEpochMs - Unix epoch milliseconds
 * @returns Duration as "Xh YYm ZZs" with minutes and seconds zero-padded to 2 digits
 */
function formatEpochDurationMs(startEpochMs: number, endEpochMs: number | null): string {
    if (endEpochMs == null) {
        return 'n/a';
    }
    const totalSec = Math.floor(Math.abs(endEpochMs - startEpochMs) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function log_batch_results(batchResults: CTRFReport): void {
    const summary: Summary = batchResults.results.summary;
    const startMs: number | undefined = summary.start;
    const stopMs: number | undefined = summary.stop;
    const duration: string = startMs !== undefined && stopMs !== undefined ? formatEpochDurationMs(startMs, stopMs) : 'n/a';
    const logLine = `Total: ${summary.tests}, Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}, Duration: ${duration}`;
    core.info(logLine);
}

function isBatchFailed(batchStatus: CTRFReport): boolean {
    if (batchStatus?.results?.summary?.failed > 0) {
        return true;
    }
    const tests: Test[] = batchStatus.results.tests;
    for (const test of tests) {
        if (test.rawStatus === 'FailedToStart') {
            return true;
        }
    }
    return false;
}

/**
 * Main function of the github action.
 */
export async function run() {
    const minStatusWaitTime: number = 5;
    const maxStatusWaitTime: number = 60;
    const artifact: ArtifactClient = new DefaultArtifactClient();

    const apiKey: string = core.getInput('apiKey', { required: true });
    const labelsInput: string = core.getInput('labels', { required: true });
    const maxNumberOfAgents: string = core.getInput('maxNumberOfAgents', {
        required: true,
    });
    const testName: string = core.getInput('testName', { required: false });
    const globalVariableOverridesMultiline: string[] = core.getMultilineInput('globalVariableOverrides', { required: false });
    const variableOverridesPerTestMultiline: string[] = core.getMultilineInput('variableOverridesPerTest', { required: false });
    const gatewayName: string = core.getInput('gatewayName', { required: false });
    const apiUrl: string = core.getInput('apiUrl', { required: false });
    const batchWaitTimeoutSeconds: string = core.getInput('pollPeriodSeconds', {
        required: false,
    });
    const batchProgressTimeout: number = parseInt(core.getInput('testTimeoutSeconds', { required: false }));
    const batchStatusFilepath: PathLike = core.getInput('reportFilePath');
    if (!isValueInRange(parseInt(batchWaitTimeoutSeconds), minStatusWaitTime, maxStatusWaitTime)) {
        core.setFailed(`Wait time is not within sane bounds of ${minStatusWaitTime} and ${maxStatusWaitTime} seconds.`);
    }

    const labels: string[] = parseLabels(labelsInput);

    const globalVariableOverrides: Object = multilineInputToObject(globalVariableOverridesMultiline);
    const variableOverridesPerTest: Object = multilineInputToObject(variableOverridesPerTestMultiline);

    const batchId: string = await executeBatch(
        apiUrl,
        apiKey,
        labels,
        maxNumberOfAgents,
        testName,
        globalVariableOverrides,
        variableOverridesPerTest,
        gatewayName,
    );
    core.info(`Started test batch with labels: ${labels}`);

    let batchStatus: CTRFReport;
    let lastChangeOfPendingTests: Date | null = new Date();
    let previousNumberOfPendingTests: number = Number.MAX_SAFE_INTEGER;
    do {
        core.debug('Waiting for test batch to finish.');
        await sleep(parseInt(batchWaitTimeoutSeconds));
        batchStatus = await getBatchStatus(apiUrl, apiKey, batchId);
        core.debug(JSON.stringify(batchStatus));
        lastChangeOfPendingTests = isBatchProgressing(previousNumberOfPendingTests, lastChangeOfPendingTests, batchProgressTimeout, batchStatus);
    } while (isTestBatchRunning(batchStatus));

    core.setOutput('batchId', batchId);
    log_batch_results(batchStatus);
    if (isBatchFailed(batchStatus)) {
        core.setFailed('AIVA test batch has failed tests or tests that failed to start.');
    }

    await writeFile(batchStatusFilepath, JSON.stringify(batchStatus), 'utf-8');
    // Local-action testing crashes when trying to upload artifact, so we want to skip it
    if (process.env.SKIP_ARTIFACT_UPLOAD) {
        core.warning('Skipping artifact upload: SKIP_ARTIFACT_UPLOAD is set. ' + `Batch CTRF was written to ${String(batchStatusFilepath)}.`);
    } else {
        await artifact.uploadArtifact('batch-status', [batchStatusFilepath], '.');
    }
}
