export default function(version1, version2) {
    // Parse version strings into components
    const parseVersion = (version) => {
        const regex = /^(Alpha|Beta)?\s?(\d+)\.(\d+)\.(\d+)([a-z]?)$/i;
        const match = version.match(regex);

        if (!match) throw new Error(`Invalid version format: ${version}`);

        const [, preRelease, major, minor, patch, suffix] = match;
        return {
            preRelease: preRelease ? preRelease.toLowerCase() : "", // e.g., "alpha", "beta"
            major: parseInt(major, 10),
            minor: parseInt(minor, 10),
            patch: parseInt(patch, 10),
            suffix: suffix ? suffix.charCodeAt(0) : 0 // Convert suffix to ASCII value for comparison
        };
    };

    const v1 = parseVersion(version1);
    const v2 = parseVersion(version2);

    // Comparison logic
    const compare = (a, b) => (a > b) - (a < b); // Simplified comparison function

    const preReleaseOrder = { alpha: 1, beta: 2, "": 3 }; // Define order for pre-release identifiers
    return (
        compare(preReleaseOrder[v1.preRelease], preReleaseOrder[v2.preRelease]) ||
        compare(v1.major, v2.major) ||
        compare(v1.minor, v2.minor) ||
        compare(v1.patch, v2.patch) ||
        compare(v1.suffix, v2.suffix)
    );
};