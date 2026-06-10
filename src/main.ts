import * as core from '@actions/core';
import { writeFile } from 'node:fs/promises';
import { DefaultArtifactClient } from '@actions/artifact';
import { PathLike } from 'node:fs';
import { executeBatch, waitForBatchCompleted, isInRange, parseLabels } from 'runner';
import { MIN_POLL_SECONDS, MAX_POLL_SECONDS } from 'runner';
import type { AIVAOptions } from 'runner';

function multilineInputToObject(multilineInput: string[]): object {
    const joined = multilineInput.join('');
    return joined == '' ? {} : JSON.parse(joined);
}

/**
 * Main function of the github action.
 */
export async function run() {
    const apiKey = core.getInput('apiKey', { required: true });
    const labelsInput = core.getInput('labels', { required: false });
    const batchId = core.getInput('batchId', { required: false });
    const maxNumberOfAgents = core.getInput('maxNumberOfAgents', { required: false });
    const batchName = core.getInput('batchName', { required: false });
    const globalVariableOverridesMultiline = core.getMultilineInput('globalVariableOverrides', { required: false });
    const variableOverridesPerTestMultiline = core.getMultilineInput('variableOverridesPerTest', { required: false });
    const gatewayName = core.getInput('gatewayName', { required: false });
    const apiUrl = core.getInput('apiUrl', { required: false });
    const pollPeriodSeconds = core.getInput('pollPeriodSeconds', { required: false });
    const verbose = core.getInput('verbose', { required: false });
    const batchStatusFilepath: PathLike = core.getInput('reportFilePath');

    if (!labelsInput && !batchId) {
        core.setFailed('Either labels or batchId must be provided.');
        return;
    }

    if (batchId) {
        const disallowedOverrides: string[] = [];
        if (labelsInput) {
            disallowedOverrides.push('labels');
        }
        if (maxNumberOfAgents) {
            disallowedOverrides.push('maxNumberOfAgents');
        }
        if (globalVariableOverridesMultiline.join('')) {
            disallowedOverrides.push('globalVariableOverrides');
        }
        if (variableOverridesPerTestMultiline.join('')) {
            disallowedOverrides.push('variableOverridesPerTest');
        }
        if (gatewayName) {
            disallowedOverrides.push('gatewayName');
        }
        if (disallowedOverrides.length > 0) {
            core.setFailed(`When batchId is provided, these inputs cannot be overridden: ${disallowedOverrides.join(', ')}. Only batchName may be overridden.`);
            return;
        }
    }

    const labels = labelsInput ? parseLabels(labelsInput, []) : undefined;

    if (!isInRange(parseInt(pollPeriodSeconds), MIN_POLL_SECONDS, MAX_POLL_SECONDS)) {
        core.setFailed(`Poll period ${pollPeriodSeconds} is invalid. Value must be between ${MIN_POLL_SECONDS} and ${MAX_POLL_SECONDS}.`);
        return;
    }

    const aivaOptions: AIVAOptions = {
        apiKey: apiKey,
        aivaUrl: apiUrl,
        pollPeriod: parseInt(pollPeriodSeconds),
        format: 'ctrf',
        verbose: verbose === 'true',
        logger: {
            logDebug: (message: string): void => core.debug(message),
            logInfo: (message: string): void => core.info(message),
        },
    };

    const batchInfo = await executeBatch(
        apiUrl,
        apiKey,
        labels,
        maxNumberOfAgents || undefined,
        batchName,
        multilineInputToObject(globalVariableOverridesMultiline),
        multilineInputToObject(variableOverridesPerTestMultiline),
        gatewayName,
        batchId || undefined,
    );
    core.info(batchId ? `Started test batch from batchId: ${batchId}` : `Started test batch with labels: ${labels}`);

    const report = await waitForBatchCompleted(batchInfo.testBatchId, aivaOptions);

    await writeFile(batchStatusFilepath, report.reportContent, 'utf-8');

    if (!report.success) {
        core.setFailed('AIVA test batch has failed tests or tests that failed to start.');
    }

    // Local-action testing crashes when trying to upload artifact, so we want to skip it
    if (process.env.SKIP_ARTIFACT_UPLOAD) {
        core.warning('Skipping artifact upload: SKIP_ARTIFACT_UPLOAD is set. ' + `Batch CTRF was written to ${String(batchStatusFilepath)}.`);
    } else {
        const artifact = new DefaultArtifactClient();
        await artifact.uploadArtifact('batch-status', [batchStatusFilepath], '.');
    }
}
