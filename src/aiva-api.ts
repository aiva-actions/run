import * as core from '@actions/core';
import type { CTRFReport } from 'ctrf';

interface runTestBatchResponse {
    testBatchId: string;
}

/**
 * @param {Request | string | URL} apiUrl
 * @param {string} apiKey
 * @param {string[]} labels
 * @param maxNumberOfAgents
 * @param batchName
 * @param globalVariableOverrides
 * @param variableOverridesPerTest
 * @param gatewayName
 * @returns {string} batchID of the newly created batch in AIVA
 */
export async function executeBatch(
    apiUrl: string,
    apiKey: string,
    labels: string[],
    maxNumberOfAgents: string,
    batchName: string,
    globalVariableOverrides: object,
    variableOverridesPerTest: object,
    gatewayName: string,
): Promise<string> {
    core.info('Executing test batch containing tests labeled with: ' + labels);

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': apiKey,
        },
        body: JSON.stringify({
            name: batchName,
            labels: labels,
            maxNumberOfAgents: maxNumberOfAgents,
            globalVariablesOverrides: globalVariableOverrides,
            variablesOverridesPerTest: variableOverridesPerTest,
            gatewayName: gatewayName,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AIVA batch request failed (${res.status}): ${errText}`);
    }

    core.info(`AIVA batch request accepted (${res.status})`);

    const responseJSON = (await res.json()) as runTestBatchResponse;
    const batchId = responseJSON.testBatchId;
    if (!batchId) {
        throw new Error('AIVA batch response missing testBatchId');
    }
    return batchId;
}

/**
 * @param {string} apiUrl
 * @param {string} apiKey
 * @param {string} batchId
 */
export async function getBatchStatus(apiUrl: string, apiKey: string, batchId: string): Promise<CTRFReport> {
    const res: Response = await fetch(apiUrl + batchId, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'X-API-Key': apiKey,
        },
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Batch status request failed (${res.status}): ${errText}`);
    }
    return (await res.json()) as CTRFReport;
}
