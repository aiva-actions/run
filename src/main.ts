import * as core from '@actions/core';
import { writeFile } from 'node:fs/promises';
import { DefaultArtifactClient, ArtifactClient } from '@actions/artifact';
import { PathLike } from 'node:fs';
import { executeBatch, waitForBatchCompleted, isInRange, parseLabels } from 'runner';
import { MIN_POLL_SECONDS, MAX_POLL_SECONDS } from 'runner';
import type { RunTestBatchResponse, AIVAOptions, AIVAReport } from 'runner';

function multilineInputToObject(multilineInput: string[]): Object {
    const joined = multilineInput.join('');
    return joined == '' ? {} : JSON.parse(joined);
}

/**
 * Main function of the github action.
 */
export async function run() {
    const artifact: ArtifactClient = new DefaultArtifactClient();

    const apiKey: string = core.getInput('apiKey', { required: true });
    const labelsInput: string = core.getInput('labels', { required: true });
    const maxNumberOfAgents: string = core.getInput('maxNumberOfAgents', {
        required: true,
    });
    const batchName: string = core.getInput('testName', { required: false });
    const globalVariableOverridesMultiline: string[] = core.getMultilineInput('globalVariableOverrides', { required: false });
    const variableOverridesPerTestMultiline: string[] = core.getMultilineInput('variableOverridesPerTest', { required: false });
    const gatewayName: string = core.getInput('gatewayName', { required: false });
    const apiUrl: string = core.getInput('apiUrl', { required: false });
    const pollPeriodSeconds: string = core.getInput('pollPeriodSeconds', {
        required: false,
    });
    const verbose: string = core.getInput('verbose', {required: false})
    const batchStatusFilepath: PathLike = core.getInput('reportFilePath');

    const labels: string[] = parseLabels(labelsInput, []);
    
    if (!isInRange(parseInt(pollPeriodSeconds), MIN_POLL_SECONDS, MAX_POLL_SECONDS)) {
        core.error(`Poll period ${pollPeriodSeconds} is invalid. Value must be between ${MIN_POLL_SECONDS} and ${MAX_POLL_SECONDS}.`);
        return
    }

    const aivaOptions: AIVAOptions = {
        apiKey: apiKey,
        aivaUrl: apiUrl,
        pollPeriod: parseInt(pollPeriodSeconds),
        format: "ctrf",
        verbose: verbose === 'true',
        logger: {
            logDebug: (message: string): void => core.debug(message),
            logInfo: (message: string): void => core.info(message),
        },
    };

    const batchInfo: RunTestBatchResponse = await executeBatch(
        apiUrl + '/v1/batches',
        apiKey,
        labels,
        maxNumberOfAgents,
        batchName,
        multilineInputToObject(globalVariableOverridesMultiline),
        multilineInputToObject(variableOverridesPerTestMultiline),
        gatewayName,
    );
    core.info(`Started test batch with labels: ${labels}`);

    const report: AIVAReport = await waitForBatchCompleted(batchInfo.testBatchId, aivaOptions);

    await writeFile(batchStatusFilepath, report.reportContent, 'utf-8');

    if (!report.success) {
        core.error('AIVA test batch has failed tests or tests that failed to start.');
    }

    // Local-action testing crashes when trying to upload artifact, so we want to skip it
    if (process.env.SKIP_ARTIFACT_UPLOAD) {
        core.warning('Skipping artifact upload: SKIP_ARTIFACT_UPLOAD is set. ' + `Batch CTRF was written to ${String(batchStatusFilepath)}.`);
    } else {
        await artifact.uploadArtifact('batch-status', [batchStatusFilepath], '.');
    }
}
