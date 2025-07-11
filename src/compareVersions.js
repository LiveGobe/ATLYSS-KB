export default function(version1, version2) {
    // Helper to detect format
    const isOldFormat = (v) => /^(Alpha|Beta)?\s?\d+\.\d+\.\d+[a-z]?$/i.test(v);
    const isNewFormat = (v) => /^\d+\.[a-z]\d+$/i.test(v);

    // Parse old format: Beta 1.6.2b
    const parseOld = (version) => {
        const regex = /^(Alpha|Beta)?\s?(\d+)\.(\d+)\.(\d+)([a-z]?)$/i;
        const match = version.match(regex);
        if (!match) throw new Error(`Invalid old version format: ${version}`);
        const [, preRelease, major, minor, patch, suffix] = match;
        return {
            type: 'old',
            preRelease: preRelease ? preRelease.toLowerCase() : '',
            major: parseInt(major, 10),
            minor: parseInt(minor, 10),
            patch: parseInt(patch, 10),
            suffix: suffix ? suffix.charCodeAt(0) : 0
        };
    };

    // Parse new format: 72025.a3
    const parseNew = (version) => {
        const regex = /^(\d+)\.([a-z])(\d+)$/i;
        const match = version.match(regex);
        if (!match) throw new Error(`Invalid new version format: ${version}`);
        const [, build, letter, num] = match;
        return {
            type: 'new',
            build: parseInt(build, 10),
            letter: letter.toLowerCase().charCodeAt(0),
            num: parseInt(num, 10)
        };
    };

    // Unified parse
    const parseVersion = (v) => {
        if (isOldFormat(v)) return parseOld(v);
        if (isNewFormat(v)) return parseNew(v);
        throw new Error(`Unknown version format: ${v}`);
    };

    const v1 = parseVersion(version1);
    const v2 = parseVersion(version2);

    // Comparison logic
    const compare = (a, b) => (a > b) - (a < b);

    // If both are old format
    if (v1.type === 'old' && v2.type === 'old') {
        const preReleaseOrder = { alpha: 1, beta: 2, '': 3 };
        return (
            compare(preReleaseOrder[v1.preRelease], preReleaseOrder[v2.preRelease]) ||
            compare(v1.major, v2.major) ||
            compare(v1.minor, v2.minor) ||
            compare(v1.patch, v2.patch) ||
            compare(v1.suffix, v2.suffix)
        );
    }
    // If both are new format
    if (v1.type === 'new' && v2.type === 'new') {
        return (
            compare(v1.build, v2.build) ||
            compare(v1.letter, v2.letter) ||
            compare(v1.num, v2.num)
        );
    }
    // If mixed, treat new format as always newer than old format
    return v1.type === 'new' ? 1 : -1;
}