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
    const artifactName = core.getInput('artifactName', { required: false }) || 'batch-status';

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
        if (variableOverridesPerTestMultiline.join('')) {
            disallowedOverrides.push('variableOverridesPerTest');
        }
        if (gatewayName) {
            disallowedOverrides.push('gatewayName');
        }
        if (disallowedOverrides.length > 0) {
            core.setFailed(
                `When batchId is provided, these inputs cannot be overridden: ${disallowedOverrides.join(', ')}. Only batchName and globalVariableOverrides may be overridden.`,
            );
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
    core.setOutput('batchId', batchInfo.testBatchId);
    core.info(batchId ? `Started test batch from batchId: ${batchId}` : `Started test batch with labels: ${labels}`);

    const report = await waitForBatchCompleted(batchInfo.testBatchId, aivaOptions);

    await writeFile(batchStatusFilepath, report.reportContent, 'utf-8');

    const summary = report.parsedReport.results.summary;
    const batchUrl = (summary.extra?.testBatchLink as string | undefined) ?? '';
    core.setOutput('batchUrl', batchUrl);
    core.setOutput('success', String(report.success));

    if (!report.success) {
        core.setFailed(`AIVA batch failed: ${summary.failed} failed, ${summary.passed} passed, ${summary.skipped} skipped of ${summary.tests} total.`);
    }

    // Local-action testing crashes when trying to upload artifact, so we want to skip it
    if (process.env.SKIP_ARTIFACT_UPLOAD) {
        core.warning('Skipping artifact upload: SKIP_ARTIFACT_UPLOAD is set. ' + `Batch CTRF was written to ${String(batchStatusFilepath)}.`);
    } else {
        const artifact = new DefaultArtifactClient();
        await artifact.uploadArtifact(artifactName, [batchStatusFilepath], '.');
    }
}
