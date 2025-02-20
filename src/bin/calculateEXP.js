module.exports = function (level) {
    function evaluateCurve(curvePoints, x) {
        // Find the two points between which the input time (x) lies
        let point1 = null;
        let point2 = null;

        for (let i = 0; i < curvePoints.length - 1; i++) {
            if (x >= curvePoints[i].time && x <= curvePoints[i + 1].time) {
                point1 = curvePoints[i];
                point2 = curvePoints[i + 1];
                break;
            }
        }

        // If x is outside the curve range, return the closest value
        if (!point1 || !point2) {
            if (x < curvePoints[0].time) return curvePoints[0].value;
            if (x > curvePoints[curvePoints.length - 1].time) return curvePoints[curvePoints.length - 1].value;
        }

        // Hermite interpolation
        const t = (x - point1.time) / (point2.time - point1.time); // Normalize x between point1 and point2
        const h00 = (1 + 2 * t) * (1 - t) ** 2; // Basis function 1
        const h10 = t * (1 - t) ** 2;          // Basis function 2
        const h01 = t ** 2 * (3 - 2 * t);      // Basis function 3
        const h11 = t ** 2 * (t - 1);          // Basis function 4

        const y =
            h00 * point1.value +
            h10 * (point2.time - point1.time) * point1.outSlope +
            h01 * point2.value +
            h11 * (point2.time - point1.time) * point2.inSlope;

        return y;
    }

    // Example usage
    const curvePoints = [
        {
            time: 0,
            value: 0,
            inSlope: 0,
            outSlope: 0,
            inWeight: 0,
            outWeight: 0
        },
        {
            time: 1,
            value: 50,
            inSlope: 24.20684,
            outSlope: 24.20684,
            inWeight: 0.33333334,
            outWeight: 0.33333334
        },
        {
            time: 2.1287553,
            value: 172.16977,
            inSlope: 101.716446,
            outSlope: 101.716446,
            inWeight: 0.33333334,
            outWeight: 0.18012097
        },
        {
            time: 4.1287556,
            value: 508.20282,
            inSlope: 228.4089,
            outSlope: 228.4089,
            inWeight: 0.33333334,
            outWeight: 0.6995516
        },
        {
            time: 6.871251,
            value: 834.99994,
            inSlope: 170.70514,
            outSlope: 170.70514,
            inWeight: 0.33333334,
            outWeight: 0.33333334
        },
        {
            time: 20,
            value: 13383.37,
            inSlope: 766.77057,
            outSlope: 766.77057,
            inWeight: 0.150376,
            outWeight: 0
        },
        {
            time: 22.302576,
            value: 17512.82,
            inSlope: 1284.807,
            outSlope: 1284.807,
            inWeight: 1,
            outWeight: 0.77409667
        },
        {
            time: 25.363678,
            value: 28459.07,
            inSlope: 2037.1912,
            outSlope: 2037.1912,
            inWeight: 0.24691363,
            outWeight: 0
        }
    ];

    return evaluateCurve(curvePoints, level);
}