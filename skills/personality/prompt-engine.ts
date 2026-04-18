import type { PersonalityState } from "./personality-core.ts";
import type { AnchorMemory } from "./anchor-store.ts";

export function buildPersonalityPrompt(state: PersonalityState, anchors: AnchorMemory[]): string {
  const desc = generatePersonalityDescription(state);
  const anchorLines = anchors.length > 0
    ? anchors.map((a) => `- [${a.category}] ${a.content}`).join("\n")
    : "None yet.";

  return [
    "# Personality Profile",
    desc,
    "",
    "## Anchors",
    anchorLines,
  ].join("\n");
}

export function generatePersonalityDescription(state: PersonalityState): string {
  const { traits, values, evolutionStage } = state;

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
    `已学习 ${state.experienceCount} 次交互`,
  ].join("\n");
}
