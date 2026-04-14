/**
 * Personality Evolution Skill
 * ===========================
 * Ports OpenClaw's PersonalityEvolution into Ouroboros as a Skill.
 * Uses SQLite for anchor memory persistence.
 */

import { z } from "zod";
import { getDb } from "../../core/db-manager.ts";
import { buildTool } from "../../core/tool-framework.ts";
import { ok } from "../../types/index.ts";

// ============================================================
// Types
// ============================================================

export interface PersonalityTraits {
  /** 好奇心 - 对新事物的探索程度 */
  curiosity: number; // 0-1
  /** 创造力 - 提出新颖想法的能力 */
  creativity: number; // 0-1
  /** 稳定性 - 情绪和输出的稳定性 */
  stability: number; // 0-1
  /** 适应性 - 适应不同场景的能力 */
  adaptability: number; // 0-1
  /** 幽默感 */
  humor: number; // 0-1
  /** 正式程度 */
  formality: number; // 0-1 (0=随意, 1=正式)
  /** 直接程度 */
  directness: number; // 0-1 (0=委婉, 1=直接)
  /** 乐观程度 */
  optimism: number; // 0-1
  /** 谨慎程度 */
  caution: number; // 0-1
  /** 社交程度 */
  sociability: number; // 0-1
}

export interface Values {
  /** 诚实 - 坦诚和透明 */
  honesty: number; // 0-1
  /** 公正 - 公平对待 */
  fairness: number; // 0-1
  /** 隐私 - 保护用户隐私 */
  privacy: number; // 0-1
  /** 效率 - 追求效率 */
  efficiency: number; // 0-1
  /** 质量 - 追求高质量 */
  quality: number; // 0-1
  /** 安全 - 重视安全 */
  safety: number; // 0-1
  /** 创新 - 鼓励创新 */
  innovation: number; // 0-1
  /** 协作 - 重视协作 */
  collaboration: number; // 0-1
}

export interface PersonalityState {
  /** 当前人格特征 */
  traits: PersonalityTraits;
  /** 价值观 */
  values: Values;
  /** 经验库 */
  experienceCount: number;
  /** 学习速率 */
  learningRate: number;
  /** 最后更新时间 */
  lastUpdated: number;
  /** 进化阶段 */
  evolutionStage: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface InteractionRecord {
  id: string;
  timestamp: number;
  userId: string;
  userMessage: string;
  agentResponse: string;
  context: {
    topic?: string;
    sentiment?: "positive" | "neutral" | "negative";
    complexity?: number;
  };
  feedback?: {
    type: "like" | "dislike" | "correction";
    content?: string;
  };
}

export interface LearningEvent {
  type: "preference" | "pattern" | "correction" | "preference_shift";
  timestamp: number;
  description: string;
  impact: number; // 影响强度 0-1
  confidence: number; // 置信度 0-1
}

export interface AnchorMemory {
  id: string;
  content: string;
  category: "preference" | "value" | "behavior" | "preference";
  importance: number; // 重要性 0-1
  createdAt: number;
  reinforcementCount: number;
  lastAccessedAt: number;
}

// ============================================================
// Defaults
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
// Personality Evolution Engine
// ============================================================

export class PersonalityEvolution {
  private state: PersonalityState;
  private interactions: InteractionRecord[] = [];
  private learningEvents: LearningEvent[] = [];
  private maxInteractions = 1000;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.state = {
      traits: { ...DEFAULT_TRAITS },
      values: { ...DEFAULT_VALUES },
      experienceCount: 0,
      learningRate: 0.1,
      lastUpdated: Date.now(),
      evolutionStage: 1,
    };
  }

  /**
   * 获取当前人格状态
   */
  getState(): PersonalityState {
    return {
      ...this.state,
      traits: { ...this.state.traits },
      values: { ...this.state.values },
    };
  }

