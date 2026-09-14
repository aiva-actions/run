import * as core from '@actions/core';
import { writeFile } from 'node:fs/promises';
import { DefaultArtifactClient } from '@actions/artifact';
import { PathLike } from 'node:fs';
import { triggerBatch, waitForBatchCompleted, isInRange } from 'runner';
import { MIN_POLL_SECONDS, MAX_POLL_SECONDS } from 'runner';
import type { AIVAOptions } from 'runner';

function multilineInputToObject(inputName: string, multilineInput: string[]): object {
    const joined = multilineInput.join('');
    if (joined == '') {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(joined);
    } catch (e) {
        throw new Error(`Input '${inputName}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Input '${inputName}' must be a JSON object, e.g. {"username": "testuser"}`);
    }
    return parsed;
}

/**
 * Main function of the github action.
 */
export async function run() {
    const apiKey = core.getInput('apiKey', { required: true });
    const batchId = core.getInput('batchId', { required: true });
    const globalVariableOverridesMultiline = core.getMultilineInput('globalVariableOverrides', { required: false });
    const apiUrl = core.getInput('apiUrl', { required: false });
    const pollPeriodSeconds = core.getInput('pollPeriodSeconds', { required: false });
    const verbose = core.getInput('verbose', { required: false });
    const batchStatusFilepath: PathLike = core.getInput('reportFilePath');
    const artifactName = core.getInput('artifactName', { required: false }) || 'batch-status';

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

    const batchInfo = await triggerBatch(apiUrl, apiKey, batchId, multilineInputToObject('globalVariableOverrides', globalVariableOverridesMultiline));
    core.setOutput('batchId', batchInfo.executionId);
    core.info(`Triggered batch ${batchId}, execution ${batchInfo.executionId}`);

    const report = await waitForBatchCompleted(batchInfo.executionId, aivaOptions);

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
