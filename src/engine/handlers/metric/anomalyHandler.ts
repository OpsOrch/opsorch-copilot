/**
 * Metric Anomaly Handler
 *
 * Detects anomalies and trends in metric time series data.
 * Extracted from AnomalyDetector class to follow handler-based architecture.
 */

import type { AnomalyHandler } from "../handlers.js";
import type { MetricSeries, Anomaly, Trend } from "../../../types.js";

const OUTLIER_THRESHOLD = 2; // Standard deviations
const SPIKE_THRESHOLD = 0.5; // 50% increase
const DROP_THRESHOLD = 0.5; // 50% decrease
const TREND_MIN_POINTS = 3;

/**
 * Metric anomaly handler that detects anomalies in metric time series data
 */
export const metricAnomalyHandler: AnomalyHandler = async (
  context,
  metricSeries,
): Promise<Anomaly[]> => {
  const allAnomalies: Anomaly[] = [];

  // Process each metric series for anomalies
  for (const series of metricSeries) {
    const anomalies = detectAnomaliesInSeries(series);
    allAnomalies.push(...anomalies);
  }

  // Sort anomalies by severity and timestamp
  allAnomalies.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;

    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  return allAnomalies;
};

/**
 * Detect anomalies in a single metric series using statistical methods
 */
function detectAnomaliesInSeries(series: MetricSeries): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (series.values.length < 3) {
    return anomalies;
  }

  const stats = calculateStatistics(series.values);

  for (let i = 0; i < series.values.length; i++) {
    const value = series.values[i];
    const timestamp = series.timestamps[i];

    if (!timestamp) continue;

    const deviationFromMean = Math.abs(value - stats.mean);
    const isOutlier = deviationFromMean > OUTLIER_THRESHOLD * stats.stdDev;

    if (isOutlier) {
      const severity = calculateSeverity(deviationFromMean, stats.stdDev);

      anomalies.push({
        timestamp,
        value,
        type: "outlier",
        severity,
        deviationFromMean,
        metric: series.expression,
      });
    }

    if (i > 0) {
      const prevValue = series.values[i - 1];
      const changeRatio = Math.abs(value - prevValue) / Math.abs(prevValue);

      if (changeRatio > SPIKE_THRESHOLD && value > prevValue) {
        const severity =
          changeRatio > 1.0 ? "high" : changeRatio > 0.8 ? "medium" : "low";

        anomalies.push({
          timestamp,
          value,
          type: "spike",
          severity,
          deviationFromMean,
          metric: series.expression,
        });
      } else if (changeRatio > DROP_THRESHOLD && value < prevValue) {
        const severity =
          changeRatio > 1.0 ? "high" : changeRatio > 0.8 ? "medium" : "low";

        anomalies.push({
          timestamp,
          value,
          type: "drop",
          severity,
          deviationFromMean,
          metric: series.expression,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Detect trends in time series data
 */
export function detectTrends(series: MetricSeries): Trend[] {
  const trends: Trend[] = [];

  if (series.values.length < TREND_MIN_POINTS) {
    return trends;
  }

  const slope = calculateSlope(series.values);
  const confidence = calculateTrendConfidence(series.values, slope);

  if (confidence > 0.6) {
    let direction: Trend["direction"];

    if (Math.abs(slope) < 0.01) {
      direction = "stable";
    } else if (slope > 0) {
      direction = "increasing";
    } else {
      direction = "decreasing";
    }

    trends.push({
      direction,
      confidence,
      startTimestamp: series.timestamps[0],
      endTimestamp: series.timestamps[series.timestamps.length - 1],
      metric: series.expression,
    });
  }

  return trends;
}

/**
 * Compare metrics across services by calculating anomaly severity scores
 */
export function compareServices(seriesList: MetricSeries[]): {
  service: string;
  severity: number;
}[] {
  const serviceScores = new Map<string, number>();

  for (const series of seriesList) {
    const service = series.service || "unknown";
    const anomalies = detectAnomaliesInSeries(series);

    let score = 0;
    for (const anomaly of anomalies) {
      switch (anomaly.severity) {
        case "high":
          score += 3;
          break;
        case "medium":
          score += 2;
          break;
        case "low":
          score += 1;
          break;
      }
    }

    const currentScore = serviceScores.get(service) || 0;
    serviceScores.set(service, currentScore + score);
  }

  const results = Array.from(serviceScores.entries())
    .map(([service, severity]) => ({ service, severity }))
    .sort((a, b) => b.severity - a.severity);

  return results;
}

/**
 * Calculate basic statistics for a series of values
 */
function calculateStatistics(values: number[]): {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
} {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return { mean, stdDev, min, max };
}

/**
 * Calculate anomaly severity based on deviation from mean
 */
function calculateSeverity(
  deviation: number,
  stdDev: number,
): Anomaly["severity"] {
  const deviationRatio = deviation / stdDev;

  if (deviationRatio > 3) return "high";
  if (deviationRatio > 2.5) return "medium";
  return "low";
}

/**
 * Calculate slope of a time series using linear regression
 */
function calculateSlope(values: number[]): number {
  const n = values.length;
  const xSum = (n * (n - 1)) / 2;
  const ySum = values.reduce((sum, val) => sum + val, 0);
  const xySum = values.reduce((sum, val, i) => sum + i * val, 0);
  const xxSum = values.reduce((sum, _, i) => sum + i * i, 0);

  const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
  return slope;
}

/**
 * Calculate confidence level for trend detection using R-squared
 */
function calculateTrendConfidence(values: number[], slope: number): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const yIntercept = mean - (slope * (values.length - 1)) / 2;

  let totalSumSquares = 0;
  let residualSumSquares = 0;

  for (let i = 0; i < values.length; i++) {
    const predicted = yIntercept + slope * i;
    totalSumSquares += Math.pow(values[i] - mean, 2);
    residualSumSquares += Math.pow(values[i] - predicted, 2);
  }

  const rSquared = 1 - residualSumSquares / totalSumSquares;
  return Math.max(0, Math.min(1, rSquared));
}
