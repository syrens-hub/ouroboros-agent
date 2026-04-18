/**
 * Monitoring Dashboard
 * ====================
 * Aggregates real-time status from all v5.3 Phase A/B modules into
 * a unified snapshot for the system dashboard.
 */

import { eventBus } from "../../core/event-bus.ts";
import { evolutionLock, changeFreezePeriod, budgetController } from "../safety-controls/index.ts";
import { approvalGenerator } from "../approval/index.ts";
import { evolutionVersionManager } from "../evolution-version-manager/index.ts";
import { incrementalTestRunner } from "../incremental-test/index.ts";
import { getEvolutionMetrics } from "../evolution-viz/index.ts";

export interface EventBusStatus {
  queueSize: number;
  deadLetterCount: number;
  pendingDeadLetters: number;
  running: boolean;
}

export interface SafetyStatus {
  lockHeld: boolean;
  lockOwner: string | null;
  frozen: boolean;
  freezeRemainingHours: number;
  budget: {
    dailyLimit: number;
    monthlyLimit: number;
    dailySpent: number;
    monthlySpent: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    withinBudget: boolean;
  };
}

export interface ApprovalQueueStatus {
  pendingCount: number;
  delayedCount: number;
  manualCount: number;
  deniedCount: number;
  approvedCount: number;
  recent: Array<{
    id: string;
    decision: string;
    status: string;
    riskScore: number;
    description: string;
    createdAt: number;
  }>;
}

export interface EvolutionVersionStatus {
  currentTag: string | null;
  totalVersions: number;
  latestDescription: string | null;
  latestTestStatus: string | null;
  latestApprovalStatus: string | null;
}

export interface TestRunStatus {
  totalRuns: number;
  lastRun: {
    runId: string;
    mode: string;
    passed: number;
    failed: number;
    status: string;
    timestamp: number;
  } | null;
  recentFailures: number;
}

export interface MonitoringSnapshot {
  timestamp: number;
  eventBus: EventBusStatus;
  safety: SafetyStatus;
  approvals: ApprovalQueueStatus;
  evolutionVersions: EvolutionVersionStatus;
  testRuns: TestRunStatus;
  evolutionMetrics: ReturnType<typeof getEvolutionMetrics>;
}

export function getEventBusStatus(): EventBusStatus {
  const health = eventBus.healthCheck();
  return {
    queueSize: health.queueSize,
    deadLetterCount: health.deadLetterCount,
    pendingDeadLetters: health.pendingDeadLetters,
    running: health.running,
  };
}

export function getSafetyStatus(): SafetyStatus {
  const freeze = changeFreezePeriod.getState();
  const budget = budgetController.getStatus();
  return {
    lockHeld: evolutionLock.isLocked(),
    lockOwner: evolutionLock.getOwner(),
    frozen: freeze.frozen,
    freezeRemainingHours: freeze.remainingHours,
    budget: {
      dailyLimit: budget.dailyLimit,
      monthlyLimit: budget.monthlyLimit,
      dailySpent: budget.dailySpent,
      monthlySpent: budget.monthlySpent,
      dailyRemaining: budget.dailyRemaining,
      monthlyRemaining: budget.monthlyRemaining,
      withinBudget: budget.withinBudget,
    },
  };
}

export function getApprovalQueueStatus(): ApprovalQueueStatus {
  const all = approvalGenerator.listApprovals(undefined, 20);
  const pending = all.filter((a) => a.status === "pending");
  const delayed = all.filter((a) => a.decision === "delayed");
  const manual = all.filter((a) => a.decision === "manual");
  const denied = all.filter((a) => a.status === "denied");
  const approved = all.filter((a) => a.status === "approved");

  return {
    pendingCount: pending.length,
    delayedCount: delayed.length,
    manualCount: manual.length,
    deniedCount: denied.length,
    approvedCount: approved.length,
    recent: all.slice(0, 5).map((a) => ({
      id: a.id,
      decision: a.decision,
      status: a.status,
      riskScore: a.riskScore,
      description: a.description,
      createdAt: a.createdAt,
    })),
  };
}

export function getEvolutionVersionStatus(): EvolutionVersionStatus {
  const current = evolutionVersionManager.getCurrentVersion();
  const total = evolutionVersionManager.listVersions(1000).length;

  return {
    currentTag: current?.versionTag ?? null,
    totalVersions: total,
    latestDescription: current?.description ?? null,
    latestTestStatus: current?.testStatus ?? null,
    latestApprovalStatus: current?.approvalStatus ?? null,
  };
}

export function getTestRunStatus(): TestRunStatus {
  const last = incrementalTestRunner.getLastResult();
  const recent = incrementalTestRunner.listResults(50);
  const recentFailures = recent.filter((r) => r.status === "failed").length;

  return {
    totalRuns: recent.length,
    lastRun: last
      ? {
          runId: last.runId,
          mode: last.mode,
          passed: last.passed,
          failed: last.failed,
          status: last.status,
          timestamp: last.timestamp,
        }
      : null,
    recentFailures,
  };
}

export function getMonitoringSnapshot(): MonitoringSnapshot {
  return {
    timestamp: Date.now(),
    eventBus: getEventBusStatus(),
    safety: getSafetyStatus(),
    approvals: getApprovalQueueStatus(),
    evolutionVersions: getEvolutionVersionStatus(),
    testRuns: getTestRunStatus(),
    evolutionMetrics: getEvolutionMetrics(),
  };
}
