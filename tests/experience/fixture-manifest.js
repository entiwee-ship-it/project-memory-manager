const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const QY_ROOT = process.env.PMM_EXPERIENCE_WORKSPACE || 'E:/xile-workspace/qyProject';
const ALLOWED_INTENTS = new Set(['understand', 'implement', 'debug', 'resume', 'review', 'simple']);
const ALLOWED_RISKS = new Set(['low', 'medium', 'high']);

function resolveFixturePath(file) {
    return path.isAbsolute(file) ? file : path.join(QY_ROOT, file);
}

function assertStringArray(value, field, fixtureId) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${fixtureId}.${field} must be a non-empty string array`);
    }
}

function validateExperienceFixture(fixture, fileName = '') {
    const fixtureId = fixture?.id || fileName || 'unknown-fixture';
    if (!fixture || typeof fixture !== 'object') {
        throw new Error(`${fixtureId} must be an object`);
    }
    if (!fixture.id || !fixture.task) {
        throw new Error(`${fixtureId} must define id and task`);
    }
    if (!ALLOWED_INTENTS.has(fixture.intent)) {
        throw new Error(`${fixtureId}.intent is invalid: ${fixture.intent}`);
    }
    if (!ALLOWED_RISKS.has(fixture.risk)) {
        throw new Error(`${fixtureId}.risk is invalid: ${fixture.risk}`);
    }
    for (const field of ['knownFiles', 'changedFiles', 'requiredFiles', 'acceptedFiles', 'forbiddenDomains', 'expectedValidation']) {
        if (!Array.isArray(fixture[field])) {
            throw new Error(`${fixtureId}.${field} must be an array`);
        }
        if (fixture[field].length > 0) {
            assertStringArray(fixture[field], field, fixtureId);
        }
    }
    if (!fixture.expectedMemory || typeof fixture.expectedMemory !== 'object') {
        throw new Error(`${fixtureId}.expectedMemory must be an object`);
    }
    if (!Array.isArray(fixture.expectedMemory.taskFragments)) {
        throw new Error(`${fixtureId}.expectedMemory.taskFragments must be an array`);
    }
    if (fixture.expectedMemory.taskFragments.length > 0) {
        assertStringArray(fixture.expectedMemory.taskFragments, 'expectedMemory.taskFragments', fixtureId);
    }
    if (fixture.intent !== 'resume' && fixture.requiredFiles.length === 0) {
        throw new Error(`${fixtureId}.requiredFiles must not be empty`);
    }
    for (const file of fixture.requiredFiles) {
        if (/[*?]|actual |found/i.test(file)) {
            throw new Error(`${fixtureId}.requiredFiles contains an unresolved path: ${file}`);
        }
        if (!fs.existsSync(resolveFixturePath(file))) {
            throw new Error(`${fixtureId}.requiredFiles path does not exist: ${file}`);
        }
    }
    const baseline = fixture.directSourceBaseline;
    if (!baseline || !Array.isArray(baseline.searchRounds) || !Array.isArray(baseline.readFiles)
        || !Number.isInteger(baseline.correctionRounds)) {
        throw new Error(`${fixtureId}.directSourceBaseline is invalid`);
    }
    return fixture;
}

function loadExperienceFixtures() {
    return fs.readdirSync(FIXTURE_DIR)
        .filter(file => file.endsWith('.json'))
        .sort()
        .map(file => {
            const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
            return validateExperienceFixture(fixture, file);
        });
}

module.exports = {
    FIXTURE_DIR,
    QY_ROOT,
    loadExperienceFixtures,
    validateExperienceFixture,
};
