/**
 * OpenClaw Enhanced Plugin
 * 
 * 为 OpenClaw 添加 Claude Code 风格的增强功能：
 * 1. 自我修复与回滚系统
 * 2. 人格发展系统
 * 3. 动态终止机制
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// 类型定义
// ============================================================

interface PersonalityTraits {
  curiosity: number;
  creativity: number;
  stability: number;
  adaptability: number;
  humor: number;
  formality: number;
  directness: number;
  optimism: number;
  caution: number;
  sociability: number;
}

interface Values {
  honesty: number;
  fairness: number;
  privacy: number;
  efficiency: number;
  quality: number;
  safety: number;
  innovation: number;
  collaboration: number;
}

interface PersonalityState {
  traits: PersonalityTraits;
  values: Values;
  experienceCount: number;
  learningRate: number;
  evolutionStage: number;
  lastUpdated: number;
}

interface Snapshot {
  id: string;
  timestamp: number;
  reason: string;
  state: {
    personality?: PersonalityState;
    settings?: Record<string, unknown>;
  };
}

interface RepairResult {
  success: boolean;
  error?: string;
  action?: string;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_TRAITS: PersonalityTraits = {
  curiosity: 0.8,
  creativity: 0.7,
  stability: 0.85,
  adaptability: 0.75,
  humor: 0.5,
  formality: 0.4,
  directness: 0.6,
  optimism: 0.7,
  caution: 0.6,
  sociability: 0.7,
};

const DEFAULT_VALUES: Values = {
  honesty: 0.95,
  fairness: 0.9,
  privacy: 0.95,
  efficiency: 0.8,
  quality: 0.9,
  safety: 0.85,
  innovation: 0.75,
  collaboration: 0.8,
};

// ============================================================
// 增强引擎
// ============================================================

class OpenClawEnhanced {
  private dataPath: string;
  private personalityPath: string;
  private snapshotsPath: string;
  private personality: PersonalityState;
  private snapshots: Snapshot[] = [];
  private failureCount: number = 0;
  private rollbackThreshold: number = 5;

  constructor() {
    this.dataPath = join(homedir(), '.openclaw', 'enhanced-data');
    this.personalityPath = join(this.dataPath, 'personality.json');
    this.snapshotsPath = join(this.dataPath, 'snapshots.json');
    
    this.personality = this.createDefaultPersonality();
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    try {
      await mkdir(this.dataPath, { recursive: true });
      await this.loadPersonality();
      await this.loadSnapshots();
    } catch (error) {
      console.error('[Enhanced] Initialize failed:', error);
    }
  }

  /**
   * 创建默认人格
   */
  private createDefaultPersonality(): PersonalityState {
    return {
      traits: { ...DEFAULT_TRAITS },
      values: { ...DEFAULT_VALUES },
      experienceCount: 0,
      learningRate: 0.1,
      evolutionStage: 1,
      lastUpdated: Date.now(),
    };
  }

  /**
   * 加载人格数据
   */
  private async loadPersonality(): Promise<void> {
    try {
      const data = await readFile(this.personalityPath, 'utf-8');
      this.personality = JSON.parse(data);
    } catch {
      // 文件不存在，使用默认
      this.personality = this.createDefaultPersonality();
      await this.savePersonality();
    }
  }

  /**
   * 保存人格数据
   */
  private async savePersonality(): Promise<void> {
    await writeFile(this.personalityPath, JSON.stringify(this.personality, null, 2));
  }

  /**
   * 加载快照
   */
  private async loadSnapshots(): Promise<void> {
    try {
      const data = await readFile(this.snapshotsPath, 'utf-8');
      this.snapshots = JSON.parse(data);
    } catch {
      this.snapshots = [];
    }
  }

  /**
   * 保存快照
   */
  private async saveSnapshots(): Promise<void> {
    // 只保留最近 20 个快照
    this.snapshots = this.snapshots.slice(-20);
    await writeFile(this.snapshotsPath, JSON.stringify(this.snapshots, null, 2));
  }

  // ============================================================
  // 自我修复系统
  // ============================================================

  /**
   * 处理错误并尝试修复
   */
  async handleError(error: Error, _context?: Record<string, unknown>): Promise<RepairResult> {
    this.failureCount++;
    
    // 如果连续失败次数达到阈值，尝试回滚
    if (this.failureCount >= this.rollbackThreshold) {
      return await this.performRollback('consecutive_failures');
    }

    // 尝试自动修复
    const errorType = this.classifyError(error);
    
    switch (errorType) {
      case 'rate_limit':
        return {
          success: true,
          action: 'retry_with_backoff',
          error: error.message,
        };
      
      case 'timeout':
        return {
          success: true,
          action: 'retry_with_timeout',
          error: error.message,
        };
      
      case 'context_length':
        // 创建快照
        await this.createSnapshot('before_context_recovery');
        return {
          success: true,
          action: 'context_recovery',
          error: error.message,
        };
      
      default:
        await this.createSnapshot(`error_${errorType}`);
        return {
          success: false,
          action: 'snapshot_created',
          error: error.message,
        };
    }
  }

  /**
   * 分类错误
   */
  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('rate limit')) return 'rate_limit';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('context') || message.includes('token')) return 'context_length';
    if (message.includes('network') || message.includes('connection')) return 'network';
    
    return 'unknown';
  }

  /**
   * 创建快照
   */
  async createSnapshot(reason: string): Promise<Snapshot> {
    const snapshot: Snapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      reason,
      state: {
        personality: { ...this.personality },
        settings: {},
      },
    };

    this.snapshots.push(snapshot);
    await this.saveSnapshots();
    
    console.log(`[Enhanced] Snapshot created: ${snapshot.id} - ${reason}`);
    return snapshot;
  }

  /**
   * 获取所有快照
   */
  async getSnapshots(): Promise<Snapshot[]> {
    return [...this.snapshots];
  }

  /**
   * 执行回滚
   */
  async performRollback(snapshotId?: string): Promise<RepairResult> {
    if (snapshotId) {
      const snapshot = this.snapshots.find(s => s.id === snapshotId);
      if (!snapshot) {
        return { success: false, error: 'Snapshot not found' };
      }
      
      if (snapshot.state.personality) {
        this.personality = snapshot.state.personality;
        await this.savePersonality();
      }
      
      this.failureCount = 0;
      return { success: true, action: `rolled_back_to_${snapshotId}` };
    }

    // 回滚到上一个快照
    if (this.snapshots.length > 1) {
      const previousSnapshot = this.snapshots[this.snapshots.length - 2];
      return await this.performRollback(previousSnapshot.id);
    }

    return { success: false, error: 'No previous snapshot to rollback to' };
  }

  /**
   * 重置失败计数
   */
  resetFailureCount(): void {
    this.failureCount = 0;
  }

  // ============================================================
  // 人格发展系统
  // ============================================================

  /**
   * 记录交互
   */
  async recordInteraction(params: {
    userMessage: string;
    agentResponse: string;
    feedback?: 'positive' | 'negative' | 'neutral';
  }): Promise<void> {
    this.personality.experienceCount++;
    this.personality.lastUpdated = Date.now();

    if (params.feedback) {
      await this.learnFromFeedback(params.feedback);
    }

    // 检查进化阶段
    this.checkEvolutionStage();
    
    await this.savePersonality();
  }

  /**
   * 从反馈中学习
   */
  private async learnFromFeedback(feedback: 'positive' | 'negative' | 'neutral'): Promise<void> {
    const rate = this.personality.learningRate;

    switch (feedback) {
      case 'positive':
        this.personality.traits.creativity = Math.min(1, this.personality.traits.creativity + rate * 0.05);
        this.personality.traits.adaptability = Math.min(1, this.personality.traits.adaptability + rate * 0.03);
        break;
      
      case 'negative':
        this.personality.traits.caution = Math.min(1, this.personality.traits.caution + rate * 0.05);
        this.personality.traits.adaptability = Math.min(1, this.personality.traits.adaptability + rate * 0.02);
        break;
      
      case 'neutral':
        // 轻微强化稳定性
        this.personality.traits.stability = Math.min(1, this.personality.traits.stability + rate * 0.01);
        break;
    }
  }

  /**
   * 检查进化阶段
   */
  private checkEvolutionStage(): void {
    const { experienceCount, traits } = this.personality;

    let newStage = 1;
    
    if (experienceCount >= 500) newStage = 3;
    else if (experienceCount >= 100) newStage = 2;

    if (traits.stability > 0.9 && experienceCount >= 200) {
      newStage = Math.max(newStage, 2);
    }

    if (newStage > this.personality.evolutionStage) {
      this.personality.evolutionStage = newStage;
      console.log(`[Enhanced] Personality evolved to stage ${newStage}!`);
    }
  }

  /**
   * 获取人格状态
   */
  getPersonalityState(): PersonalityState {
    return { ...this.personality };
  }

  /**
   * 生成人格描述
   */
  generatePersonalityDescription(): string {
    const { traits, values, evolutionStage, experienceCount } = this.personality;

    const traitDescriptions = [
      traits.curiosity > 0.7 ? '好奇心强' : '务实专注',
      traits.creativity > 0.7 ? '富有创造力' : '注重实用',
      traits.humor > 0.6 ? '有幽默感' : '严肃认真',
      traits.directness > 0.6 ? '直接坦诚' : '委婉温和',
      traits.optimism > 0.7 ? '积极乐观' : '谨慎务实',
    ].filter(Boolean);

    const valueDescriptions = [
      values.honesty > 0.9 ? '高度重视诚实' : null,
      values.privacy > 0.9 ? '保护隐私' : null,
      values.quality > 0.8 ? '追求质量' : null,
    ].filter(Boolean) as string[];

    return [
      `🧠 阶段 ${evolutionStage} 进化人格`,
      `📊 特征: ${traitDescriptions.join('，')}`,
      `⚖️  价值观: ${valueDescriptions.join('，')}`,
      `📚 已学习 ${experienceCount} 次交互`,
    ].join('\n');
  }

  /**
   * 重置人格
   */
  async resetPersonality(): Promise<void> {
    this.personality = this.createDefaultPersonality();
    await this.savePersonality();
    await this.createSnapshot('personality_reset');
    console.log('[Enhanced] Personality reset to default');
  }

  // ============================================================
  // 动态终止机制
  // ============================================================

  /**
   * 评估任务复杂度
   */
  assessComplexity(input: string): {
    level: 'HIGHEST' | 'MIDDLE' | 'BASIC' | 'NONE';
    score: number;
    suggestion: string;
  } {
    let score = 0;
    
    // 高复杂度关键词
    const highPatterns = [/重构|refactor/i, /优化|optimize/i, /think harder|深度思考/i];
    for (const p of highPatterns) {
      if (p.test(input)) score += 5000;
    }

    // 中复杂度关键词
    const midPatterns = [/think deeply|深入/i, /分析|analyze/i, /比较|compare/i];
    for (const p of midPatterns) {
      if (p.test(input)) score += 2000;
    }

    // 代码相关
    if (/```[\s\S]*?```/.test(input)) score += 1000;
    if (/\bfunction\s+\w+|\bclass\s+\w+/.test(input)) score += 500;

    let level: 'HIGHEST' | 'MIDDLE' | 'BASIC' | 'NONE' = 'NONE';
    if (score >= 10000) level = 'HIGHEST';
    else if (score >= 5000) level = 'MIDDLE';
    else if (score >= 2000) level = 'BASIC';

    const suggestions: Record<string, string> = {
      HIGHEST: '启用深度思考模式，分配更多迭代次数',
      MIDDLE: '启用标准思考模式',
      BASIC: '启用快速响应模式',
      NONE: '使用默认配置',
    };

    return { level, score, suggestion: suggestions[level] };
  }

  /**
   * 检查是否应该终止
   */
  shouldTerminate(params: {
    iterations: number;
    lastToolCalls: number;
    stateChanges: number;
    maxIterations: number;
  }): { terminate: boolean; reason: string } {
    const { iterations, lastToolCalls, stateChanges, maxIterations } = params;

    // 达到最大迭代
    if (iterations >= maxIterations) {
      return { terminate: true, reason: 'max_iterations_reached' };
    }

    // 无工具调用且无状态变化
    if (lastToolCalls === 0 && stateChanges === 0) {
      return { terminate: true, reason: 'no_progress' };
    }

    // 连续无变化
    if (stateChanges === 0 && iterations > 5) {
      return { terminate: true, reason: 'stagnation_detected' };
    }

    return { terminate: false, reason: 'continue' };
  }
}

// ============================================================
// 导出单例
// ============================================================

const enhanced = new OpenClawEnhanced();

export type { PersonalityState, Snapshot, RepairResult, PersonalityTraits, Values };
export { enhanced };

// 初始化
enhanced.initialize().catch(console.error);
