import { ToolResult, MetricSeries, Anomaly, Trend } from '../types.js';
import { DomainRegistry } from './domainRegistry.js';
import { isValidTimestamp, normalizeTimestamp } from './timestampUtils.js';

const OUTLIER_THRESHOLD = 2; // Standard deviations
const SPIKE_THRESHOLD = 0.5; // 50% increase
const DROP_THRESHOLD = 0.5; // 50% decrease
const TREND_MIN_POINTS = 3;

/**
 * AnomalyDetector identifies anomalies and trends in metric time series data
 * to help the LLM focus on significant patterns rather than raw data analysis.
 */
export class AnomalyDetector {
  constructor(private registry: DomainRegistry) { }

  /**
   * Extract metric series from tool results using domain registry
   */
  extractMetricSeries(results: ToolResult[]): MetricSeries[] {
    const series: MetricSeries[] = [];

    for (const result of results) {
      // Check if tool belongs to metric domain
      const domain = this.registry.getDomainForTool(result.name);
      if (domain?.name === 'metric') {
        series.push(...this.parseMetricResult(result));
      }
    }

    return series;
  }

  /**
   * Detect anomalies using statistical methods
   */
  detectAnomalies(series: MetricSeries): Anomaly[] {
    const anomalies: Anomaly[] = [];

    if (series.values.length < 3) {
      return anomalies;
    }

    const stats = this.calculateStatistics(series.values);

    for (let i = 0; i < series.values.length; i++) {
      const value = series.values[i];
      const timestamp = series.timestamps[i];

      if (!timestamp) continue;

      const deviationFromMean = Math.abs(value - stats.mean);
      const isOutlier = deviationFromMean > OUTLIER_THRESHOLD * stats.stdDev;

      if (isOutlier) {
        const severity = this.calculateSeverity(deviationFromMean, stats.stdDev);

        anomalies.push({
          timestamp,
          value,
          type: 'outlier',
          severity,
          deviationFromMean,
          metric: series.expression,
        });
      }

      if (i > 0) {
        const prevValue = series.values[i - 1];
        const changeRatio = Math.abs(value - prevValue) / Math.abs(prevValue);

        if (changeRatio > SPIKE_THRESHOLD && value > prevValue) {
          const severity = changeRatio > 1.0 ? 'high' : changeRatio > 0.8 ? 'medium' : 'low';

          anomalies.push({
            timestamp,
            value,
            type: 'spike',
            severity,
            deviationFromMean,
            metric: series.expression,
          });
        } else if (changeRatio > DROP_THRESHOLD && value < prevValue) {
          const severity = changeRatio > 1.0 ? 'high' : changeRatio > 0.8 ? 'medium' : 'low';

          anomalies.push({
            timestamp,
            value,
            type: 'drop',
            severity,
            deviationFromMean,
            metric: series.expression,
          });
        }
      }
    }

    anomalies.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;

      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    return anomalies;
  }

  /**
   * Identify trends in time series
   */
  detectTrends(series: MetricSeries): Trend[] {
    const trends: Trend[] = [];

    if (series.values.length < TREND_MIN_POINTS) {
      return trends;
    }

    const slope = this.calculateSlope(series.values);
    const confidence = this.calculateTrendConfidence(series.values, slope);

    if (confidence > 0.6) {
      let direction: Trend['direction'];

      if (Math.abs(slope) < 0.01) {
        direction = 'stable';
      } else if (slope > 0) {
        direction = 'increasing';
      } else {
        direction = 'decreasing';
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
   * Compare metrics across services
   */
  compareServices(seriesList: MetricSeries[]): {
    service: string;
    severity: number;
  }[] {
    const serviceScores = new Map<string, number>();

    for (const series of seriesList) {
      const service = series.service || 'unknown';
      const anomalies = this.detectAnomalies(series);

      let score = 0;
      for (const anomaly of anomalies) {
        switch (anomaly.severity) {
          case 'high': score += 3; break;
          case 'medium': score += 2; break;
          case 'low': score += 1; break;
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

  private parseMetricResult(result: ToolResult): MetricSeries[] {
    const series: MetricSeries[] = [];
    const payload = result.result;

    if (!payload || typeof payload !== 'object') {
      return series;
    }

    const data = this.findMetricData(payload);

    if (data && Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          const parsed = this.parseMetricItem(item, result.arguments);
          if (parsed) {
            series.push(parsed);
          }
        }
      }
    }

    return series;
  }

  private findMetricData(payload: any): any[] | null {
    const fields = ['series', 'data', 'results', 'metrics', 'values'];

    for (const field of fields) {
      if (payload[field] && Array.isArray(payload[field])) {
        return payload[field];
      }
    }

    if (Array.isArray(payload)) {
      return payload;
    }

    return null;
  }

  private parseMetricItem(item: any, args: any): MetricSeries | null {
    const timestamps: string[] = [];
    const values: number[] = [];

    if (item.values && Array.isArray(item.values)) {
      for (const point of item.values) {
        if (Array.isArray(point) && point.length >= 2) {
          const [ts, val] = point;
          if (isValidTimestamp(ts) && typeof val === 'number') {
            timestamps.push(normalizeTimestamp(ts));
            values.push(val);
          }
        }
      }
    } else if (item.datapoints && Array.isArray(item.datapoints)) {
      for (const point of item.datapoints) {
        if (Array.isArray(point) && point.length >= 2) {
          const [val, ts] = point;
          if (typeof val === 'number' && isValidTimestamp(ts)) {
            timestamps.push(normalizeTimestamp(ts));
            values.push(val);
          }
        }
      }
    } else if (item.timestamps && item.data) {
      const ts = Array.isArray(item.timestamps) ? item.timestamps : [];
      const vals = Array.isArray(item.data) ? item.data : [];

      for (let i = 0; i < Math.min(ts.length, vals.length); i++) {
        if (isValidTimestamp(ts[i]) && typeof vals[i] === 'number') {
          timestamps.push(normalizeTimestamp(ts[i]));
          values.push(vals[i]);
        }
      }
    }

    if (timestamps.length === 0 || values.length === 0) {
      return null;
    }

    return {
      timestamps,
      values,
      expression: item.metric || item.target || item.name || args?.expression || 'unknown',
      service: args?.service || item.service,
    };
  }

  private calculateStatistics(values: number[]): {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
  } {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { mean, stdDev, min, max };
  }

  private calculateSeverity(deviation: number, stdDev: number): Anomaly['severity'] {
    const deviationRatio = deviation / stdDev;

    if (deviationRatio > 3) return 'high';
    if (deviationRatio > 2.5) return 'medium';
    return 'low';
  }

  private calculateSlope(values: number[]): number {
    const n = values.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = values.reduce((sum, val) => sum + val, 0);
    const xySum = values.reduce((sum, val, i) => sum + i * val, 0);
    const xxSum = values.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * xySum - xSum * ySum) / (n * xxSum - xSum * xSum);
    return slope;
  }

  private calculateTrendConfidence(values: number[], slope: number): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const yIntercept = mean - slope * (values.length - 1) / 2;

    let totalSumSquares = 0;
    let residualSumSquares = 0;

    for (let i = 0; i < values.length; i++) {
      const predicted = yIntercept + slope * i;
      totalSumSquares += Math.pow(values[i] - mean, 2);
      residualSumSquares += Math.pow(values[i] - predicted, 2);
    }

    const rSquared = 1 - (residualSumSquares / totalSumSquares);
    return Math.max(0, Math.min(1, rSquared));
  }
}