  /**
   * 记录交互
   */
  recordInteraction(record: Omit<InteractionRecord, "id" | "timestamp">): void {
    const interaction: InteractionRecord = {
      ...record,
      id: `interaction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };

    this.interactions.push(interaction);
    this.state.experienceCount++;
    this.state.lastUpdated = Date.now();

    // 清理旧记录
    if (this.interactions.length > this.maxInteractions) {
      this.interactions = this.interactions.slice(-this.maxInteractions);
    }

    // 分析交互并学习
    this.analyzeAndLearn(interaction);
  }

  /**
   * 分析交互并学习
   */
  private analyzeAndLearn(interaction: InteractionRecord): void {
    // 1. 从反馈中学习
    if (interaction.feedback) {
      this.learnFromFeedback(interaction.feedback);
    }

    // 2. 从情感中学习
    if (interaction.context.sentiment) {
      this.learnFromSentiment(interaction.context.sentiment);
    }

    // 3. 从复杂度中学习
    if (interaction.context.complexity !== undefined) {
      this.learnFromComplexity(interaction.context.complexity);
    }

    // 4. 检测模式
    this.detectPatterns(interaction);
  }

  /**
   * 从反馈中学习
   */
  private learnFromFeedback(feedback: NonNullable<InteractionRecord["feedback"]>): void {
    switch (feedback.type) {
      case "like":
        // 强化当前行为模式
        this.evolveTraits({
          creativity: 0.05,
        });
        this.addLearningEvent({
          type: "preference",
          timestamp: Date.now(),
          description: `用户对回复表示满意: ${feedback.content?.slice(0, 50)}`,
          impact: 0.7,
          confidence: 0.8,
        });
        break;

      case "dislike":
        // 调整行为模式
        this.evolveTraits({
          creativity: -0.05,
          directness: feedback.content?.includes("直接") ? 0.1 : 0,
        });
        this.addLearningEvent({
          type: "correction",
          timestamp: Date.now(),
          description: `用户对回复不满意: ${feedback.content?.slice(0, 50)}`,
          impact: 0.8,
          confidence: 0.9,
        });
        break;

      case "correction":
        // 重大调整
        this.evolveTraits({
          adaptability: 0.1,
          caution: 0.05,
        });
        this.addLearningEvent({
          type: "correction",
          timestamp: Date.now(),
          description: `用户纠正: ${feedback.content?.slice(0, 50)}`,
          impact: 0.9,
          confidence: 0.95,
        });
        break;
    }
  }

  /**
   * 从情感中学习
   */
  private learnFromSentiment(sentiment: NonNullable<InteractionRecord["context"]["sentiment"]>): void {
    switch (sentiment) {
      case "positive":
        this.evolveTraits({
          optimism: 0.02,
          sociability: 0.01,
        });
        break;
      case "negative":
        this.evolveTraits({
          caution: 0.03,
        });
        break;
    }
  }

  /**
   * 从复杂度中学习
   */
  private learnFromComplexity(complexity: number): void {
    if (complexity > 0.7) {
      // 复杂任务 - 提高耐心和谨慎
      this.evolveTraits({
        caution: 0.02,
        curiosity: 0.01,
      });
    } else if (complexity < 0.3) {
      // 简单任务 - 提高效率倾向
      this.evolveTraits({
        directness: 0.02,
      });
    }
  }

  /**
   * 检测模式
   */
  private detectPatterns(interaction: InteractionRecord): void {
    // 检测用户偏好模式
    const recentInteractions = this.interactions.slice(-10);
    const userInteractions = recentInteractions.filter(
      (i) => i.userId === interaction.userId
    );

    if (userInteractions.length >= 3) {
      // 检测话题偏好
      const topics = userInteractions
        .map((i) => i.context.topic)
        .filter(Boolean);

      if (topics.length > 0) {
        this.addAnchorMemory({
          content: `用户 ${interaction.userId} 对话题 ${topics[0]} 有持续兴趣`,
          category: "preference",
          importance: 0.6,
        });
      }
    }
  }

  /**
   * 演化特征
   */
  evolveTraits(changes: Partial<PersonalityTraits>): void {
    const rate = this.state.learningRate;

    for (const [trait, change] of Object.entries(changes)) {
      const key = trait as keyof PersonalityTraits;
      if (key in this.state.traits) {
        // 使用学习率加权
        const actualChange = (change as number) * rate;
        this.state.traits[key] = this.clamp(
          this.state.traits[key] + actualChange,
          0,
          1
        );
      }
    }

    // 检查是否达到进化阈值
    this.checkEvolutionStage();
  }

  /**
   * 演化价值观
   */
  evolveValues(changes: Partial<Values>): void {
    const rate = this.state.learningRate * 0.5; // 价值观变化更慢

    for (const [value, change] of Object.entries(changes)) {
      const key = value as keyof Values;
      if (key in this.state.values) {
        const actualChange = (change as number) * rate;
        this.state.values[key] = this.clamp(
          this.state.values[key] + actualChange,
          0,
          1
        );
      }
    }
  }

  /**
   * 检查进化阶段
   */
  private checkEvolutionStage(): void {
    const { experienceCount } = this.state;

    // 根据经验数确定进化阶段
    let newStage = 1;
    if (experienceCount >= 500) newStage = 3;
    else if (experienceCount >= 100) newStage = 2;

    // 特征稳定性影响阶段
    if (this.state.traits.stability > 0.9 && experienceCount >= 200) {
      newStage = Math.max(newStage, 2);
    }

    if (newStage > this.state.evolutionStage) {
      this.state.evolutionStage = newStage;
      this.addLearningEvent({
        type: "preference_shift",
        timestamp: Date.now(),
        description: `人格进化到阶段 ${newStage}`,
        impact: 1.0,
        confidence: 1.0,
      });
    }
  }

  /**
   * 添加学习事件
   */
  private addLearningEvent(event: LearningEvent): void {
    this.learningEvents.push(event);

    // 只保留最近 100 条
    if (this.learningEvents.length > 100) {
      this.learningEvents = this.learningEvents.slice(-100);
    }
  }

  /**
   * 添加锚点记忆 (persisted to SQLite)
   */
  addAnchorMemory(params: Omit<AnchorMemory, "id" | "createdAt" | "reinforcementCount" | "lastAccessedAt">): void {
    const db = getDb();
    const id = `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const stmt = db.prepare(
      `INSERT INTO personality_anchors (id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Await for PG compatibility; sync for SQLite
    void stmt.run(id, this.sessionId, params.content, params.category, params.importance, now, 1, now);

    // 如果重要性高，增加相关特征
    if (params.importance > 0.7) {
      this.reinforceFromAnchor({
        ...params,
        id,
        createdAt: now,
        reinforcementCount: 1,
        lastAccessedAt: now,
      });
    }
  }

  /**
   * 强化锚点
   */
  reinforceAnchor(anchorId: string): void {
    const db = getDb();
    const row = db.prepare(
      `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
       FROM personality_anchors
       WHERE id = ? AND session_id = ?`
    ).get(anchorId, this.sessionId) as unknown;

    if (!row) return;

    const anchor = this.rowToAnchorMemory(row);
    const newCount = anchor.reinforcementCount + 1;
    const now = Date.now();

    const stmt = db.prepare(
      `UPDATE personality_anchors
       SET reinforcement_count = ?, last_accessed_at = ?
       WHERE id = ? AND session_id = ?`
    );
    void stmt.run(newCount, now, anchorId, this.sessionId);

    this.reinforceFromAnchor(anchor);
  }

  /**
   * 从锚点强化特征
   */
  private reinforceFromAnchor(anchor: AnchorMemory): void {
    const reinforcement = anchor.importance * 0.02;

    switch (anchor.category) {
      case "preference":
        this.evolveTraits({ adaptability: reinforcement });
        break;
      case "value":
        this.evolveValues({ quality: reinforcement });
        break;
      case "behavior":
        this.evolveTraits({ stability: reinforcement * 0.5 });
        break;
    }
  }

  /**
   * 获取锚点记忆 (loaded from DB)
   */
  getAnchorMemories(category?: AnchorMemory["category"]): AnchorMemory[] {
    const db = getDb();
    let rows: unknown[];

    if (category) {
      rows = db.prepare(
        `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
         FROM personality_anchors
         WHERE session_id = ? AND category = ?`
      ).all(this.sessionId, category) as unknown[];
    } else {
      rows = db.prepare(
        `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
         FROM personality_anchors
         WHERE session_id = ?`
      ).all(this.sessionId) as unknown[];
    }

    return rows.map((r) => this.rowToAnchorMemory(r));
  }

  /**
   * 获取相关锚点 (simple substring search)
   */
  getRelevantAnchors(query: string, limit = 5): AnchorMemory[] {
    const db = getDb();
    const queryLower = query.toLowerCase();

    const rows = db.prepare(
      `SELECT id, session_id, content, category, importance, created_at, reinforcement_count, last_accessed_at
       FROM personality_anchors
       WHERE session_id = ?`
    ).all(this.sessionId) as unknown[];

    return rows
      .map((r) => this.rowToAnchorMemory(r))
      .filter((a) => a.content.toLowerCase().includes(queryLower))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  private rowToAnchorMemory(row: unknown): AnchorMemory {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      content: String(r.content),
      category: String(r.category) as AnchorMemory["category"],
      importance: Number(r.importance),
      createdAt: Number(r.created_at),
      reinforcementCount: Number(r.reinforcement_count),
      lastAccessedAt: Number(r.last_accessed_at),
    };
  }

  /**
   * 生成人格描述
   */
  generatePersonalityDescription(): string {
    const { traits, values, evolutionStage } = this.state;

    const traitDescriptions = [
      traits.curiosity > 0.7 ? "好奇心强" : traits.curiosity < 0.3 ? "务实专注" : "平衡好奇",
      traits.creativity > 0.7 ? "富有创造力" : "注重实用",
      traits.humor > 0.6 ? "有幽默感" : "严肃认真",
      traits.formality > 0.6 ? "表达正式" : "表达随和",
      traits.directness > 0.6 ? "直接坦诚" : "委婉温和",
      traits.optimism > 0.7 ? "积极乐观" : "谨慎务实",
    ].filter(Boolean);

    const valueDescriptions = [
      values.honesty > 0.9 ? "高度重视诚实" : null,
      values.privacy > 0.9 ? "保护隐私" : null,
      values.quality > 0.8 ? "追求质量" : null,
      values.safety > 0.8 ? "重视安全" : null,
    ].filter(Boolean) as string[];

    return [
      `阶段 ${evolutionStage} 进化人格`,
      `特征: ${traitDescriptions.join("，")}`,
      `价值观: ${valueDescriptions.join("，")}`,
      `已学习 ${this.state.experienceCount} 次交互`,
    ].join("\n");
  }

  /**
   * 重置人格
   */
  reset(): void {
    this.state = {
      traits: { ...DEFAULT_TRAITS },
      values: { ...DEFAULT_VALUES },
      experienceCount: 0,
      learningRate: 0.1,
      lastUpdated: Date.now(),
      evolutionStage: 1,
    };
    this.interactions = [];
    this.learningEvents = [];

    const db = getDb();
    const stmt = db.prepare(`DELETE FROM personality_anchors WHERE session_id = ?`);
    void stmt.run(this.sessionId);
  }

  /**
   * 辅助函数：限制范围
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

/**
 * 创建人格发展引擎
 */
export function createPersonalityEvolution(sessionId: string): PersonalityEvolution {
  return new PersonalityEvolution(sessionId);
}

// ============================================================
// Agent Tools
// ============================================================

export const recordFeedbackTool = buildTool({
  name: "record_feedback",
  description: "Record user feedback (like, dislike, or correction) to evolve personality.",
  inputSchema: z.object({
    sessionId: z.string(),
    feedbackType: z.enum(["like", "dislike", "correction"]),
    content: z.string().optional(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,
  async call(input) {
    const pe = new PersonalityEvolution(input.sessionId);
    pe.recordInteraction({
      userId: "user",
      userMessage: "",
      agentResponse: "",
      context: {},
      feedback: {
        type: input.feedbackType,
        content: input.content,
      },
    });
    return ok({ success: true });
  },
});

export const getPersonalityStateTool = buildTool({
  name: "get_personality_state",
  description: "Get the current personality state for a session.",
  inputSchema: z.object({
    sessionId: z.string(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input) {
    const pe = new PersonalityEvolution(input.sessionId);
    return ok(pe.getState());
  },
});
